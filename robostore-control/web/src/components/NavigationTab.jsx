import React, { useState } from "react";
import Icon from "../icons.jsx";
import CameraView from "./CameraView.jsx";
import CostmapView from "./CostmapView.jsx";

// Navigation tab: map-dominant with click -> confirm -> go (a misclick never
// moves the robot), session-scoped saved points, go-home, exploration.

function fmt(v, d = 2) {
  return v === null || v === undefined || Number.isNaN(v) ? "—" : v.toFixed(d);
}

async function api(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return await res.json();
  } catch {
    return { ok: false, error: "bridge unreachable" };
  }
}

const STATE_CLASS = { "no path": "alert", arrived: "ok" };

export default function NavigationTab({ state }) {
  const [zoom, setZoom] = useState(1);
  const [follow, setFollow] = useState(false);
  const [gridOn, setGridOn] = useState(true);
  const [glowOn, setGlowOn] = useState(true);
  const [pending, setPending] = useState(null); // clicked, unconfirmed goal
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [robotSaveName, setRobotSaveName] = useState("");
  const [busy, setBusy] = useState(null);
  const [lastMsg, setLastMsg] = useState(null);

  const nav = state?.nav || {};
  const odom = state?.odom;
  const points = state?.points || [];
  const speed = state?.speed;
  const eta = nav.distance != null && speed > 0.08 ? nav.distance / speed : null;
  const pendingDist =
    pending && odom ? Math.hypot(pending.x - odom.x, pending.y - odom.y) : null;

  const walkTo = async (x, y, label) => {
    setBusy("walk");
    const r = await api("/api/goal", { x, y });
    setLastMsg(r.ok ? `goal sent${label ? ` → ${label}` : ""}` : r.error);
    setBusy(null);
    setPending(null);
    setSaveMode(false);
  };

  const savePending = async () => {
    const name = saveName.trim();
    if (!name || !pending) return;
    const r = await api("/api/points", { name, x: pending.x, y: pending.y });
    setLastMsg(r.ok ? `saved "${name}"` : r.error);
    setSaveName("");
    setSaveMode(false);
    setPending(null);
  };

  const saveRobotPos = async () => {
    const name = robotSaveName.trim();
    if (!name || !odom) return;
    const r = await api("/api/points", { name, x: odom.x, y: odom.y, tag: true });
    setLastMsg(r.ok ? `saved "${name}"${r.tag_result ? " · tagged for Larry" : ""}` : r.error);
    setRobotSaveName("");
  };

  const deletePoint = async (name) => {
    const r = await api("/api/points/delete", { name });
    setLastMsg(r.ok ? `deleted "${name}"` : r.error);
  };

  const goHome = () => {
    const home = points.find((p) => p.name.toLowerCase() === "home");
    walkTo(home ? home.x : 0, home ? home.y : 0, home ? "Home" : "origin");
  };

  const stopNav = async () => {
    setBusy("stop");
    const r = await api("/api/nav/stop");
    setLastMsg(r.ok ? "goal cancelled" : r.error);
    setBusy(null);
  };

  const explore = async (action) => {
    setBusy("explore");
    const r = await api("/api/explore", { action });
    setLastMsg(r.ok ? r.result : r.error);
    setBusy(null);
  };

  const distTo = (p) => (odom ? Math.hypot(p.x - odom.x, p.y - odom.y) : null);

  return (
    <div className="navtab">
      {/* ============ the map ============ */}
      <div className="viewpanel">
        <CostmapView
          odom={odom}
          path={state?.path}
          goal={nav.goal}
          goalReached={state?.goal_reached}
          zoom={zoom}
          follow={follow}
          gridOn={gridOn}
          glowOn={glowOn}
          markers={points}
          pending={pending}
          onWorldClick={(x, y) => {
            setPending({ x, y });
            setSaveMode(false);
          }}
        />
        <div className="ovl colstack" style={{ top: 12, right: 12 }}>
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
        </div>

        {nav.exploring && (
          <div className="ovl" style={{ top: 12, left: "50%", transform: "translateX(-50%)" }}>
            <div className="banner">exploring — other commands blocked until ended</div>
          </div>
        )}

        {pending && (
          <div className="ovl goalpop" style={{ bottom: 16, left: "50%", transform: "translateX(-50%)" }}>
            <span className="num">({pending.x.toFixed(2)}, {pending.y.toFixed(2)})</span>
            {pendingDist != null && <span className="dim num">{pendingDist.toFixed(2)} m away</span>}
            {saveMode ? (
              <>
                <input
                  className="ptinput"
                  autoFocus
                  value={saveName}
                  placeholder="point name…"
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && savePending()}
                />
                <button className="smallbtn ctl" onClick={savePending}>save</button>
              </>
            ) : (
              <>
                <button className="walkbtn" disabled={busy === "walk"} onClick={() => walkTo(pending.x, pending.y)}>
                  <Icon name="flag" size={13} />Walk here
                </button>
                <button className="smallbtn ctl" onClick={() => setSaveMode(true)}>
                  <Icon name="pin" size={13} />save point
                </button>
              </>
            )}
            <button className="iconbtn ctl" onClick={() => { setPending(null); setSaveMode(false); }} title="Cancel">
              <Icon name="plus" style={{ transform: "rotate(45deg)" }} />
            </button>
          </div>
        )}
      </div>

      {/* ============ side column ============ */}
      <div className="sidecol">
        <div className="viewpanel campanel">
          <CameraView detections={state?.detections} showBoxes />
        </div>

        <div className="panel">
          <h3>Navigation</h3>
          <span className={`statebadge`} style={STATE_CLASS[nav.state] === "alert" ? { color: "var(--red)", borderColor: "rgba(229,72,77,.4)", background: "rgba(229,72,77,.1)" } : undefined}>
            <span className="dot" style={{ width: 6, height: 6 }} />
            {(nav.state || "idle").toUpperCase()}
          </span>
          <div className="kv">
            <span className="k">goal</span>
            <span className="v num" style={{ fontSize: 13 }}>
              {nav.goal ? `(${fmt(nav.goal.x)}, ${fmt(nav.goal.y)})` : "—"}
            </span>
            <span className="k">distance</span>
            <span className="v num">{fmt(nav.distance)}<small>m</small></span>
            <span className="k">ETA</span>
            <span className="v num">{eta != null ? Math.ceil(eta) : "—"}<small>s</small></span>
          </div>
          <div className="btnrow" style={{ marginTop: 10 }}>
            <button className="smallbtn ctl" disabled={busy === "stop"} onClick={stopNav}>
              <Icon name="stop" size={11} />stop nav
            </button>
            <button className="smallbtn ctl" disabled={busy === "walk"} onClick={goHome}>
              <Icon name="follow" size={13} />go home
            </button>
          </div>
        </div>

        <div className="panel pointspanel">
          <h3>Saved points <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none" }}>session</span></h3>
          <div className="ptlist">
            {points.length === 0 && <div className="ptempty">No points yet — click the map and "save point", or save the robot's position below.</div>}
            {points.map((p) => (
              <div className="ptrow" key={p.name}>
                <span className="nm" title={`(${fmt(p.x)}, ${fmt(p.y)})`}>{p.name}</span>
                <span className="d num">{fmt(distTo(p), 1)} m</span>
                <button className="iconbtn ctl" title={`Walk to ${p.name}`} onClick={() => walkTo(p.x, p.y, p.name)}>
                  <Icon name="flag" />
                </button>
                <button className="iconbtn ctl" title="Delete" onClick={() => deletePoint(p.name)}>
                  <Icon name="trash" />
                </button>
              </div>
            ))}
          </div>
          <div className="btnrow">
            <input
              className="ptinput"
              style={{ flex: 1, width: "auto" }}
              value={robotSaveName}
              placeholder="save robot position as…"
              onChange={(e) => setRobotSaveName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && saveRobotPos()}
            />
            <button className="smallbtn ctl" onClick={saveRobotPos} disabled={!robotSaveName.trim()}>
              <Icon name="pin" size={13} />save
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Exploration</h3>
          <div className="btnrow">
            {!nav.exploring ? (
              <button className="smallbtn ctl" disabled={busy === "explore"} onClick={() => explore("begin")}>
                <Icon name="route" size={13} />begin exploration
              </button>
            ) : (
              <button className="smallbtn ctl on" disabled={busy === "explore"} onClick={() => explore("end")}>
                <Icon name="stop" size={11} />end exploration
              </button>
            )}
          </div>
        </div>

        <div className="navmsg num">{lastMsg || ""}</div>
      </div>
    </div>
  );
}
