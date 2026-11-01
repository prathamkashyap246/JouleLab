const { useState, useEffect, useRef } = React;
const f = (n, d = 2) => Number(n).toFixed(d);
const COL = ["#4fa3d9", "#9b7fd1", "#d9534f", "#8a8f8c"];
const TRACE = "#e5a50a", GRID = "#2b312d", AXIS = "#8a8f8c", SCOPE_INK = "#d6d8d4";
const USABLE = 0.76;
function Chart({ sim, base, showBase, pt }) {
  const [hv, setHv] = useState(null);
  const W = 1560, H = 420, L = 70, B = 40, T = 20, yMax = Math.max(sim.peakMa, showBase ? base.peakMa : 0) * 1.15;
  const x = (t) => L + t / sim.interval * (W - L - 20), y = (v) => H - B - v / yMax * (H - B - T);
  const trace = (s) => {
    let t = 0;
    const pts = [`${x(0)},${y(0)}`];
    s.phases.forEach((p) => {
      if (p.name === "Transmit") {
        for (let i = 0; i < 8; i++) pts.push(`${x(t + p.dur * i / 8)},${y(p.ma * (i % 2 ? 0.85 : 1))}`);
        pts.push(`${x(t + p.dur)},${y(p.ma * 0.9)}`);
      } else pts.push(`${x(t)},${y(p.ma)}`, `${x(t + p.dur)},${y(p.ma)}`);
      t += p.dur;
    });
    return pts.join(" ") + ` ${x(s.interval)},${y(0)}`;
  };
  const line = trace(sim), ticks = [0, 0.25, 0.5, 0.75, 1];
  let acc = 0;
  const bands = sim.phases.map((p, i) => {
    const r = { p, i, a: acc };
    acc += p.dur;
    return r;
  });
  const move = (e) => {
    const r = e.currentTarget.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const tt = Math.min(Math.max((px - L) / (W - L - 20) * sim.interval, 0), sim.interval);
    let a = 0, ph = sim.phases[sim.phases.length - 1];
    for (const p of sim.phases) {
      if (tt <= a + p.dur) {
        ph = p;
        break;
      }
      a += p.dur;
    }
    setHv({ t: tt, ph });
  };
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart", onMouseMove: move, onMouseLeave: () => setHv(null) }, bands.map(({ p, i, a }) => /* @__PURE__ */ React.createElement("rect", { key: p.name, x: x(a), y: T, width: Math.max(x(a + p.dur) - x(a), 2), height: H - B - T, fill: COL[i], opacity: ".12" })), ticks.map((k) => /* @__PURE__ */ React.createElement("g", { key: k }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - 20, y1: y(yMax * k), y2: y(yMax * k), stroke: GRID }), /* @__PURE__ */ React.createElement("text", { x: L - 14, y: y(yMax * k) + 5, textAnchor: "end", className: "tick" }, Math.round(yMax * k)), /* @__PURE__ */ React.createElement("text", { x: x(sim.interval * k), y: H - 8, textAnchor: "middle", className: "tick" }, f(sim.interval * k, 1), "s"))), /* @__PURE__ */ React.createElement("polygon", { points: `${x(0)},${y(0)} ${line}`, fill: TRACE, opacity: ".08" }), showBase && /* @__PURE__ */ React.createElement("polyline", { points: trace(base), fill: "none", stroke: "#cccccc", strokeOpacity: ".6", strokeWidth: "2", strokeDasharray: "8 7" }), /* @__PURE__ */ React.createElement("polyline", { points: line, fill: "none", stroke: TRACE, strokeWidth: "2.5", strokeLinejoin: "round" }), pt != null && /* @__PURE__ */ React.createElement("line", { x1: x(pt), x2: x(pt), y1: T, y2: H - B, stroke: "#e8e8e8", strokeWidth: "2" }), hv && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", { x1: x(hv.t), x2: x(hv.t), y1: T, y2: H - B, stroke: AXIS, strokeDasharray: "4 4" }), /* @__PURE__ */ React.createElement("circle", { cx: x(hv.t), cy: y(hv.ph.ma), r: "6", fill: TRACE }), /* @__PURE__ */ React.createElement("text", { x: x(hv.t) + (x(hv.t) > W * 0.6 ? -16 : 16), y: T + 26, textAnchor: x(hv.t) > W * 0.6 ? "end" : "start", className: "tick", style: { fill: SCOPE_INK, fontSize: 20 } }, "SIM \xB7 ", hv.ph.name, " \xB7 ", f(hv.ph.ma, 1), " mA \xB7 ", f(hv.t, 2), " s")));
}
function MeasChart({ m }) {
  const W = 1560, H = 320, mx = m.peak * 1.1 || 1, t0 = m.pts[0][0];
  const pts = m.pts.map((p) => `${40 + (p[0] - t0) / m.dur * (W - 60)},${H - 30 - p[1] / mx * (H - 50)}`).join(" ");
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: TRACE, strokeWidth: "2", strokeLinejoin: "round" }));
}
function readCsv(file, set) {
  if (!file) return;
  file.text().then((txt) => {
    const pts = txt.split(/\r?\n/).map((l) => l.split(",").map(Number)).filter((r) => r.length >= 2 && isFinite(r[0]) && isFinite(r[1]));
    if (pts.length < 2 || pts[pts.length - 1][0] <= pts[0][0]) return set({ err: "No usable time_s,current_mA rows found." });
    let q = 0, peak = 0;
    for (let i = 1; i < pts.length; i++) q += (pts[i][0] - pts[i - 1][0]) * (pts[i][1] + pts[i - 1][1]) / 2;
    pts.forEach((p) => {
      if (p[1] > peak) peak = p[1];
    });
    const dur = pts[pts.length - 1][0] - pts[0][0];
    set({ pts, dur, avg: q / dur, peak });
  });
}
const API = "/backend/api";
const STATE_TEXT = {
  disconnected: "not connected",
  waiting_for_data: "port open, no data yet",
  streaming: "streaming",
  stalled: "data stopped",
  reconnecting: "board disconnected, reconnecting",
  error: "error",
  offline: "backend offline"
};
const LEVEL = {
  streaming: ["[ OK ]", "ok"],
  waiting_for_data: ["[WARN]", "warn"],
  stalled: ["[WARN]", "warn"],
  reconnecting: ["[WARN]", "warn"],
  error: ["[FAIL]", "fail"],
  offline: ["[FAIL]", "fail"],
  disconnected: ["[IDLE]", "idle"]
};
const level = (state) => LEVEL[state] || ["[ -- ]", "idle"];
async function api(path, opts) {
  const r = await fetch(API + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : r.status === 502 ? "Backend not reachable." : "Request failed (" + r.status + ").");
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
function LiveChart({ samples, metric, windowS }) {
  const W = 1560, H = 340, L = 70, R = 20, T = 16, B = 36;
  if (!samples.length) return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("text", { x: W / 2, y: H / 2, textAnchor: "middle", className: "tick" }, "no samples"));
  const key = metric === "power" ? "power_mw" : "current_ma", unit = metric === "power" ? "mW" : "mA";
  const tEnd = samples[samples.length - 1].t_us, tStart = tEnd - windowS * 1e6;
  const vis = samples.filter((s) => s.t_us >= tStart);
  let lo = Math.min(0, ...vis.map((s) => s[key])), hi = Math.max(...vis.map((s) => s[key]));
  if (hi - lo < 1e-6) hi = lo + 1;
  hi += (hi - lo) * 0.12;
  const x = (t) => L + (t - tStart) / (windowS * 1e6) * (W - L - R), y = (v) => H - B - (v - lo) / (hi - lo) * (H - B - T);
  const segs = [];
  let cur = [];
  vis.forEach((s, i) => {
    if (i && s.index !== vis[i - 1].index + 1 && s.t_us - vis[i - 1].t_us > 3 * (vis[1] ? vis[1].t_us - vis[0].t_us : 1e6)) {
      segs.push(cur);
      cur = [];
    }
    cur.push(`${x(s.t_us).toFixed(1)},${y(s[key]).toFixed(1)}`);
  });
  segs.push(cur);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, ticks.map((k) => /* @__PURE__ */ React.createElement("g", { key: k }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - R, y1: y(lo + (hi - lo) * k), y2: y(lo + (hi - lo) * k), stroke: GRID }), /* @__PURE__ */ React.createElement("text", { x: L - 14, y: y(lo + (hi - lo) * k) + 5, textAnchor: "end", className: "tick" }, f(lo + (hi - lo) * k, hi - lo < 10 ? 2 : 0)), /* @__PURE__ */ React.createElement("text", { x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, k === 1 ? "now" : "-" + f(windowS * (1 - k), 1) + "s"))), /* @__PURE__ */ React.createElement("text", { x: L + 6, y: T + 14, className: "tick" }, unit), segs.filter((sg) => sg.length > 1).map((sg, i) => /* @__PURE__ */ React.createElement("g", { key: i }, /* @__PURE__ */ React.createElement("polyline", { points: sg.join(" "), fill: "none", stroke: TRACE, strokeWidth: "2", strokeLinejoin: "round" }))));
}
function LiveHardware({ capacity }) {
  var _a, _b, _c, _d, _e, _f;
  const [status, setStatus] = useState(null), [ports, setPorts] = useState([]), [port, setPort] = useState(""), [manual, setManual] = useState("");
  const [baud, setBaud] = useState(115200), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [wsUp, setWsUp] = useState(false);
  const [metric, setMetric] = useState("current"), [windowS, setWindowS] = useState(10), [, setTick] = useState(0);
  const [summary, setSummary] = useState(null), [sessions, setSessions] = useState([]), [sessName, setSessName] = useState(""), [fullRate, setFullRate] = useState(false), [events, setEvents] = useState([]);
  const buf = useRef([]);
  const loadPorts = () => api("/hardware/ports").then((d) => {
    setPorts(d.ports);
    setPort((p) => p || (d.ports.find((x) => x.is_stlink) || d.ports[0] || {}).device || "");
  }).catch((e) => setErr(e.message));
  const loadSessions = () => api("/sessions?limit=6").then((d) => setSessions(d.sessions)).catch(() => {
  });
  useEffect(() => {
    loadPorts();
    loadSessions();
    let ws, retry, stop = false;
    const add = (list) => {
      if (!list || !list.length) return;
      const b = buf.current;
      b.push(...list);
      const cut = b[b.length - 1].t_us - 6e7;
      let i = 0;
      while (i < b.length && b[i].t_us < cut) i++;
      if (i) b.splice(0, i);
    };
    const connect = () => {
      ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/backend/ws/live-data");
      ws.onopen = () => setWsUp(true);
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "snapshot") {
          buf.current = [];
          add(m.samples);
        }
        if (m.type === "live") {
          add(m.samples);
          if (m.events && m.events.length) setEvents((ev) => [...m.events.filter((x) => x.type !== "function_window").reverse(), ...ev].slice(0, 8));
        }
        if (m.status) setStatus(m.status);
        setTick((t) => t + 1);
      };
      ws.onclose = () => {
        setWsUp(false);
        if (!stop) retry = setTimeout(connect, 2e3);
      };
      ws.onerror = () => ws.close();
    };
    connect();
    const poll = setInterval(() => api("/measurements/summary").then(setSummary).catch(() => {
    }), 1e3);
    return () => {
      stop = true;
      clearTimeout(retry);
      clearInterval(poll);
      ws && ws.close();
    };
  }, []);
  const run = (fn) => async () => {
    setBusy(true);
    setErr("");
    try {
      const s = await fn();
      if (s && s.state) setStatus(s);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const doConnect = run(() => {
    buf.current = [];
    return post("/hardware/connect", { port: manual.trim() || port || "auto", baudrate: +baud });
  });
  const doDisconnect = run(async () => {
    const s = await post("/hardware/disconnect");
    loadSessions();
    return s;
  });
  const startSession = run(async () => {
    await post("/sessions/start", { name: sessName, full_rate: fullRate });
    setSessName("");
    loadSessions();
    return api("/hardware/status");
  });
  const stopSession = run(async () => {
    await post("/sessions/stop");
    loadSessions();
    return api("/hardware/status");
  });
  const st = status || { state: wsUp ? "disconnected" : "offline" };
  const open = st.port && !["disconnected", "error"].includes(st.state);
  const last = buf.current[buf.current.length - 1];
  const live = st.connected && last;
  const test = st.test_source;
  const win = buf.current.filter((s) => last && s.t_us >= last.t_us - windowS * 1e6);
  const avgMa = win.length ? win.reduce((a, s) => a + s.current_ma, 0) / win.length : null;
  const dot = st.state === "streaming" ? "ok" : ["error", "reconnecting", "stalled", "offline"].includes(st.state) ? "bad" : "";
  const fns = summary && summary.functions || [];
  const [tag, lvc] = level(wsUp ? st.state : "offline");
  const statusLine = !wsUp ? "backend offline \xB7 ws /backend/ws/live-data" : st.state === "streaming" ? `${test ? "TEST source" : "INA219"} \xB7 ${st.sample_rate_hz != null ? f(st.sample_rate_hz, 0) : "\u2013"} Hz \xB7 ${st.port} \xB7 ${(_a = st.lost_samples) != null ? _a : 0} lost` : (STATE_TEXT[st.state] || st.state) + (st.port ? " \xB7 " + st.port : "");
  return /* @__PURE__ */ React.createElement("div", { className: "import hw" }, /* @__PURE__ */ React.createElement("div", { className: "hw-top" }, /* @__PURE__ */ React.createElement("span", { className: "mono small live-status " + dot }, /* @__PURE__ */ React.createElement("i", null), /* @__PURE__ */ React.createElement("b", { className: "lv " + lvc }, tag), " ", statusLine), test && /* @__PURE__ */ React.createElement("span", { className: "mono hw-test" }, "TEST DATA \xB7 NOT FROM HARDWARE"), st.source === "hardware" && st.connected && /* @__PURE__ */ React.createElement("span", { className: "mono hw-real" }, "REAL INA219 DATA")), !wsUp && /* @__PURE__ */ React.createElement("p", { className: "mono note" }, /* @__PURE__ */ React.createElement("b", { className: "lv fail" }, "[FAIL]"), " FastAPI backend unreachable. In backend/: ", /* @__PURE__ */ React.createElement("code", null, "uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"), " \xB7 reconnects automatically"), /* @__PURE__ */ React.createElement("div", { className: "hw-controls" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SERIAL PORT"), /* @__PURE__ */ React.createElement("select", { value: port, onChange: (e) => setPort(e.target.value), disabled: open || busy }, !ports.length && /* @__PURE__ */ React.createElement("option", { value: "" }, "No ports found"), ports.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.device, value: p.device }, p.label)))), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "OR TYPE A PORT"), /* @__PURE__ */ React.createElement("input", { value: manual, onChange: (e) => setManual(e.target.value), placeholder: "COM5 \xB7 /dev/cu.usbmodem1103", disabled: open || busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "BAUD"), /* @__PURE__ */ React.createElement("select", { value: baud, onChange: (e) => setBaud(e.target.value), disabled: open || busy }, [115200, 230400, 460800, 921600, 57600].map((b) => /* @__PURE__ */ React.createElement("option", { key: b }, b)))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: loadPorts, disabled: open || busy }, "Refresh ports"), !open ? /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn", onClick: doConnect, disabled: busy || !wsUp }, "Connect") : /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn hw-off", onClick: doDisconnect, disabled: busy }, "Disconnect"))), st.message && st.state !== "streaming" && /* @__PURE__ */ React.createElement("p", { className: "mono small hw-msg" }, /* @__PURE__ */ React.createElement("b", { className: "lv " + lvc }, tag), " ", st.message), err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "[FAIL] CONNECTION"), /* @__PURE__ */ React.createElement("b", null, err)), ["reconnecting", "stalled", "error"].includes(st.state) && !err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, st.state === "error" ? "[FAIL]" : "[WARN]", " ", st.state.toUpperCase()), /* @__PURE__ */ React.createElement("b", null, st.state === "reconnecting" ? "The STM32 is disconnected." : st.state === "stalled" ? "No data from the STM32." : "Hardware error."), /* @__PURE__ */ React.createElement("p", null, st.message)), (st.device_errors || []).length > 0 && st.port && /* @__PURE__ */ React.createElement("div", { className: "find medium" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "[WARN] BOARD REPORTS"), /* @__PURE__ */ React.createElement("b", null, st.device_errors[st.device_errors.length - 1].message), /* @__PURE__ */ React.createElement("p", null, "Detail ", st.device_errors[st.device_errors.length - 1].detail)), /* @__PURE__ */ React.createElement("div", { className: "stats four" + (live ? "" : " dim") }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "VOLTAGE"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.voltage_v, 3) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " V"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "CURRENT"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.current_ma, 2) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "POWER"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.power_mw, 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mW"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "ENERGY \xB7 ", (st.energy_scope || "connection").toUpperCase()), /* @__PURE__ */ React.createElement("b", null, st.port && st.energy_mj != null ? f(st.energy_mj, st.energy_mj < 100 ? 3 : 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mJ")))), /* @__PURE__ */ React.createElement("div", { className: "row tools" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, live ? `${st.sample_rate_hz || "\u2013"} Hz \xB7 ${win.length} samples in view` : "received samples only; gaps are not interpolated"), /* @__PURE__ */ React.createElement("div", { className: "btns" }, [["current", "Current"], ["power", "Power"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: "chip2 " + (metric === k ? "on" : ""), onClick: () => setMetric(k) }, l)), [5, 10, 30].map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: "chip2 " + (windowS === s ? "on" : ""), onClick: () => setWindowS(s) }, s, " s")))), /* @__PURE__ */ React.createElement("div", { className: "scope" + (test ? " scope-test" : "") }, /* @__PURE__ */ React.createElement(LiveChart, { samples: st.port ? buf.current : [], metric, windowS })), /* @__PURE__ */ React.createElement("div", { className: "hw-counters mono" }, /* @__PURE__ */ React.createElement("span", null, "PACKETS ", /* @__PURE__ */ React.createElement("b", null, (_b = st.packet_count) != null ? _b : 0)), /* @__PURE__ */ React.createElement("span", { className: st.packet_errors ? "warn" : "" }, "PACKET ERRORS ", /* @__PURE__ */ React.createElement("b", null, (_c = st.packet_errors) != null ? _c : 0)), /* @__PURE__ */ React.createElement("span", { className: st.lost_samples ? "warn" : "" }, "LOST SAMPLES ", /* @__PURE__ */ React.createElement("b", null, (_d = st.lost_samples) != null ? _d : 0)), /* @__PURE__ */ React.createElement("span", null, "DUPLICATES ", /* @__PURE__ */ React.createElement("b", null, (_e = st.duplicate_samples) != null ? _e : 0)), /* @__PURE__ */ React.createElement("span", null, "BYTES SKIPPED ", /* @__PURE__ */ React.createElement("b", null, (_f = st.bytes_discarded) != null ? _f : 0)), /* @__PURE__ */ React.createElement("span", null, "LAST DATA ", /* @__PURE__ */ React.createElement("b", null, st.last_data_age_s != null ? f(st.last_data_age_s, 1) + " s" : "\u2013")), avgMa != null && live && /* @__PURE__ */ React.createElement("span", null, "RUNTIME @ ", capacity.toLocaleString(), " mAh ", /* @__PURE__ */ React.createElement("b", null, avgMa > 0 ? f(capacity * USABLE / avgMa / 24, 1) + " d" : "\u2013"))), /* @__PURE__ */ React.createElement("div", { className: "hw-grid" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "1.1 Energy by function"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, summary ? summary.scope === "session" ? "This session" : "Since connect" : "")), !fns.length ? /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "0 function windows. Source: JL_FUNCTION_START/END markers or GPIO edges on A0/A1.") : /* @__PURE__ */ React.createElement("table", { className: "hw-table mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Function"), /* @__PURE__ */ React.createElement("th", null, "Timing"), /* @__PURE__ */ React.createElement("th", null, "Calls"), /* @__PURE__ */ React.createElement("th", null, "Avg time"), /* @__PURE__ */ React.createElement("th", null, "Energy/call"), /* @__PURE__ */ React.createElement("th", null, "Avg P"), /* @__PURE__ */ React.createElement("th", null, "Max P"), /* @__PURE__ */ React.createElement("th", { title: "Energy per call minus what the idle baseline would use in the same time" }, "Above idle"))), /* @__PURE__ */ React.createElement("tbody", null, fns.map((x) => /* @__PURE__ */ React.createElement("tr", { key: x.function_name + x.source }, /* @__PURE__ */ React.createElement("td", null, x.function_name), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "src " + x.source }, x.source === "gpio" ? "GPIO-timed" : "Firmware marker")), /* @__PURE__ */ React.createElement("td", null, x.complete_calls, x.incomplete_calls ? /* @__PURE__ */ React.createElement("em", { title: "windows with lost samples are not integrated" }, " +", x.incomplete_calls, "\u2715") : ""), /* @__PURE__ */ React.createElement("td", null, x.avg_duration_ms != null ? f(x.avg_duration_ms, 2) + " ms" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, x.energy_per_call_mJ != null ? f(x.energy_per_call_mJ, 4) + " mJ" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, x.average_power_mW != null ? f(x.average_power_mW, 1) + " mW" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, f(x.max_power_mW, 1), " mW"), /* @__PURE__ */ React.createElement("td", null, x.above_baseline_per_call_mJ != null ? f(x.above_baseline_per_call_mJ, 4) + " mJ" : "\u2013"))))), summary && summary.baseline && /* @__PURE__ */ React.createElement("p", { className: "mono small hw-msg" }, "Idle baseline: ", summary.baseline.function, " at ", f(summary.baseline.power_mW, 2), ` mW. When the INA219 measures the STM32 itself, this floor includes the measurement firmware's own timer, I2C and UART work; "Above idle" removes it.`)), /* @__PURE__ */ React.createElement("aside", { className: "hw-side" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "1.2 Session"), st.session && /* @__PURE__ */ React.createElement("span", { className: "mono small rec" }, "\u25CF REC")), st.session ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, st.session.name), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: stopSession, disabled: busy }, "Stop & save")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { value: sessName, onChange: (e) => setSessName(e.target.value), placeholder: "Session name (optional)", disabled: !st.connected }), /* @__PURE__ */ React.createElement("label", { className: "mono small hw-check", title: "Store every sample instead of 1-in-10 averages. Needed for Module separation on the recording; about 10x the disk space." }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: fullRate, onChange: (e) => setFullRate(e.target.checked) }), " Full rate (for module separation)"), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: startSession, disabled: busy || !st.connected }, "Start session"), !st.connected && /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "requires streaming data")), /* @__PURE__ */ React.createElement("ul", { className: "hw-sessions mono" }, sessions.map((s) => /* @__PURE__ */ React.createElement("li", { key: s.id }, /* @__PURE__ */ React.createElement("span", null, "#", s.id, " ", s.name), /* @__PURE__ */ React.createElement("span", null, s.status === "active" ? "recording" : s.energy_mj != null ? f(s.energy_mj, 2) + " mJ" : s.status, s.source === "test" ? " \xB7 TEST" : "")))), events.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "1.3 Events")), /* @__PURE__ */ React.createElement("ul", { className: "hw-events mono" }, events.map((e, i) => /* @__PURE__ */ React.createElement("li", { key: i }, e.type === "loss" ? `${e.lost} sample(s) lost` : e.type === "resync" ? "Resync: " + e.reason : e.type === "device_status" ? e.message : e.type === "hello" ? e.ok ? e.test_source ? "HELLO from TEST source" : "HELLO from JouleLab firmware" : "Unknown firmware protocol" : e.message || e.type)))))));
}
const SEP_COL = ["#e5a50a", "#4fa3d9", "#d9534f", "#9b7fd1", "#5cb85c", "#cccccc", "#e07b39", "#5bc0be"];
const sepName = (c) => c.module || "Module " + (c.id + 1);
const sepLabel = (c, sc) => !c.low_freq ? sepName(c) : sc && sc.on_off_accuracy > 0.8 ? sepName(c) + " (low-freq)" : sc ? "Step / switching" : "Low-frequency / step";
function heatColor(v) {
  const stops = [[13, 15, 14], [40, 18, 6], [110, 52, 6], [200, 128, 10], [240, 196, 70], [252, 246, 228]];
  const x = Math.min(Math.max(v, 0), 1) * (stops.length - 1), i = Math.min(Math.floor(x), stops.length - 2), t = x - i;
  return stops[i].map((a, k) => Math.round(a + (stops[i + 1][k] - a) * t));
}
function SpecChart({ spec, duration }) {
  const url = React.useMemo(() => {
    const c = document.createElement("canvas");
    c.width = spec.cols;
    c.height = spec.rows;
    const g = c.getContext("2d"), img = g.createImageData(spec.cols, spec.rows);
    for (let r = 0; r < spec.rows; r++) for (let col = 0; col < spec.cols; col++) {
      const [R2, G, B2] = heatColor((spec.db[r][col] + 60) / 60), o = ((spec.rows - 1 - r) * spec.cols + col) * 4;
      img.data[o] = R2;
      img.data[o + 1] = G;
      img.data[o + 2] = B2;
      img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL();
  }, [spec]);
  const W = 1560, H = 360, L = 70, R = 20, T = 10, B = 36, fticks = [0, 0.25, 0.5, 0.75, 1], tticks = [0, 0.25, 0.5, 0.75, 1];
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("image", { href: url, x: L, y: T, width: W - L - R, height: H - T - B, preserveAspectRatio: "none", style: { imageRendering: "pixelated" } }), fticks.map((k) => /* @__PURE__ */ React.createElement("text", { key: "f" + k, x: L - 12, y: T + (1 - k) * (H - T - B) + 5, textAnchor: "end", className: "tick" }, f(k * spec.f_max, 0))), tticks.map((k) => /* @__PURE__ */ React.createElement("text", { key: "t" + k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * duration, 0), "s")), /* @__PURE__ */ React.createElement("text", { x: L + 8, y: T + 18, className: "tick", style: { fill: SCOPE_INK } }, "Hz"));
}
function SigChart({ comps, fMax }) {
  const W = 1560, H = 300, L = 70, R = 20, T = 14, B = 36, lane = (H - T - B) / comps.length;
  const x = (fr) => L + fr / fMax * (W - L - R);
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, [0, 0.25, 0.5, 0.75, 1].map((k) => /* @__PURE__ */ React.createElement("text", { key: k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * fMax, 0), " Hz")), comps.map((c, i) => {
    const y0 = T + (i + 1) * lane - 4, pts = c.signature.f.map((fr, j) => `${x(fr).toFixed(1)},${(y0 - c.signature.y[j] * (lane - 10)).toFixed(1)}`).join(" ");
    return /* @__PURE__ */ React.createElement("g", { key: c.id }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - R, y1: y0, y2: y0, stroke: GRID }), /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: SEP_COL[i % SEP_COL.length], strokeWidth: "2", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("text", { x: x(c.peak_hz) + 8, y: y0 - lane + 22, className: "tick", style: { fill: SEP_COL[i % SEP_COL.length] } }, sepName(c), " \xB7 ", f(c.peak_hz, 0), " Hz"));
  }));
}
function SepTimeline({ res }) {
  const comps = res.components, W = 1560, L = 70, R = 20, T = 14, TR = 170, laneH = 38, H = T + TR + 24 + comps.length * laneH + 34, dur = res.duration_s;
  const x = (t) => L + t / dur * (W - L - R);
  const tr = res.trace, lo = Math.min(...tr.ma), hi = Math.max(...tr.ma) + 1e-6, y = (v) => T + TR - (v - lo) / (hi - lo) * TR;
  const pts = tr.t.map((t, i) => `${x(t).toFixed(1)},${y(tr.ma[i]).toFixed(1)}`).join(" ");
  const dt = res.times.length > 1 ? res.times[1] - res.times[0] : 0.1;
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("text", { x: L - 12, y: T + 12, textAnchor: "end", className: "tick" }, f(hi, 0)), /* @__PURE__ */ React.createElement("text", { x: L - 12, y: T + TR, textAnchor: "end", className: "tick" }, f(lo, 0)), /* @__PURE__ */ React.createElement("text", { x: L + 8, y: T + 14, className: "tick" }, "total mA"), /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: "#e8e8e8", strokeWidth: "1.4", opacity: ".75" }), comps.map((c, i) => {
    const y0 = T + TR + 24 + i * laneH, col = SEP_COL[i % SEP_COL.length], segs = [];
    let s = null;
    c.on.forEach((v, j) => {
      if (v && s === null) s = j;
      if ((!v || j === c.on.length - 1) && s !== null) {
        segs.push([s, v ? j : j - 1]);
        s = null;
      }
    });
    return /* @__PURE__ */ React.createElement("g", { key: c.id }, /* @__PURE__ */ React.createElement("rect", { x: L, y: y0, width: W - L - R, height: laneH - 10, fill: "rgba(255,255,255,.04)" }), segs.map(([a, b], k) => /* @__PURE__ */ React.createElement("rect", { key: k, x: x(Math.max(res.times[a] - dt / 2, 0)), y: y0, width: Math.max(x(res.times[b] + dt / 2) - x(res.times[a] - dt / 2), 2), height: laneH - 10, fill: col, opacity: ".8" })), /* @__PURE__ */ React.createElement("text", { x: L - 12, y: y0 + laneH / 2, textAnchor: "end", className: "tick", style: { fill: col } }, sepName(c).replace("Module ", "M")));
  }), [0, 0.25, 0.5, 0.75, 1].map((k) => /* @__PURE__ */ React.createElement("text", { key: k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * dur, 0), "s")));
}
function KCurve({ curve, k }) {
  const ks = Object.keys(curve).map(Number), vals = ks.map((n) => curve[n]);
  if (ks.length < 2) return null;
  const W = 520, H = 220, L = 50, R = 16, T = 14, B = 34, hi = Math.max(...vals), lo = Math.min(...vals);
  const x = (n) => L + (n - ks[0]) / (ks[ks.length - 1] - ks[0]) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo + 1e-9)) * (H - T - B);
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("line", { x1: x(k), x2: x(k), y1: T, y2: H - B, stroke: "#e8e8e8", strokeDasharray: "5 5" }), /* @__PURE__ */ React.createElement("polyline", { points: ks.map((n) => `${x(n)},${y(curve[n])}`).join(" "), fill: "none", stroke: TRACE, strokeWidth: "2" }), ks.map((n) => /* @__PURE__ */ React.createElement("g", { key: n }, /* @__PURE__ */ React.createElement("circle", { cx: x(n), cy: y(curve[n]), r: n === k ? 6 : 3.5, fill: n === k ? "#e8e8e8" : TRACE }), /* @__PURE__ */ React.createElement("text", { x: x(n), y: H - 10, textAnchor: "middle", className: "tick" }, n))));
}
const VR_PRESETS = {
  "Demo board (3 modules)": [
    { name: "LED A", type: "pwm", freq_hz: 37, current_ma: 10, duty: 0.5 },
    { name: "LED B", type: "pwm", freq_hz: 173, current_ma: 20, duty: 0.5 },
    { name: "BLE", type: "pulse", freq_hz: 10, current_ma: 70, width_ms: 3 }
  ],
  "Four mixed modules": [
    { name: "Fan PWM", type: "pwm", freq_hz: 31, current_ma: 10, duty: 0.5 },
    { name: "Buzzer", type: "pwm", freq_hz: 79, current_ma: 15, duty: 0.5 },
    { name: "Motor", type: "sine", freq_hz: 143, current_ma: 12 },
    { name: "Radio", type: "pulse", freq_hz: 5, current_ma: 60, width_ms: 4 }
  ],
  "Six tones": [23, 41, 67, 89, 131, 197].map((fr, i) => ({ name: "Tone " + (i + 1), type: "sine", freq_hz: fr, current_ma: 8 })),
  "Stress: frequencies 3 Hz apart": [{ name: "Module 1", type: "pwm", freq_hz: 60, current_ma: 10, duty: 0.5 }, { name: "Module 2", type: "pwm", freq_hz: 63, current_ma: 10, duty: 0.5 }],
  "Stress: step load (no frequency)": [{ name: "LED", type: "pwm", freq_hz: 37, current_ma: 10, duty: 0.5 }, { name: "Heater", type: "step", freq_hz: 1, current_ma: 30 }],
  "Stress: above Nyquist": [{ name: "Slow", type: "pwm", freq_hz: 37, current_ma: 10, duty: 0.5 }, { name: "Too fast", type: "sine", freq_hz: 310, current_ma: 15 }]
};
const VR_TYPES = { pwm: "PWM (square)", sine: "Sine", pulse: "Pulse train", step: "Step (no frequency)" };
function VirtualRoom({ mods, setMods, noise, setNoise, period, setPeriod, busy, baseline, setBaseline, seconds, seed }) {
  const [desc, setDesc] = useState(""), [ai, setAi] = useState(null), [aiBusy, setAiBusy] = useState(false), [aiErr, setAiErr] = useState("");
  const build = async () => {
    setAiBusy(true);
    setAiErr("");
    try {
      const r = await post("/analysis/describe", { text: desc });
      setMods(r.modules);
      setBaseline(r.baseline_ma);
      setAi(r);
    } catch (e) {
      setAiErr(e.message);
    } finally {
      setAiBusy(false);
    }
  };
  const download = async () => {
    setAiErr("");
    try {
      const r = await fetch(API + "/analysis/virtual-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modules: mods, seconds: Math.min(+seconds || 60, 120), seed: +seed || 0, sample_period_us: period, noise_ma: +noise, baseline_ma: +baseline, note: desc.slice(0, 300) })
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Could not generate the log.");
      const el = document.createElement("a");
      el.href = URL.createObjectURL(await r.blob());
      el.download = "joulelab_virtual_log.txt";
      el.click();
    } catch (e) {
      setAiErr(typeof e.message === "string" ? e.message : "Could not generate the log.");
    }
  };
  const upd = (i, k, v) => setMods((m) => m.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const nyq = 1e6 / period / 2;
  return /* @__PURE__ */ React.createElement("div", { className: "vr" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "SIM \xB7 Virtual room"), /* @__PURE__ */ React.createElement("select", { value: "", onChange: (e) => e.target.value && setMods(VR_PRESETS[e.target.value].map((x) => ({ ...x }))), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Load a scenario\u2026"), Object.keys(VR_PRESETS).map((k) => /* @__PURE__ */ React.createElement("option", { key: k }, k)))), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "Modules on a virtual board switch on/off at random and overlap. The summed trace passes through the INA219 model (532 \xB5s averaging, noise, 0.1 mA steps). Separation does not see this table; it is used only for scoring."), /* @__PURE__ */ React.createElement("table", { className: "hw-table mono vr-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Name"), /* @__PURE__ */ React.createElement("th", null, "Waveform"), /* @__PURE__ */ React.createElement("th", null, "Frequency"), /* @__PURE__ */ React.createElement("th", null, "Current"), /* @__PURE__ */ React.createElement("th", null, "Shape"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, mods.map((m, i) => {
    var _a, _b;
    return /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("i", { className: "sep-dot", style: { background: SEP_COL[i % SEP_COL.length] } }), /* @__PURE__ */ React.createElement("input", { value: m.name, onChange: (e) => upd(i, "name", e.target.value), disabled: busy })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("select", { value: m.type, onChange: (e) => upd(i, "type", e.target.value), disabled: busy }, Object.entries(VR_TYPES).map(([k, l]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, l)))), /* @__PURE__ */ React.createElement("td", null, m.type === "step" ? "\u2013" : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.5", max: "2000", step: "0.5", value: m.freq_hz, onChange: (e) => upd(i, "freq_hz", +e.target.value), disabled: busy }), " Hz", m.freq_hz > nyq && /* @__PURE__ */ React.createElement("em", { title: "above half the sample rate: it will alias" }, " alias!"))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.1", max: "500", step: "0.1", value: m.current_ma, onChange: (e) => upd(i, "current_ma", +e.target.value), disabled: busy }), " mA"), /* @__PURE__ */ React.createElement("td", null, m.type === "pwm" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.05", max: "0.95", step: "0.05", value: (_a = m.duty) != null ? _a : 0.5, onChange: (e) => upd(i, "duty", +e.target.value), disabled: busy }), " duty") : m.type === "pulse" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.5", max: "100", step: "0.5", value: (_b = m.width_ms) != null ? _b : 3, onChange: (e) => upd(i, "width_ms", +e.target.value), disabled: busy }), " ms wide") : "\u2013"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMods((ms) => ms.filter((_, j) => j !== i)), disabled: busy || mods.length < 2 }, "\u2715")));
  }))), /* @__PURE__ */ React.createElement("div", { className: "hw-controls vr-controls" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMods((ms) => [...ms, { name: "Module " + (ms.length + 1), type: "sine", freq_hz: 50 + 30 * ms.length + 7, current_ma: 10 }]), disabled: busy || mods.length >= 8 }, "+ Add module"), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "IDLE CURRENT (mA)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "500", step: "1", value: baseline, onChange: (e) => setBaseline(e.target.value), disabled: busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SENSOR NOISE (mA RMS)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "20", step: "0.05", value: noise, onChange: (e) => setNoise(e.target.value), disabled: busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SAMPLE RATE"), /* @__PURE__ */ React.createElement("select", { value: period, onChange: (e) => setPeriod(+e.target.value), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: 2e3 }, "500 Hz \xB7 team firmware"), /* @__PURE__ */ React.createElement("option", { value: 1e3 }, "1 kHz"), /* @__PURE__ */ React.createElement("option", { value: 532 }, "1.88 kHz \xB7 profiler.ino"))), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "Nyquist limit: ", f(nyq, 0), " Hz"), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: download, disabled: busy || !mods.length }, "Download log (.txt)"))), aiErr && /* @__PURE__ */ React.createElement("p", { className: "mono small vr-err" }, "[FAIL] ", aiErr), /* @__PURE__ */ React.createElement("div", { className: "vr-ai" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "OPTIONAL \xB7 CIRCUIT DESCRIPTION \u2192 MODULE TABLE"), /* @__PURE__ */ React.createElement(
    "textarea",
    {
      value: desc,
      onChange: (e) => setDesc(e.target.value),
      disabled: busy || aiBusy,
      rows: "3",
      placeholder: "e.g. Two red LEDs with 220 ohm resistors, one PWM at 37 Hz and one at 173 Hz, plus BLE advertising every 100 ms"
    }
  ), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: build, disabled: busy || aiBusy || !desc.trim() }, aiBusy ? "Parsing\u2026" : "Parse description \u2192 modules")), ai && /* @__PURE__ */ React.createElement("div", { className: "find" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, ai.engine === "ai" ? "PARSED BY LLM \xB7 UNVERIFIED \xB7 CHECK THE TABLE" : "PARSED BY RULES \xB7 CHECK THE TABLE"), /* @__PURE__ */ React.createElement("p", null, "The description only sets the module table. Samples come from the physics simulator: reproducible, marked simulated."), ai.notes && ai.notes.length > 0 && /* @__PURE__ */ React.createElement("ul", { className: "vr-notes" }, ai.notes.map((n, i) => /* @__PURE__ */ React.createElement("li", { key: i }, n))))));
}
function Separation({ capacity }) {
  const [mode, setMode] = useState("simulated"), [seconds, setSeconds] = useState(60), [seed, setSeed] = useState(0), [kSel, setKSel] = useState("auto");
  const [logText, setLogText] = useState(""), [fileName, setFileName] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState(null);
  const [mods, setMods] = useState(VR_PRESETS["Demo board (3 modules)"].map((x) => ({ ...x }))), [noise, setNoise] = useState(0.25), [period, setPeriod] = useState(2e3), [baseline, setBaseline] = useState(45);
  const loadFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    file.text().then(setLogText);
  };
  const [sessList, setSessList] = useState([]), [sessionId, setSessionId] = useState("");
  useEffect(() => {
    if (mode === "session") api("/sessions?limit=50").then((d) => {
      setSessList(d.sessions);
      if (!sessionId && d.sessions[0]) setSessionId(String(d.sessions[0].id));
    }).catch((e) => setErr(e.message));
  }, [mode]);
  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      setRes(await post("/analysis/separate", {
        source: mode,
        seconds: mode === "virtual" ? Math.min(+seconds, 120) : +seconds,
        seed: +seed,
        k: kSel === "auto" ? null : +kSel,
        log_text: mode === "log" ? logText : null,
        capacity_mah: capacity,
        modules: mode === "virtual" ? mods : [],
        noise_ma: +noise,
        baseline_ma: +baseline,
        sample_period_us: mode === "virtual" ? period : 2e3,
        session_id: mode === "session" ? +sessionId : null
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const comps = res ? res.components : [], hasScore = res && res.scoring;
  const scoreOf = (id) => hasScore && res.scoring.find((s) => s.id === id);
  return /* @__PURE__ */ React.createElement("div", { className: "import hw sep" }, /* @__PURE__ */ React.createElement("p", null, "Input: one current trace. Output: per-module spectral signature, on/off activity and energy, from a spectrogram factorised with NMF (unsupervised). Logged state bits, if present, are used only for scoring."), /* @__PURE__ */ React.createElement("div", { className: "hw-controls" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "DATA"), /* @__PURE__ */ React.createElement("select", { value: mode, onChange: (e) => setMode(e.target.value), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: "live" }, "Live buffer from the board"), /* @__PURE__ */ React.createElement("option", { value: "session" }, "Recorded session (full rate)"), /* @__PURE__ */ React.createElement("option", { value: "log" }, "Log file (.txt / .csv)"), /* @__PURE__ */ React.createElement("option", { value: "simulated" }, "SIM \xB7 demo board"), /* @__PURE__ */ React.createElement("option", { value: "virtual" }, "SIM \xB7 virtual room"))), mode === "session" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SESSION"), /* @__PURE__ */ React.createElement("select", { value: sessionId, onChange: (e) => setSessionId(e.target.value), disabled: busy }, !sessList.length && /* @__PURE__ */ React.createElement("option", { value: "" }, "No sessions yet"), sessList.map((x) => /* @__PURE__ */ React.createElement("option", { key: x.id, value: x.id }, "#", x.id, " ", x.name, x.source === "test" ? " \xB7 TEST" : "")))), mode !== "log" && mode !== "session" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, mode === "live" ? "LAST SECONDS" : "RUN LENGTH (S)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "10", max: "600", value: seconds, onChange: (e) => setSeconds(e.target.value), disabled: busy })), (mode === "simulated" || mode === "virtual") && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SEED"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "9999", value: seed, onChange: (e) => setSeed(e.target.value), disabled: busy })), mode === "log" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "LOG FILE (.TXT / .CSV)"), /* @__PURE__ */ React.createElement("input", { type: "file", accept: ".txt,.csv,.log", onChange: (e) => loadFile(e.target.files[0]), disabled: busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "MODULES (K)"), /* @__PURE__ */ React.createElement("select", { value: kSel, onChange: (e) => setKSel(e.target.value), disabled: busy }, ["auto", 1, 2, 3, 4, 5, 6].map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, k === "auto" ? "Detect automatically" : k)))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn", onClick: run, disabled: busy || mode === "log" && !logText }, busy ? "Separating\u2026" : "Separate"))), mode === "virtual" && /* @__PURE__ */ React.createElement(
    VirtualRoom,
    {
      mods,
      setMods,
      noise,
      setNoise,
      period,
      setPeriod,
      busy,
      baseline,
      setBaseline,
      seconds,
      seed
    }
  ), mode === "log" && fileName && /* @__PURE__ */ React.createElement("p", { className: "mono small hw-msg" }, fileName, " \xB7 ", (logText.length / 1e6).toFixed(2), " MB loaded"), err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "[FAIL] SEPARATION"), /* @__PURE__ */ React.createElement("b", null, err)), res && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "hw-top" }, res.simulated ? /* @__PURE__ */ React.createElement("span", { className: "mono hw-test" }, "SIM \xB7 SIMULATED DATA \xB7 NOT FROM HARDWARE") : /* @__PURE__ */ React.createElement("span", { className: "mono hw-real" }, res.source === "live" ? "REAL INA219 DATA" : "IMPORTED LOG"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, f(res.duration_s, 1), " s \xB7 ", f(res.fs_hz, 0), " Hz sampling \xB7 ", res.samples.toLocaleString(), " samples \xB7 Vbus ", f(res.vbus_v, 2), " V")), /* @__PURE__ */ React.createElement("div", { className: "stats four" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "MODULES FOUND", res.k_auto ? " \xB7 AUTO" : ""), /* @__PURE__ */ React.createElement("b", null, res.k, res.nmf_components > res.k && /* @__PURE__ */ React.createElement("small", null, " (", res.nmf_components, " pieces merged)"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "UNEXPLAINED SPECTRUM"), /* @__PURE__ */ React.createElement("b", null, f(res.unexplained * 100, 1), /* @__PURE__ */ React.createElement("small", null, " %"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "BASELINE"), /* @__PURE__ */ React.createElement("b", null, f(res.baseline_ma, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "RUNTIME @ ", capacity.toLocaleString(), " mAh"), /* @__PURE__ */ React.createElement("b", null, res.days_total != null ? f(res.days_total, 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " days")))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "2.1 Spectrogram \xB7 total current"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "horizontal bands: periodic loads \xB7 dB, \u221260 to 0")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SpecChart, { spec: res.spectrogram, duration: res.duration_s })), /* @__PURE__ */ React.createElement("div", { className: "row sep-gap" }, /* @__PURE__ */ React.createElement("h3", null, "2.2 Spectral signatures (unlabelled)"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "harmonics appear as extra peaks in the same colour")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SigChart, { comps, fMax: res.spectrogram.f_max })), /* @__PURE__ */ React.createElement("div", { className: "row sep-gap" }, /* @__PURE__ */ React.createElement("h3", null, "2.3 Activity per module"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "top: total mA \xB7 lanes: separated modules")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SepTimeline, { res })), /* @__PURE__ */ React.createElement("div", { className: "hw-grid sep-gap" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "2.4 Energy by module"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "I while on: least squares against the total")), /* @__PURE__ */ React.createElement("table", { className: "hw-table mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Module"), /* @__PURE__ */ React.createElement("th", null, "Signature"), /* @__PURE__ */ React.createElement("th", null, "I while on"), /* @__PURE__ */ React.createElement("th", null, "Avg I"), /* @__PURE__ */ React.createElement("th", null, "Energy"), /* @__PURE__ */ React.createElement("th", null, "Share"), /* @__PURE__ */ React.createElement("th", null, "Runtime without it"), hasScore && /* @__PURE__ */ React.createElement("th", null, "Detection"), res.truth && /* @__PURE__ */ React.createElement("th", null, "True avg"))), /* @__PURE__ */ React.createElement("tbody", null, comps.map((c, i) => {
    const sc = scoreOf(c.id);
    return /* @__PURE__ */ React.createElement("tr", { key: c.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("i", { className: "sep-dot", style: { background: SEP_COL[i % SEP_COL.length] } }), /* @__PURE__ */ React.createElement("span", { title: c.low_freq ? "Peak below 6 Hz: a slow pulse train, a step load or on/off edges" : "" }, sepLabel(c, sc))), /* @__PURE__ */ React.createElement("td", null, f(c.peak_hz, 1), " Hz"), /* @__PURE__ */ React.createElement("td", null, f(c.current_on_ma, 2), " mA"), /* @__PURE__ */ React.createElement("td", null, f(c.avg_ma, 2), " mA"), /* @__PURE__ */ React.createElement("td", null, f(c.energy_mj, 1), " mJ"), /* @__PURE__ */ React.createElement("td", null, c.share_pct != null ? f(c.share_pct, 1) + " %" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, c.days_without != null && res.days_total != null ? `${f(c.days_without, 1)} d (+${f(c.days_without - res.days_total, 1)})` : "\u2013"), hasScore && /* @__PURE__ */ React.createElement("td", null, sc ? `${f(sc.on_off_accuracy * 100, 1)} % \xB7 r ${f(sc.r, 2)}` : "\u2013"), res.truth && /* @__PURE__ */ React.createElement("td", null, c.module && res.truth[c.module] != null && (!c.low_freq || sc && sc.on_off_accuracy > 0.8) ? `${f(res.truth[c.module], 2)} mA (${res.truth[c.module] > 0 ? (c.avg_ma >= res.truth[c.module] ? "+" : "") + f((c.avg_ma / res.truth[c.module] - 1) * 100, 0) + " %" : "\u2013"})` : "\u2013"));
  }))), res.truth && /* @__PURE__ */ React.createElement("p", { className: "mono small sep-truth" }, "SIM \xB7 ground truth (avg mA): ", Object.entries(res.truth).map(([k, v]) => `${k} ${f(v, 2)}`).join(" \xB7 "))), /* @__PURE__ */ React.createElement("aside", { className: "hw-side" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "2.5 Choosing K")), Object.keys(res.k_curve).length > 1 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(KCurve, { curve: res.k_curve, k: res.k })), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "Unexplained fraction vs number of modules. K is where adding a module stops helping more than noise does.")) : /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "K was set by hand."), /* @__PURE__ */ React.createElement("div", { className: "find medium" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "[WARN] LIMITS"), /* @__PURE__ */ React.createElement("p", null, "Modules need different frequency signatures. Overlapping frequencies, harmonics of short radio pulses and aliasing above ", f(res.fs_hz / 2, 0), " Hz blur the split. Energy is board-level and inherits the INA219's 0.1 mA resolution."))))));
}
function App() {
  const [board, setBoard] = useState("ESP32");
  const [pattern, setPattern] = useState("optimized");
  const [capacity, setCapacity] = useState(2e3);
  const [interval, setIntervalS] = useState(10);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("live");
  const [assume, setAssume] = useState(false);
  const [showBase, setShowBase] = useState(true), [play, setPlay] = useState(false), [pt, setPt] = useState(0), [meas, setMeas] = useState(null);
  useEffect(() => {
    if (!play || !data) return;
    let last = performance.now(), raf;
    const iv = data.pattern.interval;
    const step = (n) => {
      const dt = (n - last) / 1e3;
      last = n;
      setPt((p) => (p + dt * iv / 6) % iv);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [play, data && data.pattern.interval]);
  const wantScroll = useRef(false);
  useEffect(() => {
    const go = () => {
      const t = { live: "live", sep: "sep", imp: "imp", sim: "sim" }[location.hash.slice(1)];
      if (!t) return;
      setTab(t);
      wantScroll.current = true;
      const el = document.getElementById("lab");
      if (el) {
        el.scrollIntoView();
        wantScroll.current = false;
      }
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);
  useEffect(() => {
    if (data && wantScroll.current) {
      wantScroll.current = false;
      const el = document.getElementById("lab");
      if (el) el.scrollIntoView();
    }
  }, [data, tab]);
  const run = () => fetch(`/api/simulate?board=${encodeURIComponent(board)}&pattern=${pattern}&capacity=${capacity}&interval=${interval}`).then((r) => r.json()).then(setData);
  useEffect(() => {
    run();
  }, [board, pattern, capacity, interval]);
  useEffect(() => {
    document.getElementById("report").href = `/api/report?pattern=${pattern}&board=${encodeURIComponent(board)}&capacity=${capacity}&interval=${interval}`;
  }, [board, pattern, capacity, interval]);
  if (!data) return null;
  const s = data.pattern, b = data.baseline;
  const top = s.phases.reduce((a, p) => p.pct > a.pct ? p : a, s.phases[0]);
  const shades = COL;
  const saved = (1 - s.powerMw / b.powerMw) * 100;
  const reset = () => {
    setBoard("ESP32");
    setPattern("optimized");
    setCapacity(2e3);
    setIntervalS(10);
    setPlay(false);
    setPt(0);
  };
  const exportCsv = () => {
    const rows = ["phase,duration_ms,current_mA,energy_mJ,share_pct", ...s.phases.map((p) => [p.name, f(p.dur * 1e3, 0), f(p.ma, 1), f(p.mj), f(p.pct, 1)].join(","))];
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    el.download = `joulelab-${board}-${pattern}.csv`;
    el.click();
  };
  const ptc = Math.min(pt, s.interval), live = play || pt > 0;
  let cur = "Sleep", acc = 0;
  for (const p of s.phases) {
    if (ptc <= acc + p.dur) {
      cur = p.name;
      break;
    }
    acc += p.dur;
  }
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "sec lab", id: "lab" }, /* @__PURE__ */ React.createElement("div", { className: "sec-h" }, /* @__PURE__ */ React.createElement("h2", null, /* @__PURE__ */ React.createElement("span", { className: "n" }, "2"), " Lab")), /* @__PURE__ */ React.createElement("p", { className: "lead" }, "Live INA219 measurement, module separation and log import. The simulator (tab 4) is a modelled reference, labelled SIM."), /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: tab === "live" ? "on" : "", onClick: () => setTab("live") }, "1 Live hardware"), /* @__PURE__ */ React.createElement("button", { className: tab === "sep" ? "on" : "", onClick: () => setTab("sep") }, "2 Module separation"), /* @__PURE__ */ React.createElement("button", { className: tab === "imp" ? "on" : "", onClick: () => setTab("imp") }, "3 Import log"), /* @__PURE__ */ React.createElement("button", { className: tab === "sim" ? "on" : "", onClick: () => setTab("sim") }, "4 Simulator"), /* @__PURE__ */ React.createElement("span", { className: "mono pill" }, tab === "sep" ? "SPECTROGRAM + NMF" : tab === "live" ? "INA219 \xB7 SERIAL" : tab === "imp" ? "CSV \xB7 time_s,current_mA" : "SIM \xB7 MODEL")), tab === "sep" ? /* @__PURE__ */ React.createElement(Separation, { capacity }) : tab === "live" ? /* @__PURE__ */ React.createElement(LiveHardware, { capacity }) : tab === "imp" ? /* @__PURE__ */ React.createElement("div", { className: "import" }, /* @__PURE__ */ React.createElement("p", null, "CSV, one sample per row: ", /* @__PURE__ */ React.createElement("code", null, "time_s,current_mA"), ". Header and malformed rows are skipped. Average is trapezoidal over the full span."), /* @__PURE__ */ React.createElement("label", { className: "filebtn mono" }, "Choose CSV file", /* @__PURE__ */ React.createElement("input", { type: "file", accept: ".csv", onChange: (e) => readCsv(e.target.files[0], setMeas) })), meas && meas.err && /* @__PURE__ */ React.createElement("p", { className: "mono note" }, /* @__PURE__ */ React.createElement("b", { className: "lv fail" }, "[FAIL]"), " ", meas.err), meas && !meas.err && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(MeasChart, { m: meas })), /* @__PURE__ */ React.createElement("div", { className: "stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "AVERAGE"), /* @__PURE__ */ React.createElement("b", null, f(meas.avg), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "PEAK"), /* @__PURE__ */ React.createElement("b", null, f(meas.peak, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "RUNTIME @ ", capacity.toLocaleString(), " mAh"), /* @__PURE__ */ React.createElement("b", null, f(capacity * USABLE / meas.avg / 24, 1), /* @__PURE__ */ React.createElement("small", null, " days")))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMeas(null) }, "Clear measurement"), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setTab("sim") }, "Simulator")))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "controls" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "SIM \xB7 BOARD MODEL"), /* @__PURE__ */ React.createElement("div", { className: "boards" }, window.BOARDS.map((n) => /* @__PURE__ */ React.createElement("button", { key: n, className: board === n ? "on" : "", onClick: () => setBoard(n) }, n)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "SIM \xB7 FIRMWARE PATTERN"), /* @__PURE__ */ React.createElement("select", { value: pattern, onChange: (e) => setPattern(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "standard" }, "SIM \xB7 standard firmware"), /* @__PURE__ */ React.createElement("option", { value: "optimized" }, "SIM \xB7 batch transmit + shorter processing"))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "runbtn", onClick: () => setPlay(!play) }, play ? "Pause" : "Play cycle"), /* @__PURE__ */ React.createElement("button", { className: "ghost", onClick: reset }, "Reset"))), /* @__PURE__ */ React.createElement("p", { className: "mono note" }, "SIM \xB7 model only, no board connected.", board === "ESP32" && /* @__PURE__ */ React.createElement(React.Fragment, null, " ESP32 \xB7 3.3 V \xB7 TX \u2248 183 mA \xB7 modem-sleep 20\u201368 mA \xB7 deep-sleep \u2248 10 \xB5A \xB7 ", /* @__PURE__ */ React.createElement("a", { href: "#esp32" }, "ESP32 reference"))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "trace" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "SIM \xB7 current vs time"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, f(interval), " s cycle")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(Chart, { sim: s, base: b, showBase: showBase && pattern === "optimized", pt: live ? ptc : null })), /* @__PURE__ */ React.createElement("div", { className: "row tools" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "mA / seconds \xB7 hover to inspect"), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2 " + (showBase ? "on" : ""), onClick: () => setShowBase(!showBase) }, "Overlay baseline"), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: exportCsv }, "Export CSV"))), /* @__PURE__ */ React.createElement("div", { className: "live mono" }, [["SENSOR", "Sensing"], ["CPU", "Processing"], ["RADIO", "Transmit"], ["SLEEP", "Sleep"]].map(([l, n], i) => /* @__PURE__ */ React.createElement("span", { key: n, className: live && cur === n ? "on" : "", style: { "--c": COL[i] } }, l))), /* @__PURE__ */ React.createElement("div", { className: "stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "AVERAGE"), /* @__PURE__ */ React.createElement("b", null, f(s.avgMa), /* @__PURE__ */ React.createElement("small", null, " mA")), saved > 0.5 && /* @__PURE__ */ React.createElement("em", { className: "dl2" }, "\u2212", f(saved, 0), " % vs standard")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "PEAK"), /* @__PURE__ */ React.createElement("b", null, f(s.peakMa, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "CYCLE ENERGY"), /* @__PURE__ */ React.createElement("b", null, f(s.cycleMj), /* @__PURE__ */ React.createElement("small", null, " mJ")))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "SIM \xB7 energy by phase"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "labelled phases")), /* @__PURE__ */ React.createElement("div", { className: "bar" }, s.phases.map((p, i) => /* @__PURE__ */ React.createElement("i", { key: p.name, style: { width: p.pct + "%", background: shades[i] } }))), /* @__PURE__ */ React.createElement("ul", { className: "phases mono" }, s.phases.map((p, i) => /* @__PURE__ */ React.createElement("li", { key: p.name }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { style: { background: shades[i] } }), p.name), /* @__PURE__ */ React.createElement("span", null, f(p.dur * 1e3, 0), " ms"), /* @__PURE__ */ React.createElement("span", null, f(p.mj), " mJ"), /* @__PURE__ */ React.createElement("span", null, f(p.pct, 1), "%"))))), /* @__PURE__ */ React.createElement("aside", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "SIM \xB7 PROJECTED RUNTIME"), /* @__PURE__ */ React.createElement("div", { className: "readout" }, /* @__PURE__ */ React.createElement("b", null, f(s.days, 1), /* @__PURE__ */ React.createElement("small", null, " days")), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, f(s.avgMa), " mA avg \xB7 ", f(s.powerMw), " mW")), /* @__PURE__ */ React.createElement("p", { className: "est" }, "Model output, not a measurement."), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Battery capacity"), /* @__PURE__ */ React.createElement("span", null, capacity.toLocaleString(), " ", /* @__PURE__ */ React.createElement("small", { className: "mono" }, "mAh"))), /* @__PURE__ */ React.createElement("input", { type: "range", min: "100", max: "10000", step: "100", value: capacity, onChange: (e) => setCapacity(+e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "mm mono" }, /* @__PURE__ */ React.createElement("span", null, "100 mAh"), /* @__PURE__ */ React.createElement("span", null, "10,000 mAh")), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Cycle interval"), /* @__PURE__ */ React.createElement("span", null, interval, " ", /* @__PURE__ */ React.createElement("small", { className: "mono" }, "s"))), /* @__PURE__ */ React.createElement("input", { type: "range", min: "2", max: "60", value: interval, onChange: (e) => setIntervalS(+e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "mm mono" }, /* @__PURE__ */ React.createElement("span", null, "2 s"), /* @__PURE__ */ React.createElement("span", null, "60 s")), /* @__PURE__ */ React.createElement("button", { className: "assume", onClick: () => setAssume(!assume) }, "Battery assumptions ", /* @__PURE__ */ React.createElement("span", null, assume ? "\u2212" : "+")), assume && /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "3.3 V supply \xB7 76 % usable capacity")))))), /* @__PURE__ */ React.createElement("section", { className: "sec compare", id: "compare" }, /* @__PURE__ */ React.createElement("div", { className: "sec-h" }, /* @__PURE__ */ React.createElement("h2", null, /* @__PURE__ */ React.createElement("span", { className: "n" }, "3"), " Simulation: pattern comparison")), /* @__PURE__ */ React.createElement("p", { className: "lead" }, "SIM \xB7 modelled average load for ", board, ", ", interval, " s cycle, ", capacity.toLocaleString(), " mAh. Both rows use the same board, interval and battery assumptions."), /* @__PURE__ */ React.createElement("div", { className: "insight" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "SIM \xB7 RULE-BASED"), /* @__PURE__ */ React.createElement("h3", null, "Largest share: ", top.name, ", ", f(top.pct, 1), " % of cycle charge"), /* @__PURE__ */ React.createElement("p", null, "The optimized pattern (batched transmit, shorter processing) is a hypothetical change. Validate it on hardware.")), /* @__PURE__ */ React.createElement("div", { className: "ibtn" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setPattern(pattern === "optimized" ? "standard" : "optimized") }, pattern === "optimized" ? "Use standard pattern" : "Use optimized pattern"), /* @__PURE__ */ React.createElement("a", { className: "chip2", href: "/workspace" }, "Check sketch"))), /* @__PURE__ */ React.createElement("div", { className: "cmp-wrap" }, /* @__PURE__ */ React.createElement("table", { className: "cmp mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Pattern"), /* @__PURE__ */ React.createElement("th", null, "Avg power"), /* @__PURE__ */ React.createElement("th", null, "Avg current"), /* @__PURE__ */ React.createElement("th", null, "Relative"), /* @__PURE__ */ React.createElement("th", null, "Runtime"))), /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "SIM \xB7 standard firmware (baseline)"), /* @__PURE__ */ React.createElement("td", null, f(b.powerMw), " mW"), /* @__PURE__ */ React.createElement("td", null, f(b.avgMa), " mA"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "track" }, /* @__PURE__ */ React.createElement("i", { style: { width: "100%", background: "#8a8f8c" } }))), /* @__PURE__ */ React.createElement("td", null, f(b.days, 1), " d")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "SIM \xB7 ", pattern === "optimized" ? "optimized pattern" : "standard firmware", " (current run)"), /* @__PURE__ */ React.createElement("td", null, f(s.powerMw), " mW"), /* @__PURE__ */ React.createElement("td", null, f(s.avgMa), " mA"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("div", { className: "track" }, /* @__PURE__ */ React.createElement("i", { style: { width: s.powerMw / b.powerMw * 100 + "%", background: "#111111" } }))), /* @__PURE__ */ React.createElement("td", null, f(s.days, 1), " d")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", null, "\u0394 power"), /* @__PURE__ */ React.createElement("td", null, saved > 0.05 ? "\u2212" + f(saved, 1) : "0.0", " %"), /* @__PURE__ */ React.createElement("td", null), /* @__PURE__ */ React.createElement("td", null), /* @__PURE__ */ React.createElement("td", null, saved > 0.05 ? "+" + f(s.days - b.days, 1) + " d" : "\u2013"))))), /* @__PURE__ */ React.createElement("p", { className: "foot" }, "Runtime = capacity \xD7 0.76 / average current. Modelled, not measured.")));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
