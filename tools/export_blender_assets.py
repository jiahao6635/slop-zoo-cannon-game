"""Build a lightweight, game-ready cannon asset from the original Blender scene.

This optional extraction helper is intended for the original full production
scene. Normal contributors should run ``npm run export:assets`` instead, which
exports the included game-ready Blender file. The generated hierarchy exposes
CannonYaw, CannonPitch, CannonRecoil and MuzzleAnchor nodes for Three.js.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


BASE_NAMES = {"CANNON_Foot", "CANNON_Base", "CANNON_Pedestal"}
YAW_ONLY_TOKENS = ("Yoke", "Hydraulic")


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--output-glb", required=True)
    return parser.parse_args(argv)


def link_empty(name: str, world_location: tuple[float, float, float]) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.35
    bpy.context.scene.collection.objects.link(obj)
    obj.matrix_world = Matrix.Translation(world_location)
    return obj


def parent_keep_world(obj: bpy.types.Object, parent: bpy.types.Object) -> None:
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def main() -> None:
    args = parse_args()
    project_root = Path(__file__).resolve().parents[1]
    output_blend = (project_root / args.output_blend).resolve()
    output_glb = (project_root / args.output_glb).resolve()
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    output_glb.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.frame_set(1)
    scene.name = "SlopZoo_GameAssets"

    cannon_objects = [obj for obj in scene.objects if obj.name.startswith("CANNON_")]
    if not cannon_objects:
        raise RuntimeError("No CANNON_* objects were found in the source scene")

    keep = set(cannon_objects)
    for obj in list(bpy.data.objects):
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)

    for obj in cannon_objects:
        obj.animation_data_clear()
        obj.hide_set(False)
        obj.hide_render = False
        obj.select_set(False)

    root = link_empty("CannonAssetRoot", (0.0, 0.0, 0.0))
    yaw = link_empty("CannonYaw", (0.0, 0.0, 0.0))
    pitch = link_empty("CannonPitch", (0.0, 0.0, 1.55))
    recoil = link_empty("CannonRecoil", (0.0, 0.0, 1.55))
    muzzle = link_empty("MuzzleAnchor", (3.48, 0.0, 1.84))

    parent_keep_world(yaw, root)
    parent_keep_world(pitch, yaw)
    parent_keep_world(recoil, pitch)
    parent_keep_world(muzzle, recoil)

    for obj in cannon_objects:
        if obj.name in BASE_NAMES:
            parent_keep_world(obj, root)
        elif any(token in obj.name for token in YAW_ONLY_TOKENS):
            parent_keep_world(obj, yaw)
        else:
            parent_keep_world(obj, recoil)

    root["asset_role"] = "game_cannon"
    yaw["runtime_control"] = "yaw"
    pitch["runtime_control"] = "pitch"
    recoil["runtime_control"] = "recoil"
    muzzle["runtime_control"] = "projectile_origin"

    bpy.context.view_layer.objects.active = root
    for obj in scene.objects:
        obj.select_set(True)

    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), compress=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output_glb),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_extras=True,
        export_yup=True,
    )

    mesh_count = sum(obj.type == "MESH" for obj in scene.objects)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangle_count = 0
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        triangle_count += len(evaluated_mesh.loop_triangles)
        evaluated.to_mesh_clear()
    print(
        f"EXPORT_OK blend={output_blend} glb={output_glb} "
        f"objects={len(scene.objects)} meshes={mesh_count} triangles={triangle_count}"
    )


if __name__ == "__main__":
    main()
