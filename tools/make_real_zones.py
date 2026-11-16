#!/usr/bin/env python3
"""Turns a BBBike / OpenStreetMap extract of Bhubaneswar (.osm or .osm.gz) into one compact JSON file per game area:
   public/data/real_<area>.json  (roads, flyovers, building outlines, named places; metres east/south of the area centre).
Usage: python3 tools/make_real_zones.py city.osm.gz       (map data (c) OpenStreetMap contributors, ODbL)"""
import sys, gzip, json, math, os, xml.etree.ElementTree as ET

ORIGIN = (20.2400, 85.8343)                      # the Old Town origin of the game
M_LAT = 110574; M_LON = 111320 * math.cos(math.radians(ORIGIN[0]))
xz = lambda la, lo: ((lo - ORIGIN[1]) * M_LON, -(la - ORIGIN[0]) * M_LAT)
# Centres of the game areas, in metres from the Old Town origin (x east, z south), chosen from the real map.
CENTRES = {'khandagiri': (-5150, -2650), 'baramunda': (-4300, -3700), 'jaydev': (-990, -6115), 'vanivihar': (800, -6560), 'rasulgarh': (2551, -6279), 'patia': (-2300, -10650)}
HALF = 520
ROAD_W = {'motorway': 14, 'trunk': 14, 'primary': 13, 'secondary': 12, 'tertiary': 10, 'unclassified': 8, 'residential': 7, 'living_street': 6, 'service': 5, 'pedestrian': 5,
          'trunk_link': 9, 'primary_link': 9, 'secondary_link': 8, 'tertiary_link': 8}
MAIN = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link'}
FEAT_KEYS = ('amenity', 'tourism', 'leisure', 'shop', 'natural', 'historic', 'railway', 'public_transport', 'office')
SKIP = {'bench', 'waste_basket', 'atm', 'parking', 'parking_space', 'toilets', 'fuel', 'charging_station', 'hairdresser', 'pharmacy', 'dentist', 'doctors', 'beauty', 'clothes', 'convenience'}

def fit_rect(pts):
    best = None
    for i in range(len(pts)):
        a, b = pts[i], pts[(i + 1) % len(pts)]; L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.5: continue
        c, s = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        u = [x * c + z * s for x, z in pts]; v = [-x * s + z * c for x, z in pts]
        u0, u1, v0, v1 = min(u), max(u), min(v), max(v); area = (u1 - u0) * (v1 - v0)
        if best is None or area < best[0]:
            uc, vc = (u0 + u1) / 2, (v0 + v1) / 2
            best = (area, uc * c - vc * s, uc * s + vc * c, u1 - u0, v1 - v0, -math.atan2(s, c))
    return best

def poly_area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2

def dp(pts, eps):                                   # Douglas-Peucker
    if len(pts) < 3: return pts
    a, b = pts[0], pts[-1]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1e-9
    d, k = max(((abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L), i) for i, p in enumerate(pts[1:-1], 1))
    return dp(pts[:k + 1], eps)[:-1] + dp(pts[k:], eps) if d > eps else [a, b]

def main(path):
    op = gzip.open if path.endswith('.gz') else open
    nodes, ways = {}, []
    with op(path, 'rb') as f:
        for ev, el in ET.iterparse(f, events=('end',)):
            if el.tag == 'node':
                la, lo = float(el.get('lat')), float(el.get('lon')); nid = int(el.get('id')); nodes[nid] = (la, lo)
                t = {c.get('k'): c.get('v') for c in el.findall('tag')}
                if t.get('name') or t.get('name:en'): ways.append(('node', nid, t, None))
                elif t.get('highway') == 'traffic_signals': ways.append(('signal', nid, t, None))
                el.clear()
            elif el.tag == 'way':
                t = {c.get('k'): c.get('v') for c in el.findall('tag')}
                ways.append(('way', int(el.get('id')), t, [int(n.get('ref')) for n in el.findall('nd')])); el.clear()
            elif el.tag == 'relation': el.clear()
    print('read', len(nodes), 'nodes', sum(1 for w in ways if w[0] == 'way'), 'ways')
    for name, (cx, cz) in CENTRES.items():
        roads, fly, builds, feats, sigs = [], [], [], [], []
        loc = lambda la, lo: tuple(round(v, 1) for v in (xz(la, lo)[0] - cx, xz(la, lo)[1] - cz))
        inside = lambda p, m=HALF: abs(p[0]) <= m and abs(p[1]) <= m
        for kind, wid, t, refs in ways:
            nm = t.get('name') or t.get('name:en') or ''
            if kind == 'signal':
                p = loc(*nodes[wid])
                if inside(p, 500): sigs.append({'x': p[0], 'z': p[1]})
                continue
            if kind == 'node':
                la, lo = nodes[wid]; p = loc(la, lo)
                cls = next((k + '=' + t[k] for k in FEAT_KEYS if k in t and t[k] not in SKIP), None)
                if cls and inside(p, 495): feats.append({'name': nm, 'cls': cls, 'x': p[0], 'z': p[1]})
                continue
            pts = [loc(*nodes[n]) for n in refs if n in nodes]
            if len(pts) < 2: continue
            hw = t.get('highway')
            if hw in ROAD_W:
                elevated = t.get('bridge') in ('yes', 'viaduct') and t.get('layer', '0') not in ('0', '-1', '-2')
                simp = [pts[0]]
                for p in pts[1:]:
                    if math.hypot(p[0] - simp[-1][0], p[1] - simp[-1][1]) >= 4: simp.append(p)
                if elevated:
                    if any(inside(p) for p in simp) and sum(math.hypot(simp[i + 1][0] - simp[i][0], simp[i + 1][1] - simp[i][1]) for i in range(len(simp) - 1)) > 60 and hw in MAIN:
                        fly.append({'name': nm, 'w': ROAD_W[hw], 'pts': simp, 'id': wid})
                    continue
                if t.get('tunnel') == 'yes': continue
                run = []
                for p in simp + [None]:
                    if p is not None and inside(p, 505): run.append(p)
                    else:
                        if len(run) >= 2:
                            rd = {'name': nm, 'kind': hw, 'w': ROAD_W[hw], 'main': hw in MAIN, 'pts': run}
                            ow = t.get('oneway')
                            if ow in ('yes', '1', 'true'): rd['oneway'] = 1
                            elif ow == '-1': rd['oneway'] = 1; rd['pts'] = run[::-1]
                            if t.get('junction') == 'roundabout': rd['oneway'] = 1; rd['round'] = 1
                            try: ln = int(t.get('lanes', 0))
                            except ValueError: ln = 0
                            if ln: rd['lanes'] = ln
                            if t.get('ref'): rd['ref'] = t['ref'][:12]
                            roads.append(rd)
                        run = []
            elif 'building' in t and len(pts) >= 4:
                poly = pts[:-1] if pts[0] == pts[-1] else pts
                if len(poly) < 3: continue
                ar = poly_area(poly)
                if ar < 18 or ar > 8000: continue
                r = fit_rect(poly)
                if not r or not inside((r[1], r[2]), 495): continue
                lv = t.get('building:levels') or t.get('levels') or ''
                try: fl = int(float(lv))
                except ValueError: fl = 0
                builds.append({'x': round(r[1], 1), 'z': round(r[2], 1), 'w': round(max(r[3], 3), 1), 'd': round(max(r[4], 3), 1), 'yaw': round(r[5], 3), 'floors': fl, 'name': nm})
            else:
                cls = next((k + '=' + t[k] for k in FEAT_KEYS if k in t and t[k] not in SKIP), None)
                if nm and cls:
                    cxp = sum(p[0] for p in pts) / len(pts); czp = sum(p[1] for p in pts) / len(pts)
                    if abs(cxp) <= 495 and abs(czp) <= 495: feats.append({'name': nm, 'cls': cls, 'x': round(cxp, 1), 'z': round(czp, 1), 'area': round(poly_area(pts)) if pts[0] == pts[-1] else 0})
        # flyover decks: merge ways that share an end, then simplify each chain to straight pieces
        chains = []
        for fo in fly:
            for ch in chains:
                if ch['name'] == fo['name'] and math.hypot(ch['pts'][-1][0] - fo['pts'][0][0], ch['pts'][-1][1] - fo['pts'][0][1]) < 3: ch['pts'] += fo['pts'][1:]; break
                if ch['name'] == fo['name'] and math.hypot(ch['pts'][0][0] - fo['pts'][-1][0], ch['pts'][0][1] - fo['pts'][-1][1]) < 3: ch['pts'] = fo['pts'][:-1] + ch['pts']; break
            else: chains.append({'name': fo['name'], 'w': fo['w'], 'pts': list(fo['pts'])})
        decks = []
        for ch in chains:
            pts = dp(ch['pts'], 5)
            runs, cur = [], []                    # keep the stretch that lies inside the game area
            for p in pts:
                if abs(p[0]) <= 495 and abs(p[1]) <= 495: cur.append(p)
                else:
                    if len(cur) >= 2: runs.append(cur)
                    cur = []
            if len(cur) >= 2: runs.append(cur)
            if not runs: continue
            pts = max(runs, key=lambda r: sum(math.hypot(r[i + 1][0] - r[i][0], r[i + 1][1] - r[i][1]) for i in range(len(r) - 1)))
            L = sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))
            if L >= 90: decks.append({'name': ch['name'], 'w': min(ch['w'], 10), 'len': round(L), 'pts': [[round(a, 1), round(b, 1)] for a, b in pts]})
        feats.sort(key=lambda f: f['name'])
        out = {'area': name, 'center': {'x': cx, 'z': cz}, 'roads': roads, 'signals': sigs, 'flyovers': decks, 'buildings': builds, 'features': feats}
        fn = os.path.join(os.path.dirname(__file__), '..', 'public', 'data', f'real_{name}.json')
        json.dump(out, open(fn, 'w'), separators=(',', ':'))
        print(f'{name:11s} signals {len(sigs):3d} oneway {sum(1 for r in roads if r.get("oneway")):3d} lanes-tagged {sum(1 for r in roads if r.get("lanes")):3d} roads {len(roads):4d} flyover decks {len(decks)} buildings {len(builds):4d} features {len(feats):3d}  {os.path.getsize(fn) // 1024} KB')

if __name__ == '__main__':
    main(sys.argv[1])
