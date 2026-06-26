import React, { useState } from "react";

function fmt(n, digits = 2) {
  return typeof n === "number" ? n.toFixed(digits) : "—";
}

function ageLabel(age) {
  if (age == null || age > 999) return "no data";
  return age < 3 ? "live" : `${age.toFixed(0)}s stale`;
}

export default function TelemetryStrip({ state }) {
  const [open, setOpen] = useState(true);
  const odom = state?.odom;
  const ages = state?.ages ?? {};

  return (
    <div className="card">
      <h3>
        Telemetry
        <button onClick={() => setOpen(!open)}>{open ? "▾ hide" : "▸ show"}</button>
      </h3>
      {open && (
        <div className="telemetry-grid">
          <span className="k">link</span>
          <span className="v">{state ? (state.online ? "online" : "offline") : "connecting…"}</span>
          <span className="k">x</span>
          <span className="v">{fmt(odom?.x)} m</span>
          <span className="k">y</span>
          <span className="v">{fmt(odom?.y)} m</span>
          <span className="k">yaw</span>
          <span className="v">{odom ? ((odom.yaw * 180) / Math.PI).toFixed(1) : "—"}°</span>
          <span className="k">camera</span>
          <span className="v">{ageLabel(ages.color)}</span>
          <span className="k">costmap</span>
          <span className="v">{ageLabel(ages.costmap)}</span>
          <span className="k">odom</span>
          <span className="v">{ageLabel(ages.odom)}</span>
        </div>
      )}
    </div>
  );
}
