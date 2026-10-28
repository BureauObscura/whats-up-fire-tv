'use strict';
(()=>{
const __modules={};
window.__whatsupModules=__modules;
// ---- config.js
__modules["config.js"]=(()=>{

// Defaults. The home location, alert radius and units are chosen on the device
// (Settings) and saved there; nothing here is tied to one city.
const CONFIG = Object.freeze({
  radiusMiles: 3,   // alert boundary, 1-10
  rangeMiles: 10,   // default map radius (Settings: 2-250 mi)
  searchNm: 15,     // surrounding traffic fetched from adsb.fi at the default radius
  pollSeconds: 5,   // adsb.fi asks for at most 1 request per second; 5 s keeps well under it
});

return {CONFIG};
})();
// ---- core.mjs
__modules["core.mjs"]=(()=>{

// Pure functions shared by the display, live.mjs and the regression tests.
// The page reads HA-shaped `states`; standalone, live.mjs builds them in the page.
const IDS = Object.freeze({
  current:'sensor.office_aircraft_current', feed:'sensor.office_aircraft_feed',
  candidate:'sensor.office_aircraft_candidate', routes:'sensor.office_aircraft_routes',
  home:'zone.home', radius:'input_number.office_aircraft_radius',
});
const number = v => typeof v === 'number' && Number.isFinite(v);
const coordinates = (lat,lon) => number(lat) && number(lon) && Math.abs(lat)<=85 && Math.abs(lon)<=180;

function localClock(now,timeZone) {
  if (timeZone) try {
    return {
      time:new Date(now).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone}),
      date:new Date(now).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone}).toUpperCase(),
    };
  } catch { /* Wait for a usable home timezone; never silently use the TV's. */ }
  return {time:'—',date:'LOCAL AIRSPACE'};
}

function observation(states, now, connected) {
  const current = states[IDS.current];
  const stamp = Number(states[IDS.feed]?.state);
  const age = now / 1000 - stamp;
  const fresh = connected && stamp>0 && age>=-5 && age<=15 && current?.attributes?.feed_fresh === true;
  const a = current?.attributes?.aircraft;
  const posAge = now/1000 - a?.position_timestamp;
  const valid = fresh && a && current.state === a.hex && /^[a-f0-9]{6}$/i.test(a.hex) &&
    coordinates(a.latitude,a.longitude) && number(a.altitude_ft) &&
    number(a.distance_mi) && a.distance_mi>=0 && number(posAge) && posAge>=0 && posAge<=20;
  return {fresh, aircraft:valid ? a : null, age:posAge};
}

function project(lat,lon,zoom) {
  const scale = 256 * 2**zoom;
  const sin = Math.sin(Math.max(-85,Math.min(85,lat))*Math.PI/180);
  return {x:(lon+180)/360*scale,y:(.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*scale};
}

function mapGeometry(home,radius,width,height) {
  const metersPerPixel = ((radius+2)*2*1609.344)/(Math.min(width,height)*.78);
  const zoom = Math.max(3,Math.min(15,Math.floor(Math.log2(156543.03392*Math.cos(home.latitude*Math.PI/180)/metersPerPixel))));
  const center = project(home.latitude,home.longitude,zoom);
  const mpp = 156543.03392*Math.cos(home.latitude*Math.PI/180)/2**zoom;
  return {zoom,left:center.x-width/2,top:center.y-height/2,cx:width/2,cy:height/2,
    radiusPx:radius*1609.344/mpp,outerPx:(radius+2)*1609.344/mpp};
}

const clean = v => typeof v==='string' ? v.trim().slice(0,24) : '';
const flightLabel = a => clean(a.callsign)||clean(a.registration)||clean(a.hex).toUpperCase();
// Airline callsigns read as published flight numbers ("UAL0696" -> "UA 696");
// registrations, charter and military callsigns stay as broadcast.
function flightNumber(callsign,designators) {
  const call=clean(callsign).toUpperCase(),match=/^([A-Z]{3})0*([1-9][0-9]{0,3})$/.exec(call);
  return match&&designators[match[1]]?`${designators[match[1]]} ${match[2]}`:call;
}
// Designator to display name; unknown codes stay visible and ZZZZ means "no designator".
const typeName = (code,types) => {
  const value=clean(code).toUpperCase();
  return value==='ZZZZ' ? '' : types[value]||value;
};
// Map icon shape and size: the designator's icon, else the ADS-B emitter category.
const WAKE_SIZE={L:.86,LM:.93,M:1,H:1.22,J:1.36};
const CATEGORY_ICONS={A1:'single.L',A2:'jet.L',A3:'airliner.M',A4:'airliner.M',A5:'widebody.H',A6:'fighter.M',
  A7:'helicopter.L',B1:'glider.L',B2:'balloon.L',B4:'single.L',B6:'helicopter.L'};
function iconIndex(groups) {
  const index=new Map();
  for(const [icon,codes] of Object.entries(groups))for(const code of codes.split(' '))index.set(code,icon);
  return index;
}
function aircraftIcon(a,index) {
  const icon=index.get(clean(a.aircraft_type).toUpperCase())||CATEGORY_ICONS[clean(a.category).toUpperCase()]||'airliner.M';
  const [shape,wake]=icon.split('.');
  return {shape,size:WAKE_SIZE[wake]||1};
}
// Operator logo from an airline-style callsign (three letters, then a digit).
function airlineLogo(a,logos) {
  const call=clean(a.callsign).toUpperCase(),code=call.slice(0,3);
  return /^[A-Z]{3}[0-9]/.test(call)&&logos.has(code)?code:'';
}
function distanceMiles(home,a) {
  const r=Math.PI/180;
  const x=(a.longitude-home.longitude)*r*Math.cos((home.latitude+a.latitude)/2*r);
  const y=(a.latitude-home.latitude)*r;
  return Math.hypot(x,y)*3958.7613;
}

// Map context comes from the existing 15-NM feed, never from the alert selector.
function airspace(states,now,connected) {
  const stamp=Number(states[IDS.feed]?.state),age=now/1000-stamp;
  const home=states[IDS.home]?.attributes;
  const radius=Math.max(1,Math.min(10,Number(states[IDS.radius]?.state)||3));
  const fresh=connected&&stamp>0&&age>=-5&&age<=15&&!!home&&coordinates(home.latitude,home.longitude);
  const raw=states[IDS.feed]?.attributes?.ac;
  const byHex=new Map();
  for(const a of fresh&&Array.isArray(raw)?raw:[]) {
    if(!a||typeof a.hex!=='string'||!(/^[a-f0-9]{6}$/i.test(a.hex))||
      !coordinates(a.lat,a.lon)||!number(a.alt_baro)||!number(a.seen_pos)||a.seen_pos<0||
      age+a.seen_pos<0||age+a.seen_pos>20)continue;
    const record={hex:a.hex.toLowerCase(),callsign:clean(a.flight),registration:clean(a.r),
      aircraft_type:clean(a.t),category:clean(a.category),latitude:a.lat,longitude:a.lon,altitude_ft:a.alt_baro,
      speed_kt:number(a.gs)&&a.gs>=0?a.gs:null,heading:number(a.track)?((a.track%360)+360)%360:null,
      position_timestamp:stamp-a.seen_pos};
    record.distance_mi=distanceMiles(home,record);
    record.inside=record.distance_mi<=radius;
    if(!byHex.has(record.hex)||byHex.get(record.hex).position_timestamp<record.position_timestamp)byHex.set(record.hex,record);
  }
  const all=[...byHex.values()].sort((a,b)=>a.distance_mi-b.distance_mi||a.hex.localeCompare(b.hex));
  return {fresh,radius,all,inside:all.filter(a=>a.inside)};
}

function recentSightings(states,inside,now) {
  const raw=states[IDS.candidate]?.attributes?.history;
  const current=new Set(inside.map(a=>a.hex));
  const unique=new Map();
  for(const a of Array.isArray(raw)?raw:[]) {
    if(!a||typeof a.hex!=='string'||!(/^[a-f0-9]{6}$/i.test(a.hex))||current.has(a.hex.toLowerCase())||
      !number(a.last_seen)||a.last_seen<=0||a.last_seen>now/1000+5)continue;
    const h=a.hex.toLowerCase();
    if(!unique.has(h)||unique.get(h).last_seen<a.last_seen)unique.set(h,{...a,hex:h,
      callsign:clean(a.callsign),registration:clean(a.registration)});
  }
  return [...unique.values()].sort((a,b)=>b.last_seen-a.last_seen||a.hex.localeCompare(b.hex)).slice(0,5);
}

// Nearby planes get first choice; use the actual card size and distance to its
// nearest edge. Search all sides so a left/above card is not penalized by width.
function placeLabels(points,width,height,scale=1) {
  const boxes=[{x:width/2-24*scale,y:height/2-6*scale,w:48*scale,h:30*scale}],
    icons=points.map(p=>({x:p.x-12*scale,y:p.y-12*scale,w:24*scale,h:24*scale}));
  const overlap=(a,b)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*
    Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
  return points.map(p=>{
    const w=Math.min((p.labelWidth||128)*scale,width-8*scale),
      h=(p.labelHeight||46)*scale,gap=14*scale;
    let best=null;
    const candidates=[];
    // Fine offsets let cards stack closely; cardinal and corner placements
    // provide space above/below a cluster as well as to either side.
    for(let step=0;step<=14;step++){
      const shift=step*12*scale;
      for(const sign of step?[1,-1]:[1]){
        candidates.push([gap,-h/2+sign*shift],[-w-gap,-h/2+sign*shift],
          [-w/2+sign*shift,-h-gap],[-w/2+sign*shift,gap]);
      }
      for(const side of [1,-1])for(const vertical of [1,-1])
        candidates.push([side>0?gap+shift:-w-gap-shift,vertical>0?gap:-h-gap]);
    }
    for(const [dx,dy] of candidates) {
      const box={x:Math.max(4*scale,Math.min(width-w-4*scale,p.x+dx)),
        y:Math.max(25*scale,Math.min(height-h-24*scale,p.y+dy)),w,h};
      const padded={x:box.x-2*scale,y:box.y-2*scale,w:w+4*scale,h:h+4*scale};
      const collision=[...boxes,...icons].reduce((sum,b)=>sum+overlap(padded,b),0);
      const edgeDistance=Math.hypot(Math.max(box.x-p.x,0,p.x-box.x-w),Math.max(box.y-p.y,0,p.y-box.y-h));
      const centerDistance=Math.hypot(box.x+w/2-p.x,box.y+h/2-p.y);
      const score=collision*100+edgeDistance+centerDistance*.05;
      if(!best||score<best.score)best={...box,score};
    }
    boxes.push(best);
    return {...p,box:best};
  });
}

// Alert zone. 'circle': within `radius` miles all around. 'window': a wedge of compass
// bearings from `from` to `to` degrees (clockwise; 300 -> 40 crosses north), out to `miles`,
// for a view from one window; a plane within OVERHEAD_MI is counted either way.
const OVERHEAD_MI=1;
const norm=deg=>((deg%360)+360)%360;
function inBearings(bearing,from,to){
  const b=norm(bearing),f=norm(from),t=norm(to);
  return f<=t?b>=f&&b<=t:b>=f||b<=t;
}
function inZone(zone,x,y){
  const d=Math.hypot(x,y);
  if(zone?.kind!=='window')return d<=(zone?.radius??3);
  return d<=OVERHEAD_MI||d<=zone.miles&&inBearings(Math.atan2(x,y)*180/Math.PI,zone.from,zone.to);
}
// The zone's outline as [x,y] miles east/north of home (a closed ring).
function zoneOutline(zone,steps=64){
  if(zone?.kind!=='window'){const r=zone?.radius??3;return Array.from({length:steps+1},(_,i)=>{const a=i/steps*2*Math.PI;return [r*Math.sin(a),r*Math.cos(a)];});}
  const span=norm(zone.to-zone.from)||360,n=Math.max(4,Math.ceil(span/4)),pts=[[0,0]];
  for(let i=0;i<=n;i++){const a=(zone.from+span*i/n)*Math.PI/180;pts.push([zone.miles*Math.sin(a),zone.miles*Math.cos(a)]);}
  pts.push([0,0]);return pts;
}

// Alert chime: rings when the alert zone goes from empty to occupied, and only after it
// has been empty for `quiet` ms (a plane flickering at the edge or a data gap doesn't
// re-ring). The first reading after launch never rings. Stale data changes nothing.
function chimeGate(state,count,now,fresh,quiet=60000){
  const s=state||{ready:false,count:0,emptySince:null};
  if(!fresh)return {state:s,ring:false};
  if(!s.ready)return {state:{ready:true,count,emptySince:count?null:now},ring:false};
  let ring=false,emptySince=s.emptySince;
  if(count>0&&s.count===0)ring=emptySince!==null&&now-emptySince>=quiet;
  if(count>0)emptySince=null;else if(s.count>0||emptySince===null)emptySince=now;
  return {state:{ready:true,count,emptySince},ring};
}

return {IDS,number,coordinates,localClock,observation,project,mapGeometry,flightLabel,flightNumber,typeName,iconIndex,aircraftIcon,airlineLogo,distanceMiles,airspace,recentSightings,placeLabels,OVERHEAD_MI,norm,inBearings,inZone,zoneOutline,chimeGate};
})();
// ---- silhouettes.mjs
__modules["silhouettes.mjs"]=(()=>{

// Side-profile aircraft silhouettes (drawn for this app, nose to the right) for the hero
// card's type line, chosen from the ICAO type designator, else the ADS-B category.
// viewBox 0 0 120 40; one path each, filled with currentColor.
const SILHOUETTES={
  // Narrowbody twin (A320 / 737 family): low wing, one engine pod visible, swept fin.
  narrow:'M9 19L100 18C108 18 114 19.5 116 21.5C114 23.5 109 25 100 25L16 25C11 25 9 23 9 21Z'+
    'M9 19L5 6L12 6L25 19Z M6 21L21 21L22 23L6 23Z M47 24L72 24L60 29L51 29Z M54 25H68Q70 25 70 27.5Q70 30 68 30H54Q52 30 52 27.5Q52 25 54 25Z',
  // Widebody twin (767 / 777 / 787 / A330 / A350): taller, longer, big engine.
  wide:'M7 17L99 16C109 16 115 18 117 21C115 24 109 27 99 27L15 27C10 27 7 24.5 7 22Z'+
    'M7 17L3 3L11 3L26 17Z M4 21L22 21L23 23.5L4 23.5Z M43 26L74 26L60 32L50 32Z M50 27H68Q71 27 71 30Q71 33.5 68 33.5H50Q47 33.5 47 30Q47 27 50 27Z',
  // Four engines (747 / A380 / An-124): hump over the cockpit, two pods.
  quad:'M6 17L99 16C109 16 115 18 117 21C115 24 109 27 99 27L14 27C9 27 6 24.5 6 22Z M72 16Q90 9 108 17Z'+
    'M6 17L2 3L10 3L25 17Z M3 21L21 21L22 23.5L3 23.5Z M40 26L76 26L62 32L49 32Z'+
    'M44 27H56Q58 27 58 29.5Q58 32 56 32H44Q42 32 42 29.5Q42 27 44 27Z M62 27H74Q76 27 76 29.5Q76 32 74 32H62Q60 32 60 29.5Q60 27 62 27Z',
  // Regional jet (CRJ / E-Jet): engines on the tail, T-tail.
  regional:'M16 19L100 18C107 18 112 19.5 114 21.5C112 23.5 108 25 100 25L22 25C18 25 16 23 16 21Z'+
    'M16 19L12 5L19 5L30 19Z M8 5L24 5L24 7L8 7Z M24 14H38Q40 14 40 16Q40 18 38 18H24Q22 18 22 16Q22 14 24 14Z M54 24L72 24L64 28L58 28Z',
  // Business jet: small, rear engines, T-tail.
  bizjet:'M28 20L96 19C103 19 108 20.5 110 22C108 23.5 104 25 96 25L33 25C30 25 28 23.5 28 22Z'+
    'M28 20L24 8L30 8L40 20Z M21 8L34 8L34 10L21 10Z M34 15.5H46Q48 15.5 48 17.5Q48 19.5 46 19.5H34Q32 19.5 32 17.5Q32 15.5 34 15.5Z M60 24L74 24L68 27L63 27Z',
  // Turboprop (ATR / Dash 8): high wing with a prop nacelle.
  turboprop:'M12 20L98 19C106 19 111 20.5 113 22.5C111 24.5 106 26 98 26L18 26C14 26 12 24 12 22Z'+
    'M12 20L8 6L15 6L26 20Z M6 21L20 21L21 23L6 23Z M50 17L78 17L78 19L50 19Z M66 19H80Q82 19 82 21.5Q82 24 80 24H66Z M82.5 12H84.5V31H82.5Z',
  // Light single (Cessna-style): high wing, prop on the nose, fixed gear.
  single:'M36 21L88 19C94 19 98 20 100 22C98 24 94 25 88 25L42 25C38 25 36 23.5 36 22Z'+
    'M36 21L32 11L38 11L46 21Z M30 21L42 21L42 23L30 23Z M58 17L84 17L84 19L58 19Z M100.5 15H102.5V29H100.5Z'+
    'M64 25L61 31H63L66 25Z M84 25L85 31H87L86 25Z M59 31H66V32.5H59Z M82 31H89V32.5H82Z',
  // Helicopter: cabin, tail boom, rotors, skids.
  heli:'M58 16C70 14 86 15 92 20C94 24 90 28 82 29L60 29C55 28 52 24 53 20C54 18 56 16.5 58 16Z'+
    'M12 19L56 19L56 23L12 23Z M10 13H14V25H10Z M73 10H76V15H73Z M30 8H118V10H30Z'+
    'M60 29L58 33H61L63 29Z M80 29L82 33H85L83 29Z M52 33H92V35H52Z',
  // Military / cargo high wing (C-130 / C-17): stout, high wing, tall fin, upswept tail.
  military:'M10 17L98 16C106 16 112 18 114 21C112 24 106 27 98 27L24 27C17 27 10 23 10 20Z'+
    'M10 17L6 2L14 2L28 17Z M5 16L19 16L20 18L5 18Z M46 13L80 13L80 16L46 16Z M62 16H76Q78 16 78 18.5Q78 21 76 21H62Z M78.5 11H80.5V26H78.5Z',
};

const RE={
  heli:/^(EC\d|AS3[0-9]|AS5|AS6|B06|B407|B412|B429|B505|H\d|S76|S92|A1[0-4]9|R22|R44|R66|EXPL|BK17|MD5|MD60|UH|AH|CH47)/,
  quad:/^(B74|A38|A34|A124|A225|IL76|IL96|B52|C5M?$|C5$)/,
  military:/^(C130|C30J|C17$|A400|C27J|C295|CN35|AN12|AN26|AN32|C160|P3|P8$|E3)/,
  wide:/^(B76|B77|B78|A306|A30B|A310|A33|A35|MD1[01]|DC10|L101|IL86|KC10|K35|KC46)/,
  narrow:/^(A31[89]|A32|A2[01]N|A19N|B73|B3[789]M|B3XM|B75|B72|B71|MD8|MD9|C919|BCS[13]|T204)/,
  regional:/^(CRJ|E1[3-9]\d|E17|E19|E29|E75|E7[0-9]|E35|RJ[0-9]|AJ27|SU95|F70|F100|B46|RJ1H)/,
  turboprop:/^(AT[4-7]|DH8|SF34|SB20|B190|BE20|BE30|BE9|BE99|C208|C441|C425|PC12|DHC6|D328|JS3|F50|L410|TBM|KODI|P180|M600|E120)/,
  bizjet:/^(C25|C5[0-9]|C6[58]|C7[05]|CL3|CL6|GLF|GLEX|GL5T|GL7T|G[1-7]00|G280|G150|FA[0-9]|F2TH|F900|LJ|H25|E50P|E55P|E545|E550|PC24|HA4T|PRM1|BE40|GALX|ASTR|EA50|SF50|C68A)/,
  single:/^(C1[5-9]|C2[01]|C17[0-9]|C18|C206|C210|PA|P28|SR2|BE3[3-6]|DA[24]|M20|AA5|RV|G58|BE58|C310|C340|PA3)/,
};
// Family for an aircraft {aircraft_type, category}; 'narrow' when nothing matches.
function silhouetteFamily(a){
  const t=String(a?.aircraft_type||'').toUpperCase(),c=String(a?.category||'').toUpperCase();
  for(const [family,re] of Object.entries(RE))if(t&&re.test(t))return family;
  return {A1:'single',A2:'bizjet',A3:'narrow',A4:'narrow',A5:'wide',A7:'heli'}[c]||'narrow';
}

return {SILHOUETTES,silhouetteFamily};
})();
// ---- routes.mjs
__modules["routes.mjs"]=(()=>{

// The HA server owns providers, credentials, caching, and the paid-request cap.
// The page only reads sanitized routes from HA: the TV feed or a signed-in WebSocket.
const code=v=>typeof v==='string'&&/^[A-Z0-9-]{2,10}$/.test(v)?v:'';
const call=a=>code((a?.callsign||a?.registration||'').trim().toUpperCase());
const routeText=r=>r?`${r.origin} → ${r.destination}`:'';
class RouteLookup {
  entries=[];demo=new Map();
  update(entries){this.entries=Array.isArray(entries)?entries:[];}
  get(a,now=Date.now()) {
    const observed=a?.position_timestamp??a?.last_seen;
    const recent=Number.isFinite(a?.last_seen)&&!Number.isFinite(a?.position_timestamp);
    const matches=r=>(!r.historical||recent)&&r.hex===a?.hex&&call(r)===call(a)&&
      r.registration===(a?.registration||'')&&Number.isFinite(observed)&&
      observed>=r.valid_from&&observed<=r.valid_until&&r.expires>now/1000&&
      code(r.origin)&&code(r.destination)&&code(r.flight);
    const r=(recent&&this.entries.find(r=>r.historical&&matches(r)))||this.entries.find(matches);
    return r||this.demo.get(call(a))||null;
  }
  seed(a,route){this.demo.set(call(a),route);}
}

return {routeText,RouteLookup};
})();
// ---- aircraft-types.mjs
__modules["aircraft-types.mjs"]=(()=>{

// Generated by scripts/build-aircraft-types.py; edit data/aircraft-type-names.tsv and run
// `make aircraft-types`. Other names derive from ICAO Doc 8643, retrieved 2026-09-24.
// Null prototype: feed-supplied codes such as "constructor" never resolve.
const AIRCRAFT_TYPES=Object.freeze(Object.assign(Object.create(null),{
"A002":"Irkut A-002",
"A1":"Douglas A-1 Skyraider",
"A10":"A-10 Thunderbolt II",
"A109":"Leonardo AW109",
"A119":"Leonardo AW119 Koala",
"A122":"Aerotec A-122 Uirapuru",
"A124":"Antonov An-124 Ruslan",
"A129":"Agusta A-129 Mangusta",
"A139":"Leonardo AW139",
"A140":"Antonov An-140",
"A148":"Antonov An-148",
"A149":"Agusta AW-149",
"A158":"Antonov An-158",
"A169":"Leonardo AW169",
"A178":"Antonov An-178",
"A189":"Leonardo AW-189",
"A19":"Aeropract A-19",
"A19N":"Airbus A319neo",
"A20":"Douglas A-20 Havoc",
"A205":"Oskbes-Mai MAI-205",
"A20N":"Airbus A320neo",
"A21":"Aeropract A-21 Solo",
"A210":"Aquila A210",
"A211":"Alfa-M A-211",
"A21N":"Airbus A321neo",
"A22":"Sadler A-22 Piranha",
"A223":"Oskbes-Mai MAI-223 Kityonok",
"A23":"Aeropract A-23 Dragon",
"A25":"Aeropract A-25 Breeze",
"A251":"Aviatik-Alyans Aleks-251",
"A27":"Aeropract A-27",
"A270":"Aero Ae-270 Propjet",
"A29":"Avantage A-29",
"A2RT":"Kazan Ansat 2RT",
"A3":"Douglas A-3 Skywarrior",
"A306":"Airbus A300-600",
"A30B":"Airbus A-300B4-2",
"A31":"Avantage A-31 Spectrum",
"A310":"Airbus A310",
"A318":"Airbus A318",
"A319":"Airbus A319",
"A320":"Airbus A320",
"A321":"Airbus A321",
"A33":"Aeropract A-33",
"A332":"Airbus A330-200",
"A333":"Airbus A330-300",
"A337":"Airbus A-330-700 Beluga XL",
"A338":"Airbus A330-800",
"A339":"Airbus A330-900",
"A342":"Airbus A-340-200 Prestige",
"A343":"Airbus A340-300",
"A345":"Airbus A-340-500 Prestige",
"A346":"Airbus A340-600",
"A35":"Avantage A-35 Scanner",
"A359":"Airbus A350-900",
"A35K":"Airbus A350-1000",
"A37":"Cessna A-37 Dragonfly",
"A388":"Airbus A380",
"A3ST":"Airbus A-300ST Beluga",
"A4":"A-4 Skyhawk",
"A400":"Airbus A400M Atlas",
"A411":"Oskbes-Mai MAI-411",
"A5":"Icon A5",
"A50":"Ilyushin A-50",
"A500":"Adam A-500 CarbonAero",
"A504":"Avro 504 Replica",
"A6":"Grumman A-6 Intruder",
"A600":"Rotorway A-600 Talon",
"A660":"Thrush 660",
"A700":"Adam A-700 AdamJet",
"A743":"Antonov An-74-300",
"A748":"HS-748 Andover",
"A890":"Oskbes-Mai MAI-890",
"A9":"Rockwell A-9 Quail Commander",
"A900":"Oskbes-Mai MAI-900 Acrobat",
"A910":"Oskbes-Mai MAI-910 Interfly",
"AA1":"Grumman AA-1 Yankee",
"AA37":"Aeropract A-37",
"AA5":"Grumman AA-5 Tiger",
"AAT3":"Aero AT-3",
"AAT4":"Aero AT-4",
"AB11":"Aero Boero AB-115",
"AB15":"Aero Boero AB-150",
"AB18":"Aero Boero AB-180",
"AB95":"Aero Boero AB-95",
"AC10":"Fd-Composites ArrowCopter",
"AC11":"Commander 112/114",
"AC31":"Avicopter AC-311",
"AC33":"Avicopter AC-313",
"AC4":"Light Wing AC-4",
"AC50":"Aero Commander 500",
"AC52":"Aero Commander 520",
"AC56":"Aero Commander 560",
"AC5A":"Nanjing AC-500 Aircar",
"AC68":"Aero Commander 680E",
"AC6L":"Rockwell 685 Commander 685",
"AC72":"Commander 720 Alti Cruiser",
"AC80":"Turbo Commander 680",
"AC90":"Jetprop Commander 840/900",
"AC95":"Jetprop Commander 980/1000",
"ACAM":"Air Cam",
"ACAR":"Auster J-5B Autocar",
"ACED":"Powell P-70 Acey Deucy",
"ACR2":"Acro Sport II",
"ACRD":"Avia Accord",
"ACRO":"Acro Sport Acro-Sport 1",
"ACSR":"Victa Aircruiser",
"AD20":"Nanjing University AD-200",
"ADEL":"Ustinov Adel",
"ADVE":"Auster J-5 Adventurer",
"ADVN":"Adventure Air Adventurer",
"AE45":"Let Aero 45",
"AEA1":"American Eagle A-1",
"AERK":"Aeronca K Scout",
"AEST":"Piper Aerostar",
"AFOX":"Halley Apollo Fox",
"AG02":"Gatard AG-02 Poussin",
"AG04":"Gatard AG-04 Pigeon",
"AG1":"Halley Apollo AG-1 Gyro",
"AG10":"Cirrus SR-10",
"AG14":"Anderson-Greenwood AG-14",
"AG60":"Caiga AG-600 Kunlong",
"AGSH":"Aero-Composites Sea Hawker",
"AI10":"Ikar",
"AIGT":"Auster J-5F Aiglet Trainer",
"AIRD":"Beagle-Auster A-109 Airedale",
"AIRL":"Aeronix Airelle",
"AJ27":"COMAC ARJ21",
"AJET":"Sabca Alpha Jet",
"AKNC":"Baykar Bayraktar Ak\u0131nc\u0131",
"AKOY":"Lisa Akoya",
"AKRO":"Stephens Akro",
"ALBU":"Alaskan Bushmaster",
"ALC1":"Altair Coelho AC-11",
"ALGR":"Lsa America Allegro",
"ALH":"Hindustan ALH Dhruv",
"ALIG":"Arion Lightning",
"ALIZ":"Breguet 1050 Aliz\u00e9",
"ALO2":"Sud SA-318 Alouette 2",
"ALO3":"Hindustan SA-316 Chetak",
"ALPI":"Auster J-5Q Alpine",
"ALSL":"Airlony Skylane",
"ALTO":"Direct Fly Alto",
"AM3":"Atlas AM-3 Bosbok",
"AMX":"AMX Ghibli",
"AN12":"Antonov An-12",
"AN2":"Antonov An-2",
"AN22":"Antonov An-22 Antheus",
"AN24":"Xian Y-7E",
"AN26":"Antonov An-26",
"AN28":"Pzl-Mielec An-28 Bryza",
"AN3":"Antonov An-3",
"AN30":"Antonov An-30",
"AN32":"Antonov An-32 Sutlej",
"AN38":"Antonov An-38",
"AN70":"Antonov An-70",
"AN72":"Antonov An-72",
"AN8":"Antonov An-8",
"ANDR":"Millioud Androm\u00e8de",
"ANGL":"King's 44 Angel",
"ANKA":"TAI Anka",
"ANSN":"Avro 652 Anson",
"ANST":"Kazan Ansat",
"AP20":"Aeroprakt A-20 Vista",
"AP22":"Aeroprakt A-22 Foxbat",
"AP24":"Aeroprakt A-24 Viking",
"AP26":"Aeroprakt A-26 Twin Vista",
"AP28":"Aeroprakt A-28 Victor",
"AP32":"Aeroprakt A-32 Vixxen",
"AP36":"Aeroprakt A-36 Vulcan",
"APM2":"Issoire APM-21 Lion",
"APM3":"Issoire APM-30 Lion",
"APM4":"Issoire APM-40 Simba",
"APUP":"Supapup Aeropup",
"AR1":"AR-1 American Ranger 1",
"AR11":"Aeronca Chief",
"AR15":"Aeronca Sedan",
"AR50":"Aeronca 50 Chief",
"AR5T":"Aeronca 50 Tandem",
"AR65":"Aeronca Super Chief",
"AR6T":"Aeronca Tandem",
"ARES":"Rutan 151 Ares",
"ARV1":"Skycraft ARV Super 2",
"ARVA":"IAI 101 Arava",
"ARWF":"Arrow F Sport",
"AS02":"Ffa AS-202-15 Bravo",
"AS14":"Schleicher ASK-14",
"AS16":"Schleicher ASK-16",
"AS2T":"AS-202-32TP Turbine Bravo",
"AS32":"Airbus Super Puma",
"AS3B":"AS-532A2 Cougar Mk2",
"AS50":"Airbus AS350 AStar",
"AS55":"Airbus AS355 TwinStar",
"AS65":"Airbus AS365 Dolphin",
"AS80":"Starck AS-80 Holiday",
"ASDR":"Wild Ascender",
"ASO4":"Vidor Asso 4 Whisky",
"ASO5":"Vidor Asso 5 Champion",
"ASOX":"Vidor Asso 10 Jewel",
"ASTO":"Tecnam Astore",
"ASTR":"Gulfstream G100/Astra",
"AT1":"Antoniewski AT-1",
"AT2P":"Air Tractor AT-250",
"AT3":"AIDC AT-3 Tzu-Chung",
"AT3P":"Air Tractor AT-301",
"AT3T":"Air Tractor AT-402",
"AT43":"ATR 42-300",
"AT44":"ATR ATR-42-400 Surveyor",
"AT45":"ATR 42-500",
"AT46":"ATR 42-600",
"AT5P":"Air Tractor AT-501",
"AT5T":"Air Tractor AT-502",
"AT6T":"Air Tractor AT-602",
"AT72":"ATR 72",
"AT73":"ATR ATR-72-211",
"AT75":"ATR 72-500",
"AT76":"ATR 72-600",
"AT8T":"Air Tractor AT-802",
"ATAC":"Aircraft Technologies Acro 1",
"ATIS":"Atlantis",
"ATL":"Robin ATL",
"ATLA":"Dassault 1150 Atlantic",
"ATP":"BAe ATP",
"ATTL":"Euronef ATTL-1",
"AU11":"E-3 Auster AOP11",
"AUJ2":"Auster J-2 Arrow",
"AUJ4":"Auster J-4 Archer",
"AURA":"Sunward SA60 Aurora",
"AUS3":"Taylorcraft Auster 3",
"AUS4":"Taylorcraft Auster 4",
"AUS5":"Auster 5",
"AUS6":"Auster AOP6",
"AUS7":"Auster T7",
"AUS9":"Auster AOP9",
"AV68":"Nitsche AVO-68 Samburo",
"AVAM":"Avid Amphibian",
"AVID":"Avid Flyer",
"AVIN":"Avro 594 Avian",
"AVTR":"Aventura",
"AXE":"Skyfly Axe",
"B06":"Bell 206 JetRanger",
"B06T":"Bell 206LT TwinRanger",
"B1":"B-1 Lancer",
"B103":"Beriev Be-103 Bekas",
"B105":"MBB Bo 105",
"B14A":"Bellanca Cruisair",
"B14B":"Downer 14 Bellanca 260",
"B14C":"Bellanca 260A",
"B150":"Winner B-150",
"B17":"Boeing B-17 Flying Fortress",
"B18T":"Volpar Turbo 18",
"B190":"Beechcraft 1900",
"B2":"B-2 Spirit",
"B209":"MBB BO-209 Monsun",
"B21":"Northrop Grumman B-21 Raider",
"B212":"Bell 212",
"B214":"Bell 214A Isfahan",
"B222":"Bell 222",
"B23":"Douglas B-23 Dragon",
"B230":"Bell 230",
"B23E":"Bristell B23 Energic",
"B24":"Consolidated B-24 Liberator",
"B25":"North American B-25 Mitchell",
"B26":"Douglas B-26 Invader",
"B26M":"Martin B-26 Marauder",
"B29":"Boeing B-29 Superfortress",
"B305":"Brantly 305",
"B350":"Beechcraft King Air 350",
"B360":"Yakovlev Aircraft Bear 360",
"B36T":"Beechcraft Turbine Bonanza",
"B37M":"Boeing 737 MAX 7",
"B38M":"Boeing 737 MAX 8",
"B39M":"Boeing 737 MAX 9",
"B3XM":"Boeing 737 MAX 10",
"B407":"Bell 407",
"B412":"Bell 412",
"B427":"Bell 427",
"B429":"Bell 429",
"B430":"Bell 430",
"B461":"BAe 146-100",
"B462":"BAe 146-200",
"B463":"BAe 146-300",
"B47G":"Bell 47",
"B47J":"Bell 47J Ranger",
"B47T":"Soloy Bell 47",
"B505":"Bell 505 Jet Ranger X",
"B52":"B-52 Stratofortress",
"B525":"Bell 525 Relentless",
"B58T":"Beechcraft Baron 58P/TC",
"B60":"Boisavia B-60 Mercurey",
"B609":"Agustawestland AW-609",
"B60T":"60 Royal Turbine Duke",
"B701":"Boeing 707-100",
"B703":"Boeing C-18",
"B712":"Boeing 717",
"B720":"Boeing 720",
"B721":"Boeing C-22",
"B722":"Boeing 727-200",
"B732":"Boeing 737-200",
"B733":"Boeing 737-300",
"B734":"Boeing 737-400",
"B735":"Boeing 737-500",
"B736":"Boeing 737-600",
"B737":"Boeing 737-700",
"B738":"Boeing 737-800",
"B739":"Boeing 737-900",
"B741":"Boeing 747-100",
"B742":"Boeing 747-200",
"B743":"Boeing 747-300",
"B744":"Boeing 747-400",
"B748":"Boeing 747-8",
"B74R":"Boeing 747SR",
"B74S":"Boeing 747SP",
"B752":"Boeing 757-200",
"B753":"Boeing 757-300",
"B762":"Boeing 767-200",
"B763":"Boeing 767-300",
"B764":"Boeing 767-400",
"B772":"Boeing 777-200",
"B773":"Boeing 777-300",
"B778":"Boeing 777-8",
"B779":"Boeing 777-9",
"B77L":"Boeing 777-200LR/777F",
"B77W":"Boeing 777-300ER",
"B788":"Boeing 787-8",
"B789":"Boeing 787-9",
"B78X":"Boeing 787-10",
"BA11":"BAe BAC-111 One-Eleven",
"BABY":"Baby Belle",
"BALL":"Balloon",
"BARC":"Jeffair Barracuda",
"BASS":"Beagle B-206 Basset",
"BBAT":"Bradley BA-100 Aerobat",
"BBIR":"Hovey Beta Bird",
"BCA3":"Buhl CA-3 Sport Airsedan",
"BCAT":"Grumman F8F Bearcat",
"BCMP":"R & B Bearhawk Companion",
"BCS1":"Airbus A220-100",
"BCS3":"Airbus A220-300",
"BD10":"Peregrine PJ-2 Falcon",
"BD17":"Bede BD-17 Nuggett",
"BD4":"Bede BD-4",
"BD5":"Bede BD-5B Micro",
"BD5J":"Bede BD-5J Micro",
"BD5T":"Bede BD-5TP Micro",
"BDOG":"SA-3 Bulldog",
"BE10":"Beechcraft King Air 100",
"BE12":"Beriev Be-12 Tchaika",
"BE17":"Beechcraft Staggerwing",
"BE18":"Beechcraft Model 18",
"BE19":"Beechcraft Sport",
"BE20":"Beechcraft King Air 200",
"BE22":"Beechcraft 220 Denali",
"BE23":"Beechcraft Musketeer",
"BE24":"Beechcraft Sierra",
"BE30":"Beechcraft King Air 300",
"BE32":"Beriev Be-32",
"BE33":"Beechcraft Bonanza 33",
"BE35":"Beechcraft V35 Bonanza",
"BE36":"Beechcraft Bonanza 36",
"BE40":"Beechjet 400",
"BE4W":"Raytheon 400XT Beechjet",
"BE50":"Beechcraft Twin Bonanza",
"BE55":"Beechcraft Baron 55",
"BE56":"Beechcraft 56 Turbo Baron",
"BE58":"Beechcraft Baron 58",
"BE60":"Beechcraft Duke",
"BE65":"Beechcraft Queen Air",
"BE70":"Beechcraft 70 Queen Air",
"BE76":"Beechcraft Duchess",
"BE77":"Beechcraft Skipper",
"BE80":"Beechcraft 80 Zamir",
"BE88":"Beechcraft 88 Queen Air",
"BE95":"Beechcraft Travel Air",
"BE99":"Beechcraft 99",
"BE9L":"Beechcraft King Air 90",
"BE9T":"Beechcraft King Air F90",
"BEA5":"R & B Bearhawk 5",
"BEAR":"Bearhawk",
"BELF":"Short SC-5 Belfast",
"BER2":"Beriev Be-200 Altair",
"BER4":"Beriev A-40 Albatross",
"BETA":"Rollason Beta",
"BEVR":"Asap Beaver",
"BF19":"Podesva Bf-109G-2",
"BFIT":"Bristol F-2B Fighter",
"BILO":"Pena Bilouis",
"BIPL":"EAA Biplane",
"BIRD":"Taylor TA-2 Bird",
"BISC":"SC-07 Speed Cruiser",
"BK17":"Eurocopter-Kawasaki BK-117B",
"BKUT":"Renaissance Berkut",
"BL11":"Bleriot 11 Replica",
"BL17":"Bellanca Viking",
"BL19":"Bellanca 19 Skyrocket",
"BL8":"Champion Decathlon/Scout",
"BLBU":"Ameur Altania",
"BLCF":"747-400LCF Dreamlifter",
"BLEN":"Bristol 149 Blenheim",
"BLKS":"Aircraft Spruce Baby Lakes",
"BLSA":"R & B Bearhawk LSA",
"BM6":"Maranda BM-6 Lark",
"BMAN":"Aak Bushman",
"BN2P":"Britten-Norman Islander",
"BN2T":"BN-2T Turbine Defender",
"BO40":"Boeing 40",
"BOBC":"Tlac Bobcat",
"BOLT":"Steen Skybolt",
"BOOM":"Rutan 202 Boomerang",
"BORY":"Aerovolga Borey",
"BPAT":"R & B Bearhawk Patrol",
"BPUM":"Bortolanza Puma",
"BR14":"Breguet 14 Replica",
"BR23":"BRM Bristell B23",
"BR54":"Barnett BRC-540",
"BR60":"Brumby 600",
"BR61":"Brumby 610 Evolution",
"BR8":"BRM Aero Bristell B8",
"BRAV":"Tecnam P-2004 Bravo",
"BRB2":"Brantly B-2",
"BREZ":"Breezer",
"BROU":"Max Holste MH-1521 Broussard",
"BS60":"Beech-Sferma 60 Marquis",
"BSTP":"Bell 214ST SuperTransport",
"BSWN":"Dronamics Black Swan",
"BT36":"Beechcraft Turbo Bonanza",
"BT7":"Boeing T-7 Red Hawk",
"BTB2":"Baykar Bayraktar TB-2",
"BTB3":"Baykar Bayraktar TB-3",
"BTUB":"Kimbrel Dormoy Bathtub",
"BU20":"Bushmaster 2000",
"BU31":"Dornier DoB\u00fc-131 Jungmann",
"BU33":"CASA 1-133",
"BU81":"Zlin Z-181",
"BUC":"Hawker Siddeley Buccaneer",
"BUCA":"Arnet Pereyra Buccaneer",
"BUSH":"Rainbow Skyreach BushCat",
"BW60":"Blackwing BW-600",
"BW6T":"Blackwing BW-635",
"BX2":"Brandli BX-2 Cherry",
"C02T":"Cessna 402",
"C04T":"Cessna 404",
"C06T":"Cessna 206",
"C07T":"Cessna 207",
"C1":"Kawasaki C-1",
"C101":"CASA C-101 Aviojet",
"C10T":"Turbine P210",
"C119":"C-119 Flying Boxcar",
"C120":"Cessna 120",
"C123":"Fairchild C-123 Provider",
"C130":"C-130 Hercules",
"C135":"Boeing NC-135",
"C140":"Cessna 140",
"C14T":"Cessna 414",
"C15":"McDonnell Douglas YC-15",
"C150":"Cessna 150",
"C152":"Cessna 152",
"C160":"Transall C-160",
"C162":"Cessna 162 Skycatcher",
"C17":"C-17 Globemaster III",
"C170":"Cessna 170",
"C172":"Cessna 172 Skyhawk",
"C175":"Cessna 175 Skylark",
"C177":"Cessna 177 Cardinal",
"C180":"Cessna 180 Skywagon",
"C182":"Cessna 182 Skylane",
"C185":"Cessna 185 Skywagon",
"C188":"Cessna 188 AgWagon",
"C190":"Cessna 190",
"C195":"Cessna 195",
"C2":"Grumman C-2 Greyhound",
"C205":"Cessna 205",
"C206":"Cessna 206 Stationair",
"C207":"Cessna 207 Skywagon",
"C208":"Cessna 208 Caravan",
"C210":"Cessna 210 Centurion",
"C212":"CASA C-212 Aviocar",
"C21T":"Riley Turbine Eagle 421",
"C22J":"C-22J Ventura",
"C240":"Cessna TTx",
"C25A":"Cessna Citation CJ2",
"C25B":"Cessna Citation CJ3",
"C25C":"Cessna Citation CJ4",
"C25M":"Cessna Citation M2",
"C270":"Caudron C-270 Luciole",
"C27J":"C-27J Spartan",
"C295":"Airbus C295",
"C303":"Cessna 303 Crusader",
"C306":"CEA-306 CB-10 Triathlon",
"C309":"Cea-Ufmg CEA-309 Mehari",
"C30J":"C-130J Super Hercules",
"C310":"Cessna 310",
"C311":"Cea-Ufmg CEA-311 Anequim",
"C320":"Cessna 320 Skyknight",
"C335":"Cessna 335",
"C336":"Cessna 336 Skymaster",
"C337":"Cessna 337 Skymaster",
"C340":"Cessna 340",
"C365":"Ekw C-3605",
"C402":"Cessna 402",
"C404":"Cessna 404 Titan",
"C408":"Cessna SkyCourier",
"C411":"Cessna 411",
"C414":"Cessna 414 Chancellor",
"C42":"Ikarus C42",
"C421":"Cessna 421 Golden Eagle",
"C425":"Cessna 425 Conquest I",
"C441":"Cessna 441 Conquest II",
"C46":"Curtiss C-46 Commando",
"C500":"Cessna Citation I",
"C501":"Cessna Citation I/SP",
"C510":"Cessna Citation Mustang",
"C525":"Cessna CitationJet CJ1",
"C550":"Cessna Citation II/Bravo",
"C551":"Cessna Citation II/SP",
"C55B":"Cessna Citation Bravo",
"C560":"Cessna Citation V/Encore",
"C56X":"Cessna Citation Excel/XLS",
"C5M":"C-5M Super Galaxy",
"C650":"Cessna Citation III/VI/VII",
"C680":"Cessna Citation Sovereign",
"C68A":"Cessna Citation Latitude",
"C700":"Cessna Citation Longitude",
"C72R":"Cessna 172RG Cutlass",
"C750":"Cessna Citation X",
"C77R":"Cessna 177RG Cardinal",
"C82":"Fairchild C-82 Packet",
"C82R":"Cessna R182 Skylane RG",
"C82S":"Cessna T182 Skylane",
"C82T":"Cessna TR182 Skylane RG",
"C919":"COMAC C919",
"C97":"Boeing C-97 Stratofreighter",
"CA12":"Comp Air 12",
"CA19":"Commonwealth CA-19 Boomerang",
"CA1P":"Aerocomp CA-10 Comp Air 10",
"CA1T":"Aerocomp CA-10T Comp Air 10T",
"CA25":"Commonwealth CA-25 Winjeel",
"CA3":"Aerocomp CA-3 Comp Air 3",
"CA4":"Aerocomp CA-4 Comp Air 4",
"CA41":"Corvus CA-41 Racer",
"CA6":"Aerocomp CA-6 Comp Air 6",
"CA61":"Cvjetkovic CA-61 Mini Ace",
"CA65":"Cvjetkovic CA-65 Skyfly",
"CA7P":"Aerocomp CA-7P Comp Air 7P",
"CA7T":"Aerocomp CA-7T Comp Air 7T",
"CA8":"Aerocomp CA-8 Comp Air 8",
"CA9":"Comp Air 9",
"CABI":"Carbon Bird",
"CABN":"Paramount Cabinaire",
"CAD2":"Class Bush Caddy R-120",
"CAD4":"Class Bush Caddy L-164",
"CAML":"Sopwith Camel",
"CAMP":"Pietenpol Air Camper",
"CAN4":"Campana AN-4",
"CAPL":"Capella",
"CAR":"Aerocar",
"CARV":"ATL-98 Carvair",
"CASS":"Cassutt 3M",
"CAT":"Consolidated 28 Catalina",
"CAT1":"MPA Aerocat SR",
"CAT2":"MPA Aerocat TR",
"CAW":"Cessna AW",
"CB1":"Hatz Biplane",
"CC11":"CubCrafters Carbon Cub",
"CC19":"CubCrafters XCub",
"CD2":"CD-2 Seastar",
"CDC6":"Cessna DC-6",
"CDUS":"Rotorsport Calidus",
"CDW1":"Chilton DW-1",
"CE15":"Chernov Che-15",
"CE22":"Hydroplane Che-22 Pelican",
"CE23":"Chernov Che-23",
"CE25":"Chernov Che-25",
"CE27":"Chernov Che-27",
"CE43":"Cerva CE-43 Guepard",
"CEL5":"Otto Celera 500L",
"CELR":"Mirage Celerity",
"CENT":"Found 100 Centennial",
"CFRE":"Colyaer Freedom",
"CG3":"Caudron G-3 Replica",
"CGAN":"Colyaer Gannet",
"CH10":"Zenair CH-100 Mono-Z",
"CH12":"Cicare CH-12",
"CH14":"Cicare CH-14 Aguilucho",
"CH15":"Zenair CH-150 Acro-Z",
"CH18":"Zenair CH-180 Super Acro-Z",
"CH20":"Zenair CH-200 Z\u00e9nith",
"CH25":"Zenair CH-250 Z\u00e9nith",
"CH2T":"Amd CH-2000 Z\u00e9nith",
"CH3":"Chrislea CH-3 Skyjeep",
"CH30":"Zenair CH-300 Tri-Z",
"CH40":"Champion 402 Lancer",
"CH50":"Zenair CH-50 Mini-Z",
"CH60":"Zenith Zodiac CH 601",
"CH62":"Zenair CH-620 Gemini",
"CH64":"Zenair CH-640 Zodiac",
"CH65":"Zenith Zodiac CH 650",
"CH7":"Heli-Sport CH-7 Kompress",
"CH70":"Zenith STOL CH 701",
"CH75":"Zenith STOL CH 750",
"CH7A":"Aeronca Champ",
"CH7B":"Champion Citabria",
"CH80":"CH-8000 Shark",
"CHAN":"Cadcor Chanute",
"CHCS":"Noin Choucas",
"CHIC":"Podesva Chico",
"CHIF":"Pawnee Chief",
"CHIN":"Asap Chinook",
"CHIP":"Super-Chipmunk",
"CHP2":"Belite CH-2A Chipper 2",
"CHR1":"Elmwood CA-05 Christavia Mk1",
"CHR4":"Elmwood CH-8 Christavia Mk4",
"CHSY":"Chayair Sycamore",
"CICA":"Hydroplane Cicada",
"CJ1":"Corby CJ-1 Starlet",
"CJ6":"Nanchang CJ-6",
"CKUO":"AIDC F-CK-1 Ching-Kuo",
"CL2P":"Canadair CL-215",
"CL2T":"Canadair CL-215T",
"CL30":"Bombardier Challenger 300",
"CL35":"Bombardier Challenger 350",
"CL41":"Canadair CL-41 Tutor",
"CL4G":"Canadair CL-44-O Guppy",
"CL60":"Bombardier Challenger 600",
"CLA":"Callair A-2",
"CLB1":"Rockwell B-1 Snipe Commander",
"CLBR":"Fisher Celebrity",
"CLD2":"Rotortec Cloud Dancer 2",
"CLDS":"Rearwin 8090 Cloudster",
"CLON":"AutoGyro Cavalon",
"CMA3":"Colyaer Martin 3",
"CMAS":"Cessna C-38 Airmaster",
"CMD1":"Air Command Commander 147",
"CMDE":"Commander Elite Side-by-Side",
"CMDT":"Commander Elite Tandem",
"CN12":"Circa Nieuport 12-7/8",
"CN35":"Airbus CN235",
"CNBR":"Short Canberra",
"CNDR":"General Avia F-20TP Condor",
"CNUK":"Fleet 80 Canuck",
"CO50":"Cobalt Co-50 Valkyrie",
"COAR":"Cobra Arrow",
"COBR":"Deborde-Rolland Cobra",
"COL3":"Cessna 350 Corvalis",
"COL4":"Cessna 400 Corvalis TT",
"COLT":"Texas Aircraft Colt",
"COMU":"Tamarind H-1 Commuter",
"CONI":"Lockheed C-121 Constellation",
"COOT":"Aerocar Coot",
"CORO":"Corvus Corone",
"CORR":"Sivel SD-27 Corriedale",
"CORS":"Chance Vought AU Corsair",
"CORV":"Wolfsberg Corvus",
"COUG":"Acro Sport Cougar",
"COUR":"Helio Courier",
"COY2":"Rans S-6 Coyote II",
"COZJ":"Co-Z CozyJet",
"COZY":"Cozy",
"CP10":"Mudry CAP-10",
"CP13":"Piel CP-1310 Super Emeraude",
"CP20":"Mudry CAP-20",
"CP21":"Mudry CAP-21",
"CP22":"Giles G-222",
"CP23":"Mudry CAP-230",
"CP30":"Piel CP-30 Emeraude",
"CP32":"Piel CP-320 Super Emeraude",
"CP60":"Piel CP-60 Diamant",
"CP65":"Porterfield CP-65 Collegiate",
"CP75":"Piel CP-750 B\u00e9ryl",
"CP80":"Piel CP-80 Z\u00e9phir",
"CP90":"Piel CP-90 Pinocchio 2",
"CPNA":"Pena Capena",
"CPUP":"Culp Sopwith Pup",
"CR10":"Dyn'aero CR-100",
"CRBN":"Curtiss 50 Robin",
"CRER":"Rans S-7 Courier",
"CRES":"Pacific Aerospace Cresco",
"CRIO":"Microleve Corsario",
"CRJ1":"Bombardier CRJ100",
"CRJ2":"Bombardier CRJ200",
"CRJ7":"Bombardier CRJ700",
"CRJ9":"Bombardier CRJ900",
"CRJX":"Bombardier CRJ1000",
"CRUZ":"SportCruiser",
"CT4":"CT-4 Airtrainer",
"CTAH":"Rainbow Skyreach Cheetah",
"CTLN":"Fly Synthesis Catalina",
"CUB2":"Aces High Cuby 2",
"CUCA":"Culver Cadet",
"CUDA":"Lancair NLA-275 Barracuda",
"CULP":"Culp Special",
"CULV":"Culver V",
"CULX":"Fisher Aero Culex",
"CVLP":"Convair CV-240 Convairliner",
"CVLT":"Convair C-131H",
"CX5":"Thatcher CX-5",
"CYGT":"Hawker Cygnet",
"D1":"Wing D-1 Derringer",
"D11":"Jodel D11",
"D139":"Dorna D-139 Blue Bird",
"D140":"San D-140 Mousquetaire",
"D150":"San D-150 Mascaret",
"D18":"Jodel D-18",
"D201":"D'apuzzo D-201 Sportwing",
"D21":"Fokker D-21 Replica",
"D228":"Dornier 228",
"D24":"Albaviation D-24 MagicONE",
"D25":"New Standard D-25",
"D250":"Centre Est DR-250 Capitaine",
"D253":"Centre Est DR-253 Regent",
"D28D":"Dornier 128-2 Skyservant",
"D28T":"128-6 Turbo Skyservant",
"D31":"Rollason D-31 Turbulent",
"D328":"Dornier 328",
"D39":"Akaflieg Darmstadt D-39",
"D4":"Auster D-4",
"D5":"Beagle D-5 Husky",
"D5TU":"Druine D-5 Turbi",
"D6":"Auster D-6",
"D6CR":"Druine D-60 Condor",
"D7":"Fokker D-7 Replica",
"D8":"Fokker D-8 Replica",
"DA2":"Davis DA-2",
"DA36":"Diamond DA-36 E-Star",
"DA40":"Diamond DA40",
"DA42":"Diamond DA42 Twin Star",
"DA5":"Davis DA-5",
"DA50":"Diamond DA-50",
"DA62":"Diamond DA62",
"DAHU":"Pena Dahu",
"DAKH":"Fisher Dakota Hawk",
"DAL1":"Spezio DAL-1 Tuholer",
"DAL4":"Ul-Jih Fascination",
"DAL5":"Ul-Jih Evolution",
"DART":"Parrish Dart",
"DC10":"McDonnell Douglas DC-10",
"DC2":"Douglas DC-2",
"DC3":"Douglas DC-3",
"DC3S":"Douglas Super DC-3",
"DC3T":"Jet Prop DC-3",
"DC4":"Douglas DC-4",
"DC6":"Douglas DC-6",
"DC7":"Douglas DC-7 Seven Seas",
"DC86":"McDonnell Douglas DC-8-60",
"DC87":"McDonnell Douglas DC-8-70",
"DC91":"McDonnell Douglas DC-9-10",
"DC92":"McDonnell Douglas DC-9-20",
"DC93":"McDonnell Douglas DC-9-30",
"DC94":"McDonnell Douglas DC-9-40",
"DC95":"McDonnell Douglas DC-9-50",
"DDUC":"Bakeng Double Duce",
"DEAG":"Amax Double Eagle",
"DEFI":"Rutan 40 Defiant",
"DF10":"Delfin 10 Karas",
"DF1M":"Delfin 10M R-Line",
"DF2":"Delfin 2",
"DF3":"Delfin 3",
"DFL6":"Damoure-Fabre DFL-6 Saphir",
"DFLY":"Dragonfly",
"DG15":"Howard DGA-15",
"DH2T":"De Havilland Turbo Beaver",
"DH3T":"De Havilland Turbo Otter",
"DH4T":"DHC-4 Turbo Caribou",
"DH60":"De Havilland DH-60 Moth",
"DH80":"De Havilland DH-80 Puss Moth",
"DH82":"De Havilland Tiger Moth",
"DH83":"De Havilland DH-83 Fox Moth",
"DH84":"De Havilland DH-84 Dragon",
"DH85":"DH-85 Leopard Moth",
"DH87":"DH-87 Hornet Moth",
"DH88":"DH-88 Comet Replica",
"DH89":"DH-89 Dragon Rapide",
"DH8A":"De Havilland Dash 8-100",
"DH8B":"De Havilland Dash 8-200",
"DH8C":"De Havilland Dash 8-300",
"DH8D":"De Havilland Dash 8-400",
"DH90":"De Havilland DH-90 Dragonfly",
"DH94":"DH-94 Moth Minor",
"DHA3":"DHA-3 Drover",
"DHC1":"De Havilland Chipmunk",
"DHC2":"De Havilland Beaver",
"DHC3":"De Havilland Otter",
"DHC4":"DHC-4 Caribou",
"DHC5":"DHC-5 Buffalo",
"DHC6":"De Havilland Twin Otter",
"DHC7":"DHC-7 Dash 7",
"DIES":"Pennec-Lucas Dieselis",
"DIMO":"Diamond Dimona",
"DJIN":"Sud SO-1221 Djinn",
"DNGO":"Aeroric Dingo",
"DO27":"Dornier Do-27",
"DO28":"Dornier Do-28B Agur",
"DOCX":"ES-3 Doc's RX",
"DON":"Unikomtranso Don",
"DOVE":"De Havilland DH-104 Dove",
"DR1":"Fokker Dr-1 Replica",
"DR10":"DR-100 Ambassadeur",
"DR22":"Centre Est DR-221 Dauphin",
"DR30":"Robin DR-300",
"DR40":"Robin DR400",
"DRAG":"Dragon Fly",
"DRIF":"Austflight Drifter",
"DRON":"Drone",
"DRTG":"Culver Dart G",
"DSA1":"Smith Miniplane",
"DSK":"Killingsworth DSK-1 Hawk",
"DSLK":"Driggs Skylark",
"DT45":"Diamond DART-450",
"DTA1":"Verhees D-1 Delta",
"DTA2":"Verhees D-2 Delta",
"DUB2":"Taifun DMZ-2 Osa",
"DUCE":"Bakeng Duce",
"DUR5":"Durand Mk5",
"DV1":"Dova DV-1 Skylark",
"DV2":"Dova DV-2 Infinity",
"DV20":"Diamond DA20 Katana",
"DW1":"Bellanca DW-1 Eagle",
"DWD2":"Ekw D-26",
"DYH2":"Dynali H-2",
"DYH3":"Dynali H-3 Sport",
"E110":"Embraer EMB-110 Bandeirante",
"E120":"Embraer EMB-120 Brasilia",
"E121":"Embraer EMB-121 Xingu",
"E135":"Embraer ERJ 135",
"E145":"Embraer ERJ 145",
"E170":"Embraer 170",
"E190":"Embraer 190",
"E195":"Embraer 195",
"E2":"Grumman E-2 Hawkeye",
"E200":"Extra EA-200",
"E230":"Extra EA-230",
"E275":"Embraer E175-E2",
"E290":"Embraer E190-E2",
"E295":"Embraer E195-E2",
"E2CB":"Taylor E-2 Cub",
"E300":"Extra 300",
"E314":"Embraer EMB-314 Super Tucano",
"E350":"Cessna E350",
"E35L":"Embraer Legacy 600/650",
"E390":"Embraer C-390 Millennium",
"E3CF":"Boeing E-3A Sentry",
"E3TF":"E-3 Sentry",
"E400":"Extra EA-400",
"E45X":"Embraer ERJ 145XR",
"E500":"Extra EA-500",
"E50P":"Embraer Phenom 100",
"E530":"Cessna E530 Scorpion",
"E545":"Embraer Praetor 500",
"E550":"Embraer Praetor 600",
"E55P":"Embraer Phenom 300",
"E6":"E-6 Mercury",
"E737":"Boeing 737-700 Wedgetail",
"E75L":"Embraer 175",
"E75S":"Embraer 175",
"E767":"Boeing E-767",
"EA40":"Eclipse 400",
"EA50":"Eclipse 500",
"EAEA":"Grosso Easy Eagle",
"EAGL":"Aviat Eagle",
"EAGX":"Eagle 100",
"EBOY":"FMA 20 El Boyero",
"EC20":"Airbus EC120",
"EC25":"Airbus H225 Super Puma",
"EC30":"Airbus EC130",
"EC35":"Airbus EC135",
"EC45":"Airbus EC145",
"EC55":"Airbus H-155",
"EC6":"Croses EC-6 Criquet",
"EC75":"H-175",
"ECHO":"Tecnam P92 Echo",
"EDGE":"Zivko Edge 540",
"EDGT":"Zivko Edge 540 T",
"EF2":"Bye Aerospace eFlyer 2",
"EFAN":"Airbus E-Fan",
"EFOX":"AeroTrek A240",
"EFUS":"Magnus MG-11 eFusion",
"EGL3":"Rotorway Eagle 300T",
"EGRT":"Grob D-500 Egrett 2",
"EH10":"Agustawestland EH-101 Merlin",
"EL10":"Ela Aviacion ELA-10 Eclipse",
"EL20":"Elitar IE-202",
"ELA7":"Ela Aviacion ELA-07 Agro",
"ELF":"Parnall Elf",
"ELPS":"Explorer Ellipse",
"ELSP":"A2 Cz Ellipse Spirit",
"ELST":"Putzer Elster",
"ELTO":"El Tomcat",
"ELTR":"Elitar",
"EM10":"Marganski EM-10 Bielik",
"EM11":"Marganski EM-11 Orka",
"EN28":"Enstrom F-28",
"EN48":"Enstrom 480",
"EP9":"Lancashire EP-9 Prospector",
"EPER":"Epervier",
"EPIC":"Epic E1000",
"EPX1":"Epervier X-1",
"ERAC":"Dickey E-Racer",
"ERCO":"Ercoupe",
"ES11":"Aviotecnica ES-101 Exec",
"ES13":"Early Bird Spad 13 80%",
"ESCA":"Epic Escape",
"ESCP":"Tlac Sherwood Scout",
"ETAR":"Dassault Etendard 4",
"EUFI":"Airbus Typhoon",
"EUPA":"Europa",
"EURT":"Fft Eurotrainer 2000",
"EV55":"Evektor EV-55 Outback",
"EV97":"Evektor EuroStar",
"EVAN":"Evangel",
"EVOP":"Lancair Evolution Piston",
"EVOT":"Evolution",
"EVSS":"Evektor SportStar",
"EX5T":"Aea Explorer 500T",
"EXEC":"RotorWay Exec",
"EXEJ":"Rotorway JetExec",
"EXNG":"Extra NG",
"EXPL":"MD-900 Explorer",
"EXPR":"Express",
"EZFL":"Aerocomp E-Z Flyer",
"EZFT":"Blue Yonder Twin E-Z Flyer",
"EZHV":"Blue Yonder E-Z Harvard",
"EZKC":"Blue Yonder E-Z King Cobra",
"F1":"Mitsubishi F-1",
"F100":"Fokker 100",
"F104":"Lockheed F-104 Starfighter",
"F117":"Lockheed F-117 Night Hawk",
"F13":"Junkers F-13 Replica",
"F14":"Grumman F-14 Tomcat",
"F15":"F-15 Eagle",
"F156":"MS-500 Criquet",
"F16":"F-16 Fighting Falcon",
"F18H":"F/A-18 Hornet",
"F18S":"F/A-18 Super Hornet",
"F1FV":"Avion F-1 Favorit",
"F2":"Mitsubishi F-2",
"F22":"F-22 Raptor",
"F260":"SIAI-Marchetti SF.260",
"F26T":"Siai-Marchetti SF-260T",
"F27":"Fokker F-27 Friendship",
"F28":"Fokker F-28 Fellowship",
"F2TH":"Dassault Falcon 2000",
"F30":"Golden Car F-30 Brio",
"F35":"F-35 Lightning II",
"F3F":"Grumman F3F Replica",
"F4":"F-4 Phantom 2",
"F402":"Falcon 402",
"F406":"Cessna F406 Vigilant",
"F41E":"Aerosamara F-41 El'brus",
"F421":"Falcon 421",
"F5":"Northrop F-5 Freedom Fighter",
"F50":"Fokker 50 Fokker50Freighter",
"F5SA":"Iriaf S-100 Saeghe",
"F60":"Fokker 60",
"F600":"SF-600 Canguro",
"F7":"Fokker F-7 Replica",
"F70":"Fokker 70",
"F8":"Chance Vought F8 Crusader",
"F86":"Canadair CL-13 Sabre",
"F8L":"Aviamilano F-8L Falco",
"F900":"Dassault Falcon 900",
"F9F":"Grumman F9F Panther",
"FA01":"Fl\u00e4ming Air FA-01 Saphir",
"FA02":"FA-02 Smaragd VLA",
"FA03":"FA-03 Smaragd TMG",
"FA04":"Fl\u00e4ming Air FA-04 Peregrine",
"FA10":"Dassault Falcon 10",
"FA11":"Fairchild F-11 Husky",
"FA20":"Dassault Falcon 20",
"FA24":"Fairchild 24",
"FA50":"Dassault Falcon 50",
"FA62":"Fairchild PT-19",
"FA6X":"Dassault Falcon 6X",
"FA7X":"Dassault Falcon 7X",
"FA8X":"Dassault Falcon 8X",
"FAET":"Atec 321 Faeta",
"FALC":"American Aircraft Falcon XP",
"FALM":"Miles M-3 Falcon Major",
"FANL":"Rhein FL-1 Fanliner",
"FANT":"Rhein Fantrainer",
"FB1A":"Bowers Fly Baby",
"FB1B":"Bowers Fly Baby 1B",
"FB5":"Euro-Fly FB-5 Star Light",
"FBA2":"Found FBA-2 Expedition E350",
"FC1":"Chengdu FC-1 Xiaolong",
"FD2E":"Flight Design F-2e",
"FDCT":"Flight Design CT",
"FDF2":"Flight Design F-2",
"FDMC":"Flight Design MC",
"FE51":"Fighter Escort Wings P-51",
"FEST":"Aerostar 01 Festival",
"FFLY":"Fairey Firefly",
"FG01":"Farigoux FG-01 Origan",
"FGT":"Midwest Aerosport Formula GT",
"FH11":"RH-1100 Hornet",
"FIBO":"Firebolt Convertible",
"FIKD":"Fike D",
"FIKE":"Fike E",
"FINC":"Fleet 16 Finch",
"FJ10":"Aerostar FJ-100",
"FJR3":"Fajr F-3",
"FK12":"B & F Technik FK-12 Comet",
"FK14":"B & F Technik FK-14 Polaris",
"FK9":"B&F FK9",
"FL3":"Lombardi FL-3 Aviastarlet",
"FL53":"Meteor FL-53",
"FL54":"Meteor FL-54",
"FL55":"Meteor FL-55",
"FLAM":"Dassault MD-311 Flamant",
"FLCO":"Leonardo Falco",
"FLE2":"Fleet 2",
"FLE7":"Fleet 7 Fawn",
"FLIZ":"Flitzer",
"FLSH":"Euro-Fly Flash",
"FLSS":"Flyer NG",
"FM25":"FM-250 Vampire",
"FMGO":"Aak Flamingo",
"FN33":"FN-333 Riviera",
"FNKB":"Funk B",
"FOOF":"Stewart JD-2 Foo Fighter",
"FORT":"Fleet 60 Fort",
"FOUG":"IAI CM-170R Magister",
"FOX":"Skyfox CA-25 Impala",
"FOXT":"Team Tango Gavil\u00e1n",
"FRBD":"H-03 Firebird",
"FREE":"Cabrinha 423 Free Spirit",
"FREL":"SA-321 Super Frelon",
"FRNT":"Sky Raider Frontier",
"FRON":"Frontier MD-2",
"FS35":"FS-35 Harpyie",
"FS51":"Falconar SAL P-51D Mustang",
"FT30":"Nanjing University FT-300",
"FU24":"Fletcher FU-24",
"FURY":"Hawker Fury",
"FUSI":"Magnus MG-11 Fusion",
"FW02":"Flywhale",
"FW44":"FMA Fw-44 Stieglitz",
"FW90":"Focke-Wulf Fw-190 Replica",
"FWSB":"Fleetwings F-4 Sea Bird",
"FX1":"Innovaviation FX-1",
"G1":"G1 Aviation G-1 Spyl",
"G109":"Grob G 109",
"G115":"Grob G 115",
"G120":"Grob G-120 Snunit",
"G12T":"Grob G-120TP",
"G140":"Grob G-140TP",
"G150":"Gulfstream G150",
"G159":"Grumman G-159 Gulfstream 1",
"G15T":"Grob G-115T Acro",
"G160":"Grob G-160 Ranger",
"G164":"Grumman Ag Cat",
"G180":"G1-80 Skyfarer",
"G200":"Giles G-200",
"G202":"Giles G-202",
"G21":"Grumman G-21A Goose",
"G21M":"McKinnon G-21C Goose",
"G21T":"McKinnon G-21E Turbo Goose",
"G222":"Alenia G-222",
"G280":"Gulfstream G280",
"G2CA":"Guimbal Cabri G2",
"G2GL":"Soko G-2 Galeb",
"G2T1":"Great Lakes 2T-1",
"G3":"Remos G-3",
"G44":"Grumman Widgeon",
"G46":"Fiat G-46",
"G4SG":"Soko G-4 Super Galeb",
"G59":"Fiat G-59",
"G64T":"Schweizer G-164 Turbo Ag-Cat",
"G70":"Groppo G-70",
"G73":"Grumman G-73 Mallard",
"G73T":"Grumman G-73T Turbo Mallard",
"G800":"Grinvalds G-801 Orion",
"G91":"Fiat G-91R",
"G96":"Grumman G-96 Trader",
"G97":"SAI G-97 Spotter",
"GA10":"Gippsaero GA-10",
"GA20":"Gippsland GA-200 Fatman",
"GA3C":"IAI Gulfstream G300",
"GA4C":"Gulfstream G400",
"GA5C":"Gulfstream G500",
"GA6C":"Gulfstream G600",
"GA7":"Socata TB-360 Tangara",
"GA7C":"Gulfstream G700",
"GA8":"GippsAero Airvan",
"GA8C":"Gulfstream G800",
"GABR":"Blackshape BS-115 Gabriel",
"GALX":"Gulfstream G200",
"GANT":"Fairey Gannet",
"GAUN":"Gloster Gauntlet",
"GAVI":"Gavilan 358",
"GAZL":"Soko H-45 Partizan",
"GB1":"GameBird GB1",
"GBSP":"Beets GB Special",
"GC1":"Globe Swift",
"GDUK":"Ellison-Mahon Gweduck",
"GEMI":"Miles M-65 Gemini",
"GENI":"Ifb E-Genius",
"GEPE":"Aero Services Gu\u00eape",
"GJ11":"Hongdu GJ-11 Sharp Sword",
"GL5T":"Bombardier Global 5000",
"GL7T":"Bombardier Global 7500",
"GLAD":"Gloster Gladiator",
"GLAS":"Glasair",
"GLEX":"Bombardier Global 6000",
"GLF2":"Gulfstream II",
"GLF3":"Gulfstream III",
"GLF4":"Gulfstream IV",
"GLF5":"Gulfstream V",
"GLF6":"Gulfstream G650",
"GLID":"Glider",
"GLSP":"New Glastar Sportsman 2+2",
"GLST":"GlaStar",
"GLTU":"Turbine Glasair",
"GM17":"Intracom GM-17 Viper",
"GMGC":"Ibis GS-750 Grand Magic",
"GNAT":"Hawker Siddeley Gnat",
"GOBU":"Butterfly",
"GOLF":"Tecnam P-96 Golf",
"GOOS":"Quikkit Glass Goose",
"GP1":"Skyleader GP One",
"GP3":"Pereira GP-3 Osprey 2",
"GP4":"Pereira GP-4",
"GPRO":"Genevation GenPro",
"GR51":"Exclusive P-51G Grand 51",
"GRFN":"Griffon",
"GRIF":"Canada Air Rv Griffin",
"GRIZ":"Aerotek Turbo Grizzly",
"GSIS":"Slipstream Genesis",
"GSPN":"Grob G-180 SPn Utility Jet",
"GUEP":"Aero Services Guepard",
"GURI":"Aeromot AMT-600 Guri",
"GX":"Remos GX",
"GY10":"Gardan GY-100 Bagheera",
"GY20":"Maranda BM-4",
"GY30":"Cab GY-30 Supercab",
"GY80":"Socata GY-80 Horizon",
"GYRO":"Gyroplane",
"H111":"CASA 2-111",
"H12T":"Hiller UH-12ET",
"H160":"Airbus H-160",
"H2":"Kaman K-20 Seasprite",
"H202":"Hb-Aircraft HB-202 Fledger",
"H207":"Hb-Flugtechnik HB-207 Alfa",
"H21":"Vertol CH-21 Work horse",
"H25A":"Hawker Siddeley 125",
"H25B":"Hawker 800",
"H25C":"Hawker 1000",
"H269":"Schweizer 300",
"H40":"Hoffmann H-40",
"H43A":"Kaman H-43A",
"H43B":"Kaman HH-43B Huskie",
"H46":"Boeing CH-46 Sea Knight",
"H47":"CH-47 Chinook",
"H500":"MD 500",
"H53":"Sikorsky RH-53 Sea Stallion",
"H53S":"CH-53E Super Stallion",
"H60":"UH-60 Black Hawk",
"H64":"AH-64 Apache",
"HA2":"Hollmann HA-2 Sportster",
"HA31":"Hindustan HA-31 Basant",
"HA4T":"Hawker 4000",
"HAHU":"HH-1 Hawker Hurricane",
"HANS":"Taneja Hansa",
"HAR":"AV-8 Harrier",
"HAW3":"Groen H2X Hawk 3",
"HAWK":"BAE Hawk",
"HB21":"Brditschka HB-21 Hobbyliner",
"HB23":"Brditschka HB-23 Scanliner",
"HB3":"Brditschka HB-3",
"HCAT":"Grumman F6F Hellcat",
"HD34":"Hurel-Dubois HD-34",
"HDJT":"HondaJet",
"HEAD":"Stewart JD-1 Headwind",
"HERN":"De Havilland DH-114 Heron",
"HF20":"MBB HFB-320 Hansa",
"HI27":"Hirth Hi-27 Acrostar",
"HIGH":"Just Highlander",
"HIND":"Hawker Hind",
"HL2":"Lambach HL-2 Replica",
"HLC4":"Halberstadt CL-4 Replica",
"HLD4":"Halberstadt D-4 Replica",
"HM38":"Falconar HM-380 Ladybug",
"HN70":"Nicollier HN-700 Menestrel 2",
"HORN":"Wallerkowski Hornisse",
"HORZ":"Fisher Horizon",
"HR10":"Robin HR-100 Royal",
"HR20":"Robin HR-200 Acrobin",
"HRM9":"Elbit Hermes 900",
"HRNT":"Aak Hornet",
"HROC":"Harmon Rocket",
"HRON":"IAI Heron",
"HSMT":"Rotorsmart HeliSmart",
"HT16":"Hindustan HJT-16 Kiran",
"HT2":"Hindustan HT-2",
"HT36":"Hindustan HJT-36 Sitara",
"HT40":"Hindustan HTT-40",
"HU1":"HU-1 Seagull",
"HU2":"HU-2 Petrel",
"HUCO":"Bell 209 HueyCobra",
"HUML":"Hummel Bird",
"HUNT":"Hawker Hunter",
"HURI":"Hawker Hurricane",
"HURK":"TAI TT-32 H\u00fcrku\u015f",
"HUSK":"Aviat Husky",
"HW4P":"Groen Hawk 4",
"HW4T":"Groen Jet Hawk 4T",
"HX2":"Helowerks HX-2 Wasp",
"HYPR":"P&m Aviation HypR",
"I103":"Ilyushin Il-103",
"I112":"Ilyushin Il-112",
"I114":"Ilyushin Il-114",
"I115":"Aisa I-115",
"I11B":"Aisa I-11B Peque",
"I153":"Polikarpov I-153",
"I15B":"Polikarpov I-15bis",
"I16":"Polikarpov I-16",
"I22":"Pzl-Mielec I-22 Iryda",
"I23":"Pzl-Swidnik I-23 Manager",
"I3":"Interavia I-3",
"I66":"Voliamo I-96 San Francesco",
"IA46":"Dinfia IA-46 Ranquel",
"IA58":"FMA IA-58 Pucar\u00e1",
"IA63":"FMA IA-63 Pampa",
"IFUR":"Isaacs Fury",
"IL14":"Ilyushin Il-14",
"IL18":"Ilyushin Il-18 Bizon",
"IL28":"Harbin H-5",
"IL38":"Ilyushin Il-38",
"IL62":"Ilyushin Il-62",
"IL76":"Ilyushin Il-76",
"IL86":"Ilyushin Il-86",
"IL96":"Ilyushin Il-96",
"IMPU":"Impulse Xcite",
"INCQ":"Inpaer Conquest",
"INEC":"Inpaer Excel",
"INEX":"Inpaer Explorer",
"INTG":"Aura Aero Integral R",
"ION":"Ion",
"IP06":"Ipe IPE-06 Curucaca",
"IP10":"Ipe IPE-010",
"IP26":"Ipai IPAI-26 Tuca",
"IP6A":"Ipe IPE-06A",
"IPAN":"Embraer U-19 Ipanema",
"IR22":"Ica IAR-822",
"IR23":"Ica IAR-823",
"IR24":"Ica IAR-824",
"IR25":"Ica IAR-825TP Triumf",
"IR27":"Ica IAR-827 Dacic",
"IR28":"Ica IS-28MA",
"IR46":"Iar IAR-46 Katty",
"IR99":"Avioane IAR-99 Soim",
"IRBS":"Kubicek M-4 Irbis",
"IS2":"Instytut Lotnictwa IS-2",
"IS28":"Ica IS-28M2",
"ISAT":"Aerojames 01 Isatis",
"ISPT":"Isaacs Spitfire",
"J1":"Auster J-1 Autocrat",
"J10":"Chengdu J-10",
"J177":"Aerodynos JA-177 Pingouin",
"J2":"Piper J-2 Cub",
"J20":"Chengdu J-20",
"J3":"Piper J-3 Cub",
"J300":"Alms J-300 Joker",
"J328":"Dornier 328JET",
"J4":"Piper J-4 Cub Coupe",
"J400":"JA-400 Skyleader 400",
"J40E":"JA-400 Skyleader 400",
"J4B2":"Barnett J4B2",
"J5":"Piper J-5 Cub Cruiser",
"J600":"JA-600 Skyleader 600",
"J8A":"Shenyang J-8A",
"J8B":"Shenyang J-8B",
"JAB2":"Jabiru J160",
"JAB4":"Jabiru J430",
"JABI":"Jabiru SK",
"JACE":"Acro Sport Junior Ace",
"JAG2":"JAG",
"JAGR":"Hindustan Jaguar",
"JAJ5":"Marco",
"JAJ6":"J & As J-6 Fregata",
"JARO":"Jackaroo",
"JAS4":"Joby JAS-4",
"JAST":"Soko J-1 Jastreb",
"JB15":"Oberlerchner JOB-15",
"JC01":"Coupe JC-01",
"JC02":"Coupe JC-02",
"JCOM":"IAI 1121 Commodore Jet",
"JCRU":"Aasi Jetcruzer",
"JD2":"Dyke JD-2 Delta",
"JDOE":"American Homebuilts John Doe",
"JE2":"Eich JE-2 Gyroplane",
"JFOX":"Airo 1",
"JH7":"Xian JH-7",
"JK05":"Ekolot JK-05 Beetle",
"JL9":"Guizhou JL-9 Shanying",
"JN76":"CR-760 Cyclone Replica",
"JPM1":"Marie JPM-01 Medoc",
"JPRO":"Bac 145 Jet Provost",
"JRC1":"Chalard JRC-01 Julcar",
"JRO":"Dta J-RO",
"JS3":"Volpar Century Jetstream 3",
"JS31":"BAe BAe-3100 Jetstream 31",
"JS32":"BAe Jetstream 32",
"JS41":"BAe Jetstream 41",
"JSX":"Sonex JSX SubSonex",
"JT2":"Taylor JT-2 Titch",
"JU52":"CASA 352L",
"JUN1":"Kaminskas RK-1 Jungster 1",
"JUN2":"Kaminskas RK-2 Jungster 2",
"JUNR":"Andreasson BA-7",
"JUPI":"Lammer Geyer Jupiter",
"K100":"Daher Kodiak 100",
"K126":"Ica Ka-126",
"K209":"Fama K-209 KISS",
"K226":"Kamov Ka-226 Sergei",
"K35E":"Boeing KC-135E Stratotanker",
"K35R":"KC-135 Stratotanker",
"K50":"A-50 Golden Eagle",
"K51":"Kovacs K-51 Peregrino",
"K8":"Nanchang K-8 Karakorum",
"K900":"Daher Kodiak 900",
"KA25":"Kamov Ka-25",
"KA26":"Kamov Ka-26",
"KA27":"Kamov Ka-27",
"KA50":"Kamov Ka-50 Werewolf",
"KA52":"Kamov Ka-52 Alligator",
"KA62":"Kamov Ka-62",
"KAAN":"TAI TF Kaan",
"KAK1":"Kieger AK-1",
"KAK2":"Kieger AK-2",
"KAK3":"Kieger AK-3",
"KAT3":"Khrunichev AT-3",
"KATB":"Kari Twinbee",
"KATR":"Aerosamara Katran",
"KC2":"Kawasaki C-2",
"KE3":"Boeing KE-3",
"KEHA":"Kestrel Float Hawk",
"KELA":"Keleher Lark",
"KELD":"Kelly D",
"KERO":"Rearwin 2000 Ken-Royce",
"KEST":"Farnborough F-1 Kestrel",
"KF21":"KF-21 Boramae",
"KFAB":"Bushbaby",
"KFAS":"Kitplanes For Africa Safari",
"KFIR":"IAI Kfir",
"KFIS":"Warner W-1 Super Kingfisher",
"KH4":"Kawasaki KH-4",
"KIS2":"Tri-R KIS TD",
"KIS4":"Pulsar Super Cruiser",
"KITH":"Viking Kitty Hawk",
"KITI":"Mitchell-Procter Kittiwake",
"KK60":"Kari-Keen 60 Coupe",
"KL07":"Bolkow F-207",
"KL10":"Flight Design-Vessel KLA-100",
"KL25":"Klemm L-25",
"KL35":"Klemm Kl-35",
"KLBR":"Kolb King Kolbra",
"KM2":"Fuji KM-2",
"KMAX":"Kaman K-1200 K-Max",
"KNTW":"Payne Knight Twister",
"KODI":"Daher Kodiak 100",
"KOLL":"Kolb Laser",
"KP2":"Jihlavan KP-2 Skyleader 150",
"KP5":"Jihlavan KP-5 Skyleader 500",
"KR1":"Rand KR-1",
"KR2":"Rand KR-2",
"KR21":"Fairchild KR-21",
"KR30":"Ekolot KR-030 Topaz",
"KR31":"Fairchild KR-31",
"KR34":"Fairchild KR-34",
"KRAG":"Soko P-2 Kraguj",
"KRAH":"Rock Kr\u00e4he",
"KRIC":"Flsz DK-1 Der Kricket",
"KSTK":"Phoenix-Aviacor M-12 Kasatik",
"KT1":"KT-1 Woong-Bee",
"KTOO":"Amax J-6 Karatoo",
"KZ2":"SAI KZ-2 Kupe",
"KZ3":"SAI KZ-3",
"KZ4":"SAI KZ-4",
"KZ7":"SAI KZ-7 Laerke",
"KZ8":"SAI KZ-8",
"KZLA":"Baykar Bayraktar K\u0131z\u0131lelma",
"L10":"Lockheed L-10 Electra",
"L101":"Lockheed L-1011 TriStar",
"L11":"Temco 11A Sedan",
"L11E":"Luscombe 11E Spartan 185",
"L12":"Lockheed L-12 Electra Junior",
"L13":"Convair L-13",
"L13M":"Let L-13 Blanik",
"L13S":"Aerotechnik L-13S Vivat",
"L14":"Lockheed L-14 Hudson",
"L15":"Hongdu L-15 Lieying",
"L159":"Aero L-159 Albatros 2",
"L18":"Lockheed L-18 Lodestar",
"L181":"Associated Air Liberty 181",
"L188":"Lockheed L-188 Electra",
"L200":"Let L-200 Morava",
"L29":"Aero L-29 Delfin",
"L29A":"Lockheed L-1329 Jetstar 6",
"L29B":"Lockheed L-1329 Jetstar 2",
"L37":"Lockheed L-137 Ventura",
"L380":"Lederlin 380 Ladybug",
"L39":"Aero L-39 Albatros",
"L4":"Chaika L-4",
"L40":"Orli\u010dan L-40 Meta Sokol",
"L410":"Let L-410 Turbolet",
"L5":"Stinson L-5 Sentinel",
"L59":"Aero L-59",
"L6":"Aerovolga L-6",
"L60":"Orli\u010dan L-60 Brigadyr",
"L610":"Let L-610",
"L70":"Valmet L-70 Vinka",
"L8":"Luscombe Silvaire",
"L90":"Aermacchi M-290TP Redigo",
"LA25":"Lake Renegade",
"LA4":"Lake Buccaneer",
"LA60":"Aermacchi AL-60 Trojan",
"LA6T":"AL-60 Turbine Grizzly",
"LA8":"Aerovolga LA-8 Flagman",
"LACO":"Laven LACO-125",
"LAKR":"Laser Akro Z",
"LAKX":"Avia Baltika LAK-X",
"LAMA":"Hindustan SA-315 Lancer",
"LANC":"Avro 683 Lancaster",
"LAR1":"Flaris LAR-1",
"LARK":"Rockwell 100 Lark Commander",
"LAST":"UTVA N-63 Lasta",
"LBUG":"Reflex Lightning Bug",
"LCA":"Hindustan LCA Tejas",
"LCB":"Laird LC-B Commercial",
"LCH":"Hindustan LCH",
"LCR":"Laird LC-R Speedwing",
"LEG2":"Lancair Legacy",
"LEGD":"Performance Legend",
"LESP":"Lancair ES-P",
"LEV2":"Tapanee Levitation 2",
"LEV4":"Tapanee Levitation 4",
"LGEZ":"Rutan Long-EZ",
"LGND":"Orli\u010dan M-8 Eagle",
"LH10":"Lh Aviation LH-10 Ellipse",
"LIBE":"Liberty Bellaire",
"LION":"Griffon Lionheart",
"LJ23":"Lear Jet 23",
"LJ24":"Learjet 24",
"LJ25":"Learjet 25",
"LJ28":"Gates Learjet 28",
"LJ31":"Learjet 31",
"LJ35":"Learjet 35",
"LJ40":"Learjet 40",
"LJ45":"Learjet 45",
"LJ55":"Learjet 55",
"LJ60":"Learjet 60",
"LJ70":"Learjet 70",
"LJ75":"Learjet 75",
"LM5":"Lombardi LM-5 Aviastar",
"LM5X":"LM-5 Super Cub",
"LM7":"Lombardi LM-7",
"LMC1":"Chasle LMC-1 Sprintair",
"LMK1":"Cata LMK-1 Oryx",
"LN27":"Falcomposite LN-27 Furio",
"LN3":"Flygfabriken LN-3 Seagull",
"LNC2":"Lancair 320/360",
"LNC4":"Lancair IV",
"LNCE":"Lancair ES",
"LNP4":"Lancair Propjet",
"LNT4":"Lancair Sentry 4T",
"LOCA":"Aerolab LoCamp",
"LOVE":"Loving-Wayne WR-1 Love",
"LP1":"Lopresti LP-1 Fury",
"LR2T":"Load Ranger 2000",
"LS2":"Hat LS-2",
"LSTR":"Custom Flight Lite Star",
"LTNG":"Bac Lightning",
"LUL5":"Lucas L-5",
"LUL6":"Lucas L-6",
"LUL7":"Lucas L-7",
"LUL8":"Lucas L-8",
"LW20":"Australian LightWing Speed",
"LW40":"Australian LightWing Speed",
"LWIN":"Australian LightWing GR-582",
"LX32":"Lilienthal X-32 Bekas",
"LX34":"Lilienthal X-34 Bekas",
"LXR":"Elixir",
"LYNX":"Westland WG-13 Lynx",
"LYSA":"Westland Lysander",
"M10":"Mooney M-10 Cadet",
"M101":"Myasishchev M-101 Gzhel",
"M106":"Lambert M-106 Mission",
"M108":"Lambert M-108 Mission",
"M110":"Aviat 110 Special",
"M15":"Pzl-Mielec M-15 Belphegor",
"M17":"Myasishchev M-17 Stratosfera",
"M18":"Pzl-Mielec M-18 Dromader",
"M18T":"M-18 Turbine Dromader",
"M2":"Kubicek M-2 Scout",
"M200":"Aero Commander 200",
"M20P":"Mooney M20",
"M20T":"Mooney M20 Turbo",
"M21":"M-21 Dromader Mini",
"M212":"Lambert M-212 Mission",
"M22":"Mooney M-22 Mustang",
"M24":"M-24 Dromader Super",
"M26":"Pzl-Mielec M-26 Air Wolf",
"M28":"Pzl-Mielec M-28 Bryza",
"M2HK":"Miles M-2 Hawk Major",
"M308":"Macchi MB-308",
"M326":"Embraer EMB-326 Xavante",
"M339":"Aermacchi MB-339",
"M345":"Leonardo M-345",
"M346":"Aermacchi M-346 Master",
"M36J":"Matra M-360 Jupiter",
"M4":"Maule M-4",
"M404":"Martin 404",
"M5":"Maule M-5",
"M55":"Myasishchev M-55 Geophysica",
"M6":"Maule M-6",
"M600":"Piper M600",
"M7":"Maule M-7",
"M700":"Piper M700 Fury",
"M74":"Texas Helicopter M-74 Wasp",
"M7T":"Maule M-7-420 Star Craft",
"M8":"Maule M-8",
"M9":"Maule M-9",
"MA1":"Emair MA-1 Paymaster",
"MA5":"Marquart MA-5 Charger",
"MA60":"Xian MA-60",
"MA6H":"Xian MA-60H",
"MAGC":"Ibis GS-700 Magic",
"MAGI":"Miles M-14 Magister",
"MAGN":"Avid Magnum",
"MAJR":"Falconar Cubmajor",
"MAKO":"Lancair NLA-450 Mako",
"MAMB":"Melbourne MA-2 Mamba",
"MAME":"Aerocomp Merlin",
"MAVR":"Aea Maverick",
"MB70":"Brochet MB-72",
"MB80":"Brochet MB-80",
"MC01":"Montaer MC-01",
"MC10":"Colomban MC-10 Cricri",
"MC23":"Irkut MC-21-300",
"MC45":"Meyers MAC-145",
"MC90":"Monocoupe 90",
"MCOU":"Chris Tena Mini Coupe",
"MCOY":"Montana Coyote",
"MCR1":"Lafayette 1 Sportster",
"MCR4":"Dyn'aero MCR-4",
"MCRR":"Dyn'aero MCR-R180",
"MCUL":"Kimball McCullocoupe",
"MD11":"McDonnell Douglas MD-11",
"MD3":"Sme MD-3 Tiga",
"MD3R":"Gryf MD-3 Rider",
"MD52":"McDonnell Douglas MD-520N",
"MD60":"Boeing MD-600N",
"MD81":"Boeing MD-81",
"MD82":"Boeing MD-82",
"MD83":"McDonnell Douglas MD-83",
"MD87":"Boeing MD-87",
"MD88":"McDonnell Douglas MD-88",
"MD90":"McDonnell Douglas MD-90",
"ME08":"Nord 1001 Pingouin 1",
"ME09":"Messerschmitt Bf-109",
"ME62":"Messerschmitt Me-262 Replica",
"MEAD":"Mead Adventure",
"MEL2":"Garrison Melmoth 2",
"MERK":"Aviaton Merkury",
"MESS":"Miles M-38 Messenger",
"METR":"Gloster Meteor",
"MF17":"Saab T-17 Supporter",
"MG15":"Pzl-Mielec LiM-1",
"MG17":"Shenyang F-5",
"MG19":"Shenyang F-6",
"MG21":"Chengdu F-7 Skybolt",
"MG23":"Mikoyan MiG-23",
"MG25":"Mikoyan MiG-25",
"MG29":"Mikoyan MiG-29 Baaz",
"MG31":"Mikoyan MiG-31",
"MG44":"Mikoyan MiG 1-44",
"MGIC":"Wzl 3 DEKO-9",
"MGNM":"Aviation Enterprises Magnum",
"MGUL":"Percival E Mew Gull",
"MH20":"Mitsubishi MH-2000",
"MH46":"Aerosette MH-46 Eclipse",
"MI10":"Mil Mi-10",
"MI14":"Mil Mi-14",
"MI2":"Pzl-Swidnik Mi-2 Kania",
"MI24":"Mil Mi-24",
"MI26":"Mil Mi-26",
"MI28":"Mil Mi-28",
"MI34":"Mil Mi-34",
"MI38":"Mil Mi-38",
"MI4":"Harbin Z-5 Xuanfeng",
"MI6":"Mil Mi-6",
"MI8":"Mil Mi-8/17",
"MIDR":"Acba ACBA-7 Midour",
"MIMP":"Aerocar Mini-Imp",
"MIMU":"Bushby Midget Mustang",
"MIR2":"Dassault Mirage 2000",
"MIRA":"Dassault Mirage 3",
"MITE":"Mooney Mite",
"MJ10":"Jurca MJ-10 Spit",
"MJ12":"Jurca MJ-12 P-40",
"MJ1H":"MJ-100 Spitfire Replica",
"MJ2":"Jurca MJ-2 Temp\u00eate",
"MJ4":"Jurca MJ-4 Shadow",
"MJ5":"Jurca MJ-5 Sirocco",
"MJ51":"Jurca MJ-51 Sp\u00e9rocco",
"MJ53":"Jurca MJ-53 Autan",
"MJ7":"Jurca MJ-7 Gnatsum",
"MJ77":"Jurca MJ-77 Gnatsum",
"MJ8":"Jurca MJ-8 1-Nine-0",
"MJ80":"MJ-80 Focke-Wulf Fw-190",
"MJ9":"Jurca MJ-9",
"MJ90":"MJ-90 Messerschmitt Bf-109",
"MLER":"Alanne Moottori-Lerche",
"MM14":"Magni M-14 Scout",
"MM16":"Magni M-16 Tandem Trainer",
"MM19":"Magni M-19 Shark",
"MM21":"Magni M-21",
"MM22":"Magni M-22 Voyager",
"MM24":"Magni M-24 Orion",
"MMAX":"Mad Max",
"MMUT":"Mara Wing 1-L Malamut",
"MNEX":"Nordic 8 Mini Explorer",
"MOCU":"Culp MonoCulp",
"MOGO":"Montagne Mountain Goat",
"MOL1":"Molniya 1",
"MON2":"Montanair 2180 Spirit",
"MONA":"Miles M-17 Monarch",
"MONI":"Monnett Moni",
"MOR2":"Varga Kachina",
"MOSP":"Mong Sport",
"MOSQ":"De Havilland DH-98 Mosquito",
"MOTO":"Humbert Moto Du Ciel",
"MP02":"Aero-Kros MP-02 Czajka",
"MP20":"Plan MP-205 Busard",
"MR25":"Murphy SR-2500 Super Rebel",
"MR35":"Murphy SR-3500 Moose",
"MR3T":"Murphy SR-3500 T-Moose",
"MRAI":"Monnett Monerai P",
"MRF1":"Mirage F1",
"MRMD":"Czaw Mermaid",
"MRTN":"Mirage Marathon",
"MS1":"Mysky MS-1",
"MS23":"Morane-Saulnier MS-230",
"MS31":"Morane-Saulnier MS-315",
"MS73":"MS-733 Alcyon",
"MS76":"Morane-Saulnier MS-760 Paris",
"MSAI":"Morane-Saulnier AI",
"MSQ2":"Backcountry Mackey SQ-2",
"MT":"AutoGyro MTOsport",
"MT2":"Mitsubishi T-2",
"MU2":"Mitsubishi MU-2",
"MU23":"M\u00fc-23 Saurier",
"MU30":"Mitsubishi Diamond",
"MUS2":"Bushby Mustang II",
"MVN1":"Mven 1 Fermer",
"MVRK":"Phoenix Maverick",
"MX10":"MXP-100 Aventura",
"MX1T":"World Aircraft WA-100 Spirit",
"MX2":"Mxr MX-2",
"MX58":"Aeroandina MXP-158 Embera",
"MX65":"Agro-Copteros MXP-650 Amigo",
"MX80":"Aerotec MXP-800 Fantasy",
"MXS":"Mxr MXS",
"MY12":"Mylius MY-102 Tornado",
"MY13":"Mylius MY-103 Mistral",
"MYA4":"Myasishchev M-4",
"MYS4":"Dassault MD-454A Myst\u00e8re 4A",
"N110":"Nord 1101 Ramier 1",
"N120":"Nord 1200 Norecrin",
"N219":"N-219 Nurtanio",
"N250":"Nusantara N-250",
"N260":"Nord 260 Super Broussard",
"N262":"Aerospatiale N-262 Fr\u00e9gate",
"N3":"Nostalgair N-3 Super Pup",
"N320":"Nord 3202",
"N340":"Nord 3400",
"N3N":"NAF N3N Canary",
"N5A":"Nanchang N-5A",
"N5B":"Hongdu N-5B",
"NA40":"Unis NA-40 Bongo",
"NARN":"KC-100 Naraon",
"NAVI":"Navion",
"NC85":"Nord NC-854",
"ND1T":"Ndn NDN-1T Turbo Firecracker",
"NDAC":"Normand Dube Aerocruiser",
"NDAT":"Aerocruiser Turbo 450",
"NDIC":"Norman Nordic 2",
"NFEX":"Nf-Aircraft Explorer",
"NG4":"Roko Aero NG-4 Prodigy 4",
"NG5":"BRM Bristell",
"NH90":"NHIndustries NH90",
"NI28":"Nieuport 28 Replica",
"NIBB":"Aviamilano F-14 Nibbio",
"NIPR":"Avions Fairey T-66 Nipper",
"NM5":"Nal NM-5",
"NMCU":"Enaer ECH-02 Namcu",
"NNJA":"Best Off Nynja",
"NOMA":"Gaf N-2 Nomad",
"NORA":"Nord 2501 Noratlas",
"NORS":"Noorduyn Norseman",
"NPOR":"Redfern Nieuport 17",
"NST6":"North Star 6 Galaxie",
"NSTR":"Custom Flight North Star",
"NT10":"Nuwaco T-10",
"NXT":"Nemesis NXT",
"O1":"Cessna O-1 Bird Dog",
"O3":"Lockheed YO-3",
"OCNR":"TC-120 Oc\u00e9anair",
"OH1":"Kawasaki OH-1",
"OKHO":"Aero-Astra Okhotnik",
"OM1":"Morrisey OM-1 Bravo",
"OMGA":"Isae Omega",
"OMLA":"Omac Laser 300",
"OMSD":"Atec Omsider",
"ONE":"Gogetair G-600",
"ONEX":"Sonex Onex",
"OPCA":"Fls OA-7 Optica",
"OR10":"Orion 10",
"OR12":"Orion SK-12",
"OSCR":"Partenavia P-64 Oscar",
"OVOD":"Vitek Ovod",
"OZZI":"Buchanan BAC-204 Mosquito",
"P06T":"Tecnam P2006T",
"P1":"Kawasaki P-1",
"P100":"Pottier P-100",
"P130":"Pottier P-130 Bleu Citron",
"P136":"Piaggio P-136",
"P148":"Piaggio P-148",
"P149":"Piaggio P-149",
"P180":"Piaggio Avanti",
"P18T":"PA-18T Super Cub",
"P19":"Aviamilano P-19 Scricciolo",
"P1HH":"Piaggio P-1HH Hammerhead",
"P2":"Lockheed P-2 Neptune",
"P208":"Tecnam P2008",
"P210":"Cessna P210 Centurion",
"P212":"Tecnam P-2012 Traveller",
"P220":"Antoniewski P-220S-AT2",
"P230":"Pottier P-230 Panda",
"P250":"Pottier P-250 Xerus",
"P25B":"PA-25 Biplaza Puelche",
"P27":"Gryf P-27 Skyster",
"P270":"Pottier P-270 Amster",
"P28A":"Piper Cherokee/Archer",
"P28B":"Piper Dakota/Cherokee 235",
"P28R":"Piper Arrow",
"P28S":"PA-28R-201T Turbo Arrow",
"P28T":"Piper Arrow IV",
"P28U":"Piper Turbo Arrow IV",
"P3":"P-3 Orion",
"P32R":"Piper Lance/Saratoga SP",
"P32T":"Piper Lance II",
"P337":"Cessna P337 Skymaster",
"P38":"Lockheed P-38 Lightning",
"P39":"Bell P-39 Airacobra",
"P40":"Curtiss P-40 Warhawk",
"P46T":"Piper Meridian/M500",
"P47":"Republic P-47 Thunderbolt",
"P4Y":"Convair P4Y Privateer",
"P50":"Pottier P-50 Bouvreuil",
"P51":"North American P-51 Mustang",
"P57":"Partenavia P-57 Fachiro 2",
"P60":"Pottier P-60 Minacro",
"P61":"Northrop P-61 Black Widow",
"P63":"Bell P-63 Kingcobra",
"P66P":"Piaggio P-166B Portofino",
"P66T":"Piaggio P-166DL3",
"P68":"Partenavia P68",
"P68T":"AP-68TP-300 Spartacus",
"P70":"Pottier P-70",
"P750":"P-750 XStol",
"P8":"P-8 Poseidon",
"P80":"Pottier P-80",
"P82":"P-82 Twin Mustang",
"PA11":"Piper Cub Special",
"PA12":"Piper Super Cruiser",
"PA14":"Piper Family Cruiser",
"PA15":"Piper Vagabond",
"PA16":"Piper Clipper",
"PA17":"Piper Vagabond",
"PA18":"Piper Super Cub",
"PA20":"Piper Pacer",
"PA22":"Piper Tri-Pacer",
"PA23":"Piper Apache",
"PA24":"Piper Comanche",
"PA25":"Piper Pawnee",
"PA27":"Piper Aztec",
"PA30":"Piper Twin Comanche",
"PA31":"Piper Navajo",
"PA32":"Piper Saratoga/Six",
"PA34":"Piper Seneca",
"PA36":"Piper Pawnee Brave",
"PA38":"Piper Tomahawk",
"PA44":"Piper Seminole",
"PA46":"Piper Malibu/M350",
"PACE":"Bellanca D Skyrocket",
"PAGO":"Alms ADV-01 Papango",
"PANT":"Rotec Panther 2",
"PAR1":"Paradise P-1",
"PAR4":"Paradise P-4",
"PARA":"Paraglider",
"PARL":"St. Croix Pietenpol Aerial",
"PAT4":"Piper PA-31T3-500 T-1040",
"PAUL":"Neiva 56 Paulistinha",
"PAV4":"Carter PAV-4",
"PAY1":"Piper PA-31T1-500 Cheyenne 1",
"PAY2":"Piper PA-31T-620 Cheyenne",
"PAY3":"Piper PA-42-720 Cheyenne 3",
"PAY4":"PA-42-1000 Cheyenne 400",
"PC12":"Pilatus PC-12",
"PC21":"Pilatus PC-21",
"PC24":"Pilatus PC-24",
"PC6P":"Pilatus PC-6 Porter",
"PC6T":"Pilatus PC-6 Porter",
"PC7":"Pilatus PC-7",
"PC9":"Pilatus PC-9",
"PCA2":"Pitcairn-Cierva PCA-2",
"PDIG":"Vstol SST-2000 Pairadigm",
"PEGA":"General Avia F-20 Pegaso",
"PEGZ":"Tapanee Pegazair",
"PELI":"Kolb Pelican",
"PEMB":"Percival P-66 Pembroke",
"PETL":"Aero Itba Petrel",
"PETR":"Super Petrel",
"PGEE":"Holcomb Perigee",
"PGK1":"Western PGK-1 Hirondelle",
"PHIL":"Vtol Aircraft Phillicopter",
"PHIX":"Phenix",
"PIAE":"Pipistrel WattsUp",
"PIAT":"Pipistrel Alpha Trainer",
"PICO":"General Avia F-15 Picchio",
"PILL":"Enaer T-35A Pill\u00e1n",
"PINO":"General Avia F-22 Pinguino",
"PIPA":"Pipistrel Panthera",
"PISI":"Pipistrel Sinus",
"PIT4":"Pipistrel Taurus Electro G4",
"PIVE":"Pipistrel Virus",
"PIVI":"Pipistrel Virus",
"PK11":"Pik PIK-11 Tumppu",
"PK15":"Pik PIK-15 Hinu",
"PK18":"Pik PIK-18 Sytky",
"PK21":"Pik PIK-21 Super Sytky",
"PK23":"Valmet PIK-23 Suhinu",
"PK25":"Pik PIK-25 Varttimarkka",
"PKAN":"Uetz U-3M Pelikan",
"PL1":"Pazmany PL-1 Laminar",
"PL12":"Transavia PL-12 Airtruk",
"PL2":"Pazmany PL-2",
"PL4":"Pazmany PL-4",
"PL9":"Pazmany PL-9 Stork",
"PLUS":"Taylorcraft Plus C",
"PNR2":"Alpi Pioneer 200",
"PNR3":"Alpi Pioneer 300",
"PNR4":"Alpi Pioneer 400",
"PNTH":"Sport Performance Panther",
"PO2":"Pzl-Mielec CSS-13",
"PO60":"Potez 60 Sauterelle",
"POLI":"Alvarez Polliwagen",
"PONY":"Reda Pony",
"PP2":"Pilatus P-2",
"PP3":"Pilatus P-3",
"PPRO":"Percival P-56 Provost",
"PRBP":"Pocket Rocket PR-Bipe",
"PRBR":"Pocket Rocket PR-Breeze",
"PRCE":"Percival P-57 Sea Prince",
"PREN":"Percival P-40 Prentice",
"PRET":"Gm&t Pretty Flight",
"PREX":"Private Explorer",
"PRIM":"Blackshape Bk-100 Prime",
"PRM1":"Beechcraft Premier I",
"PROC":"Percival P-28 Proctor",
"PROT":"Czaw Parrot",
"PROW":"Prowler",
"PRPR":"Pocket Rocket PR-XP",
"PRTS":"Rutan 281 Proteus",
"PRXT":"Private Explorer T-Explorer",
"PSTM":"Podesva Stearman",
"PSW4":"Pzl-Swidnik SW-4 Maluch",
"PT22":"Ryan PT-22 Recruit",
"PT70":"Pottier P-170",
"PT80":"Pottier P-180",
"PTMS":"Kimball S-12 Macho Stinker",
"PTS1":"Pitts S-1",
"PTS2":"Pitts S-2",
"PTSS":"Aviat S-1-11 Super Stinker",
"PULR":"P&m Aviation PulsR",
"PULS":"Pulsar",
"PUMA":"Aerospatiale CH-33 Puma",
"PUP":"Beagle B-121 Pup",
"PURS":"Rans S-11 Pursuit",
"PUSH":"Prescott Pusher",
"PVTR":"Privateer",
"PZ01":"Pzl-Okecie PZL-101 Gawron",
"PZ02":"Pzl-Okecie PZL-102 Kos",
"PZ04":"Pzl-Okecie PZL-104 Wilga 35",
"PZ06":"Pzl-Okecie PZL-106A Kruk",
"PZ12":"Pzl-Okecie PZL-112 Junior",
"PZ3T":"Pzl-Okecie PZL-130 Orlik",
"PZ4M":"PZL-104M Wilga 2000",
"PZ6T":"PZL-106AT Turbo Kruk",
"Q01":"Reiner Stemme Q-01",
"Q1":"MQ-1 Predator",
"Q25":"Boeing MQ-25 Stingray",
"Q28":"MQ-28 Ghost Bat",
"Q4":"RQ-4 EuroHawk",
"Q5":"Nanchang Q-5",
"Q58":"Kratos XQ-58 Valkyrie",
"Q9":"General Atomics MQ-9 Ikhana",
"QAIL":"Aerosport Quail",
"QALT":"Fmp Qualt",
"QIC2":"Quickie Q2",
"QR01":"Quercy CQR-01",
"QUAS":"Quasar Lite",
"QUIC":"Quickie",
"R100":"Robin R-1180 Aiglon",
"R109":"Aircraft Spruce DR-109 Rhino",
"R11":"Rupert R-11",
"R12":"Rupert R-12 Vimana",
"R135":"RC-135",
"R185":"Johnson Rocket 185",
"R2":"Sau R-02 Robert",
"R200":"Robin R-2112 Alpha",
"R22":"Robinson R22",
"R300":"Robin R-300",
"R4":"Sikorsky R-4 Hoverfly",
"R44":"Robinson R44",
"R66":"Robinson R66",
"R721":"Boeing 727-100RE Super 27",
"R722":"Boeing 727-200RE Super 27",
"R90F":"Ruschmeyer R-90-230FG",
"R90R":"Ruschmeyer R-90-230RG",
"R90T":"Ruschmeyer R-90-420AT",
"RA14":"Maranda BM-1 Loisirs",
"RA17":"Maranda BM-3",
"RAF2":"RAF 2000",
"RAID":"Sky Raider",
"RAIL":"Aerosport Rail",
"RALL":"Socata Rallye",
"RANG":"Navion Rangemaster",
"RARO":"Altitude Radial Rocket",
"RAV3":"Ravin 300",
"RAV5":"Ravin 500",
"RAZM":"Saint Germain Raz-Mut",
"RBEL":"Murphy Rebel",
"RC3":"Republic Seabee",
"RC70":"Rockwell 700 Commander 700",
"RCAL":"Murphy Radical",
"RD03":"Duruble RD-03 Edelweiss",
"RD20":"Denize RD-20 Raid Driver",
"RDH2":"Redfern DH-2",
"RELI":"Stinson Reliant",
"RENE":"Murphy Renegade",
"REV6":"Groen Revcon 6G",
"RF10":"Aeromot AMT-100 Ximango",
"RF3":"Fournier RF-3",
"RF4":"Fournier RF-4",
"RF47":"Fournier RF-47",
"RF5":"Fournier RF-5",
"RF6":"Slingsby T-67 Firefly",
"RF9":"Fournier RF-9",
"RFAL":"Dassault Rafale",
"RGNT":"Neiva C-42 Regente",
"RISN":"Porto Risen",
"RJ03":"Junqua RJ-03 Ibis",
"RJ1H":"Avro RJ100",
"RJ70":"BAe RJ-70",
"RJ85":"Avro RJ85",
"RK3":"Kalinauskas RK-3 V\u0117jas",
"RK5":"Kalinauskas RK-5",
"RLU1":"Breezy",
"RMOU":"Hillberg EH1-01 Rotormouse",
"RNGR":"Dac RangeR",
"RODS":"DR-107 One Design",
"ROND":"Lombardi F-4 Rondone",
"ROSE":"Maupin Windrose",
"RP1":"Mitsubishi RP-1",
"RPUP":"Little Wing LW-4 Roto-Pup",
"RS12":"Rans S-12 Airaile",
"RS18":"RS-180 Sportsman",
"RS20":"Rans S-20 Raven",
"RS21":"Rans S-21 Outbound",
"RTA4":"Rtaf RTAF-4 Chandra",
"RUBI":"Scintex ML-250 Rubis",
"RV10":"Van's RV-10",
"RV12":"Van's RV-12",
"RV14":"Van's RV-14",
"RV15":"Van's RV-15",
"RV3":"Van's RV-3",
"RV4":"Van's RV-4",
"RV4T":"Van's RV-4T",
"RV6":"Van's RV-6",
"RV7":"Van's RV-7",
"RV8":"Van's RV-8",
"RV9":"Van's RV-9",
"RVAL":"Denel AH-2 Rooivalk",
"RVST":"Rupert VimanaSteel",
"RW19":"Ragwing RW-19 Stork",
"RW20":"Ragwing RW-20 Stork",
"RW22":"Ragwing RW-22 Tiger Moth",
"RW26":"Ragwing RW-26 Special 2",
"RW3":"Rhein RW-3 Multoplane",
"RYSA":"Technoavia Rysachok",
"RYST":"Ryan ST-A",
"S05F":"Siai-Marchetti S-205-18F",
"S05R":"Siai-Marchetti S-205-18R",
"S1":"Interstate Cadet",
"S10":"Stinson Voyager",
"S108":"Stinson 108 Voyager",
"S11":"Fokker S-11 Instructor",
"S12":"Spencer S-12 Air Car",
"S122":"Skyline SL-122 Pchelka",
"S15S":"Stemme S-15",
"S15U":"Stemme S-15 Patroller",
"S160":"Sunward SA160",
"S200":"Sipa S-200 Minijet",
"S202":"Sgau S-202",
"S208":"Siai-Marchetti S-208",
"S21":"Macdonald S-21",
"S211":"Siai-Marchetti S-211",
"S223":"CASA 223 Flamingo",
"S22T":"Cirrus SR22T",
"S274":"Irgc Shahed 274",
"S278":"Hesa Shahed 278",
"S285":"Hesa Shahed 285",
"S2P":"Grumman S-2 Tracker",
"S2T":"Imp S-2 Turbo Tracker",
"S3":"Lockheed S-3 Viking",
"S330":"Schweizer 269D 330",
"S355":"Scaled 355 Firebird",
"S360":"Aerospatiale SA-360 Dauphin",
"S37":"Sukhoi S-37 Berkut",
"S38":"Sikorsky S-38 Replica",
"S39":"Sikorsky S-39",
"S4":"Arctic S-4 Privateer",
"S400":"Sgau S-400 Kapitan",
"S401":"Scaled 401 Sierra",
"S434":"Sikorsky S-434",
"S45":"Partenair S-45 Mystere",
"S450":"Aero-East-Europe SILA-450",
"S51":"Sikorsky S-51",
"S51D":"Stewart S-51D",
"S52":"Sikorsky S-52",
"S522":"Soko 522",
"S55P":"Sikorsky S-55",
"S55T":"Sikorsky S-55T",
"S58P":"Sikorsky S-58",
"S58T":"Sikorsky S-58T",
"S6":"Stemme S-6",
"S601":"Aerospatiale SN-601 Corvette",
"S61":"Sikorsky S-61",
"S61R":"Sikorsky S-61R",
"S62":"Sikorsky S-62",
"S64":"Sikorsky S-64 Skycrane",
"S65C":"SA-365C Dauphin 2",
"S716":"Stratos 716",
"S76":"Sikorsky S-76",
"S900":"Sipa S-901",
"S92":"Sikorsky S-92",
"S97":"Sikorsky S-97 Raider",
"SA02":"K & S SA-102.5 Cavalier",
"SA03":"K & S SA-103 Cavalier",
"SA04":"K & S SA-104 Cavalier",
"SA05":"K & S SA-105 Super Cavalier",
"SA10":"Stolp SA-100 Starduster",
"SA11":"Stits SA-11 Playmate",
"SA2":"ICP SA-2 Vimana",
"SA20":"Beriev SA-20",
"SA3":"Stits SA-3 Playboy",
"SA30":"Stolp Starduster Too",
"SA37":"Schweizer SA-2-37 Condor",
"SA38":"Schweizer RU-38A Twin Condor",
"SA50":"Stolp SA-500 Starlet",
"SA6":"Stits SA-6 Flut-R-Bug",
"SA6E":"Sreya SA-6 Envoy",
"SA7":"Stits SA-7 Sky-Coupe",
"SA70":"Stolp SA-700 Acroduster",
"SA75":"Stolp SA-750 Acroduster Too",
"SA8T":"Schweizer RU-38B Twin Condor",
"SAB2":"Arnet Pereyra Sabre 2",
"SABA":"Paravar Pars Saba",
"SABW":"Azalea Saberwing",
"SACE":"Acro Sport Super Ace",
"SACR":"Smith Acro Advanced",
"SAFF":"Halsted Saffire",
"SAH1":"Fls Sprint",
"SAKO":"Rans S-10 Sakota",
"SALB":"Skygear Albatross",
"SAM":"Sam",
"SAND":"Short S-25 Sandringham",
"SAPH":"Piel CP-1320 Saphir",
"SASH":"Shark",
"SASP":"Spitfire Mk25",
"SASY":"Protech PT-2 Sassy",
"SATA":"Hispano HA-200 Saeta",
"SAVA":"Sadler Vampire",
"SAVG":"Alms Callao",
"SB05":"Saab 105",
"SB1":"Sikorsky S-100 Defiant",
"SB20":"Saab 2000",
"SB29":"Saab 29",
"SB32":"Saab 32 Lansen",
"SB35":"Saab 35 Draken",
"SB37":"Saab 37 Viggen",
"SB7":"Seabird SB-7 Seeker",
"SB91":"Saab 91 Safir",
"SBD":"Douglas SBD Dauntless",
"SBLS":"Slipstream SkyBlaster",
"SBOY":"Interplane Skyboy",
"SBR1":"Sabreliner",
"SBR2":"Rockwell NA-265 Sabre 75",
"SC01":"Fft SC-01 Speed Canard",
"SC7":"Short SC-7 Skyvan",
"SCAM":"Agro-Copteros Scamp",
"SCEP":"Slipstream Scepter",
"SCII":"Sport Copter SportCopter 2",
"SCOM":"Airdale Comet",
"SCOR":"Rotorway Scorpion",
"SCOU":"Westland Scout",
"SCRO":"M\u00fc-30 Schlacro",
"SCTR":"Flaglor Scooter",
"SCUB":"Aero Kuhlmann Scub",
"SCW1":"Scwal 101",
"SD2":"Spacek SD-2 SportMaster",
"SD4":"Tomark SD-4 Viper",
"SDUS":"Stolp Super Starduster",
"SE1":"Spirit SE-1",
"SE5A":"RAF SE-5A Replica",
"SE5R":"Replica",
"SEAT":"Seawind",
"SEAW":"Seawind",
"SERA":"Servoplant Aerocraft",
"SF2":"Viking SF-2 Cygnet",
"SF23":"Scheibe SF-23 Sperling",
"SF24":"Scheibe SF-24 Motorspatz",
"SF25":"Scheibe Falke",
"SF28":"Scheibe SF-28 Tandem Falke",
"SF31":"SFS-31 Milan",
"SF34":"Saab 340",
"SF35":"Scheibe SF-35",
"SF36":"Scheibe SF-36",
"SF50":"Cirrus Vision Jet",
"SG37":"Schweizer SGM-2-37",
"SG70":"Glass SG-70 STOLGlass",
"SG92":"SM-92T Turbo Finist",
"SGCD":"Saab 39C Gripen C",
"SGEF":"Saab 39E Gripen E",
"SGRA":"Sg Aviation Rally",
"SGUP":"377SGT Super Guppy",
"SH09":"Kopter SH-09",
"SH33":"Short 330",
"SH36":"Shorts 360",
"SH4":"Silvercraft SH-4",
"SH5":"Harbin SH-5",
"SHAC":"Avro 696 Shackleton",
"SHAW":"Hawker Sea Hawk",
"SHEA":"Seaflight Shearwater",
"SHEK":"Rans S-16 Shekari",
"SHER":"Sherpa",
"SHIP":"Airship",
"SHOE":"Mercury Shoestring",
"SHOP":"Salvay-Stark Skyhopper",
"SHOR":"Higher Class Super Hornet",
"SHRA":"Tlac Sherwood Ranger",
"SHRK":"Shark",
"SHRT":"Sherpa K-650T",
"SIDE":"Smyth S Sidewinder",
"SIGM":"Elitar Sigma",
"SILH":"Silhouette",
"SIRA":"Tecnam P2002 Sierra",
"SJ30":"Swearingen SJ-30",
"SK10":"Skyeton K-10 Swift",
"SK70":"Starkraft SK-700",
"SKAR":"Iii Sky Arrow",
"SKIF":"Aerolites AeroSkiff",
"SKIM":"Colonial C-1 Skimmer",
"SKRA":"Best Off Sky Ranger",
"SKYC":"Oma Sud Skycar",
"SKYO":"Skyote",
"SKYR":"Rearwin Skyranger",
"SL1":"Star-Lite",
"SL39":"Mapo SL-39",
"SL90":"Mapo I-1",
"SLCH":"Scaled 351 Stratolaunch",
"SLG2":"Sonaca S-2",
"SLG4":"Sling 4",
"SLH4":"Sling 4 High Wing",
"SLK3":"Slick 360",
"SLK5":"Slick 540",
"SM01":"Stern-Mallick SM-01 Vega",
"SM19":"Siai-Marchetti SM-1019",
"SM20":"Technoavia SM-2000",
"SM60":"Stinson SM-6000 Tri-Motor",
"SM92":"Technoavia SM-92 Finist",
"SMAX":"Airmax M-22 SeaMax",
"SMB2":"Dassault Super Myst\u00e8re B2",
"SNAD":"Snobird Adventurer",
"SNAP":"Tecnam FR-01 Snap",
"SNGY":"Lancair Synergy",
"SNOS":"Vsr SR-1 Snoshoo",
"SNS2":"Sorrell SNS-2 Guppy",
"SNS7":"Sorrell SNS-7 Hiperbipe",
"SNS9":"Sorrell SNS-9 EXP-2",
"SOKL":"Mraz M-1 Sokol",
"SONX":"Sonex",
"SORA":"Acs ACS-100 Sora",
"SP20":"Micco SP-20",
"SP33":"Spectrum S-33 Independence",
"SP55":"Technoavia SP-55",
"SP6E":"Sauser P-6E Replica",
"SP7":"Spartan 7 Executive",
"SP91":"Technoavia SP-91 Slava",
"SP95":"Technoavia SP-95",
"SPA2":"Stark-Trefethen Sport-Aire 2",
"SPAR":"Iii Speed Arrow",
"SPDR":"Rearwin 6000 Speedster",
"SPGY":"Sportster Gyro",
"SPHA":"American Autogyro Spinus",
"SPIR":"Questair Spirit",
"SPIT":"Supermarine Seafire",
"SPKR":"TL Ultralight Sparker",
"SPOR":"Amax Sport 1700",
"SPR2":"Carlson Sparrow 2",
"SPRT":"Practavia Sprite",
"SPST":"Rearwin 7000 Sportster",
"SPUP":"Sopwith Pup",
"SQ2T":"Kls Composites SQ-2000",
"SQES":"Slipstream SkyQuest",
"SR01":"Eurodisplay SR-01 Magic",
"SR20":"Cirrus SR20",
"SR22":"Cirrus SR22",
"SRAC":"Sport Racer",
"SRAI":"Sonerai",
"SRAS":"D-260 Senior Aero Sport",
"SRAY":"Dornier S-Ray 007",
"SREY":"SeaRey",
"SS2":"Rutan 339 Space Ship Two",
"SS2P":"Ayres Thrush",
"SS2T":"Ayres Turbo Thrush",
"SSAB":"F-100 Super Sabre",
"SSC":"Butterfly Super Sky Cycle",
"SSTL":"Just SuperSTOL",
"SSTM":"Sg Aviation Sea Storm",
"ST1":"Speedtwin",
"ST10":"Socata ST-10 Provence",
"ST3":"Stearman C-3",
"ST30":"Staudacher S-300",
"ST4":"Stearman 4 Junior Speedmail",
"ST6":"Stearman 6 Cloudboy",
"ST60":"Staudacher S-600",
"ST75":"Boeing-Stearman Kaydet",
"ST87":"Stern ST-87 Europlane",
"STAL":"Aircraft Designs Stallion",
"STAR":"Beechcraft 2000 Starship",
"STAT":"Turbine Stallion",
"STCH":"Fly Synthesis Storch",
"STFF":"Statler Firefly",
"STG2":"Rans S-18 Stinger 2",
"STIL":"Terzi T-9 Stiletto",
"STLN":"Helio AU-24 Stallion",
"STOR":"Storch",
"STRA":"Striplin Sky Ranger",
"STRE":"TL Ultralight Stream",
"STRI":"St. Croix Sopwith Triplane",
"STRK":"BAe BAC-167 Strikemaster",
"STRM":"Sg Aviation Storm",
"STST":"Cfm SA-2 Star Streak",
"SU17":"Sukhoi Su-17",
"SU24":"Sukhoi Su-24",
"SU25":"Sukhoi Su-25 Scorpion",
"SU26":"Sukhoi Su-26",
"SU27":"Sukhoi Su-27",
"SU29":"Sukhoi Su-29",
"SU31":"Sukhoi Su-31",
"SU38":"Sukhoi Su-38",
"SU57":"Sukhoi Su-57",
"SU7":"Sukhoi Su-7",
"SU80":"Sukhoi Su-80",
"SU95":"Sukhoi Superjet 100",
"SUBA":"Fuji FA-200 Aero Subaru",
"SUCO":"Bell 209 SuperCobra",
"SURN":"Korea Aerospace KUH-1 Surion",
"SUSO":"Vstol SS-2000 Super Solution",
"SV4":"Nord SV-4",
"SVNH":"ICP Savannah",
"SW18":"Skywood SW-18 Teddy",
"SW2":"Swearingen SA-26 Merlin 2",
"SW3":"Swearingen Merlin III",
"SW4":"Fairchild Metro",
"SWAK":"Warner Revolution 1",
"SWAT":"Bharat LT-1 Swati",
"SWFT":"Scaled 400 Swift",
"SWIN":"S-Wing",
"SWOR":"Fairey Swordfish",
"SX30":"Swearingen SX-300",
"SYCA":"Bristol 171 Sycamore",
"SYMP":"Symphony",
"SYNC":"Fly Synthesis Syncro",
"SZ45":"Szd SZD-45 Ogar",
"T1":"Fuji T-1",
"T10":"Tmm-Avia T-10 Avia-Tor",
"T101":"Aeroprogress T-101 Grach",
"T134":"Tupolev Tu-134",
"T154":"Tupolev Tu-154",
"T160":"Tupolev Tu-160",
"T18":"Thorp T-18",
"T19":"Thk T-19 T\u00fcrkku\u015fu",
"T2":"Rockwell T-2 Buckeye",
"T204":"Tupolev Tu-204",
"T206":"Cessna T206 Stationair",
"T210":"Cessna T210 Centurion",
"T211":"Indus T-211 Sport E",
"T22M":"Tupolev Tu-22M",
"T250":"Bellanca T-250 Aries",
"T28":"North American T-28 Trojan",
"T30":"Terzi T-30 Katana",
"T33":"Lockheed T-33 Shooting Star",
"T334":"Tupolev Tu-334",
"T34P":"Beechcraft T-34 Mentor",
"T34T":"T-34C Turbo Mentor",
"T35":"Temco T-35 Buckaroo",
"T37":"Cessna T-37",
"T38":"T-38 Talon",
"T4":"Kawasaki T-4",
"T40":"Turner T-40",
"T411":"Khrunichev T-411 Aist",
"T415":"Khrunichev T-415 Snegir",
"T419":"Khrunichev AT-419 Strekoza",
"T5":"Fuji T-5",
"T50":"Cessna T-50 Bobcat",
"T51":"Titan T-51 Mustang",
"T5YY":"AIDC T-5 Yung Yin",
"T6":"North American T-6 Texan",
"T7":"Fuji T-7",
"TA15":"Taylorcraft 15 Tourist",
"TA16":"Thurston TA-16 Trojan",
"TA20":"Taylorcraft 20 Topper",
"TAGO":"Team Tango Tango-2",
"TAIL":"Wittman Tailwind",
"TAMP":"Socata Tampico",
"TARO":"Anahuac Tauro",
"TARR":"Pelegrin Tarragon",
"TAYA":"Taylorcraft A",
"TAYB":"Taylorcraft BC",
"TAYD":"Taylorcraft D",
"TB05":"Amc Texas Bullet 205",
"TB20":"Socata Trinidad",
"TB21":"Socata TB-21 Trinidad TC",
"TB30":"Aerospatiale TB-30 Epsilon",
"TB31":"Socata TB-31 Omega",
"TBEE":"UC-1 Twin Bee",
"TBM":"Grumman TBF Avenger",
"TBM7":"Daher TBM 700",
"TBM8":"Daher TBM 850",
"TBM9":"Daher TBM 900",
"TBR3":"Golden Circle T-Bird 3",
"TC2":"Aero Mirage TC-2",
"TCAT":"Grumman F7F Tigercat",
"TCOU":"Helio U-5 Twin Courier",
"TD1":"Taiwan Dancer TD-1",
"TD2":"Turbine Design TD-2 Tempest",
"TD3":"TD-3 Alluvion Legend",
"TEAL":"Schweizer TSC-1 Teal",
"TERM":"Smith Termite",
"TERR":"Foxcon Terrier",
"TEX2":"T-6 Texan II",
"TEXA":"Fly Synthesis Texan",
"TF19":"Taylorcraft F-19",
"TF21":"Taylorcraft F-21",
"TF22":"Taylorcraft F-22 Classic",
"TFOC":"Focke-Wulf Fw-190",
"TFUN":"Valentin Taifun",
"TIAD":"Trike Icaros Adventure",
"TIGR":"Eurocopter EC-665 Tiger",
"TIJU":"Avions Fairey Tipsy Junior",
"TIPB":"Avions Fairey Tipsy B",
"TJET":"Maverick TJ-1500 TwinJet",
"TL20":"TL Sting",
"TL30":"TL Ultralight TL-3000 Sirius",
"TLEG":"Performance Turbine Legend",
"TM5":"Tm Aircraft TM-5",
"TMOT":"Fisher R-80 Tiger Moth",
"TMUS":"Papa 51 Thunder Mustang",
"TNAV":"Riley 55 Twin Navion",
"TNDR":"Dream Tundra",
"TOBA":"Socata Tobago",
"TOOT":"Meyer Little Toot",
"TOR":"BAe Tornado",
"TOUR":"Victa Airtourer",
"TOXO":"Cag Toxo",
"TP40":"Thunder Wings Curtiss P-40",
"TPIL":"Enaer T-35TX Auc\u00e1n",
"TPIN":"Twin Pioneer",
"TR20":"Tech'aero TR-200",
"TR55":"3xtrim 550 Trener",
"TRAL":"Groppo Trail",
"TRAP":"Capella T-Raptor",
"TRBA":"Podesva Trener Baby",
"TRDO":"Titan Tornado",
"TRF1":"Team Rocket F-1",
"TRIM":"Ford 4-AT Tri-Motor",
"TRIS":"BN-2A Mk3 Trislander",
"TRMA":"Stinson A Tri-Motor",
"TRWN":"Pacific Airmotive Tradewind",
"TS11":"Pzl-Mielec TS-11 Iskra",
"TS8":"Pzl-Mielec TS-8 Bies",
"TSPT":"Supermarine Spitfire",
"TSTN":"Terrafugia Transition",
"TSTR":"Air & Space Twinstar",
"TTRS":"Humbert Tetras",
"TTWO":"Parker Teenie Two",
"TU16":"Tupolev Tu-16",
"TU22":"Tupolev Tu-22",
"TU95":"Tupolev Tu-95",
"TUCA":"Embraer Tucano",
"TUCR":"Flying Legend Tucano Replica",
"TUCT":"Turbine Tucano Replica",
"TUL3":"Podesva TUL-03 Amigo",
"TUTR":"Avro 621 Tutor",
"TVL4":"Travel Air 4",
"TVLB":"Travel Air B",
"TWEN":"Tecnam P2010",
"TWIR":"Dyn'aero Twin-R",
"TWST":"Silence Twister",
"TZRV":"Iriaf JT-2-2 Tazarve",
"U15":"Phoenix",
"U16":"Grumman HU-16 Albatross",
"U2":"U-2 Dragon Lady",
"U21":"Beechcraft U-21 Ute",
"U22":"Beechcraft QU-22",
"UBAT":"Australite Ultrabat",
"UF10":"Urban UFM-10 Samba",
"UF13":"Distar UFM-13 Lambada",
"UFHT":"Ufo HeliThruster",
"UH1":"Bell UH-1 Huey",
"UH12":"Hiller UH-12",
"UH1Y":"Bell UH-1Y",
"UHEL":"Ultralight helicopter",
"UL10":"10 Ultimate Winner",
"UL20":"Ultimate 20",
"UL2F":"Aeros UL-2000 Flamingo",
"UL39":"Cvut UL-39 Albi",
"UL45":"3xtrim 450 Ultra",
"ULAC":"Ultralight",
"ULTR":"Windracers Ultra",
"ULTS":"Ultrasport 496",
"UM18":"Fairchild F-18 Flymobil",
"UNIV":"Neiva T-25 Universal",
"URRA":"Ibis GS-600 Arrow",
"US2":"Shinmaywa US-2",
"UT60":"UTVA 60",
"UT65":"UTVA 65 Privrednik",
"UT66":"UTVA 66",
"UT75":"UTVA 75",
"UU12":"Udet U-12 Flamingo Replica",
"V1":"Grumman AO-1 Mohawk",
"V10":"Rockwell OV-10 Bronco",
"V22":"V-22 Osprey",
"V221":"Msw Votec 221",
"V252":"Msw Votec 252",
"V280":"Bell V-280 Valor",
"V322":"Msw Votec 322",
"V351":"Msw Votec 351",
"V452":"Msw Votec 452",
"V500":"Revolution Voyager-500",
"VALI":"Vultee BT-13 Valiant",
"VAMP":"De Havilland DH-100 Vampire",
"VANT":"Visionaire VA-10 Vantage",
"VAUT":"Sud SO-4050 Vautour",
"VELO":"Velocity",
"VELT":"Velocity V-Twin",
"VEZE":"Rutan VariEze",
"VF35":"F-35B Lightning 2",
"VF60":"Vulcanair VF-600 Mission",
"VG3T":"Aviakit Vega 3000",
"VGUL":"Percival K-1 Vega Gull",
"VIMA":"Valtion Viima",
"VIPJ":"Viper ViperJet",
"VIPR":"Paxman's Viper",
"VIX":"Skystar Kitfox Vixen",
"VIXN":"Amax Vixen",
"VJ22":"Volmer VJ-22 Sportsman",
"VK3P":"Cirrus",
"VK3T":"Cirrus",
"VL3":"JMB VL-3",
"VL3T":"VL-3 Evolution Turbine",
"VLOT":"Velocity XL",
"VLTT":"Velocity V-Twin",
"VM1":"Vol Mediterrani VM-1 Esqual",
"VNOM":"De Havilland DH-112 Venom",
"VNTR":"ICP Ventura",
"VO10":"Volaircraft Volaire 10",
"VOL2":"Volante Two",
"VP2":"Evans VP-2",
"VR20":"Egvoyager VR-202",
"VR7":"Vashon Ranger",
"VSON":"Pro-Composites Vision",
"VTOR":"Vulcanair AP-68TP-600 Viator",
"VTRA":"Rans S-19 Venterra",
"VTUR":"Questair M-20 Venture",
"VUT1":"Evektor VUT-100 Cobra",
"VVIG":"Rutan 27 VariViggen",
"VW10":"Wilden VoWi-10",
"VWIT":"Aircraft Spruce V-Witt",
"W11":"Wolf W-11 Boredom Fighter",
"W135":"Boeing WC-135R",
"W201":"Weatherly 201",
"W3":"Pzl-Swidnik W-3 Erka",
"W5BC":"Wittman W-5 Buttercup",
"W62T":"Weatherly 620TP",
"WA40":"Wassmer WA-40 Super 4",
"WA41":"Wassmer WA-41 Baladou",
"WA42":"Wassmer WA-421 Prestige",
"WA50":"Wassmer WA-52 Europa",
"WA80":"Wassmer WA-80 Piranha",
"WAC9":"Waco 9",
"WACA":"Waco IBA",
"WACC":"Waco Cabin",
"WACD":"Waco D",
"WACE":"Waco E Aristocrat",
"WACF":"Waco F-series",
"WACG":"Waco G",
"WACM":"Waco JWM",
"WACN":"Waco AVN",
"WACO":"Waco biplane",
"WACT":"Waco RPT",
"WAIX":"Sonex Waiex",
"WASP":"Westland Wasp",
"WB57":"Martin WB-57",
"WBOO":"DW-200 Whitney Boomerang",
"WCAT":"Grumman F4F Wildcat",
"WDEX":"Windexair Windex",
"WESX":"Westland WS-58 Wessex",
"WF4U":"War Vought F4U Corsair",
"WFOC":"War Focke-Wulf 190",
"WFUR":"War Hawker Sea Fury",
"WH1":"Wendt WH-1 Traveler",
"WH4":"Hall WH-4 Harpoon",
"WHAT":"Whatley Special",
"WHIL":"WLAC-1 White Lightning",
"WHIT":"Miles M-11 Whitney Straight",
"WHK2":"Rutan 348 White Knight Two",
"WICH":"Javelin Wichawk",
"WILT":"Aerostar WT-01 Wild Thing",
"WIND":"Watson GW-1 Windwagon",
"WINE":"Windecker Eagle",
"WIRR":"Commonwealth CA-16 Wirraway",
"WISP":"Whisper",
"WLBY":"Fly Synthesis Wallaby",
"WM2":"Miller WM-2",
"WOPU":"Aerosport Woody Pusher",
"WP40":"War Curtiss P-40 Kittyhawk",
"WP47":"Republic P-47 Thunderbolt",
"WS22":"Spring WS-202 Sprint",
"WSP":"Aak Wasp",
"WT10":"Aerospool WT-10 Advantic",
"WT9":"Aerospool Dynamic",
"WUSH":"W\u00fcst Shark",
"WW1":"White WW-1 Der J\u00e4ger D-9",
"WW23":"IAI 1123 Westwind",
"WW24":"IAI Westwind",
"WX35":"Whisper X-350",
"WZ10":"Changhe WZ-10",
"WZER":"War Mitsubishi Zero",
"X2":"Sikorsky X-2",
"X3":"Eurocopter X-3",
"X47B":"Northrop Grumman X-47B",
"X49":"Sikorsky X-49 SpeedHawk",
"X59":"Lockheed Martin X-59 QueSST",
"XA41":"Xtremeair XA-41",
"XA42":"Xtremeair XA-42",
"XA85":"Raj Hamsa XA-85 X-Air LS",
"XAIR":"Raj Hamsa X-AIR Falcon",
"XB1":"Boom XB-1",
"XL2":"Liberty XL-2",
"XNON":"Celier Xenon",
"XNOS":"Sonex Xenos",
"Y11":"Harbin Y-11",
"Y112":"Yakovlev Yak-112",
"Y12":"Harbin Y-12E Harbinger",
"Y12F":"Harbin Y-12F Aircar",
"Y130":"Yakovlev Yak-130",
"Y18T":"Technoavia SM-94",
"Y20":"Xian Y-20 Kunpeng",
"YA1":"Yeoman YA-1 Cropmaster",
"YAK3":"Yakovlev Yak-3",
"YAK9":"Yakovlev Yak-9",
"YALE":"North American NJ Yale",
"YARR":"Arrow",
"YAST":"Sgau Yastreb",
"YC12":"Chasle YC-12 Tourbillon",
"YK11":"Yakovlev Yak-11",
"YK12":"Yakovlev Yak-12",
"YK18":"Yakovlev Yak-18",
"YK28":"Yakovlev Yak-28",
"YK30":"Yakovlev Yak-30",
"YK40":"Yakovlev Yak-40",
"YK42":"Yakovlev Yak-42",
"YK50":"Yakovlev Yak-50",
"YK52":"Yakovlev Yak-52",
"YK53":"Yakovlev Yak-53",
"YK54":"Yakovlev Yak-54",
"YK55":"Yakovlev Yak-55",
"YK58":"Yakovlev Yak-58",
"YL15":"Boeing YL-15 Scout",
"YNHL":"Aviaimpex KT-112 Yanhol",
"YS11":"Mitsubishi YS-11",
"YUKN":"Murphy Yukon",
"YUNO":"Shuya Yunona",
"YURO":"Soko-Cniar J-22 Orao",
"Z22":"Moravan Zlin Z-22 Junak",
"Z26":"Moravan Zlin Z-26 Trener",
"Z37P":"Moravan Z-37 Cmel\u00e1k",
"Z37T":"Moravan Z-37T Agro Turbo",
"Z42":"Zlin Z-42/142/242",
"Z43":"Moravan Zlin Z-43",
"Z50":"Moravan Zlin Z-50",
"ZA6":"Aerokopter ZA-6 Sanka",
"ZEFR":"Curti Zefhir",
"ZEP2":"Arnet Pereyra Zephyr 2",
"ZEPH":"Atec 122 Zephyr",
"ZERO":"Mitsubishi A6M Zero",
"ZIU":"TAI ZIU",
"ZULU":"Bul Z\u00f9l\u00f9"
}));
// Map icons grouped as "shape.wake"; wake is the ICAO category (L, LM, M, H, J).
const AIRCRAFT_ICONS=Object.freeze({
"airliner.L":"XB1",
"airliner.M":"A148 A158 A178 A19N A20N A21N A3 A318 A319 A320 A321 A6 A743 AJ27 AMX AN72 AT3 B21 B37M B38M B39M B3XM B732 B733 B734 B735 B736 B737 B738 B739 B752 B753 BA11 BCS1 BCS3 BE4W BER2 BER4 BT7 BUC C1 C919 CKUO CNBR E170 E190 E195 E275 E290 E295 E390 E530 E737 E75L E75S ETAR F1 F104 F2 F5SA F8 F86 F9F FC1 GA3C GA4C GJ11 HAR HF20 HUNT I22 IL28 J10 J20 J328 J8A J8B JAGR JCOM JH7 JL9 K50 KAAN KF21 KFIR KZLA L15 L159 LCA LTNG M17 M346 M55 MC23 METR MG19 MG21 MG23 MG25 MG31 MG44 MIRA MT2 MYS4 P8 Q25 Q4 Q5 R721 R722 S3 S37 SB29 SB32 SB35 SB37 SBR2 SGCD SGEF SHAW SMB2 SSAB SU17 SU24 SU25 SU57 SU7 SU95 T154 T204 T22M T33 T334 T4 T5YY TU16 TU22 U2 VAUT VF35 VNOM WB57 WW23 X47B X59 Y130 YK28 YK42 YURO",
"balloon.L":"BALL",
"balloon.M":"SHIP",
"fighter.L":"L29 L39 T38",
"fighter.LM":"HAWK",
"fighter.M":"A10 A4 AJET EUFI F117 F14 F15 F16 F18H F18S F22 F35 F4 F5 MG29 MIR2 MRF1 RFAL SU27 TOR",
"glider.L":"GLID",
"helicopter.L":"A002 A109 A119 A129 A139 A169 A205 A2RT A600 AC10 AC31 ADEL AG1 ALH ALO2 ALO3 ANST AR1 AS50 AS55 AS65 B06 B06T B105 B150 B212 B222 B230 B305 B407 B412 B427 B429 B430 B47G B47J B47T B505 BABY BK17 BR54 BRB2 CDUS CH12 CH14 CH7 CHIF CHSY CLD2 CLON CMD1 CMDE CMDT COMU DEAG DJIN DRAG DRON DYH2 DYH3 EC20 EC30 EC35 EC45 EC55 EGL3 EL10 ELA7 ELTO EN28 EN48 ES11 EXEC EXEJ EXPL FH11 G2CA GAZL GOBU GYRO H12T H160 H2 H21 H269 H43A H43B H500 HA2 HAW3 HSMT HUCO HW4P HW4T HX2 IS2 J4B2 JAG2 JE2 JRO K126 K209 K226 KA26 KA62 KH4 KMAX LAMA LCH LR2T LYNX M74 MD52 MD60 MH20 MI2 MI34 MI4 MM14 MM16 MM19 MM21 MM22 MM24 MMAX MT NA40 OH1 OKHO PAV4 PCA2 PHIL PHIX PSW4 PUMA R22 R4 R44 R66 RAF2 REV6 RMOU RP1 RPUP S274 S278 S285 S330 S360 S434 S51 S52 S55P S55T S58P S58T S62 S65C S76 S97 SCII SCOR SCOU SH09 SH4 SNAD SPGY SPHA SSC SYCA TIGR TSTR UFHT UH1 UH12 UHEL ULTS UM18 V500 W3 WASP WESX WZ10 X2 X3 XNON YNHL ZA6 ZEFR",
"helicopter.M":"A149 A189 AC33 AS32 AS3B B214 B525 BSTP EC25 EC75 EH10 FREL H46 H47 H53 H53S H60 H64 KA25 KA27 KA50 KA52 MI10 MI14 MI24 MI26 MI28 MI38 MI6 MI8 NH90 RVAL S61 S61R S64 S92 SB1 SUCO SURN UH1Y X49",
"jet.L":"A37 A700 ARES BD10 BD5J C101 C22J C25A C25B C25M C500 C501 C510 C525 C550 C551 C55B CL41 COZJ E50P EA40 EA50 EM10 FJ10 FOUG G2GL G4SG G91 GNAT GSPN HDJT HT16 HT36 IA63 IR99 JAST JPRO JSX K8 L59 LAR1 LJ23 LJ24 LJ25 LJ28 M15 M326 M339 M345 ME62 MG15 MG17 MS76 PRM1 PRTS Q28 Q58 S200 S211 S401 S601 S716 SATA SB05 SF50 SJ30 SP33 STRK SWFT T1 T2 T37 TJET TS11 TZRV VAMP VANT VIPJ YK30",
"jet.M":"ASTR B712 B721 B722 BE40 C25C C560 C56X C650 C680 C68A C700 C750 CL30 CL35 CL60 CRJ1 CRJ2 CRJ7 CRJ9 CRJX DC91 DC92 DC93 DC94 DC95 E135 E145 E35L E45X E545 E550 E55P F100 F28 F2TH F70 F900 FA10 FA20 FA50 FA6X FA7X FA8X G150 G280 GA5C GA6C GA7C GA8C GALX GL5T GL7T GLEX GLF2 GLF3 GLF4 GLF5 GLF6 H25A H25B H25C HA4T LJ31 LJ35 LJ40 LJ45 LJ55 LJ60 LJ70 LJ75 MD81 MD82 MD83 MD87 MD88 MD90 MU30 PC24 SBR1 T134 WW24 YK40",
"propquad.H":"A400 AN22 TU95",
"propquad.L":"AXE G21M HERN JAS4",
"propquad.M":"AG60 AN12 AN70 B17 B24 B29 BELF C130 C30J C97 CARV CL4G CONI DC4 DC6 DC7 DHC7 IL18 IL38 L188 LANC P3 P4Y SAND SGUP SH5 SHAC US2",
"quad.H":"A124 A342 A343 A345 A346 A50 B1 B2 B52 B703 B741 B742 B743 B744 B748 B74R B74S BLCF C135 C17 C5M DC86 DC87 E3CF E3TF E6 IL62 IL76 IL86 IL96 K35E K35R KE3 MYA4 R135 SLCH T160 W135 Y20",
"quad.J":"A388",
"quad.M":"B461 B462 B463 B701 B720 C15 L29A L29B P1 RJ1H RJ70 RJ85 WHK2",
"single.L":"A122 A19 A21 A210 A211 A22 A223 A23 A25 A27 A270 A29 A31 A33 A35 A5 A504 A660 A890 A9 A900 A910 AA1 AA5 AAT3 AAT4 AB11 AB15 AB18 AB95 AC11 AC4 AC5A ACAR ACED ACR2 ACRO ACSR AD20 ADVE ADVN AEA1 AERK AFOX AG02 AG04 AG10 AG14 AGSH AI10 AIGT AIRD AKOY AKRO ALBU ALC1 ALGR ALIG ALPI ALSL ALTO AM3 AN2 AN3 ANDR ANKA AP20 AP22 AP24 AP32 APM2 APM3 APM4 APUP AR11 AR15 AR50 AR5T AR65 AR6T ARV1 ARWF AS02 AS14 AS16 AS2T AS80 ASDR ASO4 ASO5 ASOX ASTO AT1 AT2P AT3P AT3T AT5P AT5T AT6T ATAC ATIS ATL ATTL AU11 AUJ2 AUJ4 AURA AUS3 AUS4 AUS5 AUS6 AUS7 AUS9 AV68 AVAM AVID AVIN AVTR B14A B14B B14C B209 B23E B360 B36T B60 BARC BBAT BBIR BCA3 BCAT BCMP BD17 BD4 BD5 BD5T BDOG BE17 BE19 BE22 BE23 BE24 BE33 BE35 BE36 BE77 BEA5 BEAR BETA BEVR BF19 BFIT BILO BIPL BIRD BISC BKUT BL11 BL17 BL19 BL8 BLBU BLKS BLSA BM6 BMAN BO40 BOBC BOLT BORY BPAT BPUM BR14 BR23 BR60 BR61 BR8 BRAV BREZ BROU BSWN BT36 BTB2 BTB3 BTUB BU31 BU33 BU81 BUCA BUSH BW60 BW6T BX2 C06T C07T C10T C120 C140 C150 C152 C162 C170 C172 C175 C177 C180 C182 C185 C188 C190 C195 C205 C206 C207 C208 C210 C240 C270 C306 C309 C311 C365 C42 C72R C77R C82R C82S C82T CA12 CA19 CA1P CA1T CA25 CA3 CA4 CA41 CA6 CA61 CA65 CA7P CA7T CA8 CA9 CABI CABN CAD2 CAD4 CAML CAMP CAN4 CAPL CAR CASS CAT1 CAW CB1 CC11 CC19 CDC6 CDW1 CE15 CE23 CE43 CEL5 CELR CENT CFRE CG3 CGAN CH10 CH15 CH18 CH20 CH25 CH2T CH3 CH30 CH50 CH60 CH64 CH65 CH70 CH75 CH7A CH7B CH80 CHAN CHCS CHIC CHIN CHIP CHP2 CHR1 CHR4 CJ1 CJ6 CLA CLB1 CLBR CLDS CMA3 CMAS CN12 CNUK CO50 COAR COBR COL3 COL4 COLT COOT CORO CORR COUG COUR COY2 COZY CP10 CP13 CP20 CP21 CP22 CP23 CP30 CP32 CP60 CP65 CP75 CP80 CP90 CPNA CPUP CR10 CRBN CRER CRES CRIO CRUZ CT4 CTAH CTLN CUB2 CUCA CUDA CULP CULV CX5 CYGT D11 D139 D140 D150 D18 D201 D21 D24 D25 D250 D253 D31 D39 D4 D5 D5TU D6 D6CR D7 D8 DA2 DA36 DA40 DA5 DA50 DAHU DAKH DAL1 DAL4 DAL5 DART DDUC DF10 DF1M DF2 DF3 DFL6 DFLY DG15 DH2T DH3T DH60 DH80 DH82 DH83 DH85 DH87 DH94 DHC1 DHC2 DHC3 DIES DIMO DNGO DO27 DOCX DON DR1 DR10 DR22 DR30 DR40 DRIF DRTG DSA1 DSK DSLK DT45 DTA1 DTA2 DUB2 DUCE DUR5 DV1 DV2 DV20 DW1 DWD2 E200 E230 E2CB E300 E314 E350 E400 E500 EAEA EAGL EAGX EBOY EC6 ECHO EDGE EDGT EF2 EFOX EFUS EGRT EL20 ELF ELPS ELSP ELST ELTR EP9 EPER EPIC EPX1 ERAC ERCO ES13 ESCA ESCP EUPA EURT EV97 EVOP EVOT EVSS EX5T EXNG EXPR EZFL EZHV EZKC F13 F156 F1FV F260 F26T F30 F3F F402 F421 F8L FA01 FA02 FA03 FA04 FA11 FA24 FA62 FAET FALC FALM FANL FANT FB1A FB1B FB5 FBA2 FD2E FDCT FDF2 FDMC FE51 FEST FFLY FG01 FGT FIBO FIKD FIKE FINC FJR3 FK12 FK14 FK9 FL3 FL53 FL54 FL55 FLCO FLE2 FLE7 FLIZ FLSH FLSS FM25 FMGO FN33 FNKB FOOF FORT FOX FOXT FRBD FREE FRNT FRON FS35 FS51 FT30 FU24 FURY FUSI FW02 FW44 FW90 FWSB FX1 G1 G109 G115 G120 G12T G140 G15T G160 G164 G180 G200 G202 G2T1 G3 G46 G59 G64T G70 G800 G97 GA10 GA20 GA8 GABR GAUN GAVI GB1 GBSP GC1 GENI GEPE GLAD GLAS GLSP GLST GLTU GM17 GMGC GOLF GOOS GP1 GP3 GP4 GPRO GR51 GRFN GRIF GRIZ GSIS GUEP GURI GX GY10 GY20 GY30 GY80 H202 H207 H40 HA31 HAHU HANS HB21 HB23 HB3 HCAT HEAD HI27 HIGH HIND HL2 HLC4 HLD4 HM38 HN70 HORN HORZ HR10 HR20 HRM9 HRNT HROC HRON HT2 HT40 HU1 HU2 HUML HURI HURK HUSK HYPR I103 I115 I11B I153 I15B I16 I23 I3 I66 IA46 IFUR IMPU INCQ INEC INEX INTG ION IP06 IP10 IP26 IP6A IPAN IR22 IR23 IR24 IR25 IR27 IR28 IR46 IRBS IS28 ISAT ISPT J1 J177 J2 J3 J300 J4 J400 J40E J5 J600 JAB2 JAB4 JABI JACE JAJ5 JAJ6 JARO JB15 JC01 JC02 JCRU JD2 JDOE JFOX JK05 JN76 JPM1 JRC1 JT2 JUN1 JUN2 JUNR JUPI K100 K51 K900 KAK1 KAK2 KAK3 KAT3 KATR KEHA KELA KELD KERO KEST KFAB KFAS KFIS KIS2 KIS4 KITH KITI KK60 KL07 KL10 KL25 KL35 KLBR KM2 KNTW KODI KOLL KP2 KP5 KR1 KR2 KR21 KR30 KR31 KR34 KRAG KRAH KRIC KT1 KTOO KZ2 KZ3 KZ7 KZ8 L11 L11E L13 L13M L13S L181 L380 L40 L5 L60 L70 L8 L90 LA25 LA4 LA60 LA6T LACO LAKR LAKX LARK LAST LBUG LCB LCR LEG2 LEGD LESP LEV2 LEV4 LGEZ LGND LH10 LIBE LION LM5 LM5X LM7 LMC1 LMK1 LN27 LN3 LNC2 LNC4 LNCE LNP4 LNT4 LOCA LOVE LP1 LS2 LSTR LUL5 LUL6 LUL7 LUL8 LW20 LW40 LWIN LX32 LX34 LXR LYSA M10 M101 M106 M108 M110 M18 M18T M2 M200 M20P M20T M21 M212 M22 M24 M26 M2HK M308 M4 M5 M6 M600 M7 M700 M7T M8 M9 MA1 MA5 MAGC MAGI MAGN MAJR MAKO MAMB MAME MAVR MB70 MB80 MC01 MC45 MC90 MCOU MCOY MCR1 MCR4 MCRR MCUL MD3 MD3R ME08 ME09 MEAD MEL2 MESS MF17 MGIC MGNM MGUL MH46 MIDR MIMP MIMU MITE MJ10 MJ12 MJ1H MJ2 MJ4 MJ5 MJ51 MJ53 MJ7 MJ77 MJ8 MJ80 MJ9 MJ90 MLER MMUT MNEX MOCU MOGO MOL1 MON2 MONA MONI MOR2 MOSP MOTO MP02 MP20 MR25 MR35 MR3T MRAI MRMD MRTN MS1 MS23 MS31 MS73 MSAI MSQ2 MU23 MUS2 MVN1 MVRK MX10 MX1T MX2 MX58 MX65 MX80 MXS MY12 MY13 N110 N120 N3 N320 N340 N3N N5A N5B NARN NAVI NC85 ND1T NDAC NDAT NDIC NFEX NG4 NG5 NI28 NIBB NIPR NM5 NMCU NNJA NORS NPOR NST6 NSTR NT10 NXT O1 O3 OCNR OM1 OMGA OMLA OMSD ONE ONEX OPCA OR10 OSCR OVOD OZZI P100 P130 P148 P149 P18T P19 P208 P210 P220 P230 P250 P25B P27 P270 P28A P28B P28R P28S P28T P28U P32R P32T P39 P40 P46T P50 P51 P57 P60 P63 P70 P750 P80 PA11 PA12 PA14 PA15 PA16 PA17 PA18 PA20 PA22 PA24 PA25 PA32 PA36 PA38 PA46 PACE PAGO PANT PAR1 PAR4 PARA PARL PAUL PC12 PC21 PC6P PC6T PC7 PC9 PEGZ PELI PETL PETR PGEE PGK1 PIAE PIAT PICO PILL PINO PIPA PISI PIT4 PIVE PIVI PK11 PK15 PK18 PK21 PK23 PK25 PKAN PL1 PL12 PL2 PL4 PL9 PLUS PNR2 PNR3 PNR4 PNTH PO2 PO60 POLI PONY PP2 PP3 PPRO PRBP PRBR PREN PRET PREX PRIM PROC PROT PROW PRPR PRXT PSTM PT22 PT70 PT80 PTMS PTS1 PTS2 PTSS PULR PULS PUP PURS PUSH PVTR PZ01 PZ02 PZ04 PZ06 PZ12 PZ3T PZ4M PZ6T Q01 Q1 Q9 QAIL QALT QIC2 QR01 QUAS QUIC R100 R109 R11 R12 R185 R2 R200 R300 R90F R90R R90T RA14 RA17 RAID RAIL RALL RANG RARO RAV3 RAV5 RAZM RBEL RC3 RCAL RD03 RD20 RDH2 RELI RENE RF10 RF3 RF4 RF47 RF5 RF6 RF9 RGNT RISN RJ03 RK3 RK5 RLU1 RNGR RODS ROND ROSE RS12 RS18 RS20 RS21 RTA4 RUBI RV10 RV12 RV14 RV15 RV3 RV4 RV4T RV6 RV7 RV8 RV9 RVST RW19 RW20 RW22 RW26 RW3 RYST S05F S05R S1 S10 S108 S11 S12 S15S S15U S160 S208 S21 S223 S22T S355 S39 S4 S45 S450 S51D S522 S6 S900 SA02 SA03 SA04 SA05 SA10 SA11 SA2 SA20 SA3 SA30 SA37 SA50 SA6 SA6E SA7 SA70 SA75 SAB2 SABA SABW SACE SACR SAFF SAH1 SAKO SALB SAM SAPH SASP SASY SAVA SAVG SB7 SB91 SBD SBOY SC01 SCAM SCEP SCOM SCRO SCTR SCUB SCW1 SD2 SD4 SDUS SE1 SE5A SE5R SEAT SEAW SERA SF2 SF23 SF24 SF25 SF28 SF31 SF35 SF36 SG37 SG70 SG92 SGRA SHEA SHEK SHER SHOE SHOP SHOR SHRA SHRK SHRT SIDE SIGM SILH SIRA SK10 SKAR SKIF SKIM SKRA SKYO SKYR SL1 SL39 SL90 SLG2 SLG4 SLH4 SLK3 SLK5 SM01 SM19 SM20 SM92 SMAX SNAP SNGY SNOS SNS2 SNS7 SNS9 SOKL SONX SORA SP20 SP55 SP6E SP7 SP91 SP95 SPA2 SPAR SPDR SPIR SPIT SPKR SPOR SPR2 SPRT SPST SPUP SQ2T SR01 SR20 SR22 SRAC SRAI SRAS SRAY SREY SS2P SS2T SSTL SSTM ST10 ST3 ST30 ST4 ST6 ST60 ST75 ST87 STAL STAT STCH STFF STG2 STIL STLN STOR STRA STRE STRI STRM STST SU26 SU29 SU31 SU38 SUBA SUSO SV4 SVNH SW18 SWAK SWAT SWIN SWOR SX30 SYMP SYNC SZ45 T10 T101 T18 T19 T206 T210 T211 T250 T28 T30 T34P T34T T35 T40 T411 T415 T419 T5 T51 T6 T7 TA15 TA16 TA20 TAGO TAIL TAMP TARO TARR TAYA TAYB TAYD TB05 TB20 TB21 TB30 TB31 TBM7 TBM8 TBM9 TBR3 TC2 TD1 TD2 TD3 TEAL TERM TERR TEX2 TEXA TF19 TF21 TF22 TFOC TFUN TIAD TIJU TIPB TL20 TL30 TLEG TM5 TMOT TMUS TNDR TOBA TOOT TOUR TOXO TP40 TPIL TR20 TR55 TRAL TRAP TRBA TRDO TRF1 TS8 TSPT TSTN TTRS TTWO TUCA TUCR TUCT TUL3 TUTR TVL4 TVLB TWEN TWST U15 U22 UBAT UF10 UF13 UL10 UL20 UL2F UL39 UL45 ULAC UNIV URRA UT60 UT65 UT66 UT75 UU12 V221 V252 V322 V351 V452 VALI VELO VEZE VF60 VG3T VGUL VIMA VIPR VIX VIXN VJ22 VK3P VK3T VL3 VL3T VLOT VM1 VNTR VO10 VOL2 VP2 VR20 VR7 VSON VTRA VTUR VUT1 VVIG VW10 VWIT W11 W201 W5BC W62T WA40 WA41 WA42 WA50 WA80 WAC9 WACA WACC WACD WACE WACF WACG WACM WACN WACO WACT WAIX WBOO WCAT WDEX WF4U WFOC WFUR WH1 WH4 WHAT WHIL WHIT WICH WILT WIND WINE WIRR WISP WLBY WM2 WOPU WP40 WP47 WS22 WSP WT10 WT9 WUSH WW1 WX35 WZER XA41 XA42 XA85 XAIR XL2 XNOS Y112 Y18T YA1 YAK3 YAK9 YALE YARR YAST YC12 YK11 YK12 YK18 YK50 YK52 YK53 YK54 YK55 YK58 YL15 YUKN YUNO Z22 Z26 Z37P Z37T Z42 Z43 Z50 ZEP2 ZEPH ZERO ZIU ZULU",
"single.LM":"AT8T",
"single.M":"A1 ALIZ CORS GANT P47 SS2 TBM",
"twin.L":"A251 A411 A500 AA37 AC50 AC52 AC56 AC68 AC6L AC72 AC80 AC90 AC95 ACAM ACRD AE45 AEST AIRL AKNC AN28 ANGL ANSN AP26 AP28 AP36 ARVA B103 B18T B58T B60T BASS BE10 BE18 BE30 BE50 BE55 BE56 BE58 BE60 BE65 BE70 BE76 BE80 BE88 BE95 BE99 BE9L BE9T BLEN BN2P BN2T BOOM BS60 BU20 C02T C04T C14T C21T C303 C310 C320 C335 C336 C337 C340 C402 C404 C411 C414 C421 C425 C441 CAT2 CD2 CE22 CE25 CE27 CH40 CH62 CICA CNDR CORV CULX D1 D228 D28D D28T DA42 DA62 DEFI DH84 DH88 DH89 DH90 DHA3 DHC6 DO28 DOVE E110 E121 EFAN EM11 EV55 EVAN EZFT F406 F41E F600 F7 FLAM G21 G21T G44 G73 G73T GA7 GDUK GEMI IA58 JS3 KATB KSTK KZ4 L10 L12 L200 L4 L410 L6 LA8 M36J MC10 MERK MU2 NOMA OR12 P06T P136 P180 P1HH P212 P337 P66P P66T P68 P68T PA23 PA27 PA30 PA31 PA34 PA44 PAT4 PAY1 PAY2 PAY3 PAY4 PDIG PEGA PEMB PRCE RC70 RYSA S122 S202 S38 S400 SA38 SA8T SASH SBLS SC7 SK70 SKYC SM60 SQES ST1 STAR SW2 SW3 T50 TBEE TCOU TNAV TPIN TRIM TRIS TRMA TRWN TWIR U21 ULTR V10 VELT VLTT VTOR Y11 Y12",
"twin.LM":"B350 BE20 JS31 M28 SW4",
"twin.M":"A140 A20 A748 AN24 AN26 AN30 AN32 AN38 AN8 AT43 AT44 AT45 AT46 AT72 AT73 AT75 AT76 ATLA ATP B190 B23 B25 B26 B26M B609 BE12 BE32 C119 C123 C160 C2 C212 C27J C295 C408 C46 C82 CAT CL2P CL2T CN35 CVLP CVLT D328 DC2 DC3 DC3S DC3T DH4T DH8A DH8B DH8C DH8D DHC4 DHC5 E120 E2 F27 F50 F60 G159 G222 G96 H111 HD34 I112 I114 IL14 JS32 JS41 JU52 L14 L18 L37 L610 M404 MA60 MA6H MOSQ N219 N250 N260 N262 NORA P2 P38 P61 P82 S2P S2T SB20 SF34 SH33 SH36 SU80 TCAT U16 V1 V22 V280 Y12F YS11",
"widebody.H":"A306 A30B A310 A332 A333 A337 A338 A339 A359 A35K A3ST B762 B763 B764 B772 B773 B778 B779 B77L B77W B788 B789 B78X DC10 E767 KC2 L101 MD11"
});

return {AIRCRAFT_TYPES,AIRCRAFT_ICONS};
})();
// ---- live.mjs
__modules["live.mjs"]=(()=>{
const {IDS,number,coordinates,inZone}=__modules["core.mjs"];
// Standalone data source: builds the HA-shaped `states` the display already
// reads, from adsb.fi positions and ADSB.lol standing routes. Ports the
// selection/history template in home_assistant/packages/aircraft-package.yaml
// and the free (ADSB.lol) part of custom_components/office_aircraft_routes/model.py.

const HOUR=3600,SIX_HOURS=6*HOUR;
const HISTORY_KEY='whatsup.history.v1',LEDGER_KEY='whatsup.ledger.v1';
// adsb.fi serves at most 250 NM around a point.
const MAX_NM=250;
const FEED_URL=(lat,lon,nm)=>`https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nm}`;
const ROUTE_URL=call=>`https://vrs-standing-data.adsb.lol/routes/${call.slice(0,2)}/${call}.json`;
const HEX=/^[0-9a-f]{6}$/;

// --- Network: through the Vega app when present (adsb.fi sends no CORS header),
// otherwise the browser's own fetch. Resolves {status, payload}; never throws.
const pending=new Map();let nextRequest=0;
if(typeof window!=='undefined')window.__whatsupReply=(id,status,text)=>{
  const done=pending.get(id);if(done){pending.delete(id);done(status,text);}
};
function getJson(url,timeoutMs=8000){
  const bridge=typeof window!=='undefined'&&window.ReactNativeWebView;
  const parse=(status,text)=>{
    if(status!==200)return {status,payload:null};
    try{return {status,payload:JSON.parse(text)};}catch{return {status:'invalid',payload:null};}
  };
  if(bridge)return new Promise(resolve=>{
    const id=++nextRequest,timer=setTimeout(()=>{pending.delete(id);resolve({status:'connection_error',payload:null});},timeoutMs+2000);
    pending.set(id,(status,text)=>{clearTimeout(timer);resolve(parse(status,text));});
    try{bridge.postMessage(JSON.stringify({type:'get',id,url,timeoutMs}));}catch{pending.delete(id);clearTimeout(timer);resolve({status:'connection_error',payload:null});}
  });
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  return fetch(url,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal})
    .then(async r=>parse(r.status,r.status===200?await r.text():''))
    .catch(()=>({status:'connection_error',payload:null}))
    .finally(()=>clearTimeout(timer));
}

// Binary GET for map tiles: plain fetch first (OpenFreeMap sends CORS headers),
// then the app bridge, which returns the body base64-encoded. Resolves bytes or null.
async function getBytes(url,timeoutMs=10000){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{credentials:'omit',signal:controller.signal});
    if(r.status===200)return new Uint8Array(await r.arrayBuffer());
  }catch{/* try the bridge */}finally{clearTimeout(timer);}
  const bridge=typeof window!=='undefined'&&window.ReactNativeWebView;
  if(!bridge)return null;
  return new Promise(resolve=>{
    const id=++nextRequest,timer=setTimeout(()=>{pending.delete(id);resolve(null);},timeoutMs+2000);
    pending.set(id,(status,text)=>{
      clearTimeout(timer);
      try{resolve(status===200?Uint8Array.from(atob(text),c=>c.charCodeAt(0)):null);}catch{resolve(null);}
    });
    try{bridge.postMessage(JSON.stringify({type:'get',id,url,timeoutMs,binary:true}));}catch{pending.delete(id);clearTimeout(timer);resolve(null);}
  });
}

// --- Storage: localStorage when available, else memory for this launch only.
const memory=new Map();
const store={
  get(k){try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v);}catch{/* memory */}return memory.get(k)??null;},
  set(k,v){memory.set(k,v);try{localStorage.setItem(k,JSON.stringify(v));}catch{/* memory only */}},
  remove(k){memory.delete(k);try{localStorage.removeItem(k);}catch{/* memory only */}},
};

// --- Selection (aircraft-package.yaml template sensors).
const finite=(v,low=-Infinity,high=Infinity)=>number(v)&&v>=low&&v<=high;
const position=(lat,lon)=>finite(lat,-85,85)&&finite(lon,-180,180);
function haversine(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,p1=lat1*r,p2=lat2*r;
  const h=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin((lon2-lon1)*r/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
function feedStamp(body){
  const stamp=Number(body?.now)||0;
  return stamp>100000000000?stamp/1000:stamp;
}
// `radius`: miles (the circle), or a Window view zone {kind:'window',from,to,miles}.
function selection(ac,stamp,home,radius,now){
  const age=now-stamp,fresh=age>=-5&&age<=15,radians=0.017453292519943295;
  let nearest=null,best=Infinity;const inside=[];
  for(const a of fresh&&Array.isArray(ac)?ac:[]){
    if(!a||typeof a!=='object'||!position(a.lat,a.lon)||typeof a.hex!=='string'||!/^[a-fA-F0-9]{6}$/.test(a.hex)||
      !number(a.alt_baro)||!number(a.seen_pos)||a.seen_pos<0||a.seen_pos+age<0||a.seen_pos+age>20)continue;
    const x=(a.lon-home.longitude)*radians*Math.cos((home.latitude+a.lat)/2*radians),y=(a.lat-home.latitude)*radians;
    const miles=Math.sqrt(x*x+y*y)*3958.7613;
    const record={hex:a.hex,callsign:typeof a.flight==='string'?a.flight.trim():'',registration:a.r??'',
      aircraft_type:a.t??'',latitude:a.lat,longitude:a.lon,altitude_ft:a.alt_baro,speed_kt:a.gs??null,
      heading:a.track??null,distance_mi:Math.round(miles*100)/100,position_timestamp:stamp-a.seen_pos};
    const inAlert=typeof radius==='object'?inZone(radius,x*3958.7613,y*3958.7613):miles<=radius;
    if(inAlert){inside.push(record);if(miles<best){nearest=record;best=miles;}}
  }
  // No manual selection standalone: the current aircraft is the nearest one.
  return {candidate:nearest,current:nearest,feed_fresh:fresh,inside};
}
// The last 20 distinct in-boundary sightings, newest first.
function mergeHistory(old,inside){
  const present=new Set(inside.map(a=>a.hex));
  const rows=inside.map(a=>({hex:a.hex,callsign:a.callsign,registration:a.registration,
    aircraft_type:a.aircraft_type,last_seen:a.position_timestamp}));
  for(const a of Array.isArray(old)?old:[])
    if(a&&typeof a==='object'&&typeof a.hex==='string'&&!present.has(a.hex)&&number(a.last_seen))rows.push(a);
  return rows.sort((a,b)=>b.last_seen-a.last_seen).slice(0,20);
}

// --- Route enrichment (model.py: observations, commercial_route, Enricher/adsblol).
const DETOUR_MILES=60,DETOUR_SHARE=.05;
const SIGHTING=['latitude','longitude','heading','speed_kt','altitude_ft','vertical_rate','observed'];
const ident=v=>{const s=String(v||'').trim().toUpperCase();return /^[A-Z0-9-]{2,10}$/.test(s)?s:'';};
function provider(a){
  const call=ident(a.callsign),reg=ident(a.registration);
  if(String(a.callsign||'').trim()&&!call)return null;
  if(reg&&(!call||call.replaceAll('-','')===reg.replaceAll('-','')))return 'flightaware';
  return /^[A-Z]{3}[0-9][A-Z0-9]{0,5}$/.test(call)?'adsblol':null;
}
const key=a=>`${a.hex}:${ident(a.callsign)||ident(a.registration)}`;

function observations(raw,stamp,home,radius,history,now){
  if(!(now-stamp>=0&&now-stamp<=15)||!position(home.latitude,home.longitude))return [];
  const found=new Map();
  for(const a of Array.isArray(history)?history.slice(-20):[])
    if(a&&typeof a==='object'&&HEX.test(String(a.hex??''))&&number(a.last_seen)&&now-a.last_seen>=0&&now-a.last_seen<=SIX_HOURS)
      found.set(a.hex,{...a,observed:a.last_seen,live:false,inside:true});
  for(const a of Array.isArray(raw)?raw:[]){
    if(!a||typeof a!=='object')continue;
    const {lat,lon}=a,seen=a.seen_pos??999,hex=String(a.hex??'').toLowerCase();
    if(!HEX.test(hex)||!position(lat,lon)||!number(seen)||now-stamp+seen<0||now-stamp+seen>20||!number(a.alt_baro))continue;
    const rate=finite(a.baro_rate)?a.baro_rate:a.geom_rate;
    found.set(hex,{hex,callsign:ident(a.flight),registration:ident(a.r),latitude:lat,longitude:lon,
      heading:a.track,speed_kt:a.gs,altitude_ft:a.alt_baro,vertical_rate:finite(rate)?rate:null,
      observed:stamp-seen,live:true,inside:haversine(home.latitude,home.longitude,lat,lon)<=radius});
  }
  const rank=a=>Number(!(a.live&&a.inside));
  return [...found.values()].sort((a,b)=>rank(a)-rank(b)||b.observed-a.observed);
}

function bearing(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,p1=lat1*r,p2=lat2*r,dl=(lon2-lon1)*r;
  return Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl));
}

// Select one plausible leg; `previous` [origin, destination] only breaks ties.
function commercialRoute(payload,a,previous=null){
  if(!payload||typeof payload!=='object'||ident(payload.callsign)!==ident(a.callsign))return null;
  const airports=payload._airports;
  if(!Array.isArray(airports)||airports.length<2||airports.length>12)return null;
  if(airports.some(p=>!p||typeof p!=='object'||!position(p.lat,p.lon)))return null;
  const [lat,lon]=[a.latitude,a.longitude],heading=a.heading,climb=a.vertical_rate;
  const hasTrack=finite(heading,0,360)&&finite(a.speed_kt,120),hasClimb=finite(climb);
  const code=p=>ident(p.iata)||ident(p.icao);
  const legs=new Map();
  for(let i=0;i+1<airports.length;i++){
    const start=airports[i],end=airports[i+1],origin=code(start),destination=code(end);
    if(!origin||!destination||origin===destination)continue;
    const direct=haversine(start.lat,start.lon,end.lat,end.lon);
    const fromOrigin=haversine(lat,lon,start.lat,start.lon),toDestination=haversine(lat,lon,end.lat,end.lon);
    const detour=fromOrigin+toDestination-direct;
    if(detour>Math.max(DETOUR_MILES,DETOUR_SHARE*direct))continue;
    const departing=fromOrigin<=40&&40<toDestination,arriving=toDestination<=40&&40<fromOrigin;
    // Near one end of a leg, an arrival does not climb away and a departure does not descend;
    // neither cruises at airliner altitude within 25 mi of that airport.
    if(hasClimb&&((arriving&&climb>=1000)||(departing&&climb<=-1000)))continue;
    if(finite(a.altitude_ft,25000)&&Math.min(fromOrigin,toDestination)<=25)continue;
    // Track is useful en route, but turns near an airport must not decide
    // which half of a same-callsign round trip is in progress.
    let error=null;
    if(hasTrack&&Math.min(fromOrigin,toDestination)>25){
      const toward=((bearing(lat,lon,end.lat,end.lon)*180/Math.PI)%360+360)%360;
      error=Math.abs(((heading-toward+180)%360+360)%360-180);
      // Far from both ends a real leg points close to where the plane is heading.
      if(error>(Math.min(fromOrigin,toDestination)>100?45:100))continue;
    }
    legs.set(`${origin}>${destination}`,{origin,destination,detour,track_error:error,departing,arriving,start,end});
  }
  const candidates=[...legs.values()].sort((x,y)=>x.detour-y.detour);
  if(!candidates.length)return null;
  const nearby=candidates.filter(leg=>leg.detour-candidates[0].detour<30);
  let selected=nearby.length===1?nearby[0]:null;
  // Ties: en-route track, then a clear climb or descent near the shared airport,
  // then the leg already chosen for this flight. Otherwise the route stays blank.
  for(const chosen of [leg=>leg.track_error!==null&&leg.track_error<=60,
    leg=>hasClimb&&((climb<=-500&&leg.arriving)||(climb>=500&&leg.departing)),
    leg=>!!previous&&leg.origin===previous[0]&&leg.destination===previous[1]]){
    const matched=selected?[]:nearby.filter(chosen);
    if(matched.length===1)selected=matched[0];
  }
  if(!selected)return null;
  // Names and positions for the display (progress, city names); not used for matching.
  const place=(p,code)=>({code,name:typeof p.name==='string'?p.name.slice(0,80):'',
    city:typeof p.location==='string'?p.location.slice(0,40):'',lat:p.lat,lon:p.lon});
  return {origin:selected.origin,destination:selected.destination,flight:ident(a.callsign),
    source:'ADSB.lol',valid_from:a.observed-120,valid_until:a.observed+120,
    from:place(selected.start,selected.origin),to:place(selected.end,selected.destination)};
}

// Keep only what route selection reads; standing-data payloads carry airport names etc.
const slim=p=>({callsign:p.callsign,_airports:Array.isArray(p._airports)?p._airports.slice(0,12).map(x=>
  ({iata:x?.iata,icao:x?.icao,name:x?.name,location:x?.location,lat:x?.lat,lon:x?.lon})):[]});

// The integration's SQLite cache, as an expiring key/value map in localStorage.
class Ledger {
  constructor(saved=null){
    this.rows=new Map(Object.entries(saved&&typeof saved==='object'?saved:{}));this.dirty=false;
  }
  get(k,now){const row=this.rows.get(k);return row&&row.expires>now?row.value:undefined;}
  put(k,value,expires,now){
    this.rows.set(k,{expires,value});this.dirty=true;
    for(const [key,row] of this.rows)if(!row||!(row.expires>now))this.rows.delete(key);
  }
  delete(k){if(this.rows.delete(k))this.dirty=true;}
  routes(now){
    return [...this.rows].filter(([k,row])=>(k.startsWith('route:')||k.startsWith('past-route:'))&&row.expires>now)
      .sort((a,b)=>b[1].expires-a[1].expires).slice(0,100).map(([,row])=>row.value);
  }
  toJSON(){return Object.fromEntries(this.rows);}
}

class Enricher {
  constructor(ledger,request){this.ledger=ledger;this.request=request;this.status='idle';}
  publish(a,route,now){
    if(route){
      const entry={...route,hex:a.hex,callsign:ident(a.callsign),registration:ident(a.registration),expires:now+SIX_HOURS};
      this.ledger.put('route:'+key(a),entry,now+SIX_HOURS,now);
      // Preserve the route at the in-boundary sighting, independently of
      // later live positions, route rejection, and app restarts.
      if(a.inside&&(a.live||a.recovered))this.ledger.put('past-route:'+key(a),{...entry,historical:true},now+SIX_HOURS,now);
    }else if(a.live)this.ledger.delete('route:'+key(a));
  }
  previous(a,now){
    const route=this.ledger.get('route:'+key(a),now);
    return route&&route.valid_until>=a.observed-600?[route.origin,route.destination]:null;
  }
  async tick(aircraft,now){
    const L=this.ledger,free=[];
    for(const a of aircraft){
      if(provider(a)!=='adsblol')continue;
      if(a.live){
        if(a.inside)L.put('sighting:'+key(a),Object.fromEntries(SIGHTING.map(k=>[k,finite(a[k])?a[k]:null])),now+SIX_HOURS,now);
        free.push(a);
      }else if(now-a.observed<=1800&&!L.get('past-route:'+key(a),now)){
        // A lookup can miss the minute a plane spends inside the boundary;
        // retry from the last in-boundary position.
        const seen=L.get('sighting:'+key(a),now);
        if(seen&&Math.abs(seen.observed-a.observed)<=60)free.push({...a,...seen,recovered:true});
      }
    }
    const missing=[];
    for(const a of free){
      const cached=L.get('lol:'+ident(a.callsign),now);
      if(cached===undefined)missing.push(a);
      else if(cached._airports)this.publish(a,commercialRoute(cached,a,this.previous(a,now)),now);
    }
    // At most one ADSB.lol request every 5 seconds; hits cached 1 h, misses 30 min.
    if(missing.length&&!L.get('cooldown:adsblol',now)){
      L.put('cooldown:adsblol',true,now+5,now);
      const a=missing[0],call=ident(a.callsign);
      const {status,payload}=await this.request(ROUTE_URL(call));
      this.status=String(status);
      if((status===200&&payload&&typeof payload==='object')||status===404){
        const data=payload&&typeof payload==='object'&&payload.callsign===call?slim(payload):{};
        L.put('lol:'+call,data,now+(data._airports?HOUR:1800),now);
        this.publish(a,commercialRoute(data,a,this.previous(a,now)),now);
      }else L.put('cooldown:adsblol',true,now+(status===429?900:60),now);
    }
    return L.routes(now);
  }
}

// --- The live source the display subscribes to.
// config: CONFIG plus the saved place {latitude, longitude} and radiusMiles.
function startLive(onUpdate,config){
  const home={latitude:config.latitude,longitude:config.longitude};
  const radius=Math.max(1,Math.min(10,Number(config.radiusMiles)||3));
  const ledger=new Ledger(store.get(LEDGER_KEY)),enricher=new Enricher(ledger,url=>getJson(url,8000));
  let history=store.get(HISTORY_KEY)||[],routes=ledger.routes(Date.now()/1000),enriching=false,timer=null,stopped=false;
  // Recently above: in Window view only planes that passed through the window (or overhead).
  const zone=config.zone?.kind==='window'?config.zone:radius;
  let states=build(null,0,selection([],0,home,zone,0));
  function build(ac,stamp,sel){
    const current=sel.current||{};
    return {
      [IDS.home]:{state:'zoning',attributes:{...home}},
      [IDS.radius]:{state:String(radius)},
      [IDS.feed]:{state:String(stamp),attributes:{ac:Array.isArray(ac)?ac:[]}},
      [IDS.current]:{state:sel.current?.hex||'none',attributes:{aircraft:current,latitude:current.latitude??null,
        longitude:current.longitude??null,feed_fresh:sel.feed_fresh}},
      [IDS.candidate]:{state:sel.candidate?.hex||'none',attributes:{aircraft:sel.candidate||{},feed_fresh:sel.feed_fresh,history}},
      [IDS.routes]:{state:String(routes.length),attributes:{routes}},
    };
  }
  async function enrich(ac,stamp,now){
    if(enriching)return;
    enriching=true;
    try{
      routes=await enricher.tick(observations(ac,stamp,home,radius,history,now),now);
      states={...states,[IDS.routes]:{state:String(routes.length),attributes:{routes}}};
      if(ledger.dirty){ledger.dirty=false;store.set(LEDGER_KEY,ledger);}
      onUpdate(states,true);
    }catch{/* Routes stay as they were; retried next poll. */}
    finally{enriching=false;}
  }
  async function poll(){
    if(stopped)return;
    const started=Date.now();
    const {status,payload}=await getJson(FEED_URL(home.latitude,home.longitude,config.searchNm),4000);
    if(stopped)return;
    if(status===200&&payload&&typeof payload==='object'){
      const now=Date.now()/1000,stamp=feedStamp(payload),ac=Array.isArray(payload.ac)?payload.ac:[];
      const sel=selection(ac,stamp,home,zone,now);
      if(sel.inside.length){history=mergeHistory(history,sel.inside);store.set(HISTORY_KEY,history);}
      states=build(ac,stamp,sel);
      onUpdate(states,true);
      enrich(ac,stamp,now);
    }else onUpdate(states,false);
    timer=setTimeout(poll,Math.max(1000,config.pollSeconds*1000-(Date.now()-started)));
  }
  onUpdate(states,false);
  poll();
  return {stop(){stopped=true;clearTimeout(timer);}};
}

return {HISTORY_KEY,MAX_NM,FEED_URL,ROUTE_URL,getJson,getBytes,store,haversine,feedStamp,selection,mergeHistory,ident,provider,observations,commercialRoute,Ledger,Enricher,startLive};
})();
// ---- models.mjs
__modules["models.mjs"]=(()=>{

// Bundled model photos (assets/models/<ICAO>.jpg, from Wikimedia Commons; credits in
// THIRD_PARTY_NOTICES.md and on screen with each photo): a typical aircraft of the type,
// shown when there is no Planespotters photo of the aircraft itself. Generated from the
// curated list (author, license per file; CC0, public domain or CC BY only, resized).
const MODELS={
  "A319":{model:"Airbus A319",author:"Julian Herzog",license:"CC BY 4.0"},
  "A320":{model:"Airbus A320",author:"Julian Herzog",license:"CC BY 4.0"},
  "A321":{model:"Airbus A321",author:"Adrian Pingstone",license:"Public domain"},
  "A21N":{model:"Airbus A321neo",author:"4300streetcar",license:"CC BY 4.0"},
  "A20N":{model:"Airbus A320neo",author:"Flywithnoe",license:"CC BY 4.0"},
  "A332":{model:"Airbus A330-200",author:"Adrian Pingstone",license:"Public domain"},
  "A333":{model:"Airbus A330-300",author:"4300streetcar",license:"CC BY 4.0"},
  "A339":{model:"Airbus A330-900",author:"4300streetcar",license:"CC BY 4.0"},
  "A359":{model:"Airbus A350-900",author:"Julian Herzog",license:"CC BY 4.0"},
  "A35K":{model:"Airbus A350-1000",author:"Clemens Vasters",license:"CC BY 2.0"},
  "A388":{model:"Airbus A380",author:"Julian Herzog",license:"CC BY 4.0"},
  "A306":{model:"Airbus A300-600F",author:"self made",license:"CC BY 3.0"},
  "B712":{model:"Boeing 717",author:"Alf van Beem",license:"CC0"},
  "B737":{model:"Boeing 737-700",author:"4300streetcar",license:"CC BY 4.0"},
  "B738":{model:"Boeing 737-800",author:"Alf van Beem",license:"Public domain"},
  "B739":{model:"Boeing 737-900",author:"AlfvanBeem",license:"CC0"},
  "B38M":{model:"Boeing 737 MAX 8",author:"DavidivardiIL",license:"CC BY 4.0"},
  "B39M":{model:"Boeing 737 MAX 9",author:"4300streetcar",license:"CC BY 4.0"},
  "B752":{model:"Boeing 757-200",author:"4300streetcar",license:"CC BY 4.0"},
  "B753":{model:"Boeing 757-300",author:"Mark Harkin",license:"CC BY 2.0"},
  "B763":{model:"Boeing 767-300",author:"Oleg Yunakov",license:"CC0"},
  "B764":{model:"Boeing 767-400",author:"Mark Harkin",license:"CC BY 2.0"},
  "B772":{model:"Boeing 777-200",author:"Aaron Davis",license:"CC BY 4.0"},
  "B77W":{model:"Boeing 777-300ER",author:"tjdarmstadt",license:"CC BY 2.0"},
  "B77L":{model:"Boeing 777F",author:"Steve Knight",license:"CC BY 4.0"},
  "B788":{model:"Boeing 787-8",author:"Julian Herzog",license:"CC BY 4.0"},
  "B789":{model:"Boeing 787-9",author:"Masahiro TAKAGI",license:"CC BY 2.0"},
  "B78X":{model:"Boeing 787-10",author:"jounigripen",license:"CC BY 2.0"},
  "B744":{model:"Boeing 747-400",author:"Julian Herzog",license:"CC BY 4.0"},
  "B748":{model:"Boeing 747-8F",author:"4300streetcar",license:"CC BY 4.0"},
  "MD11":{model:"McDonnell Douglas MD-11F",author:"Kambui",license:"CC BY 2.0"},
  "DC10":{model:"McDonnell Douglas DC-10",author:"spaceaero2",license:"CC BY 3.0"},
  "CRJ2":{model:"Bombardier CRJ200",author:"lasta29",license:"CC BY 2.0"},
  "CRJ7":{model:"Bombardier CRJ700",author:"Colin Brown",license:"CC BY 2.0"},
  "CRJ9":{model:"Bombardier CRJ900",author:"Reinhard Zinabold",license:"CC BY 2.0"},
  "E135":{model:"Embraer ERJ 135",author:"Nuiteux731",license:"CC0"},
  "E145":{model:"Embraer ERJ 145",author:"Tisch1234",license:"CC0"},
  "E170":{model:"Embraer 170",author:"4300streetcar",license:"CC BY 4.0"},
  "E75L":{model:"Embraer 175",author:"Alexis Doine",license:"CC0"},
  "E75S":{model:"Embraer 175",author:"Alexis Doine",license:"CC0"},
  "E190":{model:"Embraer 190",author:"Wilfredor",license:"CC0"},
  "E195":{model:"Embraer 195",author:"Dbx54",license:"Public domain"},
  "BCS1":{model:"Airbus A220-100",author:"4300streetcar",license:"CC BY 4.0"},
  "BCS3":{model:"Airbus A220-300",author:"4300streetcar",license:"CC BY 4.0"},
  "DH8D":{model:"Dash 8 Q400",author:"Alf van Beem",license:"Public domain"},
  "AT72":{model:"ATR 72",author:"Md Shaifuzzaman Ayon",license:"CC BY 4.0"},
  "AT76":{model:"ATR 72-600",author:"Md Shaifuzzaman Ayon",license:"CC BY 4.0"},
  "SF34":{model:"Saab 340",author:"lasta29",license:"CC BY 2.0"},
  "B190":{model:"Beechcraft 1900",author:"Flox Papa",license:"CC BY 2.0"},
  "BE20":{model:"Beechcraft King Air 200",author:"Armada Argentina",license:"CC BY 4.0"},
  "BE9L":{model:"Beechcraft King Air 90",author:"Beech Aircraft Corporation",license:"CC0"},
  "PC12":{model:"Pilatus PC-12",author:"Robbie Klinkenberg",license:"CC BY 4.0"},
  "C208":{model:"Cessna 208 Caravan",author:"Robbie Klinkenberg",license:"CC BY 4.0"},
  "C172":{model:"Cessna 172",author:"TRTPUWU",license:"CC BY 4.0"},
  "C182":{model:"Cessna 182",author:"Sudan Envoy",license:"CC BY 2.0"},
  "PA28":{model:"Piper PA-28 Cherokee",author:"Adrian Pingstone",license:"Public domain"},
  "SR22":{model:"Cirrus SR22",author:"unknown",license:"Public domain"},
  "DA40":{model:"Diamond DA40",author:"Weißnichtmiristlangweilig",license:"CC BY 4.0"},
  "C25A":{model:"Cessna Citation CJ2",author:"Kambui",license:"CC BY 2.0"},
  "C25B":{model:"Cessna Citation CJ3",author:"simon butler",license:"CC BY 2.0"},
  "C56X":{model:"Cessna Citation Excel",author:"Julian Herzog",license:"CC BY 4.0"},
  "C68A":{model:"Cessna Citation Latitude",author:"kitmasterbloke",license:"CC BY 4.0"},
  "C700":{model:"Cessna Citation Longitude",author:"Sewageboy",license:"CC BY 4.0"},
  "CL30":{model:"Bombardier Challenger 300",author:"Arpingstone",license:"Public domain"},
  "CL35":{model:"Bombardier Challenger 350",author:"kitmasterbloke",license:"CC BY 4.0"},
  "CL60":{model:"Bombardier Challenger 604",author:"kitmasterbloke",license:"CC BY 2.0"},
  "GLF4":{model:"Gulfstream IV",author:"Planephotoman",license:"CC BY 2.0"},
  "GLF5":{model:"Gulfstream V",author:"Coldstreamer20",license:"CC BY 4.0"},
  "GLF6":{model:"Gulfstream G650",author:"Myself .",license:"Public domain"},
  "GLEX":{model:"Bombardier Global Express",author:"Ronnie Macdonald",license:"CC BY 2.0"},
  "E55P":{model:"Embraer Phenom 300",author:"Ronnie Macdonald",license:"CC BY 2.0"},
  "E545":{model:"Embraer Legacy 450",author:"DUNCAN KIRK",license:"CC BY 4.0"},
  "LJ45":{model:"Learjet 45",author:"Coldstreamer20",license:"CC BY 4.0"},
  "H25B":{model:"Hawker 800",author:"Marek Ślusarczyk",license:"CC BY 3.0"},
  "FA7X":{model:"Dassault Falcon 7X",author:"Dmitry A. Mottl",license:"Public domain"},
  "PC24":{model:"Pilatus PC-24",author:"Steve Knight",license:"CC BY 2.0"},
  "EC35":{model:"Eurocopter EC135",author:"Julian Herzog",license:"CC BY 4.0"},
  "EC45":{model:"Eurocopter EC145",author:"Steve Lynes",license:"CC BY 2.0"},
  "EC30":{model:"Eurocopter EC130",author:"Tony Hisgett",license:"CC BY 2.0"},
  "AS50":{model:"Eurocopter AS350",author:"Mark Wagner",license:"CC BY 2.5"},
  "B06":{model:"Bell 206",author:"Matthew Field",license:"CC BY 2.5"},
  "B407":{model:"Bell 407",author:"stuart.mike",license:"CC BY 2.0"},
  "B429":{model:"Bell 429",author:"Bspor.88",license:"CC0"},
  "R44":{model:"Robinson R44",author:"Ministerstwo Spraw Wewnętrznych i Administracji",license:"CC BY 3.0 pl"},
  "S76":{model:"Sikorsky S-76",author:"San Diego Air & Space Museum Archives",license:"Public domain"},
  "UH60":{model:"Sikorsky UH-60 Black Hawk",author:"Wolfram M. Stumpf, U.S. Air Force",license:"Public domain"},
  "C130":{model:"Lockheed C-130 Hercules",author:"Balon Greyjoy",license:"CC0"},
  "C30J":{model:"Lockheed C-130J Super Hercules",author:"Balon Greyjoy",license:"CC0"},
  "C17":{model:"Boeing C-17 Globemaster III",author:"U.S. Air Force",license:"Public domain"},
  "K35R":{model:"Boeing KC-135 Stratotanker",author:"Staff Sgt. Randy Mallard, U.S. Air Force",license:"Public domain"},
  "KC46":{model:"Boeing KC-46 Pegasus",author:"Airman 1st Class Cody Dowell",license:"Public domain"},
  "A124":{model:"Antonov An-124",author:"Dtom",license:"CC BY 3.0"},
  "B52":{model:"Boeing B-52 Stratofortress",author:"Senior Airman Keifer Bowes",license:"Public domain"},
  "E3TF":{model:"Boeing E-3 Sentry",author:"Qwexcxewq",license:"CC BY 4.0"},
  "P8":{model:"Boeing P-8 Poseidon",author:"Balon Greyjoy",license:"CC0"}
};
const modelPhoto=a=>{const t=String(a?.aircraft_type||'').toUpperCase(),m=MODELS[t];return m?{...m,src:`models/${t}.jpg`}:null;};

return {MODELS,modelPhoto};
})();
// ---- photos.mjs
__modules["photos.mjs"]=(()=>{
const {getJson}=__modules["live.mjs"];
const {modelPhoto}=__modules["models.mjs"];
// Aircraft pictures for the hero card, best first:
// 1. a photo of that exact aircraft from Planespotters.net (by hex, else registration),
// 2. a bundled photo of the model (assets/models/, from Wikimedia Commons, models.mjs),
// 3. the drawn silhouette (silhouettes.mjs).
// Planespotters' API terms: credit the photographer next to the photo; link back with an
// on-screen QR code carrying the photo's link URL (no clickable surface on a TV); fetch the
// image straight from their URL on this device, keep it only while shown, never store it;
// URLs used unchanged; JSON may be cached up to 24 h; identify with a User-Agent (the app
// bridge sends one). Lookups are cached per aircraft for this session, misses too.



const PHOTO_URL=(kind,id)=>`https://api.planespotters.net/pub/photos/${kind}/${id}`;
const IMG=/^https:\/\/(cdn\.planespotters\.net|[a-z0-9-]+\.plnspttrs\.net)\/[^\s"'<>]+\.(jpe?g|png|webp)$/i;
const LINK=/^https:\/\/www\.planespotters\.net\/photo\/[^\s"'<>]+$/;
const cache=new Map(),DAY=86400000;

// A photo record {src,width,height,link,photographer} from an API reply, or null.
function parsePhoto(payload){
  const p=Array.isArray(payload?.photos)?payload.photos[0]:null;
  const t=p?.thumbnail_large?.src?p.thumbnail_large:p?.thumbnail;
  if(!t||!IMG.test(String(t.src))||!LINK.test(String(p.link)))return null;
  const photographer=String(p.photographer||'').trim().slice(0,60);
  return {src:t.src,width:Number(t.size?.width)||0,height:Number(t.size?.height)||0,link:p.link,photographer};
}

// Resolves the photo for an aircraft, or null (none, failure, or slower than 3 s).
function photoFor(a){
  const hex=String(a?.hex||'').toLowerCase();
  if(!/^[0-9a-f]{6}$/.test(hex))return Promise.resolve(null);
  const hit=cache.get(hex);
  if(hit&&Date.now()-hit.at<DAY)return hit.promise;
  const reg=String(a.registration||'').toUpperCase().replace(/[^A-Z0-9-]/g,'');
  const promise=(async()=>{
    let {status,payload}=await getJson(PHOTO_URL('hex',hex),3000);
    let photo=status===200?parsePhoto(payload):null;
    if(!photo&&status===200&&reg.length>=2){({status,payload}=await getJson(PHOTO_URL('reg',reg),3000));photo=status===200?parsePhoto(payload):null;}
    return photo;
  })().catch(()=>null);
  cache.set(hex,{at:Date.now(),promise});
  if(cache.size>300)cache.delete(cache.keys().next().value);
  return promise;
}

// QR code (data: GIF) for a photo's link, drawn by the bundled encoder (qr.js).
function qrFor(link){
  const QR=globalThis.window?.WhatsUpQR;if(!QR)return '';
  try{const q=QR(0,'M');q.addData(link);q.make();return q.createDataURL(4,2);}catch{return '';}
}

return {PHOTO_URL,parsePhoto,photoFor,qrFor,modelPhoto};
})();
// ---- place.mjs
__modules["place.mjs"]=(()=>{
const {getJson,store}=__modules["live.mjs"];
const {number}=__modules["core.mjs"];
const {CONFIG}=__modules["config.js"];
// Where the user is and how they like it shown. Saved on the device (localStorage).
// First launch: approximate location from the connection's IP (GeoJS, free, no key).
// "Change location": a ZIP/postcode or city name (Open-Meteo geocoding), or a street
// address (US Census geocoder for US addresses, else Nominatim). Exact coordinates stay
// on the device; the time-zone lookup and adsb.fi only see them rounded to 2 decimals.



const KEY='whatsup.settings.v1';
const IP_URL='https://get.geojs.io/v1/ip/geo.json';
const SEARCH_URL=q=>`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
const CENSUS_URL=q=>`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
const NOMINATIM_URL=q=>`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1`;
const TZ_URL=(lat,lon)=>`https://api.open-meteo.com/v1/forecast?latitude=${Number(lat).toFixed(2)}&longitude=${Number(lon).toFixed(2)}&timezone=auto&forecast_days=1`;

const US={Alabama:'AL',Alaska:'AK',Arizona:'AZ',Arkansas:'AR',California:'CA',Colorado:'CO',Connecticut:'CT',Delaware:'DE',
  'District of Columbia':'DC','Washington, D.C.':'DC',Florida:'FL',Georgia:'GA',Hawaii:'HI',Idaho:'ID',Illinois:'IL',Indiana:'IN',Iowa:'IA',
  Kansas:'KS',Kentucky:'KY',Louisiana:'LA',Maine:'ME',Maryland:'MD',Massachusetts:'MA',Michigan:'MI',Minnesota:'MN',
  Mississippi:'MS',Missouri:'MO',Montana:'MT',Nebraska:'NE',Nevada:'NV','New Hampshire':'NH','New Jersey':'NJ',
  'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND',Ohio:'OH',Oklahoma:'OK',Oregon:'OR',
  Pennsylvania:'PA','Rhode Island':'RI','South Carolina':'SC','South Dakota':'SD',Tennessee:'TN',Texas:'TX',Utah:'UT',
  Vermont:'VT',Virginia:'VA',Washington:'WA','West Virginia':'WV',Wisconsin:'WI',Wyoming:'WY','Puerto Rico':'PR'};
const CA={Alberta:'AB','British Columbia':'BC',Manitoba:'MB','New Brunswick':'NB','Newfoundland and Labrador':'NL',
  'Nova Scotia':'NS',Ontario:'ON','Prince Edward Island':'PE',Quebec:'QC',Saskatchewan:'SK',
  'Northwest Territories':'NT',Nunavut:'NU',Yukon:'YT'};
const SHORT_COUNTRY={GB:'UK',US:'USA',AE:'UAE'};
const STATE_NAME=Object.fromEntries(Object.entries(US).map(([name,code])=>[code,name]));
const clean=(v,n=60)=>typeof v==='string'?v.trim().slice(0,n):'';

// "Cincinnati, OH", "Toronto, ON", "London, UK", "Lyon, France".
function placeLabel(p){
  if(!p)return '';
  const cc=clean(p.countryCode,2).toUpperCase(),admin=clean(p.admin);
  const region=cc==='US'?US[admin]:cc==='CA'?CA[admin]:'';
  const country=SHORT_COUNTRY[cc]||(clean(p.country).length<=12?clean(p.country):cc);
  return [clean(p.name),region||country].filter(Boolean).join(', ');
}
const validTz=tz=>{try{new Intl.DateTimeFormat('en-US',{timeZone:tz});return true;}catch{return false;}};
function makePlace(o){
  const latitude=Number(o.latitude),longitude=Number(o.longitude);
  if(!number(latitude)||!number(longitude)||Math.abs(latitude)>85||Math.abs(longitude)>180)return null;
  const timeZone=validTz(o.timeZone)?o.timeZone:'UTC';
  return {name:clean(o.name)||'Unknown place',admin:clean(o.admin),country:clean(o.country),
    countryCode:clean(o.countryCode,2).toUpperCase(),latitude,longitude,timeZone,source:o.source,
    elevationM:number(Number(o.elevationM))?Number(o.elevationM):0,street:clean(o.street,80),
    accuracyKm:number(Number(o.accuracyKm))?Number(o.accuracyKm):null};
}

// Window view reach (Settings > Window distance) and whole-degree bearings.
const VIEW_MILES=[5,10,15,20,25,30,40,50,60,75,100];
const deg=(v,d)=>Number.isFinite(Number(v))?((Math.round(Number(v))%360)+360)%360:d;
// Map radius steps (Settings > Map radius, and Up/Down on the dashboard).
const MAP_RADII=[2,5,10,15,25,50,100,150,250];
// The alert ring sits inside the map: never wider than the map radius.
const alertFor=(radius,mapMiles)=>Math.max(1,Math.min(radius,mapMiles));
function loadSettings(){
  const s=store.get(KEY)||{};
  const mapMiles=MAP_RADII.includes(Number(s.mapMiles))?Number(s.mapMiles):CONFIG.rangeMiles;
  return {place:s.place?makePlace(s.place):null,mapMiles,
    radiusMiles:Math.max(1,Math.min(10,Math.round(Number(s.radiusMiles))||CONFIG.radiusMiles)),
    distance:s.distance==='km'?'km':'mi',altitude:s.altitude==='m'?'m':'ft',confirmed:!!s.confirmed,
    keepAwake:s.keepAwake!==false, // Settings > Keep screen awake (on unless turned off)
    chime:['off','low','med','high'].includes(s.chime)?s.chime:'med', // Settings > Chime (a plane enters your zone)
    // Alert zone: 'circle' (all around, Alert radius) or 'window' (bearings from -> to, out to viewMiles).
    alertZone:s.alertZone==='window'?'window':'circle',
    viewFrom:deg(s.viewFrom,90),viewTo:deg(s.viewTo,180),
    viewMiles:VIEW_MILES.includes(Number(s.viewMiles))?Number(s.viewMiles):25,
    layout:typeof s.layout==='string'&&/^[a-z-]{2,20}$/.test(s.layout)?s.layout:'radar'};
}
const saveSettings=s=>store.set(KEY,s);

// Approximate place from the IP address. Null when the lookup fails.
async function locateByIp(){
  const {status,payload:p}=await getJson(IP_URL,6000);
  if(status!==200||!p)return null;
  return makePlace({name:p.city,admin:p.region,country:p.country,countryCode:p.country_code,
    latitude:p.latitude,longitude:p.longitude,timeZone:p.timezone,source:'ip',accuracyKm:p.accuracy});
}

// ZIP/postcode or place name -> up to 6 places, biggest first.
async function searchPlaces(query){
  const q=clean(query,60);
  if(q.length<2)return [];
  const {status,payload}=await getJson(SEARCH_URL(q),6000);
  if(status!==200||!Array.isArray(payload?.results))return status===200?[]:null;
  return payload.results.map(r=>makePlace({name:r.name,admin:r.admin1,country:r.country,countryCode:r.country_code,
    latitude:r.latitude,longitude:r.longitude,timeZone:r.timezone,elevationM:r.elevation,source:'search'})).filter(Boolean);
}

// "123 Main St ..." or "10 Downing Street": a house number, then words.
const looksLikeAddress=q=>/^\d+[A-Z]?\s+[A-Z]/i.test(clean(q))&&!/^\d{5}(-\d{4})?$/.test(clean(q));
const title=s=>s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase());

// Time zone and elevation for a geocoded address (rounded coordinates only).
async function addZone(p){
  const {status,payload}=await getJson(TZ_URL(p.latitude,p.longitude),6000);
  return makePlace({...p,timeZone:status===200?payload?.timezone:p.timeZone,elevationM:payload?.elevation});
}

// Street address -> matches. US Census first (US addresses; skipped when home is
// clearly elsewhere), then Nominatim: one request per search, never as you type.
async function searchAddress(query,{skipCensus=false}={}){
  const q=clean(query,120);
  let failed=false;
  if(!skipCensus){
    const {status,payload}=await getJson(CENSUS_URL(q),10000);
    const matches=status===200&&Array.isArray(payload?.result?.addressMatches)?payload.result.addressMatches:[];
    if(status!==200)failed=true;
    const found=[];
    for(const m of matches.slice(0,4)){
      const a=m.addressComponents||{},full=clean(m.matchedAddress,120);
      const street=title(full.split(',')[0]||'');
      const p=await addZone({name:title(a.city||''),admin:STATE_NAME[a.state]||a.state,country:'United States',countryCode:'US',
        latitude:m.coordinates?.y,longitude:m.coordinates?.x,timeZone:'America/New_York',street,source:'census',accuracyKm:.05});
      if(p)found.push(p);
    }
    if(found.length)return found;
  }
  const {status,payload}=await getJson(NOMINATIM_URL(q),10000);
  if(status!==200||!Array.isArray(payload))return failed||status!==200?null:[];
  const found=[];
  for(const r of payload.slice(0,4)){
    const a=r.address||{};
    const street=[a.house_number,a.road].filter(Boolean).join(' ')||clean(r.name);
    const p=await addZone({name:a.city||a.town||a.village||a.suburb||a.county||clean(r.name),admin:a.state,country:a.country,
      countryCode:a.country_code,latitude:r.lat,longitude:r.lon,timeZone:'UTC',street,source:'nominatim',accuracyKm:.1});
    if(p)found.push(p);
  }
  return found;
}

return {IP_URL,SEARCH_URL,CENSUS_URL,NOMINATIM_URL,TZ_URL,placeLabel,VIEW_MILES,MAP_RADII,alertFor,loadSettings,saveSettings,locateByIp,searchPlaces,looksLikeAddress,searchAddress};
})();
// ---- mapgen.mjs
__modules["mapgen.mjs"]=(()=>{
const {getJson,getBytes,store}=__modules["live.mjs"];
// Maps, built on the device for wherever home is. OpenMapTiles vector tiles from
// OpenFreeMap (free, no key; attribution required) are decoded with
// @mapbox/vector-tile + pbf (web/mvt.js) into plain arrays in miles east/north of
// home, and saved, so tiles are fetched once per location.
// * base (z10, the 10-mile scope): water, rivers, motorways/trunk roads, runways,
//   airport labels, motorway shields and town names. Every layout uses it.
// * detail (z12 over ~6.5 mi, plus z14 buildings within ~1.3 mi): every road class,
//   rail, waterways, landuse, parks, aeroways and place names. Built only when a
//   layout asks for it (Atlas, Glass, Blueprint, ...).

const MAP_ATTRIBUTION='© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
const TILEJSON='https://tiles.openfreemap.org/planet';
const TILE_URL=/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
const KEY='whatsup.map.v2',VERSION=3,MAX_AGE=30*86400000; // v3: airfields
const DETAIL_KEY='whatsup.detail.v1',DETAIL_VERSION=1;
// z10: one tile is ~19 mi wide at 40° latitude, so a 10-mile scope needs 4-9 tiles,
// and z10 already carries runways and IATA-coded airport labels. Wider map radii use
// lower zooms (fewer, coarser tiles: 2-9 at any radius); OpenMapTiles drops minor
// features at low zooms by itself.
const ZOOM=10;
const zoomFor=range=>range<=15?10:range<=25?9:range<=50?8:range<=100?7:6;
// Small airfields are only in z10 tiles (lower zooms carry international airports only),
// so maps up to this radius read their labels from z10 tiles too (one extra pass).
const AIRFIELD_MAX_RANGE=50;
// The street-detail map is drawn up to a 15-mile map radius; wider views draw the base map.
const DETAIL_MAX_RANGE=15;
const STREETS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service']),MAJOR=new Set(['motorway','trunk','primary','secondary']);
const DETAIL_ROADS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service','rail']);
const LANDUSE=new Set(['residential','commercial','industrial','retail','cemetery','hospital','school','university','college',
  'stadium','railway','military','pitch','zoo','theme_park','playground']);
const PLACES=new Set(['city','town','village','suburb','neighbourhood','quarter']);

const DEG=Math.PI/180;
const tileX=(lon,z)=>(lon+180)/360*2**z;
const tileY=(lat,z)=>{const s=Math.sin(lat*DEG);return (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*2**z;};
const lonOf=(x,z)=>x/2**z*360-180;
const latOf=(y,z)=>Math.atan(Math.sinh(Math.PI-2*Math.PI*y/2**z))/DEG;

// Douglas-Peucker on [x,y] miles.
function simplify(pts,tol){
  if(pts.length<3)return pts;
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop(),[ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    let worst=0,at=-1;
    // A closed ring starts and ends on the same point: measure from that point.
    for(let i=a+1;i<b;i++){
      const d=len<1e-9?Math.hypot(pts[i][0]-ax,pts[i][1]-ay):Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/len;
      if(d>worst){worst=d;at=i;}
    }
    if(worst>tol){keep[at]=1;stack.push([a,at],[at,b]);}
  }
  return pts.filter((_,i)=>keep[i]);
}
const rounder=k=>pts=>pts.map(([x,y])=>[Math.round(x*k)/k,Math.round(y*k)/k]);
const round=rounder(100);

// Lines: keep the runs that come within the box (plus one point either side).
function clipLine(pts,lim){
  const runs=[];let run=null;
  const inside=([x,y])=>Math.abs(x)<=lim&&Math.abs(y)<=lim;
  for(let i=0;i<pts.length;i++){
    const near=inside(pts[i])||(i>0&&inside(pts[i-1]))||(i+1<pts.length&&inside(pts[i+1]));
    if(near){(run||(run=[])).push(pts[i]);}else if(run){runs.push(run);run=null;}
  }
  if(run)runs.push(run);
  return runs.filter(r=>r.length>1);
}
const touches=(pts,lim)=>{
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const [x,y] of pts){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  return x1>=-lim&&x0<=lim&&y1>=-lim&&y0<=lim;
};

async function tileTemplate(net){
  const {status,payload}=await net.getJson(TILEJSON,8000);
  const url=status===200&&Array.isArray(payload?.tiles)?payload.tiles[0]:'';
  if(!TILE_URL.test(url))throw new Error(`tilejson ${status}`);
  return url;
}

// Calls fn(tile, helpers) for each tile at `zoom` covering `lim` miles around home.
// Tiles are decoded one at a time so only one is in memory. Returns the number fetched.
async function eachTile(home,lim,zoom,template,net,MVT,fn){
  const cos=Math.cos(home.latitude*DEG);
  const toMiles=(lon,lat)=>[(lon-home.longitude)*69.172*cos,(lat-home.latitude)*69.0];
  const dLat=lim/69,dLon=lim/(69.172*cos);
  const x0=Math.floor(tileX(home.longitude-dLon,zoom)),x1=Math.floor(tileX(home.longitude+dLon,zoom));
  const y0=Math.floor(tileY(home.latitude+dLat,zoom)),y1=Math.floor(tileY(home.latitude-dLat,zoom));
  let fetched=0;
  for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++){
    const bytes=await net.getBytes(template.replace('{z}',zoom).replace('{x}',tx).replace('{y}',ty));
    if(!bytes)continue;
    fetched++;
    const tile=new MVT.VectorTile(new MVT.Pbf(bytes));
    const each=(name,f)=>{const layer=tile.layers[name];if(layer)for(let i=0;i<layer.length;i++)f(layer.feature(i),layer.extent);};
    const geom=(f,extent)=>f.loadGeometry().map(ring=>ring.map(p=>toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom))));
    const point=(f,extent)=>{const [[p]]=f.loadGeometry();return toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom));};
    fn({each,geom,point});
  }
  return fetched;
}
const nameOf=pr=>String(pr.name_en||pr['name:en']||pr.name_int||pr.name||'').slice(0,60);

// Build the map for home; `range` in miles. Throws when tiles can't be fetched.
// detail: a close-up street map (Adjust position) instead of the radar's major roads.
// `net` and `MVT` are replaceable for tests.
async function buildMap(home,range,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,zoom=zoomFor(range),detail=false}={}){
  if(!MVT)throw new Error('mvt.js missing');
  // Wide layouts (Glass) show ~1.5x the radius sideways; the 10-mile map keeps its original reach.
  const lim=range<=10?range+1.5:range*1.5,k=Math.max(1,range/10); // simplify/clip coarser as the view widens
  const template=await tileTemplate(net);
  const out={v:VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,built:Date.now(),
    water:[],rivers:[],roads:[],runways:[],airports:[],airfields:[],shields:[],places:[]};
  const shields=new Map(),places=new Map();
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point})=>{
    const lines=(f,extent,tol)=>geom(f,extent).flatMap(l=>clipLine(l,lim)).map(l=>round(simplify(l,tol)));
    each('water',(f,e)=>{
      if(f.type!==3)return;
      for(const ring of geom(f,e))if(ring.length>3&&touches(ring,lim)){const r=simplify(ring,.04*k);if(r.length>3)out.water.push(round(r));}
    });
    each('waterway',(f,e)=>{if(f.type===2&&f.properties.class==='river')out.rivers.push(...lines(f,e,.04*k));});
    each('transportation',(f,e)=>{
      const c=f.properties.class;
      const wanted=detail?STREETS.has(c):c==='motorway'||c==='trunk';
      if(f.type===2&&wanted&&!f.properties.ramp)
        for(const l of lines(f,e,detail?.005:.03*k))out.roads.push({c,major:detail?MAJOR.has(c):c==='motorway',p:l});
    });
    each('transportation_name',(f,e)=>{
      const ref=String(f.properties.ref||'').trim();
      if(f.type!==2||f.properties.class!=='motorway'||!ref||ref.length>8)return;
      for(const l of geom(f,e)){
        const mid=l[Math.floor(l.length/2)];
        const d=Math.hypot(...mid);
        if(d<range-1.5&&(!shields.has(ref)||shields.get(ref).d>d))shields.set(ref,{ref,x:mid[0],y:mid[1],d});
      }
    });
    each('aeroway',(f,e)=>{
      if(f.properties.class!=='runway')return;
      if(f.type===2)out.runways.push(...lines(f,e,.01));
      else if(f.type===3)for(const ring of geom(f,e))if(touches(ring,lim))out.runways.push(round(ring));
    });
    each('aerodrome_label',(f,e)=>{
      if(f.type!==1)return;
      const pr=f.properties,[x,y]=point(f,e);
      const code=String(pr.iata||pr.icao||'').toUpperCase();
      if(Math.hypot(x,y)>range*1.5+12)return;
      // Every airfield, coded or not (Atlas labels them all); `airports` stays the coded ones.
      const name=nameOf(pr);
      if(name&&out.airfields.length<200&&!out.airfields.some(a=>a.name===name))
        out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
          kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
      if(!code||Math.hypot(x,y)>range+12)return;
      if(out.airports.some(a=>a.code===code))return;
      out.airports.push({code,iata:String(pr.iata||''),icao:String(pr.icao||''),name:nameOf(pr),
        kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!['city','town','suburb'].includes(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
  });
  if(!fetched)throw new Error('no tiles');
  if(zoom<10&&range<=AIRFIELD_MAX_RANGE){
    const flim=range*.85; // Atlas, the layout that shows airfields, sees ~0.7x the radius sideways
    try{
      await eachTile(home,flim,10,template,net,MVT,({each,point})=>each('aerodrome_label',(f,e)=>{
        if(f.type!==1)return;
        const pr=f.properties,name=nameOf(pr),[x,y]=point(f,e);
        if(!name||Math.abs(x)>flim||Math.abs(y)>flim||out.airfields.length>=200||out.airfields.some(a=>a.name===name))return;
        out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
          kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
      }));
    }catch(e){/* the big airports from the map itself still show */}
  }
  out.shields=[...shields.values()].map(({ref,x,y})=>({ref,x:Math.round(x*100)/100,y:Math.round(y*100)/100}));
  const order={city:0,town:1,suburb:2};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,40);
  const rank={international:0,public:1,regional:1,military:2};
  out.airports.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  out.airfields.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||!a.code-!b.code||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  return out;
}

// Saved maps: one per map radius (each at its own tile zoom), the 3 most recently
// used kept. A saved map near this home (within ~1 km: drawing shifts it), younger
// than 30 days, else null. The 10-mile map keeps the original key, so maps saved
// before map radius existed still count.
const keyFor=range=>range===10?KEY:`${KEY}.r${range}`;
const RECENT_KEY='whatsup.map.recent';
function savedMap(home,range){
  const m=store.get(keyFor(range));
  const same=m&&m.v===VERSION&&m.range===range&&Math.abs(m.latitude-home.latitude)<.01&&
    Math.abs(m.longitude-home.longitude)<.01&&Date.now()-m.built<MAX_AGE;
  return same?m:null;
}
function saveMap(m){
  const recent=[m.range,...(store.get(RECENT_KEY)||[]).filter(r=>r!==m.range)];
  for(const r of recent.slice(3))store.remove(keyFor(r));
  store.set(RECENT_KEY,recent.slice(0,3));
  store.set(keyFor(m.range),m);
}

// --- Detail map. Coordinates in thousandths of a mile (~5 ft). Each line or ring is
// saved as a delta-encoded string ("x,y,dx,dy,...") and decoded into an Int16Array,
// so ~150k points cost ~0.8 MB saved and ~0.6 MB in memory instead of nested arrays.
// Buildings are capped (nearest first) to stay well under the localStorage quota.
const DETAIL_RANGE=6.5,BUILDING_RANGE=1.3;
// The detail map for a map radius: how far it reaches (Atlas shows ~0.7x the radius
// sideways), from which tile zoom, and whether it has buildings. Up to 15 mi it is the
// full street map (z12 + z14 buildings). Wider, it is a mid-detail map from the most
// detailed zoom that keeps it to ~16-36 tiles: roads by class as far as that zoom
// carries them, land use, parks and woods, water, streams, rail, towns and villages.
const DETAIL_SPECS=[[10,DETAIL_RANGE,12,BUILDING_RANGE],[15,10.5,12,BUILDING_RANGE],[25,18,11,0],[50,36,10,0],
  [100,72,9,0],[150,108,8,0],[250,180,8,0]];
function detailSpec(mapMiles){
  const [max,range,zoom,buildings]=DETAIL_SPECS.find(([max])=>mapMiles<=max)||DETAIL_SPECS[DETAIL_SPECS.length-1];
  return {range,zoom,buildings,key:max<=15?'street':`r${max}`};
}
// A built detail map serves a spec when it is the same kind, at least as far, same zoom.
const detailFits=(m,spec)=>!!m&&(m.key||'street')===spec.key&&m.range>=spec.range&&(m.zoom||12)===spec.zoom;
const MAX_BUILDING_POINTS=40000;
// Points per mile: 1000 (~5 ft) for street maps; wide maps use fewer so ±1.6x their reach
// still fits an Int16. Clamped: the extra point clipLine keeps past the edge can be far out.
const perMile=range=>Math.min(1000,Math.floor(20000/range));
const encoder=per=>{
  const int16=v=>Math.max(-32000,Math.min(32000,Math.round(v*per)));
  return pts=>{let px=0,py=0;return pts.map(([x,y])=>{const ix=int16(x),iy=int16(y),d=`${ix-px},${iy-py}`;px=ix;py=iy;return d;}).join(',');};
};
function decode(s){
  const v=s.split(','),out=new Int16Array(v.length);let x=0,y=0;
  for(let i=0;i<v.length;i+=2){x+=+v[i];y+=+v[i+1];out[i]=x;out[i+1]=y;}
  return out;
}
const DETAIL_LAYERS=['water','waterways','roads','landuse','parks','aero','buildings'];
// Saved form -> drawable form (p: line, r: ring, both Int16Array in 1/per mi; per defaults to 1000).
function decodeDetail(m){
  if(!m)return null;
  const out={...m,decoded:true};
  for(const k of DETAIL_LAYERS)out[k]=m[k].map(f=>f.p?{...f,p:decode(f.p)}:{...f,r:decode(f.r)});
  return out;
}
async function buildDetail(home,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,range=DETAIL_RANGE,buildings=BUILDING_RANGE,zoom=12,key='street'}={}){
  if(!MVT)throw new Error('mvt.js missing');
  const lim=range+.5,template=await tileTemplate(net),per=perMile(range),encode=encoder(per),k=Math.max(1,range/10.5);
  const out={v:DETAIL_VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,key,per,buildingRange:buildings,built:Date.now(),
    water:[],waterways:[],roads:[],landuse:[],parks:[],aero:[],buildings:[],places:[]};
  const places=new Map();
  const polys=(geom,f,e,tol,box=lim)=>geom(f,e).filter(r=>r.length>3&&touches(r,box)).map(r=>simplify(r,tol)).filter(r=>r.length>3).map(encode);
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point})=>{
    const lines=(f,e,tol)=>geom(f,e).flatMap(l=>clipLine(l,lim)).map(l=>encode(simplify(l,tol)));
    each('water',(f,e)=>{if(f.type===3&&f.properties.class!=='swimming_pool')for(const r of polys(geom,f,e,(.008)*k))out.water.push({r});});
    each('waterway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&['river','canal','stream'].includes(c))for(const p of lines(f,e,.008*k))out.waterways.push({c,p});
    });
    each('transportation',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type!==2||!DETAIL_ROADS.has(c)||c==='rail'&&f.properties.subclass!=='rail')return;
      for(const p of lines(f,e,.006*k))out.roads.push({c,p,...(f.properties.ramp?{ramp:1}:{}),...(f.properties.brunnel==='bridge'?{bridge:1}:{})});
    });
    each('landuse',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===3&&LANDUSE.has(c))for(const r of polys(geom,f,e,(c==='residential'?.02:.01)*k))out.landuse.push({c,r});
    });
    each('landcover',(f,e)=>{
      const c=String(f.properties.class||''),s=String(f.properties.subclass||'');
      if(f.type===3&&(c==='wood'||c==='grass'))for(const r of polys(geom,f,e,(c==='wood'?.02:.01)*k))out.parks.push({c:s==='park'||s==='golf_course'?s:c,r});
    });
    each('park',(f,e)=>{if(f.type===3)for(const r of polys(geom,f,e,(.015)*k))out.parks.push({c:'park',r});});
    each('aeroway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&(c==='runway'||c==='taxiway'))for(const p of lines(f,e,.004*k))out.aero.push({c,p});
      else if(f.type===3&&['runway','aerodrome','apron','taxiway'].includes(c))for(const r of polys(geom,f,e,(.004)*k))out.aero.push({c,r});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!PLACES.has(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000});
    });
  });
  if(!fetched)throw new Error('no tiles');
  const order={city:0,town:1,suburb:2,village:3,quarter:4,neighbourhood:5};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,80);
  if(buildings>0){
    const found=[],blim=buildings+.15;
    try{
      await eachTile(home,blim,14,template,net,MVT,({each,geom})=>{
        each('building',(f,e)=>{if(f.type===3)for(const r of geom(f,e))if(r.length>3&&touches(r,blim)){
          const s=simplify(r,.003);if(s.length>3)found.push(s);
        }});
      });
    }catch(e){/* streets without buildings are still a map */}
    const dist=r=>Math.min(...r.map(([x,y])=>Math.max(Math.abs(x),Math.abs(y))));
    let points=0;
    for(const r of found.map(r=>[dist(r),r]).sort((a,b)=>a[0]-b[0]).map(([,r])=>r)){
      if((points+=r.length)>MAX_BUILDING_POINTS)break;
      out.buildings.push({r:encode(r)});
    }
  }
  return out;
}

// The detail map is saved straight to localStorage (not kept in memory by `store`),
// so a layout that doesn't draw it costs nothing. Too big for the quota: not saved.
// Two slots: the street map (up to 15 mi) and the most recent wide map.
const detailKey=spec=>spec.key==='street'?DETAIL_KEY:`${DETAIL_KEY}.wide`;
function savedDetail(home,spec=detailSpec(10)){
  try{
    const m=JSON.parse(localStorage.getItem(detailKey(spec))||'null');
    return m&&m.v===DETAIL_VERSION&&detailFits(m,spec)&&Math.abs(m.latitude-home.latitude)<.01&&Math.abs(m.longitude-home.longitude)<.01&&
      Date.now()-m.built<MAX_AGE?m:null;
  }catch{return null;}
}
function saveDetail(m){
  const key=detailKey({key:m.key||'street'});
  try{localStorage.setItem(key,JSON.stringify(m));return true;}
  catch{try{localStorage.removeItem(key);}catch{/* no storage */}return false;}
}

return {MAP_ATTRIBUTION,zoomFor,AIRFIELD_MAX_RANGE,DETAIL_MAX_RANGE,buildMap,savedMap,saveMap,DETAIL_RANGE,detailSpec,detailFits,decodeDetail,buildDetail,savedDetail,saveDetail};
})();
// ---- model.mjs
__modules["model.mjs"]=(()=>{
const {IDS,airspace,recentSightings,number,inZone,OVERHEAD_MI}=__modules["core.mjs"];
const {RouteLookup}=__modules["routes.mjs"];
const {startLive,haversine,store}=__modules["live.mjs"];
const {AIRCRAFT_TYPES}=__modules["aircraft-types.mjs"];
// The display model: live aircraft (live.mjs: adsb.fi + ADSB.lol routes) enriched
// with operator, cargo brand, look-up angles, closest approach, trend and a daily
// logbook. ?demo=1 makes a synthetic sky around whatever home is set (&scene=emergency:
// a 7700 squawk; &scene=quiet: nothing in range; &scene=long: long names everywhere, to check nothing is cut off).




const query=new URLSearchParams(typeof location!=='undefined'?location.search:'');
const demo=query.get('demo')==='1',scene=query.get('scene')||'';
let HOME={latitude:0,longitude:0,elevationFt:0},TZ='UTC';
const tz=()=>TZ;

// Operator names for airline callsign prefixes (ICAO designators). Lessors and
// trustees in the registered owner field are ignored.
const OPERATORS={AAL:'American',UAL:'United',DAL:'Delta',SWA:'Southwest',JBU:'JetBlue',ASA:'Alaska',NKS:'Spirit',
  FFT:'Frontier',AAY:'Allegiant',SKW:'SkyWest',RPA:'Republic',ENY:'Envoy',EDV:'Endeavor',JIA:'PSA',PDT:'Piedmont',
  ASH:'Mesa',GJS:'GoJet',UCA:'CommuteAir',QXE:'Horizon',HAL:'Hawaiian',SCX:'Sun Country',MXY:'Breeze',VXP:'Avelo',
  ACA:'Air Canada',JZA:'Jazz',WJA:'WestJet',ROU:'Air Canada Rouge',POE:'Porter',TSC:'Air Transat',AMX:'Aeroméxico',
  VOI:'Volaris',VIV:'Viva',BAW:'British Airways',VIR:'Virgin Atlantic',EZY:'easyJet',EJU:'easyJet Europe',
  RYR:'Ryanair',RUK:'Ryanair UK',TOM:'TUI',EXS:'Jet2',LOG:'Loganair',SHT:'BA Shuttle',CFE:'BA CityFlyer',
  EIN:'Aer Lingus',DLH:'Lufthansa',AFR:'Air France',KLM:'KLM',SAS:'SAS',FIN:'Finnair',IBE:'Iberia',VLG:'Vueling',
  TAP:'TAP',SWR:'Swiss',AUA:'Austrian',BEL:'Brussels',LOT:'LOT',THY:'Turkish',PGT:'Pegasus',WZZ:'Wizz Air',
  NAX:'Norwegian',ICE:'Icelandair',UAE:'Emirates',QTR:'Qatar',ETD:'Etihad',SVA:'Saudia',ELY:'El Al',
  AIC:'Air India',SIA:'Singapore',CPA:'Cathay',JAL:'JAL',ANA:'ANA',KAL:'Korean Air',AAR:'Asiana',CCA:'Air China',
  CES:'China Eastern',CSN:'China Southern',QFA:'Qantas',ANZ:'Air New Zealand',VOZ:'Virgin Australia',JST:'Jetstar',
  LAN:'LATAM',TAM:'LATAM Brasil',AVA:'Avianca',CMP:'Copa',AZU:'Azul',GLO:'Gol',ETH:'Ethiopian',
  EJA:'NetJets',LXJ:'Flexjet',XOJ:'XOJet',RCH:'US Air Force',
  FDX:'FedEx',UPS:'UPS',DHK:'DHL',BCS:'DHL',DAE:'DHL',DHX:'DHL',AHK:'Air Hong Kong',BOX:'AeroLogic',SWN:'West Atlantic',
  ABX:'ABX Air',ATN:'ATI',GTI:'Atlas Air',CLX:'Cargolux',ICV:'Cargolux Italia',CKS:'Kalitta',PAC:'Polar',
  GEC:'Lufthansa Cargo',CAO:'Air China Cargo',CKK:'China Cargo',NCA:'Nippon Cargo',MPH:'Martinair',ABW:'AirBridgeCargo',
  AJT:'Amerijet',CJT:'Cargojet',KII:'Kalitta Charters',WGN:'Western Global',KYE:'Sky Lease',NPT:'Atlantic',TAY:'ASL Belgium',MTN:'Mountain Air Cargo',
  CFS:'Empire',WIG:'Wiggins',AMF:'Ameriflight',LCO:'LATAM Cargo',QAF:'Qatar Cargo',CMB:'US Transcom'};
// Cargo brand by callsign prefix. FedEx/UPS/DHL feeders count as their brand;
// Amazon Air flies under ATI, ABX, Atlas, Sun Country etc., so it is found by owner.
const CARGO={FDX:'FedEx',MTN:'FedEx',CFS:'FedEx',WIG:'FedEx',TAY:'FedEx',UPS:'UPS',
  DHK:'DHL',BCS:'DHL',DAE:'DHL',DHX:'DHL',DHL:'DHL',AHK:'DHL',BOX:'DHL',SWN:'DHL',
  ABX:'ABX',ATN:'ATI',GTI:'Atlas',CLX:'Cargolux',ICV:'Cargolux',CKS:'Kalitta',PAC:'Polar',GEC:'Lufthansa',
  CAO:'Air China',CKK:'China Cargo',NCA:'NCA',MPH:'Martinair',ABW:'ABC',AJT:'Amerijet',WGN:'Western Global',
  KYE:'Sky Lease',NPT:'Atlantic',CJT:'Cargojet',AMF:'Ameriflight',LCO:'LATAM',QAF:'Qatar'};
function cargoBrand(callsign,owner){
  const op=(owner||'').toUpperCase(),call=(callsign||'').toUpperCase();
  if(op.includes('AMAZON')||op.includes('PRIME AIR'))return 'Amazon';
  if(/^[A-Z]{3}\d/.test(call)&&CARGO[call.slice(0,3)])return CARGO[call.slice(0,3)];
  if(op.includes('FEDERAL EXPRESS'))return 'FedEx';
  if(op.includes('UNITED PARCEL'))return 'UPS';
  if(/\bDHL\b/.test(op))return 'DHL';
  return '';
}
const EMERGENCY={'7500':'HIJACK','7600':'RADIO FAILURE','7700':'EMERGENCY'};
const titleCase=s=>s.toLowerCase().replace(/[,.]?\s+(inc|co|llc|ltd|corp|corporation|company|plc|gmbh|sa|ag)\.?$/,'').replace(/\b(\w)/g,c=>c.toUpperCase());
const typeName=code=>code?AIRCRAFT_TYPES[String(code).toUpperCase()]||code:'';
const compass=deg=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg/22.5)%16];

// Miles east/north of home.
function offset(lat,lon){
  return {x:(lon-HOME.longitude)*69.172*Math.cos(HOME.latitude*Math.PI/180),y:(lat-HOME.latitude)*69.0};
}
function derive(a){
  const {x,y}=offset(a.latitude,a.longitude),ground=Math.hypot(x,y);
  const bearing=(Math.atan2(x,y)*180/Math.PI+360)%360;
  const elevation=Math.atan2((a.altitude_ft-HOME.elevationFt)*0.3048,Math.max(ground,.01)*1609.344)*180/Math.PI;
  let cpa=null;
  if(number(a.heading)&&number(a.speed_kt)&&a.speed_kt>30){
    const v=a.speed_kt*1.15078/3600,vx=v*Math.sin(a.heading*Math.PI/180),vy=v*Math.cos(a.heading*Math.PI/180);
    const t=-(x*vx+y*vy)/(v*v);
    cpa=t>0?{seconds:t,miles:Math.hypot(x+vx*t,y+vy*t),x:x+vx*t,y:y+vy*t}:{seconds:0,miles:ground,x,y,receding:true};
  }
  return {x,y,ground,bearing,elevation,cpa};
}

// Logbook: per local day, saved. Seen/Highest/Fastest/Cargo count the local area (15 NM).
// Rarest and Farthest count today's aircraft that came within the current map radius:
// Rarest = the type among them seen on the fewest days-aircraft overall (all-time tally).
// Cargo "tonight" runs 18:00-06:00 local, counted per brand.
const LOG_KEY='whatsup.logbook.v1';
const localDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:TZ});
const localHour=t=>Number(new Date(t).toLocaleString('en-US',{hour:'numeric',hourCycle:'h23',timeZone:TZ}));
const tonightKey=t=>{const h=localHour(t);return h>=18?localDay(t):h<6?localDay(t-86400000):null;};
const resetLog=()=>store.remove(LOG_KEY);
function updateLog(log,planes,now){
  const day=localDay(now);
  if(!log||log.day!==day)log={day,seen:[],planes:{},highest:null,fastest:null,typesToday:[],typesAll:log?.typesAll||{},cargo:log?.cargo||{night:null,seen:{}}};
  // Today's aircraft (any distance the feed covers): closest approach, type, callsign and
  // origin. Rarest and Farthest pick from those that came within the map radius, so they
  // follow zooming. Older logs (no planes yet): today's local types count as close (0 mi).
  if(!log.planes){log.planes={};for(const t of log.typesToday||[])log.planes[`old-${t}`]={t,d:0};}
  delete log.typesZone;delete log.zoneSeen;
  const night=tonightKey(now);
  if(log.cargo.night!==night||Array.isArray(log.cargo.seen))log.cargo={night,seen:{}};
  for(const a of planes){
    const from=a.route?.from,d=Math.round(a.distance_mi*10)/10;
    let rec=log.planes[a.hex];
    if(!rec){
      rec=log.planes[a.hex]={d};
      // All-time type tallies: once per aircraft per day, wherever it was seen.
      if(a.aircraft_type)log.typesAll[a.aircraft_type]=(log.typesAll[a.aircraft_type]||0)+1;
      const keys=Object.keys(log.planes);if(keys.length>4000)delete log.planes[keys[0]];
    }
    rec.d=Math.min(rec.d,d);
    if(a.aircraft_type)rec.t=a.aircraft_type;
    if(a.flight)rec.f=a.flight;
    if(from&&number(from.lat)&&number(from.lon)&&!rec.o)
      rec.o={code:a.route.origin,city:from.city||a.route.origin,mi:Math.round(haversine(from.lat,from.lon,HOME.latitude,HOME.longitude))};
    if(a.distance_mi>LOG_MILES)continue; // Seen/Highest/Fastest/Cargo: the local area only
    if(!log.seen.includes(a.hex)){
      log.seen.push(a.hex);if(log.seen.length>3000)log.seen.shift();
      if(a.aircraft_type&&!log.typesToday.includes(a.aircraft_type))log.typesToday.push(a.aircraft_type);
    }
    const name=a.flight;
    if(number(a.altitude_ft)&&(!log.highest||a.altitude_ft>log.highest.value))log.highest={name,value:a.altitude_ft};
    if(number(a.speed_kt)&&(!log.fastest||a.speed_kt>log.fastest.value))log.fastest={name,value:a.speed_kt};
    if(night&&a.cargo&&!log.cargo.seen[a.hex])log.cargo.seen[a.hex]=a.cargo;
  }
  return log;
}
// Rarest and Farthest among today's aircraft that came within `radius` miles.
function pickRarest(log,radius){
  let best=null;
  for(const p of Object.values(log?.planes||{})){
    if(!p.t||p.d>radius)continue;
    const n=log.typesAll[p.t]||0;
    if(!best||n<best.count)best={code:p.t,name:typeName(p.t),count:n};
  }
  return best;
}
function pickFarthest(log,radius){
  let best=null;
  for(const p of Object.values(log?.planes||{}))
    if(p.o&&p.d<=radius&&(!best||p.o.mi>best.value))best={name:p.f||'',value:p.o.mi,from:p.o.city,code:p.o.code};
  return best;
}
// The map radius the summary filters by (set by the app; Settings > Map radius).
let logRadius=()=>17.3;
const setLogRadius=fn=>{logRadius=fn;};
function cargoCounts(seen){
  const counts={};for(const brand of Object.values(seen||{}))counts[brand]=(counts[brand]||0)+1;
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function logSummary(log){
  if(!log)return {today:0,highest:null,fastest:null,farthest:null,rarest:null,cargoTonight:0,cargoBy:[],night:false};
  const cargoBy=cargoCounts(log.cargo.seen);
  // Rarest/Farthest are read when drawn, so zooming the map changes them at once.
  return {today:log.seen.length,highest:log.highest,fastest:log.fastest,night:!!log.cargo.night,
    get rarest(){return pickRarest(log,logRadius());},get farthest(){return pickFarthest(log,logRadius());},
    cargoTonight:cargoBy.reduce((s,[,n])=>s+n,0),cargoBy};
}

// Trend: compare with the reading ~30 s ago; the samples double as the trail.
const samples=new Map();
function trend(a,now){
  const list=(samples.get(a.hex)||[]).filter(s=>now-s.t<=90000);
  list.push({t:now,alt:a.altitude_ft,gs:a.speed_kt,lat:a.latitude,lon:a.longitude});samples.set(a.hex,list);
  const old=list.find(s=>now-s.t>=20000)||list[0];
  const sign=(d,dead)=>!number(d)||Math.abs(d)<dead?0:Math.sign(d);
  return {alt:sign(a.altitude_ft-old.alt,150),speed:sign(a.speed_kt-old.gs,8),trail:list};
}
function pruneSamples(now){for(const [k,l] of samples)if(now-l[l.length-1].t>120000)samples.delete(k);}

function enrich(a,raw,route,now){
  const r=raw||{},owner=typeof r.ownOp==='string'?r.ownOp.trim():'';
  const call=(a.callsign||'').toUpperCase();
  const airline=/^[A-Z]{3}\d/.test(call)?OPERATORS[call.slice(0,3)]:'';
  const cargo=cargoBrand(call,owner);
  const operator=(cargo==='Amazon'?'Amazon Air':'')||airline||
    (owner&&!/BANK|TRUST|LEAS|FINANCE|CAPITAL|WELLS FARGO|WILMINGTON|HOLDINGS/i.test(owner)?titleCase(owner):'');
  const flight=a.callsign||a.registration||a.hex.toUpperCase();
  const squawk=typeof r.squawk==='string'?r.squawk:'';
  const emergency=EMERGENCY[squawk]||(r.emergency&&r.emergency!=='none'?String(r.emergency).toUpperCase():'');
  let progress=null;
  if(route?.from&&route?.to&&number(route.from.lat)&&number(route.to.lat)){
    const flown=haversine(route.from.lat,route.from.lon,a.latitude,a.longitude),left=haversine(a.latitude,a.longitude,route.to.lat,route.to.lon);
    progress={flown,left,share:flown/Math.max(1,flown+left)};
  }
  const vertical=number(r.baro_rate)?r.baro_rate:number(r.geom_rate)?r.geom_rate:null;
  return {...a,flight,operator,registration:a.registration||r.r||'',type:typeName(a.aircraft_type),
    year:/^\d{4}$/.test(String(r.year||''))?String(r.year):'',squawk,emergency,vertical,
    cargo,route,progress,...derive(a),trend:trend(a,now)};
}

// The hero: an emergency first, then the nearest inside the alert zone, then the one
// arriving soonest, then the nearest. In Window view, "inside" means in the window's
// wedge (or right overhead) and "approaching" means its closest point falls in the wedge.
function inAlert(a,config){
  const z=config.zone;
  return z?.kind==='window'?inZone(z,a.x,a.y):a.distance_mi<=config.radiusMiles;
}
function pickHero(planes,config){
  const z=config.zone,win=z?.kind==='window';
  const approaching=a=>a.cpa&&!a.cpa.receding&&a.cpa.seconds<600&&(win?inZone(z,a.cpa.x,a.cpa.y):
    a.cpa.miles<config.radiusMiles+1&&a.ground<=config.rangeMiles);
  const hero=planes.find(a=>a.emergency)||planes.find(a=>a.inside)||
    planes.filter(approaching).sort((a,b)=>a.cpa.seconds-b.cpa.seconds)[0]||planes[0]||null;
  if(hero)hero.status=hero.emergency?'Emergency':hero.inside?(win&&hero.ground>OVERHEAD_MI?'In your window':'Above you now'):
    approaching(hero)?'Approaching':'Nearest';
  return hero;
}

// --- Live
const MAX_PLANES=300,LOG_MILES=17.3; // 15 NM
function liveSource(config,onModel){
  const routes=new RouteLookup(),started=Date.now();let log=store.get(LOG_KEY),lastOk=0;
  return startLive((states,ok)=>{
    if(ok)lastOk=Date.now();
    const now=Date.now();
    const {fresh,all}=airspace(states,now,now-lastOk<15000);
    routes.update(states[IDS.routes]?.attributes?.routes);
    const raw=new Map((states[IDS.feed]?.attributes?.ac||[]).map(r=>[String(r.hex).toLowerCase(),r]));
    // A 250-mile map over a busy region can hold 500+ aircraft: draw the nearest MAX_PLANES
    // (the feed is sorted by distance) to keep the stick's memory and frame rate in hand.
    const planes=all.slice(0,MAX_PLANES).map(a=>enrich(a,raw.get(a.hex),routes.get(a),now));
    for(const a of planes)a.inside=inAlert(a,config);
    pruneSamples(now);
    // Today's logbook and cargo tonight count the same local area at every map radius
    // (the original 15 NM feed), so zooming out doesn't inflate them.
    if(fresh){log=updateLog(log,planes,now);store.set(LOG_KEY,log);}
    const recent=recentSightings(states,planes.filter(a=>a.inside),now).map(a=>({...a,type:typeName(a.aircraft_type),
      route:routes.get(a),cargo:cargoBrand(a.callsign,''),flight:a.callsign||a.registration||a.hex.toUpperCase()}));
    onModel({now,live:true,fresh,connecting:!lastOk&&now-started<15000,planes,hero:pickHero(planes,config),recent,log:logSummary(log)});
  },config);
}

// --- Demo: plausible flights around home, moving in real time. Local airports
// come from the map; the far ends are well-known hubs.
const HUBS={ATL:['Atlanta',33.637,-84.428],ORD:['Chicago',41.978,-87.905],DEN:['Denver',39.862,-104.673],
  LHR:['London',51.47,-0.454],SDF:['Louisville',38.174,-85.736],MEM:['Memphis',35.042,-89.977],
  LEJ:['Leipzig',51.432,12.241],JFK:['New York',40.641,-73.778],LAX:['Los Angeles',33.942,-118.408],
  DXB:['Dubai',25.253,55.365],CDG:['Paris',49.01,2.548],BOS:['Boston',42.364,-71.005],
  FRA:['Frankfurt am Main',50.033,8.57],DFW:['Dallas/Fort Worth',32.897,-97.038]};
function demoSource(config,onModel,airports){
  const local=(airports||[]).find(a=>a.iata)||null;
  const localPlace=local?{code:local.iata,city:local.name.replace(/ (International )?Airport$/,''),
    lat:HOME.latitude+local.y/69,lon:HOME.longitude+local.x/(69.172*Math.cos(HOME.latitude*Math.PI/180))}:null;
  const hub=code=>{const [city,lat,lon]=HUBS[code];return {code,city,lat,lon};};
  const leg=(o,d)=>{
    const from=o==='HOME'?localPlace:hub(o),to=d==='HOME'?localPlace:hub(d);
    return from&&to&&from.code!==to.code?{origin:from.code,destination:to.code,from,to}:null;
  };
  const far=(a,b)=>{const h=Object.keys(HUBS).filter(k=>k!==localPlace?.code);return [h[a%h.length],h[b%h.length]];};
  const [h1,h2]=far(1,10),[h3,h4]=far(5,4);
  // [hex, callsign, reg, type, ownOp, year, east mi, north mi, alt ft, kt, track, fpm, route]
  const DEMO=[
    ['a2b150','UAL2631','N27270','B38M','UNITED AIRLINES INC','2022',1.6,-1.9,34000,451,331,0,leg(h3,h1)],
    ['a8f0a3','ATN3417','N1997A','B763','AMAZON.COM SERVICES LLC','1997',-3.1,1.2,7400,250,215,-1100,leg('LAX','HOME')],
    ['406f2a','DHK283','G-DHLF','B77L','DHL AIR LTD','2018',-6.8,4.4,11500,284,226,-1500,leg('LEJ','HOME')],
    ['a4c5e1','UPS1139','N314UP','B763','UNITED PARCEL SERVICE CO','2004',4.8,6.3,33000,438,232,0,leg('JFK','SDF')],
    ['a1f2c4','DAL1213','N392DN','A321','DELTA AIR LINES INC','2019',-7.4,-2.6,6900,240,152,2400,leg('HOME','ATL')],
    ['a7c3b9','SWA1987','N8817L','B38M','SOUTHWEST AIRLINES CO','2019',6.9,-5.2,37000,462,198,0,leg(h4,h2)],
    ['a03b7e','N451PA','N451PA','C172','','1977',2.5,3.1,2400,96,300,300,null],
    ['a0c9f5','N8UH','N8UH','EC35','UNIVERSITY HOSPITAL','2009',-1.2,3.7,1300,118,20,0,null],
  ];
  const started=Date.now(),log={today:184,highest:{name:'UAE2VL',value:41000},fastest:{name:'SWA1987',value:512},
    rarest:{code:'C130',name:typeName('C130'),count:1},farthest:{name:'DHK283',value:4207,from:'Leipzig',code:'LEJ'},night:true,cargoTonight:23,cargoBy:[['UPS',8],['FedEx',6],['DHL',5],['Amazon',4]]};
  if(scene==='long')Object.assign(log,{rarest:{code:'A124',name:typeName('A124'),count:1},
    farthest:{name:'GEC8401',value:4310,from:'Frankfurt am Main',code:'FRA'},cargoBy:[['UPS',9],['FedEx',5],['Amazon',3],['ABX',2],['DHL',2]]});
  const recentRows=[['a6d1e2','UAL1840','B739',leg('DEN','BOS'),3],['a3c4d5','ATN3121','B763',leg('LAX','HOME'),12],
    ['a9f8e7','DAL2370','B712',leg('HOME','ATL'),19],['a8b7c6','N22PG','C25B',null,28]];
  // scene=long: the hero and a neighbour get the longest names a TV is likely to see.
  // ?herotype=R44 (demo): the first aircraft flies as that type, to check photos and credits.
  const ht=/^[A-Z0-9]{2,4}$/.test(query.get('herotype')||'')?query.get('herotype'):'';
  if(ht)DEMO[0]=[DEMO[0][0],DEMO[0][1],'N44TST',ht,'',DEMO[0][5],...DEMO[0].slice(6)];
  if(scene==='long'){
    DEMO[0]=['3c4b26','GEC8401','D-ALFH','B77L','LUFTHANSA CARGO AG','2013',1.6,-1.9,34000,451,331,0,leg('FRA','DFW')];
    DEMO[5]=['a7c3b9','SWA4499','N8731J','B38M','SOUTHWEST AIRLINES CO','2019',6.9,-5.2,37000,462,198,0,leg('DFW','FRA')];
  }
  const tick=()=>{
    const now=Date.now(),t=(now-started)/1000;
    const planes=DEMO.map(([hex,callsign,registration,aircraft_type,ownOp,year,e,n,alt,gs,track,fpm,route])=>{
      const v=gs*1.15078/3600,east=e+v*t*Math.sin(track*Math.PI/180),north=n+v*t*Math.cos(track*Math.PI/180);
      const latitude=HOME.latitude+north/69,longitude=HOME.longitude+east/(69.172*Math.cos(HOME.latitude*Math.PI/180));
      const a={hex,callsign,registration,aircraft_type,latitude,longitude,altitude_ft:Math.round(alt+fpm*t/60),speed_kt:gs,
        heading:track,position_timestamp:now/1000-1};
      a.distance_mi=Math.hypot(east,north);a.inside=a.distance_mi<=config.radiusMiles;
      const raw={ownOp,year,squawk:scene==='emergency'&&hex===DEMO[0][0]?'7700':'2214',baro_rate:fpm};
      const p=enrich(a,raw,route?{...route,flight:callsign}:null,now);p.inside=inAlert(p,config);return p;
    }).filter(a=>a.distance_mi<config.rangeMiles+3&&scene!=='quiet')
      .sort((a,b)=>Number(b.inside)-Number(a.inside)||a.distance_mi-b.distance_mi);
    const recent=recentRows.map(([hex,flight,code,route,mins])=>({hex,flight,callsign:flight,aircraft_type:code,
      type:typeName(code),route,cargo:cargoBrand(flight,flight.startsWith('ATN')?'AMAZON':''),last_seen:now/1000-mins*60}));
    onModel({now,live:false,fresh:true,planes,hero:pickHero(planes,config),recent,log});
  };
  tick();const timer=setInterval(tick,1000);
  return {stop(){clearInterval(timer);}};
}

// Start the feed for a place; returns {stop}.
function start(place,config,onModel,airports){
  HOME={latitude:place.latitude,longitude:place.longitude,elevationFt:(place.elevationM||0)*3.2808};TZ=place.timeZone;
  samples.clear();
  const cfg={...config,latitude:place.latitude,longitude:place.longitude};
  return demo?demoSource(cfg,onModel,airports):liveSource(cfg,onModel);
}

return {query,demo,tz,cargoBrand,EMERGENCY,typeName,compass,offset,resetLog,updateLog,pickRarest,pickFarthest,setLogRadius,cargoCounts,logSummary,start};
})();
// ---- kit.mjs
__modules["kit.mjs"]=(()=>{
const {number,zoneOutline}=__modules["core.mjs"];
const {SILHOUETTES,silhouetteFamily}=__modules["silhouettes.mjs"];
const {photoFor,qrFor,modelPhoto}=__modules["photos.mjs"];
const {MAP_ATTRIBUTION}=__modules["mapgen.mjs"];
const {placeLabel}=__modules["place.mjs"];
const {tz,compass,offset}=__modules["model.mjs"];
// Shared toolkit for layouts (web/layouts/<id>.mjs + <id>.css). The app owns the
// data (feed model, settings, maps); a layout only draws it. Each layout module ends
// with `export default {...}`:
//   name   'Glass'                      shown in Settings
//   map    'base' | 'detail'            detail = streets, landuse, buildings (built on demand)
//   mount(root,ctx)                     build DOM into root (the 960x540 stage)
//   setMap(maps)                        {base,detail}; either may be null until built
//   render(m)                           every model tick (1 s demo, 5 s live)
//   refresh()                           units or alert radius changed
//   unmount()                           stop timers; the app empties root afterwards
// ctx: {settings(), place(), demo, needs(kind)}. The model m: {now, live, fresh,
// connecting, planes[], hero, recent[], log}. Planes carry hex, flight, callsign,
// registration, aircraft_type, type (name), operator, cargo (brand), latitude,
// longitude, altitude_ft, speed_kt, heading, vertical (fpm), squawk, emergency,
// route {origin,destination,from,to}, progress {flown,left,share}, x/y (miles east/
// north of home), ground (miles), bearing, elevation (deg up), cpa {seconds,miles,
// receding}, inside (within the alert radius), trend {alt,speed,trail[]}, year;
// hero also has status ('Above you now', 'Approaching', 'Nearest', 'Emergency').





const DATA_ATTRIBUTION='Aircraft: adsb.fi · Routes: ADSB.lol';
// Map radius in miles (Settings > Map radius). Layouts are drawn for a 10-mile view
// (BASE_RANGE); paintMap and toView scale every view by zoom() = 10 / map radius, so
// fixed pixel sizes in a layout stay put while distances shrink or grow.
const BASE_RANGE=10;
const range=()=>S.mapMiles||BASE_RANGE;
const zoom=()=>BASE_RANGE/range();

const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={},text)=>{
  const el=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))if(v!==undefined&&v!==null)el.setAttribute(k,v);
  if(text!==undefined)el.textContent=text;return el;
};
const el=(tag,cls,text)=>{
  const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;
};
const setText=(e,v)=>{v=v??'';if(e&&e.textContent!==String(v))e.textContent=v;};
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;
// First spot (dx,dy offsets from p) where a w x h box fits inside bounds without hitting boxes.
function placeBox(boxes,p,w,h,spots,bounds){
  for(const [dx,dy] of spots){
    const b={x:p.x+dx,y:p.y+dy,w,h};
    if(bounds&&(b.x<bounds.x||b.y<bounds.y||b.x+w>bounds.x+bounds.w||b.y+h>bounds.y+bounds.h))continue;
    if(!boxes.some(o=>overlap(o,b))){boxes.push(b);return b;}
  }
  return null;
}

// --- Units (Settings: distance mi/km, altitude ft/m).
let S={distance:'mi',altitude:'ft'};
const useSettings=s=>{S=s;};
const KM=1.609344;
const metric=()=>S.distance==='km';
const fmt={
  int:v=>number(v)?Math.round(v).toLocaleString('en-US'):'—',
  dist:(mi,d=1)=>!number(mi)?'—':S.distance==='km'?`${(mi*KM).toFixed(d)} km`:`${mi.toFixed(d)} mi`,
  far:mi=>!number(mi)?'—':S.distance==='km'?`${fmt.int(mi*KM)} km`:`${fmt.int(mi)} mi`,
  alt:ft=>!number(ft)?'—':S.altitude==='m'?`${fmt.int(ft*.3048)} m`:ft>=18000?`FL${Math.round(ft/100)}`:`${fmt.int(ft)} ft`,
  altNum:ft=>!number(ft)?'—':S.altitude==='m'?fmt.int(ft*.3048):fmt.int(ft),
  altUnit:()=>S.altitude==='m'?'m':'ft',
  speed:kt=>!number(kt)?'—':S.distance==='km'?`${fmt.int(kt*1.852)} km/h`:`${fmt.int(kt)} kt`,
  speedNum:kt=>!number(kt)?'—':S.distance==='km'?fmt.int(kt*1.852):fmt.int(kt),
  speedUnit:()=>S.distance==='km'?'km/h':'kt',
  distUnit:()=>S.distance==='km'?'km':'mi',
  vs:fpm=>!number(fpm)||Math.abs(fpm)<100?'level':S.altitude==='m'?`${fpm>0?'↑':'↓'}${(Math.abs(fpm)*.00508).toFixed(1)} m/s`:
    `${fpm>0?'↑':'↓'}${fmt.int(Math.abs(Math.round(fpm/50)*50))}`,
  mmss:s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`,
  ago:(stamp,now)=>{const m=Math.max(0,Math.floor((now/1000-stamp)/60));return m<1?'now':m<60?`${m}m`:`${Math.floor(m/60)}h`;},
  clock:(now,opts={})=>{try{return new Date(now).toLocaleTimeString(S.place?.countryCode==='US'?'en-US':'en-GB',{hour:'numeric',minute:'2-digit',timeZone:tz(),...opts});}catch{return '';}},
  date:(now,opts={weekday:'long',day:'numeric',month:'long'})=>{try{return new Date(now).toLocaleDateString('en-GB',{timeZone:tz(),...opts});}catch{return '';}},
};
const placeName=()=>placeLabel(S.place)||'';
const cityName=()=>S.place?.name||'';
const alertRadius=()=>Math.min(S.radiusMiles||3,range());
// Settings > Alert zone: the circle (Alert radius) or the Window view wedge.
const alertZone=()=>S.alertZone==='window'?{kind:'window',from:S.viewFrom,to:S.viewTo,miles:S.viewMiles}:{kind:'circle',radius:alertRadius()};
const windowView=()=>S.alertZone==='window';
// SVG path of the alert zone; at(x,y) maps miles east/north of home to screen {x,y}.
const zonePath=at=>'M'+zoneOutline(alertZone()).map(([x,y])=>{const p=at(x,y);return `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;}).join('L')+'Z';
const routeText=(r,sep=' → ')=>r?`${r.origin}${sep}${r.destination}`:'';
const routeCities=r=>r?[r.from?.city||r.origin,r.to?.city||r.destination]:null;
// "Live" / "Preview" / "Connecting…" / "No signal", and what to say when nothing is near.
const statusText=(m,demo)=>demo?'Preview':m.connecting?'Connecting…':m.fresh?'Live':'No signal';
const quietText=(m,demo)=>!demo&&!m.fresh?(m.connecting?'Connecting to the live feed…':'No live data right now. Retrying every few seconds.'):
  'Quiet skies. Nothing within range right now.';

// --- Aircraft. Top-down silhouettes, nose up, in a 64-unit box.
const PLANE='M0-29C3-29 4-23 4-17L4-5 26 9 26 13 4 6 3 22 11 28 11 31 0 27-11 31-11 28-3 22-4 6-26 13-26 9-4-5-4-17C-4-23-3-29 0-29Z';
const HELI='M0-15C4.6-15 5.6-9 5.6-4 5.6 2 3 5 1.2 6L1 20 5.5 20.6 5.5 22.4 1 23 .8 27-.8 27-1 23-5.5 22.4-5.5 20.6-1 20-1.2 6C-3 5-5.6 2-5.6-4-5.6-9-4.6-15 0-15Z';
const SINGLE='M0-24C2-24 2.6-21 2.6-17L2.6-12 26-11.2 26-6.4 2.6-5.6 1.8 17 8.5 19 8.5 22 0 21.4-8.5 22-8.5 19-1.8 17-2.6-5.6-26-6.4-26-11.2-2.6-12-2.6-17C-2.6-21-2-24 0-24Z';
const isHeli=a=>/^(EC|AS3|AS5|B4|R44|R22|H[0-9]|S76|A1[0-4]9|B06|B407|B429|H60)/.test(a.aircraft_type||'')||a.category==='A7';
const isLight=a=>/^(C1[5-8]|C2[01]|PA|SR2|BE[23]|P28|DA4|PC12|C206|C210)/.test(a.aircraft_type||'')||a.category==='A1';
const shapeFor=a=>isHeli(a)?HELI:isLight(a)?SINGLE:PLANE;
function planeIcon(a,p,size,cls,shape=shapeFor(a)){
  const g=svg('g',{class:cls,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.heading||0}) scale(${size/64})`});
  g.append(svg('path',{d:shape}));return g;
}
// Small side-profile picture of the aircraft family (silhouettes.mjs), coloured by CSS.
function silhouette(a,cls='sil'){
  const family=silhouetteFamily(a),e=svg('svg',{class:`${cls} ${family}`,viewBox:'0 0 120 40','aria-hidden':'true'});
  e.append(svg('path',{d:SILHOUETTES[family],'fill-rule':'nonzero'}));e.dataset.family=family;return e;
}
// The planes worth labelling first: hero, then those inside the alert ring, then nearest.
const byInterest=m=>[...new Set([m.hero,...m.planes.filter(a=>a.inside),...m.planes].filter(Boolean))];

// Longer trails than the model keeps (it keeps ~90 s): positions per aircraft for
// `maxAge` ms, at most one sample per `every` ms. Miles east/north of home.
class TrailBook{
  constructor(maxAge=300000,every=5000){this.maxAge=maxAge;this.every=every;this.map=new Map();}
  update(planes,now){
    for(const a of planes){
      let l=this.map.get(a.hex);if(!l)this.map.set(a.hex,l=[]);
      if(!l.length||now-l[l.length-1].t>=this.every)l.push({x:a.x,y:a.y,t:now});
    }
    for(const [k,l] of this.map){
      while(l.length&&now-l[0].t>this.maxAge)l.shift();
      if(!l.length)this.map.delete(k);
    }
  }
  get(hex){return this.map.get(hex)||[];}
  clear(){this.map.clear();}
}

// --- Map painting on a canvas. The canvas is sized for the screen (the stage is
// scaled), painted once per map/layout, and shared paths keep it fast on the stick.
const pixelRatio=()=>Math.min(2,Math.max(1,Math.min(innerWidth/960,innerHeight/540)*(devicePixelRatio||1)));
function makeCanvas(w,h,cls){
  const c=el('canvas',cls),k=pixelRatio();
  c.width=Math.round(w*k);c.height=Math.round(h*k);c.style.width=`${w}px`;c.style.height=`${h}px`;
  c._k=k;c._w=w;c._h=h;return c;
}
// Where each map was built vs. home (they agree within ~1 km): miles to shift by.
function mapShift(m,home=S.place){
  if(!m||!home)return [0,0];
  const cos=Math.cos(home.latitude*Math.PI/180);
  return [(m.longitude-home.longitude)*69.172*cos,(m.latitude-home.latitude)*69];
}
// view: {cx,cy (home, in canvas CSS px), ppm (px per mile at the 10-mile view), clip?: {r} circle or
//   {x,y,w,h} rect, rotate?: deg (heading up), center?: place, fixed?: true = ignore the map radius}.
// ppmOf(view): the pixels per mile actually drawn.
const ppmOf=view=>view.fixed?view.ppm:view.ppm*zoom();
// The round number (1, 2 or 5 x 10^n) nearest above ~.75x.
function niceStep(raw){
  const p=10**Math.floor(Math.log10(raw));
  return [1,2,5,10].map(m=>m*p).find(v=>v>=raw*.75)||10*p;
}
// A round distance (1, 2, 5 x 10^n mi or km) near `target` px long at this view: {px, value, label}.
function niceDistance(view,target=70){
  const unit=S.distance==='km'?1/KM:1,ppm=ppmOf(view)*unit,value=niceStep(target/ppm);
  const label=`${+value.toPrecision(3)} ${S.distance==='km'?'km':value===1?'mile':'miles'}`;
  return {px:value*ppm,value,label};
}
// spec: [{layer, from?:'base'|'detail', classes?:[...], not?:[...], fill?, stroke?, width?, dash?,
//   alpha?, glow?, glowColor?, cap?, join?, minPx?}] painted in order. Layers: base water, rivers,
//   roads (c), runways; detail water, waterways (c), roads (c), landuse (c), parks (c), aero (c),
//   buildings. A missing map or layer is skipped.
function paintMap(canvas,maps,view,spec){
  const g=canvas.getContext('2d'),k=canvas._k||1;
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,canvas.width,canvas.height);
  g.setTransform(k,0,0,k,0,0);
  g.save();
  if(view.clip){g.beginPath();if(view.clip.r)g.arc(view.cx,view.cy,view.clip.r,0,Math.PI*2);else g.rect(view.clip.x,view.clip.y,view.clip.w,view.clip.h);g.clip();}
  const rot=(view.rotate||0)*Math.PI/180,cr=Math.cos(rot),sr=Math.sin(rot);
  for(const s of spec){
    const from=s.from||(['landuse','parks','aero','buildings','waterways'].includes(s.layer)?'detail':'base');
    const m=maps?.[from];if(!m||!m[s.layer]?.length)continue;
    const [sx,sy]=mapShift(m,view.center),ppm=ppmOf(view),div=m.per||1000; // detail maps: points per mile
    const X=(x,y)=>{x+=sx;y+=sy;return view.cx+(x*cr-y*sr)*ppm;},Y=(x,y)=>{x+=sx;y+=sy;return view.cy-(x*sr+y*cr)*ppm;};
    g.beginPath();
    for(const f of m[s.layer]){
      if(s.classes&&!s.classes.includes(f.c))continue;
      if(s.not&&s.not.includes(f.c))continue;
      const pts=f.p||f.r||f,closed=!!f.r||s.layer==='water'&&from==='base';
      if(ArrayBuffer.isView(pts)){
        for(let i=0;i<pts.length;i+=2){const x=pts[i]/div,y=pts[i+1]/div;i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
      }else{
        for(let i=0;i<pts.length;i++){const [x,y]=pts[i];i?g.lineTo(X(x,y),Y(x,y)):g.moveTo(X(x,y),Y(x,y));}
      }
      if(closed)g.closePath();
    }
    g.globalAlpha=s.alpha??1;
    g.shadowBlur=s.glow?s.glow*k:0;g.shadowColor=s.glowColor||s.stroke||s.fill||'transparent';
    if(s.fill){g.fillStyle=s.fill;g.fill('evenodd');}
    if(s.stroke){g.strokeStyle=s.stroke;g.lineWidth=s.width||1;g.setLineDash(s.dash||[]);g.lineCap=s.cap||'round';g.lineJoin=s.join||'round';g.stroke();}
  }
  g.restore();g.globalAlpha=1;g.shadowBlur=0;g.setLineDash([]);
}
// Screen position (CSS px) of a point in miles from home, for the same view.
const toView=(view,x,y)=>{
  const rot=(view.rotate||0)*Math.PI/180,cr=Math.cos(rot),sr=Math.sin(rot),ppm=ppmOf(view);
  return {x:view.cx+(x*cr-y*sr)*ppm,y:view.cy-(x*sr+y*cr)*ppm};
};
// Map labels near home: [{name,x,y,kind}] in miles, nearest/most important first.
// `within` (and airportsNear's) is in miles at the 10-mile view; it grows with the map radius.
function placesNear(maps,within,{kinds=['city','town','suburb'],max=12}={}){
  const range=within/zoom();
  const src=maps?.detail?.places?.length?maps.detail:maps?.base;
  if(!src?.places)return [];
  const [sx,sy]=mapShift(src);
  return src.places.filter(p=>kinds.includes(p.c)).map(p=>({...p,x:p.x+sx,y:p.y+sy}))
    .filter(p=>Math.abs(p.x)<range&&Math.abs(p.y)<range).slice(0,max);
}
// Every airfield (big airports first, then coded fields, then the rest), with a short name:
// "Butler County Regional Airport" -> "Butler County".
const shortField=name=>name.replace(/\s*\b(International |Regional |Municipal )?(Airport|Airfield|Airpark|Aerodrome|Ultralight ?port|Flightpark)\b.*$/i,'').trim()||name;
function airfieldsNear(maps,within,max=60){
  const m=maps?.base,range=within/zoom();if(!m?.airfields)return [];
  const [sx,sy]=mapShift(m);
  return m.airfields.map(a=>({...a,x:a.x+sx,y:a.y+sy})).filter(a=>Math.abs(a.x)<range*1.5&&Math.abs(a.y)<range).slice(0,max);
}
function airportsNear(maps,within,max=6){
  const m=maps?.base,range=within/zoom();if(!m?.airports)return [];
  const [sx,sy]=mapShift(m);
  return m.airports.map(a=>({...a,x:a.x+sx,y:a.y+sy})).filter(a=>Math.hypot(a.x,a.y)<range).slice(0,max);
}

// Both credits as one element; layouts style `.credits` themselves.
function credits(cls='credits',{oneLine=false}={}){
  const e=el('div',cls);
  e.append(el('div','credit-data',DATA_ATTRIBUTION),el('div','credit-map',oneLine?`Map ${MAP_ATTRIBUTION}`:MAP_ATTRIBUTION));
  return e;
}

return {DATA_ATTRIBUTION,BASE_RANGE,range,zoom,svg,el,setText,overlap,placeBox,useSettings,KM,metric,fmt,placeName,cityName,alertRadius,alertZone,windowView,zonePath,routeText,routeCities,statusText,quietText,PLANE,HELI,SINGLE,isHeli,isLight,shapeFor,planeIcon,silhouette,byInterest,TrailBook,pixelRatio,makeCanvas,mapShift,ppmOf,niceStep,niceDistance,paintMap,toView,placesNear,shortField,airfieldsNear,airportsNear,credits,photoFor,qrFor,modelPhoto,number,compass,offset,placeLabel,MAP_ATTRIBUTION};
})();
// ---- app.mjs
__modules["app.mjs"]=(()=>{
const {CONFIG}=__modules["config.js"];
const {chimeGate}=__modules["core.mjs"];
const {HISTORY_KEY,MAX_NM,store}=__modules["live.mjs"];
const {start,demo,query,compass,resetLog,setLogRadius}=__modules["model.mjs"];
const {MAP_RADII,VIEW_MILES,alertFor,loadSettings,saveSettings,locateByIp,searchPlaces,searchAddress,looksLikeAddress,placeLabel}=__modules["place.mjs"];
const {buildMap,savedMap,saveMap,buildDetail,savedDetail,saveDetail,decodeDetail,detailSpec,detailFits}=__modules["mapgen.mjs"];
const {svg,useSettings,fmt,makeCanvas,paintMap}=__modules["kit.mjs"];
// What's Up: the page. Owns the data (feed model, settings, maps) and the shared
// screens (Settings, location, Adjust position, layout picker); the chosen layout
// (web/layouts/<id>.mjs, loaded on demand, only one at a time) draws the dashboard.
// Remote: arrows move, Select chooses, Back closes, Select on the dashboard opens Settings.







const $=id=>document.getElementById(id);
const setText=(id,v)=>{const el=$(id);v=v??'';if(el&&el.textContent!==String(v))el.textContent=v;};
const stage=$('stage');
const fit=()=>{const s=Math.min(innerWidth/960,innerHeight/540);stage.style.transform=`translate(-50%,-50%) scale(${s})`;};
addEventListener('resize',fit);fit();

// --- Bridge to the Vega app: it handles the remote's Back button and asks us first.
const native=window.ReactNativeWebView;
const tellApp=msg=>{try{native?.postMessage(JSON.stringify(msg));}catch{/* desktop */}};
// Keep screen awake: the app plays a silent, invisible loop so the screensaver stays away.
const tellAwake=()=>tellApp({type:'awake',on:settings.keepAwake!==false});

// Rarest/Farthest follow the map radius (Settings > Map radius, Up/Down).
setLogRadius(()=>settings.mapMiles||CONFIG.rangeMiles);
let settings=loadSettings(),feed=null,lastModel=null,placeToken=0;
useSettings(settings);
const mapMiles=()=>settings.mapMiles||CONFIG.rangeMiles;
// The feed follows the map radius: adsb.fi is asked for ~1.5x the radius (wide layouts
// show that far sideways), at most its 250 NM, and polled less often over big areas.
const feedConfig=()=>{
  const r=mapMiles();
  const win=settings.alertZone==='window',reach=Math.max(r*1.5,win?settings.viewMiles+3:0);
  return {...CONFIG,radiusMiles:alertFor(settings.radiusMiles,r),rangeMiles:r,
    zone:win?{kind:'window',from:settings.viewFrom,to:settings.viewTo,miles:settings.viewMiles}:{kind:'circle',radius:alertFor(settings.radiusMiles,r)},
    searchNm:Math.min(MAX_NM,Math.max(CONFIG.searchNm,Math.ceil(reach/1.15078))),
    pollSeconds:r<=25?CONFIG.pollSeconds:r<=100?10:15};
};
const maps={base:null,detail:null};

// --- Credits: always in Settings; on the dashboard one line that fades out ~5 s after
// the app opens, the layout changes or a new location's map is drawn.
let creditTimer=0;
const CREDITS='Aircraft adsb.fi · Routes ADSB.lol · Map © OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
function flashCredits(){
  const c=$('credit-flash'),sat=active?.id==='atlas-satellite',us=['US','PR'].includes(settings.place?.countryCode);
  c.textContent=CREDITS+(sat?(us?' · Imagery USGS':' · Imagery Sentinel-2 cloudless 2016 by EOX (Copernicus Sentinel data 2016)'):'');
  c.classList.add('on');
  clearTimeout(creditTimer);creditTimer=setTimeout(()=>c.classList.remove('on'),5000);
}

// --- Layouts. Order is the Settings order; the first is the default.
const LAYOUTS=[['radar','Radar'],['glass','Glass'],['departures','Departures'],['blueprint','Blueprint'],['atlas','Atlas'],
  ['atlas-dark','Atlas Dark'],['atlas-satellite','Atlas Satellite'],['swiss','Swiss'],['synthwave','Synthwave'],['sectional','Sectional'],['cockpit','Cockpit'],['night-sky','Night Sky']];
const layoutName=id=>(LAYOUTS.find(([k])=>k===id)||LAYOUTS[0])[1];
const validLayout=id=>LAYOUTS.some(([k])=>k===id)?id:'radar';
// A variant reuses another layout's code, with stylesheets layered on top in order
// (each also becomes an L-<id> class on the stage); ctx.layout() tells the code which.
const VARIANTS={'atlas-dark':['atlas','atlas-dark'],'atlas-satellite':['atlas','atlas-dark','atlas-satellite']};
const sheetsOf=id=>VARIANTS[id]||[id];
const codeOf=id=>sheetsOf(id)[0];
const bundled=!!window.__whatsupModules;
const registry={};
window.__whatsupLayout=(id,mod)=>{registry[id]=mod;};
function addCss(id,done){
  if(document.querySelector(`link[data-layout="${id}"]`))return done();
  const css=Object.assign(document.createElement('link'),{rel:'stylesheet',href:`layouts/${id}.css`,onload:done,onerror:done});
  css.dataset.layout=id;document.head.append(css);
}
function loadLayout(id){
  const code=codeOf(id);
  return new Promise((resolve,reject)=>{
    const sheets=sheetsOf(id);let waiting=sheets.length+1;
    const done=()=>{if(--waiting)return;registry[code]?resolve(registry[code]):reject(new Error(`layout ${id} failed to load`));};
    for(const sheet of sheets)addCss(sheet,done);
    if(registry[code])done();
    else if(bundled){
      const s=Object.assign(document.createElement('script'),{src:`layouts/${code}.js`});
      s.onload=s.onerror=()=>{s.remove();done();};document.head.append(s);
    }else import(`./layouts/${code}.mjs`).then(m=>{registry[code]=m.default;done();},e=>{console.error(e);done();});
  });
}
// Keep only the active layout's code and stylesheets so only it costs memory.
function unloadExcept(id){
  const keep=new Set(sheetsOf(id));
  for(const k of Object.keys(registry))if(!keep.has(k))delete registry[k];
  for(const l of document.querySelectorAll('link[data-layout]'))if(!keep.has(l.dataset.layout))l.remove();
}

let active=null,layoutToken=0;
const root=$('layout');
const ctx={settings:()=>settings,place:()=>settings.place,layout:()=>active?.id,demo};
async function useLayout(id){
  id=validLayout(id);
  if(active?.id===id)return;
  const token=++layoutToken;
  let mod;
  try{mod=await loadLayout(id);}catch(e){console.error(e.message);if(token===layoutToken&&!active&&id!=='radar')useLayout('radar');return;}
  if(token!==layoutToken)return;
  const old=active;
  if(old){
    try{old.mod.unmount?.();}catch(e){console.error('unmount',e);}
    stage.classList.remove(...sheetsOf(old.id).map(s=>`L-${s}`));
  }
  unloadExcept(id);
  root.replaceChildren();root.className='layout';
  stage.classList.add(...sheetsOf(id).map(s=>`L-${s}`));stage.dataset.layout=id;
  active={id,mod};
  if(mod.map!=='detail')maps.detail=null; // free it; it reloads from storage when needed
  try{
    mod.mount(root,ctx);
    mod.setMap?.({...maps});
    if(lastModel&&!adj)mod.render(lastModel);
  }catch(e){console.error(`layout ${id}`,e);}
  if(mod.map==='detail')ensureDetail();
  flashCredits();
}
function draw(m){
  if(!active||adj)return;
  try{active.mod.render(m);}catch(e){console.error(`render ${active.id}`,e);}
}
function mapsChanged(){
  try{active?.mod.setMap?.({...maps});}catch(e){console.error('setMap',e);}
}

// --- Detail map (streets, landuse, buildings) for the layouts that draw it.
let detailToken=0,detailBusy=false;
async function ensureDetail(){
  const place=settings.place;
  if(!place||maps.detail||detailBusy)return;
  const spec=detailSpec(mapMiles()),saved=savedDetail(place,spec);
  if(saved){maps.detail=decodeDetail(saved);return mapsChanged();}
  const token=++detailToken;detailBusy=true;
  setText('layout-note',mapMiles()<=15?'Drawing the street map…':'Filling in map detail…');
  try{
    const built=await buildDetail(place,spec);
    if(token!==detailToken||settings.place!==place)return;
    saveDetail(built);
    if(active?.mod.map==='detail'){maps.detail=decodeDetail(built);mapsChanged();}
    setText('layout-note','');
  }catch(e){
    console.error('detail map',e?.message||e);
    if(token===detailToken)setText('layout-note','Street map unavailable');
    setTimeout(()=>{if(token===detailToken)setText('layout-note','');},6000);
  }finally{if(token===detailToken)detailBusy=false;}
}

// --- Place, map and feed
// Chime when the alert zone goes from empty to occupied (Settings > Chime); the app plays it.
const CHIME_VOLUME={low:.25,med:.55,high:1};
let chime=null;
function listen(m){
  const r=chimeGate(chime,m.planes.filter(a=>a.inside).length,m.now,m.live&&m.fresh);chime=r.state;
  if(r.ring&&settings.chime!=='off')tellApp({type:'chime',volume:CHIME_VOLUME[settings.chime]});
}
function render(m){lastModel=m;listen(m);draw(m);}
async function applyPlace(place,{fresh=false}={}){
  const token=++placeToken;chime=null; // a new feed starts quiet
  feed?.stop();feed=null;
  if(fresh){store.remove(HISTORY_KEY);resetLog();}
  const range=mapMiles();
  maps.base=savedMap(place,range);maps.detail=null;detailToken++;detailBusy=false;
  mapsChanged();
  if(active?.mod.map==='detail')ensureDetail();
  const startFeed=()=>{if(token===placeToken&&!feed)feed=start(place,feedConfig(),render,maps.base?.airports);};
  if(!demo)startFeed();
  if(maps.base){startFeed();return;}
  for(let attempt=0;token===placeToken;attempt++){
    try{
      const m=await buildMap(place,range);
      if(token!==placeToken)return;
      maps.base=m;saveMap(m);mapsChanged();setText('layout-note','');flashCredits();
      break;
    }catch(e){
      console.error('map',e?.message||e);
      if(token!==placeToken)return;
      setText('layout-note',attempt?'Map unavailable, retrying…':'Map unavailable');
      if(demo)startFeed();
      await new Promise(r=>setTimeout(r,Math.min(300000,30000*(attempt+1))));
    }
  }
  startFeed();
}

// A search result: show what matched before using it.
function confirmPlace(place){
  pending=place;
  setText('confirm-label','Use this location?');
  setText('confirm-main',place.street||placeLabel(place));
  setText('confirm-sub',place.street?placeLabel(place):[place.admin,place.country].filter(Boolean).join(', '));
  setText('confirm-note',place.source==='census'?'Matched by the US Census geocoder.':place.source==='nominatim'?'Matched by OpenStreetMap Nominatim.':
    'Centre of the area that matched. Use Adjust position to move the dot onto your home.');
  open('confirm','confirm-ok');
}
let pending=null;

function choosePlace(place){
  const changed=!settings.place||Math.abs(settings.place.latitude-place.latitude)>.001||Math.abs(settings.place.longitude-place.longitude)>.001;
  settings={...settings,place,confirmed:true};saveSettings(settings);useSettings(settings);
  closeAll();
  if(changed)applyPlace(place,{fresh:true});else refreshLayout();
}
function refreshLayout(){try{active?.mod.refresh?.();}catch(e){console.error(e);}if(lastModel)draw(lastModel);}

// --- Focus and remote navigation
let layer=null,focused=null;
const layers=[];
function setFocus(el){focused?.classList.remove('focus');focused=el||null;focused?.classList.add('focus');}
// Focus must always be on something visible in the top screen.
function keepFocus(fallback){
  if(!layer||(focused&&layer.contains(focused)&&focused.offsetParent))return;
  setFocus((fallback&&layer.contains(fallback)?fallback:null)||focusables()[0]);
}
const focusables=()=>layer?[...layer.querySelectorAll('[data-focus]')].filter(el=>el.offsetParent):[];
function open(id,first){
  if(layer){layer._last=focused;layers.push(layer);}
  layer=$(id);layer.hidden=false;
  // Stack order follows opening order, not page order: a later screen must cover an earlier one.
  layer.style.zIndex=String(10+layers.length);setFocus(first?$(first):focusables()[0]);syncApp();
}
function close(){
  if(!layer)return;
  if(layer.id==='locate'&&!settings.place)return; // nothing to go back to
  if(layer.id==='picker')endPick(false);
  layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;
  if(layer){
    if(layer.id==='settings'){showSettings();setFocus($('set-layout'));}else{const last=layer._last;setFocus(last&&layer.contains(last)&&last.offsetParent?last:focusables()[0]);}
  }else setFocus(null);
  syncApp();
}
function closeAll(){while(layer){if(layer.id==='picker')endPick(false);layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;}setFocus(null);syncApp();}
// The app swallows Back only while a screen is open (and there's somewhere to go).
function syncApp(){tellApp({type:'ui',overlay:!!adj||!!layer&&!(layer.id==='locate'&&!settings.place&&!layers.length)});}

function move(dir){
  const items=focusables();
  if(!focused||!items.includes(focused))return setFocus(items[0]);
  const a=focused.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  let best=null,score=Infinity;
  for(const el of items){
    if(el===focused)continue;
    const b=el.getBoundingClientRect(),bx=b.left+b.width/2,by=b.top+b.height/2,dx=bx-ax,dy=by-ay;
    const main={left:-dx,right:dx,up:-dy,down:dy}[dir],side=dir==='left'||dir==='right'?Math.abs(dy):Math.abs(dx);
    if(main<=4)continue;
    const s=main+side*2.5;
    if(s<score){score=s;best=el;}
  }
  if(best)setFocus(best);
}

// Settings
const RADII=[1,2,3,4,5,6,7,8,9,10];
function showSettings(){
  const i=LAYOUTS.findIndex(([k])=>k===settings.layout);
  setText('set-layout-v',`${i+1}. ${layoutName(settings.layout)}`);
  setText('set-location-v',settings.place?[settings.place.street,placeLabel(settings.place)].filter(Boolean).join(', '):'Not set');
  const alert=alertFor(settings.radiusMiles,mapMiles());
  setText('set-radius-v',alert<settings.radiusMiles?`${fmt.dist(alert,0)} (the map radius)`:fmt.dist(settings.radiusMiles,0));
  setText('set-map-v',fmt.dist(mapMiles(),0));
  setText('set-distance-v',settings.distance==='km'?'Kilometres':'Miles');
  setText('set-altitude-v',settings.altitude==='m'?'Metres':'Feet');
  setText('set-awake-v',settings.keepAwake?'On':'Off');
  setText('set-chime-v',{off:'Off',low:'On · quiet',med:'On · medium',high:'On · loud'}[settings.chime]);
  const win=settings.alertZone==='window',bearing=d=>`${compass(d)} ${d}°`;
  setText('set-zone-v',win?'Window view':'All around');
  setText('set-from-v',bearing(settings.viewFrom));setText('set-to-v',bearing(settings.viewTo));
  setText('set-view-v',fmt.dist(settings.viewMiles,0));
  for(const r of document.querySelectorAll('#settings .row.win'))r.hidden=!win;
  $('set-radius').hidden=win;
}
function adjustSetting(el,dir){
  if(el.id==='set-layout')return startPick(dir);
  if(el.id==='set-radius')settings.radiusMiles=RADII[Math.max(0,Math.min(RADII.length-1,RADII.indexOf(settings.radiusMiles)+dir))];
  else if(el.id==='set-map')return stepMap(dir);
  else if(el.id==='set-distance')settings.distance=settings.distance==='km'?'mi':'km';
  else if(el.id==='set-altitude')settings.altitude=settings.altitude==='m'?'ft':'m';
  else if(el.id==='set-zone'){settings.alertZone=settings.alertZone==='window'?'circle':'window';store.remove(HISTORY_KEY);return zoneChanged();} // the old list was the other shape
  else if(el.id==='set-from'||el.id==='set-to'){const k=el.id==='set-from'?'viewFrom':'viewTo';settings[k]=((settings[k]+dir)%360+360)%360;return zoneChanged();}
  else if(el.id==='set-view'){settings.viewMiles=VIEW_MILES[Math.max(0,Math.min(VIEW_MILES.length-1,VIEW_MILES.indexOf(settings.viewMiles)+dir))];return zoneChanged();}
  else if(el.id==='set-chime'){
    const steps=['off','low','med','high'],i=steps.indexOf(settings.chime);
    settings.chime=steps[Math.max(0,Math.min(steps.length-1,i+dir))];saveSettings(settings);showSettings();
    if(settings.chime!=='off')tellApp({type:'chime',volume:CHIME_VOLUME[settings.chime]}); // a preview
    return;
  }
  else if(el.id==='set-awake'){settings.keepAwake=!settings.keepAwake;saveSettings(settings);showSettings();return tellAwake();}
  else return;
  saveSettings(settings);useSettings(settings);showSettings();
  if(el.id==='set-radius'&&settings.place){refreshLayout();applyPlace(settings.place);} // the feed's alert radius
  else refreshLayout();
}

// Alert zone changes redraw at once; the feed (which marks planes inside the zone and may
// need to reach further for Window distance) restarts after a short pause.
let zoneTimer=0;
function zoneChanged(){
  saveSettings(settings);useSettings(settings);showSettings();refreshLayout();
  if(lastModel)draw(lastModel);
  clearTimeout(zoneTimer);zoneTimer=setTimeout(()=>{if(settings.place)applyPlace(settings.place);},900);
}
// Window bearings: OK on the row to edit, then Left/Right 1°, Up/Down 10°, OK or Back to finish.
let editing=null;
function editKey(e){
  const k=e.key,dir={ArrowLeft:-1,ArrowRight:1,ArrowDown:-10,ArrowUp:10}[k];
  e.preventDefault();
  if(dir)return adjustSetting(editing,dir);
  if(k==='Enter'||k===' '||['Escape','GoBack','BrowserBack','Back'].includes(k)||e.keyCode===4)return stopEdit();
}
function stopEdit(){editing?.classList.remove('editing');editing=null;}

// Map radius: Settings > Map radius, or Up/Down on the dashboard. The view redraws at
// once (the current map, rescaled); the map for the new radius and the wider or
// narrower feed follow after a short pause, so stepping through sizes is cheap.
let mapTimer=0,toastTimer=0;
function stepMap(dir){
  const i=MAP_RADII.indexOf(mapMiles()),next=MAP_RADII[Math.max(0,Math.min(MAP_RADII.length-1,(i<0?2:i)+dir))];
  if(next===mapMiles())return toast(`Map radius ${fmt.dist(next,0)} (${dir<0?'closest':'widest'})`);
  settings.mapMiles=next;saveSettings(settings);useSettings(settings);
  if(layer?.id==='settings')showSettings();
  toast(`Map radius ${fmt.dist(next,0)}${alertFor(settings.radiusMiles,next)<settings.radiusMiles?` · alert ring ${fmt.dist(next,0)}`:''}`);
  if(maps.detail&&!detailFits(maps.detail,detailSpec(next)))maps.detail=null;
  mapsChanged();refreshLayout();
  clearTimeout(mapTimer);
  mapTimer=setTimeout(()=>{if(settings.place)applyPlace(settings.place);},700);
}
function toast(text){
  const t=$('toast');t.textContent=text;t.classList.add('on');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),1800);
}

// Layout picker: the dashboard behind the bar is the real layout, switched live.
let pick=null;
function startPick(dir){
  pick={index:Math.max(0,LAYOUTS.findIndex(([k])=>k===settings.layout))};
  stage.classList.add('picking');
  open('picker');setFocus(null);
  if(dir)stepPick(dir);else showPick();
}
function showPick(){
  setText('pick-count',`Layout ${pick.index+1} of ${LAYOUTS.length}`);
  setText('pick-name',LAYOUTS[pick.index][1]);
}
function stepPick(dir){
  pick.index=(pick.index+dir+LAYOUTS.length)%LAYOUTS.length;showPick();
  const btn=$(dir<0?'pick-prev':'pick-next');btn.classList.add('focus');setTimeout(()=>btn.classList.remove('focus'),180);
  useLayout(LAYOUTS[pick.index][0]);
}
// keep: save the previewed layout; else go back to the saved one.
function endPick(keep){
  if(!pick)return;
  const id=LAYOUTS[pick.index][0];pick=null;stage.classList.remove('picking');
  if(keep){settings.layout=id;saveSettings(settings);useLayout(id);}
  else useLayout(settings.layout);
}

// Location entry: an on-screen keyboard for the remote, plus results to pick.
const KEYS=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ,-1234567890'.split(''),['Space','space w2'],['Delete','del w2'],['Clear','clear w3'],['Search','search w4']];
let entry='',searchTimer=null,searchSeq=0;
function buildKeys(){
  $('keys').replaceChildren(...KEYS.map(k=>{
    const [label,cls]=Array.isArray(k)?k:[k,''];
    const b=document.createElement('button');b.textContent=label;b.dataset.focus='';b.dataset.key=Array.isArray(k)?cls.split(' ')[0]:k;
    if(cls)b.className=cls.split(' ').slice(1).join(' ');return b;
  }));
}
function typeKey(key){
  if(key==='space')entry+=entry&&!entry.endsWith(' ')?' ':'';
  else if(key==='del')entry=entry.slice(0,-1);
  else if(key==='clear')entry='';
  else if(key==='search')return runSearch(true);
  else if(entry.length<40)entry+=key;
  setText('entry-text',entry);
  clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,900);
}
// ZIP/city searches run as you type; street addresses only on Search (one geocoder
// request per search, as Nominatim's usage policy asks). Every search ends in results,
// "no match", or an error with Retry; focus never falls off the screen.
const SEARCH_LIMIT_MS=25000;
async function runSearch(explicit=false){
  clearTimeout(searchTimer);
  const q=entry.trim(),seq=++searchSeq,box=$('results'),searchKey=$('keys').querySelector('[data-key="search"]');
  const show=(...nodes)=>{box.replaceChildren(...nodes);keepFocus(searchKey);};
  const msg=(text,cls='msg')=>Object.assign(document.createElement('div'),{className:cls,textContent:text});
  const retry=()=>{const b=document.createElement('button');b.dataset.focus='';b.id='search-retry';b.className='retry';b.textContent='Try again';return b;};
  if(q.length<2){
    if(explicit)show(msg('Type a ZIP or postal code, a city, or a street address first.'));else show();
    return;
  }
  const address=looksLikeAddress(q);
  if(address&&!explicit)return show(msg('Street address: press Search when done.'));
  show(msg(`Searching for “${q}”…`,'msg busy'));
  const elsewhere=settings.place?.countryCode&&settings.place.countryCode!=='US'&&settings.place.source!=='ip';
  const work=(async()=>{
    let found=address?await searchAddress(q,{skipCensus:elsewhere}):await searchPlaces(q);
    // Postcodes Open-Meteo doesn't know (e.g. UK "SW1A 2AA"): try the address geocoders once.
    if(!address&&explicit&&found&&!found.length)found=await searchAddress(q,{skipCensus:elsewhere});
    return found;
  })().catch(e=>{console.error('search',e?.message||e);return null;});
  const found=await Promise.race([work,new Promise(r=>setTimeout(()=>r('timeout'),SEARCH_LIMIT_MS))]);
  if(seq!==searchSeq||layer?.id!=='locate'&&!layers.some(l=>l.id==='locate'))return;
  lastQuery=q;
  if(found==='timeout'||!found){
    show(msg(found?'The search is taking too long.':'Search is unavailable. Check the connection.'),retry());
    if(explicit&&layer?.id==='locate')setFocus($('search-retry'));
    return;
  }
  if(!found.length)return show(msg(`No places match “${q}”. Check the spelling, or try a ZIP or postal code.`));
  show(...found.slice(0,5).map(p=>{
    const b=document.createElement('button');b.dataset.focus='';
    b.append(p.street||placeLabel(p),Object.assign(document.createElement('small'),{textContent:p.street?placeLabel(p):[p.admin,p.country].filter(Boolean).join(', ')}));
    b._place=p;return b;
  }));
  // After Search, go to the first match; while typing, stay on the keyboard.
  if(explicit&&layer?.id==='locate')setFocus(box.firstElementChild);
}
let lastQuery='';
function openLocate(help){
  entry='';setText('entry-text','');$('results').replaceChildren();
  setText('entry-help',help||'Type a ZIP or postal code, a city, or your street address, then Search.');
  open('locate');
}

function select(el){
  if(!el)return;
  if(el.dataset.edit!==undefined){editing=el;el.classList.add('editing');return;}
  if(el._place)return confirmPlace(el._place);
  if(el.dataset.key)return typeKey(el.dataset.key);
  switch(el.id){
    case 'welcome-ok':settings.confirmed=true;saveSettings(settings);return close();
    case 'welcome-change':return openLocate();
    case 'set-layout':return startPick(0);
    case 'set-location':return openLocate();
    case 'set-adjust':return startAdjust(settings.place);
    case 'confirm-ok':return choosePlace(pending);
    case 'confirm-adjust':return startAdjust(pending);
    case 'confirm-again':return close();
    case 'set-done':return close();
    case 'pick-prev':return stepPick(-1);
    case 'pick-next':return stepPick(1);
    case 'search-retry':entry=lastQuery||entry;setText('entry-text',entry);setFocus($('keys').querySelector('[data-key="search"]'));return runSearch(true);
    default:if(el.dataset.adjust!==undefined)adjustSetting(el,1);
  }
}

let lastBack=0;
function back(){
  if(editing)return stopEdit();
  const now=Date.now();if(now-lastBack<350)return;lastBack=now; // the app and the page may both report one press
  if(adj)return endAdjust();
  close();
}
window.__whatsupBack=back;

// --- Adjust position: a close-up street map (OpenFreeMap z13, about 1 mi around) and
// a fixed centre dot; the remote's arrows move the map under it, ~50 m a press,
// faster while held. OK saves, Back cancels. Always drawn in the green scope style.
const ADJ_RANGE=1,STEP_M=50,ACX=270,ACY=270,AR=250;
const ADJ_MAP=[
  {layer:'water',fill:'rgba(61,255,116,.15)'},
  {layer:'rivers',stroke:'rgba(61,255,116,.3)',width:1.4},
  {layer:'roads',not:['motorway','trunk','primary','secondary'],stroke:'rgba(61,255,116,.32)',width:1},
  {layer:'roads',classes:['motorway','trunk','primary','secondary'],stroke:'rgba(61,255,116,.55)',width:2},
  {layer:'runways',stroke:'rgba(61,255,116,.85)',width:2.4},
];
let adj=null;
async function startAdjust(place){
  if(!place)return;
  closeAll();
  adj={place,latitude:place.latitude,longitude:place.longitude,map:null,held:0,canvas:makeCanvas(540,540)};
  $('adjust-map').replaceChildren(adj.canvas);
  stage.classList.add('adjusting');
  drawAdjust();syncApp();
  setText('adjust-note','Loading street map…');
  try{
    const m=await buildMap(place,ADJ_RANGE+.5,{zoom:13,detail:true});
    if(adj?.place===place){adj.map=m;setText('adjust-note','');drawAdjust();}
  }catch(e){console.error('adjust map',e?.message||e);if(adj)setText('adjust-note','Street map unavailable');}
}
function drawAdjust(){
  const c={latitude:adj.latitude,longitude:adj.longitude},ppm=AR/ADJ_RANGE;
  paintMap(adj.canvas,{base:adj.map||maps.base},{cx:ACX,cy:ACY,ppm,clip:{r:AR},center:c,fixed:true},ADJ_MAP);
  const nodes=[svg('circle',{class:'ring edge',cx:ACX,cy:ACY,r:AR})];
  for(const f of [.25,.5,.75])nodes.push(svg('circle',{class:'ring',cx:ACX,cy:ACY,r:AR*f}));
  nodes.push(svg('line',{class:'cross',x1:ACX-26,y1:ACY,x2:ACX+26,y2:ACY}),svg('line',{class:'cross',x1:ACX,y1:ACY-26,x2:ACX,y2:ACY+26}),
    svg('circle',{class:'home-dot',cx:ACX,cy:ACY,r:6}));
  const m100=100/1609.344*ppm;
  nodes.push(svg('line',{class:'scale',x1:500-m100,y1:40,x2:500,y2:40}),svg('text',{class:'label',x:500,y:32,'text-anchor':'end'},'100 m'),
    svg('text',{class:'label',x:528,y:528,'text-anchor':'end'},'Rings 400 m'));
  $('adjust-marks').replaceChildren(...nodes);
  const dy=(adj.latitude-adj.place.latitude)*111320,dx=(adj.longitude-adj.place.longitude)*111320*Math.cos(adj.place.latitude*Math.PI/180);
  const moved=Math.hypot(dx,dy);
  setText('adjust-moved',moved<1?'Not moved yet':`Moved ${moved>=1000?(moved/1000).toFixed(2)+' km':Math.round(moved)+' m'} ${compass((Math.atan2(dx,dy)*180/Math.PI+360)%360)}`);
  setText('adjust-where',adj.place.street||placeLabel(adj.place));
}
function nudge(dir,held){
  adj.held=held?adj.held+1:0;
  const step=STEP_M*(held?Math.min(8,1+adj.held/3):1),cos=Math.cos(adj.latitude*Math.PI/180);
  const [e,n]={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]}[dir];
  adj.latitude+=n*step/111320;adj.longitude+=e*step/(111320*cos);
  drawAdjust();
}
function endAdjust(save=false){
  const a=adj;adj=null;stage.classList.remove('adjusting');setText('adjust-note','');$('adjust-map').replaceChildren();
  if(save){
    const moved=Math.abs(a.latitude-a.place.latitude)+Math.abs(a.longitude-a.place.longitude)>1e-7;
    choosePlace({...a.place,latitude:a.latitude,longitude:a.longitude,accuracyKm:moved?.05:a.place.accuracyKm,
      source:moved?'adjusted':a.place.source});
  }
  if(lastModel)draw(lastModel);syncApp();
}

const DIRS={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
document.addEventListener('keydown',e=>{
  const k=e.key,dir=DIRS[k];
  if(['Escape','GoBack','BrowserBack','Back'].includes(k)||e.keyCode===4){e.preventDefault();return back();}
  if(adj){
    if(dir){e.preventDefault();return nudge(dir,e.repeat);}
    if(k==='Enter'||k===' '){e.preventDefault();return endAdjust(true);}
    return;
  }
  if(!layer){
    // Up/Down on the dashboard: zoom the map in/out (Settings > Map radius).
    if(dir==='up'||dir==='down'){e.preventDefault();return stepMap(dir==='up'?-1:1);}
    if(k==='Enter'||k===' '||k==='ContextMenu'||k==='Menu'||e.keyCode===82){e.preventDefault();showSettings();open('settings');}
    return;
  }
  if(editing)return editKey(e);
  if(layer.id==='picker'){
    e.preventDefault();
    if(dir==='left'||dir==='up')return stepPick(-1);
    if(dir==='right'||dir==='down')return stepPick(1);
    if(k==='Enter'||k===' '){endPick(true);return close();}
    return;
  }
  if(dir){
    e.preventDefault();
    if((dir==='left'||dir==='right')&&focused?.dataset.adjust!==undefined)return adjustSetting(focused,dir==='left'?-1:1);
    return move(dir);
  }
  if(k==='Enter'||k===' '&&layer.id!=='locate'){e.preventDefault();return select(focused);}
  if(layer.id==='locate'){
    if(k==='Backspace'){e.preventDefault();return typeKey('del');}
    if(k===' '){e.preventDefault();return typeKey('space');}
    if(/^[a-z0-9,\-'.]$/i.test(k)){e.preventDefault();return typeKey(k.toUpperCase());}
  }
});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&layer?.contains(b)){setFocus(b);select(b);}});

// First launch: the IP guess, said plainly.
function showWelcome(place){
  setText('welcome-city',placeLabel(place));
  const acc=place.accuracyKm;
  setText('welcome-note',`A first guess from your internet connection${acc?` (the lookup claims within ${settings.distance==='km'?`${acc} km`:`${Math.round(acc*.621)||1} mi`})`:''}. `+
    'Internet locations are often off by 10 miles or more, so enter your ZIP or street address for a sky that matches your window.');
  open('welcome','welcome-change');
}

// --- Boot
async function boot(){
  buildKeys();
  tellAwake();
  if(query.get('reset')==='1'){saveSettings({});settings=loadSettings();}
  if(query.get('units')==='metric'){settings.distance='km';settings.altitude='m';}
  // Screenshot hook: ?window=90-180-25 sets a Window view zone (from-to-miles) for this launch.
  const w=/^(\d{1,3})-(\d{1,3})-(\d{1,3})$/.exec(query.get('window')||'');
  if(w)Object.assign(settings,{alertZone:'window',viewFrom:+w[1]%360,viewTo:+w[2]%360,viewMiles:VIEW_MILES.includes(+w[3])?+w[3]:25});
  // Screenshot hook: ?map=50 sets the map radius for this launch.
  if(MAP_RADII.includes(Number(query.get('map'))))settings.mapMiles=Number(query.get('map'));
  // Screenshot hook: ?layout=atlas shows that layout for this launch.
  if(query.get('layout'))settings.layout=validLayout(query.get('layout'));
  settings.layout=validLayout(settings.layout);
  useSettings(settings);
  // Dev/screenshot hook: ?q=London picks the first geocoding result.
  const q=query.get('q');
  if(q){const found=await searchPlaces(q);if(found?.[0]){settings.place=found[0];settings.confirmed=true;useSettings(settings);}}
  useLayout(settings.layout);
  if(settings.place){
    applyPlace(settings.place);
    if(!settings.confirmed)showWelcome(settings.place);
    // Screenshot hooks: ?screen=settings|picker|welcome|adjust, ?screen=locate&typed=CHICAGO
    const screen=query.get('screen');
    if(screen==='settings'){showSettings();open('settings');}
    if(screen==='picker'){showSettings();open('settings');startPick(0);}
    if(screen==='adjust')startAdjust(settings.place).then(()=>{for(let i=0;i<4;i++)nudge('right');nudge('up');});
    if(screen==='welcome')showWelcome({...settings.place,accuracyKm:5});
    if(screen==='locate'){showSettings();open('settings');openLocate();for(const c of (query.get('typed')||'').toUpperCase())typeKey(c===' '?'space':c);runSearch(true);setFocus($('keys').children[2]);}
    return;
  }
  setText('layout-note','Finding your location…');
  const place=await locateByIp();
  setText('layout-note','');
  if(!place)return openLocate('We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.');
  settings={...settings,place,confirmed:false};saveSettings(settings);useSettings(settings);
  applyPlace(place,{fresh:true});
  showWelcome(place);
  setTimeout(()=>{if(layer?.id==='welcome')close();},60000);
}
boot();

return {};
})();
})();
