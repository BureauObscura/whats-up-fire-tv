// The display model: live aircraft (live.mjs: adsb.fi + ADSB.lol routes) enriched
// with operator, cargo brand, look-up angles, closest approach, trend and a daily
// logbook. ?demo=1 makes a synthetic sky around whatever home is set (&scene=emergency:
// a 7700 squawk; &scene=quiet: nothing in range; &scene=long: long names everywhere, to check nothing is cut off).
import {IDS,airspace,recentSightings,number} from './core.mjs';
import {RouteLookup} from './routes.mjs';
import {startLive,haversine,store} from './live.mjs';
import {AIRCRAFT_TYPES} from './aircraft-types.mjs';

export const query=new URLSearchParams(typeof location!=='undefined'?location.search:'');
export const demo=query.get('demo')==='1',scene=query.get('scene')||'';
let HOME={latitude:0,longitude:0,elevationFt:0},TZ='UTC';
export const tz=()=>TZ;

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
export function cargoBrand(callsign,owner){
  const op=(owner||'').toUpperCase(),call=(callsign||'').toUpperCase();
  if(op.includes('AMAZON')||op.includes('PRIME AIR'))return 'Amazon';
  if(/^[A-Z]{3}\d/.test(call)&&CARGO[call.slice(0,3)])return CARGO[call.slice(0,3)];
  if(op.includes('FEDERAL EXPRESS'))return 'FedEx';
  if(op.includes('UNITED PARCEL'))return 'UPS';
  if(/\bDHL\b/.test(op))return 'DHL';
  return '';
}
export const EMERGENCY={'7500':'HIJACK','7600':'RADIO FAILURE','7700':'EMERGENCY'};
const titleCase=s=>s.toLowerCase().replace(/[,.]?\s+(inc|co|llc|ltd|corp|corporation|company|plc|gmbh|sa|ag)\.?$/,'').replace(/\b(\w)/g,c=>c.toUpperCase());
export const typeName=code=>code?AIRCRAFT_TYPES[String(code).toUpperCase()]||code:'';
export const compass=deg=>['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'][Math.round(deg/22.5)%16];

// Miles east/north of home.
export function offset(lat,lon){
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
    cpa=t>0?{seconds:t,miles:Math.hypot(x+vx*t,y+vy*t)}:{seconds:0,miles:ground,receding:true};
  }
  return {x,y,ground,bearing,elevation,cpa};
}

// Logbook: per local day, saved. Rarest = today's type seen fewest times overall.
// Cargo "tonight" runs 18:00-06:00 local, counted per brand.
const LOG_KEY='whatsup.logbook.v1';
const localDay=t=>new Date(t).toLocaleDateString('en-CA',{timeZone:TZ});
const localHour=t=>Number(new Date(t).toLocaleString('en-US',{hour:'numeric',hourCycle:'h23',timeZone:TZ}));
const tonightKey=t=>{const h=localHour(t);return h>=18?localDay(t):h<6?localDay(t-86400000):null;};
export const resetLog=()=>store.remove(LOG_KEY);
function updateLog(log,planes,now){
  const day=localDay(now);
  if(!log||log.day!==day)log={day,seen:[],highest:null,fastest:null,typesToday:[],typesAll:log?.typesAll||{},cargo:log?.cargo||{night:null,seen:{}}};
  const night=tonightKey(now);
  if(log.cargo.night!==night||Array.isArray(log.cargo.seen))log.cargo={night,seen:{}};
  for(const a of planes){
    if(!log.seen.includes(a.hex)){
      log.seen.push(a.hex);if(log.seen.length>3000)log.seen.shift();
      if(a.aircraft_type){log.typesAll[a.aircraft_type]=(log.typesAll[a.aircraft_type]||0)+1;
        if(!log.typesToday.includes(a.aircraft_type))log.typesToday.push(a.aircraft_type);}
    }
    const name=a.flight;
    if(number(a.altitude_ft)&&(!log.highest||a.altitude_ft>log.highest.value))log.highest={name,value:a.altitude_ft};
    if(number(a.speed_kt)&&(!log.fastest||a.speed_kt>log.fastest.value))log.fastest={name,value:a.speed_kt};
    if(night&&a.cargo&&!log.cargo.seen[a.hex])log.cargo.seen[a.hex]=a.cargo;
    // Farthest: of the planes that came overhead (inside the alert ring), the longest trip
    // from their route's origin airport to here.
    const from=a.route?.from;
    if(a.inside&&from&&number(from.lat)&&number(from.lon)){
      const value=haversine(from.lat,from.lon,HOME.latitude,HOME.longitude);
      if(!log.farthest||value>log.farthest.value)log.farthest={name,value,from:from.city||a.route.origin,code:a.route.origin};
    }
  }
  return log;
}
export function cargoCounts(seen){
  const counts={};for(const brand of Object.values(seen||{}))counts[brand]=(counts[brand]||0)+1;
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function logSummary(log){
  if(!log)return {today:0,highest:null,fastest:null,farthest:null,rarest:null,cargoTonight:0,cargoBy:[],night:false};
  const rarest=log.typesToday.slice().sort((a,b)=>(log.typesAll[a]||0)-(log.typesAll[b]||0))[0];
  const cargoBy=cargoCounts(log.cargo.seen);
  return {today:log.seen.length,highest:log.highest,fastest:log.fastest,farthest:log.farthest||null,night:!!log.cargo.night,
    rarest:rarest?{code:rarest,name:typeName(rarest),count:log.typesAll[rarest]}:null,
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

// The hero: an emergency first, then the nearest inside the boundary, then the
// one arriving soonest, then the nearest.
function pickHero(planes,radius,range){
  const approaching=a=>a.cpa&&!a.cpa.receding&&a.cpa.miles<radius+1&&a.cpa.seconds<600&&a.ground<=range;
  const hero=planes.find(a=>a.emergency)||planes.find(a=>a.inside)||
    planes.filter(approaching).sort((a,b)=>a.cpa.seconds-b.cpa.seconds)[0]||planes[0]||null;
  if(hero)hero.status=hero.emergency?'Emergency':hero.inside?'Above you now':approaching(hero)?'Approaching':'Nearest';
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
    pruneSamples(now);
    // Today's logbook and cargo tonight count the same local area at every map radius
    // (the original 15 NM feed), so zooming out doesn't inflate them.
    if(fresh){log=updateLog(log,planes.filter(a=>a.distance_mi<=LOG_MILES),now);store.set(LOG_KEY,log);}
    const recent=recentSightings(states,planes.filter(a=>a.inside),now).map(a=>({...a,type:typeName(a.aircraft_type),
      route:routes.get(a),cargo:cargoBrand(a.callsign,''),flight:a.callsign||a.registration||a.hex.toUpperCase()}));
    onModel({now,live:true,fresh,connecting:!lastOk&&now-started<15000,planes,hero:pickHero(planes,config.radiusMiles,config.rangeMiles),recent,log:logSummary(log)});
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
      return enrich(a,raw,route?{...route,flight:callsign}:null,now);
    }).filter(a=>a.distance_mi<config.rangeMiles+3&&scene!=='quiet')
      .sort((a,b)=>Number(b.inside)-Number(a.inside)||a.distance_mi-b.distance_mi);
    const recent=recentRows.map(([hex,flight,code,route,mins])=>({hex,flight,callsign:flight,aircraft_type:code,
      type:typeName(code),route,cargo:cargoBrand(flight,flight.startsWith('ATN')?'AMAZON':''),last_seen:now/1000-mins*60}));
    onModel({now,live:false,fresh:true,planes,hero:pickHero(planes,config.radiusMiles,config.rangeMiles),recent,log});
  };
  tick();const timer=setInterval(tick,1000);
  return {stop(){clearInterval(timer);}};
}

// Start the feed for a place; returns {stop}.
export function start(place,config,onModel,airports){
  HOME={latitude:place.latitude,longitude:place.longitude,elevationFt:(place.elevationM||0)*3.2808};TZ=place.timeZone;
  samples.clear();
  const cfg={...config,latitude:place.latitude,longitude:place.longitude};
  return demo?demoSource(cfg,onModel,airports):liveSource(cfg,onModel);
}
