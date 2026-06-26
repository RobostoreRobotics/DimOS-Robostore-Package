import React, { useEffect, useRef } from "react";
import { subscribeWS } from "../ws.js";

// Module-level so the latest frame survives the component moving between
// the main slot and the small slot (React remounts it on swap).
let lastUrl = null;

const NATIVE_W = 640;
const NATIVE_H = 480;

function drawBoxes(canvas, img, detections, show) {
  if (!canvas) return;
  const rect = canvas.parentElement.getBoundingClientRect();
  if (canvas.width !== Math.round(rect.width)) canvas.width = Math.round(rect.width);
  if (canvas.height !== Math.round(rect.height)) canvas.height = Math.round(rect.height);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!show || !detections || detections.length === 0) return;

  const nw = img?.naturalWidth || NATIVE_W;
  const nh = img?.naturalHeight || NATIVE_H;
  // Same letterbox math as the displayed image (object-fit: contain).
  const scale = Math.min(canvas.width / nw, canvas.height / nh);
  const offX = (canvas.width - nw * scale) / 2;
  const offY = (canvas.height - nh * scale) / 2;

  ctx.font = "600 11px Consolas, monospace";
  for (const d of detections) {
    const x = offX + (d.cx - d.w / 2) * scale;
    const y = offY + (d.cy - d.h / 2) * scale;
    const w = d.w * scale;
    const h = d.h * scale;
    ctx.strokeStyle = "#e8b54d";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
    // Gold label tab with dark text. Scores aren't on the wire (DimOS ships
    // empty results) — fall back to the track id. Label flips inside the box
    // when the box touches the top/left frame edge (no clipping).
    const label = d.score != null ? `person ${d.score}` : d.id ? `person #${d.id}` : "person";
    const tw = ctx.measureText(label).width + 10;
    const lx = Math.max(x - 0.75, offX);
    const ly = y >= 17 ? y - 17 : y + 1;
    ctx.fillStyle = "#e8b54d";
    ctx.fillRect(lx, ly, tw, 17);
    ctx.fillStyle = "#181206";
    ctx.fillText(label, lx + 5, ly + 12);
  }
}

export default function CameraView({ detections, showBoxes }) {
  const imgRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (lastUrl && imgRef.current) imgRef.current.src = lastUrl;
    return subscribeWS("/ws/video", (data) => {
      const url = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      if (imgRef.current) imgRef.current.src = url;
    });
  }, []);

  useEffect(() => {
    drawBoxes(overlayRef.current, imgRef.current, detections, showBoxes);
  }, [detections, showBoxes]);

  return (
    <div className="viewwell">
      <img ref={imgRef} alt="camera" />
      <canvas ref={overlayRef} className="overlay-canvas" />
    </div>
  );
}
