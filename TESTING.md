# What's Up — test pass

Where: **D** = desktop (headless Chrome 1920x1080 through `scripts/drive.mjs` / `scripts/shot.mjs`,
the same page and the same app bridge rules via `scripts/dev-server.mjs`), **S** = the Fire TV Stick
(<fire-tv-ip>, Vega OS 2.0, remote keys injected with `inputd-cli`), **U** = automated unit tests.
Result: PASS, FAIL (bug, then what was done), FIXED (failed, fixed, re-tested), PENDING (not run yet, why).

Automated: `npm run test:web` (node, 23 tests) and `npx jest` (3 tests). All pass.

## Location

| Check | Where | Result |
| --- | --- | --- |
| Change location: type CHICAGO, pick Chicago, IL → "Use this location?" visible with focus on *Use this* | D | FIXED. Before: the confirm box opened *under* the location screen (same z-index, earlier in the page), so focus vanished onto an invisible button and OK silently chose it (reproduced on the stick). Screens now stack in opening order. |
| Search with empty entry | D | FIXED. Before: nothing happened. Now: "Type a ZIP or postal code, a city, or a street address first." |
| City only (CHICAGO, LONDON) | D | PASS: list to pick from (Chicago, IL first; London UK / ON / OH). |
| ZIP (45202) | D, U | PASS: Cincinnati, OH first. |
| Full US address (801 Plum St Cincinnati) | D, U | PASS: Census match "801 Plum St, Cincinnati, OH"; time zone looked up with rounded coordinates. |
| Non-US address (10 Downing Street London) | U | PASS: Nominatim fallback, Europe/London. |
| Garbage (XQZVQ) | D | PASS: "No places match “XQZVQ”. Check the spelling, or try a ZIP or postal code." |
| Offline / geocoder down | D | FIXED. Shows "Search is unavailable. Check the connection." with **Try again**, which now takes focus; Try again after reconnecting returns results. A search never waits more than 25 s. |
| Loading state | D | PASS: "Searching for “…”…" (pulsing) on every search. |
| *Search again* from the confirm box | D | PASS: back to the list with focus on the result that was chosen. |
| Back from location → Settings → dashboard | D | PASS. |
| First launch, IP lookup fails | D | PASS: goes straight to Change location ("We couldn’t find your location automatically…"). |
| First launch "Is this right?" Confirm / Change | D | PASS (welcome shown on fresh profiles; Change opens location entry). |
| Bridge refuses a URL not on the allow-list | code | FIXED: now answered at once with "blocked" instead of the page waiting out its timeout. |

## Remote / D-pad

| Check | Where | Result |
| --- | --- | --- |
| Settings: every row reachable, Down past *Done* and Up past *Layout* stay put (no dead end, no focus loss) | D | PASS |
| Focus always visible and inside the top screen (checked after every step) | D | PASS |
| Back closes the top screen; Back on the dashboard leaves the app (handled by the app) | D | PASS |
| Rapid key mashing (OK/Back/arrows, 40 ms apart) | D | PASS: no stuck screen or lost focus. |
| Up/Down on the dashboard = map radius (toast "Map radius 25 mi") | D | PASS |
| Long-press (held arrows) | D | PASS in Adjust position (accelerates); elsewhere repeats as single presses. |
| The same on the stick | S | PENDING (stick asleep, see below) |

## Settings

| Check | Where | Result |
| --- | --- | --- |
| Layout picker: Left/Right live preview, spam 11 presses wraps, Back reverts, OK keeps | D | PASS; only the active layout's code/CSS stay loaded (1–2 stylesheets). |
| Alert radius 1–10, clamps at 10 | D | PASS |
| Map radius 2–250 (2, 5, 10, 15, 25, 50, 100, 150, 250) | D, U | PASS |
| Alert ring wider than the map radius | D, U | PASS: shows "2 mi (the map radius)", ring drawn at the map radius, saved preference kept for wider maps. |
| Distance mi/km, altitude ft/m (labels, speeds, ring labels, scale bars) | D, U | PASS |
| Bad saved values (radius 99, units "parsecs", layout "<script>") | U | PASS: safe defaults. |
| Persistence across force-quit/relaunch and upgrade install | S | PASS for upgrade install: `vpm install --force` kept the saved location (Chicago) and settings. Force-quit/relaunch: PENDING. |

## Layouts (all 11)

| Check | Where | Result |
| --- | --- | --- |
| Busy sky, empty sky, squawk 7700 (demo scenes) | D | PASS for all 11 (contact sheets in `.shots/sc/`). |
| Atlas column: busy and empty | D | FIXED: re-spaced to the full height; Recent hides instead of clipping when a busy hero fills it. |
| Atlas Dark (new, #6) | D | PASS: charcoal map, grey roads, cyan planes, amber hero, readable column. |
| Swiss: gap between number and red rule (1-digit, 2-digit, km) | D | FIXED: gap is now in em, so it scales with the number. |
| Credits: none on the dashboards; one line fades ~5 s after open / layout change / new map; full list in Settings | D | PASS |
| Far cities: London (GMT), Tokyo, Honolulu (previous day), Cape Town | D | PASS: local clock and date correct; coast/ocean maps draw. |
| Map radius 2 mi and 250 mi in every layout | D | PASS after fixes: hard-coded "10 mi" text in Glass, Departures, Night Sky and Swiss now follows the radius; Atlas no longer says "Drawing streets…" when wider than 10 mi. |
| Hundreds of aircraft at 250 mi | D | PASS: nearest 300 drawn, ≤9 labels per layout. On the stick: PENDING. |
| Long callsigns / missing fields (N-numbers, no route, no type) | D | PASS (demo N8UH/N451PA: "Private", "Route not reported"). |
| Memory over ~30 min, layout-switch spam on the stick | S | PENDING |

## Network failures

| Check | Where | Result |
| --- | --- | --- |
| adsb.fi unreachable from launch | D | FIXED: was "Connecting…" forever; after 15 s now "No live data right now. Retrying every few seconds." |
| OpenFreeMap down (no saved map) | D | PASS: live data still shown; map note, retried every 30 s+. |
| ADSB.lol down / 404 / 429 | U | PASS (existing enricher tests: 404 cached as miss, 429 cool-down 15 min). |
| Geocoders down | D | PASS: see Location. |

## Screensaver

| Check | Where | Result |
| --- | --- | --- |
| App reports user engagement while shown (`IKeplerUserEngagementModuleV2::makeVideoPlaybackUserEngagement().start()`), stops when backgrounded / closed | U | PASS (jest) |
| Screensaver held off while What's Up is in front | S | PARTIAL: with the app in front the screensaver came after ~13.5 min idle; over Settings it came almost at once. Added a re-report every 4 min; re-test PENDING. |
| Screensaver returns after leaving the app | S | PENDING |

## Could not test / notes

* The stick went into standby after its screensaver at 05:59 UTC and does not wake from injected
  keys or app launches; the on-stick checks above wait for a real remote press.
* Injected `inputd-cli` key presses may not count as user activity for the idle timer, so idle
  timing on the stick is measured from the last *real* remote press.
