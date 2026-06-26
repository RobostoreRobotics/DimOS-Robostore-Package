import React, { useState } from "react";
import Icon from "../icons.jsx";

const TABS = [
  { id: "control", label: "Control" },
  { id: "navigation", label: "Navigation" },
  { id: "settings", label: "Settings" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "simrc", label: "SimRC" },
];

function fmtUptime(s) {
  if (s === null || s === undefined) return "—";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}`;
}

export default function TopBar({ tab, setTab, state }) {
  const [stopping, setStopping] = useState(false);
  const online = !!state?.online;

  const onStop = async () => {
    setStopping(true);
    try {
      await fetch("/api/stop", { method: "POST" });
    } catch {
      /* bridge unreachable — nothing else we can do from here */
    }
    setTimeout(() => setStopping(false), 1200);
  };

  return (
    <div className="topbar">
      <div className="brand">
        <img src="/logo.png" alt="" />
        <span className="name">RoboDimOS <b>Control</b></span>
      </div>
      <div className="seg">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="spacer" />
      <div className="chip ctl">
        <span className={`dot ${online ? "" : "bad"}`} />
        {online ? "stack online" : "stack offline"}
      </div>
      <div className="chip ctl">
        run <span className="num">{fmtUptime(state?.uptime)}</span>
      </div>
      <button className={`stopbtn ${stopping ? "busy" : ""}`} onClick={onStop}>
        <Icon name="stop" />{stopping ? "STOPPING" : "STOP"}
      </button>
    </div>
  );
}
