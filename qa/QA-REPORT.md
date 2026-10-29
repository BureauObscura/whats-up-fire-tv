# What's Up — QA pass, 28 October 2026

Tested as a user on the Fire TV Stick (remote key injection, screenshots) and in desktop Chrome
(same page, scripted remote, automatic checks for clipped, off-screen, "…", and "undefined/NaN"
text, plus console errors). Covered: all 12 layouts × map radius 2/15/50/250 mi × busy, empty,
emergency and long-name scenes × miles/metric, both alert zones, every Settings row and its
limits, location search edge cases, first run, layout cycling, remote keys, relaunch, and a
memory run. Nothing was fixed; this is findings only. Screenshots are in `qa/shots/`.

## Summary

| Priority | Count |
| --- | --- |
| P1 (broken / wrong) | 1 (needs a real-remote check) |
| P2 (visible glitch / inconsistency) | 6 |
| P3 (polish) | 11 |

What held up well: no JavaScript errors anywhere; layout cycling (24 switches) leaves exactly
one layout loaded, with no growth in page memory (8 MB heap); first run, IP guess and welcome
screen work; location search handles gibberish, 40-character input, offline and Back mid-search;
settings survive Back-to-launcher and relaunch; Keep screen awake stops when the app is left;
nothing in the UI says Overhead or Bureau Obscura.

## P1

**P1-1. Home button doesn't leave the app (suspected).**
Steps: with What's Up on screen, press Home. Expected: the Fire TV home screen. Actual: injected
Home is ignored while What's Up is in front (tested 3 times, with Keep screen awake on and off),
while Home works from Amazon's own Settings app. Back still exits. This may be a quirk of
injected keys, so it needs one press of the real remote to confirm.
Shots: `tv-after-home-resume.png`. Fix if real: make sure no component consumes KEY_HOME
(WebView focus or the media session); check the Vega key-handling docs.

## P2

**P2-1. Main card shows a plane that isn't on the map.** At 15 mi the card said "Nearest ·
28 mi SSW CSB599" with nothing drawn. Expected: the card describes a plane you can see, or says
it's off the map. Shot: `p2-hero-off-map-tv.png`. Fix: only pick "Nearest" from planes inside
the map radius (or mark "beyond map").

**P2-2. Radar: Rarest uses "…" and the panel runs off the bottom.** Long names (scene with
Antonov An-124 Ruslan, Frankfurt am Main) give "Rare Antonov An-124 Rus…" and the Recently list
is cut at the screen edge. Shot: `p2-radar-panel-overflow.png`. Fix: bring the Atlas one-line
fit (shorten, then shrink) and drop-rows-to-fit rules to Radar.

**P2-3. Radar: airline shown twice, different case.** "GEC8401 Lufthansa Cargo" on the
callsign line and "… built 2013 · Lufthansa cargo" on the aircraft line. Same shot. Fix: drop
the operator from the aircraft line when it's already shown.

**P2-4. Blueprint: window wedge and rings spill outside the drawing.** In Window view the wedge
line runs across the title block and the revisions table; at 15 mi the outer ring label
"R 15 MI" and the "N" sit off-screen. Shot: `p2-blueprint-ring-offstage.png`. Fix: clip the
zone and construction rings to the drawing frame; cap ring labels inside it.

**P2-5. Window from = Window to makes a useless zone.** Setting both to ENE 74° draws a single
line and almost nothing counts as "in your window"; there's no warning. Shot:
`p2-window-from-equals-to.png`. Fix: block equal values (step past them), or treat equal as
"all around".

**P2-6. Menu key does nothing.** The remote's Menu (≡) button should open Settings (the code
listens for "ContextMenu"/"Menu"/keyCode 82), but Vega's Menu key isn't one of those. Shot:
`tv-key-KEY_MENU.png`. Fix: log the key Vega actually sends and add it.

## P3

1. **Sectional: CVG label ends in "…"** ("CINCINNATI/NORTHERN KENTU…"). Shot:
   `p3-sectional-cvg-ellipsis.png`. Fix: use the short airport name ("Cincinnati/N. Kentucky")
   or shrink, per the no-"…" rule.
2. **Sectional: "ALERT 3 KM" label off the chart** at a 2 mi map radius in metric. Shot:
   `p3-sectional-alert-label-offstage.png`. Fix: hide the label when the ring is bigger than
   the chart, or place it inside.
3. **Place names hidden under plane icons** (e.g. LIMA, GREENWOOD at 250 mi). Labels already
   yield to flight tags but not to the plane markers or the hero's target ring. Shot:
   `tv-satellite-250mi.png`. Fix: include plane marker boxes in the label-hiding check.
4. **Credit line drawn under the layout picker** (the 5-second line sits behind the picker bar).
   Shot: `p3-credit-under-picker-tv.png`. Fix: don't flash credits while the picker is open, or
   raise it above.
5. **Back while editing a Settings value keeps the change.** Users may expect Back = cancel.
   Fix: remember the value on OK and restore it on Back (or say "Back keeps" in the hint).
6. **Spelling mix:** "Kilometres" and "Metres" (British) next to "Neighborhoods" (American).
   Pick one (American, to match the rest).
7. **Naming mix:** "Alert radius", "alert ring" (zoom toast), "alert zone", "Zone", "Zone chime",
   "In your window", "Through your window". Suggest: setting "Alert zone"; inside it "Alert
   radius" / "Window"; toast "alert zone"; keep "Through your window" for the list.
8. **Photos only on the Atlas layouts.** The other 9 layouts never show the aircraft photo,
   model photo or silhouette. Fine if intended; otherwise add where there's room.
9. **Location search: duplicate-looking results** ("Tokyo, Japan" twice, the city and the
   prefecture). Fix: add the region type or drop the duplicate.
10. **Home address on screen.** The street address shows in Settings → Location, the "Use this
    location?" box and Fine-tune. Fine for a home TV, but worth an option to show only the city
    if guests or screenshots are a concern.
11. **Ground traffic never shows.** Planes reporting "ground" altitude (taxiing at CVG) are
    dropped. Probably right for a sky display; noting it as a decision.

## Code review notes (no issue found)

- Chime: rings only on empty → occupied after a quiet minute; never on launch, feed restart or a
  zone/radius change (the gate resets with the feed); stale data is ignored; Off silences both
  the alert and the preview.
- Midnight: Today stats and Farthest/Rarest reset on the local day of the home location; cargo
  "tonight" runs 6 pm to 6 am.
- Rate limits: aircraft feed every 5 s (10–15 s at wide radii), routes at most one lookup per
  5 s with cache and 429 cool-down, photos once per aircraft per session, location search
  debounced and Nominatim only on Search, map tiles once per location and radius.
- Errors: every network call resolves (timeouts, refused URLs answered at once); no unhandled
  promise rejections seen; no console errors in any layout or scene.

## Performance (TV)

- Atlas Satellite at 250 mi, busy evening traffic: free memory 249–287 MB over a 10-minute run (the stick
  has 975 MB), no growth trend; app stayed responsive.
- Layout cycling (desktop, 24 switches): one layout loaded at a time, heap 8 MB.
