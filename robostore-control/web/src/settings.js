// Panel settings client — bridge-side persistence (GET/POST /api/settings).
// Falls back to local defaults until the bridge answers.

const DEFAULTS = {
  jpeg_quality: 70,
  map_point_cap: 150000,
  scan_point_cap: 20000,
  teleop: { fwd: 0.35, strafe: 0.2, yaw: 0.6, joy_fwd: 0.4, joy_yaw: 0.6 },
  yolo: { default_on: true, min_score: 0.4 },
  chat: { text_size: 13, tools_expanded: false },
  quick_actions: ["HighWave", "HandsUp", "Clap", "CancelAction", "Handshake"],
  save_points_tag_location: false,
};

let current = JSON.parse(JSON.stringify(DEFAULTS));
let loaded = false;
const listeners = new Set();

function notify() {
  for (const cb of listeners) cb(current);
}

export async function loadSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.ok && data.settings) {
      current = data.settings;
      loaded = true;
      notify();
    }
  } catch {
    /* bridge unreachable — keep defaults, retry on next load call */
  }
  return current;
}

export function getSettings() {
  return current;
}

export function getSetting(path, fallback) {
  let node = current;
  for (const key of path.split(".")) {
    if (node == null || typeof node !== "object" || !(key in node)) return fallback;
    node = node[key];
  }
  return node;
}

export async function updateSettings(patch) {
  try {
    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (data.ok && data.settings) {
      current = data.settings;
      notify();
    }
    return data.ok;
  } catch {
    return false;
  }
}

export function subscribeSettings(cb) {
  listeners.add(cb);
  if (loaded) cb(current);
  return () => listeners.delete(cb);
}
