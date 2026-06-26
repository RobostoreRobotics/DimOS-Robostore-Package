# RoboDimOS Control — Phase 6 design spec

Locked with the user 2026-06-12 via Q&A (mockup v3 approved). The mockup at
`mockup/control.html` is the visual source of truth for the design language.
Product name: **RoboDimOS Control** (renamed from "Robostore DimOS Control").

## Design language (from mockup v3)

- **Theme:** refined dark + gold. Tokens in mockup CSS (`--bg #090b0d`, cards
  `#15181d→#111418` gradients, nested surface `#1a1e24`, wells `#0c0e11`,
  gold `#e8b54d` / deep `#c9952f`, green `#3fd68a`, amber, red `#e5484d`).
- **Controls are purpose-built per data type** (the key user requirement):
  toggle **switches** for on/off, **segmented controls** for mode/view picks,
  **sliders** for ranges (Settings), **mini value tiles** (icon + label + big
  mono number) for readouts, **layered list rows** for per-item status.
  Color + depth communicate selection: active = gold-tinted raised gradient,
  wells are inset, pressed = inset shadow.
- **Soft depth** finish everywhere (top-light gradient, 1px inner highlight,
  soft shadow); **restrained flourish** (glow only on status dots + STOP).
- **Typography:** Inter (self-hosted `InterVariable.woff2`) + mono numerals
  (Cascadia Mono/Consolas stack, tabular). Card headers: small uppercase,
  1.6px tracking, muted.
- **SVG line icons** (1.7 stroke, round caps) — no emoji anywhere.
- **Cards:** 14px radius, airy padding, subtle surface gradient.
- Target: 1080p+ desktop 16:9. Edge browser. No phone/tablet support.
- Logo: `logo.png` (gold robot+gears, rim cropped) at ~30px + wordmark
  "RoboDimOS **Control**" (Control in gold).

## App frame

- **Top bar:** logo + wordmark · tab strip (segmented): Control | Navigation |
  Settings | Diagnostics · spacer · stack status chip (online/offline — no
  module count, no data source for it) · run timer (time since stack came
  online) · global red **STOP** (every tab, top-right).
- **Agent panel** fixed on the right edge of EVERY tab (364px): header
  "AGENT CHAT" + clear button, chat (timestamps, collapsible tool rows,
  phantom-call ⚠ warnings KEPT, "Larry is working…" animated indicator),
  composer, quick-actions block at bottom (configurable presets, ⚙ edit).
- **Offline state:** minimal splash ("RoboDimOS Control — stack offline")
  replaces the whole UI until streams appear; auto-recovers.

## Control tab (home)

- Main view panel (large, top-left) + small view panel (bottom-left, 332px)
  + middle readout panels. Both view panels carry a segmented picker
  (Camera | Costmap | 3D | Depth); defaults camera main / costmap small.
- Per-view edge controls:
  - **Camera:** res+fps badge (top-left), YOLO switch + persons count
    (top-right), teleop segmented Keys|Stick|Off (bottom-right) + key hints,
    letterboxed 4:3.
  - **Costmap (view-only here — NO goal clicks):** zoom +/−/fit, follow-robot
    toggle, color legend.
  - **3D:** recenter-on-robot, map/scan layer toggles, point size slider.
  - **Depth:** colormap picker (Turbo/Viridis/Gray), live range badge.
- **Telemetry panel:** mini-tile grid — Position X, Position Y, Heading,
  Speed, Nav State (gold mono badge style), Goal Dist.
- **Streams panel:** rows (dot · name · level bar · rate + bandwidth) for
  camera/depth/costmap/odom/cloud.

## Navigation tab

- Map-dominant: big costmap fills left/center; narrow side column between
  map and agent panel with small camera view + saved-points list.
- **Click → confirm → go:** click places marker + distance; "Walk here"
  confirms. Misclicks never move the robot.
- **Saved points:** session-scoped (live until the map is lost / DimOS
  relaunch — future: rooms with persistent memory). Stored in the bridge
  (in-memory, keyed to the run). Set/name/go/delete. tag_location
  integration = optional toggle in Settings.
- **Go-Home:** origin (0,0) by default; session "Home" point overrides if set.
- **Stop-nav** button (cancel current goal) + **exploration** begin/end with
  a clear "exploring…" banner (it blocks other agent commands).
- Path preview + distance/ETA while walking.

## Settings tab

(All persisted in a bridge-side JSON — global for all devices.)
- Teleop speed sliders (fwd/strafe/yaw; yaw floor stays above the ~0.4 rad/s
  firmware deadband).
- Stream quality: JPEG quality, fps caps, 3D point caps (map/scan).
- Quick-action editor (all 14 arm presets).
- YOLO defaults: overlay on/off at load + min confidence slider.
- Agent chat options: text size, tool rows expanded/collapsed default.
- Saved-points → tag_location toggle.

## Diagnostics tab

- Stream health big view: freshness, measured fps/Hz, bandwidth, msg counts.
- Bridge/service info: bridge uptime, connected viewer count, LCM
  subscription status, panel version.
- (Deliberately NOT included: Jetson tegrastats, DimOS run-log tail — user
  declined the plumbing.)

## Bridge plumbing required

- Per-stream rate + bandwidth meters (source msg rates from LCM callbacks,
  wire bytes at websocket send).
- Camera resolution in state; speed computed from odom history; nav state
  derivation (idle/planning/walking/arrived/no-path) + distance-to-goal;
  run timer (online-since tracking).
- `/ws/depth?cmap=` per-connection colormap + occasional text frame {lo,hi}
  for the range badge.
- `/api/settings` GET/POST → `bridge/settings.json` (jpeg quality, caps,
  teleop speeds, yolo defaults, quick actions...).
- Navigation tab phase: saved-points store + confirm-goal flow + explore
  status surfacing.
- `/detections` comes from the Detection2DModule patch in `g1_agentic_nav.py`
  (robot-side, user-run; publishes what the bridge already subscribes).

## Build order (agreed)

1. **Control tab end-to-end** (bridge extensions + frame + Control tab),
   deploy, verify live.
2. Navigation tab. 3. Settings. 4. Diagnostics.
Backward compatibility during rollout: /ws/state only ADDS fields so the old
UI keeps working if the bridge deploys first.

## Deploy loop (unchanged)

PC: `powershell -ExecutionPolicy Bypass -File sync.ps1` → Jetson:
`cd ~/robostore-control/web && npm run build` (web changed) →
`sudo systemctl restart robostore-control`.
