# Third-party notices

What's Up is a fork of [Overhead](https://github.com/alexlmiller/overhead) by Alex Miller
(MIT, see `LICENSE`): its adsb.fi selection logic, ADSB.lol route matching
(`web/live.mjs`, `web/core.mjs`, `web/routes.mjs`), aircraft type table and aircraft
silhouettes come from that project and its Vega port. Thank you, Overhead.

The MIT license covers this project's code, not third-party services, fonts, datasets,
trademarks or imagery.

## Bundled

- **Fonts** (`web/fonts/*.woff2`), all SIL Open Font License 1.1, subset to Latin with
  fontTools (Inter pinned to opsz 32, EB Garamond to wght 400-600). License texts sit beside
  each font (`web/fonts/*-OFL.txt`). Sources: [google/fonts](https://github.com/google/fonts/tree/main/ofl)
  (JetBrains Mono, Michroma, Barlow Condensed, B612 Mono, Orbitron, EB Garamond) and
  [rsms/inter](https://github.com/rsms/inter) (Inter). Used by: JetBrains Mono (Radar,
  shared screens), Michroma (Glass), Inter (Swiss, Atlas and others), Barlow Condensed
  (Blueprint, Sectional), B612 Mono (Cockpit), Orbitron (Synthwave), EB Garamond (Night Sky).
- **@mapbox/vector-tile 2.0.5 and pbf 4.0.2** (`web/mvt.js`, bundled by `vendor/`):
  BSD-3-Clause, © Mapbox.
- **Aircraft types** (`web/aircraft-types.mjs`): factual manufacturer/model data from
  [ICAO Doc 8643](https://doc8643.icao.int/), via Overhead.
- **Map tile fixture** (`tests/fixtures/*.pbf`): one OpenFreeMap tile, used only by tests.
  © OpenMapTiles © OpenStreetMap contributors (ODbL).

## Services used at runtime (no keys, nothing bundled)

| Service | Used for | Terms to keep in mind |
| --- | --- | --- |
| [adsb.fi](https://github.com/adsbfi/opendata) open data | aircraft positions, polled every 5 s | personal, non-commercial use with attribution; max 1 request/s. **Commercial distribution needs a different feed or permission.** Shown on screen. |
| [ADSB.lol](https://www.adsb.lol/) standing data | flight routes, ≤1 request per 5 s, cached | ODbL data; attribution shown on screen. |
| [OpenFreeMap](https://openfreemap.org/) vector tiles (OpenMapTiles schema) | the maps, fetched once per location and saved on the device: 4–9 tiles at z10 for every layout; the street-detail layouts add ~16 tiles at z12 and ~9 at z14 (buildings near home) | free, no key, commercial use OK; attribution required and shown: "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors". |
| [Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api) | ZIP/postcode or city search, time zone | free for non-commercial use under 10,000 calls/day; commercial use needs an Open-Meteo API subscription. Data from GeoNames (CC BY 4.0). |
| [US Census Geocoder](https://geocoding.geo.census.gov/) | US street addresses (one request per Search) | free, no key, public-domain US government service. |
| [Nominatim](https://nominatim.org/) (OpenStreetMap) | non-US street addresses and postcodes Open-Meteo misses | [usage policy](https://operations.osmfoundation.org/policies/nominatim/): at most 1 request/s, one request per explicit Search (never autocomplete), identifying User-Agent (set by the app bridge); ODbL, © OpenStreetMap contributors. Heavy or commercial use should move to a self-hosted or paid geocoder. |
| [Open-Meteo forecast API](https://open-meteo.com/) | time zone and elevation for a geocoded address, queried with coordinates rounded to 2 decimals | same non-commercial terms as Open-Meteo geocoding. |
| [GeoJS](https://www.geojs.io/) | first-launch approximate location from the IP address | free, no key, "no rate limits (yet)"; data from MaxMind GeoLite2 (attribution: "includes GeoLite2 data created by MaxMind"). |

Airline names identify flights and belong to their owners; no logos are bundled.
