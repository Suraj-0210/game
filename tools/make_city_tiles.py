#!/usr/bin/env python3
"""Whole-city tiles: every street and building of the OpenStreetMap extract, cut into 500 m tiles in TRUE coordinates
(metres east/south of the Old Town origin) so the game can stream them in around the player.
Writes public/data/city/index.json and public/data/city/t_<ix>_<iz>.json.
Streets cross tile borders with a 25 m overlap (so they join with no seam); the seven hand-built areas keep their own data, so nothing inside
their squares is written here. Usage: python3 tools/make_city_tiles.py city.osm.gz   (map data (c) OpenStreetMap contributors, ODbL)"""
import sys, os, gzip, json, math, collections, xml.etree.ElementTree as ET
sys.path.insert(0, os.path.dirname(__file__))
from make_real_zones import xz, ROAD_W, MAIN, fit_rect, CENTRES

T = 500; MARGIN = 25; AREA_HALF = 500
BOX = (85.726, 20.181, 85.982, 20.358)                    # the extract's own lon/lat box
SQUARES = [(0.0, 0.0)] + [(float(cx), float(cz)) for cx, cz in CENTRES.values()]
inside_sq = lambda x, z: any(abs(x - cx) < AREA_HALF and abs(z - cz) < AREA_HALF for cx, cz in SQUARES)

LAND_POLY = {('natural', 'water'): 'water', ('landuse', 'reservoir'): 'water', ('water', 'river'): 'water', ('water', 'lake'): 'water', ('water', 'pond'): 'water', ('water', 'canal'): 'water',
             ('leisure', 'park'): 'park', ('leisure', 'garden'): 'park', ('leisure', 'playground'): 'park', ('leisure', 'recreation_ground'): 'park', ('landuse', 'grass'): 'park', ('landuse', 'meadow'): 'park', ('landuse', 'cemetery'): 'park', ('landuse', 'recreation_ground'): 'park', ('landuse', 'village_green'): 'park',
             ('landuse', 'forest'): 'forest', ('natural', 'wood'): 'forest', ('natural', 'scrub'): 'forest', ('landuse', 'orchard'): 'forest',
             ('landuse', 'farmland'): 'field', ('landuse', 'farmyard'): 'field', ('natural', 'wetland'): 'field',
             ('leisure', 'pitch'): 'pitch', ('leisure', 'stadium'): 'pitch', ('leisure', 'track'): 'pitch', ('leisure', 'golf_course'): 'park',
             ('aeroway', 'apron'): 'apron', ('aeroway', 'runway'): 'runway', ('aeroway', 'taxiway'): 'taxiway', ('aeroway', 'terminal'): 'apron'}
LAND_LINE = {('waterway', 'river'): ('water', 40), ('waterway', 'canal'): ('water', 7), ('waterway', 'stream'): ('water', 3.5), ('waterway', 'drain'): ('water', 2.5), ('waterway', 'ditch'): ('water', 2),
             ('aeroway', 'runway'): ('runway', 45), ('aeroway', 'taxiway'): ('taxiway', 18)}
def land_class(t):
    for k, v in t.items():
        if (k, v) in LAND_POLY or (k, v) in LAND_LINE: return (k, v)
    return None
LAND_TAGS = lambda t: land_class(t) is not None

def dp(pts, eps):
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
    d, k = max(((abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L), i) for i, p in enumerate(pts[1:-1], 1))
    return dp(pts[:k + 1], eps)[:-1] + dp(pts[k:], eps) if d > eps else [a, b]

def join_rings(ways_pts):
    rings, segs = [], [list(w) for w in ways_pts if len(w) >= 2]
    while segs:
        cur = segs.pop()
        grown = True
        while grown and math.hypot(cur[0][0] - cur[-1][0], cur[0][1] - cur[-1][1]) > 1:
            grown = False
            for i, sg in enumerate(segs):
                if math.hypot(cur[-1][0] - sg[0][0], cur[-1][1] - sg[0][1]) < 1: cur += sg[1:]
                elif math.hypot(cur[-1][0] - sg[-1][0], cur[-1][1] - sg[-1][1]) < 1: cur += sg[::-1][1:]
                else: continue
                segs.pop(i); grown = True; break
        if len(cur) >= 4 and math.hypot(cur[0][0] - cur[-1][0], cur[0][1] - cur[-1][1]) < 1: rings.append(cur[:-1])
    return rings

def pieces(a, b, tx0, tz0, tx1, tz1, sqs):
    """sub-segments of a-b that lie inside the (margin-grown) tile box and outside every area square"""
    xs = [tx0, tx1] + [v for cx, cz in sqs for v in (cx - AREA_HALF, cx + AREA_HALF)]
    zs = [tz0, tz1] + [v for cx, cz in sqs for v in (cz - AREA_HALF, cz + AREA_HALF)]
    dx, dz = b[0] - a[0], b[1] - a[1]; ts = [0.0, 1.0]
    if abs(dx) > 1e-9: ts += [(x - a[0]) / dx for x in xs]
    if abs(dz) > 1e-9: ts += [(z - a[1]) / dz for z in zs]
    ts = sorted(t for t in ts if 0 <= t <= 1); out = []
    for t0, t1 in zip(ts, ts[1:]):
        if t1 - t0 < 1e-7: continue
        mx, mz = a[0] + dx * (t0 + t1) / 2, a[1] + dz * (t0 + t1) / 2
        if tx0 <= mx <= tx1 and tz0 <= mz <= tz1 and not any(abs(mx - cx) < AREA_HALF and abs(mz - cz) < AREA_HALF for cx, cz in sqs):
            out.append(((a[0] + dx * t0, a[1] + dz * t0), (a[0] + dx * t1, a[1] + dz * t1)))
    return out

def runs_in(pts, tx0, tz0, tx1, tz1, sqs):
    runs, cur = [], []
    for a, b in zip(pts, pts[1:]):
        for p, q in pieces(a, b, tx0, tz0, tx1, tz1, sqs):
            if cur and math.hypot(cur[-1][0] - p[0], cur[-1][1] - p[1]) < 1e-3: cur.append(q)
            else:
                if len(cur) >= 2: runs.append(cur)
                cur = [p, q]
    if len(cur) >= 2: runs.append(cur)
    return [r for r in runs if sum(math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]) for i in range(len(r) - 1)) >= 3]

def main(path):
    op = gzip.open if path.endswith('.gz') else open
    nodes, ways, wnodes, rels = {}, [], {}, []
    with op(path, 'rb') as f:
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'node': nodes[int(el.get('id'))] = xz(float(el.get('lat')), float(el.get('lon'))); el.clear()
            elif el.tag == 'way':
                t = {c.get('k'): c.get('v') for c in el.findall('tag')}
                refs = [int(n.get('ref')) for n in el.findall('nd')]; wnodes[int(el.get('id'))] = refs
                if 'highway' in t or 'building' in t or LAND_TAGS(t): ways.append((int(el.get('id')), t, refs))
                el.clear()
            elif el.tag == 'relation':
                t = {c.get('k'): c.get('v') for c in el.findall('tag')}
                if t.get('type') == 'multipolygon' and LAND_TAGS(t): rels.append((t, [int(m.get('ref')) for m in el.findall('member') if m.get('type') == 'way' and m.get('role') in ('outer', '')]))
                el.clear()
    x0, z1 = xz(BOX[3], BOX[0]); x1, z0 = xz(BOX[1], BOX[2])   # x0 west, x1 east; z0 north (small), z1 south
    x0, x1, z0, z1 = min(x0, x1), max(x0, x1), min(z0, z1), max(z0, z1)
    print('city box x', round(x0), round(x1), 'z', round(z0), round(z1))
    inbox = lambda p: x0 <= p[0] <= x1 and z0 <= p[1] <= z1
    roads, builds, flies = [], [], []
    for wid, t, refs in ways:
        pts = [nodes[n] for n in refs if n in nodes]
        if len(pts) < 2: continue
        hw = t.get('highway')
        if hw in ROAD_W:
            if not any(inbox(p) for p in pts): continue
            simp = [pts[0]]
            for p in pts[1:]:
                if math.hypot(p[0] - simp[-1][0], p[1] - simp[-1][1]) >= 4: simp.append(p)
            if len(simp) < 2: simp.append(pts[-1])
            elev = t.get('bridge') in ('yes', 'viaduct') and t.get('layer', '0') not in ('0', '-1', '-2')
            if elev:
                tot = sum(math.hypot(simp[i + 1][0] - simp[i][0], simp[i + 1][1] - simp[i][1]) for i in range(len(simp) - 1))
                if tot >= 60 and hw in MAIN:
                    off = 0.0
                    for i in range(len(simp) - 1):
                        a_, b_ = simp[i], simp[i + 1]; L = math.hypot(b_[0] - a_[0], b_[1] - a_[1])
                        if L >= 3: flies.append({'x0': round(a_[0], 1), 'z0': round(a_[1], 1), 'x1': round(b_[0], 1), 'z1': round(b_[1], 1), 'w': ROAD_W[hw], 'off': round(off, 1), 'tot': round(tot, 1)})
                        off += L
                    continue
            rd = {'g': wid, 'kind': hw, 'w': ROAD_W[hw], 'pts': simp, 'elev': elev}
            if hw in MAIN: rd['main'] = 1
            ow = t.get('oneway')
            if ow in ('yes', '1', 'true'): rd['oneway'] = 1
            elif ow == '-1': rd['oneway'] = 1; rd['pts'] = simp[::-1]
            if t.get('junction') == 'roundabout': rd['oneway'] = 1; rd['round'] = 1
            try: ln = int(t.get('lanes', 0))
            except ValueError: ln = 0
            if ln: rd['lanes'] = ln
            nm = t.get('name') or ''
            if nm and hw in MAIN: rd['name'] = nm[:40]
            if t.get('ref'): rd['ref'] = t['ref'][:12]
            roads.append(rd)
        elif 'building' in t and len(pts) >= 4:
            poly = pts[:-1] if pts[0] == pts[-1] else pts
            if len(poly) < 3: continue
            ar = abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))) / 2
            if ar < 18 or ar > 8000: continue
            r = fit_rect(poly)
            if not r or not inbox((r[1], r[2])) or inside_sq(r[1], r[2]): continue
            lv = t.get('building:levels') or t.get('levels') or ''
            try: fl = int(float(lv))
            except ValueError: fl = 0
            builds.append([round(r[1], 1), round(r[2], 1), round(max(r[3], 3), 1), round(max(r[4], 3), 1), round(r[5], 3), fl])
    # ---- land: water, parks, forest, fields, the airport ----
    land = []
    def add_poly(kind, pts):
        if len(pts) > 6:
            k = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
            pts = dp(pts[:k + 1], 4.0)[:-1] + dp(pts[k:] + [pts[0]], 4.0)[:-1]
        if len(pts) < 3 or len(pts) > 700: return
        ar = abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2
        if ar < 120: return
        land.append({'k': kind, 'pts': [[round(p[0], 1), round(p[1], 1)] for p in pts]})
    for wid, t, refs in ways:
        c = land_class(t)
        if not c or 'highway' in t or 'building' in t: continue
        pts = [nodes[n] for n in refs if n in nodes]
        if len(pts) < 2 or not any(inbox(p) for p in pts): continue
        if c in LAND_LINE and not (pts[0] == pts[-1] and len(pts) > 3 and c in LAND_POLY and c[0] != 'waterway'):
            kind, w = LAND_LINE[c]; sp = dp(pts, 3.0)
            land.append({'k': kind, 'line': 1, 'w': w, 'pts': [[round(p[0], 1), round(p[1], 1)] for p in sp]}); continue
        if c in LAND_POLY and pts[0] == pts[-1] and len(pts) >= 4: add_poly(LAND_POLY[c], pts[:-1])
    for t, members in rels:
        c = land_class(t) or (('natural', 'water') if t.get('water') or t.get('natural') == 'water' else None)
        if not c or c not in LAND_POLY: continue
        rings = join_rings([[nodes[n] for n in wnodes.get(m, []) if n in nodes] for m in members])
        for r in rings:
            if any(inbox(p) for p in r): add_poly(LAND_POLY[c], r)
    # elevated decks that just repeat a ground road are dropped (they would sit on top of it)
    gh = collections.defaultdict(list)
    for r in roads:
        if r['elev']: continue
        for a, b in zip(r['pts'], r['pts'][1:]):
            n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) // 4))
            for k in range(n + 1): p = (a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n); gh[(int(p[0] // 8), int(p[1] // 8))].append(p)
    def near_ground(p):
        cx, cz = int(p[0] // 8), int(p[1] // 8)
        return any(math.hypot(q[0] - p[0], q[1] - p[1]) < 7 for i in (-1, 0, 1) for j in (-1, 0, 1) for q in gh.get((cx + i, cz + j), ()))
    kept = []
    for r in roads:
        if r['elev']:
            sample = r['pts']; hit = sum(1 for p in sample if near_ground(p))
            if hit > 0.5 * len(sample): continue
        kept.append(r)
    roads = kept
    tiles = collections.defaultdict(lambda: {'roads': [], 'b': []})
    for r in roads:
        xs = [p[0] for p in r['pts']]; zs = [p[1] for p in r['pts']]
        for ix in range(math.floor((min(xs) - MARGIN) / T), math.floor((max(xs) + MARGIN) / T) + 1):
            for iz in range(math.floor((min(zs) - MARGIN) / T), math.floor((max(zs) + MARGIN) / T) + 1):
                tx0, tz0, tx1, tz1 = ix * T - MARGIN, iz * T - MARGIN, (ix + 1) * T + MARGIN, (iz + 1) * T + MARGIN
                sqs = [s for s in SQUARES if abs(s[0] - (tx0 + tx1) / 2) < AREA_HALF + (tx1 - tx0) / 2 and abs(s[1] - (tz0 + tz1) / 2) < AREA_HALF + (tz1 - tz0) / 2]
                for run in runs_in(r['pts'], tx0, tz0, tx1, tz1, sqs):
                    o = {k: v for k, v in r.items() if k not in ('pts', 'elev')}
                    o['pts'] = [[round(p[0], 1), round(p[1], 1)] for p in run]
                    tiles[(ix, iz)]['roads'].append(o)
    for b in builds: tiles[(math.floor(b[0] / T), math.floor(b[1] / T))]['b'].append(b)
    for f in flies:                                      # a bridge piece belongs to the tile of its middle; the areas have their own flyovers
        mx, mz = (f['x0'] + f['x1']) / 2, (f['z0'] + f['z1']) / 2
        if inside_sq(mx, mz): continue
        tiles[(math.floor(mx / T), math.floor(mz / T))].setdefault('fly', []).append(f)
    for L in land:
        xs = [p[0] for p in L['pts']]; zs = [p[1] for p in L['pts']]; hw = L.get('w', 0) / 2
        cells = [(ix, iz) for ix in range(math.floor((min(xs) - hw) / T), math.floor((max(xs) + hw) / T) + 1) for iz in range(math.floor((min(zs) - hw) / T), math.floor((max(zs) + hw) / T) + 1)]
        if len(cells) > 400: continue
        for k in cells:
            if L.get('line'):                       # long lines are cut to the tile (with the usual 25 m overlap)
                for run in runs_in([tuple(q) for q in L['pts']], k[0] * T - MARGIN - hw, k[1] * T - MARGIN - hw, (k[0] + 1) * T + MARGIN + hw, (k[1] + 1) * T + MARGIN + hw, []):
                    tiles[k].setdefault('land', []).append({**L, 'pts': [[round(q[0], 1), round(q[1], 1)] for q in run]})
            else: tiles[k].setdefault('land', []).append(L)
    out = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', 'city')
    os.makedirs(out, exist_ok=True)
    for fn in os.listdir(out): os.remove(os.path.join(out, fn))
    index, total = {}, 0
    for (ix, iz), d in sorted(tiles.items()):
        if not d['roads'] and not d['b'] and not d.get('land') and not d.get('fly'): continue
        fn = f't_{ix}_{iz}.json'; json.dump(d, open(os.path.join(out, fn), 'w'), separators=(',', ':'))
        sz = os.path.getsize(os.path.join(out, fn)); total += sz; index[f'{ix},{iz}'] = [len(d['roads']), len(d['b']), len(d.get('land', []))]
    json.dump({'tile': T, 'margin': MARGIN, 'box': [round(x0), round(z0), round(x1), round(z1)], 'tiles': index}, open(os.path.join(out, 'index.json'), 'w'), separators=(',', ':'))
    print('tiles', len(index), 'roads', len(roads), 'buildings', len(builds), 'total KB', total // 1024)

if __name__ == '__main__': main(sys.argv[1])
