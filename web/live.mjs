// Standalone data source: builds the HA-shaped `states` the display already
// reads, from adsb.fi positions and ADSB.lol standing routes. Ports the
// selection/history template in home_assistant/packages/aircraft-package.yaml
// and the free (ADSB.lol) part of custom_components/office_aircraft_routes/model.py.
import {IDS,number,coordinates,inZone} from './core.mjs';

const HOUR=3600,SIX_HOURS=6*HOUR;
export const HISTORY_KEY='whatsup.history.v1',LEDGER_KEY='whatsup.ledger.v1';
// adsb.fi serves at most 250 NM around a point.
export const MAX_NM=250;
export const FEED_URL=(lat,lon,nm)=>`https://opendata.adsb.fi/api/v3/lat/${lat.toFixed(2)}/lon/${lon.toFixed(2)}/dist/${nm}`;
export const ROUTE_URL=call=>`https://vrs-standing-data.adsb.lol/routes/${call.slice(0,2)}/${call}.json`;
const HEX=/^[0-9a-f]{6}$/;

// --- Network: through the Vega app when present (adsb.fi sends no CORS header),
// otherwise the browser's own fetch. Resolves {status, payload}; never throws.
const pending=new Map();let nextRequest=0;
if(typeof window!=='undefined')window.__whatsupReply=(id,status,text)=>{
  const done=pending.get(id);if(done){pending.delete(id);done(status,text);}
};
export function getJson(url,timeoutMs=8000){
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
export async function getBytes(url,timeoutMs=10000){
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
export const store={
  get(k){try{const v=localStorage.getItem(k);if(v!==null)return JSON.parse(v);}catch{/* memory */}return memory.get(k)??null;},
  set(k,v){memory.set(k,v);try{localStorage.setItem(k,JSON.stringify(v));}catch{/* memory only */}},
  remove(k){memory.delete(k);try{localStorage.removeItem(k);}catch{/* memory only */}},
};

// --- Selection (aircraft-package.yaml template sensors).
const finite=(v,low=-Infinity,high=Infinity)=>number(v)&&v>=low&&v<=high;
const position=(lat,lon)=>finite(lat,-85,85)&&finite(lon,-180,180);
export function haversine(lat1,lon1,lat2,lon2){
  const r=Math.PI/180,p1=lat1*r,p2=lat2*r;
  const h=Math.sin((p2-p1)/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin((lon2-lon1)*r/2)**2;
  return 3958.7613*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}
export function feedStamp(body){
  const stamp=Number(body?.now)||0;
  return stamp>100000000000?stamp/1000:stamp;
}
// `radius`: miles (the circle), or a Window view zone {kind:'window',from,to,miles}.
export function selection(ac,stamp,home,radius,now){
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
export function mergeHistory(old,inside){
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
export const ident=v=>{const s=String(v||'').trim().toUpperCase();return /^[A-Z0-9-]{2,10}$/.test(s)?s:'';};
export function provider(a){
  const call=ident(a.callsign),reg=ident(a.registration);
  if(String(a.callsign||'').trim()&&!call)return null;
  if(reg&&(!call||call.replaceAll('-','')===reg.replaceAll('-','')))return 'flightaware';
  return /^[A-Z]{3}[0-9][A-Z0-9]{0,5}$/.test(call)?'adsblol':null;
}
const key=a=>`${a.hex}:${ident(a.callsign)||ident(a.registration)}`;

export function observations(raw,stamp,home,radius,history,now){
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
export function commercialRoute(payload,a,previous=null){
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
      if(error>100)continue;
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
export class Ledger {
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

export class Enricher {
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
export function startLive(onUpdate,config){
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
