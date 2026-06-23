"""G1 camera+LiDAR fusion: Webcam color (real D435i intrinsics) + Mid-360 LiDAR.

Stage-1 fusion viz:
  - Split Rerun layout: color camera (2D) | LiDAR SLAM world (3D).
  - Camera pinhole re-parented to the optical TF frame via a visual_override so the
    frustum sits correctly in the cloud and Rerun's single-parent rule is satisfied.
  - RGB /dev/video node is auto-detected, and a self-healing capture loop re-opens it
    if the D435i re-enumerates on USB-2 mid-run (which both fails reads and renumbers
    /dev/videoN), so /color_image recovers without a run restart.
"""
import os
from typing import Any

from dimos.core.coordination.blueprints import autoconnect
from dimos.core.global_config import global_config
from dimos.hardware.sensors.camera.module import CameraModule
from dimos.hardware.sensors.camera.webcam import Webcam
from dimos.hardware.sensors.lidar.fastlio2.module import FastLio2
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.msgs.sensor_msgs.CameraInfo import CameraInfo
from dimos.visualization.vis_module import vis_module

# Real D435i 640x480 color intrinsics (measured via pyrealsense2).
_D435_INFO = CameraInfo(
    width=640,
    height=480,
    distortion_model="plumb_bob",
    K=[604.6661, 0.0, 323.3864, 0.0, 604.3251, 249.5027, 0.0, 0.0, 1.0],
    D=[0.0, 0.0, 0.0, 0.0, 0.0],
    frame_id="camera_optical",
)


def _find_realsense_rgb_index(default: int = 5) -> int:
    """Find the D435i RGB (YUYV) /dev/video node by capability, not a fixed number.

    The D435i can re-enumerate on the USB bus (especially over USB-2), which renumbers
    /dev/videoN -- so a hardcoded index breaks. Pick the RealSense node whose cv2 fourcc
    is YUYV (the color sensor). Falls back to ``default`` if probing finds nothing.
    """
    import glob

    import cv2

    for dev in sorted(glob.glob("/dev/video*"), key=lambda d: int(d.rsplit("video", 1)[1])):
        idx = int(dev.rsplit("video", 1)[1])
        try:
            with open(f"/sys/class/video4linux/video{idx}/name") as fh:
                name = fh.read()
        except OSError:
            continue
        if "RealSense" not in name:
            continue
        cap = cv2.VideoCapture(idx)
        try:
            if not cap.isOpened():
                continue
            fourcc = int(cap.get(cv2.CAP_PROP_FOURCC))
            cc = "".join(chr((fourcc >> 8 * i) & 0xFF) for i in range(4))
            if cc == "YUYV":
                return idx
        finally:
            cap.release()
    return default


class ResilientWebcam(Webcam):
    """Self-healing Webcam: re-detects + re-opens the RealSense RGB node on read failure.

    The stock Webcam capture thread dies on a single failed cv2 read, and the D435i can
    re-enumerate on USB-2 mid-run (failing reads AND renumbering /dev/videoN). This
    overrides the capture loop so that on any read error it releases the device,
    re-detects the YUYV node, re-opens it, and resumes -- the camera self-heal watchdog,
    so /color_image recovers automatically without restarting the run.
    """

    def _reopen(self) -> bool:
        import cv2

        if self._capture is not None:
            try:
                self._capture.release()
            except Exception:
                pass
            self._capture = None
        idx = _find_realsense_rgb_index(default=self.config.camera_index)
        cap = cv2.VideoCapture(idx)
        if not cap.isOpened():
            cap.release()
            return False
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.config.width)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.config.height)
        self._capture = cap
        return True

    def _capture_loop(self) -> None:
        import time

        frame_interval = 0.0 if self.config.fps <= 0 else 1.0 / self.config.fps
        next_frame_time = time.time()
        while not self._stop_event.is_set():
            try:
                if self._capture is None or not self._capture.isOpened():
                    raise RuntimeError("capture closed")
                image = self.capture_frame()
            except Exception:
                # Device dropped / re-enumerated: back off, re-detect, re-open, resume.
                if self._stop_event.wait(timeout=1.0):
                    break
                self._reopen()
                next_frame_time = time.time()
                continue

            if self._observer and not self._stop_event.is_set():
                self._observer.on_next(image)

            if frame_interval <= 0:
                continue
            next_frame_time += frame_interval
            sleep_time = next_frame_time - time.time()
            if sleep_time > 0:
                if self._stop_event.wait(timeout=sleep_time):
                    break
            else:
                next_frame_time = time.time()


def _create_webcam() -> Webcam:
    return ResilientWebcam(
        camera_index=_find_realsense_rgb_index(),
        fps=15,
        stereo_slice=None,
        camera_info=_D435_INFO,
    )


def _convert_camera_info(camera_info: Any) -> Any:
    # Log the camera pinhole at the color-image entity, parented to the optical TF
    # frame. Returning this (image_topic, Pinhole) tuple keeps the bridge from also
    # attaching a separate Transform3D parent (the "single parent" conflict).
    return camera_info.to_rerun(
        image_topic="/world/color_image",
        optical_frame="camera_optical",
    )


def _g1_rerun_blueprint() -> Any:
    """Split layout: color camera (2D) left, LiDAR SLAM world (3D) right."""
    import rerun as rr
    import rerun.blueprint as rrb

    return rrb.Blueprint(
        rrb.Horizontal(
            rrb.Spatial2DView(origin="world/color_image", name="Camera"),
            rrb.Spatial3DView(
                origin="world",
                name="3D",
                background=rrb.Background(kind="SolidColor", color=[0, 0, 0]),
                line_grid=rrb.LineGrid3D(
                    plane=rr.components.Plane3D.XY.with_distance(0.5),
                ),
            ),
            column_shares=[1, 2],
        ),
    )


_rerun_config = {
    "blueprint": _g1_rerun_blueprint,
    "visual_override": {
        "world/camera_info": _convert_camera_info,
    },
}


g1_fusion = autoconnect(
    vis_module(viewer_backend=global_config.viewer, rerun_config=_rerun_config),
    FastLio2.blueprint(
        host_ip=os.getenv("LIDAR_HOST_IP", "192.168.123.164"),
        lidar_ip=os.getenv("LIDAR_IP", "192.168.123.120"),
        config="default.yaml",
    ),
    CameraModule.blueprint(
        transform=Transform(
            translation=Vector3(0.05674, 0.0175, 0.01598),
            rotation=Quaternion(-0.009057, 0.130657, -0.068558, 0.989013),  # plane-calibrated 2026-06-11
            frame_id="body",
            child_frame_id="camera_link",
        ),
        hardware=_create_webcam,
    ),
).global_config(n_workers=4, robot_model="unitree_g1")

__all__ = ["g1_fusion"]
