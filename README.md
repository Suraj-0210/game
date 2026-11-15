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
north-east. Connector roads join neighbouring areas (about 300 m each). Walk, fly, or use an AUTO STAND (press E) to jump to any area.
Layout and helpers: `public/bbsr_city.js`. Area plans: `public/bbsr_zones.js` (and `bbsr_plan.js` for the Old Town).
The streets, flyovers and buildings of every area are REAL (OpenStreetMap): `public/data/real_<area>.json`, made from a BBBike extract with
`python3 tools/make_real_zones.py city.osm.gz`. The Old Town uses `public/data/oldtown_osm.json` (`tools/fetch_osm.mjs`). If a data file is missing
the game falls back to the hand-drawn layout of that area. The places to discover are real named places (parks, bus stands, universities, flyovers).
Only areas near you are drawn. Each area has 4 places to discover for XP.
`?zone=<id>` (e.g. `?zone=patia`) still opens one area on its own, for testing.
Tests: `node tools/test_city.mjs`, `node tools/test_zones.mjs`, `node tools/test_missions.mjs`.
