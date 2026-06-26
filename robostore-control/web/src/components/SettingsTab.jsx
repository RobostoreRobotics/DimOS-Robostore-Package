import React, { useEffect, useRef, useState } from "react";
import { getSetting, subscribeSettings, updateSettings } from "../settings.js";
import { ARM_PRESETS } from "./AgentPanel.jsx";

// All settings persist in the bridge's settings.json — global for every device.

function patchFor(path, value) {
  const keys = path.split(".");
  const root = {};
  let node = root;
  keys.forEach((k, i) => {
    node[k] = i === keys.length - 1 ? value : {};
    node = node[k];
  });
  return root;
}

function useSetting(path, fallback) {
  const [val, setVal] = useState(() => getSetting(path, fallback));
  useEffect(
    () => subscribeSettings(() => setVal(getSetting(path, fallback))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path]
  );
  return val;
}

function SettingSlider({ label, path, min, max, step, unit, fallback, digits = 2 }) {
  const remote = useSetting(path, fallback);
  const [local, setLocal] = useState(null);
  const timer = useRef(null);
  const v = local ?? remote;

  const onChange = (e) => {
    const nv = parseFloat(e.target.value);
    setLocal(nv);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await updateSettings(patchFor(path, nv));
      setLocal(null);
    }, 350);
  };

  return (
    <div className="setrow">
      <span>{label}</span>
      <input type="range" className="slider" min={min} max={max} step={step} value={v} onChange={onChange} />
      <span className="val num">{Number(v).toFixed(digits)}{unit}</span>
    </div>
  );
}

function SettingToggle({ label, path, fallback }) {
  const v = useSetting(path, fallback);
  return (
    <div className="setrow toggle">
      <span>{label}</span>
      <span className={`switch ${v ? "on" : ""}`} onClick={() => updateSettings(patchFor(path, !v))} />
    </div>
  );
}

function QuickActionPicker() {
  const selected = useSetting("quick_actions", []);
  const toggle = (name) => {
    const next = selected.includes(name)
      ? selected.filter((s) => s !== name)
      : [...selected, name];
    updateSettings({ quick_actions: next });
  };
  return (
    <div className="qa-editor" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
      {ARM_PRESETS.map((name) => (
        <label key={name}>
          <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} />
          {name}
        </label>
      ))}
    </div>
  );
}

export default function SettingsTab() {
  return (
    <div className="settings-tab">
      <div className="panel">
        <h3>Teleop speeds</h3>
        <div className="setnote">Yaw floor stays above the G1 firmware deadband (~0.4 rad/s) or rotation stalls.</div>
        <SettingSlider label="forward" path="teleop.fwd" min={0.1} max={0.7} step={0.05} unit=" m/s" fallback={0.35} />
        <SettingSlider label="strafe" path="teleop.strafe" min={0.1} max={0.4} step={0.05} unit=" m/s" fallback={0.2} />
        <SettingSlider label="yaw" path="teleop.yaw" min={0.45} max={1.0} step={0.05} unit=" rad/s" fallback={0.6} />
        <SettingSlider label="joystick fwd" path="teleop.joy_fwd" min={0.1} max={0.7} step={0.05} unit=" m/s" fallback={0.4} />
        <SettingSlider label="joystick yaw" path="teleop.joy_yaw" min={0.45} max={1.0} step={0.05} unit=" rad/s" fallback={0.6} />
      </div>

      <div className="panel">
        <h3>Streams</h3>
        <div className="setnote">Lower these for the WiFi operator link; applied live by the bridge.</div>
        <SettingSlider label="JPEG quality" path="jpeg_quality" min={40} max={90} step={5} unit="" fallback={70} digits={0} />
        <SettingSlider label="3D map points" path="map_point_cap" min={50000} max={300000} step={25000} unit="" fallback={150000} digits={0} />
        <SettingSlider label="3D scan points" path="scan_point_cap" min={5000} max={50000} step={5000} unit="" fallback={20000} digits={0} />
      </div>

      <div className="panel">
        <h3>Person detection</h3>
        <SettingToggle label="YOLO overlay on at load" path="yolo.default_on" fallback={true} />
        <SettingSlider label="min confidence" path="yolo.min_score" min={0} max={0.9} step={0.05} unit="" fallback={0.4} />
        <div className="setnote">Inactive for now — DimOS ships detections without scores; the filter only applies if scores ever appear on the wire.</div>
      </div>

      <div className="panel">
        <h3>Agent chat</h3>
        <SettingSlider label="text size" path="chat.text_size" min={12} max={16} step={0.5} unit=" px" fallback={13} digits={1} />
        <SettingToggle label="tool details expanded" path="chat.tools_expanded" fallback={false} />
      </div>

      <div className="panel">
        <h3>Navigation</h3>
        <SettingToggle label="saved robot-position points also tag_location (Larry can walk to them by name)" path="save_points_tag_location" fallback={false} />
      </div>

      <div className="panel">
        <h3>Quick actions</h3>
        <div className="setnote">Buttons shown under the agent chat, on every device.</div>
        <QuickActionPicker />
      </div>
    </div>
  );
}
