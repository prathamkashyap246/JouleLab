const { useState, useEffect, useRef } = React;
const f = (n, d = 2) => Number(n).toFixed(d);

const COL = ['#2dd4a8', '#7cc4ff', '#ffb454', '#6b8a82']; // Sensing, Processing, Transmit, Sleep
const USABLE = 0.76;

function Chart({ sim, base, showBase, pt }) {
  const [hv, setHv] = useState(null);
  const W = 1560, H = 420, L = 70, B = 40, T = 20, yMax = Math.max(sim.peakMa, showBase ? base.peakMa : 0) * 1.15;
  const x = t => L + (t / sim.interval) * (W - L - 20), y = v => H - B - (v / yMax) * (H - B - T);
  const trace = s => {
    let t = 0; const pts = [`${x(0)},${y(0)}`];
    s.phases.forEach(p => {
      if (p.name === 'Transmit') {
        for (let i = 0; i < 8; i++) pts.push(`${x(t + (p.dur * i) / 8)},${y(p.ma * (i % 2 ? 0.85 : 1))}`);
        pts.push(`${x(t + p.dur)},${y(p.ma * 0.9)}`);
      } else pts.push(`${x(t)},${y(p.ma)}`, `${x(t + p.dur)},${y(p.ma)}`);
      t += p.dur;
    });
    return pts.join(' ') + ` ${x(s.interval)},${y(0)}`;
  };
  const line = trace(sim), ticks = [0, .25, .5, .75, 1];
  let acc = 0; const bands = sim.phases.map((p, i) => { const r = { p, i, a: acc }; acc += p.dur; return r; });
  const move = e => { // inspect: find the phase under the cursor
    const r = e.currentTarget.getBoundingClientRect(), px = ((e.clientX - r.left) / r.width) * W;
    const tt = Math.min(Math.max(((px - L) / (W - L - 20)) * sim.interval, 0), sim.interval);
    let a = 0, ph = sim.phases[sim.phases.length - 1];
    for (const p of sim.phases) { if (tt <= a + p.dur) { ph = p; break; } a += p.dur; }
    setHv({ t: tt, ph });
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" onMouseMove={move} onMouseLeave={() => setHv(null)}>
      <defs><filter id="glow"><feGaussianBlur stdDeviation="4" /></filter></defs>
      {bands.map(({ p, i, a }) => <rect key={p.name} x={x(a)} y={T} width={Math.max(x(a + p.dur) - x(a), 2)} height={H - B - T} fill={COL[i]} opacity=".14" />)}
      {ticks.map(k => <g key={k}>
        <line x1={L} x2={W - 20} y1={y(yMax * k)} y2={y(yMax * k)} stroke="rgba(255,255,255,.13)" strokeDasharray="5 6" />
        <text x={L - 14} y={y(yMax * k) + 5} textAnchor="end" className="tick">{Math.round(yMax * k)}</text>
        <text x={x(sim.interval * k)} y={H - 8} textAnchor="middle" className="tick">{f(sim.interval * k, 1)}s</text></g>)}
      <polygon points={`${x(0)},${y(0)} ${line}`} fill="#2dd4a8" opacity=".12" />
      {showBase && <polyline points={trace(base)} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2.5" strokeDasharray="8 7" />}
      <polyline points={line} fill="none" stroke="#2dd4a8" strokeWidth="10" opacity=".35" filter="url(#glow)" />
      <polyline points={line} fill="none" stroke="#5ff0c8" strokeWidth="3.5" strokeLinejoin="round" />
      {pt != null && <line x1={x(pt)} x2={x(pt)} y1={T} y2={H - B} stroke="#ffb454" strokeWidth="2.5" />}
      {hv && <g>
        <line x1={x(hv.t)} x2={x(hv.t)} y1={T} y2={H - B} stroke="#d8efe7" strokeDasharray="4 4" />
        <circle cx={x(hv.t)} cy={y(hv.ph.ma)} r="7" fill="#5ff0c8" />
        <text x={x(hv.t) + (x(hv.t) > W * 0.6 ? -16 : 16)} y={T + 26} textAnchor={x(hv.t) > W * 0.6 ? 'end' : 'start'} className="tick" style={{ fill: '#d8efe7', fontSize: 18 }}>
          {hv.ph.name} · {f(hv.ph.ma, 1)} mA · {f(hv.t, 2)} s</text></g>}
    </svg>
  );
}

function MeasChart({ m }) {
  const W = 1560, H = 320, mx = (m.peak * 1.1) || 1, t0 = m.pts[0][0];
  const pts = m.pts.map(p => `${40 + ((p[0] - t0) / m.dur) * (W - 60)},${H - 30 - (p[1] / mx) * (H - 50)}`).join(' ');
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart"><polyline points={pts} fill="none" stroke="#5ff0c8" strokeWidth="3" strokeLinejoin="round" /></svg>;
}

function readCsv(file, set) { // time_s,current_mA rows; header and bad rows are skipped
  if (!file) return;
  file.text().then(txt => {
    const pts = txt.split(/\r?\n/).map(l => l.split(',').map(Number)).filter(r => r.length >= 2 && isFinite(r[0]) && isFinite(r[1]));
    if (pts.length < 2 || pts[pts.length - 1][0] <= pts[0][0]) return set({ err: 'No usable time_s,current_mA rows found.' });
    let q = 0, peak = 0;
    for (let i = 1; i < pts.length; i++) q += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
    pts.forEach(p => { if (p[1] > peak) peak = p[1]; });
    const dur = pts[pts.length - 1][0] - pts[0][0];
    set({ pts, dur, avg: q / dur, peak });
  });
}

// ---- Live hardware: STM32 NUCLEO-F446RE + INA219 through the FastAPI backend (/backend proxy) ----
const API = '/backend/api';
const STATE_TEXT = { disconnected: 'Not connected', waiting_for_data: 'Port open · waiting for data', streaming: 'Streaming',
  stalled: 'Data stopped', reconnecting: 'Board disconnected · reconnecting', error: 'Error' };
async function api(path, opts) {
  const r = await fetch(API + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : r.status === 502 ? 'Backend not reachable.' : 'Request failed (' + r.status + ').');
  return d;
}
const post = (path, body) => api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

function LiveChart({ samples, metric, windowS }) {
  const W = 1560, H = 340, L = 70, R = 20, T = 16, B = 36;
  if (!samples.length) return <svg viewBox={`0 0 ${W} ${H}`} className="chart"><text x={W / 2} y={H / 2} textAnchor="middle" className="tick">Waiting for measurements…</text></svg>;
  const key = metric === 'power' ? 'power_mw' : 'current_ma', unit = metric === 'power' ? 'mW' : 'mA';
  const tEnd = samples[samples.length - 1].t_us, tStart = tEnd - windowS * 1e6;
  const vis = samples.filter(s => s.t_us >= tStart);
  let lo = Math.min(0, ...vis.map(s => s[key])), hi = Math.max(...vis.map(s => s[key]));
  if (hi - lo < 1e-6) hi = lo + 1; hi += (hi - lo) * 0.12;
  const x = t => L + ((t - tStart) / (windowS * 1e6)) * (W - L - R), y = v => H - B - ((v - lo) / (hi - lo)) * (H - B - T);
  const segs = []; let cur = [];
  vis.forEach((s, i) => { if (i && s.index !== vis[i - 1].index + 1 && s.t_us - vis[i - 1].t_us > 3 * (vis[1] ? vis[1].t_us - vis[0].t_us : 1e6)) { segs.push(cur); cur = []; } cur.push(`${x(s.t_us).toFixed(1)},${y(s[key]).toFixed(1)}`); });
  segs.push(cur);
  const ticks = [0, .25, .5, .75, 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <defs><filter id="lglow"><feGaussianBlur stdDeviation="4" /></filter></defs>
      {ticks.map(k => <g key={k}>
        <line x1={L} x2={W - R} y1={y(lo + (hi - lo) * k)} y2={y(lo + (hi - lo) * k)} stroke="rgba(255,255,255,.13)" strokeDasharray="5 6" />
        <text x={L - 14} y={y(lo + (hi - lo) * k) + 5} textAnchor="end" className="tick">{f(lo + (hi - lo) * k, hi - lo < 10 ? 2 : 0)}</text>
        <text x={L + k * (W - L - R)} y={H - 8} textAnchor="middle" className="tick">{k === 1 ? 'now' : '-' + f(windowS * (1 - k), 1) + 's'}</text></g>)}
      <text x={L + 6} y={T + 14} className="tick">{unit}</text>
      {segs.filter(sg => sg.length > 1).map((sg, i) => <g key={i}>
        <polyline points={sg.join(' ')} fill="none" stroke="#2dd4a8" strokeWidth="8" opacity=".3" filter="url(#lglow)" />
        <polyline points={sg.join(' ')} fill="none" stroke="#5ff0c8" strokeWidth="2.5" strokeLinejoin="round" /></g>)}
    </svg>);
}

function LiveHardware({ capacity }) {
  const [status, setStatus] = useState(null), [ports, setPorts] = useState([]), [port, setPort] = useState(''), [manual, setManual] = useState('');
  const [baud, setBaud] = useState(115200), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [wsUp, setWsUp] = useState(false);
  const [metric, setMetric] = useState('current'), [windowS, setWindowS] = useState(10), [, setTick] = useState(0);
  const [summary, setSummary] = useState(null), [sessions, setSessions] = useState([]), [sessName, setSessName] = useState(''), [fullRate, setFullRate] = useState(false), [events, setEvents] = useState([]);
  const buf = useRef([]);

  const loadPorts = () => api('/hardware/ports').then(d => { setPorts(d.ports); setPort(p => p || (d.ports.find(x => x.is_stlink) || d.ports[0] || {}).device || ''); }).catch(e => setErr(e.message));
  const loadSessions = () => api('/sessions?limit=6').then(d => setSessions(d.sessions)).catch(() => {});
  useEffect(() => {
    loadPorts(); loadSessions();
    let ws, retry, stop = false;
    const add = list => { if (!list || !list.length) return; const b = buf.current; b.push(...list); const cut = b[b.length - 1].t_us - 60e6; let i = 0; while (i < b.length && b[i].t_us < cut) i++; if (i) b.splice(0, i); };
    const connect = () => {
      ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/backend/ws/live-data');
      ws.onopen = () => setWsUp(true);
      ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.type === 'snapshot') { buf.current = []; add(m.samples); }
        if (m.type === 'live') { add(m.samples); if (m.events && m.events.length) setEvents(ev => [...m.events.filter(x => x.type !== 'function_window').reverse(), ...ev].slice(0, 8)); }
        if (m.status) setStatus(m.status);
        setTick(t => t + 1);
      };
      ws.onclose = () => { setWsUp(false); if (!stop) retry = setTimeout(connect, 2000); };
      ws.onerror = () => ws.close();
    };
    connect();
    const poll = setInterval(() => api('/measurements/summary').then(setSummary).catch(() => {}), 1000);
    return () => { stop = true; clearTimeout(retry); clearInterval(poll); ws && ws.close(); };
  }, []);

  const run = fn => async () => { setBusy(true); setErr(''); try { const s = await fn(); if (s && s.state) setStatus(s); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  const doConnect = run(() => { buf.current = []; return post('/hardware/connect', { port: manual.trim() || port || 'auto', baudrate: +baud }); });
  const doDisconnect = run(async () => { const s = await post('/hardware/disconnect'); loadSessions(); return s; });
  const startSession = run(async () => { await post('/sessions/start', { name: sessName, full_rate: fullRate }); setSessName(''); loadSessions(); return api('/hardware/status'); });
  const stopSession = run(async () => { await post('/sessions/stop'); loadSessions(); return api('/hardware/status'); });

  const st = status || { state: wsUp ? 'disconnected' : 'offline' };
  const open = st.port && !['disconnected', 'error'].includes(st.state);
  const last = buf.current[buf.current.length - 1];
  const live = st.connected && last;
  const test = st.test_source;
  const win = buf.current.filter(s => last && s.t_us >= last.t_us - windowS * 1e6);
  const avgMa = win.length ? win.reduce((a, s) => a + s.current_ma, 0) / win.length : null;
  const dot = st.state === 'streaming' ? 'ok' : ['error', 'reconnecting', 'stalled', 'offline'].includes(st.state) ? 'bad' : '';
  const fns = (summary && summary.functions) || [];

  return <div className="import hw">
    <div className="hw-top">
      <span className={'mono small live-status ' + dot}><i />{wsUp ? (STATE_TEXT[st.state] || st.state) : 'Backend offline'}{st.port ? ' · ' + st.port : ''}</span>
      {test && <span className="mono hw-test">TEST DATA · NOT FROM HARDWARE</span>}
      {st.source === 'hardware' && st.connected && <span className="mono hw-real">REAL INA219 DATA</span>}
    </div>
    {!wsUp && <p className="mono note">The FastAPI backend is not reachable. In backend/ run <code>uvicorn app.main:app --reload --host 0.0.0.0 --port 8000</code>; this view reconnects automatically.</p>}

    <div className="hw-controls">
      <label><span className="mono small">SERIAL PORT</span>
        <select value={port} onChange={e => setPort(e.target.value)} disabled={open || busy}>
          {!ports.length && <option value="">No ports found</option>}
          {ports.map(p => <option key={p.device} value={p.device}>{p.label}</option>)}
        </select></label>
      <label><span className="mono small">OR TYPE A PORT</span><input value={manual} onChange={e => setManual(e.target.value)} placeholder="COM5 · /dev/cu.usbmodem1103" disabled={open || busy} /></label>
      <label><span className="mono small">BAUD</span>
        <select value={baud} onChange={e => setBaud(e.target.value)} disabled={open || busy}>{[115200, 230400, 460800, 921600, 57600].map(b => <option key={b}>{b}</option>)}</select></label>
      <div className="btns">
        <button className="chip2" onClick={loadPorts} disabled={open || busy}>Refresh ports</button>
        {!open ? <button className="runbtn hw-btn" onClick={doConnect} disabled={busy || !wsUp}>Connect <span>⏻</span></button>
          : <button className="runbtn hw-btn hw-off" onClick={doDisconnect} disabled={busy}>Disconnect <span>■</span></button>}
      </div>
    </div>
    <p className="mono small hw-msg">{st.message}</p>
    {err && <div className="find high"><span className="mono small">CONNECTION</span><b>{err}</b></div>}
    {['reconnecting', 'stalled', 'error'].includes(st.state) && !err && <div className="find high"><span className="mono small">{st.state.toUpperCase()}</span><b>{st.state === 'reconnecting' ? 'The STM32 is disconnected.' : st.state === 'stalled' ? 'No data from the STM32.' : 'Hardware error.'}</b><p>{st.message}</p></div>}
    {(st.device_errors || []).length > 0 && st.port && <div className="find medium"><span className="mono small">BOARD REPORTS</span><b>{st.device_errors[st.device_errors.length - 1].message}</b><p>Detail {st.device_errors[st.device_errors.length - 1].detail}</p></div>}

    <div className={'stats four' + (live ? '' : ' dim')}>
      <div><p className="mono small">VOLTAGE</p><b>{live ? f(last.voltage_v, 3) : '–'}<small> V</small></b></div>
      <div><p className="mono small">CURRENT</p><b>{live ? f(last.current_ma, 2) : '–'}<small> mA</small></b></div>
      <div><p className="mono small">POWER</p><b>{live ? f(last.power_mw, 1) : '–'}<small> mW</small></b></div>
      <div><p className="mono small">ENERGY · {(st.energy_scope || 'connection').toUpperCase()}</p><b>{st.port && st.energy_mj != null ? f(st.energy_mj, st.energy_mj < 100 ? 3 : 1) : '–'}<small> mJ</small></b></div>
    </div>

    <div className="row tools"><span className="mono small">{live ? `${st.sample_rate_hz || '–'} Hz · ${win.length} samples in view` : 'Graph shows only received measurements; gaps stay empty'}</span>
      <div className="btns">
        {[['current', 'Current'], ['power', 'Power']].map(([k, l]) => <button key={k} className={'chip2 ' + (metric === k ? 'on' : '')} onClick={() => setMetric(k)}>{l}</button>)}
        {[5, 10, 30].map(s => <button key={s} className={'chip2 ' + (windowS === s ? 'on' : '')} onClick={() => setWindowS(s)}>{s} s</button>)}
      </div></div>
    <div className={'scope' + (test ? ' scope-test' : '')}><LiveChart samples={st.port ? buf.current : []} metric={metric} windowS={windowS} /></div>

    <div className="hw-counters mono">
      <span>PACKETS <b>{st.packet_count ?? 0}</b></span>
      <span className={st.packet_errors ? 'warn' : ''}>PACKET ERRORS <b>{st.packet_errors ?? 0}</b></span>
      <span className={st.lost_samples ? 'warn' : ''}>LOST SAMPLES <b>{st.lost_samples ?? 0}</b></span>
      <span>DUPLICATES <b>{st.duplicate_samples ?? 0}</b></span>
      <span>BYTES SKIPPED <b>{st.bytes_discarded ?? 0}</b></span>
      <span>LAST DATA <b>{st.last_data_age_s != null ? f(st.last_data_age_s, 1) + ' s' : '–'}</b></span>
      {avgMa != null && live && <span>RUNTIME @ {capacity.toLocaleString()} mAh <b>{avgMa > 0 ? f((capacity * USABLE) / avgMa / 24, 1) + ' d' : '–'}</b></span>}
    </div>

    <div className="hw-grid">
      <div>
        <div className="row"><h3>Energy by function</h3><span className="mono small">{summary ? (summary.scope === 'session' ? 'This session' : 'Since connect') : ''}</span></div>
        {!fns.length ? <p className="mono small">No function windows yet. The firmware's JL_FUNCTION_START/END markers or GPIO edges on A0/A1 appear here.</p> :
          <table className="hw-table mono"><thead><tr><th>Function</th><th>Timing</th><th>Calls</th><th>Avg time</th><th>Energy/call</th><th>Avg P</th><th>Max P</th><th title="Energy per call minus what the idle baseline would use in the same time">Above idle</th></tr></thead>
            <tbody>{fns.map(x => <tr key={x.function_name + x.source}><td>{x.function_name}</td>
              <td><span className={'src ' + x.source}>{x.source === 'gpio' ? 'GPIO-timed' : 'Firmware marker'}</span></td>
              <td>{x.complete_calls}{x.incomplete_calls ? <em title="windows with lost samples are not integrated"> +{x.incomplete_calls}✕</em> : ''}</td>
              <td>{x.avg_duration_ms != null ? f(x.avg_duration_ms, 2) + ' ms' : '–'}</td>
              <td>{x.energy_per_call_mJ != null ? f(x.energy_per_call_mJ, 4) + ' mJ' : '–'}</td>
              <td>{x.average_power_mW != null ? f(x.average_power_mW, 1) + ' mW' : '–'}</td>
              <td>{f(x.max_power_mW, 1)} mW</td>
              <td>{x.above_baseline_per_call_mJ != null ? f(x.above_baseline_per_call_mJ, 4) + ' mJ' : '–'}</td></tr>)}</tbody></table>}
        {summary && summary.baseline && <p className="mono small hw-msg">Idle baseline: {summary.baseline.function} at {f(summary.baseline.power_mW, 2)} mW. When the INA219 measures the STM32 itself, this floor includes the measurement firmware's own timer, I2C and UART work; "Above idle" removes it.</p>}
      </div>
      <aside className="hw-side">
        <div className="row"><h3>Session</h3>{st.session && <span className="mono small rec">● REC</span>}</div>
        {st.session ? <><p className="mono small">{st.session.name}</p><button className="chip2" onClick={stopSession} disabled={busy}>Stop &amp; save</button></>
          : <><input value={sessName} onChange={e => setSessName(e.target.value)} placeholder="Session name (optional)" disabled={!st.connected} />
            <label className="mono small hw-check" title="Store every sample instead of 1-in-10 averages. Needed for Module separation on the recording; about 10x the disk space."><input type="checkbox" checked={fullRate} onChange={e => setFullRate(e.target.checked)} /> Full rate (for module separation)</label>
            <button className="chip2" onClick={startSession} disabled={busy || !st.connected}>Start session</button>
            {!st.connected && <p className="mono small">Sessions need live data.</p>}</>}
        <ul className="hw-sessions mono">{sessions.map(s => <li key={s.id}><span>#{s.id} {s.name}</span><span>{s.status === 'active' ? 'recording' : s.energy_mj != null ? f(s.energy_mj, 2) + ' mJ' : s.status}{s.source === 'test' ? ' · TEST' : ''}</span></li>)}</ul>
        {events.length > 0 && <><div className="row"><h3>Events</h3></div>
          <ul className="hw-events mono">{events.map((e, i) => <li key={i}>{e.type === 'loss' ? `${e.lost} sample(s) lost` : e.type === 'resync' ? 'Resync: ' + e.reason : e.type === 'device_status' ? e.message : e.type === 'hello' ? (e.ok ? (e.test_source ? 'HELLO from TEST source' : 'HELLO from JouleLab firmware') : 'Unknown firmware protocol') : e.message || e.type}</li>)}</ul></>}
      </aside>
    </div>
  </div>;
}

// ---- Module separation: spectrogram + NMF on one current trace (backend /api/analysis/separate) ----
const SEP_COL = ['#2dd4a8', '#7cc4ff', '#ffb454', '#f07ab0', '#b59cff', '#e8e36b', '#9fb8b0', '#ff8a6b'];
const sepName = c => c.module || 'Module ' + (c.id + 1);
const sepLabel = (c, sc) => !c.low_freq ? sepName(c) : sc && sc.on_off_accuracy > 0.8 ? sepName(c) + ' (low-freq)' : sc ? 'Step / switching' : 'Low-frequency / step';

function heatColor(v) { // v in 0..1 → dark teal → accent → mint → pale yellow
  const stops = [[12, 29, 25], [26, 107, 95], [45, 212, 168], [246, 247, 192]];
  const x = Math.min(Math.max(v, 0), 1) * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), t = x - i;
  return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
}

function SpecChart({ spec, duration }) {
  const url = React.useMemo(() => {
    const c = document.createElement('canvas'); c.width = spec.cols; c.height = spec.rows;
    const g = c.getContext('2d'), img = g.createImageData(spec.cols, spec.rows);
    for (let r = 0; r < spec.rows; r++) for (let col = 0; col < spec.cols; col++) {
      const [R, G, B] = heatColor((spec.db[r][col] + 60) / 60), o = ((spec.rows - 1 - r) * spec.cols + col) * 4; // high freq on top
      img.data[o] = R; img.data[o + 1] = G; img.data[o + 2] = B; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0); return c.toDataURL();
  }, [spec]);
  const W = 1560, H = 360, L = 70, R = 20, T = 10, B = 36, fticks = [0, .25, .5, .75, 1], tticks = [0, .25, .5, .75, 1];
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart">
    <image href={url} x={L} y={T} width={W - L - R} height={H - T - B} preserveAspectRatio="none" style={{ imageRendering: 'pixelated' }} />
    {fticks.map(k => <text key={'f' + k} x={L - 12} y={T + (1 - k) * (H - T - B) + 5} textAnchor="end" className="tick">{f(k * spec.f_max, 0)}</text>)}
    {tticks.map(k => <text key={'t' + k} x={L + k * (W - L - R)} y={H - 8} textAnchor="middle" className="tick">{f(k * duration, 0)}s</text>)}
    <text x={L + 8} y={T + 18} className="tick" fill="#f6f7c0">Hz</text>
  </svg>;
}

function SigChart({ comps, fMax }) {
  const W = 1560, H = 300, L = 70, R = 20, T = 14, B = 36, lane = (H - T - B) / comps.length;
  const x = fr => L + (fr / fMax) * (W - L - R);
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart">
    {[0, .25, .5, .75, 1].map(k => <text key={k} x={L + k * (W - L - R)} y={H - 8} textAnchor="middle" className="tick">{f(k * fMax, 0)} Hz</text>)}
    {comps.map((c, i) => {
      const y0 = T + (i + 1) * lane - 4, pts = c.signature.f.map((fr, j) => `${x(fr).toFixed(1)},${(y0 - c.signature.y[j] * (lane - 10)).toFixed(1)}`).join(' ');
      return <g key={c.id}>
        <line x1={L} x2={W - R} y1={y0} y2={y0} stroke="rgba(255,255,255,.12)" />
        <polyline points={pts} fill="none" stroke={SEP_COL[i % SEP_COL.length]} strokeWidth="2.5" strokeLinejoin="round" />
        <text x={x(c.peak_hz) + 8} y={y0 - lane + 22} className="tick" fill={SEP_COL[i % SEP_COL.length]}>{sepName(c)} · {f(c.peak_hz, 0)} Hz</text>
      </g>;
    })}
  </svg>;
}

function SepTimeline({ res }) {
  const comps = res.components, W = 1560, L = 70, R = 20, T = 14, TR = 170, laneH = 38, H = T + TR + 24 + comps.length * laneH + 34, dur = res.duration_s;
  const x = t => L + (t / dur) * (W - L - R);
  const tr = res.trace, lo = Math.min(...tr.ma), hi = Math.max(...tr.ma) + 1e-6, y = v => T + TR - ((v - lo) / (hi - lo)) * TR;
  const pts = tr.t.map((t, i) => `${x(t).toFixed(1)},${y(tr.ma[i]).toFixed(1)}`).join(' ');
  const dt = res.times.length > 1 ? res.times[1] - res.times[0] : 0.1;
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart">
    <text x={L - 12} y={T + 12} textAnchor="end" className="tick">{f(hi, 0)}</text>
    <text x={L - 12} y={T + TR} textAnchor="end" className="tick">{f(lo, 0)}</text>
    <text x={L + 8} y={T + 14} className="tick">total mA</text>
    <polyline points={pts} fill="none" stroke="#5ff0c8" strokeWidth="1.6" opacity=".85" />
    {comps.map((c, i) => {
      const y0 = T + TR + 24 + i * laneH, col = SEP_COL[i % SEP_COL.length], segs = []; let s = null;
      c.on.forEach((v, j) => { if (v && s === null) s = j; if ((!v || j === c.on.length - 1) && s !== null) { segs.push([s, v ? j : j - 1]); s = null; } });
      return <g key={c.id}>
        <rect x={L} y={y0} width={W - L - R} height={laneH - 10} fill="rgba(255,255,255,.04)" rx="4" />
        {segs.map(([a, b], k) => <rect key={k} x={x(Math.max(res.times[a] - dt / 2, 0))} y={y0} width={Math.max(x(res.times[b] + dt / 2) - x(res.times[a] - dt / 2), 2)} height={laneH - 10} fill={col} opacity=".75" rx="3" />)}
        <text x={L - 12} y={y0 + laneH / 2} textAnchor="end" className="tick" fill={col}>{sepName(c).replace('Module ', 'M')}</text>
      </g>;
    })}
    {[0, .25, .5, .75, 1].map(k => <text key={k} x={L + k * (W - L - R)} y={H - 8} textAnchor="middle" className="tick">{f(k * dur, 0)}s</text>)}
  </svg>;
}

function KCurve({ curve, k }) {
  const ks = Object.keys(curve).map(Number), vals = ks.map(n => curve[n]);
  if (ks.length < 2) return null;
  const W = 520, H = 220, L = 50, R = 16, T = 14, B = 34, hi = Math.max(...vals), lo = Math.min(...vals);
  const x = n => L + ((n - ks[0]) / (ks[ks.length - 1] - ks[0])) * (W - L - R), y = v => T + (1 - (v - lo) / (hi - lo + 1e-9)) * (H - T - B);
  return <svg viewBox={`0 0 ${W} ${H}`} className="chart">
    <line x1={x(k)} x2={x(k)} y1={T} y2={H - B} stroke="#ffb454" strokeDasharray="5 5" />
    <polyline points={ks.map(n => `${x(n)},${y(curve[n])}`).join(' ')} fill="none" stroke="#5ff0c8" strokeWidth="2.5" />
    {ks.map(n => <g key={n}><circle cx={x(n)} cy={y(curve[n])} r={n === k ? 7 : 4} fill={n === k ? '#ffb454' : '#5ff0c8'} />
      <text x={x(n)} y={H - 10} textAnchor="middle" className="tick">{n}</text></g>)}
  </svg>;
}

const VR_PRESETS = {
  'Demo board (3 modules)': [{ name: 'LED A', type: 'pwm', freq_hz: 37, current_ma: 10, duty: 0.5 }, { name: 'LED B', type: 'pwm', freq_hz: 173, current_ma: 20, duty: 0.5 },
    { name: 'BLE', type: 'pulse', freq_hz: 10, current_ma: 70, width_ms: 3 }],
  'Four mixed modules': [{ name: 'Fan PWM', type: 'pwm', freq_hz: 31, current_ma: 10, duty: 0.5 }, { name: 'Buzzer', type: 'pwm', freq_hz: 79, current_ma: 15, duty: 0.5 },
    { name: 'Motor', type: 'sine', freq_hz: 143, current_ma: 12 }, { name: 'Radio', type: 'pulse', freq_hz: 5, current_ma: 60, width_ms: 4 }],
  'Six tones': [23, 41, 67, 89, 131, 197].map((fr, i) => ({ name: 'Tone ' + (i + 1), type: 'sine', freq_hz: fr, current_ma: 8 })),
  'Stress: frequencies 3 Hz apart': [{ name: 'Module 1', type: 'pwm', freq_hz: 60, current_ma: 10, duty: 0.5 }, { name: 'Module 2', type: 'pwm', freq_hz: 63, current_ma: 10, duty: 0.5 }],
  'Stress: step load (no frequency)': [{ name: 'LED', type: 'pwm', freq_hz: 37, current_ma: 10, duty: 0.5 }, { name: 'Heater', type: 'step', freq_hz: 1, current_ma: 30 }],
  'Stress: above Nyquist': [{ name: 'Slow', type: 'pwm', freq_hz: 37, current_ma: 10, duty: 0.5 }, { name: 'Too fast', type: 'sine', freq_hz: 310, current_ma: 15 }]
};
const VR_TYPES = { pwm: 'PWM (square)', sine: 'Sine', pulse: 'Pulse train', step: 'Step (no frequency)' };

function VirtualRoom({ mods, setMods, noise, setNoise, period, setPeriod, busy }) {
  const upd = (i, k, v) => setMods(m => m.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const nyq = 1e6 / period / 2;
  return <div className="vr">
    <div className="row"><h3>Virtual room</h3>
      <select value="" onChange={e => e.target.value && setMods(VR_PRESETS[e.target.value].map(x => ({ ...x })))} disabled={busy}>
        <option value="">Load a scenario…</option>{Object.keys(VR_PRESETS).map(k => <option key={k}>{k}</option>)}</select></div>
    <p className="mono small">Design the modules on a virtual board. Each one switches on and off at random, overlapping the others, and the trace goes through the same INA219 model as the hardware (532 µs averaging, noise, 0.1 mA steps). The separation never sees this table; it only scores against it.</p>
    <table className="hw-table mono vr-table"><thead><tr><th>Name</th><th>Waveform</th><th>Frequency</th><th>Current</th><th>Shape</th><th /></tr></thead>
      <tbody>{mods.map((m, i) => <tr key={i}>
        <td><i className="sep-dot" style={{ background: SEP_COL[i % SEP_COL.length] }} /><input value={m.name} onChange={e => upd(i, 'name', e.target.value)} disabled={busy} /></td>
        <td><select value={m.type} onChange={e => upd(i, 'type', e.target.value)} disabled={busy}>{Object.entries(VR_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></td>
        <td>{m.type === 'step' ? '–' : <><input type="number" min="0.5" max="2000" step="0.5" value={m.freq_hz} onChange={e => upd(i, 'freq_hz', +e.target.value)} disabled={busy} /> Hz
          {m.freq_hz > nyq && <em title="above half the sample rate: it will alias"> alias!</em>}</>}</td>
        <td><input type="number" min="0.1" max="500" step="0.1" value={m.current_ma} onChange={e => upd(i, 'current_ma', +e.target.value)} disabled={busy} /> mA</td>
        <td>{m.type === 'pwm' ? <><input type="number" min="0.05" max="0.95" step="0.05" value={m.duty ?? 0.5} onChange={e => upd(i, 'duty', +e.target.value)} disabled={busy} /> duty</>
          : m.type === 'pulse' ? <><input type="number" min="0.5" max="100" step="0.5" value={m.width_ms ?? 3} onChange={e => upd(i, 'width_ms', +e.target.value)} disabled={busy} /> ms wide</> : '–'}</td>
        <td><button className="chip2" onClick={() => setMods(ms => ms.filter((_, j) => j !== i))} disabled={busy || mods.length < 2}>✕</button></td></tr>)}</tbody></table>
    <div className="hw-controls vr-controls">
      <button className="chip2" onClick={() => setMods(ms => [...ms, { name: 'Module ' + (ms.length + 1), type: 'sine', freq_hz: 50 + 30 * ms.length + 7, current_ma: 10 }])} disabled={busy || mods.length >= 8}>+ Add module</button>
      <label><span className="mono small">SENSOR NOISE (mA RMS)</span><input type="number" min="0" max="20" step="0.05" value={noise} onChange={e => setNoise(e.target.value)} disabled={busy} /></label>
      <label><span className="mono small">SAMPLE RATE</span><select value={period} onChange={e => setPeriod(+e.target.value)} disabled={busy}>
        <option value={2000}>500 Hz · team firmware</option><option value={1000}>1 kHz</option><option value={532}>1.88 kHz · profiler.ino</option></select></label>
      <span className="mono small">Nyquist limit: {f(nyq, 0)} Hz</span>
    </div>
  </div>;
}

function Separation({ capacity }) {
  const [mode, setMode] = useState('simulated'), [seconds, setSeconds] = useState(60), [seed, setSeed] = useState(0), [kSel, setKSel] = useState('auto');
  const [logText, setLogText] = useState(''), [fileName, setFileName] = useState(''), [busy, setBusy] = useState(false), [err, setErr] = useState(''), [res, setRes] = useState(null);
  const [mods, setMods] = useState(VR_PRESETS['Demo board (3 modules)'].map(x => ({ ...x }))), [noise, setNoise] = useState(0.25), [period, setPeriod] = useState(2000);
  const loadFile = file => { if (!file) return; setFileName(file.name); file.text().then(setLogText); };
  const [sessList, setSessList] = useState([]), [sessionId, setSessionId] = useState('');
  useEffect(() => { if (mode === 'session') api('/sessions?limit=50').then(d => { setSessList(d.sessions); if (!sessionId && d.sessions[0]) setSessionId(String(d.sessions[0].id)); }).catch(e => setErr(e.message)); }, [mode]);
  const run = async () => {
    setBusy(true); setErr('');
    try {
      setRes(await post('/analysis/separate', { source: mode, seconds: mode === 'virtual' ? Math.min(+seconds, 120) : +seconds, seed: +seed, k: kSel === 'auto' ? null : +kSel,
        log_text: mode === 'log' ? logText : null, capacity_mah: capacity, modules: mode === 'virtual' ? mods : [],
        noise_ma: +noise, sample_period_us: mode === 'virtual' ? period : 2000, session_id: mode === 'session' ? +sessionId : null }));
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const comps = res ? res.components : [], hasScore = res && res.scoring;
  const scoreOf = id => hasScore && res.scoring.find(s => s.id === id);
  return <div className="import hw sep">
    <p>One current trace, several modules. JouleLab turns the trace into a spectrogram, and NMF splits it into spectral signatures and their on/off activity without being told which module is which. State bits, when logged, are used only to score the result.</p>
    <div className="hw-controls">
      <label><span className="mono small">DATA</span>
        <select value={mode} onChange={e => setMode(e.target.value)} disabled={busy}>
          <option value="simulated">Simulated demo (no hardware)</option><option value="virtual">Virtual room (design your own signals)</option><option value="live">Live buffer from the board</option><option value="log">Upload a log file</option><option value="session">Recorded session (full rate)</option></select></label>
      {mode === 'session' && <label><span className="mono small">SESSION</span><select value={sessionId} onChange={e => setSessionId(e.target.value)} disabled={busy}>
        {!sessList.length && <option value="">No sessions yet</option>}
        {sessList.map(x => <option key={x.id} value={x.id}>#{x.id} {x.name}{x.source === 'test' ? ' · TEST' : ''}</option>)}</select></label>}
      {mode !== 'log' && mode !== 'session' && <label><span className="mono small">{mode === 'live' ? 'LAST SECONDS' : 'RUN LENGTH (S)'}</span><input type="number" min="10" max="600" value={seconds} onChange={e => setSeconds(e.target.value)} disabled={busy} /></label>}
      {(mode === 'simulated' || mode === 'virtual') && <label><span className="mono small">SEED</span><input type="number" min="0" max="9999" value={seed} onChange={e => setSeed(e.target.value)} disabled={busy} /></label>}
      {mode === 'log' && <label><span className="mono small">LOG FILE (.TXT / .CSV)</span><input type="file" accept=".txt,.csv,.log" onChange={e => loadFile(e.target.files[0])} disabled={busy} /></label>}
      <label><span className="mono small">MODULES (K)</span>
        <select value={kSel} onChange={e => setKSel(e.target.value)} disabled={busy}>{['auto', 1, 2, 3, 4, 5, 6].map(k => <option key={k} value={k}>{k === 'auto' ? 'Detect automatically' : k}</option>)}</select></label>
      <div className="btns"><button className="runbtn hw-btn" onClick={run} disabled={busy || (mode === 'log' && !logText)}>{busy ? 'Separating…' : 'Separate'} <span>▶</span></button></div>
    </div>
    {mode === 'virtual' && <VirtualRoom mods={mods} setMods={setMods} noise={noise} setNoise={setNoise} period={period} setPeriod={setPeriod} busy={busy} />}
    {mode === 'log' && fileName && <p className="mono small hw-msg">{fileName} · {(logText.length / 1e6).toFixed(2)} MB loaded</p>}
    {err && <div className="find high"><span className="mono small">SEPARATION</span><b>{err}</b></div>}

    {res && <>
      <div className="hw-top">
        {res.simulated ? <span className="mono hw-test">SIMULATED DATA · NOT FROM HARDWARE</span> : <span className="mono hw-real">{res.source === 'live' ? 'REAL INA219 DATA' : 'IMPORTED LOG'}</span>}
        <span className="mono small">{f(res.duration_s, 1)} s · {f(res.fs_hz, 0)} Hz sampling · {res.samples.toLocaleString()} samples · Vbus {f(res.vbus_v, 2)} V</span>
      </div>
      <div className="stats four">
        <div><p className="mono small">MODULES FOUND{res.k_auto ? ' · AUTO' : ''}</p><b>{res.k}</b></div>
        <div><p className="mono small">UNEXPLAINED SPECTRUM</p><b>{f(res.unexplained * 100, 1)}<small> %</small></b></div>
        <div><p className="mono small">BASELINE</p><b>{f(res.baseline_ma, 1)}<small> mA</small></b></div>
        <div><p className="mono small">RUNTIME @ {capacity.toLocaleString()} mAh</p><b>{res.days_total != null ? f(res.days_total, 1) : '–'}<small> days</small></b></div>
      </div>

      <div className="row"><h3>Spectrogram of the total current</h3><span className="mono small">bright horizontal bands = modules running at their own frequency</span></div>
      <div className="scope"><SpecChart spec={res.spectrogram} duration={res.duration_s} /></div>

      <div className="row sep-gap"><h3>Signatures found (no labels)</h3><span className="mono small">harmonics show up as extra peaks of the same colour</span></div>
      <div className="scope"><SigChart comps={comps} fMax={res.spectrogram.f_max} /></div>

      <div className="row sep-gap"><h3>When each module was on</h3><span className="mono small">top: measured total · lanes: separated modules</span></div>
      <div className="scope"><SepTimeline res={res} /></div>

      <div className="hw-grid sep-gap">
        <div>
          <div className="row"><h3>Energy by module</h3><span className="mono small">current while on from least squares against the total</span></div>
          <table className="hw-table mono"><thead><tr><th>Module</th><th>Signature</th><th>I while on</th><th>Avg I</th><th>Energy</th><th>Share</th><th>Runtime without it</th>{hasScore && <th>Detection</th>}{res.truth && <th>True avg</th>}</tr></thead>
            <tbody>{comps.map((c, i) => { const sc = scoreOf(c.id); return <tr key={c.id}>
              <td><i className="sep-dot" style={{ background: SEP_COL[i % SEP_COL.length] }} /><span title={c.low_freq ? 'Peak below 6 Hz: a slow pulse train, a step load or on/off edges' : ''}>{sepLabel(c, sc)}</span></td>
              <td>{f(c.peak_hz, 1)} Hz</td><td>{f(c.current_on_ma, 2)} mA</td><td>{f(c.avg_ma, 2)} mA</td><td>{f(c.energy_mj, 1)} mJ</td>
              <td>{c.share_pct != null ? f(c.share_pct, 1) + ' %' : '–'}</td>
              <td>{c.days_without != null && res.days_total != null ? `${f(c.days_without, 1)} d (+${f(c.days_without - res.days_total, 1)})` : '–'}</td>
              {hasScore && <td>{sc ? `${f(sc.on_off_accuracy * 100, 1)} % · r ${f(sc.r, 2)}` : '–'}</td>}
              {res.truth && <td>{c.module && res.truth[c.module] != null && (!c.low_freq || (sc && sc.on_off_accuracy > 0.8)) ? `${f(res.truth[c.module], 2)} mA (${res.truth[c.module] > 0 ? (c.avg_ma >= res.truth[c.module] ? '+' : '') + f((c.avg_ma / res.truth[c.module] - 1) * 100, 0) + ' %' : '–'})` : '–'}</td>}</tr>; })}</tbody></table>
          {res.truth && <p className="mono small sep-truth">Simulator ground truth (avg mA): {Object.entries(res.truth).map(([k, v]) => `${k} ${f(v, 2)}`).join(' · ')}</p>}
        </div>
        <aside className="hw-side">
          <div className="row"><h3>Choosing K</h3></div>
          {Object.keys(res.k_curve).length > 1 ? <><div className="scope"><KCurve curve={res.k_curve} k={res.k} /></div>
            <p className="mono small">Unexplained fraction vs number of modules. K is where adding a module stops helping more than noise does.</p></>
            : <p className="mono small">K was set by hand.</p>}
          <div className="find medium"><span className="mono small">LIMITS</span><p>Modules need different frequency signatures. Overlapping frequencies, harmonics of short radio pulses and aliasing above {f(res.fs_hz / 2, 0)} Hz blur the split. Energy is board-level and inherits the INA219's 0.1 mA resolution.</p></div>
        </aside>
      </div>
    </>}
  </div>;
}

function App() {
  const [board, setBoard] = useState('ESP32');
  const [pattern, setPattern] = useState('optimized');
  const [capacity, setCapacity] = useState(2000);
  const [interval, setIntervalS] = useState(10);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('sim');
  const [assume, setAssume] = useState(false);
  const [showBase, setShowBase] = useState(true), [play, setPlay] = useState(false), [pt, setPt] = useState(0), [meas, setMeas] = useState(null);
  useEffect(() => { // playhead sweeps one cycle in about 6 s
    if (!play || !data) return;
    let last = performance.now(), raf; const iv = data.pattern.interval;
    const step = n => { const dt = (n - last) / 1000; last = n; setPt(p => (p + (dt * iv) / 6) % iv); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [play, data && data.pattern.interval]);

  const run = () => fetch(`/api/simulate?board=${encodeURIComponent(board)}&pattern=${pattern}&capacity=${capacity}&interval=${interval}`)
    .then(r => r.json()).then(setData);
  useEffect(() => { run(); }, [board, pattern, capacity, interval]);
  useEffect(() => {
    document.getElementById('report').href = `/api/report?pattern=${pattern}&board=${encodeURIComponent(board)}&capacity=${capacity}&interval=${interval}`;
  }, [board, pattern, capacity, interval]);
  if (!data) return null;

  const s = data.pattern, b = data.baseline, C = 2 * Math.PI * 140, frac = Math.min(s.days / 22, 1);
  const shades = COL;
  const saved = (1 - s.powerMw / b.powerMw) * 100;
  const reset = () => { setBoard('ESP32'); setPattern('optimized'); setCapacity(2000); setIntervalS(10); setPlay(false); setPt(0); };
  const exportCsv = () => {
    const rows = ['phase,duration_ms,current_mA,energy_mJ,share_pct', ...s.phases.map(p => [p.name, f(p.dur * 1000, 0), f(p.ma, 1), f(p.mj), f(p.pct, 1)].join(','))];
    const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' })); el.download = `joulelab-${board}-${pattern}.csv`; el.click();
  };
  const ptc = Math.min(pt, s.interval), live = play || pt > 0;
  let cur = 'Sleep', acc = 0; for (const p of s.phases) { if (ptc <= acc + p.dur) { cur = p.name; break; } acc += p.dur; }

  return (<>
    <section className="lab" id="lab">
      <h2 className="big">The energy lab.</h2>
      <p className="lead">Change a cycle. Watch the cost. Find the next improvement.</p>
      <div className="card">
        <div className="tabs">
          <button className={tab === 'sim' ? 'on' : ''} onClick={() => setTab('sim')}>Simulator</button>
          <button className={tab === 'imp' ? 'on' : ''} onClick={() => setTab('imp')}>Import measurements</button>
          <button className={tab === 'live' ? 'on' : ''} onClick={() => setTab('live')}>Live hardware</button>
          <button className={tab === 'sep' ? 'on' : ''} onClick={() => setTab('sep')}>Module separation</button>
          <span className="mono pill">{tab === 'sep' ? 'Spectrogram + NMF' : tab === 'live' ? 'Live hardware' : tab === 'imp' ? 'Imported data' : 'Simulation'}</span>
        </div>
        {tab === 'sep' ? <Separation capacity={capacity} /> : tab === 'live' ? <LiveHardware capacity={capacity} /> : tab === 'imp' ? <div className="import">
          <p>Drop a CSV of timestamped INA219 samples (<code>time_s,current_mA</code>) to replace the modelled trace.</p>
          <label className="filebtn">Choose CSV file<input type="file" accept=".csv" onChange={e => readCsv(e.target.files[0], setMeas)} /></label>
          {meas && meas.err && <p className="mono note">{meas.err}</p>}
          {meas && !meas.err && <>
            <div className="scope"><MeasChart m={meas} /></div>
            <div className="stats">
              <div><p className="mono small">AVERAGE</p><b>{f(meas.avg)}<small> mA</small></b></div>
              <div><p className="mono small">PEAK</p><b>{f(meas.peak, 1)}<small> mA</small></b></div>
              <div><p className="mono small">RUNTIME @ {capacity.toLocaleString()} mAh</p><b>{f((capacity * USABLE) / meas.avg / 24, 1)}<small> days</small></b></div>
            </div>
            <div className="btns"><button className="chip2" onClick={() => setMeas(null)}>Clear measurement</button><button className="chip2" onClick={() => setTab('sim')}>Back to simulator</button></div>
          </>}
        </div> : <>
        <div className="controls">
          <div><p className="mono small">BOARD MODEL</p>
            <div className="boards">{window.BOARDS.map(n => <button key={n} className={board === n ? 'on' : ''} onClick={() => setBoard(n)}>{n}</button>)}</div></div>
          <div><p className="mono small">FIRMWARE PATTERN</p>
            <select value={pattern} onChange={e => setPattern(e.target.value)}>
              <option value="standard">Standard firmware</option>
              <option value="optimized">Batch transmit + shorter processing</option></select></div>
          <div className="btns"><button className="runbtn" onClick={() => setPlay(!play)}>{play ? 'Pause' : 'Play cycle'} <span>{play ? '❚❚' : '▶'}</span></button><button className="ghost" onClick={reset}>Reset</button></div>
        </div>
        <p className="mono note">Illustrative model. No physical board is connected.{board === 'ESP32' && <> ESP32 · 3.3 V · TX ≈ 183 mA · modem-sleep 20–68 mA · deep-sleep ≈ 10 µA · <a href="#esp32">full ESP32 details ↓</a></>}</p>
        <div className="panel">
          <div className="trace">
            <div className="row"><h3>Current signature</h3><span className="mono small">{f(interval)} s cycle</span></div>
            <div className="scope"><Chart sim={s} base={b} showBase={showBase && pattern === 'optimized'} pt={live ? ptc : null} /></div>
            <div className="row tools"><span className="mono small">mA / seconds · hover to inspect</span>
              <div className="btns"><button className={'chip2 ' + (showBase ? 'on' : '')} onClick={() => setShowBase(!showBase)}>Overlay baseline</button><button className="chip2" onClick={exportCsv}>Export CSV ↓</button></div></div>
            <div className="live mono">{[['SENSOR', 'Sensing'], ['CPU', 'Processing'], ['RADIO', 'Transmit'], ['SLEEP', 'Sleep']].map(([l, n], i) => <span key={n} className={live && cur === n ? 'on' : ''} style={{ '--c': COL[i] }}>{l}</span>)}</div>
            <div className="stats">
              <div><p className="mono small">AVERAGE</p><b>{f(s.avgMa)}<small> mA</small></b>{saved > 0.5 && <em className="dl2">↓ {f(saved, 0)}% vs standard</em>}</div>
              <div><p className="mono small">PEAK</p><b>{f(s.peakMa, 1)}<small> mA</small></b></div>
              <div><p className="mono small">CYCLE ENERGY</p><b>{f(s.cycleMj)}<small> mJ</small></b></div>
            </div>
            <div className="row"><h3>Where the energy goes</h3><span className="mono small">Labelled phases</span></div>
            <div className="bar">{s.phases.map((p, i) => <i key={p.name} style={{ width: p.pct + '%', background: shades[i] }} />)}</div>
            <ul className="phases mono">{s.phases.map((p, i) => <li key={p.name}>
              <span><i style={{ background: shades[i] }} />{p.name}</span><span>{f(p.dur * 1000, 0)} ms</span><span>{f(p.mj)} mJ</span><span>{f(p.pct, 1)}%</span></li>)}</ul>
          </div>
          <aside>
            <p className="mono small">PROJECTED RUNTIME</p>
            <div className="dial">
              <svg viewBox="0 0 320 320"><circle cx="160" cy="160" r="140" fill="none" stroke="#dfe7e3" strokeWidth="14" />
                <circle cx="160" cy="160" r="140" fill="none" stroke="#1a6b5f" strokeWidth="14" strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} transform="rotate(100 160 160)" /></svg>
              <div><span className="mono small">ON THIS PATTERN</span><b>{f(s.days, 1)}</b><span>days</span></div>
            </div>
            <p className="est">A modelled estimate.<br />A measurable direction.</p>
            <label><span>Battery capacity</span><span>{capacity.toLocaleString()} <small className="mono">mAh</small></span></label>
            <input type="range" min="100" max="10000" step="100" value={capacity} onChange={e => setCapacity(+e.target.value)} />
            <div className="mm mono"><span>100 mAh</span><span>10,000 mAh</span></div>
            <label><span>Cycle interval</span><span>{interval} <small className="mono">s</small></span></label>
            <input type="range" min="2" max="60" value={interval} onChange={e => setIntervalS(+e.target.value)} />
            <div className="mm mono"><span>2 s</span><span>60 s</span></div>
            <button className="assume" onClick={() => setAssume(!assume)}>Battery assumptions <span>{assume ? '−' : '+'}</span></button>
            {assume && <p className="mono small">3.3 V supply · 76% usable capacity</p>}
          </aside>
        </div></>}
      </div>
    </section>

    <section className="compare" id="compare">
      <div className="insight">
        <span className="arrow">↳</span>
        <div><p className="mono small">OPTIMIZATION INSIGHT · RULE-BASED</p><h3>Transmit uses the most energy.</h3>
          <p>Explore shorter transmit windows and more sleep time. The optimized pattern is a hypothetical change; measure your board to validate it.</p></div>
        <div className="ibtn"><button className="restore" onClick={() => setPattern(pattern === 'optimized' ? 'standard' : 'optimized')}>{pattern === 'optimized' ? 'Restore baseline' : 'Try optimization'} <span>↗</span></button><a className="restore" href="/workspace">Check my code <span>↗</span></a></div>
      </div>
      <h2 className="big">Better code.<br />Longer life.</h2>
      <p className="lead">Compare the average load power. Keep the conditions consistent.</p>
      <div className="cmp">
        <div><p className="mono small">SIMULATED BASELINE</p><h3>Standard firmware</h3><b className="num">{f(b.powerMw)}<small> mW</small></b>
          <div className="track"><i style={{ width: '100%', background: '#9cb3ab' }} /></div><p className="mono d">{f(b.days, 1)} days</p><p className="mono small">projected runtime</p></div>
        <p className="delta"><b>↓{f(saved, 1)}%</b> less power</p>
        <div><p className="mono small">CURRENT RUN · SIMULATION</p><h3>{pattern === 'optimized' ? 'Optimized pattern' : 'Standard firmware'}</h3><b className="num">{f(s.powerMw)}<small> mW</small></b>
          <div className="track"><i style={{ width: (s.powerMw / b.powerMw) * 100 + '%', background: '#1a6b5f' }} /></div><p className="mono d">{f(s.days, 1)} days</p><p className="mono small">projected runtime</p></div>
      </div>
      <p className="foot">Baseline uses the same board, cycle interval and battery assumptions. Select “Try optimization” to compare the alternate model.</p>
    </section>
  </>);
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
