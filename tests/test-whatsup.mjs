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
test('logbook: Rarest and Farthest follow the map radius; Seen stays local',async()=>{
  const {updateLog,logSummary,setLogRadius,pickRarest,pickFarthest}=await import('../web/model.mjs');
  const p=(hex,type,mi,from)=>({hex,aircraft_type:type,distance_mi:mi,flight:hex.toUpperCase(),altitude_ft:30000,speed_kt:400,
    route:from?{origin:from.code,from:{city:from.city,lat:from.lat,lon:from.lon}}:null});
  const now=Date.UTC(2026,9,28,12),day=new Date(now).toLocaleDateString('en-CA',{timeZone:'UTC'});
  let log=updateLog({day,seen:[],highest:null,fastest:null,typesToday:[],typesAll:{A124:5,C172:9,B77W:0},cargo:{night:null,seen:{}}},
    [p('aaa001','C172',5,{code:'LUK',city:'Near',lat:.1,lon:.1}),p('aaa002','B77W',40,{code:'NGO',city:'Tokoname',lat:34.86,lon:136.8})],now);
  log=updateLog(log,[p('aaa002','B77W',30)],now); // closer later: closest approach kept, origin kept
  assert.equal(log.planes.aaa002.d,30);assert.equal(log.planes.aaa002.o.code,'NGO');
  assert.equal(pickRarest(log,15).code,'C172');assert.equal(pickRarest(log,50).code,'B77W');
  assert.equal(pickFarthest(log,15).name,'AAA001');assert.equal(pickFarthest(log,30).from,'Tokoname');
  let r=15;setLogRadius(()=>r);const s=logSummary(log);
  assert.equal(s.today,1,'Seen: only the local plane');
  assert.equal(s.rarest.code,'C172');r=50;assert.equal(s.rarest.code,'B77W','the summary follows a zoom at once');
  assert.equal(updateLog({day,seen:[],typesToday:['A388'],typesAll:{A388:1},cargo:{night:null,seen:{}}},[],now).planes['old-A388'].t,'A388','old logs keep today\'s types');
});
test('alert chime: first entry after a quiet minute only; no ring at launch, while occupied, on flicker or stale data',async()=>{
  const {chimeGate}=await import('../web/core.mjs');
  let s=null,r;const step=(n,t,fresh=true)=>{({state:s,ring:r}=chimeGate(s,n,t,fresh));return r;};
  assert.equal(step(1,0),false,'already occupied at launch');
  assert.equal(step(2,5000),false,'still occupied');
  assert.equal(step(0,10000),false);
  assert.equal(step(1,30000),false,'back after 20 s: flicker, no ring');
  assert.equal(step(0,40000),false);
  assert.equal(step(0,90000,false),false,'stale data changes nothing');
  assert.equal(step(1,101000),true,'first plane after 61 s empty');
  assert.equal(step(2,106000),false,'a second plane while one is inside');
  s=null;assert.equal(step(0,0),false);assert.equal(step(1,61000),true,'empty at launch, then a plane a minute later');
});
test('every built layout script and module parses (a syntax error silently keeps the old layout)',async()=>{
  const {execFileSync}=await import('node:child_process');
  const {readdirSync,readFileSync}=await import('node:fs');
  const vm=await import('node:vm');
  execFileSync(process.execPath,[new URL('../scripts/build-web.mjs',import.meta.url).pathname],{env:{...process.env,WHATSUP_OUT:'/tmp/whatsup-check'}});
  for(const f of readdirSync('/tmp/whatsup-check/layouts').filter(f=>f.endsWith('.js')))
    assert.doesNotThrow(()=>new vm.Script(readFileSync(`/tmp/whatsup-check/layouts/${f}`,'utf8'),{filename:f}),f);
  assert.doesNotThrow(()=>new vm.Script(readFileSync('/tmp/whatsup-check/whatsup.js','utf8')));
});
test('every screen sits inside the themed stage (so layouts can style it)',()=>{
  const s=readFileSync(new URL('../web/index.html',import.meta.url),'utf8');
  const i=s.indexOf('<div class="stage" id="stage">');let depth=0,end=-1;
  for(const m of s.slice(i).matchAll(/<div\b|<\/div>/g)){depth+=m[0]==='<div'?1:-1;if(!depth){end=i+m.index+m[0].length;break;}}
  const outside=s.slice(end);
  for(const id of ['settings','about','locate','confirm','picker','welcome','adjust-panel','toast','credit-flash'])
    assert.ok(!outside.includes(`id="${id}"`),`#${id} is outside the stage`);
});
