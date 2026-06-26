import React from "react";
import Icon from "../icons.jsx";

function fmt(v, digits = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function Tile({ icon, label, value, unit, mono = true }) {
  return (
    <div className="mini">
      <span className="lbl"><Icon name={icon} />{label}</span>
      <span className={`val ${mono ? "num" : ""}`}>
        {value}
        {unit && <small>{unit}</small>}
      </span>
    </div>
  );
}

const STATE_CLASS = { "no path": "alert", arrived: "ok" };

export default function TelemetryGrid({ state }) {
  const odom = state?.odom;
  const nav = state?.nav || { state: "idle", distance: null };
  const headingDeg = odom ? ((odom.yaw * 180) / Math.PI) : null;

  return (
    <div className="panel">
      <h3>Telemetry</h3>
      <div className="minigrid">
        <Tile icon="axis" label="Position X" value={fmt(odom?.x)} unit="m" />
        <Tile icon="axis" label="Position Y" value={fmt(odom?.y)} unit="m" />
        <Tile icon="compass" label="Heading" value={fmt(headingDeg, 1)} unit="°" />
        <Tile icon="gauge" label="Speed" value={fmt(state?.speed)} unit="m/s" />
        <div className={`mini state ${STATE_CLASS[nav.state] || ""}`}>
          <span className="lbl"><Icon name="route" />Nav State</span>
          <span className="val">{nav.state}</span>
        </div>
        <Tile icon="flag" label="Goal Dist" value={fmt(nav.distance)} unit="m" />
      </div>
    </div>
  );
}
