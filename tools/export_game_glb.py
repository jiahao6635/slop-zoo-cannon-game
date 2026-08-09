"""Export the included game-ready Blender scene as a GLB asset."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bmesh
import bpy


REQUIRED_NODE_CONTRACT = {
    "CannonAssetRoot": (None, "game_cannon"),
    "CannonYaw": ("CannonAssetRoot", "yaw"),
    "CannonPitch": ("CannonYaw", "pitch"),
    "CannonRecoil": ("CannonPitch", "recoil"),
    "MuzzleAnchor": ("CannonRecoil", "projectile_origin"),
    "CannonChargeGlow": ("CannonRecoil", "charge_glow"),
    "CannonAmmoGlow": ("CannonRecoil", "ammo_reservoir"),
    "CannonGaugeNeedle": ("CannonRecoil", "charge_gauge"),
    "CannonStatusLight": ("CannonRecoil", "status_light"),
    "CannonMuzzleGlow": ("CannonRecoil", "muzzle_glow"),
}
MERGE_GROUPS = {
    "CannonAssetRoot": "CannonRootRender",
    "CannonYaw": "CannonYawRender",
    "CannonRecoil": "CannonRecoilRender",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-glb", required=True)
    return parser.parse_args(argv)


def validate_contract() -> None:
    for name, (expected_parent, expected_role) in REQUIRED_NODE_CONTRACT.items():
        obj = bpy.data.objects.get(name)
        if obj is None:
            raise RuntimeError(f"Required runtime node is missing: {name}")
        if obj.type != "EMPTY":
            raise RuntimeError(f"Runtime node must be an EMPTY: {name} ({obj.type})")
        actual_parent = obj.parent.name if obj.parent else None
        if actual_parent != expected_parent:
            raise RuntimeError(
                f"Invalid parent for {name}: expected {expected_parent}, got {actual_parent}"
            )
        key = "asset_role" if name == "CannonAssetRoot" else "runtime_control"
        if obj.get(key) != expected_role:
            raise RuntimeError(
                f"Invalid {key} for {name}: expected {expected_role}, got {obj.get(key)}"
            )


def apply_modifiers_and_clean_meshes() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            continue
        obj.hide_set(False)
        obj.hide_viewport = False
        bpy.ops.object.select_all(action="DESELECT")
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)

        mesh = obj.data
        while mesh.uv_layers:
            mesh.uv_layers.remove(mesh.uv_layers[0])
        while mesh.color_attributes:
            mesh.color_attributes.remove(mesh.color_attributes[0])

        editable = bmesh.new()
        editable.from_mesh(mesh)
        bmesh.ops.remove_doubles(editable, verts=editable.verts, dist=0.000001)
        bmesh.ops.dissolve_degenerate(editable, edges=editable.edges, dist=0.000001)
        editable.to_mesh(mesh)
        editable.free()
        mesh.update()

    for material in bpy.data.materials:
        material.use_backface_culling = True


def merge_render_meshes() -> None:
    for parent_name, output_name in MERGE_GROUPS.items():
        parent = bpy.data.objects.get(parent_name)
        if parent is None:
            raise RuntimeError(f"Cannot merge missing group: {parent_name}")
        meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH" and obj.parent == parent]
        if not meshes:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        for obj in meshes:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = meshes[0]
        bpy.ops.object.join()
        meshes[0].name = output_name
        meshes[0].data.name = f"{output_name}_Mesh"


def scene_stats() -> tuple[int, int, int]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangle_count = 0
    mesh_count = 0
    degenerate_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh_count += 1
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        triangle_count += len(evaluated_mesh.loop_triangles)
        degenerate_count += sum(
            triangle.area <= 0.0000000001 for triangle in evaluated_mesh.loop_triangles
        )
        evaluated.to_mesh_clear()
    return mesh_count, triangle_count, degenerate_count


def main() -> None:
    args = parse_args()
    output_glb = Path(args.output_glb).resolve()
    output_glb.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    validate_contract()
    for key in list(scene.keys()):
        del scene[key]
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    scene.render.filepath = ""
    apply_modifiers_and_clean_meshes()
    merge_render_meshes()
    mesh_count, triangle_count, degenerate_count = scene_stats()
    if degenerate_count:
        raise RuntimeError(f"Export contains {degenerate_count} zero-area triangles")
    if triangle_count > 40000:
        raise RuntimeError(f"Cannon triangle budget exceeded: {triangle_count} > 40000")
    if mesh_count > 12:
        raise RuntimeError(f"Cannon mesh budget exceeded: {mesh_count} > 12")

    bpy.ops.object.select_all(action="SELECT")
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
        export_texcoords=False,
        export_vertex_color="NONE",
        export_copyright=(
            "Copyright (c) 2026 jiahao6635; "
            "SPDX-License-Identifier: MIT"
        ),
        export_yup=True,
    )

    print(
        f"EXPORT_OK glb={output_glb} objects={len(scene.objects)} "
        f"meshes={mesh_count} triangles={triangle_count} degenerates={degenerate_count}"
    )


if __name__ == "__main__":
    main()
