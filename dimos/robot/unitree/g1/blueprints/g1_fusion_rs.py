"""G1 fusion with the full RealSense depth camera (calibration + final form).

Replaces g1-fusion's cv2-webcam (color-only) with the RealSenseCamera module
(color + depth + pointcloud, addressed by serial), composed with the Mid-360
FastLIO2 SLAM. Both the LiDAR cloud (world/lidar) and the camera depth cloud
(world/pointcloud) render in one world, which is what the camera->body
extrinsic calibration needs; after calibration this is the proper fused
perception stack.

Calibration aid: the body->camera_link mount pitch is read from CAM_PITCH_DEG
(degrees about +Y; positive tilts the camera DOWN, REP-103). Default 0 = the
re-aimed roughly-level mount. The old mount was ~45.3 deg down.
"""
import math
import os
from typing import Any

from dimos.core.coordination.blueprints import autoconnect
from dimos.core.global_config import global_config
from dimos.hardware.sensors.camera.realsense.camera import RealSenseCamera
from dimos.hardware.sensors.lidar.fastlio2.module import FastLio2
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.visualization.vis_module import vis_module

_D435_SERIAL = "337122075095"


def _cam_mount() -> Transform:
    # body -> camera_link. Translation = URDF d435-relative-to-mid360 offset
    # (unchanged by the re-aim). Rotation: plane-calibrated 2026-06-11 against
    # the Mid-360 cloud (wall-normal Kabsch, roll=0 bracket assumption):
    # pitch +15.05 deg, yaw -7.93 deg. CAM_PITCH_DEG overrides with a pure
    # pitch for re-calibration runs.
    pitch_env = os.getenv("CAM_PITCH_DEG")
    if pitch_env is not None:
        half = math.radians(float(pitch_env)) / 2.0
        rot = Quaternion(0.0, math.sin(half), 0.0, math.cos(half))
    else:
        rot = Quaternion(-0.009057, 0.130657, -0.068558, 0.989013)
    return Transform(
        translation=Vector3(0.05674, 0.0175, 0.01598),
        rotation=rot,
    )


def _convert_color_info(camera_info: Any) -> Any:
    # Pinhole parented to the color optical TF frame -> no second parent.
    return camera_info.to_rerun(
        image_topic="/world/color_image", optical_frame="camera_color_optical_frame"
    )


def _convert_depth_info(camera_info: Any) -> Any:
    # Depth is aligned to color, so the depth image lives in the color optical frame.
    return camera_info.to_rerun(
        image_topic="/world/depth_image", optical_frame="camera_color_optical_frame"
    )


def _g1_rerun_blueprint() -> Any:
    """Split layout: color camera (2D) left, fused 3D world right."""
    import rerun as rr
    import rerun.blueprint as rrb

    return rrb.Blueprint(
        rrb.Horizontal(
            rrb.Spatial2DView(origin="world/color_image", name="Camera"),
            rrb.Spatial3DView(
                origin="world",
                name="3D",
                background=rrb.Background(kind="SolidColor", color=[0, 0, 0]),
                line_grid=rrb.LineGrid3D(plane=rr.components.Plane3D.XY.with_distance(0.5)),
            ),
            column_shares=[1, 2],
        ),
    )


_rerun_config = {
    "blueprint": _g1_rerun_blueprint,
    "visual_override": {
        "world/camera_info": _convert_color_info,
        "world/depth_camera_info": _convert_depth_info,
    },
}

g1_fusion_rs = autoconnect(
    vis_module(viewer_backend=global_config.viewer, rerun_config=_rerun_config),
    FastLio2.blueprint(
        host_ip=os.getenv("LIDAR_HOST_IP", "192.168.123.164"),
        lidar_ip=os.getenv("LIDAR_IP", "192.168.123.120"),
        config="default.yaml",
    ),
    RealSenseCamera.blueprint(
        width=640,
        height=480,
        fps=15,
        serial_number=_D435_SERIAL,
        base_frame_id="body",
        base_transform=_cam_mount(),
        enable_pointcloud=True,
        pointcloud_fps=5.0,
    ),
).global_config(n_workers=4, robot_model="unitree_g1")

__all__ = ["g1_fusion_rs"]
