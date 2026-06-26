import React from "react";

// Line icon set (1.7 stroke, round caps) — single source for the whole panel.
const PATHS = {
  keyboard: (
    <>
      <rect x="2.5" y="6.5" width="19" height="11" rx="2" />
      <path d="M6 10h.01M9.5 10h.01M13 10h.01M16.5 10h.01M6 13.5h.01M16.5 13.5h.01M9 13.5h6" />
    </>
  ),
  stick: (
    <>
      <circle cx="12" cy="8" r="3" />
      <path d="M12 11v4" />
      <path d="M7 15h10l1.5 3.5h-13z" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  plus: <path d="M12 6v12M6 12h12" />,
  minus: <path d="M6 12h12" />,
  fit: (
    <path d="M9 3.5H5a1.5 1.5 0 0 0-1.5 1.5v4M15 3.5h4A1.5 1.5 0 0 1 20.5 5v4M9 20.5H5A1.5 1.5 0 0 1 3.5 19v-4M15 20.5h4a1.5 1.5 0 0 0 1.5-1.5v-4" />
  ),
  follow: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <path d="M4.5 6.5h15M9.5 6.5v-2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-13" />
  ),
  sliders: (
    <>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </>
  ),
  stop: <rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none" />,
  axis: <path d="M7 17V7m0 10h10M10 9.5 7 6.5l-3 3" transform="translate(1.5,0.5)" />,
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M15.5 8.5l-2 5-5 2 2-5z" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 14l3.5-3.5" />
      <path d="M4 18h16" />
    </>
  ),
  route: (
    <>
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <path d="M8 17h6a3.5 3.5 0 0 0 0-7h-4" />
    </>
  ),
  flag: (
    <>
      <path d="M5.5 21V4" />
      <path d="M5.5 4.5c5-2.5 8 2.5 13 0v9c-5 2.5-8-2.5-13 0" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.4" />
    </>
  ),
  layers: (
    <path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5zM4.5 12.5 12 16.5l7.5-4M4.5 16.5 12 20.5l7.5-4" />
  ),
  grid: <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />,
  glow: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-.8 2-1.8 0-1.6-1.5-2-1.5-3.2 0-1 .8-1.5 2-1.5h2A4.5 4.5 0 0 0 21 10c-.5-4-4.3-7-9-7z" />
      <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
      <circle cx="10" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="7" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  power: (
    <>
      <path d="M12 3v8" />
      <path d="M7 6.3a7 7 0 1 0 10 0" />
    </>
  ),
  stand: (
    <>
      <circle cx="12" cy="4" r="2" />
      <path d="M12 6.5v7M12 13.5l-3.5 6M12 13.5l3.5 6M8 9.5h8" />
    </>
  ),
  run: (
    <>
      <circle cx="13.5" cy="4.5" r="2" />
      <path d="M5.5 13l3.5-2.5 3 1.5 1.5 3.5M11.5 12l-1.5 4.5 3.5 3M14 8.5l2 3 3.5-.5" />
    </>
  ),
  walk: (
    <>
      <circle cx="12.5" cy="4" r="2" />
      <path d="M12.5 6.5l-2 5.5 1.5 3.5M12.5 8.5l3 2.5M10.5 12l-2.5 6.5M14 15.5l2 4" />
    </>
  ),
};

export default function Icon({ name, size, style }) {
  return (
    <svg
      className="ico"
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size, ...style } : style}
      aria-hidden="true"
    >
      {PATHS[name] || null}
    </svg>
  );
}
