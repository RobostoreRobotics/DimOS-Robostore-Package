import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { subscribeWS } from "../ws.js";

// Latest clouds survive remounts (slot swaps rebuild the renderer).
let lastMap = null;
let lastScan = null;

async function parseCloudPacket(buf) {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen)));
  const compressed = new Uint8Array(buf, 4 + hlen);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  const points = new Float32Array(await new Response(stream).arrayBuffer());
  return { header, points };
}

// Round-sprite texture so points render as soft discs instead of GL squares.
function makeCircleTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.8, "rgba(255,255,255,1)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Height ramp, Rerun-style variety in theme colors:
// floor blue-gray -> teal -> green -> gold -> red (5 stops, 4 segments).
const Z_MIN = -1.4;
const Z_MAX = 1.5;
const STOPS = [
  [0x36 / 255, 0x46 / 255, 0x5a / 255],
  [0x4e / 255, 0xa4 / 255, 0xb8 / 255],
  [0x3f / 255, 0xd6 / 255, 0x8a / 255],
  [0xe8 / 255, 0xb5 / 255, 0x4d / 255],
  [0xe5 / 255, 0x48 / 255, 0x4d / 255],
];

function heightColors(arr) {
  const n = arr.length / 3;
  const colors = new Float32Array(arr.length);
  const segs = STOPS.length - 1;
  for (let i = 0; i < n; i++) {
    const z = arr[i * 3 + 2];
    let t = (z - Z_MIN) / (Z_MAX - Z_MIN);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const seg = Math.min(segs - 1, Math.floor(t * segs));
    const u = t * segs - seg;
    const a = STOPS[seg];
    const b = STOPS[seg + 1];
    colors[i * 3] = a[0] + (b[0] - a[0]) * u;
    colors[i * 3 + 1] = a[1] + (b[1] - a[1]) * u;
    colors[i * 3 + 2] = a[2] + (b[2] - a[2]) * u;
  }
  return colors;
}

function setCloud(pointsObj, arr, withHeightColors) {
  pointsObj.geometry.dispose();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(arr, 3));
  if (withHeightColors) {
    geom.setAttribute("color", new THREE.BufferAttribute(heightColors(arr), 3));
  }
  pointsObj.geometry = geom;
}

const CloudView = forwardRef(function CloudView(
  { odom, showMap = true, showScan = true, pointSize = 0.045 },
  ref
) {
  const containerRef = useRef(null);
  const markerRef = useRef(null);
  const controlsRef = useRef(null);
  const cameraRef = useRef(null);
  const mapPointsRef = useRef(null);
  const scanPointsRef = useRef(null);
  const odomRef = useRef(null);
  odomRef.current = odom;

  useEffect(() => {
    const container = containerRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setClearColor(0x050607);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200);
    camera.up.set(0, 0, 1); // odom frame is z-up
    camera.position.set(4, -4, 3);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, -0.5);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controlsRef.current = controls;

    const grid = new THREE.GridHelper(20, 20, 0x252b33, 0x14181d);
    grid.rotation.x = Math.PI / 2; // GridHelper is XZ by default; lay it into XY
    grid.position.z = -1.2; // approximate floor in the odom frame
    scene.add(grid);

    const sprite = makeCircleTexture();
    const mapPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        size: pointSize,
        sizeAttenuation: true,
        map: sprite,
        alphaTest: 0.5,
        vertexColors: true,
      })
    );
    const scanPoints = new THREE.Points(
      new THREE.BufferGeometry(),
      new THREE.PointsMaterial({
        color: 0xffd968,
        size: pointSize * 1.33,
        sizeAttenuation: true,
        map: sprite,
        alphaTest: 0.5,
      })
    );
    mapPoints.frustumCulled = false;
    scanPoints.frustumCulled = false;
    scene.add(mapPoints, scanPoints);
    mapPointsRef.current = mapPoints;
    scanPointsRef.current = scanPoints;

    // Robot marker: gold cone pointing along heading + drop-line to the floor.
    const marker = new THREE.Group();
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.12, 0.35, 16),
      new THREE.MeshBasicMaterial({ color: 0xe8b54d })
    );
    cone.rotation.z = -Math.PI / 2; // cone tip (+Y) -> +X, group yaw does the rest
    marker.add(cone);
    const dropLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -1.2),
      ]),
      new THREE.LineBasicMaterial({ color: 0xe8b54d })
    );
    marker.add(dropLine);
    scene.add(marker);
    markerRef.current = marker;

    if (lastMap) setCloud(mapPoints, lastMap, true);
    if (lastScan) setCloud(scanPoints, lastScan, false);

    const unsubscribe = subscribeWS("/ws/cloud", async (data) => {
      try {
        const { header, points } = await parseCloudPacket(data);
        if (header.kind === "map") {
          lastMap = points;
          setCloud(mapPoints, points, true);
        } else {
          lastScan = points;
          setCloud(scanPoints, points, false);
        }
      } catch {
        /* ignore malformed packet */
      }
    });

    const resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      sprite.dispose();
      container.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const marker = markerRef.current;
    if (marker && odom) {
      marker.position.set(odom.x, odom.y, 0);
      marker.rotation.z = odom.yaw;
    }
  }, [odom]);

  // Edge-control wiring: layer visibility + point size from the host panel.
  useEffect(() => {
    if (mapPointsRef.current) mapPointsRef.current.visible = showMap;
    if (scanPointsRef.current) scanPointsRef.current.visible = showScan;
  }, [showMap, showScan]);

  useEffect(() => {
    if (mapPointsRef.current) mapPointsRef.current.material.size = pointSize;
    if (scanPointsRef.current) scanPointsRef.current.material.size = pointSize * 1.33;
  }, [pointSize]);

  useImperativeHandle(ref, () => ({
    recenter() {
      const o = odomRef.current;
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      if (!o || !controls || !camera) return;
      controls.target.set(o.x, o.y, -0.3);
      camera.position.set(o.x + 3, o.y - 3, 2.5);
    },
  }));

  return <div className="viewwell cloud-fill" ref={containerRef} />;
});

export default CloudView;
