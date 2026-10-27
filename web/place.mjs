// Where the user is and how they like it shown. Saved on the device (localStorage).
// First launch: approximate location from the connection's IP (GeoJS, free, no key).
// "Change location": a ZIP/postcode or city name (Open-Meteo geocoding), or a street
// address (US Census geocoder for US addresses, else Nominatim). Exact coordinates stay
// on the device; the time-zone lookup and adsb.fi only see them rounded to 2 decimals.
import {getJson,store} from './live.mjs';
import {number} from './core.mjs';
import {CONFIG} from './config.js';

const KEY='whatsup.settings.v1';
export const IP_URL='https://get.geojs.io/v1/ip/geo.json';
export const SEARCH_URL=q=>`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
export const CENSUS_URL=q=>`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=json`;
export const NOMINATIM_URL=q=>`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=5&addressdetails=1`;
export const TZ_URL=(lat,lon)=>`https://api.open-meteo.com/v1/forecast?latitude=${Number(lat).toFixed(2)}&longitude=${Number(lon).toFixed(2)}&timezone=auto&forecast_days=1`;

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
export function placeLabel(p){
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

export function loadSettings(){
  const s=store.get(KEY)||{};
  return {place:s.place?makePlace(s.place):null,
    radiusMiles:Math.max(1,Math.min(10,Math.round(Number(s.radiusMiles))||CONFIG.radiusMiles)),
    distance:s.distance==='km'?'km':'mi',altitude:s.altitude==='m'?'m':'ft',confirmed:!!s.confirmed,
    layout:typeof s.layout==='string'&&/^[a-z-]{2,20}$/.test(s.layout)?s.layout:'radar'};
}
export const saveSettings=s=>store.set(KEY,s);

// Approximate place from the IP address. Null when the lookup fails.
export async function locateByIp(){
  const {status,payload:p}=await getJson(IP_URL,6000);
  if(status!==200||!p)return null;
  return makePlace({name:p.city,admin:p.region,country:p.country,countryCode:p.country_code,
    latitude:p.latitude,longitude:p.longitude,timeZone:p.timezone,source:'ip',accuracyKm:p.accuracy});
}

// ZIP/postcode or place name -> up to 6 places, biggest first.
export async function searchPlaces(query){
  const q=clean(query,60);
  if(q.length<2)return [];
  const {status,payload}=await getJson(SEARCH_URL(q),6000);
  if(status!==200||!Array.isArray(payload?.results))return status===200?[]:null;
  return payload.results.map(r=>makePlace({name:r.name,admin:r.admin1,country:r.country,countryCode:r.country_code,
    latitude:r.latitude,longitude:r.longitude,timeZone:r.timezone,elevationM:r.elevation,source:'search'})).filter(Boolean);
}

// "123 Main St ..." or "10 Downing Street": a house number, then words.
export const looksLikeAddress=q=>/^\d+[A-Z]?\s+[A-Z]/i.test(clean(q))&&!/^\d{5}(-\d{4})?$/.test(clean(q));
const title=s=>s.toLowerCase().replace(/\b([a-z])/g,c=>c.toUpperCase());

// Time zone and elevation for a geocoded address (rounded coordinates only).
async function addZone(p){
  const {status,payload}=await getJson(TZ_URL(p.latitude,p.longitude),6000);
  return makePlace({...p,timeZone:status===200?payload?.timezone:p.timeZone,elevationM:payload?.elevation});
}

// Street address -> matches. US Census first (US addresses; skipped when home is
// clearly elsewhere), then Nominatim: one request per search, never as you type.
export async function searchAddress(query,{skipCensus=false}={}){
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
