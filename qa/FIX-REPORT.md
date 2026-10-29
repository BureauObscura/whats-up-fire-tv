# What's Up: pre-ship fix report

29 October 2026. Branch `preship-fixes` (worktree `~/overhead-tv/whatsup-fixes`), based on 57607c7. Local commits only; nothing is pushed.

This report contains no home address or coordinates. The test places are public: CVG, ORD, Denver Union Station, LHR, Chicago and Cincinnati city centres.

## Summary

| | |
| --- | --- |
| Commits | 23 (latest b45dd50) |
| Tests | 45 node + 4 jest, all passing; plane-drawing regression 48/48 (12 layouts × 2 zone modes × 15/50 mi) on the final build |
| Package guard | PASS: 156 files, all expected; no forbidden strings, `/Users/` paths or brand words |
| On the TV | Final build (5dc376d) upgrade-installed (data kept; logbook count carried over). the owner's settings checked by screenshot (`fixes/tv-settings-final.png`, address blacked out): Cincinnati, Atlas Satellite, 10 mi, Window 90°→180°, place names off, miles/feet, keep awake ON, chime quiet |
| Free RAM (stick) | 296 MB before; 316 MB after at 10 mi; 286 MB at 50 mi |

## Items

| ID | Status | How it was verified | Commit |
| --- | --- | --- | --- |
| 1 Consent before any request (P0-3) | Fixed | Desktop request and bridge logs: 0 requests before Agree, for both a fresh install and an upgrade. TV netstat: 0 connections to any service host for 75 s while the consent screen showed; 6 after Agree. Upgrade returns to the dashboard with settings kept. The IP guess is not saved until confirmed (P3-9). | 573f456 |
| 2 Privacy page and Erase (P1-3) | Fixed (placeholder text) | Desktop: themed in all 12 layouts; Cancel focused; Erase removes every whatsup.* key and restarts at the consent screen. The policy text and hosted URL (`PRIVACY_URL`) are waiting on the coordinator. | 573f456 |
| 3 Data minimization | Fixed | The feed, coverage probe and Open-Meteo use the 0.05° grid point, widened by 2.2 NM. Same plane sets at 4 public places (old vs new query fetched together). Tiles and satellite are computed from the snapped point; satellite capped at z14. | 5cfcb91 |
| 4 Keep awake (P1-2) | Fixed (video trick kept, per instructions) | Default OFF; engagement only when the switch is ON and the app is shown; loop has no Player Session. Jest tests updated. TV: the owner's ON kept. The screensaver was not tested, per the instructions. | 4db387f |
| 5 Feed etiquette (P1-4) | Fixed | Unit test for the back-off schedule, 429 + Retry-After, other 4xx, pause/resume. 60 s hold of the last good data; "Reconnecting in N s". | 33e2409 |
| 6 Credits and licenses (P1-5) | Fixed | `scripts/build-credits.mjs` → `licenses.txt` (94 photos, data, BSD/ISC/MIT texts, 515 shell packages, fonts + OFL). The build fails on GPL/LGPL/AGPL/MPL, an unknown license, a Reserved Font Name or "…". The EOX layer is the 2016 one, so the exact credit is used. No Reserved Font Names. Photo credits fixed (GLF6 "Myself .", USAF agency, SR22). | f7c4680 |
| 8 VoiceView | Fixed (not checked on the TV) | Chromium accessibility tree: focused controls read e.g. "Location, Cincinnati, OH"; dialogs named; picker labelled; live region announces the nearest plane. | befa264 |
| 9 Atlas Satellite at 50+ mi (P1) | Fixed | Desktop: imagery at 2, 10, 50 and 250 mi (z13→z7). TV: 50 mi shows imagery; returned to 10 mi and confirmed by screenshot. | 5cfcb91 |
| 10 Bridge and build hygiene | Fixed | Redirect target re-checked (all 10 endpoints tested live: none redirect); Content-Length cap; host-only logs; Nominatim cache (test); 800 ms / 3-character search; release from /tmp with prefix maps (0 `/Users` paths in the bundle and .so); URL hooks off in release; package guard. | 33e2409, 8d5e33a, befa264 |
| 11 Storage and flash wear | Fixed (IndexedDB not tried) | Logbook flushed every 5 min, on background and at the day change. Missing tile = failed build (test). Stale builds abort (test). Street map retries. Current radius + 1 kept. Quota eviction. 10 mi slot. Satellite not re-downloaded (0 tiles across 2 Settings changes). No "…". | 8d5e33a, 87068fb |
| 12 P2s | Fixed | Stuck cog (seed 281); Alert zone history; Adjust position (logbook, redraw, cancel, longitude); clock skew (test); stopped-feed writes; route ledger; logbook key order (test); time-zone fallback; tile cap and date line; Settings refit (P2-7). | 0392590, 8808e13, fa64b46 |
| 12 P3s | Mostly fixed | Date line, emergencies, impossible readings, text caps, keys, Departures, whole-word trim, unknown values, Glass list, stale day, map during a radius change, photo fallback, Night Sky trails, seed 211. | b16a79d, fa61761, befa264 |
| 13 Checks | Done, one finding fixed | Manifest category OK; no ad, analytics or crash SDKs; HTTPS only; no window.open. NEW: registered-owner names were shown as the operator. Fixed: never shown. Back on the dashboard exits the app (Vega default). | f84987e |

## Coordinator additions (abceead, c1587ac)

| Item | Status | How it was verified |
| --- | --- | --- |
| OSM credit (P2-8) | Fixed, still fading, no permanent credit | `scratch/credit/check.mjs`, all 12 layouts: on screen at full opacity, topmost, for the whole 5 s (timed in the page). Inside the 5% title-safe area: bottom edge at 513 px of 540, left/right from 86 to 874 px of 960 (limit 48–912). 12 px text. Always includes "© OpenMapTiles © OpenStreetMap contributors". Satellite credit on its own line (EOX exact, 12 px). If a screen is open, the credit waits; if a screen opens over it, it shows again for a full 5 s after Back (tested with Settings). Layouts can't draw over it. |
| Credits lines | Fixed | About carries the three map lines and the two adsb.lol lines exactly as given. |
| OpenFreeMap: User-Agent | Fixed | On the TV, every openfreemap.org request (tiles and TileJSON) goes through the app bridge, which sets `WhatsUp-FireTV/0.1 (Spacely Digital; spacelydigital@gmail.com)`. The WebView's own fetch is used only when there is no bridge (desktop tests). Styles, glyphs and sprites are never requested: the app draws its own maps from the vector tiles. |
| OpenFreeMap: parallel requests | Fixed: at most 4 | One app-wide limit of 4 for all openfreemap.org requests (unit test: 12 requests at once, peak 4). Each build fetches tiles one at a time, so normal peak is 1–2. |
| OpenFreeMap: back-off | Fixed | A 429, 403 or 5xx pauses all tile requests: 1 min, doubling up to 10 min. The build fails, and the saved map stays up (or the no-map state). The street map retries after 30 s, doubling to 5 min, only on layouts that draw it. Unit test. TileJSON is cached for 1 hour. |
| OpenFreeMap: size per download | Within limits, no zoom cap needed | Table below. The largest full map build (base + street detail) is 98 tiles / 13.0 MB (Chicago, 2–5 mi). Limits are 3,000 tiles or 50 MB. |
| Bundled map data | None | No .pbf, .mbtiles, .pmtiles or OSM extracts in the package. Only test fixtures under `tests/`, which are not packaged. No routes.csv. |
| adsb.lol cache | Fixed | Answers, misses and 404s cached 24 h. 15 min pause after a 429, 1 min after other errors. One request every 5 s. At most 800 cached lookups (the soonest-expiring go first). Unit tests. |
| adsb.lol text | Fixed | Airport codes must be 3–4 of A–Z 0–9. Names capped at 60, places at 40. Control and invisible characters removed (bidi overrides, zero-width), also from place names and feed callsigns. Older caches are re-checked on read. |
| Contact email | Confirmed | In the shipped package, `spacelydigital@gmail.com` appears only in the User-Agent (bundle) and in About (licenses text). |

### Map tiles per full build (base + street detail), measured live on 29 Oct 2026

| Radius | Chicago tiles | Chicago MB | Cincinnati tiles | Cincinnati MB |
| --- | --- | --- | --- | --- |
| 2 mi | 96 | 12.8 | 91 | 8.0 |
| 5 mi | 98 | 13.0 | 93 | 8.3 |
| 10 mi | 65 | 4.0 | 56 | 3.9 |
| 15 mi | 90 | 5.0 | 78 | 4.7 |
| 25 mi | 43 | 4.3 | 46 | 3.4 |
| 50 mi | 64 | 6.4 | 70 | 5.2 |
| 100 mi | 34 | 4.1 | 29 | 3.9 |
| 150 mi | 25 | 4.2 | 22 | 4.4 |
| 250 mi | 42 | 7.3 | 48 | 8.7 |

Satellite imagery (USGS/EOX) is a separate service, at most 48 tiles per view.

## Independent review (Max, on c1587ac) and fixes (5dc376d)

| Finding | Status |
| --- | --- |
| P0: a code comment hid every live plane's heading (icons, closest approach, Approaching, heading readouts). Introduced in b16a79d | Fixed, with a unit test. TV: heading "180° S", "Approaching", closest "1:01 · 1.2 mi". I scanned the diff for other code hidden behind a comment: none. |
| P1: Erase: the reload's flush wrote the logbook back | Fixed: storage is sealed before the reload, and map builds are cancelled. Headless end to end: when the page reloads, no whatsup.* data is stored. Bridge ids now start at a random point. |
| P1: privacy text is a placeholder; Erase popup wording | Wording fixed. The policy text and URL are still waiting on the coordinator. |
| P2: pause/resume double loop; resume ignored Retry-After | Fixed (unit test). |
| P2: logbook lost on every feed restart | Fixed: a restarted feed continues from the unsaved log. |
| P2: Settings 538–540 px tall | Fixed: 476–478 px, inside the title-safe area in all 12 layouts (TV screenshot). |
| P2: VoiceView labels went stale | Fixed: labels follow the values, and a changed value is read out. Plane announcements wait while a screen is open. |
| P2: IP guess saved by later saves | Fixed: an unconfirmed place is never stored. |
| P2: full storage, saves other than maps | Fixed: any save frees the saved maps (the newest base map is kept), then retries. |
| P2: keep-awake video has an audio track; the chime registers with media controls | Not fixed (native; needs on-device testing). |
| P3: Atlas photo fallback, stale street-map note after the time-zone refresh, retries on other layouts, TileJSON cache, tile numbers in logs, credits (copyright lines, Apache/CC BY texts, font names, EOX hyphen, project URL in About) | Fixed. |
| P3: date line in the circle zone and selection; "Reconnecting in N s" doesn't count down; coverage probe repeats on restart; redirect check after the fact; guard only in release.sh; Recently above on the TV clock; zone-edit merge | Not fixed; listed for after ship. |

## Not fixed (and why)

- **Units by country, US date order, 24 h clock by country.** Display changes that alter every layout's text widths; flagged for a decision.
- **Native P3s.** The silent-loop start/stop race, the WebView crash watchdog and the keep-awake audio focus need on-device lifecycle testing.
- **Remaining P3s.** Sectional graticule labels at high latitude, Departures flap animation, welcome card auto-close, trend sample age.
- **IndexedDB for maps.** Not tried on the stick. localStorage is kept, with eviction and two maps.

## Screenshots

- TV: `qa/fixes/tv-consent.png`, `tv-after-agree-10mi.png`, `tv-satellite-50mi.png`, `tv-back-to-10mi.png`, `tv-settings.png` (address blanked).
- Desktop, all 12 layouts: `qa/fixes/desktop/{consent,settings,privacy,about}-<layout>.png`.

## Build profiles and the store package (0edc31c … b45dd50)

- `WHATSUP_PROFILE=personal` (default; the TV) or `store`. **Both profiles use the same services**: adsb.fi positions (5/10/15 s), adsb.lol routes, Planespotters photos with "Photo © name / Planespotters.net" and the QR, EOX outside the US, USGS, OpenFreeMap, Open-Meteo, Census, Nominatim (non-US addresses), GeoJS. The store build differs only in its privacy policy. The profile switches (photos, eox, nominatim) remain, and the page CSP follows them.
- Store privacy policy v3 loaded exactly (sha256 8389468013d8d999cb0bfbd4b1b78f21c4a1b5db44c544db65e2a0479ca9eb74, 18,512 bytes, 299 lines). `check-package.mjs` fails a store package whose policy still contains "[" (now: [date], [month year] ×2, [web address]).
- Consent v2 (shown once more to upgraders), source lines on the search screen, Census only for U.S.-looking addresses, "City, State" search, search screen inside the title-safe area, credits additions (GeoNames, Census, GeoJS/MaxMind, USGS, EOxCloudless, FAA).
- Planespotters: one lookup per 1.5 s, misses 24 h in memory, 403 → 6 h pause, 429 → Retry-After; photos never cropped.
- Small fixes: Swiss ink (Adjust map), keep-awake video without audio track (not re-checked on the TV), satellite credit wraps, Sectional labels on the map.
- Capture (store build, desktop): nothing before Agree; after it only the policy's hosts (adsb.fi, adsb.lol routes, Planespotters API and images, OpenFreeMap, USGS, EOX, Open-Meteo, Census, Nominatim, GeoJS).
- Policy vs code: no gaps (every stored key listed; Erase clears all).

**Store package:** `~/overhead-tv/whatsup-fixes/build/store/whatsup_armv7-store.vpkg`, 1,232,625 bytes, sha256 24c62de82c980cc22dd3e3ec1e74aed2ff930eef2dc1bc9920464a205a832d7b. Built on the desktop only; not installed on the TV.

## Fuzz and reviews

| Run | Seeds | Result |
| --- | --- | --- |
| Personal build (5dc376d) | 500 | No XSS, JS errors or freezes; heap max 101 MB. Found: satellite credit clip, Sectional labels off-stage (both fixed in 22208a5). |
| Store build (b45dd50 policy, same code) | 500 | No XSS, JS errors or freezes; heap max 87 MB. Remaining cosmetic flags: a 120-character one-word hostile place name clips in Settings > Location; text scrolled out of view inside the About/Privacy boxes is reported as off-stage (clipped by the scroll box, not visible). Hostile names always show as plain text. |
| Independent review (Max) | | P0 heading regression and the P1/P2 items fixed in 5dc376d (see above). |
| Deep-review workflow (Opus) | 8 rounds | Ended early on the session limit (33 agents); one new item confirmed (Swiss Adjust ink, P3), fixed. |

## Needs the owner

1. Fill the policy placeholders ([date], [month year], [web address]); then set `PRIVACY_URL` so the Privacy screen shows its QR.
2. Optional: allow a test install on the TV to confirm keep-awake with the silent (no-audio) video.
3. Upload the store package once 1 is done. Nothing is pushed to GitHub.

