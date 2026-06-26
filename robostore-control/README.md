# Robostore DimOS Control

Drone-controller-style web panel for the Unitree G1 + DimOS. Standalone bridge
process on the Jetson (independent of DimOS restarts — survives them and shows
truthful per-stream health) + React UI, dark/gold, DJI-style layout.

**Open it at: `http://192.168.123.164:7780/` (direct, no tunnel needed).**

## Features

- Main view + PiP tiles (click to swap): Camera (with YOLO person-box overlay,
  👁 toggle), Costmap (click-to-goal, path + goal markers), 3D pointcloud
  (height-colored SLAM map + live scan + robot marker, ⌖ recenter), Depth.
- Agent chat (Larry) with collapsible tool-call/result rows; flags
  model-flubbed "calls written as text" that never executed.
- Quick actions: configurable preset gesture buttons (direct MCP, no LLM).
- Teleop: ⌨ keyboard (WASD + QE) and 🕹 on-screen joystick, 10 Hz stream with
  a 0.4 s zero-velocity watchdog in the bridge.
- STOP: software all-stop — planner stop + zero teleop + end_exploration +
  WebRTC-plane zero via MCP.
- Telemetry: link/odom/stream freshness, minimizable.

## Layout

- `bridge/server.py` — FastAPI bridge: subscribes to the DimOS LCM bus
  (camera, depth, costmap, odom, path, clouds, detections, /agent chat) and
  serves the UI + websockets on **:7780**. Runs with the dimos venv python.
- `web/` — React + Vite app, built **on the Jetson**; bridge serves `web/dist`.
- `deploy/robostore-control.service` — systemd unit (auto-start at boot).

## One-time setup (Jetson)

```bash
# Node (for builds)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
cd ~/robostore-control/web && npm install && npm run build

# Service (auto-start at boot, restart on crash)
sudo cp ~/robostore-control/deploy/robostore-control.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now robostore-control
```

## Dev workflow

Source of truth is `C:\Users\griff\robostore-control` on the PC (Claude edits
there). Deploy loop:

1. PC: `powershell -ExecutionPolicy Bypass -File sync.ps1`
2. Jetson, only when `web/` changed: `cd ~/robostore-control/web && npm run build`
3. Jetson: `sudo systemctl restart robostore-control`
4. Logs: `journalctl -u robostore-control -f`

## Protocol notes

- `/ws/video`, `/ws/depth`: binary JPEG frames (~15 fps; depth is
  percentile-normalized turbo colormap)
- `/ws/costmap`: `[uint32 BE header length][JSON header][zlib int8 grid]`
- `/ws/cloud`: same framing; header `{kind: map|scan, n, ts}`, zlib float32 xyz
  (map ≤150k pts ~1 Hz, scan ≤20k pts ~4 Hz)
- `/ws/state`: JSON 5 Hz — odom, path, goal, goal_reached, detections, ages
- `/ws/chat`: `{type: history|append, messages}` from the /agent pickle topic
- `/ws/teleop`: client streams `{x,y,yaw}` ~10 Hz; bridge zeros on 0.4 s silence
- `POST /api/goal {x,y}` · `/api/stop` · `/api/chat {message}` ·
  `/api/skill {name,args}`

## Robot-side dependencies (in ~/dimos-dev, all with backups)

- `g1_agentic_nav.py`: G1DdsWalkOnly subclass (de-duplicates arm/mode skills),
  Detection2DModule with GPU YOLO factory (powers the overlay).
- Launch with `-o mcpclient.model=openai:gpt-5.5` (gpt-4o writes tool calls as
  text that never executes).
- `connection.py` stop_movement fix + `skill_container.py` duration clamp
  (`.fixbak`s) — without these, agent moves never stop.
