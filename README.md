# Island World + Bhubaneswar Old Town

    npm install
    npm start

* Island:                http://localhost:3000/
* Bhubaneswar Old Town:  http://localhost:3000/bhubaneswar
* Health check:          http://localhost:3000/health   (shows the live version and any missing file)

The two worlds share one server but are separate rooms: players in one never see players in the other.

## Real Bhubaneswar streets and buildings (optional, recommended)

Out of the box the Old Town street layout is hand-drawn from a few real landmark coordinates (Lingaraja Temple,
Bindusagar, Mahakala-Mahakali Temple). To use the real OpenStreetMap streets, building outlines and named temples:

    node tools/fetch_osm.mjs          # needs Node 18+ and internet; writes public/data/oldtown_osm.json

Restart the server. The game uses the file automatically (and shows "Map data (c) OpenStreetMap contributors").
Delete the file to go back to the hand-drawn layout. Keep the OpenStreetMap credit: the data is licensed ODbL.

## Old Town: quests, jobs and day/night

- `public/bbsr_missions.js`: five story quests, delivery jobs from Sibu at the chai adda, coins, XP and levels. Pure logic. Test it with `node tools/test_missions.mjs`.
- `public/bbsr_time.js`: the shared clock (30 real minutes per day, same for every player) and the sun path.
- `public/bbsr_night.js`: stars, moon, glowing lamps, the light pool, and the objective beacon.
- Progress is saved in the player's own browser (localStorage), so it is per device. Press **J** for the journal and **T** to look at another time of day (only you see that).

## One connected Bhubaneswar

All seven areas are in one world and one multiplayer room. The Old Town is at the centre; Baramunda is to its west, Khandagiri south of
Baramunda, Rasulgarh north of Baramunda, Jaydev Vihar north of the Old Town, Vani Vihar north of Jaydev Vihar and Patia / Infocity to the
north-east. The seven areas sit at their TRUE positions and distances (Vani Vihar is 6.5 km north of the Old Town), and everything between them is the real city: every street and building of the OpenStreetMap extract, cut into 500 m tiles (`public/data/city/`, made by `python3 tools/make_city_tiles.py city.osm.gz`) that stream in around you and are freed again when you leave (`bbsr_tiles.js`). Drive, walk, fly, or use an AUTO STAND (press E) to jump to any area.
Layout and helpers: `public/bbsr_city.js`. Area plans: `public/bbsr_zones.js` (and `bbsr_plan.js` for the Old Town).
The streets, flyovers and buildings of every area are REAL (OpenStreetMap): `public/data/real_<area>.json`, made from a BBBike extract with
`python3 tools/make_real_zones.py city.osm.gz`. The Old Town uses `public/data/oldtown_osm.json` (`tools/fetch_osm.mjs`). If a data file is missing
the game falls back to the hand-drawn layout of that area. The places to discover are real named places (parks, bus stands, universities, flyovers).
Only areas near you are drawn. Each area has 4 places to discover for XP.
`?zone=<id>` (e.g. `?zone=patia`) still opens one area on its own, for testing.
Tests: `node tools/test_city.mjs`, `node tools/test_zones.mjs`, `node tools/test_missions.mjs`.

## Cars and driving

Six detailed vehicles are built in code (no model files): hatchback, sedan, SUV, auto-rickshaw, city bus and truck, with glass, mirrors,
door lines, lamps, grille and spinning wheels (`public/bbsr_vehicles_kit.js`). Parked cars stand along the real roads (never at junctions)
and traffic keeps to the left on them (`public/bbsr_vehicles.js`); everything far away is drawn as instanced meshes.

- Stand next to a parked car and press **E** (or tap the prompt on a phone) to get in. **W/S** gas and brake/reverse, **A/D** steer,
  **Space** handbrake, **Shift** boost, **H** horn, **L** headlights (they also come on at night), **V** near/far camera, **E** to get out.
  On a phone the stick drives, Jump is the handbrake and Run is the boost.
- The car follows ramps, flyovers and the Khandagiri hill, stops at walls, buildings and other vehicles, and the traffic brakes for you.
- Other players see your car (kind and colour travel with the normal `move` message).
- Test without a browser: `node tools/test_vehicles.mjs`. Preview the models: open `/vehicles_showcase.html?all=1` (or `?k=sedan&v=side`).

## Roads, lanes and traffic lights

Roads are built from their real class (`public/bbsr_roads.js`), not as plain strips:

- **Cross-section:** 3.3–3.6 m lanes, a kerbed and planted median with shrubs and street lights on divided roads, edge lines, dashed
  lane lines, double yellow centre lines on wide undivided roads, footpaths with a kerb stripe. Trunk and primary roads are 2+2 lanes or
  more; side streets are 1+1.
- **Dual carriageways:** OpenStreetMap maps them as two one-way roads. They are paired automatically, each half gets 2–3 lanes, and the
  median between them is drawn (and kept free of houses). One-way roads are one-way for the traffic too.
- **Curves:** every road is smoothed through its mapped points (centripetal Catmull-Rom), so junctions stay put and bends are round. The
  traffic follows the same curve.
- **Signals:** the busiest junctions of main roads get signals with stop lines and zebra crossings, on a 46 s cycle (green, amber,
  all-red, then the cross road). The clock is the wall clock, so everyone sees the same colours. Traffic stops on red and on amber when
  it can. (The OpenStreetMap extract has only 12 signal nodes, none inside the six areas, so positions come from the road layout; if
  the map data has `highway=traffic_signals` nodes they are used: `tools/make_real_zones.py` exports them as `signals`.)
- **Streaming:** road and building meshes are split into 150–200 m chunks and parked cars into 240 m cells; the camera skips chunks it
  cannot see and chunks beyond the fog distance are not drawn (phones use a shorter distance). Whole areas are hidden when you are far
  away, and traffic exists only around you. At Jaydev Vihar this took a frame from about 1.5 M to 0.8 M triangles.
- Tests: `node tools/test_roads.mjs` (curves, lane layouts, chunks and signals on all six real areas) and `node tools/test_vehicles.mjs`
  (includes a red-light test).
