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

// QR code (data: GIF) for a photo's link, drawn by the bundled encoder (qr.js).
export function qrFor(link){
  const QR=globalThis.window?.WhatsUpQR;if(!QR)return '';
  try{const q=QR(0,'M');q.addData(link);q.make();return q.createDataURL(4,2);}catch{return '';}
}
