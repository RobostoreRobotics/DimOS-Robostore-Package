# DimOS – Robostore Package

Custom DimOS blueprints — and the framework patches they rely on — plus the
**RoboDimOS Control** operator cockpit, for the **RoboUniversity DimOS course**
on a Unitree G1: camera perception, GPU person detection & 3D tracking, the
agentic-navigation stack, and a browser control panel to drive it all.

These files **overlay a stock DimOS install pinned to the course's commit**
(`4c3810bf`), which the course's Unit 1 walks you through setting up. On their
own they're just DimOS blueprints — the course shows you how to install and run
them.

## What's included

A `dimos/` overlay that mirrors the DimOS source tree:

- **Course blueprints** (`dimos/robot/unitree/g1/blueprints/`)
  - `g1_fusion.py` — the camera feed beside the live LiDAR 3D map
  - `g1_fusion_detection.py` — real-time GPU person detection + 3D tracking
  - `g1_agentic_nav.py` — the full stack: perception + the LLM agent + autonomous navigation
  - `g1_fusion_rs.py` — a RealSense depth-fusion / calibration variant
- The blueprint registry (`all_blueprints.py`), the calibrated camera primitive,
  and the supporting framework patches the blueprints need (worker/RPC startup,
  navigation planner & controller, locomotion stop, skills, camera).

A `robostore-control/` folder — **RoboDimOS Control**, the operator cockpit:

- A standalone FastAPI **bridge** (`bridge/server.py`) that subscribes the DimOS
  LCM bus and serves the UI + websockets on **`:7780`**, plus a React/Vite **web
  UI** (`web/`) built on the robot, and a **systemd unit** (`deploy/`) so it
  auto-starts at boot. A dark/gold, drone-controller-style panel with live
  camera/costmap/3D/depth views, the agent chat, teleop, and an all-stop.

## Install

With the course's DimOS installed at `~/dimos-dev` (commit `4c3810bf`), copy the
overlay over your install:

```bash
cp -r dimos/ ~/dimos-dev/
```

Then confirm the blueprints are registered:

```bash
cd ~/dimos-dev && .venv/bin/dimos list | grep -E 'g1-fusion|g1-agentic-nav'
```

To install the control panel, copy it into your home directory:

```bash
cp -r robostore-control ~/
```

then build the UI and enable the service (the course's Unit 5 walks through this):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
cd ~/robostore-control/web && npm install && npm run build
sudo cp ~/robostore-control/deploy/robostore-control.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now robostore-control
```

Open it at `http://<robot-ip>:7780`.

## How to use these

To understand how to install and run these with DimOS, **follow the
RoboUniversity DimOS course** — it covers every step, from connecting to your
robot through running the camera, detection, the AI agent, autonomous
navigation, and the control panel.

---
Maintained for RoboStore / RoboUniversity.
