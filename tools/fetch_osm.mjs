// Downloads the real streets, building outlines and named temples of Bhubaneswar Old Town from OpenStreetMap
// and writes public/data/oldtown_osm.json. Run it once on your own computer:   node tools/fetch_osm.mjs
// Needs Node 18+ and an internet connection. Map data (c) OpenStreetMap contributors, ODbL: keep the credit.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN } from '../public/bbsr_plan.js';
import { convert } from './osm_convert.mjs';

const HALF = 520;   // metres around the game origin (the playable square is +-500 m)
const dLat = HALF / 110574, dLon = HALF / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
const bbox = [ORIGIN.lat - dLat, ORIGIN.lon - dLon, ORIGIN.lat + dLat, ORIGIN.lon + dLon].map((v) => v.toFixed(6)).join(',');
const query = `[out:json][timeout:90];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|pedestrian)$"](${bbox});
  way["building"](${bbox});
  node["amenity"="place_of_worship"]["name"](${bbox});
  way["amenity"="place_of_worship"]["name"](${bbox});
);
out geom;`;
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

let data = null;
for (const url of MIRRORS) {
  try {
    console.log('asking', url, '...');
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'island-world-bhubaneswar/1.0' }, body: 'data=' + encodeURIComponent(query) });
    if (!res.ok) { console.log('  answered', res.status); continue; }
    data = await res.json();
    break;
  } catch (e) { console.log('  failed:', e.message); }
}
if (!data) { console.error('Could not reach OpenStreetMap. Try again in a minute, or from another network.'); process.exit(1); }
const out = convert(data);
out.fetched = new Date().toISOString();
const here = path.dirname(fileURLToPath(import.meta.url)), file = path.join(here, '..', 'public', 'data', 'oldtown_osm.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`saved ${file}\n  roads: ${out.roads.length}, buildings: ${out.buildings.length}, named temples: ${out.temples.length}`);
if (out.buildings.length < 50) console.log('  (very few buildings: OpenStreetMap coverage of this area may be thin; the game falls back to the hand-drawn layout below 50)');
console.log('Restart the server and reload the game: the Old Town now uses the real map.');
