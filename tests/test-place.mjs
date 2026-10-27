// Geocoding parsing, address detection, settings and unit formatting. The network is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import {searchPlaces,searchAddress,looksLikeAddress,locateByIp,loadSettings,placeLabel} from '../web/place.mjs';
import {useSettings,fmt} from '../web/kit.mjs';

// fetch stub: url pattern -> [status, body]. Unmatched URLs fail like a dropped connection.
function stub(routes){
  const seen=[];
  globalThis.fetch=async url=>{
    seen.push(url);
    for(const [pattern,[status,body]] of routes)if(pattern.test(url))
      return {status,text:async()=>typeof body==='string'?body:JSON.stringify(body)};
    throw new TypeError('network down');
  };
  return seen;
}
const meteo=(...results)=>[/geocoding-api\.open-meteo/,[200,{results}]];
const CHICAGO={name:'Chicago',admin1:'Illinois',country:'United States',country_code:'US',latitude:41.85,longitude:-87.65,timezone:'America/Chicago',elevation:180};

test('city search: Open-Meteo results become places, biggest first, with labels',async()=>{
  stub([meteo(CHICAGO,{name:'Chicago Heights',admin1:'Illinois',country:'United States',country_code:'US',latitude:41.5,longitude:-87.6,timezone:'America/Chicago'})]);
  const found=await searchPlaces('Chicago');
  assert.equal(found.length,2);
  assert.equal(placeLabel(found[0]),'Chicago, IL');
  assert.equal(found[0].timeZone,'America/Chicago');
});
test('city search: no results is [], a failure is null, one letter is []',async()=>{
  stub([[/geocoding-api/,[200,{}]]]);
  assert.deepEqual(await searchPlaces('Xqzzyv'),[]);
  stub([[/geocoding-api/,[503,'']]]);
  assert.equal(await searchPlaces('Chicago'),null);
  stub([]);
  assert.equal(await searchPlaces('Chicago'),null);
  assert.deepEqual(await searchPlaces('C'),[]);
});
test('city search: bad coordinates and unknown time zones are dropped or defaulted',async()=>{
  stub([meteo({name:'Nowhere',latitude:'x',longitude:2},{name:'Odd',latitude:10,longitude:20,timezone:'Mars/Olympus'})]);
  const found=await searchPlaces('somewhere');
  assert.equal(found.length,1);
  assert.equal(found[0].timeZone,'UTC');
});
test('address detection: house number then words; ZIPs and cities are not addresses',()=>{
  assert.ok(looksLikeAddress('123 Main St Cincinnati OH'));
  assert.ok(looksLikeAddress('10 Downing Street'));
  for(const q of ['45202','45202-1234','Chicago','SW1A 2AA',''])assert.ok(!looksLikeAddress(q),q);
});
test('address search: Census match first, with its time zone looked up',async()=>{
  const seen=stub([
    [/geocoding\.geo\.census\.gov/,[200,{result:{addressMatches:[{matchedAddress:'801 PLUM ST, CINCINNATI, OH, 45202',
      addressComponents:{city:'CINCINNATI',state:'OH'},coordinates:{x:-84.6694,y:39.0550}}]}}]],
    [/api\.open-meteo\.com\/v1\/forecast/,[200,{timezone:'America/New_York',elevation:150}]],
  ]);
  const [p]=await searchAddress('801 Plum St Cincinnati OH');
  assert.equal(p.street,'801 Plum St');
  assert.equal(placeLabel(p),'Cincinnati, OH');
  assert.equal(p.source,'census');
  assert.ok(!seen.some(u=>/nominatim/.test(u)),'Nominatim not asked when Census matched');
  assert.ok(seen.some(u=>/latitude=39\.0[56]&longitude=-84\.67/.test(u)),'time zone lookup gets rounded coordinates only');
});
test('address search: falls back to Nominatim; both failing is null, no match is []',async()=>{
  stub([
    [/census/,[200,{result:{addressMatches:[]}}]],
    [/nominatim/,[200,[{lat:'51.5034',lon:'-0.1276',name:'10',address:{house_number:'10',road:'Downing Street',city:'London',state:'England',country:'United Kingdom',country_code:'gb'}}]]],
    [/forecast/,[200,{timezone:'Europe/London'}]],
  ]);
  const [p]=await searchAddress('10 Downing Street London');
  assert.equal(p.street,'10 Downing Street');
  assert.equal(placeLabel(p),'London, UK');
  assert.equal(p.timeZone,'Europe/London');
  stub([[/census/,[200,{result:{addressMatches:[]}}]],[/nominatim/,[200,[]]]]);
  assert.deepEqual(await searchAddress('1 Nowhere Lane'),[]);
  stub([]);
  assert.equal(await searchAddress('1 Nowhere Lane'),null);
});
test('IP location: GeoJS reply becomes an unconfirmed guess with its accuracy',async()=>{
  stub([[/geojs/,[200,{city:'Cincinnati',region:'Ohio',country:'United States',country_code:'US',latitude:'39.05',longitude:'-84.65',timezone:'America/New_York',accuracy:20}]]]);
  const p=await locateByIp();
  assert.equal(placeLabel(p),'Cincinnati, OH');
  assert.equal(p.accuracyKm,20);
  stub([]);
  assert.equal(await locateByIp(),null);
});
test('settings: bad saved values fall back to safe defaults',()=>{
  globalThis.localStorage={getItem:()=>JSON.stringify({radiusMiles:99,distance:'parsecs',altitude:'m',layout:'<script>'}),setItem(){},removeItem(){}};
  const s=loadSettings();
  assert.equal(s.radiusMiles,10);assert.equal(s.distance,'mi');assert.equal(s.altitude,'m');assert.equal(s.layout,'radar');
  delete globalThis.localStorage;
});
test('units: miles/knots/feet and km/km-h/metres, flight levels above 18,000 ft',()=>{
  useSettings({distance:'mi',altitude:'ft'});
  assert.equal(fmt.dist(2.345),'2.3 mi');assert.equal(fmt.speed(400),'400 kt');assert.equal(fmt.alt(35000),'FL350');
  useSettings({distance:'km',altitude:'m'});
  assert.equal(fmt.dist(1),'1.6 km');assert.equal(fmt.speed(100),'185 km/h');assert.match(fmt.alt(10000),/^3,?048 m$/);
  assert.equal(fmt.dist(undefined),'—');
});
