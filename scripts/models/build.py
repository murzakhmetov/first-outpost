"""
Build the game's 3D models.

    blender -b --factory-startup --python-exit-code 1 -P scripts/models/build.py -- [names...]

With no names, every model is built. Files go to public/models/.
"""
import importlib
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

ALL = ["astronaut", "rover", "lander", "lumi", "props", "hab", "farm", "lab", "power", "scenery", "annex", "interior"]


def main():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    names = [name for name in args if not name.startswith("--")] or ALL
    out_dir = os.path.normpath(os.path.join(HERE, "..", "..", "public", "models"))
    for name in names:
        started = time.time()
        module = importlib.import_module(name)
        module.build(out_dir)
        print(f"[models] {name} done in {time.time() - started:.1f} s")


main()
