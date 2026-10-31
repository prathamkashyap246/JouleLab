const { useState, useEffect, useRef } = React;
const f = (n, d = 2) => Number(n).toFixed(d);
const COL = ["#2dd4a8", "#7cc4ff", "#ffb454", "#6b8a82"];
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
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart", onMouseMove: move, onMouseLeave: () => setHv(null) }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("filter", { id: "glow" }, /* @__PURE__ */ React.createElement("feGaussianBlur", { stdDeviation: "4" }))), bands.map(({ p, i, a }) => /* @__PURE__ */ React.createElement("rect", { key: p.name, x: x(a), y: T, width: Math.max(x(a + p.dur) - x(a), 2), height: H - B - T, fill: COL[i], opacity: ".14" })), ticks.map((k) => /* @__PURE__ */ React.createElement("g", { key: k }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - 20, y1: y(yMax * k), y2: y(yMax * k), stroke: "rgba(255,255,255,.13)", strokeDasharray: "5 6" }), /* @__PURE__ */ React.createElement("text", { x: L - 14, y: y(yMax * k) + 5, textAnchor: "end", className: "tick" }, Math.round(yMax * k)), /* @__PURE__ */ React.createElement("text", { x: x(sim.interval * k), y: H - 8, textAnchor: "middle", className: "tick" }, f(sim.interval * k, 1), "s"))), /* @__PURE__ */ React.createElement("polygon", { points: `${x(0)},${y(0)} ${line}`, fill: "#2dd4a8", opacity: ".12" }), showBase && /* @__PURE__ */ React.createElement("polyline", { points: trace(base), fill: "none", stroke: "#fff", strokeOpacity: ".55", strokeWidth: "2.5", strokeDasharray: "8 7" }), /* @__PURE__ */ React.createElement("polyline", { points: line, fill: "none", stroke: "#2dd4a8", strokeWidth: "10", opacity: ".35", filter: "url(#glow)" }), /* @__PURE__ */ React.createElement("polyline", { points: line, fill: "none", stroke: "#5ff0c8", strokeWidth: "3.5", strokeLinejoin: "round" }), pt != null && /* @__PURE__ */ React.createElement("line", { x1: x(pt), x2: x(pt), y1: T, y2: H - B, stroke: "#ffb454", strokeWidth: "2.5" }), hv && /* @__PURE__ */ React.createElement("g", null, /* @__PURE__ */ React.createElement("line", { x1: x(hv.t), x2: x(hv.t), y1: T, y2: H - B, stroke: "#d8efe7", strokeDasharray: "4 4" }), /* @__PURE__ */ React.createElement("circle", { cx: x(hv.t), cy: y(hv.ph.ma), r: "7", fill: "#5ff0c8" }), /* @__PURE__ */ React.createElement("text", { x: x(hv.t) + (x(hv.t) > W * 0.6 ? -16 : 16), y: T + 26, textAnchor: x(hv.t) > W * 0.6 ? "end" : "start", className: "tick", style: { fill: "#d8efe7", fontSize: 18 } }, hv.ph.name, " \xB7 ", f(hv.ph.ma, 1), " mA \xB7 ", f(hv.t, 2), " s")));
}
function MeasChart({ m }) {
  const W = 1560, H = 320, mx = m.peak * 1.1 || 1, t0 = m.pts[0][0];
  const pts = m.pts.map((p) => `${40 + (p[0] - t0) / m.dur * (W - 60)},${H - 30 - p[1] / mx * (H - 50)}`).join(" ");
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: "#5ff0c8", strokeWidth: "3", strokeLinejoin: "round" }));
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
  disconnected: "Not connected",
  waiting_for_data: "Port open \xB7 waiting for data",
  streaming: "Streaming",
  stalled: "Data stopped",
  reconnecting: "Board disconnected \xB7 reconnecting",
  error: "Error"
};
async function api(path, opts) {
  const r = await fetch(API + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : r.status === 502 ? "Backend not reachable." : "Request failed (" + r.status + ").");
  return d;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
function LiveChart({ samples, metric, windowS }) {
  const W = 1560, H = 340, L = 70, R = 20, T = 16, B = 36;
  if (!samples.length) return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("text", { x: W / 2, y: H / 2, textAnchor: "middle", className: "tick" }, "Waiting for measurements\u2026"));
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
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("defs", null, /* @__PURE__ */ React.createElement("filter", { id: "lglow" }, /* @__PURE__ */ React.createElement("feGaussianBlur", { stdDeviation: "4" }))), ticks.map((k) => /* @__PURE__ */ React.createElement("g", { key: k }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - R, y1: y(lo + (hi - lo) * k), y2: y(lo + (hi - lo) * k), stroke: "rgba(255,255,255,.13)", strokeDasharray: "5 6" }), /* @__PURE__ */ React.createElement("text", { x: L - 14, y: y(lo + (hi - lo) * k) + 5, textAnchor: "end", className: "tick" }, f(lo + (hi - lo) * k, hi - lo < 10 ? 2 : 0)), /* @__PURE__ */ React.createElement("text", { x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, k === 1 ? "now" : "-" + f(windowS * (1 - k), 1) + "s"))), /* @__PURE__ */ React.createElement("text", { x: L + 6, y: T + 14, className: "tick" }, unit), segs.filter((sg) => sg.length > 1).map((sg, i) => /* @__PURE__ */ React.createElement("g", { key: i }, /* @__PURE__ */ React.createElement("polyline", { points: sg.join(" "), fill: "none", stroke: "#2dd4a8", strokeWidth: "8", opacity: ".3", filter: "url(#lglow)" }), /* @__PURE__ */ React.createElement("polyline", { points: sg.join(" "), fill: "none", stroke: "#5ff0c8", strokeWidth: "2.5", strokeLinejoin: "round" }))));
}
function LiveHardware({ capacity }) {
  var _a, _b, _c, _d, _e;
  const [status, setStatus] = useState(null), [ports, setPorts] = useState([]), [port, setPort] = useState(""), [manual, setManual] = useState("");
  const [baud, setBaud] = useState(115200), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [wsUp, setWsUp] = useState(false);
  const [metric, setMetric] = useState("current"), [windowS, setWindowS] = useState(10), [, setTick] = useState(0);
  const [summary, setSummary] = useState(null), [sessions, setSessions] = useState([]), [sessName, setSessName] = useState(""), [events, setEvents] = useState([]);
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
    await post("/sessions/start", { name: sessName });
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
  return /* @__PURE__ */ React.createElement("div", { className: "import hw" }, /* @__PURE__ */ React.createElement("div", { className: "hw-top" }, /* @__PURE__ */ React.createElement("span", { className: "mono small live-status " + dot }, /* @__PURE__ */ React.createElement("i", null), wsUp ? STATE_TEXT[st.state] || st.state : "Backend offline", st.port ? " \xB7 " + st.port : ""), test && /* @__PURE__ */ React.createElement("span", { className: "mono hw-test" }, "TEST DATA \xB7 NOT FROM HARDWARE"), st.source === "hardware" && st.connected && /* @__PURE__ */ React.createElement("span", { className: "mono hw-real" }, "REAL INA219 DATA")), !wsUp && /* @__PURE__ */ React.createElement("p", { className: "mono note" }, "The FastAPI backend is not reachable. In backend/ run ", /* @__PURE__ */ React.createElement("code", null, "uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"), "; this view reconnects automatically."), /* @__PURE__ */ React.createElement("div", { className: "hw-controls" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SERIAL PORT"), /* @__PURE__ */ React.createElement("select", { value: port, onChange: (e) => setPort(e.target.value), disabled: open || busy }, !ports.length && /* @__PURE__ */ React.createElement("option", { value: "" }, "No ports found"), ports.map((p) => /* @__PURE__ */ React.createElement("option", { key: p.device, value: p.device }, p.label)))), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "OR TYPE A PORT"), /* @__PURE__ */ React.createElement("input", { value: manual, onChange: (e) => setManual(e.target.value), placeholder: "COM5 \xB7 /dev/cu.usbmodem1103", disabled: open || busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "BAUD"), /* @__PURE__ */ React.createElement("select", { value: baud, onChange: (e) => setBaud(e.target.value), disabled: open || busy }, [115200, 230400, 460800, 921600, 57600].map((b) => /* @__PURE__ */ React.createElement("option", { key: b }, b)))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: loadPorts, disabled: open || busy }, "Refresh ports"), !open ? /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn", onClick: doConnect, disabled: busy || !wsUp }, "Connect ", /* @__PURE__ */ React.createElement("span", null, "\u23FB")) : /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn hw-off", onClick: doDisconnect, disabled: busy }, "Disconnect ", /* @__PURE__ */ React.createElement("span", null, "\u25A0")))), /* @__PURE__ */ React.createElement("p", { className: "mono small hw-msg" }, st.message), err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "CONNECTION"), /* @__PURE__ */ React.createElement("b", null, err)), ["reconnecting", "stalled", "error"].includes(st.state) && !err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, st.state.toUpperCase()), /* @__PURE__ */ React.createElement("b", null, st.state === "reconnecting" ? "The STM32 is disconnected." : st.state === "stalled" ? "No data from the STM32." : "Hardware error."), /* @__PURE__ */ React.createElement("p", null, st.message)), (st.device_errors || []).length > 0 && st.port && /* @__PURE__ */ React.createElement("div", { className: "find medium" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "BOARD REPORTS"), /* @__PURE__ */ React.createElement("b", null, st.device_errors[st.device_errors.length - 1].message), /* @__PURE__ */ React.createElement("p", null, "Detail ", st.device_errors[st.device_errors.length - 1].detail)), /* @__PURE__ */ React.createElement("div", { className: "stats four" + (live ? "" : " dim") }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "VOLTAGE"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.voltage_v, 3) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " V"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "CURRENT"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.current_ma, 2) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "POWER"), /* @__PURE__ */ React.createElement("b", null, live ? f(last.power_mw, 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mW"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "ENERGY \xB7 ", (st.energy_scope || "connection").toUpperCase()), /* @__PURE__ */ React.createElement("b", null, st.port && st.energy_mj != null ? f(st.energy_mj, st.energy_mj < 100 ? 3 : 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " mJ")))), /* @__PURE__ */ React.createElement("div", { className: "row tools" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, live ? `${st.sample_rate_hz || "\u2013"} Hz \xB7 ${win.length} samples in view` : "Graph shows only received measurements; gaps stay empty"), /* @__PURE__ */ React.createElement("div", { className: "btns" }, [["current", "Current"], ["power", "Power"]].map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, className: "chip2 " + (metric === k ? "on" : ""), onClick: () => setMetric(k) }, l)), [5, 10, 30].map((s) => /* @__PURE__ */ React.createElement("button", { key: s, className: "chip2 " + (windowS === s ? "on" : ""), onClick: () => setWindowS(s) }, s, " s")))), /* @__PURE__ */ React.createElement("div", { className: "scope" + (test ? " scope-test" : "") }, /* @__PURE__ */ React.createElement(LiveChart, { samples: st.port ? buf.current : [], metric, windowS })), /* @__PURE__ */ React.createElement("div", { className: "hw-counters mono" }, /* @__PURE__ */ React.createElement("span", null, "PACKETS ", /* @__PURE__ */ React.createElement("b", null, (_a = st.packet_count) != null ? _a : 0)), /* @__PURE__ */ React.createElement("span", { className: st.packet_errors ? "warn" : "" }, "PACKET ERRORS ", /* @__PURE__ */ React.createElement("b", null, (_b = st.packet_errors) != null ? _b : 0)), /* @__PURE__ */ React.createElement("span", { className: st.lost_samples ? "warn" : "" }, "LOST SAMPLES ", /* @__PURE__ */ React.createElement("b", null, (_c = st.lost_samples) != null ? _c : 0)), /* @__PURE__ */ React.createElement("span", null, "DUPLICATES ", /* @__PURE__ */ React.createElement("b", null, (_d = st.duplicate_samples) != null ? _d : 0)), /* @__PURE__ */ React.createElement("span", null, "BYTES SKIPPED ", /* @__PURE__ */ React.createElement("b", null, (_e = st.bytes_discarded) != null ? _e : 0)), /* @__PURE__ */ React.createElement("span", null, "LAST DATA ", /* @__PURE__ */ React.createElement("b", null, st.last_data_age_s != null ? f(st.last_data_age_s, 1) + " s" : "\u2013")), avgMa != null && live && /* @__PURE__ */ React.createElement("span", null, "RUNTIME @ ", capacity.toLocaleString(), " mAh ", /* @__PURE__ */ React.createElement("b", null, avgMa > 0 ? f(capacity * USABLE / avgMa / 24, 1) + " d" : "\u2013"))), /* @__PURE__ */ React.createElement("div", { className: "hw-grid" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Energy by function"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, summary ? summary.scope === "session" ? "This session" : "Since connect" : "")), !fns.length ? /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "No function windows yet. The firmware's JL_FUNCTION_START/END markers or GPIO edges on A0/A1 appear here.") : /* @__PURE__ */ React.createElement("table", { className: "hw-table mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Function"), /* @__PURE__ */ React.createElement("th", null, "Timing"), /* @__PURE__ */ React.createElement("th", null, "Calls"), /* @__PURE__ */ React.createElement("th", null, "Avg time"), /* @__PURE__ */ React.createElement("th", null, "Energy/call"), /* @__PURE__ */ React.createElement("th", null, "Avg P"), /* @__PURE__ */ React.createElement("th", null, "Max P"))), /* @__PURE__ */ React.createElement("tbody", null, fns.map((x) => /* @__PURE__ */ React.createElement("tr", { key: x.function_name + x.source }, /* @__PURE__ */ React.createElement("td", null, x.function_name), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("span", { className: "src " + x.source }, x.source === "gpio" ? "GPIO-timed" : "Firmware marker")), /* @__PURE__ */ React.createElement("td", null, x.complete_calls, x.incomplete_calls ? /* @__PURE__ */ React.createElement("em", { title: "windows with lost samples are not integrated" }, " +", x.incomplete_calls, "\u2715") : ""), /* @__PURE__ */ React.createElement("td", null, x.avg_duration_ms != null ? f(x.avg_duration_ms, 2) + " ms" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, x.energy_per_call_mJ != null ? f(x.energy_per_call_mJ, 4) + " mJ" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, x.average_power_mW != null ? f(x.average_power_mW, 1) + " mW" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, f(x.max_power_mW, 1), " mW")))))), /* @__PURE__ */ React.createElement("aside", { className: "hw-side" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Session"), st.session && /* @__PURE__ */ React.createElement("span", { className: "mono small rec" }, "\u25CF REC")), st.session ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, st.session.name), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: stopSession, disabled: busy }, "Stop & save")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { value: sessName, onChange: (e) => setSessName(e.target.value), placeholder: "Session name (optional)", disabled: !st.connected }), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: startSession, disabled: busy || !st.connected }, "Start session"), !st.connected && /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "Sessions need live data.")), /* @__PURE__ */ React.createElement("ul", { className: "hw-sessions mono" }, sessions.map((s) => /* @__PURE__ */ React.createElement("li", { key: s.id }, /* @__PURE__ */ React.createElement("span", null, "#", s.id, " ", s.name), /* @__PURE__ */ React.createElement("span", null, s.status === "active" ? "recording" : s.energy_mj != null ? f(s.energy_mj, 2) + " mJ" : s.status, s.source === "test" ? " \xB7 TEST" : "")))), events.length > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Events")), /* @__PURE__ */ React.createElement("ul", { className: "hw-events mono" }, events.map((e, i) => /* @__PURE__ */ React.createElement("li", { key: i }, e.type === "loss" ? `${e.lost} sample(s) lost` : e.type === "resync" ? "Resync: " + e.reason : e.type === "device_status" ? e.message : e.type === "hello" ? e.ok ? e.test_source ? "HELLO from TEST source" : "HELLO from JouleLab firmware" : "Unknown firmware protocol" : e.message || e.type)))))));
}
const SEP_COL = ["#2dd4a8", "#7cc4ff", "#ffb454", "#f07ab0", "#b59cff", "#e8e36b", "#9fb8b0", "#ff8a6b"];
const sepName = (c) => c.module || "Module " + (c.id + 1);
const sepLabel = (c, sc) => !c.low_freq ? sepName(c) : sc && sc.on_off_accuracy > 0.8 ? sepName(c) + " (low-freq)" : sc ? "Step / switching" : "Low-frequency / step";
function heatColor(v) {
  const stops = [[12, 29, 25], [26, 107, 95], [45, 212, 168], [246, 247, 192]];
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
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("image", { href: url, x: L, y: T, width: W - L - R, height: H - T - B, preserveAspectRatio: "none", style: { imageRendering: "pixelated" } }), fticks.map((k) => /* @__PURE__ */ React.createElement("text", { key: "f" + k, x: L - 12, y: T + (1 - k) * (H - T - B) + 5, textAnchor: "end", className: "tick" }, f(k * spec.f_max, 0))), tticks.map((k) => /* @__PURE__ */ React.createElement("text", { key: "t" + k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * duration, 0), "s")), /* @__PURE__ */ React.createElement("text", { x: L + 8, y: T + 18, className: "tick", fill: "#f6f7c0" }, "Hz"));
}
function SigChart({ comps, fMax }) {
  const W = 1560, H = 300, L = 70, R = 20, T = 14, B = 36, lane = (H - T - B) / comps.length;
  const x = (fr) => L + fr / fMax * (W - L - R);
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, [0, 0.25, 0.5, 0.75, 1].map((k) => /* @__PURE__ */ React.createElement("text", { key: k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * fMax, 0), " Hz")), comps.map((c, i) => {
    const y0 = T + (i + 1) * lane - 4, pts = c.signature.f.map((fr, j) => `${x(fr).toFixed(1)},${(y0 - c.signature.y[j] * (lane - 10)).toFixed(1)}`).join(" ");
    return /* @__PURE__ */ React.createElement("g", { key: c.id }, /* @__PURE__ */ React.createElement("line", { x1: L, x2: W - R, y1: y0, y2: y0, stroke: "rgba(255,255,255,.12)" }), /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: SEP_COL[i % SEP_COL.length], strokeWidth: "2.5", strokeLinejoin: "round" }), /* @__PURE__ */ React.createElement("text", { x: x(c.peak_hz) + 8, y: y0 - lane + 22, className: "tick", fill: SEP_COL[i % SEP_COL.length] }, sepName(c), " \xB7 ", f(c.peak_hz, 0), " Hz"));
  }));
}
function SepTimeline({ res }) {
  const comps = res.components, W = 1560, L = 70, R = 20, T = 14, TR = 170, laneH = 38, H = T + TR + 24 + comps.length * laneH + 34, dur = res.duration_s;
  const x = (t) => L + t / dur * (W - L - R);
  const tr = res.trace, lo = Math.min(...tr.ma), hi = Math.max(...tr.ma) + 1e-6, y = (v) => T + TR - (v - lo) / (hi - lo) * TR;
  const pts = tr.t.map((t, i) => `${x(t).toFixed(1)},${y(tr.ma[i]).toFixed(1)}`).join(" ");
  const dt = res.times.length > 1 ? res.times[1] - res.times[0] : 0.1;
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("text", { x: L - 12, y: T + 12, textAnchor: "end", className: "tick" }, f(hi, 0)), /* @__PURE__ */ React.createElement("text", { x: L - 12, y: T + TR, textAnchor: "end", className: "tick" }, f(lo, 0)), /* @__PURE__ */ React.createElement("text", { x: L + 8, y: T + 14, className: "tick" }, "total mA"), /* @__PURE__ */ React.createElement("polyline", { points: pts, fill: "none", stroke: "#5ff0c8", strokeWidth: "1.6", opacity: ".85" }), comps.map((c, i) => {
    const y0 = T + TR + 24 + i * laneH, col = SEP_COL[i % SEP_COL.length], segs = [];
    let s = null;
    c.on.forEach((v, j) => {
      if (v && s === null) s = j;
      if ((!v || j === c.on.length - 1) && s !== null) {
        segs.push([s, v ? j : j - 1]);
        s = null;
      }
    });
    return /* @__PURE__ */ React.createElement("g", { key: c.id }, /* @__PURE__ */ React.createElement("rect", { x: L, y: y0, width: W - L - R, height: laneH - 10, fill: "rgba(255,255,255,.04)", rx: "4" }), segs.map(([a, b], k) => /* @__PURE__ */ React.createElement("rect", { key: k, x: x(Math.max(res.times[a] - dt / 2, 0)), y: y0, width: Math.max(x(res.times[b] + dt / 2) - x(res.times[a] - dt / 2), 2), height: laneH - 10, fill: col, opacity: ".75", rx: "3" })), /* @__PURE__ */ React.createElement("text", { x: L - 12, y: y0 + laneH / 2, textAnchor: "end", className: "tick", fill: col }, sepName(c).replace("Module ", "M")));
  }), [0, 0.25, 0.5, 0.75, 1].map((k) => /* @__PURE__ */ React.createElement("text", { key: k, x: L + k * (W - L - R), y: H - 8, textAnchor: "middle", className: "tick" }, f(k * dur, 0), "s")));
}
function KCurve({ curve, k }) {
  const ks = Object.keys(curve).map(Number), vals = ks.map((n) => curve[n]);
  if (ks.length < 2) return null;
  const W = 520, H = 220, L = 50, R = 16, T = 14, B = 34, hi = Math.max(...vals), lo = Math.min(...vals);
  const x = (n) => L + (n - ks[0]) / (ks[ks.length - 1] - ks[0]) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo + 1e-9)) * (H - T - B);
  return /* @__PURE__ */ React.createElement("svg", { viewBox: `0 0 ${W} ${H}`, className: "chart" }, /* @__PURE__ */ React.createElement("line", { x1: x(k), x2: x(k), y1: T, y2: H - B, stroke: "#ffb454", strokeDasharray: "5 5" }), /* @__PURE__ */ React.createElement("polyline", { points: ks.map((n) => `${x(n)},${y(curve[n])}`).join(" "), fill: "none", stroke: "#5ff0c8", strokeWidth: "2.5" }), ks.map((n) => /* @__PURE__ */ React.createElement("g", { key: n }, /* @__PURE__ */ React.createElement("circle", { cx: x(n), cy: y(curve[n]), r: n === k ? 7 : 4, fill: n === k ? "#ffb454" : "#5ff0c8" }), /* @__PURE__ */ React.createElement("text", { x: x(n), y: H - 10, textAnchor: "middle", className: "tick" }, n))));
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
function VirtualRoom({ mods, setMods, noise, setNoise, period, setPeriod, busy }) {
  const upd = (i, k, v) => setMods((m) => m.map((x, j) => j === i ? { ...x, [k]: v } : x));
  const nyq = 1e6 / period / 2;
  return /* @__PURE__ */ React.createElement("div", { className: "vr" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Virtual room"), /* @__PURE__ */ React.createElement("select", { value: "", onChange: (e) => e.target.value && setMods(VR_PRESETS[e.target.value].map((x) => ({ ...x }))), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: "" }, "Load a scenario\u2026"), Object.keys(VR_PRESETS).map((k) => /* @__PURE__ */ React.createElement("option", { key: k }, k)))), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "Design the modules on a virtual board. Each one switches on and off at random, overlapping the others, and the trace goes through the same INA219 model as the hardware (532 \xB5s averaging, noise, 0.1 mA steps). The separation never sees this table; it only scores against it."), /* @__PURE__ */ React.createElement("table", { className: "hw-table mono vr-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Name"), /* @__PURE__ */ React.createElement("th", null, "Waveform"), /* @__PURE__ */ React.createElement("th", null, "Frequency"), /* @__PURE__ */ React.createElement("th", null, "Current"), /* @__PURE__ */ React.createElement("th", null, "Shape"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, mods.map((m, i) => {
    var _a, _b;
    return /* @__PURE__ */ React.createElement("tr", { key: i }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("i", { className: "sep-dot", style: { background: SEP_COL[i % SEP_COL.length] } }), /* @__PURE__ */ React.createElement("input", { value: m.name, onChange: (e) => upd(i, "name", e.target.value), disabled: busy })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("select", { value: m.type, onChange: (e) => upd(i, "type", e.target.value), disabled: busy }, Object.entries(VR_TYPES).map(([k, l]) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, l)))), /* @__PURE__ */ React.createElement("td", null, m.type === "step" ? "\u2013" : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.5", max: "2000", step: "0.5", value: m.freq_hz, onChange: (e) => upd(i, "freq_hz", +e.target.value), disabled: busy }), " Hz", m.freq_hz > nyq && /* @__PURE__ */ React.createElement("em", { title: "above half the sample rate: it will alias" }, " alias!"))), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.1", max: "500", step: "0.1", value: m.current_ma, onChange: (e) => upd(i, "current_ma", +e.target.value), disabled: busy }), " mA"), /* @__PURE__ */ React.createElement("td", null, m.type === "pwm" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.05", max: "0.95", step: "0.05", value: (_a = m.duty) != null ? _a : 0.5, onChange: (e) => upd(i, "duty", +e.target.value), disabled: busy }), " duty") : m.type === "pulse" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("input", { type: "number", min: "0.5", max: "100", step: "0.5", value: (_b = m.width_ms) != null ? _b : 3, onChange: (e) => upd(i, "width_ms", +e.target.value), disabled: busy }), " ms wide") : "\u2013"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMods((ms) => ms.filter((_, j) => j !== i)), disabled: busy || mods.length < 2 }, "\u2715")));
  }))), /* @__PURE__ */ React.createElement("div", { className: "hw-controls vr-controls" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMods((ms) => [...ms, { name: "Module " + (ms.length + 1), type: "sine", freq_hz: 50 + 30 * ms.length + 7, current_ma: 10 }]), disabled: busy || mods.length >= 8 }, "+ Add module"), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SENSOR NOISE (mA RMS)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "20", step: "0.05", value: noise, onChange: (e) => setNoise(e.target.value), disabled: busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SAMPLE RATE"), /* @__PURE__ */ React.createElement("select", { value: period, onChange: (e) => setPeriod(+e.target.value), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: 2e3 }, "500 Hz \xB7 team firmware"), /* @__PURE__ */ React.createElement("option", { value: 1e3 }, "1 kHz"), /* @__PURE__ */ React.createElement("option", { value: 532 }, "1.88 kHz \xB7 profiler.ino"))), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "Nyquist limit: ", f(nyq, 0), " Hz")));
}
function Separation({ capacity }) {
  const [mode, setMode] = useState("simulated"), [seconds, setSeconds] = useState(60), [seed, setSeed] = useState(0), [kSel, setKSel] = useState("auto");
  const [logText, setLogText] = useState(""), [fileName, setFileName] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [res, setRes] = useState(null);
  const [mods, setMods] = useState(VR_PRESETS["Demo board (3 modules)"].map((x) => ({ ...x }))), [noise, setNoise] = useState(0.25), [period, setPeriod] = useState(2e3);
  const loadFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    file.text().then(setLogText);
  };
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
        sample_period_us: mode === "virtual" ? period : 2e3
      }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const comps = res ? res.components : [], hasScore = res && res.scoring;
  const scoreOf = (id) => hasScore && res.scoring.find((s) => s.id === id);
  return /* @__PURE__ */ React.createElement("div", { className: "import hw sep" }, /* @__PURE__ */ React.createElement("p", null, "One current trace, several modules. JouleLab turns the trace into a spectrogram, and NMF splits it into spectral signatures and their on/off activity without being told which module is which. State bits, when logged, are used only to score the result."), /* @__PURE__ */ React.createElement("div", { className: "hw-controls" }, /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "DATA"), /* @__PURE__ */ React.createElement("select", { value: mode, onChange: (e) => setMode(e.target.value), disabled: busy }, /* @__PURE__ */ React.createElement("option", { value: "simulated" }, "Simulated demo (no hardware)"), /* @__PURE__ */ React.createElement("option", { value: "virtual" }, "Virtual room (design your own signals)"), /* @__PURE__ */ React.createElement("option", { value: "live" }, "Live buffer from the board"), /* @__PURE__ */ React.createElement("option", { value: "log" }, "Upload a log file"))), mode !== "log" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, mode === "live" ? "LAST SECONDS" : "RUN LENGTH (S)"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "10", max: "600", value: seconds, onChange: (e) => setSeconds(e.target.value), disabled: busy })), (mode === "simulated" || mode === "virtual") && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SEED"), /* @__PURE__ */ React.createElement("input", { type: "number", min: "0", max: "9999", value: seed, onChange: (e) => setSeed(e.target.value), disabled: busy })), mode === "log" && /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "LOG FILE (.TXT / .CSV)"), /* @__PURE__ */ React.createElement("input", { type: "file", accept: ".txt,.csv,.log", onChange: (e) => loadFile(e.target.files[0]), disabled: busy })), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "MODULES (K)"), /* @__PURE__ */ React.createElement("select", { value: kSel, onChange: (e) => setKSel(e.target.value), disabled: busy }, ["auto", 1, 2, 3, 4, 5, 6].map((k) => /* @__PURE__ */ React.createElement("option", { key: k, value: k }, k === "auto" ? "Detect automatically" : k)))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "runbtn hw-btn", onClick: run, disabled: busy || mode === "log" && !logText }, busy ? "Separating\u2026" : "Separate", " ", /* @__PURE__ */ React.createElement("span", null, "\u25B6")))), mode === "virtual" && /* @__PURE__ */ React.createElement(VirtualRoom, { mods, setMods, noise, setNoise, period, setPeriod, busy }), mode === "log" && fileName && /* @__PURE__ */ React.createElement("p", { className: "mono small hw-msg" }, fileName, " \xB7 ", (logText.length / 1e6).toFixed(2), " MB loaded"), err && /* @__PURE__ */ React.createElement("div", { className: "find high" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "SEPARATION"), /* @__PURE__ */ React.createElement("b", null, err)), res && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "hw-top" }, res.simulated ? /* @__PURE__ */ React.createElement("span", { className: "mono hw-test" }, "SIMULATED DATA \xB7 NOT FROM HARDWARE") : /* @__PURE__ */ React.createElement("span", { className: "mono hw-real" }, res.source === "live" ? "REAL INA219 DATA" : "IMPORTED LOG"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, f(res.duration_s, 1), " s \xB7 ", f(res.fs_hz, 0), " Hz sampling \xB7 ", res.samples.toLocaleString(), " samples \xB7 Vbus ", f(res.vbus_v, 2), " V")), /* @__PURE__ */ React.createElement("div", { className: "stats four" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "MODULES FOUND", res.k_auto ? " \xB7 AUTO" : ""), /* @__PURE__ */ React.createElement("b", null, res.k)), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "UNEXPLAINED SPECTRUM"), /* @__PURE__ */ React.createElement("b", null, f(res.unexplained * 100, 1), /* @__PURE__ */ React.createElement("small", null, " %"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "BASELINE"), /* @__PURE__ */ React.createElement("b", null, f(res.baseline_ma, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "RUNTIME @ ", capacity.toLocaleString(), " mAh"), /* @__PURE__ */ React.createElement("b", null, res.days_total != null ? f(res.days_total, 1) : "\u2013", /* @__PURE__ */ React.createElement("small", null, " days")))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Spectrogram of the total current"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "bright horizontal bands = modules running at their own frequency")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SpecChart, { spec: res.spectrogram, duration: res.duration_s })), /* @__PURE__ */ React.createElement("div", { className: "row sep-gap" }, /* @__PURE__ */ React.createElement("h3", null, "Signatures found (no labels)"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "harmonics show up as extra peaks of the same colour")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SigChart, { comps, fMax: res.spectrogram.f_max })), /* @__PURE__ */ React.createElement("div", { className: "row sep-gap" }, /* @__PURE__ */ React.createElement("h3", null, "When each module was on"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "top: measured total \xB7 lanes: separated modules")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(SepTimeline, { res })), /* @__PURE__ */ React.createElement("div", { className: "hw-grid sep-gap" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Energy by module"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "current while on from least squares against the total")), /* @__PURE__ */ React.createElement("table", { className: "hw-table mono" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Module"), /* @__PURE__ */ React.createElement("th", null, "Signature"), /* @__PURE__ */ React.createElement("th", null, "I while on"), /* @__PURE__ */ React.createElement("th", null, "Avg I"), /* @__PURE__ */ React.createElement("th", null, "Energy"), /* @__PURE__ */ React.createElement("th", null, "Share"), /* @__PURE__ */ React.createElement("th", null, "Runtime without it"), hasScore && /* @__PURE__ */ React.createElement("th", null, "Detection"), res.truth && /* @__PURE__ */ React.createElement("th", null, "True avg"))), /* @__PURE__ */ React.createElement("tbody", null, comps.map((c, i) => {
    const sc = scoreOf(c.id);
    return /* @__PURE__ */ React.createElement("tr", { key: c.id }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("i", { className: "sep-dot", style: { background: SEP_COL[i % SEP_COL.length] } }), /* @__PURE__ */ React.createElement("span", { title: c.low_freq ? "Peak below 6 Hz: a slow pulse train, a step load or on/off edges" : "" }, sepLabel(c, sc))), /* @__PURE__ */ React.createElement("td", null, f(c.peak_hz, 1), " Hz"), /* @__PURE__ */ React.createElement("td", null, f(c.current_on_ma, 2), " mA"), /* @__PURE__ */ React.createElement("td", null, f(c.avg_ma, 2), " mA"), /* @__PURE__ */ React.createElement("td", null, f(c.energy_mj, 1), " mJ"), /* @__PURE__ */ React.createElement("td", null, c.share_pct != null ? f(c.share_pct, 1) + " %" : "\u2013"), /* @__PURE__ */ React.createElement("td", null, c.days_without != null && res.days_total != null ? `${f(c.days_without, 1)} d (+${f(c.days_without - res.days_total, 1)})` : "\u2013"), hasScore && /* @__PURE__ */ React.createElement("td", null, sc ? `${f(sc.on_off_accuracy * 100, 1)} % \xB7 r ${f(sc.r, 2)}` : "\u2013"), res.truth && /* @__PURE__ */ React.createElement("td", null, c.module && res.truth[c.module] != null && (!c.low_freq || sc && sc.on_off_accuracy > 0.8) ? `${f(res.truth[c.module], 2)} mA (${res.truth[c.module] > 0 ? (c.avg_ma >= res.truth[c.module] ? "+" : "") + f((c.avg_ma / res.truth[c.module] - 1) * 100, 0) + " %" : "\u2013"})` : "\u2013"));
  }))), res.truth && /* @__PURE__ */ React.createElement("p", { className: "mono small sep-truth" }, "Simulator ground truth (avg mA): ", Object.entries(res.truth).map(([k, v]) => `${k} ${f(v, 2)}`).join(" \xB7 "))), /* @__PURE__ */ React.createElement("aside", { className: "hw-side" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Choosing K")), Object.keys(res.k_curve).length > 1 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(KCurve, { curve: res.k_curve, k: res.k })), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "Unexplained fraction vs number of modules. K is where adding a module stops helping more than noise does.")) : /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "K was set by hand."), /* @__PURE__ */ React.createElement("div", { className: "find medium" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "LIMITS"), /* @__PURE__ */ React.createElement("p", null, "Modules need different frequency signatures. Overlapping frequencies, harmonics of short radio pulses and aliasing above ", f(res.fs_hz / 2, 0), " Hz blur the split. Energy is board-level and inherits the INA219's 0.1 mA resolution."))))));
}
function App() {
  const [board, setBoard] = useState("ESP32");
  const [pattern, setPattern] = useState("optimized");
  const [capacity, setCapacity] = useState(2e3);
  const [interval, setIntervalS] = useState(10);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("sim");
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
  const run = () => fetch(`/api/simulate?board=${encodeURIComponent(board)}&pattern=${pattern}&capacity=${capacity}&interval=${interval}`).then((r) => r.json()).then(setData);
  useEffect(() => {
    run();
  }, [board, pattern, capacity, interval]);
  useEffect(() => {
    document.getElementById("report").href = `/api/report?pattern=${pattern}&board=${encodeURIComponent(board)}&capacity=${capacity}&interval=${interval}`;
  }, [board, pattern, capacity, interval]);
  if (!data) return null;
  const s = data.pattern, b = data.baseline, C = 2 * Math.PI * 140, frac = Math.min(s.days / 22, 1);
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
  return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("section", { className: "lab", id: "lab" }, /* @__PURE__ */ React.createElement("h2", { className: "big" }, "The energy lab."), /* @__PURE__ */ React.createElement("p", { className: "lead" }, "Change a cycle. Watch the cost. Find the next improvement."), /* @__PURE__ */ React.createElement("div", { className: "card" }, /* @__PURE__ */ React.createElement("div", { className: "tabs" }, /* @__PURE__ */ React.createElement("button", { className: tab === "sim" ? "on" : "", onClick: () => setTab("sim") }, "Simulator"), /* @__PURE__ */ React.createElement("button", { className: tab === "imp" ? "on" : "", onClick: () => setTab("imp") }, "Import measurements"), /* @__PURE__ */ React.createElement("button", { className: tab === "live" ? "on" : "", onClick: () => setTab("live") }, "Live hardware"), /* @__PURE__ */ React.createElement("button", { className: tab === "sep" ? "on" : "", onClick: () => setTab("sep") }, "Module separation"), /* @__PURE__ */ React.createElement("span", { className: "mono pill" }, tab === "sep" ? "Spectrogram + NMF" : tab === "live" ? "Live hardware" : tab === "imp" ? "Imported data" : "Simulation")), tab === "sep" ? /* @__PURE__ */ React.createElement(Separation, { capacity }) : tab === "live" ? /* @__PURE__ */ React.createElement(LiveHardware, { capacity }) : tab === "imp" ? /* @__PURE__ */ React.createElement("div", { className: "import" }, /* @__PURE__ */ React.createElement("p", null, "Drop a CSV of timestamped INA219 samples (", /* @__PURE__ */ React.createElement("code", null, "time_s,current_mA"), ") to replace the modelled trace."), /* @__PURE__ */ React.createElement("label", { className: "filebtn" }, "Choose CSV file", /* @__PURE__ */ React.createElement("input", { type: "file", accept: ".csv", onChange: (e) => readCsv(e.target.files[0], setMeas) })), meas && meas.err && /* @__PURE__ */ React.createElement("p", { className: "mono note" }, meas.err), meas && !meas.err && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(MeasChart, { m: meas })), /* @__PURE__ */ React.createElement("div", { className: "stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "AVERAGE"), /* @__PURE__ */ React.createElement("b", null, f(meas.avg), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "PEAK"), /* @__PURE__ */ React.createElement("b", null, f(meas.peak, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "RUNTIME @ ", capacity.toLocaleString(), " mAh"), /* @__PURE__ */ React.createElement("b", null, f(capacity * USABLE / meas.avg / 24, 1), /* @__PURE__ */ React.createElement("small", null, " days")))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setMeas(null) }, "Clear measurement"), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: () => setTab("sim") }, "Back to simulator")))) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "controls" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "BOARD MODEL"), /* @__PURE__ */ React.createElement("div", { className: "boards" }, window.BOARDS.map((n) => /* @__PURE__ */ React.createElement("button", { key: n, className: board === n ? "on" : "", onClick: () => setBoard(n) }, n)))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "FIRMWARE PATTERN"), /* @__PURE__ */ React.createElement("select", { value: pattern, onChange: (e) => setPattern(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "standard" }, "Standard firmware"), /* @__PURE__ */ React.createElement("option", { value: "optimized" }, "Batch transmit + shorter processing"))), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "runbtn", onClick: () => setPlay(!play) }, play ? "Pause" : "Play cycle", " ", /* @__PURE__ */ React.createElement("span", null, play ? "\u275A\u275A" : "\u25B6")), /* @__PURE__ */ React.createElement("button", { className: "ghost", onClick: reset }, "Reset"))), /* @__PURE__ */ React.createElement("p", { className: "mono note" }, "Illustrative model. No physical board is connected.", board === "ESP32" && /* @__PURE__ */ React.createElement(React.Fragment, null, " ESP32 \xB7 3.3 V \xB7 TX \u2248 183 mA \xB7 modem-sleep 20\u201368 mA \xB7 deep-sleep \u2248 10 \xB5A \xB7 ", /* @__PURE__ */ React.createElement("a", { href: "#esp32" }, "full ESP32 details \u2193"))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "trace" }, /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Current signature"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, f(interval), " s cycle")), /* @__PURE__ */ React.createElement("div", { className: "scope" }, /* @__PURE__ */ React.createElement(Chart, { sim: s, base: b, showBase: showBase && pattern === "optimized", pt: live ? ptc : null })), /* @__PURE__ */ React.createElement("div", { className: "row tools" }, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "mA / seconds \xB7 hover to inspect"), /* @__PURE__ */ React.createElement("div", { className: "btns" }, /* @__PURE__ */ React.createElement("button", { className: "chip2 " + (showBase ? "on" : ""), onClick: () => setShowBase(!showBase) }, "Overlay baseline"), /* @__PURE__ */ React.createElement("button", { className: "chip2", onClick: exportCsv }, "Export CSV \u2193"))), /* @__PURE__ */ React.createElement("div", { className: "live mono" }, [["SENSOR", "Sensing"], ["CPU", "Processing"], ["RADIO", "Transmit"], ["SLEEP", "Sleep"]].map(([l, n], i) => /* @__PURE__ */ React.createElement("span", { key: n, className: live && cur === n ? "on" : "", style: { "--c": COL[i] } }, l))), /* @__PURE__ */ React.createElement("div", { className: "stats" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "AVERAGE"), /* @__PURE__ */ React.createElement("b", null, f(s.avgMa), /* @__PURE__ */ React.createElement("small", null, " mA")), saved > 0.5 && /* @__PURE__ */ React.createElement("em", { className: "dl2" }, "\u2193 ", f(saved, 0), "% vs standard")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "PEAK"), /* @__PURE__ */ React.createElement("b", null, f(s.peakMa, 1), /* @__PURE__ */ React.createElement("small", null, " mA"))), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "CYCLE ENERGY"), /* @__PURE__ */ React.createElement("b", null, f(s.cycleMj), /* @__PURE__ */ React.createElement("small", null, " mJ")))), /* @__PURE__ */ React.createElement("div", { className: "row" }, /* @__PURE__ */ React.createElement("h3", null, "Where the energy goes"), /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "Labelled phases")), /* @__PURE__ */ React.createElement("div", { className: "bar" }, s.phases.map((p, i) => /* @__PURE__ */ React.createElement("i", { key: p.name, style: { width: p.pct + "%", background: shades[i] } }))), /* @__PURE__ */ React.createElement("ul", { className: "phases mono" }, s.phases.map((p, i) => /* @__PURE__ */ React.createElement("li", { key: p.name }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("i", { style: { background: shades[i] } }), p.name), /* @__PURE__ */ React.createElement("span", null, f(p.dur * 1e3, 0), " ms"), /* @__PURE__ */ React.createElement("span", null, f(p.mj), " mJ"), /* @__PURE__ */ React.createElement("span", null, f(p.pct, 1), "%"))))), /* @__PURE__ */ React.createElement("aside", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "PROJECTED RUNTIME"), /* @__PURE__ */ React.createElement("div", { className: "dial" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 320 320" }, /* @__PURE__ */ React.createElement("circle", { cx: "160", cy: "160", r: "140", fill: "none", stroke: "#dfe7e3", strokeWidth: "14" }), /* @__PURE__ */ React.createElement("circle", { cx: "160", cy: "160", r: "140", fill: "none", stroke: "#1a6b5f", strokeWidth: "14", strokeLinecap: "round", strokeDasharray: `${C * frac} ${C}`, transform: "rotate(100 160 160)" })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("span", { className: "mono small" }, "ON THIS PATTERN"), /* @__PURE__ */ React.createElement("b", null, f(s.days, 1)), /* @__PURE__ */ React.createElement("span", null, "days"))), /* @__PURE__ */ React.createElement("p", { className: "est" }, "A modelled estimate.", /* @__PURE__ */ React.createElement("br", null), "A measurable direction."), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Battery capacity"), /* @__PURE__ */ React.createElement("span", null, capacity.toLocaleString(), " ", /* @__PURE__ */ React.createElement("small", { className: "mono" }, "mAh"))), /* @__PURE__ */ React.createElement("input", { type: "range", min: "100", max: "10000", step: "100", value: capacity, onChange: (e) => setCapacity(+e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "mm mono" }, /* @__PURE__ */ React.createElement("span", null, "100 mAh"), /* @__PURE__ */ React.createElement("span", null, "10,000 mAh")), /* @__PURE__ */ React.createElement("label", null, /* @__PURE__ */ React.createElement("span", null, "Cycle interval"), /* @__PURE__ */ React.createElement("span", null, interval, " ", /* @__PURE__ */ React.createElement("small", { className: "mono" }, "s"))), /* @__PURE__ */ React.createElement("input", { type: "range", min: "2", max: "60", value: interval, onChange: (e) => setIntervalS(+e.target.value) }), /* @__PURE__ */ React.createElement("div", { className: "mm mono" }, /* @__PURE__ */ React.createElement("span", null, "2 s"), /* @__PURE__ */ React.createElement("span", null, "60 s")), /* @__PURE__ */ React.createElement("button", { className: "assume", onClick: () => setAssume(!assume) }, "Battery assumptions ", /* @__PURE__ */ React.createElement("span", null, assume ? "\u2212" : "+")), assume && /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "3.3 V supply \xB7 76% usable capacity")))))), /* @__PURE__ */ React.createElement("section", { className: "compare", id: "compare" }, /* @__PURE__ */ React.createElement("div", { className: "insight" }, /* @__PURE__ */ React.createElement("span", { className: "arrow" }, "\u21B3"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "OPTIMIZATION INSIGHT \xB7 RULE-BASED"), /* @__PURE__ */ React.createElement("h3", null, "Transmit uses the most energy."), /* @__PURE__ */ React.createElement("p", null, "Explore shorter transmit windows and more sleep time. The optimized pattern is a hypothetical change; measure your board to validate it.")), /* @__PURE__ */ React.createElement("div", { className: "ibtn" }, /* @__PURE__ */ React.createElement("button", { className: "restore", onClick: () => setPattern(pattern === "optimized" ? "standard" : "optimized") }, pattern === "optimized" ? "Restore baseline" : "Try optimization", " ", /* @__PURE__ */ React.createElement("span", null, "\u2197")), /* @__PURE__ */ React.createElement("a", { className: "restore", href: "/workspace" }, "Check my code ", /* @__PURE__ */ React.createElement("span", null, "\u2197")))), /* @__PURE__ */ React.createElement("h2", { className: "big" }, "Better code.", /* @__PURE__ */ React.createElement("br", null), "Longer life."), /* @__PURE__ */ React.createElement("p", { className: "lead" }, "Compare the average load power. Keep the conditions consistent."), /* @__PURE__ */ React.createElement("div", { className: "cmp" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "SIMULATED BASELINE"), /* @__PURE__ */ React.createElement("h3", null, "Standard firmware"), /* @__PURE__ */ React.createElement("b", { className: "num" }, f(b.powerMw), /* @__PURE__ */ React.createElement("small", null, " mW")), /* @__PURE__ */ React.createElement("div", { className: "track" }, /* @__PURE__ */ React.createElement("i", { style: { width: "100%", background: "#9cb3ab" } })), /* @__PURE__ */ React.createElement("p", { className: "mono d" }, f(b.days, 1), " days"), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "projected runtime")), /* @__PURE__ */ React.createElement("p", { className: "delta" }, /* @__PURE__ */ React.createElement("b", null, "\u2193", f(saved, 1), "%"), " less power"), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "CURRENT RUN \xB7 SIMULATION"), /* @__PURE__ */ React.createElement("h3", null, pattern === "optimized" ? "Optimized pattern" : "Standard firmware"), /* @__PURE__ */ React.createElement("b", { className: "num" }, f(s.powerMw), /* @__PURE__ */ React.createElement("small", null, " mW")), /* @__PURE__ */ React.createElement("div", { className: "track" }, /* @__PURE__ */ React.createElement("i", { style: { width: s.powerMw / b.powerMw * 100 + "%", background: "#1a6b5f" } })), /* @__PURE__ */ React.createElement("p", { className: "mono d" }, f(s.days, 1), " days"), /* @__PURE__ */ React.createElement("p", { className: "mono small" }, "projected runtime"))), /* @__PURE__ */ React.createElement("p", { className: "foot" }, "Baseline uses the same board, cycle interval and battery assumptions. Select \u201CTry optimization\u201D to compare the alternate model.")));
}
ReactDOM.createRoot(document.getElementById("root")).render(/* @__PURE__ */ React.createElement(App, null));
