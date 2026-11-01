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
let hot = new Set(), last = null, timer, peekKey = null;
const undoStack = [], dismissed = new Set();
const LH = 20, PAD = 10;                       // editor line height and top padding (must match CSS)
const hl = $('edhl'), peek = $('peek');

function gutter() {
  const n = ed.value.split('\n').length, ch = new Map((last ? last.changes : []).filter(c => !dismissed.has(c.key)).map(c => [c.line, c]));
  gut.innerHTML = Array.from({ length: n }, (_, i) => ch.has(i + 1)
    ? `<span class="hot chg" data-k="${ch.get(i + 1).key}" title="Proposed change: click to view">${i + 1}</span>`
    : `<span class="${hot.has(i + 1) ? 'hot' : ''}">${i + 1}</span>`).join('\n');
  gut.scrollTop = ed.scrollTop;
}
// light-red bands behind the flagged lines (VS Code "removed line" style)
function paintLines() {
  const cs = last ? last.changes.filter(c => !dismissed.has(c.key)) : [];
  hl.innerHTML = cs.map(c => `<div class="hl-del${c.key === peekKey ? ' on' : ''}" style="top:${PAD + (c.line - 1) * LH}px;height:${c.del * LH}px"></div>`).join('');
  hl.style.transform = `translate(${-ed.scrollLeft}px,${-ed.scrollTop}px)`;
  if (peekKey) placePeek();
}
function changeByKey(k) { return last && last.changes.find(c => c.key === k); }
function placePeek() {
  const c = changeByKey(peekKey); if (!c) return closePeek();
  const top = PAD + (c.line - 1 + c.del) * LH - ed.scrollTop + 4, box = $('edbody').clientHeight;
  peek.style.top = Math.max(4, Math.min(top, box - peek.offsetHeight - 6)) + 'px';
}
function openPeek(k) {
  const c = changeByKey(k); if (!c) return;
  peekKey = k;
  const row = (sign, cls, t) => `<div class="pk-row ${cls}"><span class="pk-sign">${sign}</span><span class="pk-code">${esc(t) || ' '}</span></div>`;
  peek.innerHTML = `<div class="pk-head"><span class="mono small pk-sev ${c.sev}">${c.sev.toUpperCase()} · LINE ${c.line}</span><b>${esc(c.title)}</b>
      <button class="pk-x" id="pk-x" title="Close (Esc)">×</button></div>
    <div class="pk-diff mono">${diffRows(c, row)}</div>
    <p class="pk-why">${esc(c.detail)}</p>
    <p class="pk-meta mono"><span>Estimate</span>${esc(c.estimate)}</p>
    <p class="pk-meta mono"><span>Behaviour</span>${esc(c.behavior)}</p>
    <div class="pk-btns"><button class="devbtn" id="pk-accept">Accept change</button><button class="chip2" id="pk-dismiss">Dismiss</button>
      <span class="mono small">${last.changes.filter(x => !dismissed.has(x.key)).length} proposed</span></div>`;
  peek.hidden = false;
  placePeek(); paintLines();
  $('pk-x').onclick = closePeek;
  $('pk-accept').onclick = () => acceptChange(c);
  $('pk-dismiss').onclick = () => { dismissed.add(c.key); closePeek(); gutter(); paintLines(); };
}
// unchanged lines at the start/end of a change are shown as plain context, like VS Code
function diffRows(c, row) {
  const b = c.before, a = c.after; let p = 0, q = 0;
  while (p < b.length && p < a.length && b[p] === a[p]) p++;
  while (q < b.length - p && q < a.length - p && b[b.length - 1 - q] === a[a.length - 1 - q]) q++;
  return b.slice(0, p).map(t => row(' ', 'pk-ctx', t)).join('')
    + b.slice(p, b.length - q).map(t => row('−', 'pk-del', t)).join('')
    + a.slice(p, a.length - q).map(t => row('+', 'pk-add', t)).join('')
    + b.slice(b.length - q).map(t => row(' ', 'pk-ctx', t)).join('');
}
function closePeek() { peekKey = null; peek.hidden = true; paintLines(); }
function pushUndo() { undoStack.push(ed.value); if (undoStack.length > 50) undoStack.shift(); $('undo').disabled = false; }
function acceptChange(c) {
  pushUndo();
  const ls = ed.value.split('\n');
  ls.splice(c.line - 1, c.del, ...c.after);
  ed.value = ls.join('\n');
  closePeek(); analyze().then(() => {               // walk to the next proposal, like "next change" in VS Code
    const nxt = last && last.changes.find(x => !dismissed.has(x.key) && x.line >= c.line);
    $('status').textContent = `Accepted: ${c.title}.` + (nxt ? ' Next proposal shown.' : '');
    if (nxt) { scrollToLine(nxt.line); openPeek(nxt.key); }
  });
}
function scrollToLine(l) { ed.scrollTop = Math.max(0, (l - 4) * LH); gut.scrollTop = ed.scrollTop; paintLines(); }
function goto(l) {
  const ls = ed.value.split('\n'), start = ls.slice(0, l - 1).join('\n').length + (l > 1 ? 1 : 0);
  ed.focus(); ed.setSelectionRange(start, start + ls[l - 1].length); scrollToLine(l);
}
function lineAtCaret() { return ed.value.slice(0, ed.selectionStart).split('\n').length; }

async function analyze() {
  if (!ed.value.trim()) { $('status').textContent = '[WARN] editor empty'; return; }
  $('status').textContent = '[ .. ] analyzing';
  try {
    const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: ed.value, board: $('board').value, interval: +$('interval').value, capacity: +$('capacity').value }) }).then(r => r.json());
    if (r.error) throw new Error(r.error);
    last = r; hot = new Set(r.findings.filter(f => f.line).map(f => f.line));
    [...dismissed].forEach(k => { if (!r.changes.some(c => c.key === k)) dismissed.delete(k); });
    if (peekKey && !changeByKey(peekKey)) closePeek();
    gutter(); paintLines();
    $('score').textContent = r.score;
    $('score').style.color = r.score >= 80 ? '#2e7d32' : r.score >= 50 ? '#b26a00' : '#c62828';
    $('verdict').textContent = r.findings.length ? `${r.findings.length} finding${r.findings.length > 1 ? 's' : ''}` : '0 findings';
    $('dnow').textContent = days(r.now.days); $('dafter').textContent = days(r.after.days);
    $('finds').innerHTML = r.findings.map(f => `<div class="find ${f.sev}"><span class="mono small">${f.sev.toUpperCase()}${f.line ? ' · LINE ' + f.line : ''}</span><b>${esc(f.title)}</b><p>${esc(f.detail)}</p>${f.snippet ? `<code class="mono">${esc(f.snippet)}</code>` : ''}${f.change && !dismissed.has(f.change) ? `<button class="chip2" data-k="${f.change}">Show change</button>` : ''}${f.line ? `<button class="chip2" data-l="${f.line}">Go to line</button>` : ''}</div>`).join('');
    const open = r.changes.filter(c => !dismissed.has(c.key)).length;
    $('apply').disabled = !open;
    $('status').textContent = open ? `[ OK ] ${r.findings.length} findings · ${open} proposed change${open > 1 ? 's' : ''} (red lines; click one to review)` : `[ OK ] ${r.findings.length} findings`;
  } catch (e) { $('status').textContent = '[FAIL] ' + e.message; }
}
$('finds').addEventListener('click', e => {
  const k = e.target.dataset.k, l = e.target.dataset.l;
  if (k) { const c = changeByKey(k); if (c) { scrollToLine(c.line); openPeek(k); } }
  else if (l) goto(+l);
});
gut.addEventListener('click', e => { const k = e.target.dataset && e.target.dataset.k; if (k) openPeek(k); });
ed.addEventListener('click', () => {
  if (!last) return;
  const l = lineAtCaret(), c = last.changes.find(c => !dismissed.has(c.key) && l >= c.line && l < c.line + c.del);
  if (c) openPeek(c.key); else if (peekKey) closePeek();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && peekKey) closePeek(); });
$('analyze').onclick = analyze;
$('sample').onclick = () => { ed.value = SAMPLE; dismissed.clear(); gutter(); analyze(); };
$('apply').onclick = () => {
  if (!last) return;
  const cs = last.changes.filter(c => !dismissed.has(c.key)); if (!cs.length) return;
  pushUndo();
  const ls = ed.value.split('\n');
  [...cs].sort((a, b) => b.line - a.line).forEach(c => ls.splice(c.line - 1, c.del, ...c.after));
  ed.value = ls.join('\n'); closePeek(); gutter(); analyze().then(() => { $('status').textContent = `Accepted ${cs.length} change${cs.length > 1 ? 's' : ''}. Undo restores the previous code.`; });
};
$('undo').onclick = () => { if (!undoStack.length) return; ed.value = undoStack.pop(); $('undo').disabled = !undoStack.length; closePeek(); gutter(); analyze(); };
$('copy').onclick = () => navigator.clipboard.writeText(ed.value).then(() => { $('status').textContent = '[ OK ] copied'; });
$('download').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([ed.value], { type: 'text/plain' })); a.download = 'sketch.ino'; a.click(); };
$('clear').onclick = () => { ed.value = ''; hot.clear(); last = null; dismissed.clear(); closePeek(); gutter(); $('finds').innerHTML = ''; $('score').textContent = '–'; $('dnow').textContent = $('dafter').textContent = '–'; $('verdict').textContent = 'No analysis yet.'; $('apply').disabled = true; };
ed.addEventListener('input', () => { if (peekKey) closePeek(); gutter(); paintLines(); clearTimeout(timer); timer = setTimeout(analyze, 700); });
ed.addEventListener('scroll', () => { gut.scrollTop = ed.scrollTop; paintLines(); });
['board', 'interval', 'capacity'].forEach(id => $(id).addEventListener('change', analyze));
gutter();

// ---- Before / after on hardware: two recorded sessions, compared with a noise check ----
async function baSessions() {
  const opts = (sel, list, none) => { const v = $(sel).value; $(sel).innerHTML = (none ? '<option value="">—</option>' : '') + list.map(s => `<option value="${s.id}">#${s.id} ${esc(s.name || '')}${s.status === 'active' ? ' (recording)' : ''}</option>`).join(''); if (v) $(sel).value = v; };
  try {
    const d = await fetch('/backend/api/sessions?limit=50').then(r => { if (!r.ok) throw new Error('Backend not reachable.'); return r.json(); });
    const list = d.sessions.filter(s => s.status !== 'active');
    opts('ba-a', list); opts('ba-b', list); opts('ba-r', list, true);
    if (list.length >= 2 && !$('ba-a').dataset.init) { $('ba-a').value = list[1].id; $('ba-b').value = list[0].id; $('ba-a').dataset.init = '1'; }
    if (!list.length) $('ba-out').innerHTML = '<p class="mono small">No finished sessions yet. Record them in Lab → Live hardware.</p>';
  } catch (e) { $('ba-out').innerHTML = `<p class="mono small">${esc(e.message)}</p>`; }
}
async function baCompareApi(before, after, k) {
  const r = await fetch(`/backend/api/sessions/compare?before=${before}&after=${after}${k ? '&k=' + k : ''}`);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'Compare failed (' + r.status + ').');
  return d;
}
async function baCompare() {
  const a = $('ba-a').value, b = $('ba-b').value, r = $('ba-r').value, k = +($('ba-k') ? $('ba-k').value : 0) || null;
  if (!a || !b || a === b) { $('ba-out').innerHTML = '<p class="mono small">[WARN] choose two different sessions</p>'; return; }
  $('ba-out').innerHTML = '<p class="mono small">computing…</p>';
  try {
    const [d, rep] = await Promise.all([baCompareApi(a, b, k), r && r !== a ? baCompareApi(a, r) : null]);
    const A = d.before, B = d.after, cap = +$('capacity').value || 2000;
    const life = x => days(cap * 0.76 / x.average_current_ma / 24);
    const fp = v => v == null ? '–' : (v > 0 ? '+' : '') + v.toFixed(1) + ' %';
    const pct = (x, y) => (y / x - 1) * 100;
    const repDiff = rep ? Math.abs(rep.delta_power_mw) : null;
    const real = d.significant && (repDiff == null || Math.abs(d.delta_power_mw) > 3 * repDiff);
    const cls = (x, y) => y < x ? 'good' : y > x ? 'bad' : '';
    const row = (lab, x, y, fmt) => `<tr><td>${lab}</td><td>${fmt(x)}</td><td>${fmt(y)}</td><td class="${cls(x, y)}">${fp(pct(x, y))}</td></tr>`;
    const mods = d.modules ? `<p class="mono small ba-sub">PER MODULE · MODULE SEPARATION, CURRENT WHILE ON</p>
      <table class="ba-t mono"><thead><tr><th>Signature</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${d.modules.map(m => {
        const x = m.before, y = m.after, lab = x && x.in_baseline || y && y.in_baseline ? ' (always-on)' : '';
        const v = o => o ? o.current_on_ma.toFixed(2) + ' mA' : 'not found';
        return `<tr><td>${m.peak_hz.toFixed(1)} Hz${lab}</td><td>${v(x)}</td><td>${v(y)}</td><td>${m.delta_current_on_ma == null ? '–' : (m.delta_current_on_ma > 0 ? '+' : '') + m.delta_current_on_ma.toFixed(2) + ' mA'}</td></tr>`; }).join('')}</tbody></table>`
      : `<p class="mono small">${esc(d.modules_note || '')}</p>`;
    $('ba-out').innerHTML = `<table class="ba-t mono"><thead><tr><th></th><th>Before #${A.id} ${esc(A.name)}</th><th>After #${B.id} ${esc(B.name)}</th><th>Change</th></tr></thead><tbody>
      ${row('Average power', A.average_power_mw, B.average_power_mw, v => v.toFixed(1) + ' mW')}
      ${row('Average current', A.average_current_ma, B.average_current_ma, v => v.toFixed(2) + ' mA')}
      ${row('Energy per minute', A.energy_per_min_mj, B.energy_per_min_mj, v => (v / 1000).toFixed(2) + ' J')}
      <tr><td>Battery life (${cap} mAh, 76 % usable)</td><td>${life(A)}</td><td>${life(B)}</td><td></td></tr>
      <tr><td>Recorded</td><td>${A.duration_s.toFixed(0)} s · ${A.windows} × 5 s</td><td>${B.duration_s.toFixed(0)} s · ${B.windows} × 5 s</td><td></td></tr></tbody></table>
      <p class="ba-verdict ${real ? 'good' : 'warn'} mono">${real ? '[ OK ]' : '[WARN]'} ${esc(d.verdict)}${repDiff != null ? ` · repeat of before differed by ${repDiff.toFixed(1)} mW` : ''}</p>
      ${mods}
      <p class="mono small">Average power, not total energy: the sessions have different lengths. Noise = 3 × standard error of the 5 s window means.</p>`;
  } catch (e) { $('ba-out').innerHTML = `<p class="mono small">[FAIL] ${esc(e.message)}</p>`; }
}
$('ba-run').onclick = baCompare;
$('ba-refresh').onclick = baSessions;
baSessions();

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
