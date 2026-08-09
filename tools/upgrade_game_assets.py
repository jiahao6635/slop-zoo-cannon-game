"""Rebuild the editable cannon source as the game-ready V3 asset.

The script is intentionally idempotent. It preserves the runtime EMPTY-node
contract, replaces all render meshes with optimized topology, and saves the
result back to the editable Blender source.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


UPGRADE_VERSION = 3
GENERATED_PREFIX = "CANNON_V3_"
MAX_SOURCE_TRIANGLES = 18_000
GENERATED_GROUPS = {
    "CannonChargeGlow",
    "CannonAmmoGlow",
    "CannonGaugeNeedle",
    "CannonStatusLight",
    "CannonMuzzleGlow",
}
CONTROL_CONTRACT = {
    "CannonAssetRoot": (None, "asset_role", "game_cannon"),
    "CannonYaw": ("CannonAssetRoot", "runtime_control", "yaw"),
    "CannonPitch": ("CannonYaw", "runtime_control", "pitch"),
    "CannonRecoil": ("CannonPitch", "runtime_control", "recoil"),
    "MuzzleAnchor": ("CannonRecoil", "runtime_control", "projectile_origin"),
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
    coat_weight: float = 0.0,
    coat_roughness: float = 0.2,
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
    set_socket(node, ("Coat Weight", "Clearcoat"), coat_weight)
    set_socket(node, ("Coat Roughness", "Clearcoat Roughness"), coat_roughness)
    set_socket(
        node,
        ("Emission Color", "Emission"),
        emission if emission is not None else (0.0, 0.0, 0.0, 1.0),
    )
    set_socket(node, ("Emission Strength",), emission_strength)
    return material


def tune_materials() -> tuple[
    bpy.types.Material,
    bpy.types.Material,
    bpy.types.Material,
    bpy.types.Material,
]:
    gunmetal = get_material(
        "MAT_Gunmetal_Refined",
        (0.028, 0.105, 0.12, 1.0),
        metallic=0.74,
        roughness=0.29,
        emission=(0.004, 0.018, 0.02, 1.0),
        emission_strength=0.1,
        coat_weight=0.16,
        coat_roughness=0.24,
    )
    brass = get_material(
        "MAT_AgedBrass",
        (0.56, 0.255, 0.045, 1.0),
        metallic=0.84,
        roughness=0.26,
        coat_weight=0.12,
        coat_roughness=0.2,
    )
    safety = get_material(
        "MAT_SafetyOrange",
        (0.96, 0.16, 0.02, 1.0),
        metallic=0.34,
        roughness=0.31,
        emission=(0.42, 0.025, 0.002, 1.0),
        emission_strength=0.38,
        coat_weight=0.08,
        coat_roughness=0.24,
    )
    slime = get_material(
        "MAT_SlimeEnergy",
        (0.055, 0.82, 0.22, 1.0),
        metallic=0.03,
        roughness=0.19,
        emission=(0.035, 1.0, 0.22, 1.0),
        emission_strength=3.5,
        coat_weight=0.24,
        coat_roughness=0.12,
    )
    return gunmetal, brass, safety, slime


def validate_control_contract() -> None:
    for name, (expected_parent, key, expected_value) in CONTROL_CONTRACT.items():
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "EMPTY":
            raise RuntimeError(f"Required runtime EMPTY is missing: {name}")
        actual_parent = obj.parent.name if obj.parent else None
        if actual_parent != expected_parent:
            raise RuntimeError(
                f"Invalid parent for {name}: expected {expected_parent}, got {actual_parent}"
            )
        if obj.get(key) != expected_value:
            raise RuntimeError(
                f"Invalid {key} for {name}: expected {expected_value}, got {obj.get(key)}"
            )


def delete_render_meshes() -> None:
    for obj in list(bpy.context.scene.objects):
        if obj.type == "MESH" or obj.name in GENERATED_GROUPS:
            bpy.data.objects.remove(obj, do_unlink=True)
    for mesh in list(bpy.data.meshes):
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def new_group(name: str, parent: bpy.types.Object, role: str) -> bpy.types.Object:
    if bpy.data.objects.get(name) is not None:
        raise RuntimeError(f"Runtime group name is already in use: {name}")
    group = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(group)
    group.parent = parent
    group["runtime_control"] = role
    group.empty_display_type = "PLAIN_AXES"
    group.empty_display_size = 0.12
    return group


def make_active(obj: bpy.types.Object) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def add_bevel(obj: bpy.types.Object, width: float, segments: int = 1) -> None:
    if width <= 0.0:
        return
    bevel = obj.modifiers.new("GameBevel", "BEVEL")
    bevel.width = width
    bevel.segments = segments
    bevel.limit_method = "ANGLE"
    if hasattr(bevel, "harden_normals"):
        bevel.harden_normals = True


def finish_mesh(
    obj: bpy.types.Object,
    name: str,
    material: bpy.types.Material,
    parent: bpy.types.Object,
    location: tuple[float, float, float],
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    *,
    smooth: bool = True,
    flat_caps: bool = False,
) -> bpy.types.Object:
    obj.name = name
    obj.data.name = f"{name}_Mesh"
    obj.parent = parent
    obj.location = location
    obj.rotation_euler = rotation
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = smooth and not (flat_caps and abs(polygon.normal.z) > 0.9)
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
    minor_segments: int = 6,
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
    vertices: int = 24,
    bevel: float = 0.0,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = finish_mesh(
        bpy.context.object,
        name,
        material,
        parent,
        location,
        rotation,
        flat_caps=True,
    )
    add_bevel(obj, bevel)
    return obj


def add_cone(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    *,
    radius1: float,
    radius2: float,
    depth: float,
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 24,
    bevel: float = 0.0,
    capped: bool = True,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        end_fill_type="NGON" if capped else "NOTHING",
    )
    obj = finish_mesh(
        bpy.context.object,
        name,
        material,
        parent,
        location,
        rotation,
        flat_caps=capped,
    )
    add_bevel(obj, bevel)
    return obj


def add_cube(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    *,
    bevel: float = 0.02,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add()
    obj = finish_mesh(
        bpy.context.object,
        name,
        material,
        parent,
        location,
        rotation,
        smooth=False,
    )
    obj.scale = scale
    make_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    add_bevel(obj, bevel)
    return obj


def add_ico_sphere(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    *,
    subdivisions: int = 2,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1.0)
    obj = finish_mesh(bpy.context.object, name, material, parent, location)
    obj.scale = scale
    make_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def add_uv_sphere(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    *,
    segments: int = 16,
    rings: int = 8,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj = finish_mesh(bpy.context.object, name, material, parent, location)
    obj.scale = scale
    make_active(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return obj


def add_cylinder_between(
    name: str,
    parent: bpy.types.Object,
    material: bpy.types.Material,
    start: tuple[float, float, float],
    end: tuple[float, float, float],
    *,
    radius: float,
    vertices: int = 12,
) -> bpy.types.Object:
    start_vector = Vector(start)
    end_vector = Vector(end)
    direction = end_vector - start_vector
    if direction.length <= 0.000001:
        raise RuntimeError(f"Cannot build zero-length cylinder: {name}")
    rotation = direction.to_track_quat("Z", "Y").to_euler()
    midpoint = (start_vector + end_vector) * 0.5
    return add_cylinder(
        name,
        parent,
        material,
        tuple(midpoint),
        radius=radius,
        depth=direction.length,
        rotation=tuple(rotation),
        vertices=vertices,
    )


def apply_modifiers(obj: bpy.types.Object) -> None:
    make_active(obj)
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def join_objects(objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    if not objects:
        raise RuntimeError(f"Cannot join empty object list for {name}")
    for obj in objects:
        apply_modifiers(obj)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    result = objects[0]
    result.name = name
    result.data.name = f"{name}_Mesh"
    return result


def build_base(
    root: bpy.types.Object,
    gunmetal: bpy.types.Material,
    safety: bpy.types.Material,
) -> None:
    add_cylinder(
        f"{GENERATED_PREFIX}Foot",
        root,
        gunmetal,
        (0.0, 0.0, 0.24),
        radius=1.05,
        depth=0.08,
        vertices=32,
        bevel=0.025,
    )
    add_cylinder(
        f"{GENERATED_PREFIX}Base",
        root,
        gunmetal,
        (0.0, 0.0, 0.39),
        radius=0.88,
        depth=0.22,
        vertices=32,
        bevel=0.035,
    )
    add_cone(
        f"{GENERATED_PREFIX}Pedestal",
        root,
        gunmetal,
        (0.0, 0.0, 0.925),
        radius1=0.43,
        radius2=0.34,
        depth=0.85,
        vertices=28,
        bevel=0.025,
    )
    add_torus(
        f"{GENERATED_PREFIX}BaseSafetyRing",
        root,
        safety,
        (0.0, 0.0, 0.515),
        major_radius=0.79,
        minor_radius=0.045,
        major_segments=32,
        minor_segments=6,
    )
    for index, angle in enumerate((45.0, 135.0, 225.0, 315.0)):
        radians = math.radians(angle)
        x = math.cos(radians) * 0.76
        y = math.sin(radians) * 0.76
        add_cube(
            f"{GENERATED_PREFIX}BaseClamp_{index}",
            root,
            safety,
            (x, y, 0.31),
            (0.23, 0.085, 0.045),
            (0.0, 0.0, radians),
            bevel=0.018,
        )
        add_cylinder(
            f"{GENERATED_PREFIX}BaseBolt_{index}",
            root,
            gunmetal,
            (x, y, 0.37),
            radius=0.047,
            depth=0.035,
            vertices=12,
            bevel=0.006,
        )


def build_yaw_mount(
    yaw: bpy.types.Object,
    gunmetal: bpy.types.Material,
    brass: bpy.types.Material,
) -> None:
    add_cylinder(
        f"{GENERATED_PREFIX}YokeAxle",
        yaw,
        gunmetal,
        (0.0, 0.0, 1.35),
        radius=0.18,
        depth=1.15,
        rotation=(math.pi / 2, 0.0, 0.0),
        vertices=24,
        bevel=0.018,
    )
    for side in (-1.0, 1.0):
        side_label = "L" if side > 0 else "R"
        add_cube(
            f"{GENERATED_PREFIX}Yoke_{side_label}",
            yaw,
            gunmetal,
            (0.0, side * 0.48, 1.05),
            (0.12, 0.18, 0.55),
            bevel=0.045,
        )
        add_torus(
            f"{GENERATED_PREFIX}PivotBezel_{side_label}",
            yaw,
            brass,
            (0.0, side * 0.625, 1.35),
            major_radius=0.19,
            minor_radius=0.04,
            rotation=(math.pi / 2, 0.0, 0.0),
            major_segments=24,
            minor_segments=6,
        )
        add_cylinder(
            f"{GENERATED_PREFIX}PivotHub_{side_label}",
            yaw,
            gunmetal,
            (0.0, side * 0.63, 1.35),
            radius=0.105,
            depth=0.105,
            rotation=(math.pi / 2, 0.0, 0.0),
            vertices=20,
            bevel=0.01,
        )
        add_cylinder(
            f"{GENERATED_PREFIX}Hydraulic_{side_label}",
            yaw,
            gunmetal,
            (-0.22, side * 0.62, 0.92),
            radius=0.075,
            depth=0.88,
            rotation=(0.0, -0.48, 0.0),
            vertices=12,
            bevel=0.008,
        )
        add_cylinder(
            f"{GENERATED_PREFIX}HydraulicRod_{side_label}",
            yaw,
            brass,
            (0.02, side * 0.62, 1.23),
            radius=0.035,
            depth=0.72,
            rotation=(0.0, -0.48, 0.0),
            vertices=12,
            bevel=0.004,
        )


def build_recoil_body(
    recoil: bpy.types.Object,
    gunmetal: bpy.types.Material,
    brass: bpy.types.Material,
    safety: bpy.types.Material,
) -> None:
    add_cylinder(
        f"{GENERATED_PREFIX}Chamber",
        recoil,
        gunmetal,
        (0.15, 0.0, 0.0),
        radius=0.48,
        depth=1.15,
        rotation=(0.0, math.pi / 2, 0.0),
        vertices=32,
        bevel=0.025,
    )
    add_uv_sphere(
        f"{GENERATED_PREFIX}RearTank",
        recoil,
        gunmetal,
        (-0.65, 0.0, 0.0),
        (0.55, 0.52, 0.52),
        segments=20,
        rings=10,
    )
    for index, x in enumerate((-0.86, -0.48)):
        add_torus(
            f"{GENERATED_PREFIX}RearTankBand_{index}",
            recoil,
            brass,
            (x, 0.0, 0.0),
            major_radius=0.43,
            minor_radius=0.025,
            rotation=(0.0, math.pi / 2, 0.0),
            major_segments=24,
            minor_segments=6,
        )
    add_cone(
        f"{GENERATED_PREFIX}Taper",
        recoil,
        gunmetal,
        (0.98, 0.0, 0.09),
        radius1=0.42,
        radius2=0.30,
        depth=0.84,
        rotation=(0.0, math.pi / 2, 0.0),
        vertices=28,
        bevel=0.018,
    )
    add_cylinder(
        f"{GENERATED_PREFIX}Barrel",
        recoil,
        gunmetal,
        (2.15, 0.0, 0.19),
        radius=0.27,
        depth=2.3,
        rotation=(0.0, math.pi / 2, 0.0),
        vertices=32,
        bevel=0.018,
    )
    for index, x in enumerate((1.1, 1.55, 2.0, 2.45, 2.9)):
        add_cylinder(
            f"{GENERATED_PREFIX}BarrelBand_{index}",
            recoil,
            brass if index in (0, 4) else gunmetal,
            (x, 0.0, 0.19),
            radius=0.298,
            depth=0.06,
            rotation=(0.0, math.pi / 2, 0.0),
            vertices=24,
            bevel=0.012,
        )
    add_cylinder(
        f"{GENERATED_PREFIX}MuzzleDark",
        recoil,
        gunmetal,
        (3.325, 0.0, 0.29),
        radius=0.235,
        depth=0.1,
        rotation=(0.0, math.pi / 2, 0.0),
        vertices=24,
        bevel=0.008,
    )
    add_torus(
        f"{GENERATED_PREFIX}MuzzleLip",
        recoil,
        brass,
        (3.34, 0.0, 0.29),
        major_radius=0.3,
        minor_radius=0.055,
        rotation=(0.0, math.pi / 2, 0.0),
        major_segments=32,
        minor_segments=8,
    )

    add_cylinder(
        f"{GENERATED_PREFIX}HopperNeck",
        recoil,
        gunmetal,
        (-0.28, 0.0, 0.27),
        radius=0.2,
        depth=0.4,
        vertices=24,
        bevel=0.012,
    )
    add_cone(
        f"{GENERATED_PREFIX}Hopper",
        recoil,
        gunmetal,
        (-0.28, 0.0, 0.73),
        radius1=0.55,
        radius2=0.21,
        depth=0.9,
        rotation=(math.pi, 0.0, 0.0),
        vertices=28,
        bevel=0.015,
        capped=False,
    )
    add_torus(
        f"{GENERATED_PREFIX}HopperRim",
        recoil,
        brass,
        (-0.28, 0.0, 1.18),
        major_radius=0.48,
        minor_radius=0.055,
        major_segments=32,
        minor_segments=8,
    )
    add_torus(
        f"{GENERATED_PREFIX}HopperInnerRim",
        recoil,
        gunmetal,
        (-0.28, 0.0, 1.185),
        major_radius=0.395,
        minor_radius=0.022,
        major_segments=28,
        minor_segments=6,
    )

    add_cube(
        f"{GENERATED_PREFIX}ServicePanel",
        recoil,
        safety,
        (0.18, -0.49, -0.1),
        (0.27, 0.027, 0.15),
        bevel=0.025,
    )
    for side in (-1.0, 1.0):
        for x in (-0.32, 0.28, 0.82):
            add_cylinder(
                f"{GENERATED_PREFIX}Bolt_{side:+.0f}_{x:+.2f}",
                recoil,
                brass,
                (x, side * 0.505, -0.2),
                radius=0.065,
                depth=0.055,
                rotation=(math.pi / 2, 0.0, 0.0),
                vertices=12,
                bevel=0.006,
            )

    add_cylinder(
        f"{GENERATED_PREFIX}LeverRod",
        recoil,
        gunmetal,
        (-0.45, -0.72, -0.1),
        radius=0.06,
        depth=1.0,
        rotation=(0.0, -0.6109, 0.0),
        vertices=12,
        bevel=0.008,
    )
    add_ico_sphere(
        f"{GENERATED_PREFIX}LeverKnob",
        recoil,
        safety,
        (-0.74, -0.72, 0.31),
        (0.13, 0.13, 0.13),
        subdivisions=2,
    )

    add_cube(
        f"{GENERATED_PREFIX}SightRail",
        recoil,
        gunmetal,
        (2.05, 0.0, 0.515),
        (0.78, 0.04, 0.025),
        bevel=0.012,
    )
    for index, x in enumerate((1.38, 2.72)):
        add_cube(
            f"{GENERATED_PREFIX}SightMount_{index}",
            recoil,
            brass,
            (x, 0.0, 0.485),
            (0.06, 0.08, 0.045),
            bevel=0.012,
        )
    add_cube(
        f"{GENERATED_PREFIX}FrontSight",
        recoil,
        safety,
        (2.78, 0.0, 0.595),
        (0.035, 0.035, 0.085),
        bevel=0.009,
    )
    for side in (-1.0, 1.0):
        add_cube(
            f"{GENERATED_PREFIX}RearSight_{side:+.0f}",
            recoil,
            safety,
            (1.34, side * 0.065, 0.58),
            (0.04, 0.022, 0.07),
            bevel=0.008,
        )

    guard_specs = (
        ((3.34, 0.0, 0.68), (0.12, 0.085, 0.105)),
        ((3.34, 0.0, -0.1), (0.12, 0.085, 0.105)),
        ((3.34, 0.39, 0.29), (0.12, 0.105, 0.085)),
        ((3.34, -0.39, 0.29), (0.12, 0.105, 0.085)),
    )
    for index, (location, scale) in enumerate(guard_specs):
        add_cube(
            f"{GENERATED_PREFIX}MuzzleGuard_{index}",
            recoil,
            safety,
            location,
            scale,
            bevel=0.018,
        )


def build_ammo_system(
    recoil: bpy.types.Object,
    gunmetal: bpy.types.Material,
    brass: bpy.types.Material,
    slime: bpy.types.Material,
) -> None:
    ammo_group = new_group("CannonAmmoGlow", recoil, "ammo_reservoir")
    glow_parts: list[bpy.types.Object] = []
    for side in (-1.0, 1.0):
        label = "L" if side > 0 else "R"
        tank_y = side * 0.67
        glow_parts.append(
            add_cylinder(
                f"{GENERATED_PREFIX}AmmoCore_{label}",
                ammo_group,
                slime,
                (-0.58, tank_y, 0.15),
                radius=0.16,
                depth=0.62,
                vertices=16,
                bevel=0.012,
            )
        )
        for z in (-0.18, 0.48):
            add_cylinder(
                f"{GENERATED_PREFIX}AmmoCap_{label}_{z:+.2f}",
                recoil,
                brass,
                (-0.58, tank_y, z),
                radius=0.195,
                depth=0.08,
                vertices=16,
                bevel=0.008,
            )
        for x in (-0.79, -0.37):
            add_cube(
                f"{GENERATED_PREFIX}AmmoRail_{label}_{x:+.2f}",
                recoil,
                gunmetal,
                (x, tank_y, 0.15),
                (0.035, 0.035, 0.35),
                bevel=0.01,
            )
        for z in (-0.13, 0.43):
            add_cube(
                f"{GENERATED_PREFIX}AmmoCrossbar_{label}_{z:+.2f}",
                recoil,
                gunmetal,
                (-0.58, tank_y, z),
                (0.245, 0.035, 0.035),
                bevel=0.01,
            )
        add_cube(
            f"{GENERATED_PREFIX}AmmoBrace_{label}",
            recoil,
            gunmetal,
            (-0.42, side * 0.5, 0.14),
            (0.12, 0.075, 0.3),
            bevel=0.018,
        )
        points = (
            (-0.58, tank_y, 0.5),
            (-0.34, side * 0.56, 0.62),
            (-0.05, side * 0.44, 0.35),
        )
        add_cylinder_between(
            f"{GENERATED_PREFIX}AmmoHose_{label}_0",
            recoil,
            brass,
            points[0],
            points[1],
            radius=0.042,
        )
        add_cylinder_between(
            f"{GENERATED_PREFIX}AmmoHose_{label}_1",
            recoil,
            brass,
            points[1],
            points[2],
            radius=0.042,
        )
    join_objects(glow_parts, f"{GENERATED_PREFIX}AmmoGlowMesh")


def build_charge_fx(recoil: bpy.types.Object, slime: bpy.types.Material) -> None:
    charge_group = new_group("CannonChargeGlow", recoil, "charge_glow")
    charge_parts = [
        add_torus(
            f"{GENERATED_PREFIX}ChargeCoil_{index}",
            charge_group,
            slime,
            (x, 0.0, 0.19),
            major_radius=0.307,
            minor_radius=0.026,
            rotation=(0.0, math.pi / 2, 0.0),
            major_segments=24,
            minor_segments=6,
        )
        for index, x in enumerate((1.3, 1.75, 2.2, 2.65))
    ]
    join_objects(charge_parts, f"{GENERATED_PREFIX}ChargeGlowMesh")


def build_muzzle_fx(recoil: bpy.types.Object, slime: bpy.types.Material) -> None:
    muzzle_group = new_group("CannonMuzzleGlow", recoil, "muzzle_glow")
    add_torus(
        f"{GENERATED_PREFIX}MuzzleGlowMesh",
        muzzle_group,
        slime,
        (3.405, 0.0, 0.29),
        major_radius=0.245,
        minor_radius=0.03,
        rotation=(0.0, math.pi / 2, 0.0),
        major_segments=24,
        minor_segments=6,
    )


def build_gauge(
    recoil: bpy.types.Object,
    gunmetal: bpy.types.Material,
    brass: bpy.types.Material,
    safety: bpy.types.Material,
    slime: bpy.types.Material,
) -> None:
    center = (0.05, -0.62, 0.18)
    add_cylinder(
        f"{GENERATED_PREFIX}GaugeBody",
        recoil,
        gunmetal,
        (center[0], -0.565, center[2]),
        radius=0.235,
        depth=0.105,
        rotation=(math.pi / 2, 0.0, 0.0),
        vertices=24,
        bevel=0.012,
    )
    add_cylinder(
        f"{GENERATED_PREFIX}GaugeFace",
        recoil,
        gunmetal,
        (center[0], -0.65, center[2]),
        radius=0.18,
        depth=0.025,
        rotation=(math.pi / 2, 0.0, 0.0),
        vertices=24,
    )
    add_torus(
        f"{GENERATED_PREFIX}GaugeBezel",
        recoil,
        brass,
        (center[0], -0.67, center[2]),
        major_radius=0.195,
        minor_radius=0.028,
        rotation=(math.pi / 2, 0.0, 0.0),
        major_segments=24,
        minor_segments=6,
    )
    for index, degrees in enumerate((-55, -40, -25, -10, 5, 20, 35)):
        angle = math.radians(degrees)
        radius = 0.132
        tick_length = 0.038 if index in (0, 3, 6) else 0.028
        add_cube(
            f"{GENERATED_PREFIX}GaugeTick_{index}",
            recoil,
            safety,
            (
                center[0] + math.sin(angle) * radius,
                -0.692,
                center[2] + math.cos(angle) * radius,
            ),
            (0.009, 0.008, tick_length),
            (0.0, angle, 0.0),
            bevel=0.003,
        )

    gauge_group = new_group("CannonGaugeNeedle", recoil, "charge_gauge")
    gauge_group.location = (center[0], -0.704, center[2])
    gauge_group.rotation_euler.y = -0.72
    needle_parts = [
        add_cube(
            f"{GENERATED_PREFIX}GaugeNeedle",
            gauge_group,
            slime,
            (0.0, 0.0, 0.085),
            (0.012, 0.009, 0.085),
            bevel=0.004,
        ),
        add_cylinder(
            f"{GENERATED_PREFIX}GaugePivot",
            gauge_group,
            slime,
            (0.0, 0.0, 0.0),
            radius=0.035,
            depth=0.018,
            rotation=(math.pi / 2, 0.0, 0.0),
            vertices=12,
        ),
    ]
    join_objects(needle_parts, f"{GENERATED_PREFIX}GaugeNeedleMesh")


def build_status_light(
    recoil: bpy.types.Object,
    gunmetal: bpy.types.Material,
    brass: bpy.types.Material,
    slime: bpy.types.Material,
) -> None:
    location = (-0.78, -0.535, 0.39)
    add_cylinder(
        f"{GENERATED_PREFIX}StatusHousing",
        recoil,
        gunmetal,
        location,
        radius=0.135,
        depth=0.085,
        rotation=(math.pi / 2, 0.0, 0.0),
        vertices=20,
        bevel=0.01,
    )
    add_torus(
        f"{GENERATED_PREFIX}StatusBezel",
        recoil,
        brass,
        (-0.78, -0.585, 0.39),
        major_radius=0.105,
        minor_radius=0.018,
        rotation=(math.pi / 2, 0.0, 0.0),
        major_segments=20,
        minor_segments=6,
    )
    status_group = new_group("CannonStatusLight", recoil, "status_light")
    add_uv_sphere(
        f"{GENERATED_PREFIX}StatusLightMesh",
        status_group,
        slime,
        (-0.78, -0.625, 0.39),
        (0.095, 0.06, 0.095),
        segments=12,
        rings=6,
    )


def scene_stats() -> tuple[int, int]:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangle_count = 0
    mesh_count = 0
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        mesh_count += 1
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        triangle_count += len(evaluated_mesh.loop_triangles)
        evaluated.to_mesh_clear()
    return mesh_count, triangle_count


def build_asset() -> None:
    root = bpy.data.objects["CannonAssetRoot"]
    yaw = bpy.data.objects["CannonYaw"]
    recoil = bpy.data.objects["CannonRecoil"]
    gunmetal, brass, safety, slime = tune_materials()

    build_base(root, gunmetal, safety)
    build_yaw_mount(yaw, gunmetal, brass)
    build_recoil_body(recoil, gunmetal, brass, safety)
    build_ammo_system(recoil, gunmetal, brass, slime)
    build_charge_fx(recoil, slime)
    build_muzzle_fx(recoil, slime)
    build_gauge(recoil, gunmetal, brass, safety, slime)
    build_status_light(recoil, gunmetal, brass, slime)

    root["asset_role"] = "game_cannon"
    root["asset_id"] = "slop-zoo-cannon"
    root["asset_version"] = UPGRADE_VERSION
    root["license"] = "MIT"
    bpy.context.scene["asset_upgrade_version"] = UPGRADE_VERSION


def main() -> None:
    args = parse_args()
    output_blend = Path(args.output_blend).resolve()
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    validate_control_contract()
    delete_render_meshes()
    build_asset()
    mesh_count, triangle_count = scene_stats()
    if triangle_count > MAX_SOURCE_TRIANGLES:
        raise RuntimeError(
            f"V3 source triangle target exceeded: {triangle_count} > {MAX_SOURCE_TRIANGLES}"
        )
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend), compress=True)
    print(
        f"UPGRADE_OK blend={output_blend} version={UPGRADE_VERSION} "
        f"objects={len(bpy.context.scene.objects)} meshes={mesh_count} "
        f"materials={len(bpy.data.materials)} triangles={triangle_count}"
    )


if __name__ == "__main__":
    main()
