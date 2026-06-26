import React, { useEffect, useRef } from "react";
import { subscribeWS } from "../ws.js";

let lastUrl = null; // survives slot remounts

export default function DepthView({ cmap = "turbo", onRange }) {
  const imgRef = useRef(null);
  const onRangeRef = useRef(onRange);
  onRangeRef.current = onRange;

  useEffect(() => {
    if (lastUrl && imgRef.current) imgRef.current.src = lastUrl;
    // cmap is a query param — changing it tears down this socket (ws.js closes
    // empty-listener sockets) and opens a new one with the new colormap.
    return subscribeWS(`/ws/depth?cmap=${cmap}`, (data) => {
      if (typeof data === "string") {
        // ~1 Hz text frame: {"lo": raw, "hi": raw} for the range badge.
        try {
          const r = JSON.parse(data);
          onRangeRef.current?.(r);
        } catch {
          /* ignore malformed frame */
        }
        return;
      }
      const url = URL.createObjectURL(new Blob([data], { type: "image/jpeg" }));
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = url;
      if (imgRef.current) imgRef.current.src = url;
    });
  }, [cmap]);

  return (
    <div className="viewwell">
      <img ref={imgRef} alt="depth" />
    </div>
  );
}
