// Maps, built on the device for wherever home is. OpenMapTiles vector tiles from
// OpenFreeMap (free, no key; attribution required) are decoded with
// @mapbox/vector-tile + pbf (web/mvt.js) into plain arrays in miles east/north of
// home, and saved, so tiles are fetched once per location.
// * base (z10, the 10-mile scope): water, rivers, motorways/trunk roads, runways,
//   airport labels, motorway shields and town names. Every layout uses it.
// * detail (z12 over ~6.5 mi, plus z14 buildings within ~1.3 mi): every road class,
//   rail, waterways, landuse, parks, aeroways and place names. Built only when a
//   layout asks for it (Atlas, Glass, Blueprint, ...).
import {getJson,getBytes,store} from './live.mjs';

export const MAP_ATTRIBUTION='© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
const TILEJSON='https://tiles.openfreemap.org/planet';
const TILE_URL=/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
const KEY='whatsup.map.v2',VERSION=3,MAX_AGE=30*86400000; // v3: airfields
const DETAIL_KEY='whatsup.detail.v1',DETAIL_VERSION=1;
// z10: one tile is ~19 mi wide at 40° latitude, so a 10-mile scope needs 4-9 tiles,
// and z10 already carries runways and IATA-coded airport labels. Wider map radii use
// lower zooms (fewer, coarser tiles: 2-9 at any radius); OpenMapTiles drops minor
// features at low zooms by itself.
const ZOOM=10;
export const zoomFor=range=>range<=15?10:range<=25?9:range<=50?8:range<=100?7:6;
// Small airfields are only in z10 tiles (lower zooms carry international airports only),
// so maps up to this radius read their labels from z10 tiles too (one extra pass).
export const AIRFIELD_MAX_RANGE=50;
// The street-detail map is drawn up to a 15-mile map radius; wider views draw the base map.
export const DETAIL_MAX_RANGE=15;
const STREETS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service']),MAJOR=new Set(['motorway','trunk','primary','secondary']);
const DETAIL_ROADS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service','rail']);
const LANDUSE=new Set(['residential','commercial','industrial','retail','cemetery','hospital','school','university','college',
  'stadium','railway','military','pitch','zoo','theme_park','playground']);
const PLACES=new Set(['city','town','village','suburb','neighbourhood','quarter']);

const DEG=Math.PI/180;
const tileX=(lon,z)=>(lon+180)/360*2**z;
const tileY=(lat,z)=>{const s=Math.sin(lat*DEG);return (.5-Math.log((1+s)/(1-s))/(4*Math.PI))*2**z;};
const lonOf=(x,z)=>x/2**z*360-180;
const latOf=(y,z)=>Math.atan(Math.sinh(Math.PI-2*Math.PI*y/2**z))/DEG;

// Douglas-Peucker on [x,y] miles.
function simplify(pts,tol){
  if(pts.length<3)return pts;
  const keep=new Uint8Array(pts.length);keep[0]=keep[pts.length-1]=1;
  const stack=[[0,pts.length-1]];
  while(stack.length){
    const [a,b]=stack.pop(),[ax,ay]=pts[a],[bx,by]=pts[b],dx=bx-ax,dy=by-ay,len=Math.hypot(dx,dy);
    let worst=0,at=-1;
    // A closed ring starts and ends on the same point: measure from that point.
    for(let i=a+1;i<b;i++){
      const d=len<1e-9?Math.hypot(pts[i][0]-ax,pts[i][1]-ay):Math.abs(dy*(pts[i][0]-ax)-dx*(pts[i][1]-ay))/len;
      if(d>worst){worst=d;at=i;}
    }
    if(worst>tol){keep[at]=1;stack.push([a,at],[at,b]);}
  }
  return pts.filter((_,i)=>keep[i]);
}
const rounder=k=>pts=>pts.map(([x,y])=>[Math.round(x*k)/k,Math.round(y*k)/k]);
const round=rounder(100);

// Lines: keep the runs that come within the box (plus one point either side).
function clipLine(pts,lim){
  const runs=[];let run=null;
  const inside=([x,y])=>Math.abs(x)<=lim&&Math.abs(y)<=lim;
  for(let i=0;i<pts.length;i++){
    const near=inside(pts[i])||(i>0&&inside(pts[i-1]))||(i+1<pts.length&&inside(pts[i+1]));
    if(near){(run||(run=[])).push(pts[i]);}else if(run){runs.push(run);run=null;}
  }
  if(run)runs.push(run);
  return runs.filter(r=>r.length>1);
}
const touches=(pts,lim)=>{
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const [x,y] of pts){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
  return x1>=-lim&&x0<=lim&&y1>=-lim&&y0<=lim;
};

async function tileTemplate(net){
  const {status,payload}=await net.getJson(TILEJSON,8000);
  const url=status===200&&Array.isArray(payload?.tiles)?payload.tiles[0]:'';
  if(!TILE_URL.test(url))throw new Error(`tilejson ${status}`);
  return url;
}

// Calls fn(tile, helpers) for each tile at `zoom` covering `lim` miles around home.
// Tiles are decoded one at a time so only one is in memory. Returns the number fetched.
async function eachTile(home,lim,zoom,template,net,MVT,fn){
  const cos=Math.cos(home.latitude*DEG);
  const toMiles=(lon,lat)=>[(lon-home.longitude)*69.172*cos,(lat-home.latitude)*69.0];
  const dLat=lim/69,dLon=lim/(69.172*cos);
  const x0=Math.floor(tileX(home.longitude-dLon,zoom)),x1=Math.floor(tileX(home.longitude+dLon,zoom));
  const y0=Math.floor(tileY(home.latitude+dLat,zoom)),y1=Math.floor(tileY(home.latitude-dLat,zoom));
  let fetched=0;
  for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++){
    const bytes=await net.getBytes(template.replace('{z}',zoom).replace('{x}',tx).replace('{y}',ty));
    if(!bytes)continue;
    fetched++;
    const tile=new MVT.VectorTile(new MVT.Pbf(bytes));
    const each=(name,f)=>{const layer=tile.layers[name];if(layer)for(let i=0;i<layer.length;i++)f(layer.feature(i),layer.extent);};
    const geom=(f,extent)=>f.loadGeometry().map(ring=>ring.map(p=>toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom))));
    const point=(f,extent)=>{const [[p]]=f.loadGeometry();return toMiles(lonOf(tx+p.x/extent,zoom),latOf(ty+p.y/extent,zoom));};
    fn({each,geom,point});
  }
  return fetched;
}
const nameOf=pr=>String(pr.name_en||pr['name:en']||pr.name_int||pr.name||'').slice(0,60);

// Build the map for home; `range` in miles. Throws when tiles can't be fetched.
// detail: a close-up street map (Adjust position) instead of the radar's major roads.
// `net` and `MVT` are replaceable for tests.
export async function buildMap(home,range,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,zoom=zoomFor(range),detail=false}={}){
  if(!MVT)throw new Error('mvt.js missing');
  // Wide layouts (Glass) show ~1.5x the radius sideways; the 10-mile map keeps its original reach.
  const lim=range<=10?range+1.5:range*1.5,k=Math.max(1,range/10); // simplify/clip coarser as the view widens
  const template=await tileTemplate(net);
  const out={v:VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,built:Date.now(),
    water:[],rivers:[],roads:[],runways:[],airports:[],airfields:[],shields:[],places:[]};
  const shields=new Map(),places=new Map();
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point})=>{
    const lines=(f,extent,tol)=>geom(f,extent).flatMap(l=>clipLine(l,lim)).map(l=>round(simplify(l,tol)));
    each('water',(f,e)=>{
      if(f.type!==3)return;
      for(const ring of geom(f,e))if(ring.length>3&&touches(ring,lim)){const r=simplify(ring,.04*k);if(r.length>3)out.water.push(round(r));}
    });
    each('waterway',(f,e)=>{if(f.type===2&&f.properties.class==='river')out.rivers.push(...lines(f,e,.04*k));});
    each('transportation',(f,e)=>{
      const c=f.properties.class;
      const wanted=detail?STREETS.has(c):c==='motorway'||c==='trunk';
      if(f.type===2&&wanted&&!f.properties.ramp)
        for(const l of lines(f,e,detail?.005:.03*k))out.roads.push({c,major:detail?MAJOR.has(c):c==='motorway',p:l});
    });
    each('transportation_name',(f,e)=>{
      const ref=String(f.properties.ref||'').trim();
      if(f.type!==2||f.properties.class!=='motorway'||!ref||ref.length>8)return;
      for(const l of geom(f,e)){
        const mid=l[Math.floor(l.length/2)];
        const d=Math.hypot(...mid);
        if(d<range-1.5&&(!shields.has(ref)||shields.get(ref).d>d))shields.set(ref,{ref,x:mid[0],y:mid[1],d});
      }
    });
    each('aeroway',(f,e)=>{
      if(f.properties.class!=='runway')return;
      if(f.type===2)out.runways.push(...lines(f,e,.01));
      else if(f.type===3)for(const ring of geom(f,e))if(touches(ring,lim))out.runways.push(round(ring));
    });
    each('aerodrome_label',(f,e)=>{
      if(f.type!==1)return;
      const pr=f.properties,[x,y]=point(f,e);
      const code=String(pr.iata||pr.icao||'').toUpperCase();
      if(Math.hypot(x,y)>range*1.5+12)return;
      // Every airfield, coded or not (Atlas labels them all); `airports` stays the coded ones.
      const name=nameOf(pr);
      if(name&&out.airfields.length<200&&!out.airfields.some(a=>a.name===name))
        out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
          kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
      if(!code||Math.hypot(x,y)>range+12)return;
      if(out.airports.some(a=>a.code===code))return;
      out.airports.push({code,iata:String(pr.iata||''),icao:String(pr.icao||''),name:nameOf(pr),
        kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!['city','town','suburb'].includes(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
  });
  if(!fetched)throw new Error('no tiles');
  if(zoom<10&&range<=AIRFIELD_MAX_RANGE){
    const flim=range*.85; // Atlas, the layout that shows airfields, sees ~0.7x the radius sideways
    try{
      await eachTile(home,flim,10,template,net,MVT,({each,point})=>each('aerodrome_label',(f,e)=>{
        if(f.type!==1)return;
        const pr=f.properties,name=nameOf(pr),[x,y]=point(f,e);
        if(!name||Math.abs(x)>flim||Math.abs(y)>flim||out.airfields.length>=200||out.airfields.some(a=>a.name===name))return;
        out.airfields.push({name,code:String(pr.iata||pr.icao||'').toUpperCase(),iata:String(pr.iata||''),
          kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
      }));
    }catch(e){/* the big airports from the map itself still show */}
  }
  out.shields=[...shields.values()].map(({ref,x,y})=>({ref,x:Math.round(x*100)/100,y:Math.round(y*100)/100}));
  const order={city:0,town:1,suburb:2};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,40);
  const rank={international:0,public:1,regional:1,military:2};
  out.airports.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  out.airfields.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||!a.code-!b.code||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  return out;
}

// Saved maps: one per map radius (each at its own tile zoom), the 3 most recently
// used kept. A saved map near this home (within ~1 km: drawing shifts it), younger
// than 30 days, else null. The 10-mile map keeps the original key, so maps saved
// before map radius existed still count.
const keyFor=range=>range===10?KEY:`${KEY}.r${range}`;
const RECENT_KEY='whatsup.map.recent';
export function savedMap(home,range){
  const m=store.get(keyFor(range));
  const same=m&&m.v===VERSION&&m.range===range&&Math.abs(m.latitude-home.latitude)<.01&&
    Math.abs(m.longitude-home.longitude)<.01&&Date.now()-m.built<MAX_AGE;
  return same?m:null;
}
export function saveMap(m){
  const recent=[m.range,...(store.get(RECENT_KEY)||[]).filter(r=>r!==m.range)];
  for(const r of recent.slice(3))store.remove(keyFor(r));
  store.set(RECENT_KEY,recent.slice(0,3));
  store.set(keyFor(m.range),m);
}

// --- Detail map. Coordinates in thousandths of a mile (~5 ft). Each line or ring is
// saved as a delta-encoded string ("x,y,dx,dy,...") and decoded into an Int16Array,
// so ~150k points cost ~0.8 MB saved and ~0.6 MB in memory instead of nested arrays.
// Buildings are capped (nearest first) to stay well under the localStorage quota.
export const DETAIL_RANGE=6.5,BUILDING_RANGE=1.3;
// The detail map for a map radius: how far it reaches (Atlas shows ~0.7x the radius
// sideways), from which tile zoom, and whether it has buildings. Up to 15 mi it is the
// full street map (z12 + z14 buildings). Wider, it is a mid-detail map from the most
// detailed zoom that keeps it to ~16-36 tiles: roads by class as far as that zoom
// carries them, land use, parks and woods, water, streams, rail, towns and villages.
const DETAIL_SPECS=[[10,DETAIL_RANGE,12,BUILDING_RANGE],[15,10.5,12,BUILDING_RANGE],[25,18,11,0],[50,36,10,0],
  [100,72,9,0],[150,108,8,0],[250,180,8,0]];
export function detailSpec(mapMiles){
  const [max,range,zoom,buildings]=DETAIL_SPECS.find(([max])=>mapMiles<=max)||DETAIL_SPECS[DETAIL_SPECS.length-1];
  return {range,zoom,buildings,key:max<=15?'street':`r${max}`};
}
// A built detail map serves a spec when it is the same kind, at least as far, same zoom.
export const detailFits=(m,spec)=>!!m&&(m.key||'street')===spec.key&&m.range>=spec.range&&(m.zoom||12)===spec.zoom;
const MAX_BUILDING_POINTS=40000;
// Points per mile: 1000 (~5 ft) for street maps; wide maps use fewer so ±1.6x their reach
// still fits an Int16. Clamped: the extra point clipLine keeps past the edge can be far out.
const perMile=range=>Math.min(1000,Math.floor(20000/range));
const encoder=per=>{
  const int16=v=>Math.max(-32000,Math.min(32000,Math.round(v*per)));
  return pts=>{let px=0,py=0;return pts.map(([x,y])=>{const ix=int16(x),iy=int16(y),d=`${ix-px},${iy-py}`;px=ix;py=iy;return d;}).join(',');};
};
function decode(s){
  const v=s.split(','),out=new Int16Array(v.length);let x=0,y=0;
  for(let i=0;i<v.length;i+=2){x+=+v[i];y+=+v[i+1];out[i]=x;out[i+1]=y;}
  return out;
}
const DETAIL_LAYERS=['water','waterways','roads','landuse','parks','aero','buildings'];
// Saved form -> drawable form (p: line, r: ring, both Int16Array in 1/per mi; per defaults to 1000).
export function decodeDetail(m){
  if(!m)return null;
  const out={...m,decoded:true};
  for(const k of DETAIL_LAYERS)out[k]=m[k].map(f=>f.p?{...f,p:decode(f.p)}:{...f,r:decode(f.r)});
  return out;
}
export async function buildDetail(home,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,range=DETAIL_RANGE,buildings=BUILDING_RANGE,zoom=12,key='street'}={}){
  if(!MVT)throw new Error('mvt.js missing');
  const lim=range+.5,template=await tileTemplate(net),per=perMile(range),encode=encoder(per),k=Math.max(1,range/10.5);
  const out={v:DETAIL_VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,key,per,buildingRange:buildings,built:Date.now(),
    water:[],waterways:[],roads:[],landuse:[],parks:[],aero:[],buildings:[],places:[]};
  const places=new Map();
  const polys=(geom,f,e,tol,box=lim)=>geom(f,e).filter(r=>r.length>3&&touches(r,box)).map(r=>simplify(r,tol)).filter(r=>r.length>3).map(encode);
  const fetched=await eachTile(home,lim,zoom,template,net,MVT,({each,geom,point})=>{
    const lines=(f,e,tol)=>geom(f,e).flatMap(l=>clipLine(l,lim)).map(l=>encode(simplify(l,tol)));
    each('water',(f,e)=>{if(f.type===3&&f.properties.class!=='swimming_pool')for(const r of polys(geom,f,e,(.008)*k))out.water.push({r});});
    each('waterway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&['river','canal','stream'].includes(c))for(const p of lines(f,e,.008*k))out.waterways.push({c,p});
    });
    each('transportation',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type!==2||!DETAIL_ROADS.has(c)||c==='rail'&&f.properties.subclass!=='rail')return;
      for(const p of lines(f,e,.006*k))out.roads.push({c,p,...(f.properties.ramp?{ramp:1}:{}),...(f.properties.brunnel==='bridge'?{bridge:1}:{})});
    });
    each('landuse',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===3&&LANDUSE.has(c))for(const r of polys(geom,f,e,(c==='residential'?.02:.01)*k))out.landuse.push({c,r});
    });
    each('landcover',(f,e)=>{
      const c=String(f.properties.class||''),s=String(f.properties.subclass||'');
      if(f.type===3&&(c==='wood'||c==='grass'))for(const r of polys(geom,f,e,(c==='wood'?.02:.01)*k))out.parks.push({c:s==='park'||s==='golf_course'?s:c,r});
    });
    each('park',(f,e)=>{if(f.type===3)for(const r of polys(geom,f,e,(.015)*k))out.parks.push({c:'park',r});});
    each('aeroway',(f,e)=>{
      const c=String(f.properties.class||'');
      if(f.type===2&&(c==='runway'||c==='taxiway'))for(const p of lines(f,e,.004*k))out.aero.push({c,p});
      else if(f.type===3&&['runway','aerodrome','apron','taxiway'].includes(c))for(const r of polys(geom,f,e,(.004)*k))out.aero.push({c,r});
    });
    each('place',(f,e)=>{
      const pr=f.properties,c=String(pr.class||'');
      if(f.type!==1||!PLACES.has(c))return;
      const name=nameOf(pr),[x,y]=point(f,e);
      if(!name||Math.abs(x)>lim||Math.abs(y)>lim||places.has(name))return;
      places.set(name,{name,c,rank:Number(pr.rank)||20,x:Math.round(x*1000)/1000,y:Math.round(y*1000)/1000});
    });
  });
  if(!fetched)throw new Error('no tiles');
  const order={city:0,town:1,suburb:2,village:3,quarter:4,neighbourhood:5};
  out.places=[...places.values()].sort((a,b)=>order[a.c]-order[b.c]||a.rank-b.rank).slice(0,80);
  if(buildings>0){
    const found=[],blim=buildings+.15;
    try{
      await eachTile(home,blim,14,template,net,MVT,({each,geom})=>{
        each('building',(f,e)=>{if(f.type===3)for(const r of geom(f,e))if(r.length>3&&touches(r,blim)){
          const s=simplify(r,.003);if(s.length>3)found.push(s);
        }});
      });
    }catch(e){/* streets without buildings are still a map */}
    const dist=r=>Math.min(...r.map(([x,y])=>Math.max(Math.abs(x),Math.abs(y))));
    let points=0;
    for(const r of found.map(r=>[dist(r),r]).sort((a,b)=>a[0]-b[0]).map(([,r])=>r)){
      if((points+=r.length)>MAX_BUILDING_POINTS)break;
      out.buildings.push({r:encode(r)});
    }
  }
  return out;
}

// The detail map is saved straight to localStorage (not kept in memory by `store`),
// so a layout that doesn't draw it costs nothing. Too big for the quota: not saved.
// Two slots: the street map (up to 15 mi) and the most recent wide map.
const detailKey=spec=>spec.key==='street'?DETAIL_KEY:`${DETAIL_KEY}.wide`;
export function savedDetail(home,spec=detailSpec(10)){
  try{
    const m=JSON.parse(localStorage.getItem(detailKey(spec))||'null');
    return m&&m.v===DETAIL_VERSION&&detailFits(m,spec)&&Math.abs(m.latitude-home.latitude)<.01&&Math.abs(m.longitude-home.longitude)<.01&&
      Date.now()-m.built<MAX_AGE?m:null;
  }catch{return null;}
}
export function saveDetail(m){
  const key=detailKey({key:m.key||'street'});
  try{localStorage.setItem(key,JSON.stringify(m));return true;}
  catch{try{localStorage.removeItem(key);}catch{/* no storage */}return false;}
}
