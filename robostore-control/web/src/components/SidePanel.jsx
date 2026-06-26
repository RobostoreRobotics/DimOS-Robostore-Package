import React, { useState } from "react";
import TelemetryStrip from "./TelemetryStrip.jsx";
import ChatPanel from "./ChatPanel.jsx";
import QuickActions from "./QuickActions.jsx";

export default function SidePanel({ state }) {
  const [stopping, setStopping] = useState(false);

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
    <div className="side-panel">
      <TelemetryStrip state={state} />
      <ChatPanel />
      <QuickActions />
      <button className={`stop-btn ${stopping ? "busy" : ""}`} onClick={onStop}>
        {stopping ? "⏹ STOPPING…" : "■ STOP"}
      </button>
    </div>
  );
}
