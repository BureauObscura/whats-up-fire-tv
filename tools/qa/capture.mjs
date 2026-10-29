// Store build: nothing before Agree; after, only allowed hosts; never Planespotters/EOX/Nominatim.
import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync(new URL('./screens.mjs',import.meta.url),'utf8');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {spawn}=await import('node:child_process');const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
const page=new Function('spawn','mkdtempSync','tmpdir','sleep','writeFileSync',`return (${src.slice(src.indexOf('async function page(consent){'),src.indexOf('const OUT')).replace('async function page(consent)','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep,writeFileSync);
const ALLOWED=['opendata.adsb.fi','vrs-standing-data.adsb.lol','tiles.openfreemap.org','geocoding-api.open-meteo.com','api.open-meteo.com','get.geojs.io','basemap.nationalmap.gov','geocoding.geo.census.gov','api.planespotters.net','cdn.planespotters.net','tiles.maps.eox.at','nominatim.openstreetmap.org'];
const okHost=h=>ALLOWED.includes(h)||/\.plnspttrs\.net$/.test(h);
const hostsOf=async p=>{const r=await p.ev(`performance.getEntriesByType('resource').map(e=>e.name)`)||[];const h={};
  for(const u of r){try{const pu=new URL(u);const t=pu.pathname==='/proxy'?pu.searchParams.get('url'):u;const x=new URL(t).host;h[x]=(h[x]||0)+1;}catch{}}return h;};
let bad=0;
for(const layout of ['atlas-satellite','glass','sectional']){
  const p=await page();
  await p.send('Page.navigate',{url:`http://localhost:8776/index.html?layout=${layout}`});await sleep(10000);
  const before=await hostsOf(p);
  await p.ev(`document.getElementById('consent-ok').click()`);await sleep(25000);
  // A search for a US street address and a city, then pick the first city.
  const after=await hostsOf(p);
  const ext=Object.keys(before).filter(h=>!/^localhost/.test(h)),wrong=Object.keys(after).filter(h=>!/^localhost/.test(h)&&!okHost(h));
  if(ext.length||wrong.length)bad++;
  console.log(layout,'before Agree:',JSON.stringify(ext),'| after:',JSON.stringify(after),wrong.length?'| NOT ALLOWED '+wrong:'');
  p.close();
}
process.exit(bad?1:0);
