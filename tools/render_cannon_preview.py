"""Render a consistent Blender catalogue preview for a cannon source file."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(argv)


def point_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def make_material(
    name: str,
    color: tuple[float, float, float, float],
    roughness: float,
) -> bpy.types.Material:
    result = bpy.data.materials.new(name)
    result.diffuse_color = color
    result.use_nodes = True
    principled = result.node_tree.nodes.get("Principled BSDF")
    principled.inputs["Base Color"].default_value = color
    principled.inputs["Roughness"].default_value = roughness
    return result


def add_area_light(
    name: str,
    location: tuple[float, float, float],
    energy: float,
    color: tuple[float, float, float],
    size: float,
    target: tuple[float, float, float],
) -> None:
    data = bpy.data.lights.new(name=name, type="AREA")
    data.energy = energy
    data.color = color
    data.shape = "DISK"
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    point_at(obj, target)


def main() -> None:
    args = parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    if output.suffix.lower() in {".jpg", ".jpeg"}:
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.image_settings.quality = 88
    else:
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA"
        scene.render.image_settings.color_depth = "8"

    world = scene.world or bpy.data.worlds.new("PreviewWorld")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.006, 0.012, 0.018, 1.0)
    background.inputs["Strength"].default_value = 0.3

    bpy.ops.mesh.primitive_plane_add(size=24.0, location=(0.6, 0.0, 0.195))
    floor = bpy.context.object
    floor.name = "PreviewFloor"
    floor.data.materials.append(
        make_material("PreviewFloorMaterial", (0.012, 0.02, 0.026, 1.0), 0.3)
    )

    target = (1.05, 0.0, 1.08)
    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    scene.collection.objects.link(camera)
    camera.location = (7.0, -8.2, 4.8)
    camera_data.lens = 52.0
    point_at(camera, target)
    scene.camera = camera

    add_area_light(
        "PreviewKey",
        (5.5, -4.5, 8.0),
        1450.0,
        (1.0, 0.74, 0.48),
        4.0,
        target,
    )
    add_area_light(
        "PreviewFill",
        (0.0, 6.0, 4.0),
        950.0,
        (0.34, 0.62, 1.0),
        5.0,
        target,
    )
    add_area_light(
        "PreviewRim",
        (-4.5, -2.0, 6.0),
        1100.0,
        (0.2, 1.0, 0.56),
        3.0,
        (0.2, 0.0, 1.1),
    )

    bpy.ops.render.render(write_still=True)
    print(f"PREVIEW_OK output={output}")


if __name__ == "__main__":
    main()
