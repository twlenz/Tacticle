#!/usr/bin/env python3
"""Build maps/world1942.json, Tacticle's original world map.

Inputs : tools/world_config.py (territory groupings, names, values, sea-zone seeds)
         Natural Earth 1:50m admin-0 countries, admin-1 provinces, lakes (public domain),
         downloaded to tools/cache/ on first run.
Method : 1. Project every country/province with a Miller projection whose seam runs
            through the Bering Strait (the far west wraps to the right edge).
         2. Assemble land territories from whole countries, country pieces, provinces,
            or Voronoi shares of a country around seed points.
         3. Grow tiny islands so they can be clicked; fill slivers between sources.
         4. Sea zones are Voronoi cells around seed points, clipped to open water;
            detached bits of a cell join the neighbouring zone they touch most.
         5. Adjacency is measured on the full-detail shapes, then the whole board is
            simplified as one coverage so shared borders stay shared.
Usage  : pip install shapely ; python3 tools/build_world_map.py [--preview out.svg]
"""
import json
import math
import pathlib
import sys
import urllib.request
from collections import defaultdict

import numpy as np
import shapely
from shapely.geometry import MultiPoint, Point, Polygon, MultiPolygon, box, shape
from shapely.ops import polylabel, unary_union
from shapely import affinity

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import world_config as C  # noqa: E402

CACHE = HERE / 'cache'
NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
FILES = ['ne_50m_admin_0_countries', 'ne_50m_admin_1_states_provinces', 'ne_50m_lakes']


def load(name):
    CACHE.mkdir(exist_ok=True)
    p = CACHE / (name + '.geojson')
    if not p.exists():
        print('downloading', name)
        urllib.request.urlretrieve(NE + name + '.geojson', p)
    return json.loads(p.read_text())


K = C.PX_PER_DEG
W = 360 * K


def miller(lat_deg):
    lat = math.radians(max(min(lat_deg, 85), -85))
    return 1.25 * math.log(math.tan(math.pi / 4 + 0.4 * lat)) * 180 / math.pi * K


YTOP = miller(C.LAT_TOP)
H = round(YTOP - miller(C.LAT_BOT))
RECT = box(0, 0, W, H)


def _proj_xy(arr):
    lon = arr[:, 0]
    lat = np.clip(arr[:, 1], -85, 85)
    x = (lon - C.LON0) * K
    y = YTOP - 1.25 * np.log(np.tan(np.pi / 4 + 0.4 * np.radians(lat))) * 180 / np.pi * K
    return np.column_stack([x, y])


def shifted(lon):
    return lon if lon >= C.LON0 else lon + 360


def project(geom):
    """lon/lat geometry -> board pixels, wrapping the far west past the seam."""
    east = shapely.clip_by_rect(geom, C.LON0, -90, 180, 90)
    west = shapely.clip_by_rect(geom, -180, -90, C.LON0, 90)
    west = affinity.translate(west, 360, 0)
    g = unary_union([east, west])
    g = shapely.transform(g, _proj_xy)
    g = shapely.make_valid(g).intersection(RECT)
    return polys(g)


def polys(g):
    """Keep only polygonal parts as a (Multi)Polygon."""
    if g.is_empty:
        return MultiPolygon()
    if g.geom_type == 'Polygon':
        return MultiPolygon([g])
    if g.geom_type == 'MultiPolygon':
        return g
    parts = []
    for p in getattr(g, 'geoms', []):
        if p.geom_type == 'Polygon':
            parts.append(p)
        elif p.geom_type == 'MultiPolygon':
            parts.extend(p.geoms)
    return MultiPolygon(parts)


def pt(lat, lon):
    return Point(_proj_xy(np.array([[shifted(lon) if lon < 180 else lon, lat]]))[0])


def bbox_px(bb):
    lon0, lat0, lon1, lat1 = bb
    a = _proj_xy(np.array([[lon0, lat1], [lon1, lat0]]))
    return box(a[0, 0], a[0, 1], a[1, 0], a[1, 1])


def pieces(g):
    return list(polys(g).geoms)


def main():
    preview = None
    if '--preview' in sys.argv:
        preview = sys.argv[sys.argv.index('--preview') + 1]

    adm0 = {}
    for f in load('ne_50m_admin_0_countries')['features']:
        iso = f['properties']['ADM0_A3']
        g = project(shape(f['geometry']))
        adm0[iso] = unary_union([adm0[iso], g]) if iso in adm0 else g
    adm1 = defaultdict(dict)
    for f in load('ne_50m_admin_1_states_provinces')['features']:
        p = f['properties']
        if p['adm0_a3'] in C.ADMIN1:
            adm1[p['adm0_a3']][p['name']] = project(shape(f['geometry']))
    lakes = unary_union([project(shape(f['geometry'])) for f in load('ne_50m_lakes')['features']
                         if f['properties'].get('scalerank', 9) <= 2])

    # Pools: what is still unclaimed of each country / province
    pool0 = {iso: list(pieces(g)) for iso, g in adm0.items()}
    pool1 = {iso: {n: list(pieces(g)) for n, g in d.items()} for iso, d in adm1.items()}
    used_iso = set()
    geoms = defaultdict(list)
    warn = []

    def take_pieces(lst, region=None):
        keep, rest = [], []
        for p in lst:
            (keep if region is None or region.contains(p.representative_point()) else rest).append(p)
        lst[:] = rest
        return keep

    land = C.LAND
    # Phase 1: piece filters, then provinces, then circles
    for kind_order in (('cb', 'ab', 'ac'), ('a',), ('circle',)):
        for t in land:
            for s in t['src']:
                k = s[0]
                if k not in kind_order:
                    continue
                if k == 'cb':
                    used_iso.add(s[1])
                    if s[1] in C.ADMIN1:
                        got = [p for n in pool1[s[1]] for p in take_pieces(pool1[s[1]][n], bbox_px(s[2]))]
                    else:
                        got = take_pieces(pool0.get(s[1], []), bbox_px(s[2]))
                    if not got:
                        warn.append(f"{t['id']}: nothing of {s[1]} in bbox")
                    geoms[t['id']] += got
                elif k == 'ab':
                    used_iso.add(s[1])
                    got = take_pieces(pool1[s[1]].get(s[2], []), bbox_px(s[3]))
                    if not got:
                        warn.append(f"{t['id']}: nothing of {s[1]}/{s[2]} in bbox")
                    geoms[t['id']] += got
                elif k == 'ac':
                    used_iso.add(s[1])
                    lst = pool1[s[1]].get(s[2], [])
                    whole = unary_union(lst)
                    bb = bbox_px(s[3])
                    got = pieces(whole.intersection(bb))
                    lst[:] = pieces(whole.difference(bb))
                    if not got:
                        warn.append(f"{t['id']}: nothing of {s[1]}/{s[2]} in bbox")
                    geoms[t['id']] += got
                elif k == 'a':
                    used_iso.add(s[1])
                    for n in s[2]:
                        if n not in pool1[s[1]]:
                            warn.append(f"{t['id']}: no province {s[1]}/{n}")
                            continue
                        geoms[t['id']] += take_pieces(pool1[s[1]][n])
                elif k == 'circle':
                    _, lat, lon, r = s
                    geoms[t['id']].append(pt(lat, lon).buffer(r * K, 24))
    # Phase 2: whole countries
    for t in land:
        for s in t['src']:
            if s[0] == 'c':
                used_iso.add(s[1])
                if s[1] in C.ADMIN1:
                    got = [p for n in pool1[s[1]] for p in take_pieces(pool1[s[1]][n])]
                else:
                    got = take_pieces(pool0.get(s[1], []))
                if not got and s[1] not in ('MAC', 'GIB', 'IMN', 'CYM', 'BMU', 'SPM'):
                    warn.append(f"{t['id']}: country {s[1]} empty/unknown")
                geoms[t['id']] += got
    # Phase 3: Voronoi shares
    vgroups = defaultdict(list)
    for t in land:
        for s in t['src']:
            if s[0] == 'v':
                vgroups[s[1]].append((t['id'], pt(*s[2])))
    for iso, members in vgroups.items():
        used_iso.add(iso)
        rest = pool0.get(iso, [])
        seeds = MultiPoint([p for _, p in members])
        cells = shapely.voronoi_polygons(seeds, extend_to=RECT.buffer(W), ordered=True)
        for p in list(rest):
            rp = p.representative_point()
            d = min(rp.distance(sp) for _, sp in members)
            if d > 15 * K:
                continue
            rest.remove(p)
            for (tid, sp), cell in zip(members, cells.geoms):
                part = p.intersection(cell)
                if not part.is_empty:
                    geoms[tid] += pieces(part)
    for iso, d in pool1.items():
        for n, lst in d.items():
            if lst and sum(p.area for p in lst) > 4:
                warn.append(f'unassigned province {iso}/{n}')

    # Union + resolve overlaps in list order
    terr = {}
    claimed = MultiPolygon()
    for t in land:
        g = shapely.make_valid(unary_union(geoms[t['id']])) if geoms[t['id']] else MultiPolygon()
        g = polys(g.difference(claimed))
        if g.is_empty:
            warn.append(f"{t['id']}: EMPTY")
        terr[t['id']] = g
        claimed = unary_union([claimed, g])

    # Decor land: unused countries + leftovers of used ones (small islands etc.)
    decor_parts = [g for iso, g in adm0.items() if iso not in used_iso and iso != 'ATA']
    for iso in used_iso:
        if iso not in C.ADMIN1:
            decor_parts += pool0.get(iso, [])
    for iso, d in pool1.items():
        for lst in d.values():
            decor_parts += lst
    decor = polys(unary_union(decor_parts).difference(claimed)) if decor_parts else MultiPolygon()

    # Grow tiny islands into the water around them
    for t in land:
        r = t.get('island') or 0
        if r <= 0:
            continue
        g = terr[t['id']]
        others = unary_union([terr[o] for o in terr if o != t['id']] + [decor])
        grown = unary_union([p.buffer(r * K, 12) for p in g.geoms] + [g])
        terr[t['id']] = polys(grown.difference(others))

    # Fill slivers between land sources (closing), give each to its best neighbour
    land_union = unary_union(list(terr.values()) + [decor])
    closed = land_union.buffer(1.2, 8).buffer(-1.2, 8)
    gaps = pieces(closed.difference(land_union))
    tree_ids = list(terr)
    for gp in gaps:
        if gp.area < 0.01:
            continue
        best, bl = None, 0
        for tid in tree_ids:
            g = terr[tid]
            if not g.envelope.intersects(gp.envelope.buffer(1)):
                continue
            l = g.boundary.intersection(gp.buffer(0.05)).length
            if l > bl:
                best, bl = tid, l
        if best:
            terr[best] = polys(unary_union([terr[best], gp]))
    land_union = unary_union(list(terr.values()) + [decor])

    # Sea zones
    ocean = polys(RECT.difference(land_union))
    seeds = [(sid, name, pt(*ll)) for sid, name, ll in C.SEA]
    allp, owner = [], []
    for i, (_, _, p) in enumerate(seeds):
        for dx in (0, -W, W):
            allp.append(affinity.translate(p, dx, 0))
            owner.append(i)
    cells = shapely.voronoi_polygons(MultiPoint(allp), extend_to=RECT.buffer(W * 1.2), ordered=True)
    raw = defaultdict(list)
    for cell, i in zip(cells.geoms, owner):
        c = cell.intersection(RECT)
        if not c.is_empty:
            raw[i].append(c)
    sea = {}
    cellu = {}
    for i, (sid, name, p) in enumerate(seeds):
        cellu[sid] = unary_union(raw[i])
        sea[sid] = polys(cellu[sid].intersection(ocean))
    given = defaultdict(list)
    received = defaultdict(list)

    def ptouch(a, b, tol=0.05):
        if a.distance(b) <= tol:
            return True
        return a.distance(affinity.translate(b, W, 0)) <= tol or a.distance(affinity.translate(b, -W, 0)) <= tol

    def plen(a, b, tol=0.3):
        """Length of shared boundary, wrap-aware."""
        tot = 0
        for dx in (0, W, -W):
            bb = affinity.translate(b, dx, 0) if dx else b
            if a.distance(bb) > tol:
                continue
            tot += a.boundary.intersection(bb.buffer(tol, 4)).length
        return tot

    # Keep the component holding each seed; orphan parts join a neighbour
    lake_parts = []
    for _ in range(4):
        orphans = []
        for sid, name, p in seeds:
            parts = pieces(sea[sid])
            if not parts:
                continue
            main_i = min(range(len(parts)), key=lambda j: parts[j].distance(p))
            comp = {main_i}
            grew = True
            while grew:
                grew = False
                for j, q in enumerate(parts):
                    if j not in comp and any(ptouch(q, parts[c], 0.05) for c in comp):
                        comp.add(j)
                        grew = True
            sea[sid] = MultiPolygon([parts[j] for j in sorted(comp)])
            orphans += [(sid, parts[j]) for j in range(len(parts)) if j not in comp]
        if not orphans:
            break
        for src, q in orphans:
            best, bl = None, 0
            for sid in sea:
                if sid == src:
                    continue
                l = plen(q, sea[sid], 0.1)
                if l > bl:
                    best, bl = sid, l
            given[src].append(q)
            if best:
                sea[best] = polys(unary_union([sea[best], q]))
                received[best].append(q)
            else:
                lake_parts.append(q)
    lake_parts = [q for q in lake_parts if q.area > 1]

    # Adjacency on full-detail shapes
    ids = [t['id'] for t in land] + [s[0] for s in seeds]
    geom = dict(terr)
    geom.update(sea)
    kind = {t['id']: 'land' for t in land}
    kind.update({s[0]: 'sea' for s in seeds})
    adj = defaultdict(set)
    from shapely.strtree import STRtree
    env_geoms, env_ids = [], []
    for i in ids:
        if geom[i].is_empty:
            continue
        for dx in (0, W, -W):
            env_geoms.append(affinity.translate(geom[i].envelope, dx, 0))
            env_ids.append(i)
    tree = STRtree(env_geoms)
    index = {i: n for n, i in enumerate(ids)}
    for a in ids:
        ga = geom[a]
        if ga.is_empty:
            continue
        cands = {env_ids[j] for j in tree.query(ga.envelope.buffer(1))}
        for b in cands:
            if index[b] <= index[a]:
                continue
            gb = geom[b]
            if kind[a] == 'land' and kind[b] == 'land':
                need = 2.0
            elif kind[a] == 'sea' and kind[b] == 'sea':
                need = 3.0
            else:
                need = 1.0
            if plen(ga, gb, 0.3) >= need:
                adj[a].add(b)
                adj[b].add(a)
    for a, b in list(C.LAND_LINKS) + list(C.SEA_LINKS):
        adj[a].add(b)
        adj[b].add(a)
    for a, b in C.NOT_ADJACENT:
        adj[a].discard(b)
        adj[b].discard(a)

    # Simplify the whole board as one coverage
    land_ids = [t['id'] for t in land]
    order = land_ids + ['__decor', '__ocean']
    ocean_all = polys(RECT.difference(unary_union([geom[i] for i in land_ids] + [decor])))
    coll = [geom[i] for i in land_ids] + [decor, ocean_all]
    try:
        simp = list(shapely.coverage_simplify(coll, 0.8))
    except Exception as e:  # pragma: no cover
        print('coverage_simplify failed, falling back:', e)
        simp = [g.simplify(0.8, preserve_topology=True) for g in coll]
    simp = dict(zip(order, simp))
    island_ids = {t['id'] for t in land if t.get('island') or any(s[0] == 'circle' for s in t['src'])}
    lake_union = unary_union(lake_parts) if lake_parts else MultiPolygon()
    for sid, name, p in seeds:
        disp = cellu[sid]
        if given[sid]:
            disp = disp.difference(unary_union(given[sid]).buffer(0.01))
        if received[sid]:
            disp = unary_union([disp] + received[sid])
        disp = disp.difference(lake_union).intersection(RECT)
        disp = polys(disp)
        # holes under land are irrelevant (land is drawn on top)
        disp = MultiPolygon([Polygon(q.exterior) for q in disp.geoms if q.area > 2])
        simp[sid] = disp.simplify(0.8, preserve_topology=True)
    simp['__lakes'] = MultiPolygon(lake_parts)

    def num(v):
        s = f'{v:.1f}'
        if s.endswith('.0'):
            s = s[:-2]
        if s.startswith('0.'):
            s = s[1:]
        elif s.startswith('-0.'):
            s = '-' + s[2:]
        if s == '-0':
            s = '0'
        return s

    def path(g, min_area=0.6):
        """SVG path with relative coordinates (rendered with fill-rule evenodd)."""
        from shapely.geometry.polygon import orient
        out = []
        for p in pieces(g):
            if p.area < min_area:
                continue
            p = orient(p, 1.0)
            for ring in [p.exterior] + list(p.interiors):
                cs = [(round(x, 1), round(y, 1)) for x, y in list(ring.coords)[:-1]]
                cs = [c for k, c in enumerate(cs) if k == 0 or c != cs[k - 1]]
                if len(cs) < 3:
                    continue
                seg = ['M' + num(cs[0][0]) + ',' + num(cs[0][1]) + 'l']
                px, py = cs[0]
                parts = []
                for x, y in cs[1:]:
                    dx, dy = round(x - px, 1), round(y - py, 1)
                    parts.append(num(dx) + (',' if dy >= 0 else '') + num(dy))
                    px, py = x, y
                seg.append(' '.join(parts).replace(' -', '-'))
                out.append(''.join(seg) + 'z')
        return ''.join(out)

    def center(g, seed=None):
        ps = [p for p in pieces(g) if p.area > 0.5]
        if not ps:
            return None
        if seed is not None and g.contains(seed):
            big = max(ps, key=lambda p: p.area)
            # keep the seed unless it hugs a coast
            if g.buffer(-6).contains(seed) or big.area < 4000:
                return [round(seed.x, 1), round(seed.y, 1)]
        big = max(ps, key=lambda p: p.area)
        c = polylabel(big, 0.5)
        return [round(c.x, 1), round(c.y, 1)]

    out_t = []
    for t in land:
        g = simp[t['id']]
        if g.is_empty:
            continue
        c = center(g)
        bb = g.bounds
        out_t.append(dict(id=t['id'], name=t['name'], type='land', ipc=t['ipc'], owner=t['owner'],
                          capital=t['capital'], factory=t['factory'], neutral=t['owner'] is None,
                          center=c, bbox=[round(v, 1) for v in bb], adj=sorted(adj[t['id']]),
                          path=path(g, 0.6 if t['id'] in island_ids else 2.5)))
    for sid, name, p in seeds:
        g = simp[sid]
        if g.is_empty:
            warn.append(f'sea {sid} EMPTY')
            continue
        c = center(geom[sid], p)
        bb = g.bounds
        out_t.append(dict(id=sid, name=name, type='sea', ipc=0, owner=None, center=c,
                          bbox=[round(v, 1) for v in bb], adj=sorted(adj[sid]), path=path(g)))
    known = {t['id'] for t in out_t}
    for t in out_t:
        t['adj'] = [a for a in t['adj'] if a in known]
        if not t['adj']:
            warn.append(f"{t['id']}: no neighbours")

    data = dict(
        format='tacticle-map', version=1, id='world1942', name='World 1942 (Tacticle original)', source='Tacticle',
        credit='Tacticle original map; geography from Natural Earth (public domain)',
        description='Tacticle original world map for spring 1942. Geometry from Natural Earth (public domain).',
        width=W, height=H, wrapX=True,
        powers=[dict(id=i, name=n, team=tm, color=col) for i, n, tm, col in C.POWERS],
        territories=out_t,
        canals=C.CANALS,
        decor=dict(land=path(simp['__decor'], 4), lakes=path(unary_union([simp['__lakes'], lakes.simplify(0.8)]), 4)),
    )
    outp = ROOT / 'maps' / 'world1942.json'
    outp.write_text(json.dumps(data, separators=(',', ':'), ensure_ascii=False))
    print(f'wrote {outp} ({outp.stat().st_size // 1024} KB), {len(out_t)} territories')
    for w in warn:
        print('WARN', w)
    (HERE / 'data').mkdir(exist_ok=True)
    rep = []
    for t in out_t:
        rep.append(f"{t['id']:<26} {t['type']:<4} {t['ipc']:>2}  " + ', '.join(t['adj']))
    (HERE / 'data' / 'world1942_report.txt').write_text('\n'.join(rep) + '\n')

    if preview:
        col = {p[0]: p[3] for p in C.POWERS}
        svg = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">',
               f'<rect width="{W}" height="{H}" fill="#9cc6dd"/>']
        for t in out_t:
            if t['type'] == 'sea':
                svg.append(f'<path d="{t["path"]}" fill="#a9d0e4" stroke="#5d8fb0" stroke-width=".6" fill-rule="evenodd"/>')
        for t in out_t:
            if t['type'] != 'sea':
                svg.append(f'<path d="{t["path"]}" fill="{col.get(t["owner"], "#e3dccb")}" stroke="#222" stroke-width=".6" fill-rule="evenodd"/>')
        svg.append(f'<path d="{data["decor"]["land"]}" fill="#cfc7b4" stroke="#777" stroke-width=".4" fill-rule="evenodd"/>')
        svg.append(f'<path d="{data["decor"]["lakes"]}" fill="#9cc6dd" stroke="#5d8fb0" stroke-width=".3" fill-rule="evenodd"/>')
        for t in out_t:
            x, y = t['center']
            svg.append(f'<text x="{x}" y="{y}" font-size="6" text-anchor="middle" font-family="sans-serif" '
                       f'fill="{"#123" if t["type"] == "sea" else "#000"}">{t["name"]}</text>')
        svg.append('</svg>')
        pathlib.Path(preview).write_text('\n'.join(svg))
        print('preview', preview)


if __name__ == '__main__':
    main()
