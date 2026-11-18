"""Pack the v7 rocket CAD meshes into one small GLB for the website, plus the numbers the animation needs.

Source: the per-part STLs that tvc-mech/rocket7.py exported through Onshape Bench
(default ~/onshape-bench/data/models/Rocket-v7, or $TVC_STL_DIR). Units stay mm, Z up, origin on the rocket axis.

    python tools/export_glb.py [source_dir]

Writes assets/rocket.glb and assets/rocket-geometry.json.
Needs numpy, trimesh, open3d (decimation of the over-detailed STEP imports).
"""
import json, math, os, sys
import numpy as np
import trimesh
import open3d as o3d

SRC = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("TVC_STL_DIR", os.path.expanduser("~/onshape-bench/data/models/Rocket-v7"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_GLB = os.path.join(ROOT, "assets", "rocket.glb")
OUT_JSON = os.path.join(ROOT, "assets", "rocket-geometry.json")
S2 = math.sqrt(2)

# part -> triangle budget (None = keep). The SG90 / pushrod STEP imports carry ~28k triangles each.
PARTS = {
    "structure": 11000, "tube": None, "nose": None, "motor_sleeve": 6000, "REF_motor_D12": None,
    "pushrod_low": 1800, "pushrod_high": 1800, "REF_arm_low_trimmed": 2400, "REF_arm_high_trimmed": 2400,
    "REF_SG90_low": 3500, "REF_SG90_high": 3500, "REF_SG90_chute": None, "REF_horn_chute": None,
    "latch_key": None, "spring_pusher": None, "tuning_collar": 2500,
    "REF_xiao_esp32s3_sense": None, "REF_1S_lipo_300mAh": None, "REF_boost_5V": None,
    "CABLE_servo_low": None, "CABLE_servo_high": None, "CABLE_servo_chute": 2400, "CABLE_battery": None, "CABLE_5V": None,
}
# off-the-shelf parts: real mass in grams (printed parts use PETG density)
COMPONENT_G = {"REF_motor_D12": 43.0, "REF_SG90_low": 9.0, "REF_SG90_high": 9.0, "REF_SG90_chute": 9.0,
               "REF_xiao_esp32s3_sense": 6.0, "REF_1S_lipo_300mAh": 7.5, "REF_boost_5V": 2.0}
NO_MASS = {"REF_arm_low_trimmed", "REF_arm_high_trimmed", "REF_horn_chute",            # inside the servo masses
           "CABLE_servo_low", "CABLE_servo_high", "CABLE_servo_chute", "CABLE_battery", "CABLE_5V"}
PETG = 1.27e-3                                  # g/mm3, solid


def decimate(m, target):
    if target is None or len(m.faces) <= target:
        return m
    o = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(m.vertices), o3d.utility.Vector3iVector(m.faces))
    o = o.merge_close_vertices(1e-4).remove_duplicated_triangles().remove_degenerate_triangles()
    o = o.simplify_quadric_decimation(target_number_of_triangles=target)
    return trimesh.Trimesh(np.asarray(o.vertices), np.asarray(o.triangles), process=True)


scene = trimesh.Scene()
mass = {}
meshes = {}
tri_in = tri_out = 0
for name, budget in PARTS.items():
    m = trimesh.load(os.path.join(SRC, name + ".stl"))
    m.merge_vertices()
    tri_in += len(m.faces)
    meshes[name] = m
    d = decimate(m, budget)
    tri_out += len(d.faces)
    d.vertices = d.vertices.astype(np.float32)
    scene.add_geometry(d, node_name=name, geom_name=name)
    if name not in NO_MASS:
        g = COMPONENT_G.get(name, abs(m.volume) * PETG)
        mass[name] = (g, m)

os.makedirs(os.path.dirname(OUT_GLB), exist_ok=True)
glb = trimesh.exchange.gltf.export_glb(scene, include_normals=False)
open(OUT_GLB, "wb").write(glb)

# ---- mass, COG and pitch inertia (about the COG, transverse axis), straight from the CAD
M = sum(g for g, _ in mass.values())
cog = sum(g * (m.center_mass if m.is_watertight else m.bounds.mean(0)) for g, m in mass.values()) / M
I = 0.0
for g, m in mass.values():
    c = m.center_mass if m.is_watertight else m.bounds.mean(0)
    if m.is_watertight and abs(m.volume) > 1:
        it = m.moment_inertia * (g / (abs(m.volume)))          # trimesh uses density 1 -> scale to grams
        ixx = it[0, 0]
    else:                                                      # box approximation
        e = m.extents
        ixx = g * (e[1] ** 2 + e[2] ** 2) / 12
    I += ixx + g * ((c[1] - cog[1]) ** 2 + (c[2] - cog[2]) ** 2)


# ---- gimbal + recovery kinematics (see tvc-mech/rocket7.py, motion7.py)
def bounds(n):
    return meshes[n].bounds


horn = meshes["REF_horn_chute"].vertices
hub = horn[horn[:, 2] < horn[:, 2].min() + 1.0]                 # bottom of the hub boss = the shaft
geo = {
    "units": "mm", "up": "z",
    "source": "tvc-mech/rocket7.py (Rocket v7), exported via Onshape Bench",
    "triangles": {"cad": int(tri_in), "web": int(tri_out)},
    "pivot": [0.0, 0.0, 34.83],                     # centre of the ball socket
    "stud_radius": 14.7,                            # gimbal studs on the sleeve, at 45 and 135 deg
    "axes": {"u": [1 / S2, 1 / S2, 0], "v": [-1 / S2, 1 / S2, 0]},
    "servo_low": {"axis": "u", "shaft": {"v": -7.78, "z": 74.58}, "pin": {"v": 0.0, "z": 74.58}},
    "servo_high": {"axis": "v", "shaft": {"u": -7.78, "z": 91.83}, "pin": {"u": 0.0, "z": 91.83}},
    "gimbal_limit_deg": 6.0,                        # clash-checked swing in motion7.py
    "chute_horn_shaft": [float(hub[:, 0].mean()), float(hub[:, 1].mean())],
    "nose_bottom_z": float(bounds("nose")[0][2]),
    "tube_top_z": float(bounds("tube")[1][2]),
    "overall_length_mm": float(max(meshes[n].bounds[1][2] for n in meshes) - min(meshes[n].bounds[0][2] for n in meshes)),
    "tube_od_mm": float(meshes["tube"].extents[0]),
    "mass_cad_g": round(float(M), 1),
    "cog_z_mm": round(float(cog[2]), 1),
    "pitch_inertia_g_mm2": round(float(I), 0),
    "parts": {n: {"tris": int(len(meshes[n].faces)),
                  "min": [round(float(x), 2) for x in meshes[n].bounds[0]],
                  "max": [round(float(x), 2) for x in meshes[n].bounds[1]],
                  "mass_g": round(float(mass[n][0]), 2) if n in mass else None} for n in meshes},
}
json.dump(geo, open(OUT_JSON, "w"), indent=1)
print(f"GLB {len(glb) / 1e6:.2f} MB, triangles {tri_in} -> {tri_out}")
print(f"mass {M:.1f} g, COG z {cog[2]:.1f} mm, Ixx {I:.0f} g mm2, chute shaft {geo['chute_horn_shaft']}")
