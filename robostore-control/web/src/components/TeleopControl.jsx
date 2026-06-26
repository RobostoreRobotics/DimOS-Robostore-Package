import React, { useEffect, useRef } from "react";
import { getSetting } from "../settings.js";

// Teleop engine + on-screen joystick. The mode (keys / stick / off) is owned
// by the host panel's segmented control. Speeds come from bridge settings;
// the yaw floor must stay above the G1 firmware deadband (~0.4 rad/s).

let socket = null;
function sendCmd(cmd) {
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    socket = new WebSocket(`${proto}://${window.location.host}/ws/teleop`);
  }
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(cmd));
}

export default function TeleopControl({ mode }) {
  const cmdRef = useRef({ x: 0, y: 0, yaw: 0 });
  const keysRef = useRef(new Set());
  const padRef = useRef(null);
  const knobRef = useRef(null);

  // Streaming loop: 10 Hz while a mode is armed; send one zero on release.
  useEffect(() => {
    if (mode === "off") return undefined;
    let sentZero = false;
    const iv = setInterval(() => {
      const c = cmdRef.current;
      const active = c.x !== 0 || c.y !== 0 || c.yaw !== 0;
      if (active) {
        sendCmd(c);
        sentZero = false;
      } else if (!sentZero) {
        sendCmd({ x: 0, y: 0, yaw: 0 });
        sentZero = true;
      }
    }, 100);
    return () => {
      clearInterval(iv);
      sendCmd({ x: 0, y: 0, yaw: 0 });
      cmdRef.current = { x: 0, y: 0, yaw: 0 };
    };
  }, [mode]);

  // Keyboard capture (ignores keys typed into inputs, e.g. the chat box).
  useEffect(() => {
    if (mode !== "keys") return undefined;
    const recompute = () => {
      const k = keysRef.current;
      const fwd = getSetting("teleop.fwd", 0.35);
      const strafe = getSetting("teleop.strafe", 0.2);
      const yaw = getSetting("teleop.yaw", 0.6);
      cmdRef.current = {
        x: (k.has("w") ? fwd : 0) + (k.has("s") ? -fwd : 0),
        y: (k.has("q") ? strafe : 0) + (k.has("e") ? -strafe : 0),
        yaw: (k.has("a") ? yaw : 0) + (k.has("d") ? -yaw : 0),
      };
    };
    const down = (ev) => {
      if (ev.target.closest("input, textarea")) return;
      const key = ev.key.toLowerCase();
      if ("wasdqe".includes(key)) {
        keysRef.current.add(key);
        recompute();
        ev.preventDefault();
      }
    };
    const up = (ev) => {
      keysRef.current.delete(ev.key.toLowerCase());
      recompute();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      keysRef.current.clear();
      cmdRef.current = { x: 0, y: 0, yaw: 0 };
    };
  }, [mode]);

  // On-screen joystick: vertical = forward, horizontal = yaw (left = CCW).
  const onPointerDown = (ev) => {
    ev.currentTarget.setPointerCapture(ev.pointerId);
    movePointer(ev);
  };
  const movePointer = (ev) => {
    const pad = padRef.current;
    if (!pad || ev.buttons === 0) return;
    const rect = pad.getBoundingClientRect();
    let dx = ev.clientX - rect.left - rect.width / 2;
    let dy = ev.clientY - rect.top - rect.height / 2;
    const r = rect.width / 2 - 14;
    const mag = Math.hypot(dx, dy);
    if (mag > r) {
      dx = (dx / mag) * r;
      dy = (dy / mag) * r;
    }
    knobRef.current.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const joyFwd = getSetting("teleop.joy_fwd", 0.4);
    const joyYaw = getSetting("teleop.joy_yaw", 0.6);
    cmdRef.current = { x: -(dy / r) * joyFwd, y: 0, yaw: -(dx / r) * joyYaw };
  };
  const onPointerUp = () => {
    knobRef.current.style.transform = "translate(-50%, -50%)";
    cmdRef.current = { x: 0, y: 0, yaw: 0 };
  };

  if (mode !== "stick") return null;
  return (
    <div
      className="joy-pad"
      ref={padRef}
      onPointerDown={onPointerDown}
      onPointerMove={movePointer}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div className="joy-knob" ref={knobRef} />
    </div>
  );
}
