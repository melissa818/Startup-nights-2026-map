#!/usr/bin/env python3
"""Build site/data/assistant.json: a compact directory the AI assistant's search tool reads.

For every startup and place (rooms, areas, entrance, exits) it records where it is on the floor
plan in words: the part of the hall (as seen on the map from above) and the nearest landmarks.
Place ids match the ones the app builds in site/js/main.js, so the assistant can name them and
the app can show them on the map.

    python3 tools/build_assistant_data.py
"""
import json
import math
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / 'site'

# Same words as KINDS / PLACE_EXTRA in site/js/main.js.
KINDS = {
    'workshop': ('Workshop', 'workshop workshops session sessions class'),
    'stage': ('Stage', 'stage stages talk talks keynote pitch pitches panel'),
    'bar': ('Bar', 'bar bars drink drinks beer cocktail'),
    'food': ('Food & drinks', 'food eat snack snacks drink drinks lunch dinner'),
    'lounge': ('Lounge', 'lounge lounges'),
    'service': ('Facilities', 'facilities'),
    'area': ('Area', 'area'),
    'entrance': ('Entrance', 'entrance entry door way in'),
    'exit': ('Safety', 'exit exits emergency fire safety'),
}
PLACE_EXTRA = {
    'Toilets': 'toilet wc restroom restrooms bathroom loo',
    'Smoking Area': 'smoking smoke cigarette',
    'Gaming Area': 'gaming games play',
    'Dart Area': 'darts dart games play',
    'Cisco': 'cisco partner',
    'PhotoBus': 'photo photos picture pictures',
    'Café': 'coffee cafe',
    'Matchmaking': 'matchmaking networking meet meeting',
    'Foyer': 'foyer',
}


def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', str(s or '')) if not unicodedata.combining(c)).lower()


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', fold(s)).strip('-')


def booth_label(booths):
    nums = sorted(int(b) for b in booths)
    runs = []
    for n in nums:
        if runs and n == runs[-1][1] + 1:
            runs[-1][1] = n
        else:
            runs.append([n, n])
    return ', '.join(f'{a:03d}' if a == b else f'{a:03d}–{b:03d}' for a, b in runs)


def centre(points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)


def dist_to_box(pt, points):
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    dx = max(min(xs) - pt[0], 0, pt[0] - max(xs))
    dy = max(min(ys) - pt[1], 0, pt[1] - max(ys))
    return math.hypot(dx, dy)


def main():
    startups = json.loads((SITE / 'data/startups.json').read_text())
    venue = json.loads((SITE / 'data/venue.json').read_text())

    booth_pts = {}
    for b in venue['booths']:
        x0, y0, x1, y1 = b['rect']
        booth_pts[b['id']] = [(x0, y0), (x1, y1)]

    # Places, built the same way as in main.js.
    places = {}

    def add(name, kind, pts):
        pid = slugify(name)
        p = places.setdefault(pid, {'id': pid, 'name': name, 'kind': kind, 'parts': []})
        p['parts'].append(pts)

    for r in venue['rooms']:
        if r.get('name'):
            add(r['name'], r['kind'], [tuple(p) for p in r['poly']])
    add('Entrance', 'entrance', [(70, 412)])
    add('Matchmaking', 'area', [(31, 328)])
    add('Foyer', 'area', [(466, 330)])
    for x, y in venue['exits']:
        add('Emergency exits', 'exit', [(x, y)])

    # The hall's extent, from booths and rooms, to name its parts.
    allpts = [p for pts in booth_pts.values() for p in pts]
    allpts += [p for pl in places.values() if pl['kind'] != 'exit' for part in pl['parts'] for p in part]
    minx, maxx = min(p[0] for p in allpts), max(p[0] for p in allpts)
    miny, maxy = min(p[1] for p in allpts), max(p[1] for p in allpts)

    def zone(pt):
        fx = (pt[0] - minx) / (maxx - minx)
        fy = (pt[1] - miny) / (maxy - miny)
        h = 'left' if fx < 1 / 3 else 'right' if fx > 2 / 3 else 'middle'
        v = 'upper' if fy < 1 / 3 else 'lower' if fy > 2 / 3 else 'middle'
        if h == 'middle' and v == 'middle':
            return 'centre of the hall'
        if v == 'middle':
            return f'{h} side of the hall'
        if h == 'middle':
            return f'{v} middle of the hall'
        return f'{v} {h} of the hall'

    landmarks = [(pl['name'], part) for pl in places.values() if pl['kind'] != 'exit' for part in pl['parts']]

    def near_landmarks(pt, limit=2, within=170):
        best = {}
        for name, part in landmarks:
            d = dist_to_box(pt, part)
            if d <= within and (name not in best or d < best[name]):
                best[name] = d
        return [n for n, _ in sorted(best.items(), key=lambda kv: kv[1])[:limit]]

    def near_booths(pt, limit=4):
        ranked = sorted(booth_pts.items(), key=lambda kv: dist_to_box(pt, kv[1]))
        return booth_label([b for b, _ in ranked[:limit]])

    out_startups = []
    for s in startups:
        pts = [p for b in s['booths'] if b in booth_pts for p in booth_pts[b]]
        entry = {
            'id': s['id'],
            'name': s['name'],
            'booth': booth_label(s['booths']),
            'category': s.get('category') or '',
            'about': (s.get('description') or '')[:240],
            'website': s.get('website') or '',
            'verified': s.get('status') == 'verified',
        }
        if s.get('status') == 'surprise':
            entry['about'] = 'A surprise startup, revealed at the event.'
        if pts:
            c = centre(pts)
            entry['where'] = zone(c)
            entry['near'] = near_landmarks(c)
        else:
            entry['where'] = 'not drawn on the official floor plan'
            entry['near'] = []
        out_startups.append(entry)

    out_places = []
    for pl in sorted(places.values(), key=lambda p: p['name']):
        label, words = KINDS.get(pl['kind'], KINDS['area'])
        allp = [p for part in pl['parts'] for p in part]
        c = centre(allp)
        entry = {
            'id': pl['id'],
            'name': pl['name'],
            'kind': label,
            'count': len(pl['parts']),
            'words': f"{words} {PLACE_EXTRA.get(pl['name'], '')}".strip(),
        }
        if pl['kind'] == 'exit':
            entry['where'] = 'all around the hall, marked with green EXIT signs'
        elif len(pl['parts']) > 1:
            entry['where'] = '; '.join(
                f"{zone(centre(part))} near booths {near_booths(centre(part), 3)}" for part in pl['parts'])
        else:
            entry['where'] = f'{zone(c)}, near booths {near_booths(c)}'
            others = [n for n in near_landmarks(c, 3) if n != pl['name']][:2]
            if others:
                entry['where'] += f" and the {' and the '.join(others)}"
        out_places.append(entry)

    data = {
        'event': 'Startup Nights 2026, 5–6 November 2026, Eulachhallen Winterthur',
        'orientation': 'Directions describe the floor plan as seen from above (the map\'s Top view): the entrance and Matchmaking are on the left edge.',
        'startups': out_startups,
        'places': out_places,
    }
    path = SITE / 'data/assistant.json'
    path.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')))
    print(f'{path.relative_to(ROOT)}: {len(out_startups)} startups, {len(out_places)} places, {path.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
