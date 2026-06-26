import React from "react";

// Per-stream nominal rates: the beam shows measured/nominal; its flow
// animation speed tracks the live rate (faster stream = faster flow).
const ROWS = [
  { key: "camera", label: "camera", ageKey: "camera", nominal: 15 },
  { key: "depth", label: "depth", ageKey: "depth", nominal: 15 },
  { key: "costmap", label: "costmap", ageKey: "costmap", nominal: 2 },
  { key: "odom", label: "odom", ageKey: "odom", nominal: 20 },
  { key: "map", label: "cloud", ageKey: "map", nominal: 1, wireKey: "cloud" },
];

function Row({ row, ages, rates }) {
  const age = ages?.[row.ageKey];
  const hz = rates?.[row.key]?.hz ?? 0;
  const kbs = rates?.[row.wireKey || row.key]?.kbs;
  const alive = age !== null && age !== undefined && age < 3.0;
  const level = Math.min(1, hz / row.nominal);
  const cls = !alive ? "dead" : level < 0.5 ? "warn" : "";
  const dotCls = !alive ? "bad" : level < 0.5 ? "warn" : "";
  const flowDur = Math.max(0.35, Math.min(3, 8 / Math.max(hz, 0.1)));
  const rate =
    (hz ? `${hz.toFixed(1)} Hz` : "—") +
    (kbs ? ` · ${kbs >= 1024 ? (kbs / 1024).toFixed(1) + " MB/s" : Math.round(kbs) + " kB/s"}` : "");
  return (
    <div className={`streamrow ${cls}`}>
      <span className="nm"><span className={`dot ${dotCls}`} />{row.label}</span>
      <span className="beam">
        <i style={{ width: `${Math.max(3, Math.round(level * 100))}%`, animationDuration: `${flowDur}s` }} />
      </span>
      <span className="rate num">{alive ? rate : "offline"}</span>
    </div>
  );
}

export default function StreamsPanel({ state }) {
  return (
    <div className="panel">
      <h3>Streams</h3>
      <div className="streamlist">
        {ROWS.map((row) => (
          <Row key={row.key} row={row} ages={state?.ages} rates={state?.rates} />
        ))}
      </div>
    </div>
  );
}
