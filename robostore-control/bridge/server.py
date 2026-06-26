"""RoboDimOS Control — bridge server.

Standalone process on the G1 Jetson. Subscribes to the DimOS LCM bus the same
way agentspy/humancli do (no DimOS module machinery), and serves the built web
UI plus live websocket streams on :7780.

Streams:
  /ws/video    binary JPEG frames of /color_image (~15 fps)
  /ws/depth    binary JPEG frames of /depth_image (?cmap=turbo|viridis|gray),
               plus a ~1 Hz text frame {"lo": mm, "hi": mm} for the range badge
  /ws/costmap  binary [4-byte BE header-length][JSON header][zlib int8 grid]
  /ws/cloud    same framing; {kind: map|scan, n, ts}, zlib float32 xyz
  /ws/state    JSON telemetry at ~5 Hz (odom, speed, nav state, rates, ages)
  /ws/chat     agent conversation history/append from the /agent pickle topic
  /ws/teleop   client streams {x,y,yaw} ~10 Hz; bridge zeros on 0.4 s silence

APIs:
  POST /api/goal {x, y}     publish a nav goal (stock dashboard recipe)
  POST /api/stop            software all-stop (nav + teleop zero + MCP legs)
  POST /api/chat {message}  agent_send via MCP
  POST /api/skill {name, args}  direct MCP skill call (quick actions)
  GET/POST /api/settings    panel settings, persisted in bridge/settings.json

Run with the dimos venv python (needs dimos msgs + cv2 + fastapi):
  ~/dimos-dev/.venv/bin/python ~/robostore-control/bridge/server.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import math
import struct
import threading
import time
import zlib
from collections import deque
from pathlib import Path as FsPath
from typing import Any

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.geometry_msgs.Twist import Twist
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.nav_msgs.OccupancyGrid import OccupancyGrid
from dimos.msgs.nav_msgs.Path import Path
from dimos.msgs.sensor_msgs.Image import Image
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.msgs.std_msgs.Bool import Bool
from dimos.msgs.vision_msgs.Detection2DArray import Detection2DArray
from dimos.protocol.pubsub.impl.lcmpubsub import LCM, PickleLCM, Topic

BRIDGE_DIR = FsPath(__file__).resolve().parent
WEB_DIST = BRIDGE_DIR.parent / "web" / "dist"
SETTINGS_PATH = BRIDGE_DIR / "settings.json"
PANEL_VERSION = "2.0.0-control"

STALE_AFTER_S = 3.0   # a stream older than this is reported offline
PATH_STALE_S = 15.0   # drop the path overlay if the planner goes quiet
RATE_WINDOW_S = 5.0   # rolling window for rate/bandwidth meters


# ============================ settings ============================

DEFAULT_SETTINGS: dict[str, Any] = {
    "jpeg_quality": 70,
    "map_point_cap": 150_000,
    "scan_point_cap": 20_000,
    # client-side teleop speed limits (m/s, rad/s). Yaw must stay above the
    # G1 firmware deadband (~0.4 rad/s) or rotation stalls.
    "teleop": {"fwd": 0.35, "strafe": 0.20, "yaw": 0.60, "joy_fwd": 0.40, "joy_yaw": 0.60},
    "yolo": {"default_on": True, "min_score": 0.40},
    "chat": {"text_size": 13, "tools_expanded": False},
    "quick_actions": ["HighWave", "HandsUp", "Clap", "CancelAction", "Handshake"],
    "save_points_tag_location": False,
}


class Settings:
    """Bridge-global settings, persisted to settings.json (shallow-merged)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._data = json.loads(json.dumps(DEFAULT_SETTINGS))  # deep copy
        try:
            if SETTINGS_PATH.is_file():
                stored = json.loads(SETTINGS_PATH.read_text())
                self._merge(self._data, stored)
        except (OSError, ValueError) as e:  # corrupt file: keep defaults
            print(f"settings: failed to load ({e}), using defaults")

    @staticmethod
    def _merge(base: dict, extra: dict) -> None:
        for k, v in extra.items():
            if isinstance(v, dict) and isinstance(base.get(k), dict):
                Settings._merge(base[k], v)
            else:
                base[k] = v

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._data))

    def get(self, *keys: str, default: Any = None) -> Any:
        node: Any = self._data
        with self._lock:
            for k in keys:
                if not isinstance(node, dict) or k not in node:
                    return default
                node = node[k]
            return node

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            self._merge(self._data, patch)
            try:
                SETTINGS_PATH.write_text(json.dumps(self._data, indent=2))
            except OSError as e:
                print(f"settings: failed to save ({e})")
            return json.loads(json.dumps(self._data))


settings = Settings()


# ============================ telemetry plumbing ============================

class RateMeter:
    """Rolling (Hz, bytes/s) meter over RATE_WINDOW_S."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._events: deque[tuple[float, int]] = deque()

    def note(self, nbytes: int = 0) -> None:
        now = time.time()
        with self._lock:
            self._events.append((now, nbytes))
            cutoff = now - RATE_WINDOW_S
            while self._events and self._events[0][0] < cutoff:
                self._events.popleft()

    def rate(self) -> tuple[float, float]:
        now = time.time()
        cutoff = now - RATE_WINDOW_S
        with self._lock:
            while self._events and self._events[0][0] < cutoff:
                self._events.popleft()
            n = len(self._events)
            nbytes = sum(b for _, b in self._events)
        return n / RATE_WINDOW_S, nbytes / RATE_WINDOW_S


class LatestStore:
    """Thread-safe latest-message store; LCM callbacks write, asyncio reads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._msgs: dict[str, Any] = {}
        self._stamps: dict[str, float] = {}

    def put(self, key: str, msg: Any) -> None:
        with self._lock:
            self._msgs[key] = msg
            self._stamps[key] = time.time()

    def get(self, key: str) -> tuple[Any, float]:
        with self._lock:
            return self._msgs.get(key), self._stamps.get(key, 0.0)

    def age(self, key: str) -> float:
        with self._lock:
            ts = self._stamps.get(key)
        return time.time() - ts if ts else float("inf")


store = LatestStore()
src_meters: dict[str, RateMeter] = {k: RateMeter() for k in
    ("camera", "depth", "costmap", "odom", "map", "scan", "detections")}
wire_meters: dict[str, RateMeter] = {k: RateMeter() for k in
    ("camera", "depth", "costmap", "cloud")}

lcm: LCM | None = None
pickle_lcm: PickleLCM | None = None
_started_at = time.time()

_state_lock = threading.Lock()
_last_goal: dict[str, float] | None = None       # {x, y, ts}
_goal_reached_at: float = 0.0
_online_since: float | None = None
_odom_hist: deque[tuple[float, float, float]] = deque(maxlen=40)  # (t, x, y)

# Saved points are SESSION-scoped: the map frame is reborn with every DimOS
# relaunch, so points are cleared automatically when the stack comes back up.
_points_lock = threading.Lock()
_saved_points: list[dict[str, Any]] = []  # {name, x, y, ts}
_exploring = False  # best-effort: tracks panel-initiated exploration only


def _nbytes(arr: Any) -> int:
    try:
        return int(arr.nbytes)
    except AttributeError:
        return 0


def _on_color(m: Image, _t: Any) -> None:
    store.put("color", m)
    src_meters["camera"].note(_nbytes(m.data))


def _on_depth(m: Image, _t: Any) -> None:
    store.put("depth", m)
    src_meters["depth"].note(_nbytes(m.data))


def _on_costmap(m: OccupancyGrid, _t: Any) -> None:
    store.put("costmap", m)
    src_meters["costmap"].note(_nbytes(getattr(m, "grid", None)))


def _on_odom(m: PoseStamped, _t: Any) -> None:
    store.put("odom", m)
    src_meters["odom"].note()
    try:
        with _state_lock:
            _odom_hist.append((time.time(), float(m.position.x), float(m.position.y)))
    except (AttributeError, TypeError):
        pass


def _on_map(m: PointCloud2, _t: Any) -> None:
    store.put("map", m)
    src_meters["map"].note()


def _on_scan(m: PointCloud2, _t: Any) -> None:
    store.put("scan", m)
    src_meters["scan"].note()


def _on_detections(m: Detection2DArray, _t: Any) -> None:
    store.put("detections", m)
    src_meters["detections"].note()


def _on_goal_reached(m: Bool, _t: Any) -> None:
    global _goal_reached_at
    store.put("goal_reached", m)
    if getattr(m, "data", False):
        with _state_lock:
            _goal_reached_at = time.time()


def start_lcm() -> LCM:
    t = LCM()
    t.start()
    t.subscribe(Topic("/color_image", Image), _on_color)
    t.subscribe(Topic("/global_costmap", OccupancyGrid), _on_costmap)
    t.subscribe(Topic("/odom", PoseStamped), _on_odom)
    t.subscribe(Topic("/path", Path), lambda m, _t: store.put("path", m))
    t.subscribe(Topic("/goal_reached", Bool), _on_goal_reached)
    t.subscribe(Topic("/slam_map", PointCloud2), _on_map)
    t.subscribe(Topic("/lidar", PointCloud2), _on_scan)
    t.subscribe(Topic("/depth_image", Image), _on_depth)
    t.subscribe(Topic("/detections", Detection2DArray), _on_detections)
    return t


# ============================ agent chat buffer ============================

_chat_lock = threading.Lock()
_chat_log: deque[dict[str, Any]] = deque(maxlen=300)
_chat_seq = 0

_ROLE_BY_CLASS = {
    "HumanMessage": "human",
    "AIMessage": "ai",
    "ToolMessage": "tool",
    # SystemMessage intentionally skipped — it's the giant system prompt.
}


def _agent_msg_to_dict(m: Any) -> dict[str, Any] | None:
    role = _ROLE_BY_CLASS.get(type(m).__name__)
    if role is None:
        return None
    content = getattr(m, "content", "")
    if not isinstance(content, str):
        content = str(content)
    tool_calls = []
    for tc in getattr(m, "tool_calls", None) or []:
        if isinstance(tc, dict):
            tool_calls.append({"name": str(tc.get("name", "?")), "args": tc.get("args", {})})
        else:
            tool_calls.append(
                {"name": str(getattr(tc, "name", "?")), "args": getattr(tc, "args", {})}
            )
    if not content and not tool_calls:
        return None
    return {"role": role, "content": content, "tool_calls": tool_calls, "ts": time.time()}


def _on_agent_message(m: Any, _topic: Any) -> None:
    global _chat_seq
    d = _agent_msg_to_dict(m)
    if d is None:
        return
    with _chat_lock:
        _chat_seq += 1
        d["seq"] = _chat_seq
        _chat_log.append(d)


def _mcp_adapter():  # type: ignore[no-untyped-def]
    from dimos.agents.mcp.mcp_adapter import McpAdapter

    return McpAdapter()


# ============================ encoders ============================

def image_to_jpeg(msg: Image) -> bytes | None:
    data = msg.data
    if data is None or data.size == 0:
        return None
    fmt = str(getattr(msg.format, "value", msg.format)).lower()
    if data.ndim == 3 and "rgb" in fmt and "bgr" not in fmt:
        data = cv2.cvtColor(data, cv2.COLOR_RGB2BGR)
    q = int(settings.get("jpeg_quality", default=70))
    ok, buf = cv2.imencode(".jpg", data, [int(cv2.IMWRITE_JPEG_QUALITY), q])
    return buf.tobytes() if ok else None


_DEPTH_CMAPS = {"turbo": cv2.COLORMAP_TURBO, "viridis": cv2.COLORMAP_VIRIDIS}


def depth_to_jpeg(msg: Image, cmap: str) -> tuple[bytes, float, float] | None:
    """Colorize a DEPTH16 frame. Percentile normalization sidesteps the
    depth-unit question (mm vs 100um) — display stream, not measurement.
    Returns (jpeg, lo, hi) with lo/hi in raw sensor units."""
    d = msg.data
    if d is None or d.size == 0:
        return None
    d = np.squeeze(d)
    valid = d[d > 0]
    if valid.size < 100:
        return None
    lo, hi = np.percentile(valid, (5.0, 95.0))
    if hi <= lo:
        hi = lo + 1
    norm = np.clip((d.astype(np.float32) - lo) / (hi - lo), 0, 1)
    gray = (norm * 255).astype(np.uint8)
    if cmap == "gray":
        img = cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)
    else:
        img = cv2.applyColorMap(gray, _DEPTH_CMAPS.get(cmap, cv2.COLORMAP_TURBO))
    img[d == 0] = (13, 11, 9)  # no-return pixels -> theme dark
    q = int(settings.get("jpeg_quality", default=70))
    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), q])
    if not ok:
        return None
    return buf.tobytes(), float(lo), float(hi)


def costmap_packet(msg: OccupancyGrid) -> bytes | None:
    grid = msg.grid
    if grid is None or grid.size == 0:
        return None
    origin = msg.origin
    header = json.dumps(
        {
            "w": int(msg.width),
            "h": int(msg.height),
            "res": float(msg.resolution),
            "ox": float(origin.position.x),
            "oy": float(origin.position.y),
            "frame": msg.frame_id,
            "ts": float(msg.ts),
        }
    ).encode()
    payload = zlib.compress(np.ascontiguousarray(grid, dtype=np.int8).tobytes(), 6)
    return struct.pack(">I", len(header)) + header + payload


def cloud_packet(kind: str, msg: PointCloud2, cap: int) -> bytes | None:
    pts = msg.points_f32()  # (N, 3) float32 — a METHOD, not a property
    if pts is None or len(pts) == 0:
        return None
    n = len(pts)
    if n > cap:
        pts = pts[:: (n + cap - 1) // cap]
    pts = np.ascontiguousarray(pts, dtype=np.float32)
    header = json.dumps({"kind": kind, "n": int(len(pts)), "ts": float(msg.ts)}).encode()
    payload = zlib.compress(pts.tobytes(), 3)
    return struct.pack(">I", len(header)) + header + payload


# ============================ state assembly ============================

def yaw_from_quaternion(q: Any) -> float:
    siny = 2.0 * (q.w * q.z + q.x * q.y)
    cosy = 1.0 - 2.0 * (q.y * q.y + q.z * q.z)
    return math.atan2(siny, cosy)


def _speed_mps() -> float | None:
    """Speed over the last ~0.6 s of odom history."""
    with _state_lock:
        hist = list(_odom_hist)
    if len(hist) < 2:
        return None
    t1, x1, y1 = hist[-1]
    for t0, x0, y0 in reversed(hist[:-1]):
        if t1 - t0 >= 0.5:
            return math.hypot(x1 - x0, y1 - y0) / (t1 - t0)
    t0, x0, y0 = hist[0]
    if t1 - t0 < 0.15:
        return None
    return math.hypot(x1 - x0, y1 - y0) / (t1 - t0)


def _nav_state(pose: dict | None, path_fresh: bool) -> dict[str, Any]:
    """Derive a coarse nav state for the Telemetry tile + Navigation tab."""
    with _state_lock:
        goal = dict(_last_goal) if _last_goal else None
        reached_at = _goal_reached_at
    if goal is None:
        return {"state": "idle", "goal": None, "distance": None}
    distance = None
    if pose is not None:
        distance = round(math.hypot(pose["x"] - goal["x"], pose["y"] - goal["y"]), 2)
    goal_age = time.time() - goal["ts"]
    if reached_at > goal["ts"]:
        state = "arrived"
    elif path_fresh:
        state = "walking"
    elif goal_age < 5.0:
        state = "planning"
    else:
        state = "no path"
    return {"state": state, "goal": {"x": goal["x"], "y": goal["y"]}, "distance": distance}


def state_json() -> str:
    global _online_since, _exploring
    odom, _ = store.get("odom")
    pose = None
    if odom is not None:
        pose = {
            "x": float(odom.position.x),
            "y": float(odom.position.y),
            "yaw": yaw_from_quaternion(odom.orientation),
        }

    path_pts: list[list[float]] = []
    path_fresh = store.age("path") < PATH_STALE_S
    if path_fresh:
        path_msg, _ = store.get("path")
        if path_msg is not None:
            path_pts = [
                [round(float(p.position.x), 3), round(float(p.position.y), 3)]
                for p in path_msg.poses
            ]

    boxes: list[dict[str, Any]] = []
    if store.age("detections") < 1.0:
        det_msg, _ = store.get("detections")
        min_score = float(settings.get("yolo", "min_score", default=0.0) or 0.0)
        for d in getattr(det_msg, "detections", None) or []:
            try:
                b = d.bbox
                # vision_msgs Pose2D: center is .center.position.{x,y} (NOT .center.x).
                # NOTE: DimOS's to_ros_detection2d_array() ships EMPTY results — no
                # hypothesis/score on the wire (verified live 2026-06-13). Only
                # apply min_score when a real score exists, else every box dies.
                score = None
                if getattr(d, "results", None):
                    try:
                        score = float(d.results[0].hypothesis.score)
                    except (AttributeError, IndexError, TypeError):
                        score = None
                if score is not None and score < min_score:
                    continue
                boxes.append(
                    {
                        "cx": round(float(b.center.position.x), 1),
                        "cy": round(float(b.center.position.y), 1),
                        "w": round(float(b.size_x), 1),
                        "h": round(float(b.size_y), 1),
                        "score": round(score, 2) if score is not None else None,
                        "id": str(getattr(d, "id", "")),
                    }
                )
            except (AttributeError, IndexError):
                continue

    # camera resolution (for the main-view badge)
    res = None
    color_msg, _ = store.get("color")
    if color_msg is not None:
        try:
            h, w = color_msg.data.shape[:2]
            res = [int(w), int(h)]
        except (AttributeError, ValueError):
            pass

    reached_msg, _ = store.get("goal_reached")
    ages: dict[str, float | None] = {}
    for k in ("color", "depth", "costmap", "odom", "map", "scan"):
        a = store.age(k)
        # Infinity is not valid JSON -> null means "never seen"
        ages[k if k != "color" else "camera"] = round(a, 2) if math.isfinite(a) else None
    ages["color"] = ages["camera"]  # old UI compatibility during rollout

    online = any(
        a is not None and a < STALE_AFTER_S
        for key, a in ages.items()
        if key in ("camera", "costmap", "odom")
    )
    if online and _online_since is None:
        _online_since = time.time()
        # Fresh stack = fresh map frame: old saved points no longer mean anything.
        _exploring = False
        with _points_lock:
            _saved_points.clear()
    elif not online:
        _online_since = None

    rates: dict[str, dict[str, float]] = {}
    for k, m in src_meters.items():
        hz, _bps = m.rate()
        rates[k] = {"hz": round(hz, 1)}
    for k, m in wire_meters.items():
        _hz, bps = m.rate()
        if k in rates:
            rates[k]["kbs"] = round(bps / 1024.0, 1)
        else:
            rates[k] = {"hz": 0.0, "kbs": round(bps / 1024.0, 1)}

    nav = _nav_state(pose, path_fresh and bool(path_pts))
    nav["exploring"] = _exploring
    with _points_lock:
        points = list(_saved_points)

    return json.dumps(
        {
            "online": online,
            "points": points,
            "uptime": round(time.time() - _online_since, 1) if _online_since else None,
            "odom": pose,
            "speed": (lambda s: round(s, 2) if s is not None else None)(_speed_mps()),
            "res": res,
            "path": path_pts,
            "goal": _last_goal,
            "goal_reached": bool(reached_msg.data) if reached_msg is not None else None,
            "nav": nav,
            "detections": boxes,
            "ages": ages,
            "rates": rates,
            "bridge": {
                "uptime": round(time.time() - _started_at, 1),
                "version": PANEL_VERSION,
                "viewers": _viewer_count,
            },
            "ts": time.time(),
        }
    )


# ============================ MCP stop legs ============================

def mcp_stop_calls() -> dict[str, str]:
    """Best-effort MCP stops (exploration + WebRTC-plane zero). Sync; run in a thread."""
    results: dict[str, str] = {}
    try:
        adapter = _mcp_adapter()
        for name, args in (
            ("end_exploration", {}),
            # The patched move skill requires duration > 0; a short zero-velocity
            # move publishes zeros and then stop_movement zeroes the virtual stick.
            ("move", {"x": 0.0, "y": 0.0, "yaw": 0.0, "duration": 0.2}),
        ):
            try:
                results[name] = adapter.call_tool_text(name, args)[:120] or "ok"
            except Exception as e:  # noqa: BLE001 — report, don't fail the stop
                results[name] = f"failed: {e}"
    except Exception as e:  # noqa: BLE001
        results["mcp"] = f"unavailable: {e}"
    return results


# ============================ HTTP APIs ============================

app = FastAPI(title="RoboDimOS Control bridge")


@app.post("/api/goal")
async def api_goal(request: Request) -> JSONResponse:
    global _last_goal
    body = await request.json()
    x, y = float(body["x"]), float(body["y"])
    goal = PoseStamped(
        position=(x, y, 0),
        orientation=(0, 0, 0, 1),  # default orientation, same as the stock dashboard
        frame_id="world",
    )
    assert lcm is not None
    lcm.publish(Topic("/goal_request", PoseStamped), goal)
    with _state_lock:
        _last_goal = {"x": x, "y": y, "ts": time.time()}
    return JSONResponse({"ok": True, "x": x, "y": y})


@app.post("/api/stop")
async def api_stop() -> JSONResponse:
    """Software all-stop: planner stop + zero teleop + MCP-side stops."""
    assert lcm is not None
    lcm.publish(Topic("/stop_movement", Bool), Bool(data=True))
    zero = Twist(linear=Vector3(0, 0, 0), angular=Vector3(0, 0, 0))
    for _ in range(3):
        lcm.publish(Topic("/tele_cmd_vel", Twist), zero)
        await asyncio.sleep(0.1)
    mcp_results = await asyncio.to_thread(mcp_stop_calls)
    return JSONResponse({"ok": True, "nav_stop": True, "tele_zero": True, "mcp": mcp_results})


@app.post("/api/chat")
async def api_chat(request: Request) -> JSONResponse:
    body = await request.json()
    message = str(body.get("message", "")).strip()
    if not message:
        return JSONResponse({"ok": False, "error": "empty message"})
    try:
        text = await asyncio.to_thread(
            lambda: _mcp_adapter().call_tool_text("agent_send", {"message": message})
        )
        # During DimOS startup the MCP server answers "Tool not found" as a normal
        # result — surface it as a failure so the UI keeps the user's text.
        if text.startswith("Tool not found"):
            return JSONResponse({"ok": False, "error": "agent still starting up — try again shortly"})
        return JSONResponse({"ok": True, "response": text})
    except Exception as e:  # noqa: BLE001 — surface MCP errors to the UI
        return JSONResponse({"ok": False, "error": str(e)})


@app.post("/api/skill")
async def api_skill(request: Request) -> JSONResponse:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    args = body.get("args") or {}
    if not name:
        return JSONResponse({"ok": False, "error": "missing skill name"})
    try:
        text = await asyncio.to_thread(lambda: _mcp_adapter().call_tool_text(name, args))
        return JSONResponse({"ok": True, "result": (text or "ok")[:300]})
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)})


@app.get("/api/settings")
async def api_settings_get() -> JSONResponse:
    return JSONResponse({"ok": True, "settings": settings.snapshot()})


@app.post("/api/settings")
async def api_settings_post(request: Request) -> JSONResponse:
    body = await request.json()
    if not isinstance(body, dict):
        return JSONResponse({"ok": False, "error": "settings patch must be an object"})
    merged = settings.update(body)
    return JSONResponse({"ok": True, "settings": merged})


@app.post("/api/chat/clear")
async def api_chat_clear() -> JSONResponse:
    with _chat_lock:
        _chat_log.clear()
    return JSONResponse({"ok": True})


# ---------- navigation tab: saved points / explore / nav-stop ----------

@app.get("/api/points")
async def api_points_get() -> JSONResponse:
    with _points_lock:
        return JSONResponse({"ok": True, "points": list(_saved_points)})


@app.post("/api/points")
async def api_points_add(request: Request) -> JSONResponse:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        return JSONResponse({"ok": False, "error": "point needs a name"})
    try:
        x, y = float(body["x"]), float(body["y"])
    except (KeyError, TypeError, ValueError):
        return JSONResponse({"ok": False, "error": "point needs numeric x/y"})
    point = {"name": name, "x": round(x, 3), "y": round(y, 3), "ts": time.time()}
    with _points_lock:
        _saved_points[:] = [p for p in _saved_points if p["name"].lower() != name.lower()]
        _saved_points.append(point)
        points = list(_saved_points)
    out: dict[str, Any] = {"ok": True, "points": points}
    # Optional: let Larry know the name too (only meaningful for the robot's
    # CURRENT position — tag_location tags where the robot stands).
    if body.get("tag") and settings.get("save_points_tag_location", default=False):
        try:
            txt = await asyncio.to_thread(
                lambda: _mcp_adapter().call_tool_text("tag_location", {"name": name})
            )
            out["tag_result"] = (txt or "ok")[:200]
        except Exception as e:  # noqa: BLE001
            out["tag_result"] = f"tag_location failed: {e}"
    return JSONResponse(out)


@app.post("/api/points/delete")
async def api_points_delete(request: Request) -> JSONResponse:
    body = await request.json()
    name = str(body.get("name", "")).strip()
    with _points_lock:
        _saved_points[:] = [p for p in _saved_points if p["name"] != name]
        return JSONResponse({"ok": True, "points": list(_saved_points)})


@app.post("/api/nav/stop")
async def api_nav_stop() -> JSONResponse:
    """Cancel the current goal only (lighter than the all-stop)."""
    global _last_goal
    assert lcm is not None
    lcm.publish(Topic("/stop_movement", Bool), Bool(data=True))
    with _state_lock:
        _last_goal = None
    return JSONResponse({"ok": True})


@app.post("/api/explore")
async def api_explore(request: Request) -> JSONResponse:
    global _exploring
    body = await request.json()
    action = str(body.get("action", "")).strip()
    if action not in ("begin", "end"):
        return JSONResponse({"ok": False, "error": "action must be begin|end"})
    tool = "begin_exploration" if action == "begin" else "end_exploration"
    try:
        txt = await asyncio.to_thread(lambda: _mcp_adapter().call_tool_text(tool, {}))
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)})
    _exploring = action == "begin"
    return JSONResponse({"ok": True, "result": (txt or "ok")[:200], "exploring": _exploring})


# ============================ websockets ============================

@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket) -> None:
    await ws.accept()
    with _chat_lock:
        history = list(_chat_log)
    last_seq = history[-1]["seq"] if history else 0
    try:
        await ws.send_text(json.dumps({"type": "history", "messages": history}, default=str))
        while True:
            with _chat_lock:
                new = [m for m in _chat_log if m["seq"] > last_seq]
                cleared = bool(last_seq) and not _chat_log
            if cleared:
                last_seq = 0
                await ws.send_text(json.dumps({"type": "history", "messages": []}))
            elif new:
                last_seq = new[-1]["seq"]
                await ws.send_text(json.dumps({"type": "append", "messages": new}, default=str))
            await asyncio.sleep(0.2)
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.websocket("/ws/video")
async def ws_video(ws: WebSocket) -> None:
    await ws.accept()
    last_sent = 0.0
    try:
        while True:
            msg, stamp = store.get("color")
            if msg is not None and stamp > last_sent:
                jpeg = await asyncio.to_thread(image_to_jpeg, msg)
                if jpeg:
                    await ws.send_bytes(jpeg)
                    wire_meters["camera"].note(len(jpeg))
                    last_sent = stamp
            await asyncio.sleep(1.0 / 20.0)  # poll a bit faster than the 15 fps source
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.websocket("/ws/depth")
async def ws_depth(ws: WebSocket) -> None:
    await ws.accept()
    cmap = ws.query_params.get("cmap", "turbo")
    if cmap not in ("turbo", "viridis", "gray"):
        cmap = "turbo"
    last_sent = 0.0
    last_range = 0.0
    try:
        while True:
            msg, stamp = store.get("depth")
            if msg is not None and stamp > last_sent:
                result = await asyncio.to_thread(depth_to_jpeg, msg, cmap)
                if result:
                    jpeg, lo, hi = result
                    await ws.send_bytes(jpeg)
                    wire_meters["depth"].note(len(jpeg))
                    last_sent = stamp
                    if time.time() - last_range > 1.0:
                        await ws.send_text(json.dumps({"lo": lo, "hi": hi}))
                        last_range = time.time()
            await asyncio.sleep(1.0 / 20.0)
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.websocket("/ws/costmap")
async def ws_costmap(ws: WebSocket) -> None:
    await ws.accept()
    last_sent = 0.0
    try:
        while True:
            msg, stamp = store.get("costmap")
            if msg is not None and stamp > last_sent:
                packet = await asyncio.to_thread(costmap_packet, msg)
                if packet:
                    await ws.send_bytes(packet)
                    wire_meters["costmap"].note(len(packet))
                    last_sent = stamp
            await asyncio.sleep(0.5)  # ~2 Hz
    except (WebSocketDisconnect, RuntimeError):
        pass


@app.websocket("/ws/teleop")
async def ws_teleop(ws: WebSocket) -> None:
    """Client streams {x, y, yaw} at ~10 Hz while driving. Watchdog: if the
    stream goes quiet for 0.4 s (or disconnects) while moving, publish a zero."""
    await ws.accept()
    moving = False

    def publish(x: float, y: float, yaw: float) -> None:
        assert lcm is not None
        lcm.publish(
            Topic("/tele_cmd_vel", Twist),
            Twist(linear=Vector3(x, y, 0), angular=Vector3(0, 0, yaw)),
        )

    try:
        while True:
            try:
                raw = await asyncio.wait_for(ws.receive_text(), timeout=0.4)
            except asyncio.TimeoutError:
                if moving:
                    publish(0.0, 0.0, 0.0)
                    moving = False
                continue
            try:
                d = json.loads(raw)
                x, y, yaw = float(d.get("x", 0)), float(d.get("y", 0)), float(d.get("yaw", 0))
            except (ValueError, TypeError):
                continue
            publish(x, y, yaw)
            moving = x != 0.0 or y != 0.0 or yaw != 0.0
    except (WebSocketDisconnect, RuntimeError):
        if moving:
            publish(0.0, 0.0, 0.0)


@app.websocket("/ws/cloud")
async def ws_cloud(ws: WebSocket) -> None:
    await ws.accept()
    last_map = 0.0
    last_scan = 0.0
    try:
        while True:
            map_cap = int(settings.get("map_point_cap", default=150_000))
            scan_cap = int(settings.get("scan_point_cap", default=20_000))
            msg, stamp = store.get("map")
            if msg is not None and stamp > last_map:
                packet = await asyncio.to_thread(cloud_packet, "map", msg, map_cap)
                if packet:
                    await ws.send_bytes(packet)
                    wire_meters["cloud"].note(len(packet))
                    last_map = stamp
            msg, stamp = store.get("scan")
            if msg is not None and stamp > last_scan and time.time() - last_scan > 0.25:
                packet = await asyncio.to_thread(cloud_packet, "scan", msg, scan_cap)
                if packet:
                    await ws.send_bytes(packet)
                    wire_meters["cloud"].note(len(packet))
                    last_scan = stamp
            await asyncio.sleep(0.1)
    except (WebSocketDisconnect, RuntimeError):
        pass


_viewer_count = 0
_viewer_lock = threading.Lock()


@app.websocket("/ws/state")
async def ws_state(ws: WebSocket) -> None:
    global _viewer_count
    await ws.accept()
    with _viewer_lock:
        _viewer_count += 1
    try:
        while True:
            await ws.send_text(state_json())
            await asyncio.sleep(0.2)  # 5 Hz
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        with _viewer_lock:
            _viewer_count -= 1


# ============================ static UI ============================

if WEB_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")


@app.get("/{path:path}")
async def index(path: str) -> FileResponse:
    target = WEB_DIST / path
    if path and target.is_file():
        return FileResponse(target)
    return FileResponse(WEB_DIST / "index.html")


def main() -> None:
    global lcm, pickle_lcm
    parser = argparse.ArgumentParser(description="RoboDimOS Control bridge")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=7780)
    args = parser.parse_args()

    if not WEB_DIST.is_dir():
        print(f"WARNING: web build not found at {WEB_DIST} — run `npm run build` in web/ first.")

    lcm = start_lcm()
    pickle_lcm = PickleLCM()
    pickle_lcm.start()
    pickle_lcm.subscribe(Topic("/agent"), _on_agent_message)
    # Printed URL lets VS Code Remote-SSH auto-forward the port when run in a terminal.
    print(f"RoboDimOS Control: http://127.0.0.1:{args.port}/")
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
