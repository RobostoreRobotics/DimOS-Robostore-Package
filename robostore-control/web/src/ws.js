// Self-reconnecting websocket helper. One socket per stream, shared app-wide.

const sockets = new Map();

export function subscribeWS(path, onMessage, { binaryType = "arraybuffer" } = {}) {
  let entry = sockets.get(path);
  if (!entry) {
    entry = { listeners: new Set(), ws: null, closed: false };
    sockets.set(path, entry);
    connect(path, entry, binaryType);
  }
  entry.listeners.add(onMessage);
  return () => {
    entry.listeners.delete(onMessage);
    // Last listener gone: close the socket so parameterized streams
    // (e.g. /ws/depth?cmap=…) don't keep consuming bandwidth forever.
    if (entry.listeners.size === 0) {
      entry.closed = true;
      sockets.delete(path);
      if (entry.ws) {
        try { entry.ws.close(); } catch { /* already closed */ }
      }
    }
  };
}

function connect(path, entry, binaryType) {
  if (entry.closed) return;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${window.location.host}${path}`);
  ws.binaryType = binaryType;
  entry.ws = ws;
  ws.onmessage = (ev) => {
    for (const cb of entry.listeners) cb(ev.data);
  };
  ws.onclose = () => {
    entry.ws = null;
    setTimeout(() => connect(path, entry, binaryType), 1500);
  };
  ws.onerror = () => ws.close();
}
