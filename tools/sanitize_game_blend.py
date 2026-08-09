"""Make the included Blender asset portable and safe for public release."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


SAFE_OBJECT_PROPS = {
    "CannonAssetRoot": {"asset_role", "asset_id", "asset_version", "license"},
    "CannonYaw": {"runtime_control"},
    "CannonPitch": {"runtime_control"},
    "CannonRecoil": {"runtime_control"},
    "MuzzleAnchor": {"runtime_control"},
    "CannonChargeGlow": {"runtime_control"},
    "CannonAmmoGlow": {"runtime_control"},
    "CannonGaugeNeedle": {"runtime_control"},
    "CannonStatusLight": {"runtime_control"},
    "CannonMuzzleGlow": {"runtime_control"},
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", required=True)
    return parser.parse_args(argv)


def apply_modifiers() -> None:
    for obj in list(bpy.context.scene.objects):
        obj.animation_data_clear()
        allowed = SAFE_OBJECT_PROPS.get(obj.name, set())
        for key in list(obj.keys()):
            if key != "_RNA_UI" and key not in allowed:
                del obj[key]
        if obj.type != "MESH":
            continue

        obj.hide_set(False)
        obj.hide_viewport = False
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def main() -> None:
    args = parse_args()
    output_blend = Path(args.output_blend).resolve()
    output_blend.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    for key in list(scene.keys()):
        del scene[key]
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    scene.render.filepath = "//renders/"
    scene.frame_start = 1
    scene.frame_end = 240

    apply_modifiers()

    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)

    bpy.ops.outliner.orphans_purge(
        do_local_ids=True,
        do_linked_ids=True,
        do_recursive=True,
    )
    for library in list(bpy.data.libraries):
        bpy.data.libraries.remove(library)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), compress=True)

    linked_groups = [group.name for group in bpy.data.node_groups if group.library]
    if linked_groups or bpy.data.libraries:
        raise RuntimeError(
            f"External Blender libraries remain: groups={linked_groups}, "
            f"libraries={[library.filepath for library in bpy.data.libraries]}"
        )

    print(
        f"SANITIZE_OK blend={output_blend} objects={len(scene.objects)} "
        f"libraries={len(bpy.data.libraries)} markers={len(scene.timeline_markers)}"
    )


if __name__ == "__main__":
    main()
