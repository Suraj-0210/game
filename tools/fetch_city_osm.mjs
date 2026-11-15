// Downloads real OpenStreetMap data for the whole of Bhubaneswar and for each area of the game. Run it once on your own computer:
//     node tools/fetch_city_osm.mjs
// It writes into public/data/:
//   city_overview_osm.json   the main roads of the city and where the areas really are (so the areas can be laid out as they really connect)
//   zone_<id>_osm.json       streets, buildings and named temples around the centre of each area (khandagiri, baramunda, jaydev, vanivihar, rasulgarh, patia)
// Needs Node 18+ and internet. Takes a few minutes (it waits between requests to be polite to the free server). Map data (c) OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from '../public/bbsr_plan.js';
import { convert, projector } from './osm_convert.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url)), OUT = path.join(HERE, '..', 'public', 'data');
fs.mkdirSync(OUT, { recursive: true });
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(query, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of MIRRORS) {
      try {
        console.log(`  ${label}: asking ${url.split('/')[2]} ...`);
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'island-world-bhubaneswar/1.0' }, body: 'data=' + encodeURIComponent(query) });
        if (!res.ok) { console.log('    answered', res.status); await sleep(4000); continue; }
        return await res.json();
      } catch (e) { console.log('    failed:', e.message); }
    }
    console.log('    waiting before trying again ...'); await sleep(15000);
  }
  return null;
}

// The areas: a rough guess of the real centre of each (lat, lon). The tool corrects these from the map where it can find the place by name.
const ZONES = {
  khandagiri: { lat: 20.2580, lon: 85.7770, names: 'Khandagiri' },
  baramunda: { lat: 20.2850, lon: 85.7940, names: 'Baramunda' },
  jaydev: { lat: 20.2985, lon: 85.8185, names: 'Jaydev Vihar|Jayadev Vihar' },
  vanivihar: { lat: 20.2975, lon: 85.8290, names: 'Vani Vihar|Bani Vihar' },
  rasulgarh: { lat: 20.2960, lon: 85.8545, names: 'Rasulgarh' },
  patia: { lat: 20.3490, lon: 85.8195, names: 'Patia' },
};
const BIG = [20.20, 85.74, 20.40, 85.92];   // south, west, north, east: all of Bhubaneswar

const result = { ok: [], failed: [] };
// ---- 1. the whole city: main roads and the places ----
console.log('1/2  the whole city (main roads and place names)');
const names = Object.values(ZONES).map((z) => z.names).join('|') + '|Lingaraj|Old Town|Master Canteen|Saheed Nagar|Satya Nagar|Kharavela Nagar';
const big = await ask(`[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"](${BIG.join(',')});
  node["place"~"^(suburb|neighbourhood|quarter|locality|town|village)$"]["name"~"${names}",i](${BIG.join(',')});
  node["railway"="station"](${BIG.join(',')});
  node["aeroway"="aerodrome"](${BIG.join(',')});
);
out geom;`, 'city');
const centres = {};
if (big) {
  const proj = projector(ORIGIN), roads = [], places = [];
  for (const el of big.elements) {
    const t = el.tags || {};
    if (el.type === 'way' && el.geometry && t.highway) {
      const pts = [];
      for (const g of el.geometry) { const p = proj(g.lat, g.lon), l = pts[pts.length - 1]; if (!l || Math.hypot(p.x - l[0], p.z - l[1]) >= 40) pts.push([Math.round(p.x), Math.round(p.z)]); }
      if (pts.length >= 2) roads.push({ name: t.name || '', ref: t.ref || '', kind: t.highway, pts });
    } else if (el.type === 'node') {
      const p = proj(el.lat, el.lon);
      places.push({ name: t.name || t['name:en'] || t.railway || t.aeroway, kind: t.place || t.railway || t.aeroway, lat: el.lat, lon: el.lon, x: Math.round(p.x), z: Math.round(p.z) });
    }
  }
  fs.writeFileSync(path.join(OUT, 'city_overview_osm.json'), JSON.stringify({ fetched: new Date().toISOString(), origin: ORIGIN, roads, places }));
  console.log(`  saved city_overview_osm.json: ${roads.length} main roads, ${places.length} places`);
  result.ok.push('city');
  for (const [id, z] of Object.entries(ZONES)) {      // find each area by name; prefer a suburb/neighbourhood over a village
    const re = new RegExp(z.names, 'i'), hit = places.filter((p) => re.test(p.name || '')).sort((a, b) => (/suburb|neighbourhood|quarter/.test(a.kind) ? 0 : 1) - (/suburb|neighbourhood|quarter/.test(b.kind) ? 0 : 1))[0];
    if (hit) { centres[id] = { lat: hit.lat, lon: hit.lon, found: hit.name }; console.log(`  ${id}: found "${hit.name}" on the map at ${hit.lat.toFixed(4)}, ${hit.lon.toFixed(4)}`); }
  }
} else { console.log('  could not get the city overview (the areas below still download using guessed centres)'); result.failed.push('city'); }

// ---- 2. each area ----
console.log('2/2  each area (about 1 km around its centre)');
const HALF = 520;
for (const [id, z] of Object.entries(ZONES)) {
  await sleep(3000);
  const c = centres[id] || { lat: z.lat, lon: z.lon, found: null };
  const dLat = HALF / 110574, dLon = HALF / (111320 * Math.cos((c.lat * Math.PI) / 180));
  const bbox = [c.lat - dLat, c.lon - dLon, c.lat + dLat, c.lon + dLon].map((v) => v.toFixed(6)).join(',');
  const data = await ask(`[out:json][timeout:120];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"](${bbox});
  way["building"](${bbox});
  node["amenity"="place_of_worship"]["name"](${bbox});
  way["amenity"="place_of_worship"]["name"](${bbox});
);
out geom;`, id);
  if (!data) { console.log(`  ${id}: FAILED (run the tool again later)`); result.failed.push(id); continue; }
  const out = convert(data, { origin: { lat: c.lat, lon: c.lon } });
  out.fetched = new Date().toISOString(); out.center = { lat: c.lat, lon: c.lon }; out.centreFound = c.found;
  fs.writeFileSync(path.join(OUT, `zone_${id}_osm.json`), JSON.stringify(out));
  console.log(`  saved zone_${id}_osm.json: roads ${out.roads.length}, buildings ${out.buildings.length}, named temples ${out.temples.length}${c.found ? '' : '  (centre was a guess)'}`);
  result.ok.push(id);
}
console.log(`\nDone. Saved: ${result.ok.join(', ') || 'nothing'}${result.failed.length ? '. Failed: ' + result.failed.join(', ') + ' (run again)' : ''}.`);
console.log('Next: git add public/data && git commit -m "real map data" && git push   (then tell Claude)');
