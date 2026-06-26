import React, { useEffect, useRef, useState } from "react";
import Icon from "../icons.jsx";
import { subscribeSettings } from "../settings.js";
import CameraView from "./CameraView.jsx";
import CostmapView from "./CostmapView.jsx";
import CloudView from "./CloudView.jsx";
import DepthView from "./DepthView.jsx";
import TeleopControl from "./TeleopControl.jsx";
import TelemetryGrid from "./TelemetryGrid.jsx";
import StreamsPanel from "./StreamsPanel.jsx";

const VIEWS = [
  { id: "camera", label: "Camera", short: "Cam" },
  { id: "costmap", label: "Costmap", short: "Map" },
  { id: "cloud", label: "3D", short: "3D" },
  { id: "depth", label: "Depth", short: "Depth" },
];

const CMAPS = [
  { id: "turbo", label: "Turbo" },
  { id: "viridis", label: "Viridis" },
  { id: "gray", label: "Gray" },
];

export default function ControlTab({ state }) {
  const [mainView, setMainView] = useState("camera");
  const [smallView, setSmallView] = useState("costmap");

  // Camera chrome
  const [yolo, setYolo] = useState(true);
  const yoloTouched = useRef(false);
  useEffect(
    () =>
      subscribeSettings((s) => {
        if (!yoloTouched.current) setYolo(s?.yolo?.default_on ?? true);
      }),
    []
  );
  const toggleYolo = () => {
    yoloTouched.current = true;
    setYolo((v) => !v);
  };

  // Costmap chrome (view-only on this tab — goal clicks live in Navigation)
  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(false);
  const [gridOn, setGridOn] = useState(true);
  const [glowOn, setGlowOn] = useState(true);

  // 3D chrome
  const [showMap, setShowMap] = useState(true);
  const [showScan, setShowScan] = useState(true);
  const [pointSize, setPointSize] = useState(0.045);
  const cloudRef = useRef(null);

  // Depth chrome
  const [cmap, setCmap] = useState("turbo");
  const [range, setRange] = useState(null);

  // Teleop (main view corner)
  const [teleop, setTeleop] = useState("off");

  // Picking the view the OTHER slot already shows swaps them.
  const pick = (slot, id) => {
    if (slot === "main") {
      if (id === smallView) setSmallView(mainView);
      setMainView(id);
    } else {
      if (id === mainView) setMainView(smallView);
      setSmallView(id);
    }
  };

  const renderView = (id) => {
    switch (id) {
      case "camera":
        return <CameraView detections={state?.detections} showBoxes={yolo} />;
      case "costmap":
        return (
          <CostmapView
            odom={state?.odom}
            path={state?.path}
            goal={state?.nav?.goal}
            goalReached={state?.goal_reached}
            zoom={zoom}
            follow={follow}
            gridOn={gridOn}
            glowOn={glowOn}
          />
        );
      case "cloud":
        return (
          <CloudView
            ref={cloudRef}
            odom={state?.odom}
            showMap={showMap}
            showScan={showScan}
            pointSize={pointSize}
          />
        );
      case "depth":
        return <DepthView cmap={cmap} onRange={setRange} />;
      default:
        return null;
    }
  };

  const viewPicker = (slot, active) => (
    <div className="ovl" style={{ top: slot === "main" ? 12 : 8, left: slot === "main" ? 12 : 8 }}>
      <div className={`seg ovl-seg ${slot === "small" ? "sm" : ""}`}>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={active === v.id ? "active" : ""}
            onClick={() => pick(slot, v.id)}
          >
            {slot === "main" ? v.label : v.short}
          </button>
        ))}
      </div>
    </div>
  );

  // Per-view edge chrome. Camera gets full chrome on main only; the data
  // views carry their controls in both slots (compact in the small slot).
  const chrome = (id, slot) => {
    const main = slot === "main";
    const pad = main ? 12 : 8;
    const out = [];

    if (id === "camera" && main) {
      out.push(
        <div key="resfps" className="ovl" style={{ top: 56, left: pad }}>
          <div className="badge ctl">
            <span className="num">{state?.res ? `${state.res[0]}×${state.res[1]}` : "—"}</span>
            <span style={{ color: "var(--txt-3)" }}>·</span>
            <span className="num">{state?.rates?.camera?.hz ? `${state.rates.camera.hz.toFixed(1)} FPS` : "—"}</span>
          </div>
        </div>,
        <div key="yolo" className="ovl" style={{ top: pad, right: pad }}>
          <div className={`badge ctl click ${yolo ? "on" : ""}`} onClick={toggleYolo}>
            <span className={`switch ${yolo ? "on" : ""}`} />
            <Icon name="eye" size={14} />
            persons <span className="num">{yolo ? (state?.detections?.length ?? 0) : "—"}</span>
          </div>
        </div>
      );
    }

    if (id === "costmap") {
      out.push(
        <div key="mapctl" className="ovl colstack" style={{ top: pad, right: pad }}>
          <button className="iconbtn ctl" onClick={() => setZoom((z) => Math.min(z * 1.4, 8))} title="Zoom in">
            <Icon name="plus" />
          </button>
          <button className="iconbtn ctl" onClick={() => setZoom((z) => Math.max(z / 1.4, 1))} title="Zoom out">
            <Icon name="minus" />
          </button>
          <button className="iconbtn ctl" onClick={() => { setZoom(1); setFollow(false); }} title="Fit map">
            <Icon name="fit" />
          </button>
          <button className={`iconbtn ctl ${follow ? "on" : ""}`} onClick={() => setFollow((f) => !f)} title="Follow robot">
            <Icon name="follow" />
          </button>
          <button className={`iconbtn ctl ${gridOn ? "on" : ""}`} onClick={() => setGridOn((v) => !v)} title="Metric grid + scale bar">
            <Icon name="grid" />
          </button>
          <button className={`iconbtn ctl ${glowOn ? "on" : ""}`} onClick={() => setGlowOn((v) => !v)} title="Obstacle glow">
            <Icon name="glow" />
          </button>
        </div>,
        <div key="legend" className="ovl" style={{ bottom: pad, left: pad }}>
          <div className="legend ctl">
            <span className="lg"><span className="swatch" style={{ background: "#0a0c0e", border: "1px solid #2a2e34" }} />unknown</span>
            <span className="lg"><span className="swatch" style={{ background: "#1a2028", border: "1px solid #2a2e34" }} />free</span>
            <span className="lg"><span className="swatch" style={{ background: "#e8b54d" }} />cost</span>
            <span className="lg"><span className="swatch" style={{ background: "#e5484d" }} />lethal</span>
          </div>
        </div>
      );
    }

    if (id === "cloud") {
      out.push(
        <div key="cloudctl" className="ovl colstack" style={{ top: pad, right: pad }}>
          <button className="iconbtn ctl" onClick={() => cloudRef.current?.recenter()} title="Recenter on robot">
            <Icon name="follow" />
          </button>
          <button className={`iconbtn ctl ${showMap ? "on" : ""}`} onClick={() => setShowMap((v) => !v)} title="Toggle SLAM map layer">
            <Icon name="layers" />
          </button>
          <button className={`iconbtn ctl ${showScan ? "on" : ""}`} onClick={() => setShowScan((v) => !v)} title="Toggle live scan layer">
            <Icon name="route" />
          </button>
        </div>
      );
      if (main) {
        out.push(
          <div key="size" className="ovl rowstack" style={{ bottom: pad, left: pad }}>
            <div className="hlegend ctl" title="Point color by height above the floor">
              <span className="num">0m</span>
              <span className="hbar" />
              <span className="num">2.7m</span>
            </div>
            <div className="sizepop ctl" title="Point definition — rendered size/brightness, not point count">
              definition
              <input
                type="range"
                className="slider"
                min="0.02"
                max="0.12"
                step="0.005"
                value={pointSize}
                onChange={(e) => setPointSize(parseFloat(e.target.value))}
              />
            </div>
          </div>
        );
      }
    }

    if (id === "depth" && main) {
      out.push(
        <div key="cmap" className="ovl rowstack" style={{ top: pad, right: pad }}>
          {range && (
            <div className="badge ctl" title="5–95 percentile of the live frame (sensor units assumed mm)">
              <Icon name="palette" size={13} />
              <span className="num">~{(range.lo / 1000).toFixed(1)}–{(range.hi / 1000).toFixed(1)} m</span>
            </div>
          )}
          <div className="seg ovl-seg sm">
            {CMAPS.map((c) => (
              <button key={c.id} className={cmap === c.id ? "active" : ""} onClick={() => setCmap(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      );
    }

    return out;
  };

  return (
    <div className="control-tab">
      <div className="viewpanel">
        {renderView(mainView)}
        {viewPicker("main", mainView)}
        {chrome(mainView, "main")}
        {/* Teleop belongs to the main panel's corner regardless of which
            view it shows — the armed state must never be invisible. */}
        <div className="ovl" style={{ bottom: 12, right: 12 }}>
          <div className="seg ovl-seg">
            <button className={teleop === "keys" ? "active" : ""} onClick={() => setTeleop("keys")}>
              <Icon name="keyboard" size={15} />Keys
            </button>
            <button className={teleop === "stick" ? "active" : ""} onClick={() => setTeleop("stick")}>
              <Icon name="stick" size={15} />Stick
            </button>
            <button className={teleop === "off" ? "active" : ""} onClick={() => setTeleop("off")}>
              Off
            </button>
          </div>
        </div>
        {teleop === "keys" && (
          <div className="ovl" style={{ bottom: 14, left: "50%", transform: "translateX(-50%)" }}>
            <div className="keyhint ctl">WASD drive · Q/E strafe · A/D turn</div>
          </div>
        )}
        <div className="ovl" style={{ bottom: 60, right: 12 }}>
          <TeleopControl mode={teleop} />
        </div>
      </div>
      <div className="strip">
        <div className="viewpanel">
          {renderView(smallView)}
          {viewPicker("small", smallView)}
          {chrome(smallView, "small")}
        </div>
        <TelemetryGrid state={state} />
        <StreamsPanel state={state} />
      </div>
    </div>
  );
}
