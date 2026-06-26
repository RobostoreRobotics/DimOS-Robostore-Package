import React, { useEffect, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { getSetting } from "../settings.js";

// SimRC — on-screen replacement for the (lost) physical G1 controller.
//   • Live keyboard control (when ARMED): WASD = left-stick translate,
//     arrows = right-stick turn, streamed to /ws/teleop at 10 Hz — the same
//     engine + speed settings the Control-tab teleop uses.
//   • Click command buttons (Damp / Locked Standing / Run / Walk) call
//     /api/skill -> execute_mode_command. Risky ones need a confirm tap.
//   • Diagram: keyboard keycaps overlaid on the controller silhouette; the
//     two stick chips are LIVE, the rest are reference labels.

let teleopSock = null;
function sendTeleop(cmd) {
  if (!teleopSock || teleopSock.readyState === WebSocket.CLOSED) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    teleopSock = new WebSocket(`${proto}://${window.location.host}/ws/teleop`);
  }
  if (teleopSock.readyState === WebSocket.OPEN) teleopSock.send(JSON.stringify(cmd));
}

// Keyboard key drawn over each controller button. live = wired to movement now;
// the rest are reference labels (commands fire from the buttons, not these keys).
// x/y are % of the silhouette box — nudge these to align with controller.png.
// Positions are % of the silhouette box, derived from the SVG button coords
// below (viewBox 800×470) so each keycap lands dead-center on its button.
const KEYMAP = [
  // left stick — WASD cross (live)
  { id: "w", keys: "W", x: 18.75, y: 36.2, live: true, note: "forward" },
  { id: "a", keys: "A", x: 15.0, y: 42.5, live: true, note: "strafe left" },
  { id: "s", keys: "S", x: 18.75, y: 48.9, live: true, note: "back" },
  { id: "d", keys: "D", x: 22.5, y: 42.5, live: true, note: "strafe right" },
  // right stick — turn (live)
  { id: "tl", keys: "←", x: 77.5, y: 42.5, live: true, note: "turn left" },
  { id: "tr", keys: "→", x: 85.0, y: 42.5, live: true, note: "turn right" },
  // d-pad — TFGH cross (reference)
  { id: "dt", keys: "T", x: 18.75, y: 61.0, note: "d-pad up" },
  { id: "df", keys: "F", x: 13.8, y: 69.1, note: "d-pad left" },
  { id: "dg", keys: "G", x: 18.75, y: 77.2, note: "d-pad down" },
  { id: "dh", keys: "H", x: 23.7, y: 69.1, note: "d-pad right" },
  // face buttons (reference)
  { id: "fy", keys: "I", x: 81.25, y: 60.2, note: "Y" },
  { id: "fx", keys: "J", x: 76.0, y: 69.1, note: "X" },
  { id: "fb", keys: "L", x: 86.5, y: 69.1, note: "B" },
  { id: "fa", keys: "K", x: 81.25, y: 78.1, note: "A" },
  // shoulders (reference)
  { id: "l1", keys: "Q", x: 31.6, y: 15.3, note: "L1" },
  { id: "l2", keys: "E", x: 41.0, y: 14.0, note: "L2" },
  { id: "r1", keys: "U", x: 59.0, y: 14.0, note: "R1" },
  { id: "r2", keys: "O", x: 68.4, y: 15.3, note: "R2" },
  // bottom buttons (reference)
  { id: "select", keys: "C", x: 13.6, y: 86.6, note: "SELECT" },
  { id: "f1", keys: "V", x: 20.9, y: 86.6, note: "F1" },
  { id: "f3", keys: "N", x: 79.6, y: 86.6, note: "F3" },
  { id: "start", keys: "M", x: 86.9, y: 86.6, note: "START" },
];

function ControllerSVG() {
  return (
    <svg className="ctrl-svg" viewBox="0 0 800 470" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g className="cs-btn">
        <rect x="225" y="60" width="56" height="24" rx="11" />
        <rect x="300" y="54" width="56" height="24" rx="11" />
        <rect x="444" y="54" width="56" height="24" rx="11" />
        <rect x="519" y="60" width="56" height="24" rx="11" />
      </g>
      <path className="cs-body" d="M 215 90 C 130 90 70 120 58 200 C 50 270 70 360 120 420 C 150 452 200 450 250 415 C 300 382 350 365 400 365 C 450 365 500 382 550 415 C 600 450 650 452 680 420 C 730 360 750 270 742 200 C 730 120 670 90 585 90 C 500 84 300 84 215 90 Z" />
      <rect className="cs-screen" x="288" y="150" width="224" height="200" rx="14" />
      <circle className="cs-ring" cx="150" cy="200" r="52" />
      <circle className="cs-knob" cx="150" cy="200" r="33" />
      <circle className="cs-ring" cx="650" cy="200" r="52" />
      <circle className="cs-knob" cx="650" cy="200" r="33" />
      <path className="cs-btn" d="M 134 275 H 166 V 309 H 200 V 341 H 166 V 375 H 134 V 341 H 100 V 309 H 134 Z" />
      <circle className="cs-btn" cx="650" cy="283" r="22" />
      <circle className="cs-btn" cx="608" cy="325" r="22" />
      <circle className="cs-btn" cx="692" cy="325" r="22" />
      <circle className="cs-btn" cx="650" cy="367" r="22" />
      <rect className="cs-pill" x="86" y="398" width="46" height="18" rx="9" />
      <rect className="cs-pill" x="144" y="398" width="46" height="18" rx="9" />
      <rect className="cs-pill" x="614" y="398" width="46" height="18" rx="9" />
      <rect className="cs-pill" x="672" y="398" width="46" height="18" rx="9" />
      <circle className="cs-led" cx="110" cy="432" r="5" />
      <circle className="cs-led" cx="150" cy="432" r="5" />
      <circle className="cs-led" cx="650" cy="432" r="5" />
      <circle className="cs-led" cx="690" cy="432" r="5" />
    </svg>
  );
}

// Clickable command buttons -> execute_mode_command. risky => confirm tap.
// Damp(1) + LockedStanding(4) must be added to skill_container.py first (then
// each verified live on the robot before they're trustworthy).
const COMMANDS = [
  { api: "Damp", label: "Damp", sub: "soft e-stop · motors limp", risky: true, icon: "power", tone: "danger" },
  { api: "LockedStanding", label: "Locked Standing", sub: "stand & lock joints", risky: false, icon: "stand", tone: "safe" },
  { api: "RunMode", label: "Run", sub: "operation mode (FSM 801)", risky: true, icon: "run", tone: "go" },
  { api: "WalkMode", label: "Walk", sub: "walk mode (FSM 500)", risky: true, icon: "walk", tone: "go" },
  { api: "WalkControlWaist", label: "Walk + Waist", sub: "waist control (FSM 501)", risky: true, icon: "walk", tone: "go" },
];

// Combos shown in the keyboard vocabulary from the diagram above
// (L2→E, L1→Q, R1→U, R2→O, B→L, A→K, X→J, Y→I, Up→T, Down→G).
const VERIFIED = [
  { combo: "E + L", action: "Damp / soft e-stop (motors limp)" },
  { combo: "E + T", action: "Locked standing" },
  { combo: "O + K", action: "Run / operation mode (FSM 801)" },
  { combo: "E + O", action: "Debug mode — AVOID", warn: true },
];

const REFERENCE = [
  { combo: "Q + L", action: "Zero-moment mode" },
  { combo: "Q + K", action: "Damping" },
  { combo: "Q + G", action: "Seated" },
  { combo: "Q + J", action: "Lie → stand" },
  { combo: "Q + I", action: "Squat ↔ stand" },
  { combo: "C + I", action: "Wave hand" },
  { combo: "C + K", action: "Handshake" },
  { combo: "C + J", action: "Turn around + wave" },
  { combo: "U + J", action: "1-DOF waist" },
  { combo: "U + I", action: "3-DOF waist" },
  { combo: "M", action: "Standing (click) · keep-stepping (double)" },
  { combo: "E / Q ×2", action: "Low / high speed" },
];

export default function SimRCTab() {
  const [armed, setArmed] = useState(false);
  const [confirmName, setConfirmName] = useState(null);
  const [busy, setBusy] = useState(null);
  const [last, setLast] = useState(null);
  const cmdRef = useRef({ x: 0, y: 0, yaw: 0 });
  const keysRef = useRef(new Set());
  const confirmTimer = useRef(null);

  // 10 Hz teleop stream while armed; one zero frame on disarm/unmount.
  useEffect(() => {
    if (!armed) return undefined;
    let sentZero = false;
    const iv = setInterval(() => {
      const c = cmdRef.current;
      const active = c.x !== 0 || c.y !== 0 || c.yaw !== 0;
      if (active) {
        sendTeleop(c);
        sentZero = false;
      } else if (!sentZero) {
        sendTeleop({ x: 0, y: 0, yaw: 0 });
        sentZero = true;
      }
    }, 100);
    return () => {
      clearInterval(iv);
      sendTeleop({ x: 0, y: 0, yaw: 0 });
      cmdRef.current = { x: 0, y: 0, yaw: 0 };
      keysRef.current.clear();
    };
  }, [armed]);

  // Keyboard: WASD = translate (left stick), arrows = turn (right stick).
  useEffect(() => {
    if (!armed) return undefined;
    const MOVE = new Set(["w", "a", "s", "d", "arrowleft", "arrowright"]);
    const recompute = () => {
      const k = keysRef.current;
      const fwd = getSetting("teleop.fwd", 0.35);
      const strafe = getSetting("teleop.strafe", 0.2);
      const yaw = getSetting("teleop.yaw", 0.6);
      cmdRef.current = {
        x: (k.has("w") ? fwd : 0) + (k.has("s") ? -fwd : 0),
        y: (k.has("a") ? strafe : 0) + (k.has("d") ? -strafe : 0),
        yaw: (k.has("arrowleft") ? yaw : 0) + (k.has("arrowright") ? -yaw : 0),
      };
    };
    const down = (ev) => {
      if (ev.target.closest("input, textarea")) return;
      const key = ev.key.toLowerCase();
      if (MOVE.has(key)) {
        keysRef.current.add(key);
        recompute();
        ev.preventDefault();
      }
    };
    const up = (ev) => {
      const key = ev.key.toLowerCase();
      if (MOVE.has(key)) {
        keysRef.current.delete(key);
        recompute();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [armed]);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const runCmd = async (api, label) => {
    setBusy(api);
    setLast(null);
    try {
      const res = await fetch("/api/skill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "execute_mode_command", args: { command_name: api } }),
      });
      const data = await res.json();
      setLast(`${label}: ${data.ok ? (data.result ?? "sent") : (data.error ?? "failed")}`);
    } catch {
      setLast(`${label}: bridge unreachable`);
    }
    setBusy(null);
  };

  const onCmd = (cmd) => {
    if (busy) return;
    if (cmd.risky && confirmName !== cmd.api) {
      setConfirmName(cmd.api);
      clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmName(null), 4000);
      return;
    }
    clearTimeout(confirmTimer.current);
    setConfirmName(null);
    runCmd(cmd.api, cmd.label);
  };

  return (
    <div className="simrc-tab">
      <div className="panel simrc-hero">
        <h3>
          Controller Map
          <span className="seg sm">
            <button className={armed ? "active" : ""} onClick={() => setArmed(true)}>
              <Icon name="keyboard" size={14} />Armed
            </button>
            <button className={!armed ? "active" : ""} onClick={() => setArmed(false)}>
              Off
            </button>
          </span>
        </h3>
        <div className="simrc-stage">
          <ControllerSVG />
          {KEYMAP.map((b) => (
            <span
              key={b.id}
              className={`kcap ${b.live ? "live" : ""}`}
              style={{ left: `${b.x}%`, top: `${b.y}%` }}
              title={b.note}
            >
              {b.keys}
            </span>
          ))}
          {armed && (
            <div className="banner simrc-armed">
              <span className="dot warn" /> keyboard armed — keys now move the robot
            </div>
          )}
        </div>
        <div className="simrc-hint">
          <span className="kcap live">W A S D</span> move
          <span style={{ color: "var(--txt-3)" }}>·</span>
          <span className="kcap live">{"← →"}</span> turn
          {!armed && <em>— arm the keyboard to drive</em>}
        </div>
      </div>

      <div className="simrc-bottom">
        <div className="panel">
          <h3>Controls</h3>
          <div className="crefsub">Verified on this robot · FW V1.0.4</div>
          {VERIFIED.map((r) => (
            <div className={`kvline ${r.warn ? "warn" : ""}`} key={r.combo}>
              <span className="combo">{r.combo}</span>
              <b>{r.action}</b>
            </div>
          ))}
          <div className="crefsub ref">Printed-card reference — NOT verified on our firmware; combos may differ</div>
          {REFERENCE.map((r) => (
            <div className="kvline ref" key={r.combo}>
              <span className="combo">{r.combo}</span>
              <b>{r.action}</b>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>Commands</h3>
          <div className="setnote">
            Click to issue an FSM command — these move the robot. Risky ones (Damp / Run / Walk) need a confirm tap.
          </div>
          <div className="cmdgrid">
            {COMMANDS.map((c) => {
              const confirming = confirmName === c.api;
              const isBusy = busy === c.api;
              return (
                <button
                  key={c.api}
                  className={`cmdbtn ctl ${confirming ? "confirm" : ""} ${c.risky ? "risky" : ""}`}
                  disabled={!!busy && !isBusy}
                  onClick={() => onCmd(c)}
                  title={c.sub}
                >
                  <span className={`cmdicon ${c.tone}`}>
                    <Icon name={c.icon} size={18} />
                  </span>
                  <span className="cl">
                    <b>{isBusy ? "…" : confirming ? `Confirm ${c.label}?` : c.label}</b>
                    <small>{confirming ? "tap again to run · auto-cancels" : c.sub}</small>
                  </span>
                </button>
              );
            })}
          </div>
          {last && <div className="cmdlast num" title={last}>{last}</div>}
        </div>
      </div>
    </div>
  );
}
