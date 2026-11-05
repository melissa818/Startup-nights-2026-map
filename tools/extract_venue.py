#!/usr/bin/env python3
"""Extract the Startup Nights 2026 venue geometry from the official PDF floor plan.

Reads the vector drawing on page 1 of the PDF (booths, walls, rooms, seats, exits)
and writes site/data/venue.json in PDF point units (x to the right, y downwards).

Usage:  python3 tools/extract_venue.py source/Venue_Map_with_Booth_List_SN26.pdf site/data/venue.json
Needs:  pip install pdfplumber
"""
import json
import sys

import pdfplumber

# CMYK fill colours used by the plan.
BOOTH = "(0.0, 0.14, 0.59, 0.0)"      # light yellow booth tiles
DARK = "(0.0, 0.0, 0.0, 1.0)"         # walls and closed-off areas
GREY = "(0.0, 0.0, 0.0, 0.155)"       # bars, stages, lounges
GOLD = "(0.0, 0.21, 1.0, 0.01)"       # workshops and the entrance arrow
SEAT = "(0.0, 0.0, 0.0, 0.93)"        # audience seats (small dots)
EXIT = "(0.804, 0.075, 0.776, 0.122)" # green emergency exit signs
FLOOR = "(0.0, 0.0, 0.0, 0.0)"        # the hall floor

# Rooms, identified by the centre of their outline (rounded to the nearest point).
# kind: stage | bar | lounge | food | service | area | workshop
ROOMS = [
    ((400, 159), "Event Lounge", "lounge"),
    ((356, 145), "Speaker Lounge", "lounge"),
    ((241, 141), "Main Stage", "stage"),
    ((187, 133), None, "stage"),
    ((297, 133), None, "stage"),
    ((241, 162), None, "stage"),
    ((627, 212), "Schoch Bar", "bar"),
    ((770, 238), "Cisco", "area"),
    ((351, 264), "Snack Bar", "food"),
    ((782, 270), "Snack Bar", "food"),
    ((127, 281), "Snack Bar", "food"),
    ((406, 272), "Focuswater", "bar"),
    ((406, 336), "Food Court", "food"),
    ((129, 369), "PhotoBus", "area"),
    ((633, 369), "Side Stage", "stage"),
    ((403, 456), "Toilets", "service"),
    ((518, 456), "Café", "food"),
    ((170, 456), "SchüGa Bier Bar", "bar"),
    ((770, 458), "Cocktail Bar", "bar"),
    ((347, 463), "Red Bull Bar", "bar", {"x": 350.5, "y": 468.2, "w": 46, "h": 12, "rot": 56}),
    ((213, 482), "Snack Bar", "food"),
    ((83, 525), "Toilets", "service"),
    ((370, 562), "Smoking Area", "service"),
    ((554, 562), "Food Area", "food"),
    ((687, 562), "Food Area", "food"),
    ((762, 161), "Dragon Workshop", "workshop"),
    ((450, 562), "Lion / Shark Workshop", "workshop"),
]

# Booth numbers whose labels the PDF stores run together ("096095094…"), left to right.
MERGED_ROWS = [
    (456.5, ["096", "095", "094", "093", "092", "091", "090", "089", "088", "087", "086", "085", "084"]),
    (484.0, ["074", "075", "076", "077", "080", "081", "082", "083"]),
]


def r1(v):
    return round(v, 1)


def bbox(c):
    return [r1(c["x0"]), r1(c["top"]), r1(c["x1"]), r1(c["bottom"])]


def dedupe(shapes):
    seen, out = set(), []
    for s in shapes:
        key = tuple(round(v) for v in s["bbox"])
        if key not in seen:
            seen.add(key)
            out.append(s)
    return out


def polygon(c):
    pts = [[r1(x), r1(y)] for x, y in c["pts"]]
    while len(pts) > 1 and pts[-1] == pts[0]:
        pts.pop()
    return pts


def main(pdf_path, out_path):
    page = pdfplumber.open(pdf_path).pages[0]
    curves = page.curves
    fill = lambda c: str(c.get("non_stroking_color"))

    # Booths: each tile is drawn twice (fill + outline); keep one per position.
    tiles = dedupe([{"bbox": bbox(c)} for c in curves if fill(c) == BOOTH])
    numbers = [w for w in page.extract_words() if w["text"].isdigit() and len(w["text"]) == 3]
    booths = []
    unnumbered = []
    for t in tiles:
        x0, y0, x1, y1 = t["bbox"]
        hit = [w for w in numbers if x0 <= (w["x0"] + w["x1"]) / 2 <= x1 and y0 <= (w["top"] + w["bottom"]) / 2 <= y1]
        if len(hit) == 1:
            booths.append({"id": hit[0]["text"], "rect": t["bbox"]})
        else:
            unnumbered.append(t)
    for y, ids in MERGED_ROWS:
        row = sorted([t for t in unnumbered if t["bbox"][1] <= y <= t["bbox"][3]], key=lambda t: t["bbox"][0])
        assert len(row) == len(ids), (y, len(row), len(ids))
        for t, n in zip(row, ids):
            booths.append({"id": n, "rect": t["bbox"]})
            unnumbered.remove(t)
    assert not unnumbered, unnumbered
    booths.sort(key=lambda b: b["id"])
    assert len({b["id"] for b in booths}) == len(booths)

    big = lambda c: (c["x1"] - c["x0"]) > 15 or (c["bottom"] - c["top"]) > 15
    walls = dedupe([{"bbox": bbox(c), "poly": polygon(c)} for c in curves if fill(c) == DARK and big(c)])

    room_shapes = dedupe([{"bbox": bbox(c), "poly": polygon(c), "fill": fill(c)}
                          for c in curves if fill(c) in (GREY, GOLD) and big(c)])
    # Gaming area (a plain rectangle in the PDF) with the dart lanes at its top. The two do not
    # overlap, so neither hides the other's label and no faces share a plane.
    rooms = [
        {"name": "Gaming Area", "kind": "area", "poly": [[749.5, 331.8], [790.9, 331.8], [790.9, 426.0], [749.5, 426.0]]},
        {"name": "Dart Area", "kind": "area", "poly": [[749.5, 290.4], [790.9, 290.4], [790.9, 331.8], [749.5, 331.8]], "inset": True},
    ]
    used = set()
    for (cx, cy), name, kind, *extra in ROOMS:
        best = min(
            (s for s in room_shapes if id(s) not in used),
            key=lambda s: abs((s["bbox"][0] + s["bbox"][2]) / 2 - cx) + abs((s["bbox"][1] + s["bbox"][3]) / 2 - cy),
        )
        bx = (best["bbox"][0] + best["bbox"][2]) / 2
        by = (best["bbox"][1] + best["bbox"][3]) / 2
        assert abs(bx - cx) + abs(by - cy) < 4, (name, cx, cy, bx, by)
        used.add(id(best))
        room = {"name": name, "kind": kind, "poly": best["poly"]}
        if extra:
            room["label"] = extra[0]  # label position, size and rotation (degrees) for slanted rooms
        rooms.append(room)

    arrow = [polygon(c) for c in curves if fill(c) == GOLD and big(c)
             and c["x1"] < 145 and c["top"] > 230 and c["bottom"] < 470]

    seats = sorted({(r1((c["x0"] + c["x1"]) / 2), r1((c["top"] + c["bottom"]) / 2))
                    for c in curves if fill(c) == SEAT and (c["x1"] - c["x0"]) < 8})
    exits = sorted({(r1((c["x0"] + c["x1"]) / 2), r1((c["top"] + c["bottom"]) / 2))
                    for c in curves if fill(c) == EXIT})
    floor = next(bbox(c) for c in curves if fill(c) == FLOOR and (c["x1"] - c["x0"]) > 500)

    venue = {
        "source": "Venue_Map_with_Booth_List_SN26.pdf (page 1)",
        "units": "PDF points; x right, y down",
        "page": [r1(page.width), r1(page.height)],
        "floor": floor,
        "walls": [w["poly"] for w in walls],
        "rooms": rooms,
        "entranceArrow": arrow,
        "labels": [
            {"text": "ENTRANCE", "x": 31, "y": 510, "rot": -90, "size": 11, "color": "#ffc800"},
            {"text": "MATCHMAKING", "x": 31, "y": 328, "rot": -90, "size": 11, "color": "#ffc800"},
            {"text": "Foyer", "x": 466, "y": 330, "rot": 0, "size": 7, "color": "#3a3a3a"},
        ],
        "seats": [list(s) for s in seats],
        "exits": [list(e) for e in exits],
        "booths": booths,
    }
    with open(out_path, "w") as f:
        json.dump(venue, f, ensure_ascii=False, separators=(",", ":"))
    print(f"booths={len(booths)} walls={len(walls)} rooms={len(rooms)} seats={len(seats)} exits={len(exits)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
