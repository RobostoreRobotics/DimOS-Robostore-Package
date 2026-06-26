import React, { useEffect, useRef } from "react";
import { subscribeWS } from "../ws.js";

// Module caches survive slot remounts (main <-> small swaps).
let lastPacket = null;
let gridCanvas = null;   // hi-res styled render of the latest grid
let renderedFor = null;  // { packet, glow } the gridCanvas was built from

let roboImg = null;
function getRoboImg() {
  if (!roboImg) {
    roboImg = new Image();
    roboImg.src = "/robohead.png";
  }
  return roboImg;
}

const UPSCALE = 4; // styled grid render resolution multiplier

async function parsePacket(buf) {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const compressed = new Uint8Array(buf, 4 + hlen);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const grid = new Int8Array(await new Response(stream).arrayBuffer());
  return { header, grid };
}

// World <-> grid-pixel helpers. ROS grids have +y up; canvas y is down.
function worldToGrid(header, wx, wy) {
  const { res, ox, oy, h } = header;
  return [(wx - ox) / res, h - 1 - (wy - oy) / res];
}

function gridToWorld(header, gx, gy) {
  const { res, ox, oy, h } = header;
  return [ox + gx * res, oy + (h - 1 - gy) * res];
}

function costColor(v) {
  if (v >= 100) return "#e5484d";
  const t = v / 100;
  const r = Math.round(120 + 112 * t);
  const g = Math.round(95 + 86 * t);
  const b = Math.round(45 + 32 * t);
  return `rgb(${r},${g},${b})`;
}

// Styled hi-res render: smooth unknown/free background, glow pass, then
// rounded obstacle cells. Rebuilt only when a new packet (or glow toggle)
// arrives — the per-frame draw() just blits it.
function renderGrid(packet, glow) {
  const { header, grid } = packet;
  const { w, h } = header;
  const S = UPSCALE;

  // 1x background (unknown vs free) — upscaled with smoothing for soft borders.
  const bg = document.createElement("canvas");
  bg.width = w; bg.height = h;
  const bctx = bg.getContext("2d");
  const img = bctx.createImageData(w, h);
  const px = img.data;
  for (let row = 0; row < h; row++) {
    const srcRow = h - 1 - row;
    for (let col = 0; col < w; col++) {
      const v = grid[srcRow * w + col];
      const i = (row * w + col) * 4;
      if (v < 0) { px[i] = 8; px[i + 1] = 10; px[i + 2] = 12; }
      else { px[i] = 24; px[i + 1] = 30; px[i + 2] = 38; }
      px[i + 3] = 255;
    }
  }
  bctx.putImageData(img, 0, 0);

  if (!gridCanvas) gridCanvas = document.createElement("canvas");
  if (gridCanvas.width !== w * S) gridCanvas.width = w * S;
  if (gridCanvas.height !== h * S) gridCanvas.height = h * S;
  const ctx = gridCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, w * S, h * S);
  ctx.drawImage(bg, 0, 0, w * S, h * S);

  // Collect obstacle cells once (canvas rows, not ROS rows).
  const cells = [];
  for (let row = 0; row < h; row++) {
    const srcRow = h - 1 - row;
    for (let col = 0; col < w; col++) {
      const v = grid[srcRow * w + col];
      if (v > 0) cells.push([col, row, v]);
    }
  }

  // Glow pass: obstacles drawn fat onto a mask, blurred once, composited.
  if (glow && cells.length) {
    const mask = document.createElement("canvas");
    mask.width = w * S; mask.height = h * S;
    const mctx = mask.getContext("2d");
    for (const [col, row, v] of cells) {
      mctx.fillStyle = costColor(v);
      mctx.fillRect(col * S - S * 0.4, row * S - S * 0.4, S * 1.8, S * 1.8);
    }
    ctx.filter = `blur(${S * 1.4}px)`;
    ctx.globalAlpha = 0.5;
    ctx.drawImage(mask, 0, 0);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
  }

  // Crisp rounded obstacle cells on top.
  for (const [col, row, v] of cells) {
    ctx.fillStyle = costColor(v);
    ctx.beginPath();
    ctx.roundRect(col * S + 0.5, row * S + 0.5, S - 1, S - 1, S * 0.32);
    ctx.fill();
  }

  renderedFor = { packet, glow };
}

function computeTransform(canvas, header, zoom, follow, odom) {
  const cw = canvas.width;
  const ch = canvas.height;
  const fit = Math.min(cw / header.w, ch / header.h);
  const s = fit * zoom;
  let cxG = header.w / 2;
  let cyG = header.h / 2;
  if (follow && odom) [cxG, cyG] = worldToGrid(header, odom.x, odom.y);
  return { s, tx: cw / 2 - cxG * s, ty: ch / 2 - cyG * s };
}

function draw(canvas, packet, nav, view, timeMs) {
  if (!canvas || !packet || !gridCanvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  const W = Math.round(rect.width);
  const H = Math.round(rect.height);
  if (!W || !H) return;
  if (canvas.width !== W) canvas.width = W;
  if (canvas.height !== H) canvas.height = H;

  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#050607";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;

  const { header } = packet;
  const { s, tx, ty } = computeTransform(canvas, header, view.zoom, view.follow, nav.odom);
  ctx.setTransform(s, 0, 0, s, tx, ty);
  ctx.drawImage(gridCanvas, 0, 0, header.w, header.h);

  const lw = (pxw) => pxw / s; // keep on-screen line widths constant under zoom

  // Metric grid: world-aligned 1 m lines over the map area.
  if (view.grid) {
    const { res, ox, oy } = header;
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = lw(1);
    ctx.beginPath();
    for (let wx = Math.ceil(ox); wx <= ox + header.w * res; wx += 1) {
      const gx = (wx - ox) / res;
      ctx.moveTo(gx, 0); ctx.lineTo(gx, header.h);
    }
    for (let wy = Math.ceil(oy); wy <= oy + header.h * res; wy += 1) {
      const gy = header.h - 1 - (wy - oy) / res;
      ctx.moveTo(0, gy); ctx.lineTo(header.w, gy);
    }
    ctx.stroke();
  }

  const { odom, path, goal, goalReached } = nav;

  if (path && path.length > 1) {
    ctx.beginPath();
    path.forEach(([wx, wy], i) => {
      const [gx, gy] = worldToGrid(header, wx, wy);
      if (i === 0) ctx.moveTo(gx, gy);
      else ctx.lineTo(gx, gy);
    });
    ctx.strokeStyle = "rgba(232, 181, 77, 0.9)";
    ctx.lineWidth = lw(2);
    ctx.stroke();
  }

  if (goal) {
    const [gx, gy] = worldToGrid(header, goal.x, goal.y);
    const r = Math.max(lw(5), 0.2 / header.res);
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.strokeStyle = goalReached ? "#3fd68a" : "#e8b54d";
    ctx.lineWidth = lw(2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(gx - r, gy); ctx.lineTo(gx + r, gy);
    ctx.moveTo(gx, gy - r); ctx.lineTo(gx, gy + r);
    ctx.stroke();
  }

  // --- screen-space layer (constant-size marker, scale bar) ---
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (odom) {
    const [gx, gy] = worldToGrid(header, odom.x, odom.y);
    const sx = gx * s + tx;
    const sy = gy * s + ty;

    // Soft pulse ring.
    const phase = (timeMs % 1600) / 1600;
    const pr = 15 + 7 * phase;
    ctx.beginPath();
    ctx.arc(sx, sy, pr, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(232, 181, 77, ${0.5 * (1 - phase)})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    const img = getRoboImg();
    if (img.complete && img.naturalWidth > 0) {
      const size = 30;
      ctx.save();
      ctx.translate(sx, sy);
      // Canvas y is flipped (screen heading = -yaw); the helmet-top points
      // "up" in the source image, so rotate by 90deg - yaw to face the heading.
      ctx.rotate(Math.PI / 2 - odom.yaw);
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(sx, sy, 6, 0, Math.PI * 2);
      ctx.fillStyle = "#e8b54d";
      ctx.fill();
    }
  }

  // Saved points + pending (unconfirmed) goal — screen space.
  const toScreen = (wx, wy) => {
    const [gx, gy] = worldToGrid(header, wx, wy);
    return [gx * s + tx, gy * s + ty];
  };
  for (const m of view.markers || []) {
    const [mx, my] = toScreen(m.x, m.y);
    ctx.beginPath();
    ctx.arc(mx, my, 5, 0, Math.PI * 2);
    ctx.fillStyle = "#e8b54d";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(0,0,0,.6)";
    ctx.stroke();
    ctx.font = "600 10px Cascadia Mono, Consolas, monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(232,181,77,.95)";
    ctx.fillText(m.name, mx + 8, my + 3);
  }
  if (view.pending) {
    const [px2, py2] = toScreen(view.pending.x, view.pending.y);
    const ph = (timeMs % 1200) / 1200;
    ctx.strokeStyle = "#e8a13d";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px2, py2, 10 + 3 * Math.sin(ph * Math.PI * 2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px2 - 14, py2); ctx.lineTo(px2 + 14, py2);
    ctx.moveTo(px2, py2 - 14); ctx.lineTo(px2, py2 + 14);
    ctx.stroke();
  }

  if (view.grid) {
    // Scale bar, bottom-right: 1 m (or 0.5 m when zoomed out small).
    let meters = 1;
    let len = (meters / header.res) * s;
    if (len > W * 0.3) { meters = 0.5; len = (meters / header.res) * s; }
    const bx = W - 16 - len;
    const by = H - 18;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bx, by); ctx.lineTo(bx + len, by);
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + len, by - 4); ctx.lineTo(bx + len, by + 4);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "10px Cascadia Mono, Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${meters} m`, bx + len / 2, by - 7);
  }
}

export default function CostmapView({
  odom, path, goal, goalReached,
  zoom = 1, follow = false, gridOn = true, glowOn = true,
  markers = null, pending = null,
  onWorldClick = null,
}) {
  const canvasRef = useRef(null);
  const navRef = useRef({});
  navRef.current = { odom, path, goal, goalReached };
  const viewRef = useRef({});
  viewRef.current = { zoom, follow, grid: gridOn, glow: glowOn, markers, pending };

  useEffect(() => {
    const unsub = subscribeWS("/ws/costmap", async (data) => {
      try {
        lastPacket = await parsePacket(data);
      } catch {
        /* ignore malformed packet */
      }
    });
    // rAF loop: blit + overlays each frame (cheap), restyle grid only when
    // the packet or the glow setting changes. Powers the marker pulse.
    let raf = 0;
    const loop = (t) => {
      if (lastPacket) {
        if (!renderedFor || renderedFor.packet !== lastPacket || renderedFor.glow !== viewRef.current.glow) {
          renderGrid(lastPacket, viewRef.current.glow);
        }
        draw(canvasRef.current, lastPacket, navRef.current, viewRef.current, t);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onClick = (ev) => {
    if (!onWorldClick || !lastPacket) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const px = ev.clientX - rect.left;
    const py = ev.clientY - rect.top;
    const { header } = lastPacket;
    const { s, tx, ty } = computeTransform(canvas, header, viewRef.current.zoom, viewRef.current.follow, navRef.current.odom);
    const gx = (px - tx) / s;
    const gy = (py - ty) / s;
    if (gx < 0 || gy < 0 || gx >= header.w || gy >= header.h) return;
    const [wx, wy] = gridToWorld(header, gx, gy);
    onWorldClick(wx, wy);
  };

  return (
    <div className="viewwell">
      <canvas
        ref={canvasRef}
        className="gridcanvas"
        onClick={onClick}
        style={{ cursor: onWorldClick ? "crosshair" : "default" }}
      />
    </div>
  );
}
