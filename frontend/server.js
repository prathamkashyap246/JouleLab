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

function analyze(code, board, capacity, interval) {
  const lines = code.split('\n'), found = [], hit = new Set();
  lines.forEach((l, i) => RULES.forEach(r => { if (r.re.test(l)) { hit.add(r.id); found.push({ id: r.id, sev: r.sev, line: i + 1, title: r.t, detail: r.d, snippet: l.trim().slice(0, 90) }); } }));
  const add = (id, sev, w, title, detail) => { hit.add(id); found.push({ id, sev, line: null, title, detail, w }); };
  if (!/esp_(deep|light)_sleep_start/.test(code)) add('nosleep', 'high', 30, 'No sleep mode used', 'Without deep or light sleep the MCU idles at tens of mA. Deep sleep with a timer wakeup brings the chip to roughly 10 µA.');
  if (/WiFi\.begin/.test(code) && !/WiFi\.(disconnect|mode\s*\(\s*WIFI_OFF)/.test(code)) add('radio', 'medium', 12, 'Radio never switched off', 'Call WiFi.disconnect(true) and WiFi.mode(WIFI_OFF) after the last transmit if you stay awake.');
  const cpu = !/setCpuFrequencyMhz/.test(code);
  if (cpu) add('cpu', 'low', 5, 'CPU left at 240 MHz', 'Light processing runs fine at 80 MHz (the minimum while Wi-Fi is on) and lowers active current.');
  const w = id => (RULES.find(r => r.id === id) || found.find(f => f.id === id)).w;
  const score = Math.max(0, 100 - [...hit].reduce((a, id) => a + w(id), 0));
  let applied = 0;
  const out = lines.map(l => { const r = RULES.find(r => r.fix && r.re.test(l)); if (r) { applied++; return r.fix(l); } return l; });
  if (cpu) { const i = out.findIndex(l => /void\s+setup\s*\(\s*\)\s*\{/.test(l)); if (i >= 0) { out.splice(i + 1, 0, '  setCpuFrequencyMhz(80);  // enough for light processing'); applied++; } }
  const high = found.some(f => f.sev === 'high');
  const now = simulate(board, high ? 'standard' : 'optimized', capacity, interval), after = simulate(board, 'optimized', capacity, interval);
  return { score, findings: found, applied, fixedCode: out.join('\n'),
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
