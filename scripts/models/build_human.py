"""
Generuje realistyczną postać w Blenderze (MPFB2 / MakeHuman, zasoby CC0) i eksportuje do GLB.

Uruchomienie (wymaga Blendera 4.2+ z rozszerzeniem MPFB i pakietem "makehuman_system_assets"):
    blender -b --python scripts/models/build_human.py -- <config.json> <out.glb>

Konfiguracja – patrz scripts/models/victim.json i rescuer.json.
"""

import json
import sys

import bpy

from bl_ext.user_default.mpfb.services.humanservice import HumanService
from bl_ext.user_default.mpfb.services.targetservice import TargetService

argv = sys.argv[sys.argv.index("--") + 1 :]
config_path, out_path = argv[0], argv[1]
with open(config_path) as f:
    cfg = json.load(f)

# Pusta scena
bpy.ops.wm.read_factory_settings(use_empty=True)

info = HumanService._create_default_human_info_dict()
phenotype = TargetService.get_default_macro_info_dict()
for k, v in cfg["phenotype"].items():
    if k == "race":
        phenotype["race"].update(v)
    else:
        phenotype[k] = v
info["phenotype"] = phenotype
info["rig"] = "game_engine"
info["eyes"] = "high-poly/high-poly.mhclo"
info["eyebrows"] = cfg.get("eyebrows", "eyebrow001/eyebrow001.mhclo")
info["eyelashes"] = "eyelashes01/eyelashes01.mhclo"
info["teeth"] = "teeth_base/teeth_base.mhclo"
info["tongue"] = "tongue01/tongue01.mhclo"
info["hair"] = cfg["hair"]
info["clothes"] = cfg["clothes"]
info["skin_mhmat"] = cfg["skin"]
info["skin_material_type"] = "GAMEENGINE"
info["eyes_material_type"] = "MAKESKIN"
info["clothes_material_type"] = "MAKESKIN"
info["alternative_materials"] = {}

settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["override_skin_model"] = "GAMEENGINE"
settings["override_clothes_model"] = "MAKESKIN"
settings["override_eyes_model"] = "MAKESKIN"

basemesh = HumanService.deserialize_from_dict(info, settings)
print("[build] basemesh", basemesh.name, len(basemesh.data.vertices))

# MakeHuman ukrywa skórę pod ubraniami (modyfikatory MASK). Dla poszkodowanego przywracamy skórę tułowia
# powyżej `unhide_skin_above_z`, żeby po zdjęciu koszulki klatka piersiowa była widoczna.
for mod in basemesh.modifiers:
    if mod.type == "MASK":
        print("[build] mask modifier", mod.name, mod.vertex_group, mod.invert_vertex_group)
unhide_z = cfg.get("unhide_skin_above_z")
if unhide_z is not None:
    for mod in basemesh.modifiers:
        if mod.type != "MASK" or mod.name == "Hide helpers" or not mod.vertex_group:
            continue
        vg = basemesh.vertex_groups.get(mod.vertex_group)
        if vg is None:
            continue
        ids = [v.index for v in basemesh.data.vertices if (basemesh.matrix_world @ v.co).z > unhide_z]
        vg.remove(ids)
        print("[build] unhid skin above", unhide_z, "in", mod.vertex_group, len(ids))

# Rozdzielenie ubrań na części (np. T-shirt / spodnie), żeby w aplikacji dało się zdjąć koszulkę.
split = cfg.get("split_clothes")
if split:
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or split["source"] not in obj.name.lower():
            continue
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.mesh.separate(type="LOOSE")
        bpy.ops.object.mode_set(mode="OBJECT")
        parts = list(bpy.context.selected_objects)
        groups = {split["upper_name"]: [], split["lower_name"]: []}
        for p in parts:
            zs = [(p.matrix_world @ v.co).z for v in p.data.vertices]
            mid = (min(zs) + max(zs)) / 2
            key = split["upper_name"] if mid > split["z_threshold"] else split["lower_name"]
            groups[key].append(p)
            print("[build] part", key, round(min(zs), 3), round(max(zs), 3))
        for name, objs in groups.items():
            if not objs:
                continue
            if len(objs) > 1:
                bpy.ops.object.select_all(action="DESELECT")
                for o in objs:
                    o.select_set(True)
                bpy.context.view_layer.objects.active = objs[0]
                bpy.ops.object.join()
            objs[0].name = name

# Nazwy obiektów (łatwiejsze wyszukiwanie w three.js)
basemesh.name = "Body"
for obj in bpy.data.objects:
    print("[build] object", obj.type, obj.name, len(obj.data.vertices) if obj.type == "MESH" else "")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    use_selection=False,
    export_apply=True,
    export_skins=True,
    export_animations=False,
    export_morph=False,
    export_yup=True,
    export_image_format="AUTO",
)
print("[build] exported", out_path)
