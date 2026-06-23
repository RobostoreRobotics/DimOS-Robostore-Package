"""G1 full agentic stack with real navigation (course Modules 5+7 combined).

unitree-g1-agentic (perception + LLM agent + skills) plus the proven Mid-360
localization and the Go2-style python nav stack, with walking routed over DDS
(the proven velocity path) and WebRTC kept for arm gestures/modes/video:

  FastLio2 (odom + lidar + TF)
    -> OdometryToPose (Odometry -> PoseStamped 'odom' for the planner)
    -> VoxelGridMapper -> CostMapper (occupancy costmap from the Mid-360)
    -> ReplanningAStarPlanner (satisfies NavigationSkillContainer's spec,
       so navigate_with_text / tag_location work without --disable)
    -> MovementManager -> cmd_vel -> G1HighLevelDdsSdk (DDS velocity API)

  G1Connection (WebRTC) keeps gestures/modes/video, but its cmd_vel input is
  remapped away so the DDS effector is the only locomotion driver.
"""
import os

from reactivex.disposable import Disposable

from dimos.core.coordination.blueprints import autoconnect
from dimos.core.core import rpc
from dimos.core.module import Module
from dimos.core.stream import In, Out
from dimos.hardware.sensors.lidar.fastlio2.module import FastLio2
from dimos.mapping.costmapper import CostMapper
from dimos.mapping.voxels import VoxelGridMapper
from dimos.msgs.geometry_msgs.PoseStamped import PoseStamped
from dimos.msgs.nav_msgs.Odometry import Odometry
from dimos.msgs.sensor_msgs.PointCloud2 import PointCloud2
from dimos.navigation.movement_manager.movement_manager import MovementManager
from dimos.navigation.replanning_a_star.module import ReplanningAStarPlanner
from dimos.perception.detection.detectors.person.yolo import YoloPersonDetector
from dimos.perception.detection.module2D import Detection2DModule
from dimos.robot.unitree.g1.blueprints.agentic.unitree_g1_agentic import unitree_g1_agentic
from dimos.robot.unitree.g1.blueprints.g1_fusion import _D435_INFO
from dimos.robot.unitree.g1.config import G1
from dimos.robot.unitree.g1.connection import G1Connection
from dimos.robot.unitree.g1.effectors.high_level.dds_sdk import G1HighLevelDdsSdk



class _ResilientPersonDetector(YoloPersonDetector):
    """Long-running model.track(persist=True) state degrades after hours
    (observed live 2026-06-13: the module returned 0 detections while a fresh
    tracker saw conf 0.92 on the same frames). Self-heal: drop the predictor
    after ~1 min of consecutive empty results; it rebuilds on the next call."""

    _EMPTY_RESET = 150  # consecutive empties (~60 s at 2.5 Hz)

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._empty_streak = 0

    def process_image(self, image):
        out = super().process_image(image)
        if getattr(out, "detections", None):
            self._empty_streak = 0
        else:
            self._empty_streak += 1
            if self._empty_streak >= self._EMPTY_RESET:
                self._empty_streak = 0
                try:
                    self.stop()  # clears predictor + tracker threads; lazily rebuilt
                except Exception:
                    pass
        return out


def _person_detector() -> YoloPersonDetector:
    # Force GPU: gpu_utils.is_cuda_available() gates on pycuda (not installed) -> CPU.
    # torch.cuda IS available in the workers (forkserver preload), so pin cuda.
    return _ResilientPersonDetector(device="cuda")

class OdometryToPose(Module):
    """Adapt FastLio2's nav_msgs Odometry to the PoseStamped 'odom' stream
    ReplanningAStarPlanner expects (the Go2 gets this from its connection)."""

    odometry: In[Odometry]
    odom: Out[PoseStamped]

    @rpc
    def start(self) -> None:
        super().start()
        self.register_disposable(Disposable(self.odometry.subscribe(self._on_odometry)))

    def _on_odometry(self, od: Odometry) -> None:
        p = getattr(od.pose, "pose", od.pose)
        self.odom.publish(
            PoseStamped(
                ts=od.ts,
                frame_id=od.frame_id,
                position=p.position,
                orientation=p.orientation,
            )
        )


class SelfPointFilter(Module):
    """Drop LiDAR points inside the robot's own body envelope.

    The Mid-360 sees the G1's arms/torso/legs (0.3-1.1 m from the head
    sensor); without this filter the robot paints itself into the voxel map
    as a lethal blob at every pose it visits, so the planner can never start
    a path. Points within SELF_RADIUS (XY cylinder) of the live odom position
    are removed before mapping. FastLIO2's own odometry is unaffected.
    """

    lidar: In[PointCloud2]
    odom: In[PoseStamped]
    lidar_filtered: Out[PointCloud2]

    SELF_RADIUS = 0.55  # metres; G1 body + hanging-arm envelope (XY cylinder)
    # Mapping ceiling cut, odom z. FastLIO inits with the lidar 1.2 m above the
    # floor (mount init_pose), so the floor sits at odom z ~= -1.20 and this is
    # ~1.55 m of head clearance: nothing above it can collide with the 1.32 m
    # G1, and without the cut, cells whose floor is in the lidar's blind cone
    # get the CEILING as their terrain height (cost-100 ring around the robot).
    CEILING_Z = 0.35

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self._poses: list[tuple[float, float, float]] = []  # (ts, x, y)

    @rpc
    def start(self) -> None:
        super().start()
        self.register_disposable(Disposable(self.odom.subscribe(self._on_odom)))
        self.register_disposable(Disposable(self.lidar.subscribe(self._on_cloud)))

    def _on_odom(self, ps: PoseStamped) -> None:
        self._poses.append((float(ps.ts), float(ps.position[0]), float(ps.position[1])))
        if len(self._poses) > 90:
            self._poses = self._poses[-60:]

    def _pose_at(self, ts: float) -> tuple[float, float] | None:
        if not self._poses:
            return None
        best = min(self._poses, key=lambda p: abs(p[0] - ts))
        return best[1], best[2]

    def _on_cloud(self, pc: PointCloud2) -> None:
        import numpy as np

        pos = self._pose_at(float(pc.ts))
        if pos is None:
            return  # no pose yet: drop rather than poison the map
        pts = pc.points_f32() if callable(pc.points_f32) else pc.points_f32
        pts = np.asarray(pts)
        if pts.ndim != 2 or len(pts) == 0:
            return
        dx = pts[:, 0] - pos[0]
        dy = pts[:, 1] - pos[1]
        keep = ((dx * dx + dy * dy) > (self.SELF_RADIUS * self.SELF_RADIUS)) & (
            pts[:, 2] <= self.CEILING_Z
        )
        self.lidar_filtered.publish(
            PointCloud2.from_numpy(pts[keep], frame_id=pc.frame_id, timestamp=pc.ts)
        )


class G1DdsWalkOnly(G1HighLevelDdsSdk):
    """Walking-only DDS effector: the un-decorated overrides hide the parent's
    duplicate agent skills so UnitreeG1SkillContainer's WebRTC-backed
    execute_arm_command / execute_mode_command are the only tools with those
    names. The DDS publish_request can't service arm/mode requests (api 7106
    is unsupported) and was silently shadowing the working WebRTC path."""

    def move_velocity(self, x: float, y: float = 0.0, yaw: float = 0.0, duration: float = 0.0) -> str:
        return super().move_velocity(x, y, yaw, duration)

    def execute_arm_command(self, command_name: str) -> str:
        return super().execute_arm_command(command_name)

    def execute_mode_command(self, command_name: str) -> str:
        return super().execute_mode_command(command_name)


g1_agentic_nav = (
    autoconnect(
        unitree_g1_agentic,
        FastLio2.blueprint(
            host_ip=os.getenv("LIDAR_HOST_IP", "192.168.123.164"),
            lidar_ip=os.getenv("LIDAR_IP", "192.168.123.120"),
            mount=G1.internal_odom_offsets["mid360_link"],
            map_freq=1.0,
            config="default.yaml",
        ),
        OdometryToPose.blueprint(),
        SelfPointFilter.blueprint(),
        VoxelGridMapper.blueprint(emit_every=5),
        CostMapper.blueprint(),
        ReplanningAStarPlanner.blueprint(),
        Detection2DModule.blueprint(detector=_person_detector, camera_info=_D435_INFO),
        MovementManager.blueprint(),
        G1DdsWalkOnly.blueprint(network_interface="enP8p1s0"),
    )
    .remappings(
        [
            # Locomotion over DDS only; WebRTC keeps gestures/modes/video.
            (G1Connection, "cmd_vel", "cmd_vel_webrtc_disabled"),
            # CostMapper must hear the voxel-downsampled map, not the raw SLAM map.
            (FastLio2, "global_map", "slam_map"),
            # The map must be built from the self-filtered cloud.
            (VoxelGridMapper, "lidar", "lidar_filtered"),
        ]
    )
    .global_config(n_workers=14, robot_model="unitree_g1", robot_width=0.7)
)

__all__ = ["g1_agentic_nav"]
