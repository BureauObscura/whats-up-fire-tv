// node --test tests/  — What's Up: place labels, cargo brands, map building from a real tile.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {placeLabel} from '../web/place.mjs';
import {cargoBrand,cargoCounts} from '../web/model.mjs';

test('place labels read like "City, ST" in the US and Canada, else the country',()=>{
  assert.equal(placeLabel({name:'Cincinnati',admin:'Ohio',countryCode:'US',country:'United States'}),'Cincinnati, OH');
  assert.equal(placeLabel({name:'Toronto',admin:'Ontario',countryCode:'CA',country:'Canada'}),'Toronto, ON');
  assert.equal(placeLabel({name:'London',admin:'England',countryCode:'GB',country:'United Kingdom'}),'London, UK');
  assert.equal(placeLabel({name:'Lyon',admin:'Auvergne-Rhône-Alpes',countryCode:'FR',country:'France'}),'Lyon, France');
  assert.equal(placeLabel({name:'Kuala Lumpur',countryCode:'MY',country:'Malaysia'}),'Kuala Lumpur, Malaysia');
});

test('cargo brands come from callsign prefixes worldwide, Amazon from the owner',()=>{
  assert.equal(cargoBrand('FDX1234',''),'FedEx');
  assert.equal(cargoBrand('UPS2925',''),'UPS');
  assert.equal(cargoBrand('BCS714',''),'DHL');
  assert.equal(cargoBrand('DHK283',''),'DHL');
  assert.equal(cargoBrand('CLX795',''),'Cargolux');
  assert.equal(cargoBrand('CJT487',''),'Cargojet');
  assert.equal(cargoBrand('ATN3417','AMAZON.COM SERVICES LLC'),'Amazon');
  assert.equal(cargoBrand('ATN3417',''),'ATI');
  assert.equal(cargoBrand('UAL2631','UNITED AIRLINES INC'),'');
  assert.deepEqual(cargoCounts({a:'UPS',b:'FedEx',c:'UPS'}),[['UPS',2],['FedEx',1]]);
});

test('map: rings survive simplification and the layers we draw are kept',async()=>{
  // A real OpenFreeMap z10 tile (Cincinnati, CVG) saved as a fixture, served to buildMap.
  const tile=readFileSync(new URL('./fixtures/cincinnati-10-271-391.pbf',import.meta.url));
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const {buildMap}=await import('../web/mapgen.mjs');
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}}),
    getBytes:async url=>url.endsWith('/10/271/391.pbf')?new Uint8Array(tile):null};
  const m=await buildMap({latitude:39.10,longitude:-84.41},10,{net,MVT:{VectorTile,Pbf}});
  assert.ok(m.water.length>0&&m.water.every(r=>r.length>=4),'water rings');
  assert.ok(m.runways.length>0,'runways');
  assert.ok(m.roads.some(r=>r.major),'motorways');
  assert.ok(m.airports.some(a=>a.iata==='CVG')&&m.airports.some(a=>a.iata==='LUK'),'airports from the tile');
  assert.equal(m.airports[0].iata,'CVG');
});

test('map: place names, and the detail map round-trips through its saved form',async()=>{
  const tile=readFileSync(new URL('./fixtures/cincinnati-10-271-391.pbf',import.meta.url));
  const {VectorTile}=await import('../vendor/node_modules/@mapbox/vector-tile/index.js');
  const {default:Pbf}=await import('../vendor/node_modules/pbf/index.js');
  const {buildMap,buildDetail,decodeDetail}=await import('../web/mapgen.mjs');
  const net={getJson:async()=>({status:200,payload:{tiles:['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf']}}),
    getBytes:async url=>url.endsWith('/10/271/391.pbf')?new Uint8Array(tile):null};
  const home={latitude:39.10,longitude:-84.41};
  const m=await buildMap(home,10,{net,MVT:{VectorTile,Pbf}});
  assert.ok(m.places.some(p=>p.name==='Cincinnati'),'town names');
  assert.ok(m.roads.every(r=>r.c),'road classes');
  // Serve the same tile for every detail request: enough to exercise decoding and the encoding.
  const any={...net,getBytes:async()=>new Uint8Array(tile)};
  const saved=await buildDetail(home,{net:any,MVT:{VectorTile,Pbf},range:3,buildings:0});
  assert.equal(typeof saved.roads[0].p,'string');
  const d=decodeDetail(JSON.parse(JSON.stringify(saved)));
  assert.ok(d.roads.length&&d.roads.every(r=>r.p instanceof Int16Array&&r.p.length>=4),'roads decode');
  assert.ok(d.water.every(w=>w.r instanceof Int16Array&&w.r.length>=8),'water rings decode');
  assert.ok(d.roads.every(r=>r.p.every(v=>Math.abs(v)<=32000)),'coordinates (1/1000 mi) fit Int16');
});
test('aircraft silhouettes: family from the type designator, else the category',async()=>{
  const {silhouetteFamily:f,SILHOUETTES}=await import('../web/silhouettes.mjs');
  const want={A320:'narrow',B38M:'narrow',B789:'wide',A359:'wide',B744:'quad',A124:'quad',CRJ9:'regional',E75L:'regional',
    AT76:'turboprop',DH8D:'turboprop',C56X:'bizjet',C172:'single',PA28:'single',EC45:'heli',C130:'military',C17:'military'};
  for(const [t,fam] of Object.entries(want))assert.equal(f({aircraft_type:t}),fam,t);
  assert.equal(f({category:'A7'}),'heli');assert.equal(f({}),'narrow');
  for(const fam of new Set(Object.values(want)))assert.ok(SILHOUETTES[fam]);
});
test('photos: Planespotters reply parsed, URLs kept unchanged, anything off-host rejected',async()=>{
  const {parsePhoto,PHOTO_URL}=await import('../web/photos.mjs');
  const ok={photos:[{thumbnail:{src:'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_t.jpg',size:{width:200,height:133}},
    thumbnail_large:{src:'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_280.jpg',size:{width:420,height:280}},
    link:'https://www.planespotters.net/photo/1987982/n27270?utm_source=api',photographer:'John Robert Murdoch'}]};
  const p=parsePhoto(ok);
  assert.equal(p.src,'https://t.plnspttrs.net/06912/1987982_fe0fcc4132_280.jpg');
  assert.equal(p.link,'https://www.planespotters.net/photo/1987982/n27270?utm_source=api');
  assert.equal(p.photographer,'John Robert Murdoch');
  assert.equal(parsePhoto({photos:[]}),null);
  assert.equal(parsePhoto({photos:[{...ok.photos[0],thumbnail_large:{src:'https://evil.example/x.jpg'},thumbnail:{src:'https://evil.example/y.jpg'}}]}),null);
  assert.equal(parsePhoto({photos:[{...ok.photos[0],link:'javascript:alert(1)'}]}),null);
  assert.equal(PHOTO_URL('hex','a2b150'),'https://api.planespotters.net/pub/photos/hex/a2b150');
});
test('model photos: bundled per ICAO type with author and license, files present',async()=>{
  const {MODELS,modelPhoto}=await import('../web/models.mjs');
  const {existsSync}=await import('node:fs');
  assert.ok(Object.keys(MODELS).length>=90);
  for(const [t,m] of Object.entries(MODELS)){
    assert.ok(m.author&&m.license&&!/SA/i.test(m.license),t);
    assert.ok(existsSync(new URL(`../web/models/${t}.jpg`,import.meta.url)),t);
  }
  assert.equal(modelPhoto({aircraft_type:'b763'}).src,'models/B763.jpg');
  assert.equal(modelPhoto({aircraft_type:'ZZZZ'}),null);
});
test('logbook: Rarest and Farthest count planes in the alert zone, Seen counts the local area',async()=>{
  const {updateLog,logSummary}=await import('../web/model.mjs');
  const p=(hex,type,mi,inside,from)=>({hex,aircraft_type:type,distance_mi:mi,inside,flight:hex.toUpperCase(),altitude_ft:30000,speed_kt:400,
    route:from?{origin:from.code,from:{city:from.city,lat:from.lat,lon:from.lon}}:null});
  const now=Date.UTC(2026,9,28,12);
  let log=updateLog({day:new Date(now).toLocaleDateString('en-CA',{timeZone:'UTC'}),seen:[],highest:null,fastest:null,typesToday:[],typesZone:[],
    typesAll:{A124:5,C172:1,B738:0},cargo:{night:null,seen:{}}},[p('aaa001','B738',5,false),p('aaa002','A124',22,true,{code:'FRA',city:'Frankfurt',lat:50.03,lon:8.57}),
    p('aaa003','C172',3,true,{code:'LUK',city:'Near home',lat:0.1,lon:0.1})],now);
  const s=logSummary(log);
  assert.equal(s.today,2,'Seen: the 22 mi plane is outside the local area');
  assert.equal(s.rarest.code,'C172','Rarest: fewest seen of the zone types; B738 (fewest overall) was not in the zone');
  assert.equal(s.farthest.name,'AAA002','Farthest counts the zone plane beyond the local area');
});
