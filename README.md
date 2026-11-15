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

## Areas of Bhubaneswar (zones)

Besides the Old Town there are six more walkable areas: Khandagiri, Baramunda, Jaydev Vihar, Vani Vihar, Rasulgarh and Patia / Infocity.
Each is its own 1 km zone with its own multiplayer room. Walk to the AUTO STAND in an area and press E to choose where to travel
(or open `?zone=<id>`, e.g. `?zone=patia`). Ids: oldtown, khandagiri, baramunda, jaydev, vanivihar, rasulgarh, patia.
Each area has 4 places to discover for XP. Plans are in `public/bbsr_zones.js`, extra meshes in `public/bbsr_zone_mesh.js`.
Test: `node tools/test_zones.mjs`.
