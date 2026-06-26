import React, { useState } from "react";

// The G1 firmware's full arm-preset vocabulary (verified against SDK source).
const ARM_PRESETS = [
  "HighWave", "FaceWave", "Clap", "HighFive", "Handshake", "Hug", "HandsUp",
  "ArmHeart", "RightHeart", "RightHandUp", "LeftKiss", "XRay", "Reject", "CancelAction",
];

const LS_KEY = "rdc.quickActions";
const DEFAULTS = ["HighWave", "HandsUp", "Clap", "CancelAction"];

function loadSelection() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY));
    if (Array.isArray(v) && v.every((s) => ARM_PRESETS.includes(s))) return v;
  } catch {
    /* fall through to defaults */
  }
  return DEFAULTS;
}

export default function QuickActions() {
  const [selected, setSelected] = useState(loadSelection);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null);

  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    setSelected(next);
    localStorage.setItem(LS_KEY, JSON.stringify(next));
  };

  const run = async (name) => {
    if (busy) return;
    setBusy(name);
    setLast(null);
    try {
      const res = await fetch("/api/skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "execute_arm_command", args: { command_name: name } }),
      });
      const data = await res.json();
      setLast(`${name}: ${data.ok ? data.result : data.error}`);
    } catch {
      setLast(`${name}: bridge unreachable`);
    }
    setBusy(null);
  };

  return (
    <div className="card">
      <h3>
        Quick Actions
        <button onClick={() => setEditing(!editing)}>{editing ? "done" : "⚙ edit"}</button>
      </h3>
      {editing ? (
        <div className="qa-editor">
          {ARM_PRESETS.map((name) => (
            <label key={name}>
              <input
                type="checkbox"
                checked={selected.includes(name)}
                onChange={() => toggle(name)}
              />
              {name}
            </label>
          ))}
        </div>
      ) : (
        <div className="qa-grid">
          {selected.map((name) => (
            <button key={name} className="qa-btn" disabled={!!busy} onClick={() => run(name)}>
              {busy === name ? "…" : name}
            </button>
          ))}
          {selected.length === 0 && <div className="placeholder">No presets — ⚙ edit</div>}
        </div>
      )}
      {last && <div className="qa-result" title={last}>{last}</div>}
    </div>
  );
}
