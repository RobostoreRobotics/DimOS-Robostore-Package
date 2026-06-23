# DimOS – Robostore Package

Custom DimOS blueprints — and the framework patches they rely on — for the
**RoboUniversity DimOS course** on a Unitree G1: camera perception, GPU person
detection & 3D tracking, and the agentic-navigation stack.

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

## How to use these

To understand how to install and run these with DimOS, **follow the
RoboUniversity DimOS course** — it covers every step, from connecting to your
robot through running the camera, detection, the AI agent, and autonomous
navigation.

---
Maintained for RoboStore / RoboUniversity.
