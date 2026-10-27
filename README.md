# What's Up for Fire TV (Vega OS)

A radar-scope "what's flying over me" display for Fire TV (Vega OS), for anywhere.
Forked from [Overhead](https://github.com/alexlmiller/overhead) (MIT); see
`THIRD_PARTY_NOTICES.md`. Package id `com.bureauobscura.whatsup`.

* **Location.** First launch looks up an approximate location from the IP address (GeoJS:
  the Vega SDK has a geolocation interface, but only as native C++ IDL with no JS package)
  and shows "Watching the sky over <City, ST>" with *Change location*. Change location is an
  on-screen keyboard for the remote: type a ZIP/postcode or city, pick a result (Open-Meteo
  geocoding, which also gives the time zone). Saved on the device.
* **Precise location.** The IP guess is shown as "Is this right?" with the lookup's claimed
  accuracy and a warning that it is often off by 10+ miles. Change location also takes a full
  street address (press Search): US Census geocoder for US addresses, else Nominatim, and the
  match is shown back before it is used. *Adjust position* (Settings, or from the match) shows a
  close-up street map (OpenFreeMap z13) and the remote's arrows move the home dot ~50 m a press
  (faster when held); OK saves. Exact coordinates stay on the device: adsb.fi gets them rounded
  to 2 decimals (~1 km; the 15 NM query loses nothing), the time-zone lookup the same, the
  geocoders only the typed text, and map tiles only the z10/z13 tile area.
* **Settings** (press Select on the radar): location, alert radius 1–10 mi, distance mi/km
  (speed kt or km/h), altitude ft/m. Back closes.
* **Map.** Built on the device for any location: OpenMapTiles vector tiles from OpenFreeMap at
  z10 (4–9 tiles cover the 10-mile scope), decoded with @mapbox/vector-tile + pbf, keeping
  only water, rivers, motorway/trunk roads, runways and airport codes. The result is saved
  (localStorage, ~15–60 KB) and reused for 30 days, so tiles are fetched once per location.
* **Display.** Hero target (route, progress, altitude/vertical speed, speed, look-up
  direction and elevation, closest approach, type, registration), cargo tonight by operator
  (callsign prefixes worldwide; Amazon Air by owner), today's logbook, recently overhead,
  and a red takeover on squawk 7500/7600/7700. Airports come from the map data.

## Layout

* `web/` the page. `app.mjs` (screens, scope, remote navigation), `model.mjs` (enrichment,
  cargo, logbook, demo), `mapgen.mjs` (vector tiles → radar map), `place.mjs` (IP location,
  geocoding, settings), `live.mjs` (adsb.fi + ADSB.lol, from Overhead), `mvt.js` (bundled
  vector-tile decoder, rebuild with `npm run build:vendor`).
* `scripts/build-web.mjs` joins the modules into `assets/whatsup.js` (ES modules don't load
  from `file:///pkg/assets/`).
* `src/App.tsx` the Vega app: a full-screen WebView plus a fetch bridge (adsb.fi sends no CORS
  header) limited to the allow-listed GET URLs, and the remote's Back button (closes a screen,
  else leaves the app).

```sh
npm install
npm run test:web                 # route selection, cargo brands, place labels, map from a real tile
node tests/smoke-live.mjs 41.88 -87.63 30   # live APIs from Node at a lat/lon
npm run serve                    # http://127.0.0.1:8767/  (?demo=1, ?q=London, ?units=metric,
                                 #  ?screen=settings|welcome|adjust, ?screen=locate&typed=CHICAGO, ?reset=1)
node scripts/shot.mjs "http://127.0.0.1:8767/?q=Chicago" out.png 25000   # 1920x1080 via Chrome
npm run build:release            # -> build/armv7-release/whatsup_armv7.vpkg (and aarch64, x86_64)
vega run-app build/armv7-release/whatsup_armv7.vpkg com.bureauobscura.whatsup.main -d <fire-tv-ip>:5555
```

Before shipping beyond personal use: adsb.fi's open data is personal/non-commercial, and
Open-Meteo's free tier is non-commercial; see `THIRD_PARTY_NOTICES.md`.
