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
