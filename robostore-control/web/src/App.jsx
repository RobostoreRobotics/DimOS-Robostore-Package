import React, { useEffect, useState } from "react";
import { subscribeWS } from "./ws.js";
import { loadSettings } from "./settings.js";
import TopBar from "./components/TopBar.jsx";
import ControlTab from "./components/ControlTab.jsx";
import NavigationTab from "./components/NavigationTab.jsx";
import SettingsTab from "./components/SettingsTab.jsx";
import DiagnosticsTab from "./components/DiagnosticsTab.jsx";
import SimRCTab from "./components/SimRCTab.jsx";
import AgentPanel from "./components/AgentPanel.jsx";

function Splash({ reason }) {
  return (
    <div className="splash">
      <div className="inner">
        <img src="/logo.png" alt="" />
        <div className="name">RoboDimOS <b>Control</b></div>
        <div className="sub">
          <span className="dots"><i /><i /><i /></span>
          {reason}
        </div>
      </div>
    </div>
  );
}

function PlaceholderTab({ name }) {
  return <div className="placeholder-tab">{name} — coming in the next build phase</div>;
}

export default function App() {
  const [state, setState] = useState(null);
  const [tab, setTab] = useState("control");

  useEffect(() => {
    loadSettings();
    return subscribeWS("/ws/state", (data) => {
      try {
        setState(JSON.parse(data));
      } catch {
        /* ignore malformed frames */
      }
    });
  }, []);

  // Minimal splash until the bridge answers AND the DimOS stack is streaming.
  if (!state) return <Splash reason="connecting to bridge…" />;
  if (!state.online) return <Splash reason="stack offline — waiting for DimOS" />;

  return (
    <div className="app">
      <TopBar tab={tab} setTab={setTab} state={state} />
      <div className="content">
        <div className="tabwrap">
          {tab === "control" && <ControlTab state={state} />}
          {tab === "navigation" && <NavigationTab state={state} />}
          {tab === "settings" && <SettingsTab />}
          {tab === "diagnostics" && <DiagnosticsTab state={state} />}
          {tab === "simrc" && <SimRCTab />}
        </div>
        <AgentPanel />
      </div>
    </div>
  );
}
