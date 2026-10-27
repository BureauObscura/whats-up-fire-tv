// The radar's map, built on the device for wherever home is. OpenMapTiles vector
// tiles from OpenFreeMap (free, no key; attribution required) are decoded with
// @mapbox/vector-tile + pbf (web/mvt.js), and only what a radar scope needs is
// kept: water, rivers, motorways/trunk roads, runways and airport labels. The
// result is in miles east/north of home and is saved, so tiles are fetched once
// per location.
import {getJson,getBytes,store} from './live.mjs';

export const MAP_ATTRIBUTION='© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors';
const TILEJSON='https://tiles.openfreemap.org/planet';
const TILE_URL=/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w.-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;
const KEY='whatsup.map.v1',VERSION=1,MAX_AGE=30*86400000;
// z10: one tile is ~19 mi wide at 40° latitude, so a 10-mile scope needs 4-9 tiles,
// and z10 already carries runways and IATA-coded airport labels.
const ZOOM=10;
const STREETS=new Set(['motorway','trunk','primary','secondary','tertiary','minor','service']),MAJOR=new Set(['motorway','trunk','primary','secondary']);

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
const round=pts=>pts.map(([x,y])=>[Math.round(x*100)/100,Math.round(y*100)/100]);

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

// Build the map for home; `range` in miles. Throws when tiles can't be fetched.
// detail: a close-up street map (Adjust position) instead of the radar's major roads.
// `net` and `MVT` are replaceable for tests.
export async function buildMap(home,range,{net={getJson,getBytes},MVT=globalThis.window?.WhatsUpMVT,zoom=ZOOM,detail=false}={}){
  const ZOOM=zoom;
  if(!MVT)throw new Error('mvt.js missing');
  const lim=range+1.5,cos=Math.cos(home.latitude*DEG);
  const toMiles=(lon,lat)=>[(lon-home.longitude)*69.172*cos,(lat-home.latitude)*69.0];
  const dLat=lim/69,dLon=lim/(69.172*cos);
  const x0=Math.floor(tileX(home.longitude-dLon,ZOOM)),x1=Math.floor(tileX(home.longitude+dLon,ZOOM));
  const y0=Math.floor(tileY(home.latitude+dLat,ZOOM)),y1=Math.floor(tileY(home.latitude-dLat,ZOOM));
  const template=await tileTemplate(net);
  const out={v:VERSION,latitude:home.latitude,longitude:home.longitude,range,zoom,built:Date.now(),
    water:[],rivers:[],roads:[],runways:[],airports:[],shields:[]};
  const shields=new Map();let fetched=0;
  for(let tx=x0;tx<=x1;tx++)for(let ty=y0;ty<=y1;ty++){
    const bytes=await net.getBytes(template.replace('{z}',ZOOM).replace('{x}',tx).replace('{y}',ty));
    if(!bytes)continue;
    fetched++;
    const tile=new MVT.VectorTile(new MVT.Pbf(bytes));
    const each=(name,fn)=>{const layer=tile.layers[name];if(layer)for(let i=0;i<layer.length;i++)fn(layer.feature(i),layer.extent);};
    const geom=(f,extent)=>f.loadGeometry().map(ring=>ring.map(p=>toMiles(lonOf(tx+p.x/extent,ZOOM),latOf(ty+p.y/extent,ZOOM))));
    const lines=(f,extent,tol)=>geom(f,extent).flatMap(l=>clipLine(l,lim)).map(l=>round(simplify(l,tol)));
    each('water',(f,e)=>{
      if(f.type!==3)return;
      for(const ring of geom(f,e))if(ring.length>3&&touches(ring,lim))out.water.push(round(simplify(ring,.04)));
    });
    each('waterway',(f,e)=>{if(f.type===2&&f.properties.class==='river')out.rivers.push(...lines(f,e,.04));});
    each('transportation',(f,e)=>{
      const c=f.properties.class;
      const wanted=detail?STREETS.has(c):c==='motorway'||c==='trunk';
      if(f.type===2&&wanted&&!f.properties.ramp)
        for(const l of lines(f,e,detail?.005:.03))out.roads.push({major:detail?MAJOR.has(c):c==='motorway',p:l});
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
      const pr=f.properties,[[p]]=f.loadGeometry();
      const [x,y]=toMiles(lonOf(tx+p.x/e,ZOOM),latOf(ty+p.y/e,ZOOM));
      const code=String(pr.iata||pr.icao||'').toUpperCase();
      if(!code||Math.hypot(x,y)>range+12)return;
      if(out.airports.some(a=>a.code===code))return;
      out.airports.push({code,iata:String(pr.iata||''),icao:String(pr.icao||''),name:String(pr.name_en||pr['name:en']||pr.name||'').slice(0,60),
        kind:String(pr.class||''),x:Math.round(x*100)/100,y:Math.round(y*100)/100});
    });
  }
  if(!fetched)throw new Error('no tiles');
  out.shields=[...shields.values()].map(({ref,x,y})=>({ref,x:Math.round(x*100)/100,y:Math.round(y*100)/100}));
  const rank={international:0,public:1,regional:1,military:2};
  out.airports.sort((a,b)=>(rank[a.kind]??3)-(rank[b.kind]??3)||Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
  return out;
}

// Saved map near this home (within ~1 km: drawing shifts it), younger than 30 days, else null.
export function savedMap(home,range){
  const m=store.get(KEY);
  const same=m&&m.v===VERSION&&m.range===range&&Math.abs(m.latitude-home.latitude)<.01&&
    Math.abs(m.longitude-home.longitude)<.01&&Date.now()-m.built<MAX_AGE;
  return same?m:null;
}
export const saveMap=m=>store.set(KEY,m);
