import React from "react";

const STREAMS = [
  { key: "camera", label: "camera", ageKey: "camera", nominal: 15 },
  { key: "depth", label: "depth", ageKey: "depth", nominal: 15 },
  { key: "costmap", label: "costmap", ageKey: "costmap", nominal: 2 },
  { key: "odom", label: "odom", ageKey: "odom", nominal: 20 },
  { key: "map", label: "cloud·map", ageKey: "map", nominal: 1, wireKey: "cloud" },
  { key: "scan", label: "cloud·scan", ageKey: "scan", nominal: 4, wireKey: "cloud" },
  { key: "detections", label: "detections", ageKey: null, nominal: 2.5 },
];

function fmtUp(s) {
  if (s === null || s === undefined) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

function StreamRow({ row, state }) {
  const age = row.ageKey ? state?.ages?.[row.ageKey] : null;
  const hz = state?.rates?.[row.key]?.hz ?? 0;
  const kbs = state?.rates?.[row.wireKey || row.key]?.kbs;
  const alive = row.ageKey ? age !== null && age !== undefined && age < 3.0 : hz > 0;
  const level = hz / row.nominal;
  const dot = !alive ? "bad" : level < 0.5 ? "warn" : "";
  return (
    <div className="dtr">
      <span className={`dot ${dot}`} />
      <span className="mut">{row.label}</span>
      <span className="num">{hz ? `${hz.toFixed(1)} Hz` : "—"}</span>
      <span className="num mut">/ {row.nominal} Hz</span>
      <span className="num">{kbs ? (kbs >= 1024 ? `${(kbs / 1024).toFixed(1)} MB/s` : `${Math.round(kbs)} kB/s`) : "—"}</span>
      <span className="num mut">{age !== null && age !== undefined ? `${age.toFixed(1)}s ago` : "—"}</span>
    </div>
  );
}

export default function DiagnosticsTab({ state }) {
  const bridge = state?.bridge || {};
  return (
    <div className="diag-tab">
      <div className="panel">
        <h3>Stream health</h3>
        <div className="dtr head">
          <span /><span>stream</span><span>measured</span><span>nominal</span><span>bandwidth</span><span>last msg</span>
        </div>
        {STREAMS.map((row) => (
          <StreamRow key={row.label} row={row} state={state} />
        ))}
      </div>

      <div>
        <div className="panel" style={{ marginBottom: 14 }}>
          <h3>Bridge</h3>
          <div className="kvline"><span>version</span><b className="num">{bridge.version || "—"}</b></div>
          <div className="kvline"><span>uptime</span><b className="num">{fmtUp(bridge.uptime)}</b></div>
          <div className="kvline"><span>connected viewers</span><b className="num">{bridge.viewers ?? "—"}</b></div>
          <div className="kvline"><span>settings</span><b>bridge/settings.json</b></div>
        </div>

        <div className="panel">
          <h3>Stack</h3>
          <div className="kvline"><span>DimOS</span><b>{state?.online ? "online" : "offline"}</b></div>
          <div className="kvline"><span>run uptime</span><b className="num">{fmtUp(state?.uptime)}</b></div>
          <div className="kvline"><span>camera</span><b className="num">{state?.res ? `${state.res[0]}×${state.res[1]}` : "—"}</b></div>
          <div className="kvline"><span>nav state</span><b className="num">{state?.nav?.state || "—"}</b></div>
          <div className="kvline"><span>persons in frame</span><b className="num">{state?.detections?.length ?? 0}</b></div>
          <div className="kvline"><span>saved points</span><b className="num">{state?.points?.length ?? 0}</b></div>
        </div>
      </div>
    </div>
  );
}
