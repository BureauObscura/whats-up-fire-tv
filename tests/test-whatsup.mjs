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
