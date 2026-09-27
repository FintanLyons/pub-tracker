#!/usr/bin/env python3
"""
Build data/map/baseStyle.json — the map's background (no labels) on OpenFreeMap tiles.

Starts from OpenFreeMap's Positron style (layer structure / filters / widths), removes
labels and admin boundaries, and recolours it to the muted beige/green/tan look the app
had on CARTO basemaps, so the pub markers and district fills stay the focus.

Run:  python3 scripts/build_map_base_style.py
Needs network access to tiles.openfreemap.org. Free, no API key.
"""
import json
import urllib.request
from pathlib import Path

POSITRON_URL = "https://tiles.openfreemap.org/styles/positron"
OUT = Path(__file__).resolve().parent.parent / "data" / "map" / "baseStyle.json"

# Muted palette sampled from the app's March 2026 screenshots (CARTO era).
LAND = "#EBE8E2"
RESIDENTIAL = "#E8E4DD"
PARK = "#DAE2D0"
WOOD = "#D3DDC8"
WATER = "#CBD9DE"
WATERWAY = "#C3D3D9"
BUILDING = "#E3DFD8"
BUILDING_OUTLINE = "#D9D4CB"
MINOR_ROAD = "#F6F4F0"
PATH = "#EFECE7"
MAJOR_ROAD = "#EEE3C4"
MAJOR_CASING = "#DED3B3"
MOTORWAY = "#E8D7AA"
MOTORWAY_CASING = "#D9C799"
RAIL = "#D6D2CB"
RAIL_DASH = "#EFECE7"
AEROWAY = "#EFEDE9"

# layer id → { paint property: colour }
COLOURS = {
    "background": {"background-color": LAND},
    "park": {"fill-color": PARK},
    "water": {"fill-color": WATER},
    "landcover_ice_shelf": {"fill-color": LAND},
    "landcover_glacier": {"fill-color": LAND},
    "landuse_residential": {"fill-color": RESIDENTIAL},
    "landcover_wood": {"fill-color": WOOD},
    "waterway": {"line-color": WATERWAY},
    "building": {"fill-color": BUILDING, "fill-outline-color": BUILDING_OUTLINE},
    "tunnel_motorway_casing": {"line-color": MOTORWAY_CASING},
    "tunnel_motorway_inner": {"line-color": MOTORWAY},
    "aeroway-taxiway": {"line-color": AEROWAY},
    "aeroway-runway-casing": {"line-color": AEROWAY},
    "aeroway-area": {"fill-color": AEROWAY},
    "aeroway-runway": {"line-color": AEROWAY},
    "road_area_pier": {"fill-color": LAND},
    "road_pier": {"line-color": LAND},
    "highway_path": {"line-color": PATH},
    "highway_minor": {"line-color": MINOR_ROAD},
    "highway_major_casing": {"line-color": MAJOR_CASING},
    "highway_major_inner": {"line-color": MAJOR_ROAD},
    "highway_major_subtle": {"line-color": MAJOR_ROAD},
    "highway_motorway_casing": {"line-color": MOTORWAY_CASING},
    "highway_motorway_inner": {"line-color": MOTORWAY},
    "highway_motorway_subtle": {"line-color": MOTORWAY},
    "railway_transit": {"line-color": RAIL},
    "railway_transit_dashline": {"line-color": RAIL_DASH},
    "railway_service": {"line-color": RAIL},
    "railway_service_dashline": {"line-color": RAIL_DASH},
    "railway": {"line-color": RAIL},
    "railway_dashline": {"line-color": RAIL_DASH},
    "highway_motorway_bridge_casing": {"line-color": MOTORWAY_CASING},
    "highway_motorway_bridge_inner": {"line-color": MOTORWAY},
}

DROP_LAYER_PREFIXES = ("boundary",)

PITCH = "#DEE4D3"

# Positron only colours national parks; add everyday parks/commons (landcover "grass"),
# pitches and cemeteries so green space reads like it did on CARTO. Inserted after
# landuse_residential, below woods / water / roads.
EXTRA_LAYERS = [
    {
        "id": "landcover_grass",
        "type": "fill",
        "source": "openmaptiles",
        "source-layer": "landcover",
        "filter": ["==", ["get", "class"], "grass"],
        "paint": {"fill-color": PARK},
    },
    {
        "id": "landuse_pitch",
        "type": "fill",
        "source": "openmaptiles",
        "source-layer": "landuse",
        "filter": ["match", ["get", "class"], ["pitch", "track"], True, False],
        "paint": {"fill-color": PITCH},
    },
    {
        "id": "landuse_cemetery",
        "type": "fill",
        "source": "openmaptiles",
        "source-layer": "landuse",
        "filter": ["==", ["get", "class"], "cemetery"],
        "paint": {"fill-color": PARK},
    },
]


def main():
    req = urllib.request.Request(POSITRON_URL, headers={"User-Agent": "pub-tracker-style-build/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        src = json.load(resp)

    layers = []
    for layer in src["layers"]:
        if layer["type"] == "symbol" or layer["id"].startswith(DROP_LAYER_PREFIXES):
            continue
        if layer.get("source") not in (None, "openmaptiles"):
            continue
        if layer["id"] not in COLOURS:
            raise SystemExit(f"Unmapped layer {layer['id']!r} — add it to COLOURS")
        layer = json.loads(json.dumps(layer))
        layer.setdefault("paint", {}).update(COLOURS[layer["id"]])
        layers.append(layer)
        if layer["id"] == "landuse_residential":
            layers.extend(EXTRA_LAYERS)

    style = {
        "version": 8,
        "name": "Pub Tracker base (OpenFreeMap)",
        "sources": {"openmaptiles": src["sources"]["openmaptiles"]},
        "layers": layers,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(style, separators=(",", ":")) + "\n")
    print(f"Wrote {OUT} ({len(layers)} layers)")


if __name__ == "__main__":
    main()
