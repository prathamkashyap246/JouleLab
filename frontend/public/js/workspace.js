const $ = id => document.getElementById(id), ed = $('code'), gut = $('gut');
const SAMPLE = `#include <WiFi.h>
#include <HTTPClient.h>

const char* ssid = "lab";
const char* pass = "secret";

void setup() {
  Serial.begin(115200);
  WiFi.begin(ssid, pass);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  float t = analogRead(34) * 0.1;
  Serial.println(t);
  HTTPClient http;
  http.begin("http://example.com/log");
  http.POST(String(t));
  http.end();
  delay(10000);
}
`;
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const days = d => d >= 365 ? (d / 365).toFixed(1) + ' yr' : d.toFixed(1) + ' d';
let hot = new Set(), last = null, prev = null, timer;

function gutter() {
  const n = ed.value.split('\n').length;
  gut.innerHTML = Array.from({ length: n }, (_, i) => `<span class="${hot.has(i + 1) ? 'hot' : ''}">${i + 1}</span>`).join('\n');
  gut.scrollTop = ed.scrollTop;
}
function goto(l) {
  const ls = ed.value.split('\n'), start = ls.slice(0, l - 1).join('\n').length + (l > 1 ? 1 : 0);
  ed.focus(); ed.setSelectionRange(start, start + ls[l - 1].length); ed.scrollTop = Math.max(0, (l - 4) * 22);
}
async function analyze() {
  if (!ed.value.trim()) { $('status').textContent = '[WARN] editor empty'; return; }
  $('status').textContent = '[ .. ] analyzing';
  try {
    const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ed.value, board: $('board').value, interval: +$('interval').value, capacity: +$('capacity').value }) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    last = r; hot = new Set(r.findings.filter(f => f.line).map(f => f.line)); gutter();
    $('score').textContent = r.score;
    $('score').style.color = r.score >= 80 ? '#2e7d32' : r.score >= 50 ? '#b26a00' : '#c62828';
    $('verdict').textContent = r.findings.length ? `${r.findings.length} finding${r.findings.length > 1 ? 's' : ''}` : '0 findings';
    $('dnow').textContent = days(r.now.days); $('dafter').textContent = days(r.after.days);
    $('finds').innerHTML = r.findings.map(f => `<div class="find ${f.sev}"><span class="mono small">${f.sev.toUpperCase()}${f.line ? ' · LINE ' + f.line : ''}</span><b>${esc(f.title)}</b><p>${esc(f.detail)}</p>${f.snippet ? `<code class="mono">${esc(f.snippet)}</code>` : ''}${f.line ? `<button class="chip2" data-l="${f.line}">Go to line</button>` : ''}</div>`).join('');
    $('apply').disabled = !r.applied; $('status').textContent = r.applied ? `[ OK ] ${r.findings.length} findings · ${r.applied} automatic fix${r.applied > 1 ? 'es' : ''} available` : `[ OK ] ${r.findings.length} findings`;
  } catch (e) { $('status').textContent = '[FAIL] ' + e.message; }
}
$('finds').addEventListener('click', e => { const l = e.target.dataset.l; if (l) goto(+l); });
$('analyze').onclick = analyze;
$('sample').onclick = () => { ed.value = SAMPLE; gutter(); analyze(); };
$('apply').onclick = () => { if (!last) return; prev = ed.value; ed.value = last.fixedCode; $('undo').disabled = false; gutter(); analyze(); };
$('undo').onclick = () => { if (prev == null) return; ed.value = prev; prev = null; $('undo').disabled = true; gutter(); analyze(); };
$('copy').onclick = () => navigator.clipboard.writeText(ed.value).then(() => { $('status').textContent = '[ OK ] copied'; });
$('download').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ed.value], { type: 'text/plain' })); a.download = 'sketch.ino'; a.click(); };
$('clear').onclick = () => { ed.value = ''; hot.clear(); last = null; gutter(); $('finds').innerHTML = ''; $('score').textContent = '–'; $('dnow').textContent = $('dafter').textContent = '–'; $('verdict').textContent = 'No analysis yet.'; $('apply').disabled = true; };
ed.addEventListener('input', () => { gutter(); clearTimeout(timer); timer = setTimeout(analyze, 700); });
ed.addEventListener('scroll', () => { gut.scrollTop = ed.scrollTop; });
['board', 'interval', 'capacity'].forEach(id => $(id).addEventListener('change', analyze));
gutter();

// ---- AI suggestions (FastAPI backend via /backend proxy) ----
// Sends the sketch plus any live per-function measurements the backend has collected.
// The backend answers honestly when no AI key is configured; nothing is invented here.
async function aiSuggest() {
  if (!ed.value.trim()) { $('status').textContent = '[WARN] editor empty'; return; }
  const out = $('ai-out'), btn = $('ai');
  btn.disabled = true; $('status').textContent = '[ .. ] LLM request';
  out.innerHTML = '<p class="mono small ai-head">LLM SUGGESTIONS · WAITING</p>';
  try {
    let measurements = [];
    try {
      const sum = await fetch('/backend/api/measurements/summary').then(r => r.ok ? r.json() : null);
      // Real STM32/INA219 function windows only; TEST-source data is never sent to the AI as a measurement.
      const st = await fetch('/backend/api/hardware/status').then(r => r.ok ? r.json() : null).catch(() => null);
      if (sum && sum.functions && !(st && st.test_source)) measurements = sum.functions.filter(f => f.complete_calls > 0).map(f => ({
        function_name: f.function_name, timing_source: f.source === 'gpio' ? 'GPIO-timed' : 'firmware marker',
        calls: f.complete_calls, avg_duration_ms: f.avg_duration_ms, energy_per_call_mJ: f.energy_per_call_mJ,
        average_power_mW: f.average_power_mW, max_power_mW: f.max_power_mW, total_energy_mJ: f.energy_mJ }));
    } catch { /* no live data: send code only */ }
    const res = await fetch('/backend/api/optimizer/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_code: ed.value, board: $('board').value, measurements,
        constraints: ['Preserve output and behavior', `Cycle interval ${$('interval').value} s`, `Battery ${$('capacity').value} mAh`] }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'AI suggestion service failed (' + res.status + ').');
    const r = data.report, list = a => a && a.length ? '<ul>' + a.map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '';
    const sev = { high: 'high', medium: 'medium', low: 'low' };
    out.innerHTML = `<p class="mono small ai-head">LLM SUGGESTIONS · UNVERIFIED · ${measurements.length ? measurements.length + ' MEASURED FUNCTIONS' : 'CODE ONLY, NO LIVE DATA'}</p>
      <p class="ai-sum">${esc(r.summary)}</p>
      ${r.suggestions.map(s => `<div class="find ${sev[s.confidence] || 'low'}"><span class="mono small">${esc(s.function_name)} · ${esc(s.confidence.toUpperCase())} CONFIDENCE</span><b>${esc(s.recommendation)}</b>
        <p><strong>Observed:</strong> ${esc(s.observed_measurement)}</p><p><strong>Issue:</strong> ${esc(s.potential_issue)}</p>
        <p><strong>Why:</strong> ${esc(s.rationale)}</p><p><strong>Trade-offs:</strong> ${esc(s.tradeoffs)}</p></div>`).join('')}
      ${r.validation_steps.length ? '<p class="mono small ai-head">VALIDATE ON HARDWARE</p>' + list(r.validation_steps) : ''}
      ${r.caveats.length ? '<p class="mono small ai-head">CAVEATS</p>' + list(r.caveats) : ''}`;
    $('status').textContent = `[ OK ] ${r.suggestions.length} LLM suggestion${r.suggestions.length === 1 ? '' : 's'}`;
  } catch (e) {
    out.innerHTML = `<div class="find high"><span class="mono small">[FAIL] LLM BACKEND</span><b>No suggestions</b><p>${esc(e.message)}</p></div>`;
    $('status').textContent = '[FAIL] ' + e.message;
  } finally { btn.disabled = false; }
}
$('ai').onclick = aiSuggest;

// ---- Build / Upload / Debug / Serial monitor (FastAPI backend through the /backend proxy) ----
// The board's serial port is owned by the backend's single serial manager. The Serial monitor button
// asks that manager to connect; uploads to ESP32/Uno borrow the port from it. The browser never
// talks to a serial port directly.
const DEV = '/backend/api/development', HW = '/backend/api/hardware';
const dev = { boards: [], job: null, monitorPort: null, monitorState: 'disconnected', pio: false, manualPorts: [] };
const conOut = $('con-out'), conMon = $('con-mon'), conLog = $('con-log');
const logp = { port: null, state: 'disconnected' };
const monBaud = () => +($('monbaud') ? $('monbaud').value : 115200) || 115200;
const devBoard = () => dev.boards.find(b => b.id === $('devboard').value);
async function devApi(path, body, method) {
  const r = await fetch(path, body !== undefined || method ? { method: method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) } : undefined);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : r.status === 502 ? 'JouleLab backend is not running (start uvicorn in backend/).' : 'Request failed (' + r.status + ')');
  return d;
}
function conAppend(el, text, cls) {
  const stick = $('autoscroll') ? $('autoscroll').checked : el.scrollTop + el.clientHeight >= el.scrollHeight - 30;
  if (el.dataset.fresh !== '1') { el.textContent = ''; el.dataset.fresh = '1'; }
  if (cls) { const s = document.createElement('span'); s.className = cls; s.textContent = text; el.appendChild(s); }
  else el.appendChild(document.createTextNode(text));
  while (el.childNodes.length > 4000) el.removeChild(el.firstChild);
  if (stick) el.scrollTop = el.scrollHeight;
}
const jl = t => t.replace(/^\[JouleLab\] ?/gm, 'jl> '); // backend tags its own lines "[JouleLab]"
const lineClass = t => /^(jl>|\[JouleLab\])/.test(t) ? 'c-jl' : /\berror\b|failed|FAILED|undefined reference/i.test(t) ? 'c-err' : /warning/i.test(t) ? 'c-warn' : /SUCCESS|succeeded/.test(t) ? 'c-ok' : '';
function showCon(which) {
  document.querySelectorAll('.ctabs [data-con]').forEach(b => b.classList.toggle('on', b.dataset.con === which));
  conOut.hidden = which !== 'out'; conMon.hidden = which !== 'mon'; conLog.hidden = which !== 'log';
  $('termform').hidden = which === 'out'; $('logbar').hidden = which !== 'log'; dev.tab = which;
}
document.querySelectorAll('.ctabs [data-con]').forEach(b => b.addEventListener('click', () => showCon(b.dataset.con)));
$('conclear').onclick = () => { const el = { out: conOut, mon: conMon, log: conLog }[dev.tab || 'out']; el.textContent = ''; el.dataset.fresh = '1'; };

function devRender() {
  const b = devBoard(), busy = dev.job && dev.job.status === 'running';
  ['verify', 'upload', 'run', 'debug'].forEach(id => { $(id).disabled = busy || !dev.pio || !b; });
  if (b && !b.debug_supported) { $('debug').disabled = true; $('debug').title = b.debug_note; } else $('debug').title = 'Start a GDB session (pio debug)';
  $('stop').disabled = !busy;
  $('devboard').disabled = $('devport').disabled = !!busy;
  $('gdbform').hidden = !(busy && dev.job.kind === 'debug');
  const st = dev.job ? `${dev.job.kind.toUpperCase()} · ${dev.job.status.toUpperCase()}${dev.job.exit_code != null ? ' · exit ' + dev.job.exit_code : ''}` : '';
  $('jobstate').textContent = st; $('jobstate').className = 'mono small js-' + (dev.job ? dev.job.status : '');
  const open = dev.monitorPort && !['disconnected', 'error'].includes(dev.monitorState);
  $('monitor').textContent = open ? `Close monitor (${dev.monitorPort.replace(/^\/dev\//, '')})` : 'Serial monitor';
  $('monitor').classList.toggle('on', !!open);
  if (!dev.pio) { $('devinfo').textContent = '[FAIL] PlatformIO not installed · in backend/: python -m pip install platformio, then restart the backend'; return; }
  if (b) $('devinfo').textContent = `Editor: ${b.main_file} · Upload: ${b.upload_method === 'stlink' ? 'ST-LINK (SWD), no port needed' : 'USB serial port'} · Debug: ${b.debug_supported ? 'yes' : 'no'}`;
}
async function loadBoards() {
  try {
    const d = await devApi(DEV + '/boards');
    dev.boards = d.boards; dev.pio = d.platformio.installed;
    let saved = null; try { saved = localStorage.getItem('jl.devboard'); } catch (e) { }
    $('devboard').innerHTML = d.boards.map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    if (saved && d.boards.some(b => b.id === saved)) $('devboard').value = saved;
  } catch (e) { $('devinfo').textContent = '[FAIL] ' + e.message; dev.pio = false; }
  devRender();
}
async function loadPorts() {
  try {
    const d = await devApi(DEV + '/ports'), cur = $('devport').value;
    dev.monitorPort = d.monitor_port; dev.monitorState = d.monitor_state;
    const listed = new Set(d.ports.map(p => p.device));
    const extra = [...new Set([...dev.manualPorts, d.monitor_port].filter(x => x && !listed.has(x)))];
    const opts = d.ports.map(p => `<option value="${esc(p.device)}">${esc(p.device)}${p.is_stlink ? ' · ST-LINK' : p.description && p.description !== 'n/a' ? ' · ' + esc(p.description) : ''}${p.device === d.monitor_port ? ' (open in monitor)' : ''}</option>`);
    extra.forEach(x => opts.push(`<option value="${esc(x)}">${esc(x)}${x === d.monitor_port ? ' (open in monitor)' : ' (typed)'}</option>`));
    $('devport').innerHTML = '<option value="">' + (d.ports.length ? '— choose a port —' : 'No serial ports found') + '</option>' + opts.join('') +
      '<option value="__other">Type a port…</option>';
    const pick = [cur, d.monitor_port, (d.ports.find(p => p.is_stlink) || {}).device].find(x => x && x !== '__other' && (listed.has(x) || extra.includes(x)));
    if (pick) $('devport').value = pick;
    const lcur = $('logportsel').value;
    $('logportsel').innerHTML = '<option value="">— choose —</option>' + opts.join('');
    if (logp.port) $('logportsel').value = logp.port; else if (lcur) $('logportsel').value = lcur;
  } catch (e) { $('devport').innerHTML = '<option value="">Backend offline</option>'; }
  devRender();
}
$('devboard').addEventListener('change', () => { try { localStorage.setItem('jl.devboard', $('devboard').value); } catch (e) { } devRender(); });
try { const sb = localStorage.getItem('jl.monbaud'); if (sb && $('monbaud')) $('monbaud').value = sb; } catch (e) { }
$('monbaud').addEventListener('change', () => { try { localStorage.setItem('jl.monbaud', $('monbaud').value); } catch (e) { } });
$('devrefresh').onclick = loadPorts;
$('devport').addEventListener('change', () => {
  if ($('devport').value !== '__other') return;
  const p = (prompt('Serial port (e.g. COM5, /dev/cu.usbmodem1103, /dev/ttyACM0):') || '').trim();
  if (p && !dev.manualPorts.includes(p)) dev.manualPorts.push(p);
  loadPorts().then(() => { if (p) $('devport').value = p; });
});

async function runJob(kind) {
  const b = devBoard(); if (!b) return;
  showCon('out');
  if (!ed.value.trim()) { conAppend(conOut, '\njl> The editor is empty. Use "Open board project in editor" or paste code first.\n', 'c-err'); return; }
  const body = { board: b.id, source: ed.value };
  if (kind === 'upload') body.port = $('devport').value || null;
  conOut.textContent = ''; conOut.dataset.fresh = '1';
  try {
    const path = kind === 'debug' ? DEV + '/debug/start' : DEV + '/' + kind;
    dev.job = await devApi(path, body); devRender();
  } catch (e) { conAppend(conOut, '\njl> ' + e.message + '\n', 'c-err'); }
}
$('verify').onclick = () => runJob('build');
$('upload').onclick = () => runJob('upload');
// Run = build + flash, then open the terminal on the board's port and show what the program prints.
$('run').onclick = async () => { dev.runAfter = true; await runJob('upload'); if (!dev.job || dev.job.status !== 'running') dev.runAfter = false; };
async function openTerminalAfterRun() {
  const b = devBoard(), open = dev.monitorPort && !['disconnected', 'error'].includes(dev.monitorState);
  const uport = $('devport').value;
  if (b && b.needs_upload_port && open && dev.monitorPort !== uport) {
    // the main connection is busy measuring another board: show this board on the log port
    showCon('log');
    if (logp.port === uport && logp.state !== 'disconnected') { conAppend(conLog, `\njl> Program flashed. Output from ${uport}:\n`, 'c-jl'); return; }
    try { const st = await devApi(HW + '/logport/connect', { port: uport, baudrate: 115200 }); logp.port = st.port; logp.state = st.state; $('logportsel').value = uport; }
    catch (e) { conAppend(conLog, '\njl> ' + e.message + '\n', 'c-err'); }
    renderLog(); return;
  }
  showCon('mon');
  if (open) { conAppend(conMon, `\njl> Program flashed. Output from ${dev.monitorPort}:\n`, 'c-jl'); return; }
  const port = $('devport').value;
  if (!port || port === '__other') { conAppend(conMon, '\njl> Flashed. Choose the board\'s serial port to see its output.\n', 'c-err'); return; }
  try {
    const st = await devApi(HW + '/connect', { port, baudrate: monBaud() });
    dev.monitorPort = st.port; dev.monitorState = st.state;
    conAppend(conMon, `\njl> Program flashed. Terminal connected to ${port} at ${monBaud()} baud.\n`, 'c-jl');
    if (b && b.id === 'nucleo_f446re') conAppend(conMon, 'jl> The JouleLab firmware sends binary measurements: watch them in Lab → Live hardware. Text your code prints appears here.\n', 'c-jl');
  } catch (e) { conAppend(conMon, '\njl> ' + e.message + '\n', 'c-err'); }
  devRender(); loadPorts();
}
$('termform').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('termcmd').value;
  try { await devApi(HW + (dev.tab === 'log' ? '/logport/send' : '/send'), { text, line_ending: $('termeol').value.replace('\\r', '\r').replace('\\n', '\n') }); $('termcmd').value = ''; }
  catch (err) { conAppend(dev.tab === 'log' ? conLog : conMon, '\njl> ' + err.message + '\n', 'c-err'); }
});
$('debug').onclick = () => runJob('debug');
$('stop').onclick = async () => { try { await devApi(DEV + '/stop', {}); } catch (e) { conAppend(conOut, '\njl> ' + e.message + '\n', 'c-err'); } };

$('openproj').onclick = async () => {
  const b = devBoard(); if (!b) return;
  if (ed.value.trim() && !confirm(`Replace the editor contents with ${b.name}'s ${b.main_file}?`)) return;
  try { const d = await devApi(`${DEV}/project/${b.id}`); ed.value = d.source; hot.clear(); gutter(); ed.scrollTop = 0; $('status').textContent = `[ OK ] opened ${b.main_file} (${b.name})`; }
  catch (e) { $('status').textContent = '[FAIL] ' + e.message; }
};
$('resetproj').onclick = async () => {
  const b = devBoard(); if (!b) return;
  if (!confirm(`Restore ${b.name}'s project from the JouleLab template? Changes to ${b.main_file} in the project are lost.`)) return;
  try { const d = await devApi(`${DEV}/project/${b.id}/reset`, {}); ed.value = d.source; hot.clear(); gutter(); $('status').textContent = `[ OK ] ${b.name} project restored`; }
  catch (e) { $('status').textContent = '[FAIL] ' + e.message; }
};

$('gdbform').addEventListener('submit', async e => {
  e.preventDefault(); const c = $('gdbcmd').value.trim(); if (!c) return;
  try { await devApi(DEV + '/debug/command', { command: c }); $('gdbcmd').value = ''; } catch (err) { conAppend(conOut, '\njl> ' + err.message + '\n', 'c-err'); }
});
document.querySelectorAll('[data-gdb]').forEach(b => b.addEventListener('click', () => { $('gdbcmd').value = b.dataset.gdb; $('gdbform').requestSubmit(); }));

$('monitor').onclick = async () => {
  showCon('mon');
  const open = dev.monitorPort && !['disconnected', 'error'].includes(dev.monitorState);
  try {
    const st = open ? await devApi(HW + '/disconnect', {}) : await devApi(HW + '/connect', { port: $('devport').value || 'auto', baudrate: monBaud() });
    dev.monitorPort = st.port; dev.monitorState = st.state;
  } catch (e) { conAppend(conMon, '\njl> ' + e.message + '\n', 'c-err'); }
  devRender(); loadPorts();
};

function wsConnect(path, onMsg) {
  let ws, stop = false;
  const go = () => {
    ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + path);
    ws.onmessage = e => onMsg(JSON.parse(e.data));
    ws.onclose = () => { if (!stop) setTimeout(go, 2000); };
    ws.onerror = () => ws.close();
  };
  go();
}
wsConnect('/backend/ws/build-output', m => {
  if (m.type === 'snapshot') { dev.job = m.job; if (m.lines.length) { conOut.textContent = ''; conOut.dataset.fresh = '1'; m.lines.forEach(t => conAppend(conOut, jl(t) + '\n', lineClass(t))); } }
  else if (m.type === 'line') conAppend(conOut, jl(m.text) + '\n', lineClass(m.text));
  else if (m.type === 'job') {
    const started = !dev.job || dev.job.id !== m.job.id; dev.job = m.job;
    if (started) { conOut.textContent = ''; conOut.dataset.fresh = '1'; }
    if (dev.runAfter && m.job.kind === 'upload' && m.job.status !== 'running') {
      dev.runAfter = false;
      if (m.job.status === 'succeeded') openTerminalAfterRun();
      else conAppend(conOut, 'jl> Run stopped: the upload did not succeed, so the program was not started.\n', 'c-err');
    }
  }
  devRender();
});
wsConnect('/backend/ws/serial-monitor', m => {
  if (m.type === 'snapshot') { if (m.text) { conMon.textContent = ''; conMon.dataset.fresh = '1'; conAppend(conMon, jl(m.text)); } if (m.status) { dev.monitorPort = m.status.port; dev.monitorState = m.status.state; devRender(); } }
  else if (m.type === 'text') conAppend(conMon, jl(m.text));
});
setInterval(() => fetch(HW + '/status').then(r => r.ok ? r.json() : null).then(s => { if (s) { dev.monitorPort = s.port; dev.monitorState = s.state; devRender(); } }).catch(() => { }), 2000);
loadBoards(); loadPorts();


// ---- Log port: a second, text-only board connection ----
function renderLog() {
  const open = logp.port && !['disconnected', 'error'].includes(logp.state);
  $('logconnect').textContent = open ? 'Close log port' : 'Open log port';
  $('logportsel').disabled = $('logbaud').disabled = !!open;
  $('logstate').textContent = open ? `${logp.state} · ${logp.port}` : '';
}
$('logconnect').onclick = async () => {
  const open = logp.port && !['disconnected', 'error'].includes(logp.state);
  try {
    const st = open ? await devApi(HW + '/logport/disconnect', {})
      : await devApi(HW + '/logport/connect', { port: $('logportsel').value, baudrate: +$('logbaud').value });
    logp.port = st.port; logp.state = st.state;
  } catch (e) { conAppend(conLog, '\njl> ' + e.message + '\n', 'c-err'); }
  renderLog(); loadPorts();
};
wsConnect('/backend/ws/log-monitor', m => {
  if (m.type === 'snapshot') { if (m.text) { conLog.textContent = ''; conLog.dataset.fresh = '1'; conAppend(conLog, m.text); } if (m.status) { logp.port = m.status.port; logp.state = m.status.state; renderLog(); } }
  else if (m.type === 'text') conAppend(conLog, m.text);
});
setInterval(() => fetch(HW + '/logport/status').then(r => r.ok ? r.json() : null).then(s => { if (s) { logp.port = s.port; logp.state = s.state; renderLog(); } }).catch(() => { }), 2000);
