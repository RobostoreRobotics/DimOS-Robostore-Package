"""G1 fusion + person detection & tracking (course module 4).

Builds on the g1-fusion viz (camera color + Mid-360 SLAM, split layout, frustum-in-cloud)
and adds person detection + 3D localization + tracking:
  - Detection3DModule: YOLO person detector (yolo11n-pose) on the color image, then
    projects each 2D detection onto the LiDAR pointcloud (via camera_info + TF) for 3D.
  - PersonTracker: picks the largest detected person -> world-frame target PoseStamped.
"""
import os

from dimos.core.coordination.blueprints import autoconnect
from dimos.core.global_config import global_config
from dimos.hardware.sensors.camera.module import CameraModule
from dimos.hardware.sensors.lidar.fastlio2.module import FastLio2
from dimos.msgs.geometry_msgs.Quaternion import Quaternion
from dimos.msgs.geometry_msgs.Transform import Transform
from dimos.msgs.geometry_msgs.Vector3 import Vector3
from dimos.perception.detection.detectors.person.yolo import YoloPersonDetector
from dimos.perception.detection.module3D import Detection3DModule
from dimos.perception.detection.person_tracker import PersonTracker
from dimos.visualization.vis_module import vis_module

# Reuse the proven g1-fusion pieces (real D435i intrinsics, webcam factory, split-layout
# rerun config with the camera_info pinhole re-parented to the optical frame).
from dimos.robot.unitree.g1.blueprints.g1_fusion import (
    _D435_INFO,
    _create_webcam,
    _rerun_config,
)


def _person_detector() -> YoloPersonDetector:
    # Force GPU: gpu_utils.is_cuda_available() gates on pycuda (not installed) -> would
    # pick CPU. torch.cuda IS available (verified in the forkserver worker), so pin cuda.
    return YoloPersonDetector(device="cuda")


def _detections_to_boxes(det_array):
    # Detection2DArray has no to_rerun, so /detections is not drawn by default.
    # Convert the YOLO person boxes to rr.Boxes2D and log them on the color-image
    # entity (the same list-of-tuples trick CameraInfo.to_rerun uses) so they
    # overlay the live feed in the 2D pane. Empty list clears stale boxes.
    import rerun as rr

    dets = getattr(det_array, "detections", None) or []
    centers, sizes, labels = [], [], []
    for d in dets:
        b = d.bbox
        centers.append([b.center.position.x, b.center.position.y])
        sizes.append([b.size_x, b.size_y])
        score = d.results[0].hypothesis.score if getattr(d, "results", None) else 0.0
        labels.append(f"#{d.id} {score:.2f}")
    return [("world/color_image", rr.Boxes2D(centers=centers, sizes=sizes, labels=labels))]


# Reuse the g1-fusion viewer layout + camera_info single-parent fix, and add the
# person-box overlay on the color image.
_rerun_config_det = {
    **_rerun_config,
    "visual_override": {
        **_rerun_config["visual_override"],
        "world/detections": _detections_to_boxes,
    },
}


g1_fusion_detection = (
    autoconnect(
        vis_module(viewer_backend=global_config.viewer, rerun_config=_rerun_config_det),
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
        Detection3DModule.blueprint(camera_info=_D435_INFO, detector=_person_detector),
        PersonTracker.blueprint(cameraInfo=_D435_INFO),
    )
    .remappings(
        [
            (Detection3DModule, "pointcloud", "lidar"),
        ]
    )
    .global_config(n_workers=8, robot_model="unitree_g1")
)

__all__ = ["g1_fusion_detection"]
