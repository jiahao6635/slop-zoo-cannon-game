"""Upgrade the editable cannon source with game-readable runtime details.

The script is intentionally idempotent. It rebuilds only the generated V2
detail objects and leaves the hand-authored cannon body untouched.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy


UPGRADE_VERSION = 2
GENERATED_PREFIX = "CANNON_V2_"
GENERATED_GROUPS = {
    "CannonChargeGlow",
    "CannonAmmoGlow",
    "CannonGaugeNeedle",
    "CannonStatusLight",
    "CannonMuzzleGlow",
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", required=True)
    return parser.parse_args(argv)


def principled(material: bpy.types.Material) -> bpy.types.Node:
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    if node is None:
        raise RuntimeError(f"Material {material.name} has no Principled BSDF")
    return node


def set_socket(node: bpy.types.Node, names: tuple[str, ...], value) -> None:
    for name in names:
        socket = node.inputs.get(name)
        if socket is not None:
            socket.default_value = value
            return


def get_material(
    name: str,
    base_color: tuple[float, float, float, float],
    *,
    metallic: float,
    roughness: float,
    emission: tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
) -> bpy.types.Material:
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = base_color
    material.metallic = metallic
    material.roughness = roughness
    material.use_backface_culling = True
    node = principled(material)
    set_socket(node, ("Base Color",), base_color)
    set_socket(node, ("Metallic",), metallic)
    set_socket(node, ("Roughness",), roughness)
    if emission is not None:
        set_socket(node, ("Emission Color", "Emission"), emission)
        set_socket(node, ("Emission Strength",), emission_strength)
    return material


def tune_existing_materials() -> tuple[bpy.types.Material, bpy.types.Material]:
    gunmetal = get_material(
        "MAT_Gunmetal_Refined",
        (0.035, 0.12, 0.13, 1.0),
        metallic=0.72,
        roughness=0.3,
        emission=(0.008, 0.03, 0.032, 1.0),
        emission_strength=0.22,
    )
    brass = get_material(
        "MAT_AgedBrass",
        (0.58, 0.27, 0.055, 1.0),
        metallic=0.82,
        roughness=0.27,
    )
    return gunmetal, brass


def delete_generated() -> None:
    for obj in list(bpy.data.objects):
        if obj.name.startswith(GENERATED_PREFIX) or obj.name in GENERATED_GROUPS:
            bpy.data.objects.remove(obj, do_unlink=True)


def new_group(name: str, parent: bpy.types.Object, role: str) -> bpy.types.Object:
    group = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(group)
    group.parent = parent
    group["runtime_control"] = role
    group.empty_display_type = "PLAIN_AXES"
    group.empty_display_size = 0.12
    return group


def finish_mesh(
    obj: bpy.types.Object,
    name: str,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def add_torus(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    *,
    major_radius: float,
    minor_radius: float,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    major_segments: int = 24,
    minor_segments: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
    )
    return finish_mesh(bpy.context.object, name, material, parent, location, rotation)


def add_cylinder(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    *,
    radius: float,
    depth: float,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 20,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    return finish_mesh(bpy.context.object, name, material, parent, location, rotation)


def add_cube(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add()
    obj = finish_mesh(bpy.context.object, name, material, parent, location)
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new("GameBevel", "BEVEL")
    bevel.width = 0.025
    bevel.segments = 2
    return obj


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    if not objects:
        raise RuntimeError(f"Cannot join empty object list for {name}")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = objects[0]
    result.name = name
    result.data.name = f"{name}_Mesh"
    return result


def build_runtime_details() -> None:
    root = bpy.data.objects.get("CannonAssetRoot")
    recoil = bpy.data.objects.get("CannonRecoil")
    if root is None or recoil is None:
        raise RuntimeError("CannonAssetRoot and CannonRecoil are required")

    gunmetal, brass = tune_existing_materials()
    slime = get_material(
        "MAT_SlimeEnergy",
        (0.08, 0.78, 0.25, 1.0),
        metallic=0.04,
        roughness=0.2,
        emission=(0.04, 1.0, 0.28, 1.0),
        emission_strength=3.2,
    )
    safety = get_material(
        "MAT_SafetyOrange",
        (0.95, 0.22, 0.035, 1.0),
        metallic=0.38,
        roughness=0.34,
        emission=(0.4, 0.035, 0.004, 1.0),
        emission_strength=0.45,
    )

    # A readable safety ring anchors the silhouette against the dark arena.
    add_torus(
        f"{GENERATED_PREFIX}BaseSafetyRing",
        root,
        safety,
        (0.0, 0.0, 0.5),
        major_radius=0.78,
        minor_radius=0.055,
        major_segments=32,
    )

    ammo_group = new_group("CannonAmmoGlow", recoil, "ammo_reservoir")
    ammo_parts: list[bpy.types.Object] = []
    for side in (-1.0, 1.0):
        ammo_parts.append(
            add_cylinder(
                f"{GENERATED_PREFIX}AmmoCore_{side:+.0f}",
                ammo_group,
                slime,
                (-0.52, side * 0.6, 0.17),
                radius=0.155,
                depth=0.62,
                vertices=20,
            )
        )
        for z in (-0.16, 0.5):
            add_cylinder(
                f"{GENERATED_PREFIX}AmmoCap_{side:+.0f}_{z:+.2f}",
                recoil,
                brass,
                (-0.52, side * 0.6, z),
                radius=0.19,
                depth=0.08,
                vertices=20,
            )
        add_cube(
            f"{GENERATED_PREFIX}AmmoBrace_{side:+.0f}",
            recoil,
            gunmetal,
            (-0.52, side * 0.47, 0.17),
            (0.1, 0.08, 0.34),
        )
    join_objects(ammo_parts, f"{GENERATED_PREFIX}AmmoGlowMesh")

    charge_group = new_group("CannonChargeGlow", recoil, "charge_glow")
    charge_parts = [
        add_torus(
            f"{GENERATED_PREFIX}ChargeCoil_{index}",
            charge_group,
            slime,
            (x, 0.0, 0.19),
            major_radius=0.305,
            minor_radius=0.028,
            rotation=(0.0, math.pi / 2, 0.0),
        )
        for index, x in enumerate((1.28, 1.73, 2.18, 2.63))
    ]
    join_objects(charge_parts, f"{GENERATED_PREFIX}ChargeGlowMesh")

    muzzle_group = new_group("CannonMuzzleGlow", recoil, "muzzle_glow")
    add_torus(
        f"{GENERATED_PREFIX}MuzzleGlowMesh",
        muzzle_group,
        slime,
        (3.37, 0.0, 0.29),
        major_radius=0.235,
        minor_radius=0.035,
        rotation=(0.0, math.pi / 2, 0.0),
        major_segments=28,
    )

    gauge_group = new_group("CannonGaugeNeedle", recoil, "charge_gauge")
    gauge_group.location = (0.05, -0.69, 0.18)
    gauge_group.rotation_euler.y = -0.72
    add_cube(
        f"{GENERATED_PREFIX}GaugeNeedleMesh",
        gauge_group,
        slime,
        (0.0, -0.012, 0.075),
        (0.014, 0.014, 0.085),
    )

    status_group = new_group("CannonStatusLight", recoil, "status_light")
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8)
    status = finish_mesh(
        bpy.context.object,
        f"{GENERATED_PREFIX}StatusLightMesh",
        slime,
        status_group,
        (-0.76, -0.53, 0.36),
    )
    status.scale = (0.1, 0.075, 0.1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    root["asset_role"] = "game_cannon"
    root["asset_id"] = "slop-zoo-cannon"
    root["asset_version"] = UPGRADE_VERSION
    root["license"] = "MIT"
    bpy.context.scene["asset_upgrade_version"] = UPGRADE_VERSION


def main() -> None:
    args = parse_args()
    output_blend = Path(args.output_blend).resolve()
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    delete_generated()
    build_runtime_details()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), compress=True)
    print(
        f"UPGRADE_OK blend={output_blend} version={UPGRADE_VERSION} "
        f"objects={len(bpy.context.scene.objects)} materials={len(bpy.data.materials)}"
    )


if __name__ == "__main__":
    main()
