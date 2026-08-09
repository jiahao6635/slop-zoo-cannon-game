"""Export the included game-ready Blender scene as a GLB asset."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    argv = argv[argv.index("--") + 1 :] if "--" in argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-glb", required=True)
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    output_glb = Path(args.output_glb).resolve()
    output_glb.parent.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    for key in list(scene.keys()):
        del scene[key]
    for marker in list(scene.timeline_markers):
        scene.timeline_markers.remove(marker)
    scene.render.filepath = ""
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
        export_yup=True,
    )

    depsgraph = bpy.context.evaluated_depsgraph_get()
    triangle_count = 0
    mesh_count = 0
    for obj in scene.objects:
        if obj.type != "MESH":
            continue
        mesh_count += 1
        evaluated = obj.evaluated_get(depsgraph)
        evaluated_mesh = evaluated.to_mesh()
        evaluated_mesh.calc_loop_triangles()
        triangle_count += len(evaluated_mesh.loop_triangles)
        evaluated.to_mesh_clear()

    print(
        f"EXPORT_OK glb={output_glb} objects={len(scene.objects)} "
        f"meshes={mesh_count} triangles={triangle_count}"
    )


if __name__ == "__main__":
    main()
