// Aircraft pictures for the hero card, best first:
// 1. a photo of that exact aircraft from Planespotters.net (by hex, else registration),
// 2. a bundled photo of the model (assets/models/, from Wikimedia Commons, models.mjs),
// 3. the drawn silhouette (silhouettes.mjs).
// Planespotters' API terms: credit the photographer next to the photo; link back with an
// on-screen QR code carrying the photo's link URL (no clickable surface on a TV); fetch the
// image straight from their URL on this device, keep it only while shown, never store it;
// URLs used unchanged; JSON may be cached up to 24 h; identify with a User-Agent (the app
// bridge sends one). Lookups are cached per aircraft for this session, misses too.
import {getJson} from './live.mjs';
import {modelPhoto} from './models.mjs';
export {modelPhoto};

export const PHOTO_URL=(kind,id)=>`https://api.planespotters.net/pub/photos/${kind}/${id}`;
const IMG=/^https:\/\/(cdn\.planespotters\.net|[a-z0-9-]+\.plnspttrs\.net)\/[^\s"'<>]+\.(jpe?g|png|webp)$/i;
const LINK=/^https:\/\/www\.planespotters\.net\/photo\/[^\s"'<>]+$/;
const cache=new Map(),DAY=86400000;

// A photo record {src,width,height,link,photographer} from an API reply, or null.
export function parsePhoto(payload){
  const p=Array.isArray(payload?.photos)?payload.photos[0]:null;
  const t=p?.thumbnail_large?.src?p.thumbnail_large:p?.thumbnail;
  if(!t||!IMG.test(String(t.src))||!LINK.test(String(p.link)))return null;
  const photographer=String(p.photographer||'').trim().slice(0,60);
  return {src:t.src,width:Number(t.size?.width)||0,height:Number(t.size?.height)||0,link:p.link,photographer};
}

// Resolves the photo for an aircraft, or null (none, failure, or slower than 3 s).
export function photoFor(a){
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

// QR code (PNG data URL) for a photo's link, drawn by the bundled encoder (qr.js) in the
// theme's colours: the darker of {ink, panel} for the modules, the lighter for the
// background (scanners want dark-on-light), with a 2-module light quiet zone (enough for phone scanners against a plain panel; more
// would only shrink the modules); see qrColours.
const rgb=c=>{const m=/^#([0-9a-f]{6})$/i.exec(c.trim())||null,r=/rgba?\(([^)]+)\)/.exec(c);
  if(m)return [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16));
  if(r){const [a,b,d,al=1]=r[1].split(',').map(Number);return [a*al,b*al,d*al];}return null;};
const lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
export function qrColours(ink,bg){
  const a=rgb(ink||''),b=rgb(bg||'');
  if(!a||!b)return {dark:'#000',light:'#fff'};
  let [dk,lt]=lum(a)<lum(b)?[a,b]:[b,a];
  // Keep the hues but push them apart (dark toward black, light toward white) until the
  // contrast is near print-like (14:1; black on white is 21:1), which phone cameras need at
  // a distance and through blur.
  for(let t=0;t<=1&&(lum(lt)+.05)/(lum(dk)+.05)<14;t+=.05){
    dk=(lum(a)<lum(b)?a:b).map(v=>v*(1-t));lt=(lum(a)<lum(b)?b:a).map(v=>v+(255-v)*t);
  }
  return {dark:`rgb(${dk.map(Math.round)})`,light:`rgb(${lt.map(Math.round)})`};
}
export function qrFor(link,{dark='#000',light='#fff'}={}){
  const QR=globalThis.window?.WhatsUpQR;if(!QR)return '';
  try{
    const q=QR(0,'L');q.addData(link);q.make(); // L: fewest modules, so each is biggest on screen (a TV shows no damage to correct)
    const n=q.getModuleCount(),k=4,pad=2,c=document.createElement('canvas');c.width=c.height=(n+2*pad)*k;
    const g=c.getContext('2d');g.fillStyle=light;g.fillRect(0,0,c.width,c.height);g.fillStyle=dark;
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))g.fillRect((x+pad)*k,(y+pad)*k,k,k);
    return c.toDataURL('image/png');
  }catch{return '';}
}
