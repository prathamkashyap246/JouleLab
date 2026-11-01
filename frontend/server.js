const express = require('express');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');
const auth = require('./auth');
const app = express();
const HOST = process.env.HOST || '127.0.0.1';
auth.checkStartup(HOST);

// FastAPI backend (measurements, live stream, AI suggestions).
// The browser calls /backend/... on this server and Express forwards it, so there is
// one origin (no CORS) and backend secrets such as the OpenAI key never reach the browser.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const backend = createProxyMiddleware({
  target: BACKEND_URL,
  changeOrigin: true,
  ws: true,
  xfwd: true, // pass the browser's address on, so the backend can keep build/upload/debug local-only
  pathFilter: '/backend',
  pathRewrite: { '^/backend': '' },
  on: {
    // prove to the backend that the request comes from this proxy (replaces any client-sent value)
    proxyReq: (proxyReq) => proxyReq.setHeader('x-joulelab-proxy-key', auth.getProxyKey()),
    proxyReqWs: (proxyReq) => proxyReq.setHeader('x-joulelab-proxy-key', auth.getProxyKey()),
    error: (err, req, res) => {
      if (res && typeof res.status === 'function' && !res.headersSent) {
        res.status(502).json({ detail: 'JouleLab backend is not reachable. Start it with: uvicorn app.main:app --reload' });
      } else if (res && typeof res.destroy === 'function') {
        res.destroy(); // WebSocket upgrade: just close the socket
      }
    }
  }
});
const VOLTS = 3.3, USABLE = 0.76; // usable fraction of rated battery capacity

// phases: [label, duration s, current mA]. Scale per board.
const BOARDS = { ESP32: 1, STM32: 0.55, 'Black Pill': 0.45 };
const PATTERNS = {
  standard: {
    label: 'Standard firmware',
    phases: [['Sensing', 0.08, 24], ['Processing', 0.3, 50], ['Transmit', 0.3, 183.1], ['Sleep', 0, 0.1]]
  },
  optimized: {
    label: 'Batch transmit + shorter processing',
    phases: [['Sensing', 0.08, 24], ['Processing', 0.1, 50], ['Transmit', 0.15, 183.1], ['Sleep', 0, 0.1]]
  }
};

const inputs = q => ({
  board: BOARDS[q.board] ? q.board : 'ESP32',
  pattern: q.pattern === 'standard' ? 'standard' : 'optimized',
  capacity: Math.min(Math.max(+q.capacity || 2000, 100), 10000),
  interval: Math.min(Math.max(+q.interval || 10, 2), 60)
});

// ESP32 datasheet-typical figures: [mode, label, microamps (for the log bar)]
const ESP32 = {
  specs: [['Module', 'ESP32-WROOM-32 (typical dev kit)'], ['CPU', 'Xtensa LX6 dual-core, up to 240 MHz'], ['Memory', '520 KB SRAM · 4 MB flash (module)'],
    ['Radio', 'Wi-Fi 802.11 b/g/n · Bluetooth 4.2 + BLE'], ['I/O', '34 GPIO · 18× 12-bit ADC · 2× DAC · 3× UART'], ['Buses', '2× I²C · 4× SPI · 2× I²S · CAN (TWAI)'],
    ['Supply', '3.0 – 3.6 V (3.3 V in this model)'], ['Sleep helpers', 'RTC memory 8 KB + 8 KB · ULP co-processor']],
  modes: [['Wi-Fi TX (MCS7)', '≈ 180 mA', 180000], ['Wi-Fi / BT RX', '95–100 mA', 97000], ['Modem-sleep · 240 MHz', '30–68 mA', 50000], ['Modem-sleep · 80 MHz', '20–31 mA', 25000],
    ['Light-sleep', '≈ 0.8 mA', 800], ['Deep-sleep · ULP on', '≈ 150 µA', 150], ['Deep-sleep · RTC timer', '≈ 10 µA', 10], ['Hibernation', '≈ 5 µA', 5]],
  tip: 'Dev boards add a USB-UART chip and a linear regulator that can draw milliamps even in deep sleep. Measure a bare module for the chip’s true floor.'
};

// Rule-based firmware check (static, not a profiler). Line rules may carry an automatic fix.
const RULES = [
  { id: 'delay', sev: 'high', w: 30, re: /\bdelay\s*\(\s*(\d{4,})\s*\)/, t: 'Blocking delay() keeps the CPU awake',
    d: 'Core and radio stay powered for the whole wait. Deep sleep with a timer wakeup restarts setup() on wake, so keep state in RTC_DATA_ATTR.',
    fix: l => l.replace(/\bdelay\s*\(\s*(\d{4,})\s*\)/, 'esp_sleep_enable_timer_wakeup($1 * 1000ULL); esp_deep_sleep_start()') },
  { id: 'tx', sev: 'high', w: 25, re: /\b(http\.(GET|POST)\s*\(|\.publish\s*\(|udp\.beginPacket\s*\()/, t: 'Radio transmit on every pass',
    d: 'Wi-Fi TX peaks near 180 mA. Buffer readings (RTC memory) and send several in one batch.' },
  { id: 'busy', sev: 'medium', w: 10, re: /while\s*\(\s*WiFi\.status\(\)/, t: 'Busy-wait for Wi-Fi',
    d: 'Polling while associating keeps the radio up longer. Add a timeout and a static IP (WiFi.config) to shorten connect time.' },
  { id: 'serial', sev: 'low', w: 5, re: /\bSerial\.print/, t: 'Serial logging in firmware', d: 'UART output keeps peripherals busy. Gate it behind a debug flag in battery builds.' }
];

// Proposed edits, VS Code style: each change replaces `del` lines starting at `line` with `after`.
// `estimate` quotes datasheet-typical figures only; the real effect is measured on hardware.
const indentOf = l => (l.match(/^\s*/) || [''])[0];
const CHANGE_RULES = [
  { id: 'cpu', sev: 'medium', title: 'CPU left at 240 MHz',
    detail: 'Light work (GPIO, PWM, short delays, BLE advertising) runs fine at 80 MHz, the lowest setting that keeps Wi-Fi/BT working.',
    estimate: 'ESP32 datasheet: modem-sleep at 240 MHz ≈ 30–68 mA; at 80 MHz ≈ 20–31 mA.',
    behavior: 'Same behaviour; code runs about 3x slower, which only matters for heavy computation.',
    when: code => /void\s+setup\s*\(\s*\)/.test(code) && !/setCpuFrequencyMhz/.test(code),
    find: lines => lines.findIndex(l => /void\s+setup\s*\(\s*\)\s*\{/.test(l)),
    make: l => [l, indentOf(l) + '  setCpuFrequencyMhz(80);  // was 240 MHz'] },
  { id: 'delay', sev: 'high', title: 'Blocking delay() keeps the CPU awake',
    detail: 'Core and radio stay powered for the whole wait. Deep sleep restarts setup() on wake, so keep state in RTC_DATA_ATTR variables.',
    estimate: 'ESP32 datasheet: awake idle ≈ 20–68 mA; deep sleep with RTC timer ≈ 10 µA.',
    behavior: 'Changes program flow: the board reboots after each sleep.',
    re: /\bdelay\s*\(\s*(\d{4,})\s*\)\s*;?/,
    make: l => [l.replace(/\bdelay\s*\(\s*(\d{4,})\s*\)\s*;?/, 'esp_sleep_enable_timer_wakeup($1 * 1000ULL); esp_deep_sleep_start();')] },
  { id: 'adv', sev: 'medium', title: 'BLE advertising faster than needed',
    detail: 'Each advertising event is a radio burst on three channels. Advertising every 1 s instead of every 100 ms sends ten times fewer bursts.',
    estimate: 'Advertising energy scales roughly with 1 / interval.',
    behavior: 'Phones take longer (up to ~1 s) to discover the device.',
    re: /set(Min|Max)Interval\s*\(\s*(\d+)\s*\)/,
    test: l => { const m = l.match(/set(?:Min|Max)Interval\s*\(\s*(\d+)\s*\)/); return m && +m[1] < 800; },
    make: l => [l.replace(/(set(?:Min|Max)Interval\s*\(\s*)(\d+)(\s*\))/, '$11600$3').replace(/\/\/.*$/, '') .replace(/\s+$/, '') + '  // 1600 x 0.625 ms = 1 s'] },
  { id: 'busy', sev: 'medium', title: 'Unbounded busy-wait for Wi-Fi',
    detail: 'If the access point is missing, this loop keeps the radio searching forever.',
    estimate: 'Wi-Fi RX/association ≈ 95–100 mA for as long as the loop runs.',
    behavior: 'Gives up after 5 s; handle the not-connected case afterwards.',
    re: /while\s*\(\s*WiFi\.status\(\)\s*!=\s*WL_CONNECTED\s*\)\s*delay\s*\(\s*\d+\s*\)\s*;/,
    make: l => [indentOf(l) + 'for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) delay(250);  // give up after 5 s'] },
  { id: 'radio', sev: 'medium', title: 'Radio stays on after the last transmit',
    detail: 'Wi-Fi keeps listening between transmissions unless it is switched off.',
    estimate: 'Wi-Fi connected idle ≈ 20–30 mA above modem-sleep.',
    behavior: 'Reconnect (WiFi.begin) before the next transmit.',
    when: code => /WiFi\.begin/.test(code) && !/WiFi\.(disconnect|mode\s*\(\s*WIFI_OFF)/.test(code),
    find: lines => lines.findIndex(l => /\bhttp\.end\s*\(\s*\)/.test(l)),
    make: l => [l, indentOf(l) + 'WiFi.disconnect(true); WiFi.mode(WIFI_OFF);'] }
];

function proposeChanges(code) {
  const lines = code.split('\n'), out = [];
  for (const r of CHANGE_RULES) {
    if (r.when) {
      if (!r.when(code)) continue;
      const i = r.find(lines);
      if (i < 0) continue;
      out.push({ i, r });
    } else {
      lines.forEach((l, i) => { if (r.re.test(l) && (!r.test || r.test(l))) out.push({ i, r }); });
    }
  }
  return out.map(({ i, r }, k) => ({
    key: r.id + ':' + (i + 1), id: r.id, sev: r.sev, line: i + 1, del: 1, before: [lines[i]], after: r.make(lines[i]),
    title: r.title, detail: r.detail, estimate: r.estimate, behavior: r.behavior
  })).filter(c => c.after.join('\n') !== c.before.join('\n')).sort((a, b) => a.line - b.line);
}

function applyChanges(code, changes) {
  const lines = code.split('\n');
  [...changes].sort((a, b) => b.line - a.line).forEach(c => lines.splice(c.line - 1, c.del, ...c.after));
  return lines.join('\n');
}

function analyze(code, board, capacity, interval) {
  const lines = code.split('\n'), found = [], hit = new Set();
  lines.forEach((l, i) => RULES.forEach(r => { if (r.re.test(l)) { hit.add(r.id); found.push({ id: r.id, sev: r.sev, line: i + 1, title: r.t, detail: r.d, snippet: l.trim().slice(0, 90) }); } }));
  const add = (id, sev, w, title, detail) => { hit.add(id); found.push({ id, sev, line: null, title, detail, w }); };
  if (!/esp_(deep|light)_sleep_start/.test(code)) add('nosleep', 'high', 30, 'No sleep mode used', 'Without deep or light sleep the MCU idles at tens of mA. Deep sleep with a timer wakeup brings the chip to roughly 10 µA.');
  if (/WiFi\.begin/.test(code) && !/WiFi\.(disconnect|mode\s*\(\s*WIFI_OFF)/.test(code)) add('radio', 'medium', 12, 'Radio never switched off', 'Call WiFi.disconnect(true) and WiFi.mode(WIFI_OFF) after the last transmit if you stay awake.');
  const cpu = !/setCpuFrequencyMhz/.test(code);
  if (cpu) add('cpu', 'low', 5, 'CPU left at 240 MHz', 'Light processing runs fine at 80 MHz (the minimum while Wi-Fi is on) and lowers active current.');
  const changes = proposeChanges(code);
  changes.forEach(c => { if (!found.some(f => f.id === c.id && (f.line === c.line || f.line == null))) { hit.add(c.id); found.push({ id: c.id, sev: c.sev, line: c.line, title: c.title, detail: c.detail, snippet: c.before[0].trim().slice(0, 90), w: 8 }); } });
  found.forEach(f => { const c = changes.find(c => c.id === f.id && (f.line == null || c.line === f.line)); if (c) { f.change = c.key; if (f.line == null) f.line = c.line; } });
  const w = id => ((RULES.find(r => r.id === id) || found.find(f => f.id === id) || {}).w) || 5;
  const score = Math.max(0, 100 - [...hit].reduce((a, id) => a + w(id), 0));
  const high = found.some(f => f.sev === 'high');
  const now = simulate(board, high ? 'standard' : 'optimized', capacity, interval), after = simulate(board, 'optimized', capacity, interval);
  return { score, findings: found, changes, applied: changes.length, fixedCode: applyChanges(code, changes),
    now: { avgMa: now.avgMa, days: now.days }, after: { avgMa: after.avgMa, days: after.days } };
}

function simulate(board, pattern, capacity, interval) {
  const k = BOARDS[board] || 1;
  const phases = PATTERNS[pattern].phases.map(([name, dur, ma]) => ({ name, dur, ma: ma * k }));
  const active = phases.filter(p => p.name !== 'Sleep').reduce((s, p) => s + p.dur, 0);
  const sleep = phases.find(p => p.name === 'Sleep');
  sleep.dur = Math.max(interval - active, 0);
  const charge = phases.reduce((s, p) => s + p.ma * p.dur, 0); // mC
  const avgMa = charge / interval;
  phases.forEach(p => { p.mj = p.ma * p.dur * VOLTS; p.pct = (p.ma * p.dur) / charge * 100; });
  return {
    phases, interval, avgMa,
    peakMa: Math.max(...phases.map(p => p.ma)),
    cycleMj: charge * VOLTS,
    powerMw: avgMa * VOLTS,
    days: (capacity * USABLE) / avgMa / 24
  };
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
auth.install(app); // login wall when JOULELAB_PASSWORD is set
app.use(express.static(path.join(__dirname, 'public')));
// React is served from node_modules (no CDN; the page works offline)
app.use('/vendor/react', express.static(path.join(__dirname, 'node_modules', 'react', 'umd')));
app.use('/vendor/react-dom', express.static(path.join(__dirname, 'node_modules', 'react-dom', 'umd')));

app.use(backend); // must come before express.json so request bodies are forwarded untouched
app.use(express.json({ limit: '200kb' }));
app.get('/', (req, res) => res.render('index', { boards: Object.keys(BOARDS), esp32: ESP32 }));
app.get('/workspace', (req, res) => res.render('workspace', { boards: Object.keys(BOARDS) }));
app.post('/api/analyze', (req, res) => {
  const code = String((req.body || {}).code || '');
  if (!code.trim()) return res.status(400).json({ error: 'Paste some firmware first.' });
  const i = inputs(req.body);
  res.json(analyze(code, i.board, i.capacity, i.interval));
});

app.get('/api/simulate', (req, res) => {
  const board = BOARDS[req.query.board] ? req.query.board : 'ESP32';
  const capacity = Math.min(Math.max(+req.query.capacity || 2000, 100), 10000);
  const interval = Math.min(Math.max(+req.query.interval || 10, 2), 60);
  res.json({
    pattern: simulate(board, req.query.pattern === 'standard' ? 'standard' : 'optimized', capacity, interval),
    baseline: simulate(board, 'standard', capacity, interval)
  });
});

app.get('/api/report', (req, res) => {
  const i = inputs(req.query), r = simulate(i.board, i.pattern, i.capacity, i.interval);
  const lines = ['JouleLab energy report', `Board: ${i.board} · pattern: ${i.pattern} · ${i.capacity} mAh · ${i.interval} s cycle`, `Average current: ${r.avgMa.toFixed(2)} mA`, `Peak current: ${r.peakMa.toFixed(1)} mA`,
    `Cycle energy: ${r.cycleMj.toFixed(2)} mJ`, `Projected runtime: ${r.days.toFixed(1)} days`, '', 'Phases:',
    ...r.phases.map(p => `  ${p.name}: ${(p.dur * 1000).toFixed(0)} ms, ${p.mj.toFixed(2)} mJ, ${p.pct.toFixed(1)}%`),
    '', 'Modelled estimate. Validate by measurement.'];
  res.type('text/plain').attachment('joulelab-energy-report.txt').send(lines.join('\n'));
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, HOST, () => console.log(`JouleLab on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT} · backend ${BACKEND_URL}` +
  (auth.enabled ? ' · password login ON' : ' · this computer only (set HOST and JOULELAB_PASSWORD to share)')));
server.on('upgrade', (req, socket, head) => { // WebSockets (/backend/ws/...) need the login too
  if (!auth.loggedIn(req)) { socket.destroy(); return; }
  backend.upgrade(req, socket, head);
});
