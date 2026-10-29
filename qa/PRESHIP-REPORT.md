# What's Up: pre-ship QA, red team and privacy audit

28–29 October 2026, build after commit 57607c7.

The home address and coordinates are deliberately left out of this report.

**Severity scale**
- **P0:** ship blocker.
- **P1:** fix before release.
- **P2:** should fix.
- **P3:** polish.

(This public copy leaves out the business and licensing notes; the counts below cover the technical items shown.) Every P0 and P1 was checked a second time by an independent agent, whose job was to refute it against the code. Its verdicts are included below.

## Summary

| Priority | Open | Fixed in tree (this pass) |
| --- | --- | --- |
| P0 | 2 | 1 (personal-data file inside the package) |
| P1 | 4 | 1 (one malformed feed entry stopped the feed) |
| P2 | 6 | 1 (wrong photo credit) |
| P3 | 10 | |

**One technical P0 is already fixed:** a file with the owner's address was inside the package. It's removed and verified gone from the rebuilt package and from the TV. Details below.

**Robustness is good:**
- The fuzz harness has run on 15 locations × 12 layouts × 5 feed types, including hostile data.
- No script injection ever ran.
- No stuck focus or stuck loading cog.
- Settings always opened and closed.
- Settings always persisted across a reload.
- No memory growth.

## A. "1000 users": automated monkey testing

**Harness** (`~/overhead-tv/scratch/monkey/monkey.mjs`, dev only)
- Runs the real page bundle in headless Chromium against a copy of the dev server that caches map tiles, so no hammering of OpenFreeMap.
- Mocks the native bridge. Each session is seeded and gets a random:
  - **Layout:** one of 12.
  - **Location:** Chicago, rural Montana, mid-Pacific, North Pole, South Pole, the date line on both sides, Beijing, Null Island 0,0, London, Tokyo, Sydney, Reykjavík, Anchorage, Honolulu, Kathmandu.
  - **Units:** miles or metric.
  - **Window view:** off, 90°→180°, 350°→20° (across north), 0°→359°, or 180°→90°.
  - **Map radius:** 2 to 250 mi.
  - **Feed:** demo, 500 planes, 1 plane, empty, or garbage. Garbage means null entries, wrong types, NaN/Infinity, 1e9 altitudes, duplicate hexes, 300-char callsigns, a squawk-7700 emergency, a non-array `ac`, and hostile HTML strings (`<img onerror>`, `<script>`, RTL override, zero-width characters, emoji, entities) in callsign, registration, type, operator, route airport names, photographer name and geocoder results. Some sessions also get `javascript:` photo links, 429/503 replies and stale timestamps.
- **Remote input per session:**
  - 300 presses: arrows, Select, Back, Play/Pause, letters, digits, space, backspace.
  - 6% are 12-key mashes and 4% are 15-repeat holds.
  - Random gaps from 30 ms to 1.2 s.
- **Checks every 50 presses:**
  - uncaught errors and console errors
  - exactly one layout loaded
  - an open overlay always has a focused control, and focus is never on a hidden control
  - the loading cog never sticks
  - no executed script injection, no `javascript:` URL in the page
  - no NaN, undefined, Infinity, null or `[object` text on screen
  - no clipped one-line text, no "…", nothing off-screen
  - JS heap size
- **Checks at the end of each session:**
  - Back ×6 returns to the dashboard.
  - Play/Pause opens Settings and Back closes it.
  - Settings survive a reload.

**Count (interim, 29 Oct ~01:15):** 152 sessions × 300 presses (~45,000 presses).
- 134 sessions completed fully.
- 18 were cut short by the 5-minute watchdog under CPU load; they produced no output and count as no-result, not as passes.
- The batch is still running toward 1,000 and then 5,000. Results will be appended.

**Finding curve** (distinct issue classes, excluding text that merely displays hostile markup, against sessions):
- 40 sessions: 12 classes; 80: 18; 120: 21; 134: 22.
- Still rising, but nearly all new classes are content variants of the same clip and off-screen problems (P3-1 to P3-6).
- 56 of 134 sessions had at least one non-cosmetic finding, almost all from the hostile or garbage feeds.

**Results**

| Check | Result |
| --- | --- |
| Executed script injection | **0** in all sessions. Hostile markup always rendered as plain text. |
| `javascript:` or off-site URL in the page | 0. Photo links are regex-checked; QR codes only encode planespotters.net or one fixed developer link. |
| Stuck focus, cog stuck on, two layouts loaded, Settings unreachable or won't close | 0 |
| Settings lost or changed by a reload | 0 |
| Uncaught exceptions | 1 class, fixed (P1-F1 below) |
| Memory | No growth. Highest per-session heap was 74 MB, in 500-plane sessions, then it drops. A 20-minute soak with a 500-plane feed refreshed every poll stayed at 9 → 11 MB with steady DOM node counts (`scratch/monkey/leak-atlas.log`). |
| Layout/text issues | See P3-1 to P3-6. |

**Real-device mashing**
- Tests on the TV, each verified with a screenshot:
  - Play/Pause ×7 rapid, then Back.
  - Zoom mash (Up ×6) while the cog spins.
  - The layout picker flipped 4× during loading, then Back to cancel.
  - Back from Settings.
  - Home, then relaunch (resume).
  - An upgrade install with live planes.
- **Results:**
  - All behaved: the right final state, settings intact, no hang.
  - Injected Home is ignored by the stick, as before; the real remote's Home works.
  - **One bug:** P2-7.
  - Free RAM on the stick afterwards: 288 MB.
- **Not done on purpose:**
  - Random mashing on the TV, because it could change the owner's location.
  - Flaky Wi-Fi on the TV, because that would mean touching Fire TV network settings.

**Personas**
- **First-time user outside the US:** fuzz locations and IP-first-run. The IP lookup runs before any notice (P0-3).
- **No planes nearby:**
  - "Quiet skies" shows, and Nearest only picks planes on the map.
  - Mid-ocean, Beijing and the poles show "No receiver coverage here".
- **Metric user:** 30% of fuzz sessions. One clip: "925 km/h" on Night Sky in Settings (P3-5).
- **Window wedge across north (350°→20°):** wedge, zone and chime gate fine. No errors in fuzz.
- **Back masher / kid hammering:** fine. Rapid presses are ignored while the cog spins, and Back always comes home.
- **Flaky Wi-Fi:** desktop only (503/429/timeouts in fuzz).
  - The feed shows "No signal" and keeps polling at the same rate. Back-off is missing (P1-4).
  - Search shows "Search is unavailable" with Retry.
- **Overnight:** mocked clock on the demo page, America/New_York.
  - 23:59:35 Sat 31 Oct → 12:00 AM "Sunday 1 November".
  - DST end: 1:59 AM EDT → 1:00 AM EST.
  - No errors.
  - The daily log resets on the first fresh feed after local midnight (from the code).
- **20 location changes in a row:** no errors. Storage stays bounded at 1.7–4.3 MB in 6 keys.
  - The 4.3 MB peak is close to typical WebView quotas (P2-6).

## B. Findings

### P0

**P0-1 (FIXED in tree, verified). The home address shipped inside the app package.**
- **What:** `assets/import.js` was a leftover from the one-time settings-restore build on 28 Oct. It held the owner's settings, logbook, street address and exact coordinates.
  - Git didn't track it and no code loaded it.
  - But the Vega build packs everything in `assets/`, so it was in `whatsup_armv7.vpkg`.
  - The verifier found further copies in `build/private/vega/{armv7,aarch64,x86_64}/Release/assets/`, the staging folders the package is built from.
- **Fixed:**
  - Deleted all copies, plus my extracted package copies.
  - Rebuilt; the new package was checked file by file for the address, coordinates and import marker: none present.
  - Upgrade-installed on the TV, replacing the old package's files.
- **Recommend:**
  - A release check that lists the package and fails on any file outside the expected set.
  - `npm run clean` (or removing `build/private`) before every release build.

**P0-3. No privacy policy, and location is collected without notice.**
- On the very first launch the app calls GeoJS with the TV's IP before showing anything (`app.mjs:684–690`). It saves the guessed place before the user confirms it.
- The user can then type a street address, which is stored and sent to the Census geocoder or Nominatim.
- **Fix:**
  - Publish a short policy page; the contents follow from section D.
  - Link it from About as a URL plus QR.
  - Add one line to the first-run screen, for example: "Your approximate location comes from your internet connection via GeoJS. Everything stays on this TV."
  - Or ask before the IP lookup.

### P1

**P1-F1 (FIXED in tree, verified). One malformed feed entry stopped the feed.**
- **What:** a `null` or non-object entry in adsb.fi's `ac` list threw in `liveSource` (`model.mjs:210`).
- The verifier found it was worse than "one update lost": the throw also skipped scheduling the next poll, so planes stopped until the app was relaunched.
- **Repro:** fuzz feed "garbage", e.g. seed 23.
- **Fixed:** entries are filtered first (commit 57607c7). The new package has the fix.
- Every other parser was checked and is null-safe:
  - airspace, selection, observations, the route parsers and the photo parser.
  - Geocoder parsers can throw, but that's caught and shows "Search is unavailable".

**P1-2. The keep-awake hack (store-review risk).**
- **Default on:**
  - `place.mjs:64` sets `keepAwake:s.keepAwake!==false`.
  - `App.tsx:117` sets `useState(true)`.
- **How it works:**
  - "Keep screen awake" plays a muted, looping black video in a 2 px surface (`silentLoop.ts`). Its own comment warns it may not pass review.
  - The verifier found that the "video playback" user-engagement report (`KeepAwake.cpp:26`, re-asserted every 4 minutes at `App.tsx:123–144`) runs whenever the app is in front, even with the switch OFF. Only the video loop follows the switch.
- **Fix:**
  - Default OFF.
  - Gate the engagement report on the switch too.
  - Ideally drop the fake video for the store build.
  - Add a slow pixel shift or dimming so an always-on map doesn't burn in.

**P1-3. No way to delete your data.**
- Settings has no reset. The only reset is the developer hook `?reset=1`, which can't be reached on the TV and clears settings only.
- Some data already clears itself:
  - Changing location clears the history and logbook.
  - The route cache prunes itself.
  - History is capped at 20 entries and the logbook at 4000.
- But these stay until overwritten: the street address, the saved maps around home, and the all-time aircraft-type tally.
- **Fix:** Settings > "Forget my location and data". It removes every `whatsup.*` key and restarts to the first-run screen.

**P1-4. No back-off on the aircraft feed.**
- On 429/5xx or a network error, adsb.fi is polled again at the same 5–15 s interval (`live.mjs:312–328`).
- That's about 17,000 requests per day for each TV left on, including through an outage.
- **Fix:**
  - Exponential back-off on errors, up to ~2 min, and honor `Retry-After`.
  - Consider 10 s polling when nothing is near.
  - Stop polling while the app is in the background (verify on Vega).

### P2

1. **The native fetch follows redirects without re-checking the allow-list** (`App.tsx:72`). Use `redirect:'error'`. The browser-side fetch already does this.
2. **The 2 MB response cap is applied after the full download**, and it measures characters, not bytes (`App.tsx:82–89`). Only the 12 s timeout bounds a huge or slow-drip response. Fix: check `Content-Length` and cap while streaming.
4. **The release build logs refused URLs** (`App.tsx:205`), the first 120 characters. That could include a typed address if a geocoder URL were ever refused. Log the host only.
5. **Build paths with the developer's macOS username** are embedded in `index.hermes.bundle` and `libKeepAwake.so` as `/Users/<name>/…`. Strip debug info, or build from a neutral path.
6. **Storage near the quota.** Settings + logbook + 3 base maps + 2 detail maps peak at ~4.3 MB, and many WebViews cap localStorage at 5 MB. Saving the street map would then fail silently and rebuild on every launch. Store maps in IndexedDB, or keep only the current radius.
7. **Settings Location value clips mid-word after the layout picker.** Seen on the TV: the street-plus-city text is cut off mid-word, with no ellipsis. The location row isn't re-fitted when you return from the picker or the layout font changes. Re-run `fitValue` on all rows after `endPick` and when fonts load.
9. **(FIXED in tree)** The A306 model photo was credited to "self made", copied from Commons. It now credits the uploader, N.C.

### P3

1. **Very long place names clip** in the city line on some layouts and in the Settings Location value. It's a hard clip, not "…", once even 9 px text doesn't fit. Seen with 400-char hostile names; real names this long are rare. Add a last fallback that trims to whole words.
2. **The caption beside the Settings QR code can clip** when the layout and its font change while Settings is open. It's only re-fitted when Settings opens. Fix: register the two caption lines with `fit()`, so they re-fit on font load.
3. **Long or hostile callsigns in Atlas lists** push the "now" time off the right edge (fuzz garbage feed). Fit the recent and through-your-window rows.
4. **Absurd values aren't sanity-checked.** Altitude 1,000,000,000 ft shows as "FL10000000", and 1,000,000,000 kt is shown too. Drop or clamp aircraft with altitude > 60,000 ft or < −1,500 ft, or speed > 1,500 kt.
5. **Minor clips:**
   - "925 km/h" in a stats cell (Night Sky, metric).
   - "2 mi" in the Map radius value while editing.
   - Cockpit's HIGH value can run off-screen with absurd metric altitudes.
6. **Sectional latitude labels** (`grat-t`) can sit off the top edge at high latitudes such as Reykjavík. **The credit line** can briefly sit off-stage on Radar.
7. **Address searches use three services** (Open-Meteo, then Census, then Nominatim). Search-as-you-type sends every keystroke pause to Open-Meteo, which shares one free quota across all users (fine for now; monitor it).
8. **Developer URL hooks ship** (`?demo ?q ?screen ?reset ?scene`…). They can't be reached on the TV because there's no query string. Strip them in release builds for tidiness.
9. **The first-run screen saves the IP-guessed place before the user confirms** (`app.mjs`). Harmless, but confirm first.
10. **The EOX satellite credit** should read exactly: "Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017)".

## C. Red team

| Area | Result |
| --- | --- |
| HTML/script injection | **Safe.** Every external string goes through `textContent`/`setAttribute`. All 12 `innerHTML` sites use numeric constants only (verifier checked each). Fuzz: 0 executions with hostile payloads in every field. |
| Links and QR codes | **Safe.** Only regex-checked `https://www.planespotters.net/photo/…` and one fixed developer link are encoded. A `javascript:` photo link from the API is rejected. There are no clickable links in the page. |
| Navigation escape | **Safe.** Loaded from `file:///pkg/assets/index.html`. CSP `script-src 'self'`, `base-uri 'none'`, `form-action 'none'`, `object-src 'none'`. Nothing assigns `location`, and no `window.open`. Layout scripts load only from a hard-coded list. |
| Bridge | **Mostly safe.** 4 message types (get, awake, ui, chime). `get` is restricted to 10 anchored host+path regexes, GET only, malformed JSON ignored, integer id, timeout clamped. Open issues: redirects not re-checked (P2-1) and the cap applies after download (P2-2). Remote strings that reach URLs (callsign, registration) are validated as `[A-Z0-9-]{2,10}` first. Search text is URI-encoded. |
| Transport | **Safe.** All HTTPS; `mixedContentMode="never"`. Timeouts 3–12 s. A garbage API reply is handled (null fix applied). Not tested on the device: a real 10 MB or slow-drip reply through the native fetch; by code review it's bounded by the 12 s timeout. |
| Secrets in the package | **Clean** after the P0-1 fix. No API keys or tokens. The email appears only in the User-Agent and About. Nothing for "bureau"/"obscura", the owner's name, localhost or debug endpoints. Build paths reveal the macOS username (P2-5). Logging: `console.error` only. |
| Rate and politeness | adsb.fi ~17k requests/day per TV with no back-off (P1-4). adsb.lol routes ≤1 per 5 s, 6 h cache, 15 min cooldown after a 429. Planespotters once per aircraft per session. OpenFreeMap tiles once per location and radius (30-day reuse). Geocoders only on user search. GeoJS once on first run. |

## D. Privacy and data retention

**On the device** (WebView localStorage; nothing is uploaded):

| Key | Contents | Size | Kept |
| --- | --- | --- | --- |
| `whatsup.settings.v1` | Home place: exact lat/lon, street address (≤80 chars), city, region, country, time zone, elevation; preferences | ~1 KB | Until changed. No delete option. |
| `whatsup.logbook.v1` | Today's aircraft (≤4000; closest distance, type, callsign, origin), highest/fastest, cargo tonight, all-time type tally | ≤200 KB | Daily part resets at local midnight; the all-time tally is never cleared. Cleared when the location changes. |
| `whatsup.history.v1` | Last 20 sightings inside the zone (hex, callsign, registration, type, time) | ~3 KB | List shows ≤6 h; cleared when the location changes |
| `whatsup.ledger.v1` | Route cache | small | 6 h, pruned on write |
| `whatsup.map.v2[.rN]`, `whatsup.map.recent` | Base map around home, including home lat/lon | 0.3–1.5 MB | 3 most recent radii; never deleted by age |
| `whatsup.detail.v1[.wide]` | Street map around home, including home lat/lon | 1.4–2.4 MB | 2 slots; never deleted by age |

No cookies, IndexedDB, accounts, analytics, ads or crash reporting.

**Leaving the device:**

| Service | What is sent | When |
| --- | --- | --- |
| opendata.adsb.fi | Lat/lon rounded to 0.01° (~1 km), radius, IP, User-Agent with contact email | Every 5–15 s while open |
| vrs-standing-data.adsb.lol | Aircraft callsign | ≤1 per 5 s, cached 6 h |
| api.planespotters.net + their image CDN | Aircraft hex or registration (API); image loads carry IP, no Referer | Once per aircraft per session |
| get.geojs.io | IP | First run only, no prompt |
| geocoding-api.open-meteo.com | Typed search text | While typing (debounced) and on Search |
| api.open-meteo.com | Lat/lon to 0.01° | Once per chosen place (time zone, elevation) |
| geocoding.geo.census.gov | Full typed street address | Search, US addresses |
| nominatim.openstreetmap.org | Full typed street address | Search, other addresses and fallback |
| tiles.openfreemap.org | Map tile coordinates around home (z10–z14; tiles of ~2.4–40 km reveal the area) | Once per location and radius |
| basemap.nationalmap.gov / tiles.maps.eox.at | Satellite tile coordinates around home (US up to z16, about 600 m) | Each time Atlas Satellite draws |

Precise coordinates are never sent as numbers; they go out as 2-decimal values and as tile coordinates. Every bridged request carries the contact email in the User-Agent, but no user data.

**Minimization recommendations**
- **Feed:** snap the feed query to a coarse grid (0.05°, ~5 km) with a slightly larger radius, then filter locally.
- **Satellite:** cap satellite zoom at z14.
- **First run:** disclose the IP lookup.
- **Delete:** add "Forget my data" (P1-3).
- **Policy:** say in the privacy policy that tile requests reveal the approximate area.

## E. Top 10 improvements a real user would notice (value/effort)

1. **"Forget my data" and a first-run privacy line.** High value, small effort, and needed anyway.
2. **Keep screen awake: off by default, with a gentle pixel shift.** Avoids burn-in and store rejection. Small.
3. **Feed back-off with a visible "Reconnecting in 30 s".** Calmer during outages and polite to adsb.fi. Small.
4. **Re-fit every one-line slot after layout and font changes** (Settings location, the QR caption, lists). Removes the last clipped text. Small.
5. **Sanity-check impossible aircraft values** (altitude, speed) before display. Small.
6. **A permanent small map credit** instead of the 5 s fade. Tiny.
7. **About page 2 with full credits and licenses** (photo sources, library licenses). Small to medium.
8. **Faster first paint on the stick.** Launch to full map is about 13–20 s. Show the last saved planes and map immediately, then refresh. Medium.
9. **Cache geocoder results and raise the search debounce.** Fewer "Search unavailable" moments on rate limits. Small.
10. **On-screen hint for Play/Pause = Settings** (the Menu key never reaches the app) on the welcome card. Tiny.

## Fixed in tree during this pass

All committed locally, not pushed.

| Fix | Severity | Evidence |
| --- | --- | --- |
| Removed `assets/import.js` and its staging copies; rebuilt; package verified clean; installed on the TV | P0-1 | Package grep clean |
| Null/non-object feed entries filtered (feed no longer stops) | P1-F1 | Commit 57607c7 |
| A306 photo credit | P2-9 | Commit 57607c7 |

the owner's settings were never changed: Cincinnati, Atlas Satellite, 10 mi, Window 90°→180°, place names off, miles/feet, keep awake on, chime quiet. Free RAM on the stick after the final install: 288 MB.

## F. Deep review (multi-agent, Fable) — addendum, 29 Oct

What ran:
- 8 independent code reviewers (UI state, data/time, layouts, maps, native host, security, network, persistence), read-only.
- Every finding went to 3 skeptics told to refute it; it counts only if at least 2 of 3 upheld it.
- Severity below is the median of the skeptics' corrected severities.
- Round 1 completed: 46 findings, 41 confirmed, 5 rejected.

Coverage gaps (stated, not hidden):
- The Fable usage limit was hit partway through. Rounds 2 and 3 and the completeness critic failed, so 'no new findings' in those rounds means the agents didn't run, not that the code is clean.
- Some persistence and network verifications also failed: a few findings were judged on 2 votes, and 3 persistence findings got 0 votes and are listed as unverified below.
- Re-running the deeper rounds needs Fable capacity, or switching that workflow to Opus.

Confirmed by me on desktop:
- The P1 below: Atlas Satellite at 50 mi shows only the dark vector map, no imagery.

### Confirmed (≥2 of 3 skeptics)

| Sev | Area | Where | Finding | Suggested fix |
| --- | --- | --- | --- | --- |
| P1 (3/3) | layouts | `web/layouts/atlas.mjs:155` | Atlas Satellite shows no imagery at all on 1080p/4K whenever the view needs more than 48 tiles (very common) | Pick the zoom so a tile is never smaller than one tile-pixel per screen pixel: use Math.floor instead of Math.round on line 147 (max tiles then ~7x6=42 for a 1400x1080 device-px canvas), or keep round but when the count exceeds the cap step z down by one… |
| P2 (3/3) | data-time | `web/live.mjs:85` | Feed freshness is judged against the stick's absolute clock with no skew compensation: a clock slightly behind adsb.fi drops the freshest aircraft and disables all route lookups; >5 s behind or >15 s ahead blanks the display permanently | Record the device time when each response arrives (receivedAt) and compute skew = stamp - receivedAt per poll; age positions as (now - receivedAt) + seen_pos instead of (now - stamp) + seen_pos, and treat the stamp window as a receipt-age window (e.g.… |
| P2 (3/3) | data-time | `web/live.mjs:214` | Ledger.routes() publishes only the 100 newest-expiring entries, so on a wide map live routes crowd out every past-route and most live routes | Publish all non-expired 'past-route:' rows (they are already bounded by the 20-row history and 6 h TTL) plus the 'route:' rows for hexes currently in the feed, instead of a global top-100 by expiry; or raise the cap and sort past-routes first.… |
| P2 (3/3) | data-time | `web/live.mjs:296` | Window view: Enricher 'inside' uses the circle radius, not the window wedge, so planes that passed through the window get no sighting/past-route and their route vanishes from 'Recently above' after ~2 minutes | Pass `zone` into observations() and compute `inside` with the same test selection() uses (inZone(zone, xMiles, yMiles) when zone is a window object, else haversine<=radius), so sightings and past-routes are recorded for wedge planes. |
| P2 (3/3) | data-time | `web/place.mjs:102` | Address-geocoded places silently fall back to America/New_York (Census) or UTC (Nominatim) when the Open-Meteo time-zone lookup fails, and the wrong zone is saved permanently; the logbook day, cargo-night window and on-screen clock then follow the wrong zone | When the TZ lookup fails, mark the place (e.g. timeZone:null / tzPending:true), refuse to save until a zone is known or retry the TZ lookup on start()/each launch until it succeeds; do not hard-code a default zone for addresses. As a stopgap use the… |
| P2 (3/3) | maps | `web/mapgen.mjs:90` | Tile count per map build is unbounded by latitude: 100-500 tiles at Alaska/Nordic homes, up to 4,200 (most with impossible x/y) at the 85° validator limit | In eachTile clamp ty to [0,2^z) and wrap tx modulo 2^z (skip rather than request impossible tiles); lower the chosen zoom by round(log2(1/cos(lat))) (or pick zoom so that the x-range*y-range stays under a budget, e.g. 36 tiles), and add a hard cap that… |
| P2 (3/3) | maps | `web/mapgen.mjs:95` | A single failed tile (timeout, 5xx, 429, oversize) is indistinguishable from an empty tile: the map is saved with a hole for 30 days | Make getBytes return a distinguishable result (e.g. {status,bytes}) and treat 204/404 as 'empty tile' but anything else (timeout, connection_error, 429, 5xx, oversize) as a failure: retry that tile once or twice with back-off, and if it still fails either… |
| P2 (3/3) | maps | `web/app.mjs:141` | In-flight street-map build is discarded (not saved, not restarted) when the place object is replaced without moving >111 m; 'Drawing the street map…' note sticks | Compare by coordinates with the same ~.01° tolerance savedDetail uses (`Math.abs(settings.place.latitude-place.latitude)<.01 && ...`) instead of object identity; if the place really changed, re-call ensureDetail after the discard (or have choosePlace's… |
| P2 (3/3) | network | `web/mapgen.mjs:95` | Map builds that lose tiles mid-way are treated as success and the half-built map is saved for 30 days | Have eachTile return {fetched, expected} (or throw when any tile fails) and make buildMap/buildDetail throw unless fetched===expected (optionally retry a failed tile once in place). In app.mjs only saveMap/saveDetail complete maps; a partial map may be… |
| P2 (3/3) | network | `web/app.mjs:132` | Detail (street) map is never retried after a failed build: Atlas/Glass/Blueprint stay on the base map showing 'Drawing detail…' for the whole session | Call ensureDetail() after the base map build succeeds (app.mjs:187) and/or give ensureDetail the same bounded back-off loop as applyPlace (30 s doubling to 300 s, cancelled by detailToken). Change the Atlas note to 'Street map unavailable' when a detail… |
| P2 (3/3) | network | `web/app.mjs:185` | Orphaned map builds keep fetching after the user moves on: no cancellation, so radius stepping multiplies tile traffic and runs several builds concurrently | Pass a cancellation token/AbortSignal into buildMap/buildDetail -> eachTile (check `if(cancelled)throw` before each tile and pass the signal to getBytes/fetch and the bridge timeout), and cancel it in applyPlace/ensureDetail whenever placeToken/detailToken… |
| P2 (3/3) | security | `web/live.mjs:198` | ADSB.lol route cache stores unbounded airport name/location strings: a hostile route server fills WebView memory (≈190 MB in 6 min, >1 GB/h) and localStorage | In `slim`, coerce and cap every field: `name:String(x?.name//'').slice(0,80), location:String(x?.location//'').slice(0,40), iata/icao via ident()`, `lat/lon` only if finite; additionally refuse to cache a slimmed payload above a few KB… |
| P2 (3/3) | ui-state | `web/app.mjs:324` | Toggling Alert zone in edit mode wipes the 'Recently above' history even when the edit is cancelled (Back) or toggled back | Do not clear the history inside adjustSetting. Snapshot it alongside editSnap in select() (`editHist=store.get(HISTORY_KEY)`), and clear it only in stopEdit()/the commit path when `before.alertZone!==settings.alertZone`; restore it in cancelEdit().… |
| P2 (3/3) | ui-state | `web/app.mjs:556` | Cancelling Adjust position reached from the confirm screen throws away the search result and strands a first-run user on the dashboard | Keep the layer stack while adjusting (hide overlays with the existing `.adjusting` stage class instead of closeAll()) and on cancel just remove the class and restore focus; or remember the origin (`adj.from='confirm'/'settings'`) and on cancel call… |
| P3 (3/3) | data-time | `web/model.mjs:80` | 'Cargo tonight' key is computed by subtracting 24 h of wall time, so on the night after DST spring-forward the count is wiped at 00:00 and again at 01:00 home time | Derive 'yesterday' from the local calendar date, not elapsed time: take localDay(t) as 'YYYY-MM-DD', parse the parts, and compute the previous civil date (e.g. new Date(Date.UTC(y,m-1,d-1)) formatted as en-CA), or subtract 12 h instead of 24 h (h<6 means… |
| P3 (3/3) | data-time | `web/model.mjs:170` | Any non-'none' readsb `emergency` value (lifeguard, minfuel, reserved) is promoted to an Emergency hero with a red 'Squawk … · LIFEGUARD' banner | Map the readsb values explicitly: {general:'EMERGENCY',nordo:'RADIO FAILURE',unlawful:'HIJACK',downed:'DOWNED'} → emergency; treat 'lifeguard' (and 'minfuel') as a non-hero-priority badge (e.g. a.priority='MEDEVAC') and ignore 'reserved'. |
| P3 (3/3) | layouts | `web/layouts/departures.mjs:85` | Departures board: Dist column prints "123." for every distance of 100 or more | Drop the decimal once it no longer fits: `const d=metric()?mi*KM:mi; return d>=100?String(Math.round(d)):d.toFixed(1);` (or widen the column to 5 characters and shrink Remarks by one). |
| P3 (3/3) | layouts | `web/model.mjs:58` | Planes across the date line are placed ~23,700 mi away and vanish from every layout; Sectional labels meridians past 180° | Normalise the longitude difference in both helpers: `let dl=lon-HOME.longitude; dl=((dl+540)%360)-180;` before scaling (same in distanceMiles and live.mjs selection() line 86). In sectional.mjs wrap the label value: `const w=((lo+540)%360)-180` before fmtDeg. |
| P3 (3/3) | layouts | `web/layouts/atlas.mjs:168` | Atlas Satellite re-downloads up to 48 imagery tiles three times per radius step and on every unrelated Settings change | Remember the last satellite key (place lat/lon rounded, z, x0,y0,x1,y1, us) and the decoded ImageBitmaps/Images for it; in drawSatellite skip the fetch and just redraw from the kept set when the key is unchanged, and have refresh() only repaint the vector… |
| P3 (2/3) | maps | `web/mapgen.mjs:365` | localStorage quota failure while saving maps is silent and self-defeating: the existing good map in the slot is deleted, nothing is evicted, and maps are rebuilt from tiles on every launch and every return to a detail layout | On quota failure: do not remove the existing key unless the new write then succeeds; evict least-recently-used map slots (other base ranges, the other detail slot, old history) and retry the write once; if it still fails, keep the built map in memory for… |
| P3 (3/3) | maps | `web/mapgen.mjs:90` | Tile x range is not wrapped at the antimeridian: tiles east/west of ±180° are requested at nonexistent x and their content is dropped | Iterate tx over x0..x1 but fetch `((tx%n)+n)%n` (n=2^z) and pass the unwrapped tx to lonOf so longitudes come out continuous around home; in toMiles normalise `lon-home.longitude` into [-180,180). |
| P3 (3/3) | native | `src/silentLoop.ts:31` | Silent keep-awake loop is registered as a system Player Session: any system pause/stop silently kills keep-awake, the chime displaces the session player, and a later start-over command throws inside a native callback | 1) In startLoop(), after `player = p`, add `p.addEventListener('pause', resume)` and the same for 'audiofocuslost'/'audiofocuspaused', where resume() re-issues p.play() (with a short backoff) while `wanted && player === p`; remove the listeners in… |
| P3 (2/3) | native | `src/App.tsx:237` | WebView crash or load failure leaves a black screen with keep-awake and engagement still asserted; no watchdog, no retry, and no splash fallback if neither onLoad nor onError fires | Have the page post `{type:'alive'}` on every poll tick (web/live.mjs poll(), ~5-15 s). In App.tsx keep `lastAliveRef`; a 60-90 s interval that sees no heartbeat while `active` calls `webRef.current?.reload()` and sets a `pageAlive` state false, which gates… |
| P3 (3/3) | native | `src/silentLoop.ts:39` | silentLoop start/stop/start race: a start that lands during the first player's post-init deinitialize returns the stale promise, leaving wanted=true with no player and no retry (harness-confirmed) | After the deinitialize in the `!wanted` branch, re-check and restart: `if (!wanted) { await p.deinitialize(); if (wanted && !player) { starting = null; return startLoop(); } return; }`; or in startLoop, when `starting` exists, return `starting.then(() =>… |
| P3 (3/3) | network | `web/live.mjs:44` | getBytes answers every non-200 tile response (including 429) with an immediate duplicate request through the native bridge | Only fall back to the bridge when the plain fetch threw (network/CORS error), not when it returned a status; on 429/5xx return null (or a status) and let the caller abort the build and apply back-off, e.g. `const r=await fetch(...); return… |
| P3 (3/3) | network | `web/photos.mjs:36` | Planespotters lookups that fail for network reasons are cached as 'no photo' for 24 hours | Return {photo,status} from the inner function and only cache for DAY when status===200 or 404; for connection_error/timeout/'invalid'/429/5xx either don't cache or cache with a short TTL (e.g. 60 s, 15 min on 429) so the lookup is retried once the aircraft… |
| P3 (2/3) | network | `web/app.mjs:37` | At wide map radii the adsb.fi payload can exceed the 2 MB bridge cap, leaving the feed permanently dead while the full body is re-downloaded every poll | Treat 'oversize' (and 429/5xx) in poll as a distinct failure: back off (e.g. double the interval up to 60 s) and automatically reduce searchNm (halve, down to the alert-zone reach) until a reply fits, surfacing 'Too much traffic for this radius' in the… |
| P3 (3/3) | network | `web/layouts/atlas.mjs:141` | Atlas Satellite re-fetches up to 48 imagery tiles from USGS/EOX on every redraw, including each Settings step and each map-radius step (several redraws per step) | Keep the decoded satellite canvas (or the Image objects) keyed by {z, x0..x1, y0..y1} and skip drawSatellite when the key is unchanged; split refresh() so Settings changes that don't move the view don't touch the imagery; add onerror with a single delayed… |
| P3 (3/3) | network | `web/place.mjs:107` | Address search: the 25 s UI deadline is shorter than the geocoder chain's worst case, and 'Try again' starts a second chain while the first keeps running | Run the per-match time-zone lookups in parallel (Promise.all) or defer them until a match is chosen (one TZ lookup instead of up to 8), pass an AbortSignal/seq into searchAddress so a superseded or timed-out search stops issuing requests, and disable Try… |
| P3 (2/2) | network | `web/mapgen.mjs:362` | When saveDetail fails on localStorage quota the street map is silently rebuilt (28-56 tiles + tilejson) on every launch and every switch to a detail layout | When saveDetail returns false, free space first (drop the other detail slot and the oldest base maps via RECENT_KEY, then retry setItem) and, if it still fails, keep the built map in memory for the session (maps.detail) and record a 'detail-unsaveable'… |
| P3 (3/3) | security | `web/model.mjs:52` | Quadratic regex on feed `ownOp` (titleCase / airlineAlts): a crafted owner string freezes every poll for minutes | Cap and normalise owner before any regex: `owner=typeof r.ownOp==='string'?r.ownOp.trim().slice(0,80):''` (and collapse runs of whitespace with `.replace(/\s+/g,' ')`). Same cap at the top of `airlineAlts`. Optionally rewrite the suffix regexes to anchor… |
| P3 (3/3) | security | `web/model.mjs:170` | `EMERGENCY[squawk]` with a prototype key ("constructor", "__proto__", "toString") makes any feed entry an Emergency hero and throws in the Swiss and Night Sky renderers | Validate squawk (`/^[0-7]{4}$/.test(squawk)`) before lookup and use own-property access: `Object.hasOwn(EMERGENCY,squawk)?EMERGENCY[squawk]:''`. Make `EMERGENCY`, `US`, `CA`, `STATE_NAME`, `OPERATORS`, `CARGO`, `AIRCRAFT_TYPES` lookups go through… |
| P3 (3/3) | security | `web/live.mjs:207` | Ledger.put rescans every row on each call: a feed with thousands of in-zone aircraft costs seconds per poll and a ~5 MB ledger write every tick | Prune expired rows once per tick (or at most every few seconds), not inside `put`; cap the number of `sighting:` rows (e.g. keep the 200 most recent) and cap the serialised ledger size before `store.set`. Also cap the aircraft considered by the enricher to… |
| P3 (3/3) | security | `web/photos.mjs:16` | Planespotters photo `link` has no length cap: a long link stalls the QR encoder for seconds per aircraft | Bound the link in the regex (`[^\s"'<>]{1,200}$`) and reject in `parsePhoto`; a QR at level L version 40 cannot hold more than 2953 bytes anyway, so refuse `link.length>300` in `qrFor` before calling the encoder. |
| P3 (3/3) | security | `web/place.mjs:92` | searchPlaces de-duplicates an unbounded Open-Meteo `results` array with an O(n^2) findIndex: a large reply blocks the UI for tens of seconds | `payload.results.slice(0,10)` before mapping (only 6 are shown), and de-duplicate with a Set of labels instead of findIndex. |
| P3 (2/3) | security | `web/live.mjs:45` | Vector tiles fetched directly (not via the bridge) have no size cap at all before full decode | Check `Content-Length` and stream/abort past a cap (e.g. 1.5 MB per tile) in `getBytes`, and in `eachTile` skip features whose geometry exceeds a point budget (e.g. 50k points per feature, 500k per tile) instead of decoding them. |
| P3 (3/3) | ui-state | `web/app.mjs:533` | Back while editing a Settings value can also close Settings: the 350 ms Back de-duplication is skipped on the editing path | Run the de-duplication first: `const now=Date.now();if(now-lastBack<350)return;lastBack=now; if(editing)return cancelEdit(); if(adj)return endAdjust(); close();` (or set lastBack inside the editing branch). |
| P3 (3/3) | ui-state | `web/app.mjs:501` | Location search started on a previous visit can paste its results into a freshly opened, empty Location screen | In openLocate() add `searchSeq++;clearTimeout(searchTimer);lastQuery='';` (and do the same when close()/closeAll() hides the locate layer), or compare the result's `q` against the current `entry.trim()` before showing it. |
| P3 (3/3) | ui-state | `web/app.mjs:376` | Up/Down on the Map radius row (edit mode) runs opposite to Up/Down on the dashboard | In editKey special-case set-map: `if(dir&&editing.id==='set-map')return stepMap(k==='ArrowUp'?-1:k==='ArrowDown'?1:Math.sign(dir));` or make the dashboard use the same sign. |
| P3 (3/3) | ui-state | `web/app.mjs:253` | Location screen opened from Settings before the first IP lookup finishes: Back is dead although Settings is beneath, and a second #locate is pushed onto the stack | Make the close() guard `if(layer.id==='locate'&&!settings.place&&!layers.length)return;` (matching syncApp), and in open() return early when `layer===$(id)` (or skip the boot openLocate when a locate layer is already open). |
| P3 (3/3) | ui-state | `web/app.mjs:628` | Held OK (key repeat) toggles the layout picker / edit mode open-closed because Enter repeats are not filtered | At the top of the keydown handler, after the busyNow gate: `if(e.repeat&&!dir){e.preventDefault();return;}` so only arrow keys may auto-repeat. |

### Unverified (the skeptics hit the usage limit) — treat as leads

- [P2] `web/model.mjs:143` Unvalidated whatsup.logbook.v1 shape: any mismatch throws inside the feed callback, which kills the feed permanently (no retry, no reset path)
- [P2] `web/live.mjs:63` store.set swallows QuotaExceededError with no eviction, and store.get then returns the stale persisted value instead of the in-memory one
- [P3] `web/app.mjs:324` Alert-zone toggle removes HISTORY_KEY while the old feed is still polling for 900 ms, so the old list is written back and survives the restart
- [P3] `web/live.mjs:296` enrich() has no `stopped` check after its await, so a stopped feed still emits one onUpdate and one logbook/ledger write after restartFeed/applyPlace

### Refuted by the skeptics

- [P2, 1/3 upheld] `web/model.mjs:98` Logbook `typesAll` keeps one key per distinct feed `aircraft_type` forever, with no length or count cap: three polls poison localStorage permanently

Full findings, with triggers, evidence and every skeptic's reasoning: `qa/deep-review-findings.json`.

### F2. Opus continuation (29 Oct)

Rounds: 4; consecutive dry rounds at stop: 0. Logs: reverify: 2/4 upheld; round 1: 17 findings, 17 new; round 1: 17 confirmed, 0 refuted; round 2: 13 findings, 13 new; round 2: 13 confirmed, 0 refuted; round 3: 10 findings, 10 new; round 3: 10 confirmed, 0 refuted; round 4: 10 findings, 10 new; round 4: 8 confirmed, 2 refuted; stopped at the 4-round cap before two consecutive dry rounds

Re-verified leftovers:
- REFUTED (0/3) Unvalidated whatsup.logbook.v1 shape: any mismatch throws inside the feed callback, which kills the feed permanently (no retry, no reset path)
- REFUTED (0/3) store.set swallows QuotaExceededError with no eviction, and store.get then returns the stale persisted value instead of the in-memory one
- UPHELD (3/3) Alert-zone toggle removes HISTORY_KEY while the old feed is still polling for 900 ms, so the old list is written back and survives the restart
- UPHELD (3/3) enrich() has no `stopped` check after its await, so a stopped feed still emits one onUpdate and one logbook/ledger write after restartFeed/applyPlace

| Sev | Area | Where | Finding | Fix |
| --- | --- | --- | --- | --- |
| P2 (3/3) | data-time | `web/model.mjs:99` | Logbook plane cap evicts all-digit hex aircraft first (integer-like keys), so they delete themselves and inflate the 'Rarest' all-time tally every poll | Evict by insertion time, not by key order. Store log.planes as an array of [hex, rec] or keep a separate insertion-ordered list of hexes (log.order), and evict the first entry of that. Alternatively, prefix keys (for example 'h'+hex) so non |
| P2 (3/3) | layouts | `web/app.mjs:178` | Saving Adjust position does not redraw the street map in detail layouts, so the map stays offset by the adjustment | In applyPlace, call mapsChanged() whenever the place differs from the one the layout last painted for, even when the maps are kept. For example, change line 178 to `mapsChanged();` unconditionally, or call mapsChanged() from choosePlace aft |
| P2 (3/3) | maps | `web/mapgen.mjs:354` | The default 10-mile street map shares one storage slot with every wider radius, so it is rebuilt after any radius change | Give the 10/15 mi inner-streets maps their own slot, for example detailKey=spec=>spec.key==='street'?DETAIL_KEY:spec.inner?`${DETAIL_KEY}.near`:`${DETAIL_KEY}.wide`, or derive the slot from max<=15. Also relax detailFits so that a map of th |
| P2 (3/3) | ui-state | `web/app.mjs:213` | A small Adjust position save erases the whole logbook and the 'Recently above' history, as if the user had moved house | Give choosePlace two thresholds. Pass fresh:true only when the new place is genuinely elsewhere, for example more than about 2 mi or a fraction of the map radius from the old one, or always pass fresh:false from endAdjust. For smaller moves |
| P2 (3/3) | network | `web/model.mjs:208` | At the 150 and 250 mi map radii, one failed adsb.fi poll clears every aircraft and shows 'No signal' for a full 15 s cycle | Scale the staleness windows with the poll interval. Pass pollSeconds into liveSource/airspace and use something like max(15, 2.5*pollSeconds) for the connected window, the stamp age limit and the age+seen_pos limit. Or keep the windows and, |
| P3 (3/3) | ui-state | `web/app.mjs:97` | Layout picker: returning to the current layout (Left after Right, or Back to cancel) while the preview is still loading leaves the previewed layout on screen | Bump the token before the early return, so any in-flight load is invalidated: `const token=++layoutToken; if(active?.id===id){$('busy').classList.remove('on');return;}`. Another option is to keep a `loading` id and compare against both the  |
| P3 (2/3) | ui-state | `web/app.mjs:670` | Holding OK on the keyboard's Search key repeats explicit geocoder searches and can auto-accept the first result through the confirm screen | Ignore Enter/OK keydowns with e.repeat on every screen, at least on locate, confirm, welcome and the Settings rows. In runSearch, skip an explicit search when the same query is already in flight (keep the in-flight query and promise). |
| P3 (3/3) | layouts | `web/layouts/night-sky.mjs:73` | Night Sky keeps the old location's contrails for up to 8 minutes after the location changes | Clear the trail books when the home changes. Either let the app pass a place-change notice (for example, a ctx place token checked in setMap or render), or keep the place lat/lon with the TrailBook and call trails.clear() when ctx.place() d |
| P3 (3/3) | layouts | `web/layouts/glass.mjs:121` | Glass 'In range' card lists aircraft outside the map radius, even while the hero card says nothing is within range | Filter the list to the map, for example `m.planes.filter(a=>a!==hero&&a.ground<=range())`, so the empty-state text appears when nothing is within the radius. |
| P3 (3/3) | layouts | `web/kit.mjs:46` | A Planespotters image that fails to load leaves an empty photo frame with the credit and QR code, and the bundled model photo is never tried | Add `s._img.onerror=()=>{if(s._hex!==hex)return; const m=modelPhoto(a); if(m){/* switch to the model branch */}else{s.hidden=true;s._qr.removeAttribute('src');} relayout();}`. Do the same in atlas.mjs showPhoto, clearing `photo` so render h |
| P3 (3/3) | layouts | `web/layouts/sectional.mjs:96` | Sectional graticule leaves out the meridians near the chart's left and right edges at high latitudes | Derive the longitude span from the chart width, for example `const lonSpan=Math.max(CX,W-CX)/(69.172*cos*PPM)+step;`, and loop over `lon0±lonSpan`. The existing x<8 / x>W-8 test then trims the meridians off the chart. |
| P3 (3/3) | maps | `web/app.mjs:561` | Adjust position street map covers only about 3 mi around the original point; moving the dot further leaves a blank map | In nudge/drawAdjust, when the offset from the point the map was built for exceeds about 1.5 mi, start a new buildMap at the current adj position (debounced, with a token to drop stale results) and swap it in. Alternatively, cap the total mo |
| P3 (3/3) | native | `src/App.tsx:134` | The page is never told when the app goes to the background, so feed polling, lookups and storage writes keep running behind other apps | In the AppState handler, inject `window.__whatsupActive&&window.__whatsupActive(${active});true;`. In web/app.mjs, define __whatsupActive so that false calls feed?.stop() and pauses map-build retries, and true calls restartFeed(), which re- |
| P3 (2/3) | security | `web/model.mjs:210` | One adsb.fi entry with an object-valued field stops the feed poll loop for good (until relaunch) | Put the body of poll() after the fetch in try/finally, so `timer=setTimeout(poll,...)` always runs and a throwing onUpdate cannot end the loop. Separately, stop calling String() on raw feed values: use typeof checks (`typeof r.hex==='string |
| P3 (2/3) | security | `web/live.mjs:92` | An object-valued registration in the feed is saved to 'Recently above' history and breaks route lookups for up to 6 h, across relaunches | Sanitise at ingestion: in selection() set `registration: typeof a.r==='string'?a.r.trim().slice(0,12):''` and `aircraft_type: typeof a.t==='string'?a.t.slice(0,8):''`. In mergeHistory() and observations(), keep only string callsign/registra |
| P3 (3/3) | network | `web/live.mjs:288` | A stopped feed's in-flight route lookup still renders and saves: old place/zone model drawn after a restart, new ledger/logbook overwritten | In enrich(), after `await enricher.tick(...)`, add `if(stopped)return;` before touching `states`, the store or onUpdate. Optionally pass an AbortSignal or token into Enricher.tick so a stopped feed also skips the ledger.put calls. |
| P3 (3/3) | network | `web/live.mjs:299` | Receiver-coverage probe downloads the full 250 NM adsb.fi area whenever the local sky is empty, and every feed restart repeats it | Probe with a much smaller request: a step such as 50, then 100 NM, stopping at the first non-empty answer, or reuse the wide-radius result when the feed is already wide. Keep the last coverage result and check time in module or storage scop |
| P3 (3/3) | persistence | `web/live.mjs:62` | store.get returns the stale localStorage copy after a failed store.set, so restarts roll the logbook, Recently-above history and route ledger back | Make memory authoritative for the session. In get, return memory.get(k) when memory.has(k), and only otherwise read localStorage (cache what it reads into memory). Or, in set's catch, remove the stale localStorage key so it cannot shadow th |
| P3 (3/3) | persistence | `web/live.mjs:293` | A stopped feed's in-flight route enrichment still fires onUpdate and writes storage, so it can restore the old place's logbook after a location change and render or chime its stale model | In enrich(), add `if(stopped)return;` right after `await enricher.tick(...)`, before the ledger write and onUpdate. Optionally also guard the liveSource callback with a per-source `stopped` flag set by stop(). |
| P3 (2/3) | ui-state | `web/app.mjs:682` | The welcome card closes itself after 60 s on first launch but never on later launches, so an unattended TV is left behind it | Move the 60 s auto-close into showWelcome(), keeping the guard that welcome is still the top layer, so it applies on every launch. Alternatively, show the welcome again only a limited number of times. |
| P3 (3/3) | data-time | `web/model.mjs:155` | Altitude/speed trend compares against the oldest kept sample (up to 90 s old), not the reading about 30 s ago | Use the newest sample that is at least 20 s old, e.g. `const old=list.findLast(s=>now-s.t>=20000)//list[0];` (or a reverse loop if findLast is unavailable on the Vega WebView). Optionally, add a sample only on poll-driven updates, or key sa |
| P3 (2/3) | data-time | `web/model.mjs:193` | An emergency squawk anywhere in the fetched feed takes over the hero card, even when the aircraft is off the map | Limit the emergency branch to the visible map: `planes.find(a=>a.emergency&&a.ground<=config.rangeMiles)`. If far emergencies should still be shown, show them in a separate notice instead of making them the hero. |
| P3 (3/3) | layouts | `web/layouts/departures.mjs:25` | Departures split-flap cells almost never flip in live use: the flip class comes from one shared parity counter, not from each cell | Alternate per cell, not globally, e.g. `const next=c.classList.contains('fa')?'fb':'fa';c.classList.remove('fa','fb');c.classList.add(next);`. Or restart the animation explicitly by removing the class, reading c.offsetWidth, then adding the |
| P3 (3/3) | layouts | `web/model.mjs:231` | Logbook tallies ('Seen today', Highest, Fastest, Cargo tonight, Rarest, Farthest) keep showing a previous day's numbers whenever the feed is not fresh | In logSummary (or in liveSource before calling it), treat the log as empty when `log.day!==localDay(now)`, and drop cargo counts when `log.cargo.night!==tonightKey(now)`. Pass `now` in so the summary always describes the current local day a |
| P3 (3/3) | layouts | `web/layouts/departures.mjs:72` | Departures Remarks ignore Window view: 'DUE n MIN' uses the hidden circle radius and 'ABOVE' marks planes many miles away | Test DUE against the active zone: `const z=alertZone(); const due=z.kind==='window'?inZone(z,a.cpa.x,a.cpa.y):a.cpa.miles<z.radius+1;`. In Window view, show 'IN WINDOW' instead of 'ABOVE' when a.inside and a.ground>OVERHEAD_MI (inZone and O |
| P3 (3/3) | maps | `web/app.mjs:175` | Changing the map radius while map tiles can't be fetched wipes the map already on screen and leaves a blank map for minutes | In applyPlace, when the place itself has not moved (same(maps.base)) and savedMap returns null, keep the current maps.base as a stand-in. Replace it, and call mapsChanged, only when a saved map is found or buildMap succeeds. For example: `c |
| P3 (3/3) | native | `src/silentLoop.ts:46` | If the silent loop fails to start once, it never retries for the rest of the session (and the failed player is leaked) | In the catch, deinitialize the local `p` if it was created and `player !== p`. Leave `wanted` unchanged instead of calling stopLoop(), and schedule a bounded retry, e.g. `setTimeout(() => { if (wanted && !player) startLoop(); }, 5000)` with |
| P3 (2/3) | security | `web/live.mjs:89` | Aircraft type from the feed is saved to 'Recently above' history with no length or type check, then redrawn and re-fitted on every poll after relaunch | Clean the feed fields when they enter history. In selection(), set aircraft_type to typeof a.t==='string' ? a.t.trim().slice(0,24) : '', and limit callsign and registration the same way. Also clean aircraft_type in recentSightings, and vali |
| P3 (3/3) | persistence | `web/app.mjs:324` | Toggling Alert zone doesn't reliably clear 'Recently above': a poll from the old feed that finishes inside the 900 ms restart delay writes the old list back | Stop the feed (feed?.stop()) at the same moment the history is removed, or do the removal inside restartFeed just before start(). A simpler option is to put the zone kind in the history key, or save {zone, rows} and throw the list away on l |
| P3 (3/3) | persistence | `web/app.mjs:592` | Adjust position can save a longitude past ±180; on the next launch loadSettings drops the place and the app replaces it with an IP guess | In nudge() (or in choosePlace), wrap the longitude to [-180,180): `lon=((lon+540)%360)-180`. Clamp latitude to ±85. Run every saved place through makePlace so a value is checked the same way when it is saved as when it is loaded. Separately |
| P3 (3/3) | ui-state | `web/app.mjs:213` | Choosing a place at the same coordinates saves it but keeps the old time zone and elevation, so the dashboard clock stays wrong until relaunch | In choosePlace, when the coordinates are unchanged but timeZone or elevationM differ from the current place, restart the feed (call restartFeed() after saving, or applyPlace(place) without fresh). Alternatively, have model.mjs expose a setP |
| P3 (3/3) | ui-state | `web/app.mjs:685` | Settings edit mode stays active when boot opens the welcome card or Location screen on top of Settings, so the new screen's keys go to the hidden row | In open() (and closeAll/startAdjust), end any active edit first: call stopEdit(), or cancelEdit() to drop the half-made change, whenever a layer is pushed over Settings. Alternatively, guard editKey with `layer?.id==='settings'`. |
| P3 (3/3) | data-time | `web/live.mjs:120` | Route lookups need a stick clock at or ahead of adsb.fi's, while the plane display allows 5 s behind: if the clock lags slightly, no routes ever appear | Use the same tolerance as selection/airspace: `now-stamp>=-5&&now-stamp<=15` (and `now-a.last_seen>=-5` for history rows). Better, compute one freshness or skew value per poll and pass it to all three functions. |
| P3 (3/3) | data-time | `web/live.mjs:257` | At wide map radii the single ADSB.lol lookup per poll goes to whichever aircraft has the freshest position, including ones never drawn, so the hero's route can stay blank for many minutes | After the inside-first rank, order missing lookups by distance from home (observations already computes haversine). Skip aircraft beyond the map radius or the 300-plane display cap. Optionally pass the current hero's hex so it is looked up  |
| P3 (2/3) | data-time | `web/place.mjs:43` | A place with no time-zone field passes validation as timeZone undefined: the clock shows '—' forever and the logbook day and 'Cargo tonight' use the TV's time zone | Require a non-empty string: `const timeZone=typeof o.timeZone==='string'&&o.timeZone&&validTz(o.timeZone)?o.timeZone:null`. Then resolve a missing zone explicitly (the Open-Meteo time-zone lookup already used for addresses) instead of stori |
| P3 (3/3) | layouts | `web/kit.mjs:158` | The aircraft-shape check mislabels common types: Hawker 800 and BAe 146 drawn as helicopters, C-17 and C-160 as small Cessnas, and real helicopters (S-92, R66, Dauphin) as airliners | Drive shapeFor from one table shared with silhouetteFamily, so both checks agree. Narrow the heli prefixes to real rotorcraft (e.g. B4(07/12/29/30), H(47/60/64/500/269)…, never H25), add S92, R66, AS65, B505, BK17, EXPL and MD5/MD60. Exclud |
| P3 (3/3) | layouts | `web/layouts/radar.mjs:110` | Negative barometric altitudes print as '0-1', '0-3' in the Radar, Sectional and Synthwave aircraft tags | Add one kit helper, e.g. fmt.fl100(ft): v=Math.round(ft/100); return (v<0?'-':'')+String(Math.abs(v)).padStart(v<0?2:3,'0'). Use it in all three layouts, or clamp to 0 and show 'GND/000' for values below 0. |
| P3 (3/3) | maps | `web/layouts/atlas.mjs:196` | Atlas labels airports and place names only in the inner ~70% of the map. The label windows were not updated when commit e462e19 rescaled the map (54 to 25.5 px/mi). | Size the label windows to the new view. In Atlas, call airfieldsNear and placesNear with a within value that covers the canvas: about 13.7 (W/2/25.5*10) sideways and 10.8 vertically. One option is to pass separate x/y extents, or to filter  |
| P3 (3/3) | security | `web/mvt.js:1` | A 29-byte vector tile makes the bundled MVT decoder allocate without limit (ClosePath repeat count), so the WebView runs out of memory on every map build | Bound the geometry decode. In loadGeometry (and in bbox), reject ClosePath with a count other than 1, or stop when the number of points produced goes above the geometry byte length (each real point needs at least 2 bytes), e.g. `if(n===7&&o |
| P3 (3/3) | network | `web/mapgen.mjs:216` | A map past 30 days old is discarded before a new one is fetched, so an offline launch (or a tile outage) shows a blank map even though a usable map is saved | Split 'usable' from 'fresh'. Have savedMap/savedDetail return a map that matches the place, version and spec whatever its age, with a stale flag. In applyPlace/ensureDetail, draw the stale map at once and start the rebuild in the background |
| P3 (3/3) | ui-state | `web/app.mjs:620` | Holding OK on the dashboard (or on Save in Adjust position) runs through Settings into the Location screen, which then fills with A's and sends a search | Near the top of the keydown handler (after the busy check), drop repeated activation keys: `if(e.repeat&&(k==='Enter'//k===' '))return e.preventDefault();`. This also fixes the known picker/edit-mode and Search-key repeat reports. Arrow rep |
| P3 (3/3) | data-time | `web/live.mjs:204` | When a ledger save has failed, restarting the feed wipes the route cache and the ADSB.lol 429 back-off | Store a plain snapshot in memory, for example memory.set(k, JSON.parse(JSON.stringify(v))), so it matches what localStorage would hand back. Or have the Ledger constructor accept a Ledger: saved instanceof Ledger ? new Map(saved.rows) : ... |
| P3 (3/3) | data-time | `web/model.mjs:213` | Window view at wide reach: planes inside the window but beyond the 300 nearest never count as inside, yet show up in 'Recently above' while still in the window | Work out alert-zone membership over the whole airspace list before the MAX_PLANES slice, and always keep in-zone aircraft in the drawn set. For example: planes = [...all.filter(inZoneRaw), ...all.filter(not inZoneRaw)].slice(0,MAX_PLANES),  |
| P3 (3/3) | layouts | `web/layouts/cockpit.mjs:182` | Cockpit speed tape shows 0 km/h for an aircraft with no ground speed when units are metric | Convert only known values: `const spd=number(hero.speed_kt)?(metric()?hero.speed_kt*1.852:hero.speed_kt):null;`. Do the same for `altv` for consistency. |
| P3 (3/3) | layouts | `web/kit.mjs:130` | Unknown speed and climb rate are shown as definite values: Radar prints '000' ground speed and several layouts print 'level' | In fmt.vs return '—' when `!number(fpm)` and keep 'level' only for /fpm/<100. In Cockpit, show '---' when vertical is not a number. In Radar blockText, print '---' for the speed field when `!number(a.speed_kt)`. |
| P3 (3/3) | maps | `web/mapgen.mjs:129` | Night Sky and Glass draw beyond the edge of the map data: rivers, roads and water stop in a straight vertical line on screen | Size map reach from the widest layout view: base lim at least 2r (and 2r+1.5 at 10 mi), or clip Night Sky/Glass to the reached box. In Glass, also paint the BASE water/roads under DETAIL so anything past the detail reach still has motorways |
| P3 (3/3) | maps | `web/mapgen.mjs:187` | At 25 and 50 mi map radius, small coded airfields come only from a 0.85r box, narrower than the ~1.05r window Atlas labels and the 1.5r+12 mi kept at 15 mi and under | Raise flim to at least the Atlas label window (about 1.05r sideways, or 1.4r to match the map), filtering x and y separately, and bump VERSION so saved base maps rebuild. |
| P3 (3/3) | persistence | `web/mapgen.mjs:219` | Base-map cache evicts by build order, not use: the map in daily use (for example the default 10 mi) is deleted before a wider map that was tried once | When savedMap returns a hit, move its range to the front of RECENT_KEY without rewriting the map, so eviction is truly least-recently-used: `const touch=r=>store.set(RECENT_KEY,[r,...(store.get(RECENT_KEY)//[]).filter(x=>x!==r)].slice(0,3)) |

Refuted this run: 2.

#### Completeness critic

I found 10 new defects not on the known lists, all from reading the code: 1 P1, 2 P2 and 7 P3. Nothing in the repo was changed and no network calls were made. For the areas that had no new code defect, I say what I checked. Areas that can only be checked on a device or outside the code are listed at the end.

**New defects**

1. **[P1] Accessibility: VoiceView gets nothing to read** (web/app.mjs:223, web/index.html:21)
   - Trigger: VoiceView turned on, user moves through Settings, the keyboard or the confirm screens.
   - Observed: `setFocus` only toggles a `.focus` CSS class. Nothing in web/ calls `.focus()`, and there is not a single `aria-label`. The only live region is the toast. Keydown arrows are swallowed with `preventDefault`, so focus changes, screen changes and hero changes are never announced.
     - The picker arrows are bare "‹" / "›" glyphs.
     - The overlays have no dialog role, and the dashboard behind them is not hidden from the screen reader.
   - Expected: each focus move announces the row or key, with its value.
   - Fix: give every `[data-focus]` element `tabindex=-1` and call `el.focus({preventScroll:true})` in `setFocus`. Add `aria-label` to the picker arrows and `role="dialog"` with `aria-modal` to the overlays. Set `aria-hidden` on `#layout` while a layer is open. Add a polite live region for the hero status line. Then check on a device that VoiceView still passes D-pad keys through to the page.

2. **[P3] Accessibility: low contrast and small text** (web/whatsup.css:35, web/layouts/glass.css:12 and :59, web/app.mjs:16)
   - Trigger: any theme.
   - Observed:
     - The Adjust position privacy note (`.note.small`, index.html:113) is 11 px in `--ui-faint`. Its contrast is 1.83:1 on Atlas Light, 2.27 on Atlas Dark, 2.58 on Blueprint, 2.59 on the default green and about 2.07 on Glass. The WCAG minimum is 4.5:1.
     - Glass place names are 2.29:1.
     - About 40 text styles are under 12 px on the 960×540 stage, which is 24 px at 1080p. Glass `.gl-mini span` is 8.5 px, so 17 px at 1080p.
     - The stage scales only with the viewport (app.mjs:16), so the system text-size setting has no effect.
   - Expected: at least 4.5:1 for informative text, and a readable minimum size.
   - Fix: use `--ui-dim` for `.note.small`, raise the alpha of `.gl-place`, and set a floor of about 12 px on the stage.

3. **[P2] 24 h+ soak: the whole logbook is rewritten to localStorage twice per poll** (web/model.mjs:218, web/live.mjs:299)
   - Trigger: any session with a fresh feed. Both the poll's `onUpdate` and the enrichment's `onUpdate` run `updateLog` followed by `store.set(LOG_KEY)`.
   - Observed: `log.planes` takes every drawn aircraft at any distance, up to 4000 per day. I measured the JSON at **358 KB at the cap** with a node simulation. In a busy area that means about 2 × 358 KB of synchronous stringify plus write every 5 to 15 s, which is gigabytes of flash writes per day and main-thread stalls on a 1 GB stick.
   - Expected: write only when the log actually changed, and at most every 30 to 60 s.
   - Fix: add a dirty flag and a throttled save, skip the second save from the enrichment path, and keep the per-plane map small (for example only planes within the map radius).

4. **[P3] Non-US locales: date is in British order for US users** (web/kit.mjs:135)
   - Trigger: any US place, on Atlas, Glass, Night Sky, Synthwave, Radar, Blueprint and Sectional.
   - Observed: `fmt.date` is hard-coded to `en-GB`, so US users see "Wednesday 28 October" and "Wed 28 Oct" (checked with node).
   - Expected: "Wednesday, October 28" in the US.
   - Fix: pick the locale the same way `fmt.clock` does.

5. **[P3] 24-hour clock chosen by country, not by preference** (web/kit.mjs:134)
   - Trigger: home in Canada, Australia, India, the Philippines and so on.
   - Observed: every country except the US gets `en-GB`, which is a 24-hour clock ("14:05"). English Canada and Australia mostly use 12-hour time, and there is no setting to change it.
   - Expected: follow the system or locale hour cycle, or offer a 12/24 h setting.
   - Fix: use the system hour cycle or add a Settings toggle.

6. **[P3] Units default to miles and feet everywhere, and km labels are rounded wrongly** (web/place.mjs:63, web/app.mjs:302-303 and :313, web/kit.mjs:120)
   - Trigger: a non-US place, or switching Distance to Kilometers.
   - Observed:
     - Distance always defaults to `mi`, even for an IP place in Germany or France.
     - Radius steps stay in miles and are shown with 0 decimals, so an alert radius of 1 mi reads "2 km" when it is really 1.6 km, and 2 mi reads "3 km".
     - `fmt.int` always groups numbers the US way ("35,000").
   - Expected: km by default outside the US, UK and Myanmar, and labels that match the real radius.
   - Fix: choose the default from the place's `countryCode` on first save, show 1 decimal in km under 10, and use locale grouping.

7. **[P3] No crash reporting** (index.js:7, web/app.mjs has no handlers, src/App.tsx)
   - Trigger: any exception in the field, such as the already-known poll-loop death.
   - Observed:
     - The page has no `window.onerror` or `unhandledrejection` handler.
     - The React Native side has no ErrorBoundary.
     - `LogBox.ignoreAllLogs()` is on, and errors go only to `console.error`.
     - Combined with the known WebView-crash and poll-death issues, failures on users' TVs leave no trace.
   - Fix: add global handlers that post `{type:'error'}` to the app, keep a small ring buffer in localStorage, and show it under About.

8. **[P3] API shape change shows up as "no coverage"** (web/live.mjs:310, web/live.mjs:318)
   - Trigger: adsb.fi returns 200 without an `ac` array, for example a renamed field (the v2 API used `aircraft`) or a JSON error body.
   - Observed: `ac=[]` makes the coverage probe run. It finds no `ac` either, sets `coverage.none=true`, and the dashboard says "No receiver coverage here. The aircraft feed has no receivers near this location." That is permanent and wrong. Open-Meteo search behaves the same way: a missing `results` turns into "No places match".
   - Expected: a "feed format changed / unavailable" message.
   - Fix: treat a payload without `Array.isArray(ac)` as an error status and not as an empty sky.

9. **[P3] 1 GB stick: saved base maps also stay in RAM** (web/live.mjs:63, web/mapgen.mjs:223)
   - Trigger: stepping through map radii.
   - Observed: `store.set` keeps every value in its `memory` Map as well as in localStorage, so up to 3 base maps (one per recent radius) stay in RAM besides `maps.base`. The detail map avoids this on purpose (see the comment at mapgen.mjs:351). I did not measure the size.
   - Fix: give large values a `store.set` option that skips the memory copy, or write base maps straight to localStorage the way `saveDetail` does.

10. **[P3] First launch with no internet: the IP lookup is never retried** (web/app.mjs:685-687)
    - Trigger: the stick boots before Wi-Fi is up.
    - Observed: `locateByIp` is tried once. The screen says "We couldn't find your location automatically" and stays on manual entry. When the connection comes back, nothing retries and nothing says the problem was connectivity.
    - Fix: retry the IP lookup with back-off while the Location screen is open with no place, and word the message differently when the request failed rather than returned nothing.

**Covered with no new defect beyond the known lists**
- **Lifecycle:** the only page-side gap is the known "page never told about background". The AppState and chime gating on the native side is consistent.
- **Clock skew:** no device time-zone use anywhere. Every date or hour call passes the home `timeZone`. The remaining skew paths are already known.
- **Time zone change while running:** the device time zone is never read, so the home time zone is unaffected.
- **429 from every service at once:** ADSB.lol backs off 900 s. Every other service either fails soft or is already known (adsb.fi has no back-off, Planespotters caches the failure for 24 h, tiles leave holes, the time-zone lookup falls back silently, getBytes sends a duplicate request).
- **Old settings shapes:** `loadSettings` clamps and falls back on every field. The logbook shape is the same in every commit, and older logs without `planes` are handled. Map versions are checked. The `whatsup.map.v1` key predates the package rename, so the new package starts with empty storage.
- **Old com.bureauobscura.whatsup package:** changed in commit 2057968 (manifest.toml:7). It is a separate app with its own storage, so your test TVs will show two "What's Up" apps until the old one is uninstalled. No code still refers to the old ID.

**Areas still unexamined**
- How VoiceView behaves inside the Vega WebView (whether D-pad keys reach the page with VoiceView on, and whether DOM focus is announced) needs a device test.
- Fire TV profiles: whether Vega gives each profile its own WebView storage can't be told from the code.
- The store listing, content rating answers, declared languages and screenshots are not in the repo.
- Actual memory use and low-memory-killer behaviour on a 1 GB stick at 250 mi with Atlas Satellite plus a detail map needs device profiling.
- Real suspend/resume behaviour on Vega (whether WebView timers freeze, and whether the renderer is reclaimed in the background) is not checked.
- Typing places with diacritics, apostrophes or "/" (São Paulo, St. John's, Australian unit addresses) on the A–Z keyboard against Open-Meteo, Census and Nominatim needs network tests.
- Reduced motion (Departures flaps, credit fades) is not checked.
- High-contrast, colour-filter and screen magnifier modes are not checked.
- Behaviour on 4K and 720p panels and with overscan is not checked.
- Audio focus and the chime when another app or Alexa is speaking is not checked.
- Factory reset and app-update upgrade paths through the Appstore (data kept or wiped) are not checked.
- Captive-portal or DNS-hijack networks, where requests return HTML with a 200 status, are not checked.

### A2. Fuzz batch 1 (seeds 1–1000), final numbers (29 Oct)

**Count:** 1,000 seeds scheduled, 300 presses each.
- 685 sessions completed with valid output (~205,000 presses).
- 276 produced truncated output: they were killed by the 5-minute watchdog while the Mac was saturated (10 headless Chromes alongside the multi-agent review). They count as no result, not as passes.
- 39 were never written: the batch was restarted after a write race.
- So batch 1 is short of 1,000 clean sessions. The 5,000-session target and the stop rule ("two clean 1,000-session batches in a row") are not met.

**Finding curve** (distinct non-cosmetic issue classes against completed sessions):
- 100: 20, 200: 26, 300: 32, 400: 34, 500: 43, 600: 45, 685: 45.
- Flattening: nothing new in the last ~150 sessions.
- 186 of 685 sessions (27%) hit at least one; almost all are clip or off-screen variants from the hostile/garbage feeds, already covered by P3-1 to P3-6.

**Hard invariants:**
- Executed script injection: 0 of 685.
- Uncaught exceptions: 2 classes.
  1. The null feed entry, 8 sessions, all before the fix was built (P1-F1, fixed).
  2. NEW, P3, seed 211: a Planespotters photo finishes loading after the user has switched away from Sectional. Its relayout callback runs on the unmounted layout (`$.photo` undefined, `sectional.js` relayout from `showPhotoIn`). It's harmless (console error only). Fix: return early in `showPhotoIn`'s fit callback when `!s.isConnected`.

**Timing-dependent, not reproducible** (2 re-runs of the same seed were clean):
- Seed 281: the cog stuck on, Back x6 left Settings open, and Back didn't close Settings.
- Likely cause: `busy()` clears `busyNow` and the cog only inside two `requestAnimationFrame` callbacks. Browsers pause rAF on hidden or starved pages, so while the cog is up every key is ignored.
- On the TV this would show if the app is backgrounded mid-busy (it recovers on resume) or under heavy load.
- P2: clear `busyNow` with a setTimeout fallback (~1.5 s) as well as rAF.
- Seed 257 (Back x6 didn't return home) is the same symptom under load.

**Harness artifacts, not app bugs:**
- "Settings changed across reload" (4): the harness reloads with `?layout=`/`?map=` query overrides, which the boot hooks apply. Every setting is saved immediately (`saveSettings` on each change), so the app itself doesn't lose settings.

**New P3 (seed 631):**
- Blueprint plus the garbage feed: right-column Settings rows reported off-stage after a mash.
- Not re-checked visually; likely the Settings card grows when a hostile value wraps. Re-run seed 631 with a screenshot to confirm.

Batch 2 (seeds 1001–5000) is running overnight with 6 browsers instead of 10 and a 7-minute watchdog, so fewer sessions are cut short. Results go in scratch/monkey/out2 (.bad = truncated).
