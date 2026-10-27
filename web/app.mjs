// What's Up: the radar page. Draws the scope and panel from model.mjs, builds the
// map for home (mapgen.mjs), and runs the remote-friendly settings and location
// screens (arrows move, Select chooses, Back closes, Select on the radar opens Settings).
import {CONFIG} from './config.js';
import {number} from './core.mjs';
import {HISTORY_KEY,store} from './live.mjs';
import {start,demo,query,compass,offset,resetLog,tz} from './model.mjs';
import {loadSettings,saveSettings,locateByIp,searchPlaces,searchAddress,looksLikeAddress,placeLabel} from './place.mjs';
import {buildMap,savedMap,saveMap} from './mapgen.mjs';

const $=id=>document.getElementById(id);
const setText=(id,v)=>{const el=$(id);v=v??'';if(el&&el.textContent!==String(v))el.textContent=v;};
const NS='http://www.w3.org/2000/svg';
const svg=(tag,attrs={},text)=>{
  const el=document.createElementNS(NS,tag);
  for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  if(text!==undefined)el.textContent=text;return el;
};
const stage=$('stage');
const fit=()=>{const s=Math.min(innerWidth/960,innerHeight/540);stage.style.transform=`translate(-50%,-50%) scale(${s})`;};
addEventListener('resize',fit);fit();

// --- Bridge to the Vega app: it handles the remote's Back button and asks us first.
const native=window.ReactNativeWebView;
const tellApp=msg=>{try{native?.postMessage(JSON.stringify(msg));}catch{/* desktop */}};

let settings=loadSettings(),feed=null,mapData=null,lastModel=null,placeToken=0;
const RANGE=CONFIG.rangeMiles,CX=270,CY=270,R=250;
let PPM=R/RANGE; // pixels per mile; Adjust position zooms in
const project=(lat,lon)=>{const {x,y}=offset(lat,lon);return {x:CX+x*PPM,y:CY-y*PPM};};

// --- Units
const KM=1.609344;
const fmt={
  int:v=>number(v)?Math.round(v).toLocaleString('en-US'):'—',
  dist:(mi,d=1)=>!number(mi)?'—':settings.distance==='km'?`${(mi*KM).toFixed(d)} km`:`${mi.toFixed(d)} mi`,
  far:mi=>!number(mi)?'—':settings.distance==='km'?`${fmt.int(mi*KM)} km`:`${fmt.int(mi)} mi`,
  alt:ft=>!number(ft)?'—':settings.altitude==='m'?`${fmt.int(ft*.3048)} m`:ft>=18000?`FL${Math.round(ft/100)}`:`${fmt.int(ft)} ft`,
  speed:kt=>!number(kt)?'—':settings.distance==='km'?`${fmt.int(kt*1.852)} km/h`:`${fmt.int(kt)} kt`,
  vs:fpm=>!number(fpm)||Math.abs(fpm)<100?'level':settings.altitude==='m'?`${fpm>0?'↑':'↓'}${(Math.abs(fpm)*.00508).toFixed(1)} m/s`:
    `${fpm>0?'↑':'↓'}${fmt.int(Math.abs(Math.round(fpm/50)*50))}`,
  mmss:s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`,
  ago:(stamp,now)=>{const m=Math.max(0,Math.floor((now/1000-stamp)/60));return m<1?'now':m<60?`${m}m`:`${Math.floor(m/60)}h`;},
  clock:now=>{try{return new Date(now).toLocaleTimeString(settings.place?.countryCode==='US'?'en-US':'en-GB',{hour:'numeric',minute:'2-digit',timeZone:tz()});}catch{return '';}},
};

// --- Scope: rings, ticks and bearings; redrawn when the radius or units change.
function drawRings(){
  const nodes=[],km=settings.distance==='km';ringBoxes=[];
  const step=km?2/KM:1,major=km?4/KM:2,label=km?4:2;
  for(let mi=step,i=1;mi<RANGE-.01;mi+=step,i++){
    const isMajor=Math.abs(mi/major-Math.round(mi/major))<.01;
    nodes.push(svg('circle',{class:`ring${isMajor?' major':''}`,cx:CX,cy:CY,r:mi*PPM}));
    if(isMajor&&mi<RANGE-.6)nodes.push(svg('text',{class:'ring-label',x:CX+4,y:CY-mi*PPM-3},String(Math.round(i*step*(km?KM:1)/label)*label)));
  }
  nodes.push(svg('circle',{class:'ring edge',cx:CX,cy:CY,r:R}));
  nodes.push(svg('circle',{class:'ring boundary',cx:CX,cy:CY,r:settings.radiusMiles*PPM}));
  for(let deg=0;deg<360;deg+=5){
    const big=deg%30===0,a=deg*Math.PI/180,r1=R-(big?9:4);
    nodes.push(svg('line',{class:`tick${big?' major':''}`,x1:CX+Math.sin(a)*r1,y1:CY-Math.cos(a)*r1,x2:CX+Math.sin(a)*R,y2:CY-Math.cos(a)*R}));
    if(big)ringBoxes.push({x:CX+Math.sin(a)*(R-20)-14,y:CY-Math.cos(a)*(R-20)-8,w:28,h:14});
    if(big&&deg%90)nodes.push(svg('text',{class:'bearing-label',x:CX+Math.sin(a)*(R-20),y:CY-Math.cos(a)*(R-20)+4,'text-anchor':'middle'},String(deg).padStart(3,'0')));
  }
  for(const [deg,t] of [[0,'N'],[90,'E'],[180,'S'],[270,'W']]){
    const a=deg*Math.PI/180;
    nodes.push(svg('text',{class:'bearing-label',x:CX+Math.sin(a)*(R-20),y:CY-Math.cos(a)*(R-20)+4,'text-anchor':'middle','font-weight':700},t));
  }
  nodes.push(svg('rect',{class:'home',x:CX-2.5,y:CY-2.5,width:5,height:5}));
  $('rings').replaceChildren(...nodes);
  setText('ring-note',`Rings ${km?'2 km':'1 mi'} · alert ${fmt.dist(settings.radiusMiles,0)}`);
}

let labelBoxes=[],ringBoxes=[];
// The map is in miles from where it was built; `center` is where the scope is centred
// (home, or the dot being moved in Adjust position), so the map is shifted to match.
function drawMap(m,center=settings.place,range=RANGE){
  const base=[],labels=[];labelBoxes=[];
  if(m&&center){
    const cos=Math.cos(center.latitude*Math.PI/180);
    const sx=(m.longitude-center.longitude)*69.172*cos,sy=(m.latitude-center.latitude)*69;
    const px=([x,y])=>`${(CX+(x+sx)*PPM).toFixed(1)} ${(CY-(y+sy)*PPM).toFixed(1)}`;
    const at=o=>({...o,x:o.x+sx,y:o.y+sy});
    const d=lines=>lines.map(l=>`M${l.map(px).join('L')}`).join('');
    if(m.water.length)base.push(svg('path',{class:'map-water',d:m.water.map(r=>`M${r.map(px).join('L')}Z`).join('')}));
    if(m.rivers.length)base.push(svg('path',{class:'map-river',d:d(m.rivers)}));
    for(const major of [false,true]){
      const roads=m.roads.filter(r=>r.major===major).map(r=>r.p);
      if(roads.length)base.push(svg('path',{class:`map-road${major?' major':''}`,d:d(roads)}));
    }
    if(m.runways.length)base.push(svg('path',{class:'map-runway',d:d(m.runways)}));
    let shown=0;
    for(const a of m.airports.map(at)){
      if(shown>=6||Math.hypot(a.x,a.y)>range-.6||(!a.iata&&shown>=3))continue;
      const x=CX+a.x*PPM,y=CY-a.y*PPM+20,w=a.code.length*7.6+4;
      const box={x:x-w/2,y:y-11,w,h:14};
      if(labelBoxes.some(b=>overlap(b,box)))continue;
      labelBoxes.push(box);shown++;
      labels.push(svg('text',{class:'map-airport',x,y,'text-anchor':'middle'},a.iata||a.code));
    }
    for(const s of m.shields.slice(0,6).map(at)){
      const x=CX+s.x*PPM,y=CY-s.y*PPM,ref=s.ref.replace(/^I /,'I-').replace(/^US /,'US-');
      const box={x:x-ref.length*3.2,y:y-9,w:ref.length*6.4,h:11};
      if(Math.hypot(s.x,s.y)>range-1||Math.hypot(s.x,s.y)<1||labelBoxes.some(b=>overlap(b,box)))continue;
      labelBoxes.push(box);labels.push(svg('text',{class:'map-shield',x,y,'text-anchor':'middle'},ref));
    }
  }
  $('map-base').replaceChildren(...base);$('map-labels').replaceChildren(...labels);
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.y<b.y+b.h&&b.y<a.y+a.h;

// Top-down silhouettes, nose up, in a 64-unit box.
const PLANE='M0-29C3-29 4-23 4-17L4-5 26 9 26 13 4 6 3 22 11 28 11 31 0 27-11 31-11 28-3 22-4 6-26 13-26 9-4-5-4-17C-4-23-3-29 0-29Z';
const HELI='M0-15C4.6-15 5.6-9 5.6-4 5.6 2 3 5 1.2 6L1 20 5.5 20.6 5.5 22.4 1 23 .8 27-.8 27-1 23-5.5 22.4-5.5 20.6-1 20-1.2 6C-3 5-5.6 2-5.6-4-5.6-9-4.6-15 0-15Z';
const SINGLE='M0-24C2-24 2.6-21 2.6-17L2.6-12 26-11.2 26-6.4 2.6-5.6 1.8 17 8.5 19 8.5 22 0 21.4-8.5 22-8.5 19-1.8 17-2.6-5.6-26-6.4-26-11.2-2.6-12-2.6-17C-2.6-21-2-24 0-24Z';
const shapeFor=a=>/^(EC|AS3|AS5|B4|R44|R22|H[0-9]|S76|A1[0-4]9|B06|B407|B429|H60)/.test(a.aircraft_type||'')||a.category==='A7'?HELI:
  /^(C1[5-8]|C2[01]|PA|SR2|BE[23]|P28|DA4|PC12|C206|C210)/.test(a.aircraft_type||'')||a.category==='A1'?SINGLE:PLANE;
function planeIcon(a,p,size,cls){
  const g=svg('g',{class:cls,transform:`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${a.heading||0}) scale(${size/64})`});
  g.append(svg('path',{d:shapeFor(a)}));return g;
}

// --- Render
const lowerType=s=>s||'';
function blockText(a){
  const ft=a.altitude_ft,vs=a.vertical>300?'↑':a.vertical<-300?'↓':'';
  const alt=settings.altitude==='m'?`${(ft*.3048/1000).toFixed(1)}k`:String(Math.round(ft/100)).padStart(3,'0');
  const spd=settings.distance==='km'?Math.round((a.speed_kt||0)*1.852):Math.round(a.speed_kt||0);
  return [a.flight,`${alt}${vs} ${String(spd).padStart(3,'0')}`,`${a.aircraft_type||'----'} ${a.route?.destination||''}`.trim()];
}

function render(m){
  lastModel=m;
  const {now,hero}=m;
  setText('clock',fmt.clock(now));
  if(adj)return; // the scope is a close-up map while adjusting
  const status=demo?'Preview':m.connecting?'Connecting…':m.fresh?'Live':'No signal';
  setText('status',status);$('status').classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  stage.classList.toggle('emergency',!!hero?.emergency);

  // Scope
  const trails=[],blips=[],blocks=[],boxes=[...labelBoxes,...ringBoxes,{x:CX-6,y:CY-6,w:12,h:12}];
  const visible=m.planes.filter(a=>a.ground<=RANGE);
  const labelled=new Set([hero,...visible.filter(a=>a.inside),...visible].filter(Boolean).slice(0,9));
  for(const a of visible){
    const p=project(a.latitude,a.longitude),isHero=a===hero;
    const dots=svg('g',{class:'trail'});
    a.trend.trail.filter((_,i,l)=>(l.length-1-i)%3===0).slice(-7,-1).forEach(s=>{const q=project(s.lat,s.lon);dots.append(svg('circle',{cx:q.x.toFixed(1),cy:q.y.toFixed(1),r:1.3}));});
    trails.push(dots);
    blips.push(planeIcon(a,p,isHero?20:a.inside?16:13,`blip${a.inside?'':' context'}${a.cargo?' cargo':''}${isHero?' hero':''}`));
    if(!labelled.has(a))continue;
    const lines=blockText(a),w=Math.max(...lines.map(l=>l.length))*7+4,h=38;
    const spots=[[14,-h-2],[-w-14,-h-2],[14,8],[-w-14,8]];
    let box=null;
    for(const [dx,dy] of spots){
      const b={x:p.x+dx,y:p.y+dy,w,h};
      if(b.x<4||b.x+b.w>536||b.y<4||b.y+b.h>536)continue;
      if(!boxes.some(o=>overlap(o,b))){box=b;break;}
    }
    if(!box&&isHero)box={x:p.x+(p.x>380?-w-14:14),y:p.y-h-2,w,h};
    if(!box)continue;
    boxes.push(box);
    const left=box.x<p.x;
    blocks.push(svg('line',{class:'leader',x1:p.x+(left?-6:6),y1:p.y+(box.y<p.y?-5:5),x2:left?box.x+box.w:box.x,y2:box.y<p.y?box.y+box.h-4:box.y+6}));
    if(isHero)blocks.push(svg('rect',{class:'block-box',x:box.x-4,y:box.y-1,width:box.w+6,height:box.h+3}));
    const t=svg('text',{class:`block${a.inside?'':' context'}${isHero?' hero':''}`,x:box.x,y:box.y+11});
    lines.forEach((line,i)=>t.append(svg('tspan',{class:i?'l2':'',x:box.x,dy:i?12.5:0},line)));
    blocks.push(t);
  }
  $('trails').replaceChildren(...trails);$('blips').replaceChildren(...blips);$('blocks').replaceChildren(...blocks);

  // Hero card
  $('hero').hidden=!hero;$('empty-sky').hidden=!!hero;
  if(!hero)setText('empty-sky',!demo&&!m.fresh?(m.connecting?'Connecting to the live feed…':'No live data right now. Retrying every few seconds.'):'Quiet skies. Nothing within range right now.');
  if(hero){
    setText('hero-label',`${hero.status} · ${fmt.dist(hero.distance_mi)}`);
    $('alert').hidden=!hero.emergency;setText('alert',hero.emergency?`SQUAWK ${hero.squawk} · ${hero.emergency}`:'');
    setText('flight',hero.flight);setText('operator',hero.operator||(!hero.callsign||hero.callsign===hero.registration?'Private':''));
    const r=hero.route,city=p=>p?.city?` ${p.city}`:'';
    setText('route',r?`${r.origin}${city(r.from)}  →  ${r.destination}${city(r.to)}`:'Route not reported');
    $('progress-row').hidden=!hero.progress;
    if(hero.progress){$('bar').style.width=`${Math.round(hero.progress.share*100)}%`;
      setText('progress',`${fmt.far(hero.progress.flown)} flown · ${fmt.int(settings.distance==='km'?hero.progress.left*KM:hero.progress.left)} to go`);}
    const arrow=hero.trend.alt>0?' ↑':hero.trend.alt<0?' ↓':'';
    setText('alt',number(hero.vertical)&&Math.abs(hero.vertical)>=100?`${fmt.alt(hero.altitude_ft)} ${fmt.vs(hero.vertical)}`:`${fmt.alt(hero.altitude_ft)}${arrow}`);
    setText('spd',fmt.speed(hero.speed_kt));
    setText('look',`${compass(hero.bearing)} · ${Math.max(0,Math.round(hero.elevation))}° up`);
    const c=hero.cpa;
    setText('cpa',!c?'—':c.receding?`moving away`:`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles)}`);
    const aircraft=$('aircraft');
    const bits=[hero.registration,hero.year&&`built ${hero.year}`,hero.cargo&&`${hero.cargo} cargo`].filter(Boolean).join(' · ');
    aircraft.replaceChildren(document.createTextNode((hero.type||hero.aircraft_type||'Unknown type')+'  '),Object.assign(document.createElement('small'),{textContent:bits}));
  }

  // Cargo, logbook, recent
  const L=m.log;
  setText('cargo',String(L.cargoTonight).padStart(2,'0'));
  $('cargo-by').replaceChildren(...(L.cargoBy.length?L.cargoBy.slice(0,4).map(([brand,n])=>{
    const d=document.createElement('div');d.append(`${brand} `,Object.assign(document.createElement('em'),{textContent:n}));return d;
  }):[Object.assign(document.createElement('div'),{textContent:L.night?'none yet':'counts 6 pm to 6 am'})]));
  const cell=(text,tag='span',cls='')=>Object.assign(document.createElement(tag),{textContent:text,className:cls});
  $('log').replaceChildren(cell('Seen'),cell(`${fmt.int(L.today)} aircraft`,'b'),
    cell('High'),cell(L.highest?`${L.highest.name} ${fmt.alt(L.highest.value)}`:'—','b'),
    cell('Fast'),cell(L.fastest?`${L.fastest.name} ${fmt.speed(L.fastest.value)}`:'—','b'),
    cell('Rare'),cell(L.rarest?L.rarest.name:'—','b'));
  const recent=m.recent.slice(0,3);
  $('recent').replaceChildren(...(recent.length?recent.flatMap(a=>[
    cell(a.flight,'b',a.cargo?'cargo-row-t':''),
    cell([a.route&&`${a.route.origin}→${a.route.destination}`,lowerType(a.type)].filter(Boolean).join(' ')),
    cell(fmt.ago(a.last_seen,now),'span','t')]):[cell('Nothing inside the alert ring yet.')]));
}

// --- Place, map and feed
async function applyPlace(place,{fresh=false}={}){
  const token=++placeToken;
  feed?.stop();feed=null;
  if(fresh){store.remove(HISTORY_KEY);resetLog();}
  setText('city',placeLabel(place));
  drawRings();drawMap(null);
  $('trails').replaceChildren();$('blips').replaceChildren();$('blocks').replaceChildren();
  mapData=savedMap(place,RANGE);
  const startFeed=()=>{if(token===placeToken&&!feed)feed=start(place,{...CONFIG,radiusMiles:settings.radiusMiles},render,mapData?.airports);};
  if(!demo)startFeed();
  if(mapData){drawMap(mapData);setText('scope-note','');startFeed();return;}
  setText('scope-note','Drawing the map…');
  for(let attempt=0;token===placeToken;attempt++){
    try{
      const m=await buildMap(place,RANGE);
      if(token!==placeToken)return;
      mapData=m;saveMap(m);drawMap(m);setText('scope-note','');
      if(lastModel)render(lastModel);
      break;
    }catch(e){
      console.error('map',e?.message||e);
      if(token!==placeToken)return;
      setText('scope-note',attempt?'Map unavailable, retrying…':'Map unavailable');
      if(demo)startFeed();
      await new Promise(r=>setTimeout(r,Math.min(300000,30000*(attempt+1))));
    }
  }
  startFeed();
}

// A search result: show what matched before using it.
function confirmPlace(place){
  pending=place;
  setText('confirm-label','Use this location?');
  setText('confirm-main',place.street||placeLabel(place));
  setText('confirm-sub',place.street?placeLabel(place):[place.admin,place.country].filter(Boolean).join(', '));
  setText('confirm-note',place.source==='census'?'Matched by the US Census geocoder.':place.source==='nominatim'?'Matched by OpenStreetMap Nominatim.':
    'Centre of the area that matched. Use Adjust position to move the dot onto your home.');
  open('confirm','confirm-ok');
}
let pending=null;

function choosePlace(place){
  const changed=!settings.place||Math.abs(settings.place.latitude-place.latitude)>.001||Math.abs(settings.place.longitude-place.longitude)>.001;
  settings={...settings,place,confirmed:true};saveSettings(settings);
  closeAll();
  if(changed)applyPlace(place,{fresh:true});else setText('city',placeLabel(place));
}

// --- Focus and remote navigation
let layer=null,focused=null;
const layers=[];
function setFocus(el){focused?.classList.remove('focus');focused=el||null;focused?.classList.add('focus');}
const focusables=()=>layer?[...layer.querySelectorAll('[data-focus]')].filter(el=>el.offsetParent):[];
function open(id,first){
  if(layer)layers.push(layer);
  layer=$(id);layer.hidden=false;setFocus(first?$(first):focusables()[0]);syncApp();
}
function close(){
  if(!layer)return;
  if(layer.id==='locate'&&!settings.place)return; // nothing to go back to
  layer.hidden=true;layer=layers.pop()||null;
  if(layer){setFocus(focusables()[0]);if(layer.id==='settings')showSettings();}else setFocus(null);
  syncApp();
}
function closeAll(){while(layer){layer.hidden=true;layer=layers.pop()||null;}setFocus(null);syncApp();}
// The app swallows Back only while a screen is open (and there's somewhere to go).
function syncApp(){tellApp({type:'ui',overlay:!!adj||!!layer&&!(layer.id==='locate'&&!settings.place&&!layers.length)});}

function move(dir){
  const items=focusables();
  if(!focused||!items.includes(focused))return setFocus(items[0]);
  const a=focused.getBoundingClientRect(),ax=a.left+a.width/2,ay=a.top+a.height/2;
  let best=null,score=Infinity;
  for(const el of items){
    if(el===focused)continue;
    const b=el.getBoundingClientRect(),bx=b.left+b.width/2,by=b.top+b.height/2,dx=bx-ax,dy=by-ay;
    const main={left:-dx,right:dx,up:-dy,down:dy}[dir],side=dir==='left'||dir==='right'?Math.abs(dy):Math.abs(dx);
    if(main<=4)continue;
    const s=main+side*2.5;
    if(s<score){score=s;best=el;}
  }
  if(best)setFocus(best);
}

// Settings
const RADII=[1,2,3,4,5,6,7,8,9,10];
function showSettings(){
  setText('set-location-v',settings.place?[settings.place.street,placeLabel(settings.place)].filter(Boolean).join(', '):'Not set');
  setText('set-radius-v',fmt.dist(settings.radiusMiles,0));
  setText('set-distance-v',settings.distance==='km'?'Kilometres':'Miles');
  setText('set-altitude-v',settings.altitude==='m'?'Metres':'Feet');
}
function adjustSetting(el,dir){
  if(el.id==='set-radius')settings.radiusMiles=RADII[Math.max(0,Math.min(RADII.length-1,RADII.indexOf(settings.radiusMiles)+dir))];
  else if(el.id==='set-distance')settings.distance=settings.distance==='km'?'mi':'km';
  else if(el.id==='set-altitude')settings.altitude=settings.altitude==='m'?'ft':'m';
  else return;
  saveSettings(settings);showSettings();drawRings();
  if(el.id==='set-radius'&&settings.place)applyPlace(settings.place); // the feed's alert radius
  else if(lastModel)render(lastModel);
}

// Location entry: an on-screen keyboard for the remote, plus results to pick.
const KEYS=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ,-1234567890'.split(''),['Space','space w2'],['Delete','del w2'],['Clear','clear w3'],['Search','search w4']];
let entry='',searchTimer=null,searchSeq=0;
function buildKeys(){
  $('keys').replaceChildren(...KEYS.map(k=>{
    const [label,cls]=Array.isArray(k)?k:[k,''];
    const b=document.createElement('button');b.textContent=label;b.dataset.focus='';b.dataset.key=Array.isArray(k)?cls.split(' ')[0]:k;
    if(cls)b.className=cls.split(' ').slice(1).join(' ');return b;
  }));
}
function typeKey(key){
  if(key==='space')entry+=entry&&!entry.endsWith(' ')?' ':'';
  else if(key==='del')entry=entry.slice(0,-1);
  else if(key==='clear')entry='';
  else if(key==='search')return runSearch(true);
  else if(entry.length<40)entry+=key;
  setText('entry-text',entry);
  clearTimeout(searchTimer);searchTimer=setTimeout(runSearch,900);
}
// ZIP/city searches run as you type; street addresses only on Search (one geocoder
// request per search, as Nominatim's usage policy asks).
async function runSearch(explicit=false){
  clearTimeout(searchTimer);
  const q=entry.trim(),seq=++searchSeq,box=$('results');
  const msg=text=>box.replaceChildren(Object.assign(document.createElement('div'),{className:'msg',textContent:text}));
  if(q.length<2){box.replaceChildren();return;}
  const address=looksLikeAddress(q);
  if(address&&!explicit)return msg('Street address: press Search when done.');
  msg('Searching…');
  const elsewhere=settings.place?.countryCode&&settings.place.countryCode!=='US'&&settings.place.source!=='ip';
  let found=address?await searchAddress(q,{skipCensus:elsewhere}):await searchPlaces(q);
  // Postcodes Open-Meteo doesn't know (e.g. UK "SW1A 2AA"): try the address geocoders once.
  if(!address&&explicit&&found&&!found.length)found=await searchAddress(q,{skipCensus:elsewhere});
  if(seq!==searchSeq)return;
  if(!found||!found.length){
    box.replaceChildren(Object.assign(document.createElement('div'),{className:'msg',textContent:found?`No places match “${q}”.`:'Search is unavailable. Check the connection.'}));
    return;
  }
  box.replaceChildren(...found.slice(0,5).map(p=>{
    const b=document.createElement('button');b.dataset.focus='';
    b.append(p.street||placeLabel(p),Object.assign(document.createElement('small'),{textContent:p.street?placeLabel(p):[p.admin,p.country].filter(Boolean).join(', ')}));
    b._place=p;return b;
  }));
}
function openLocate(help){
  entry='';setText('entry-text','');$('results').replaceChildren();
  setText('entry-help',help||'Type a ZIP or postal code, a city, or your street address, then Search.');
  open('locate');
}

function select(el){
  if(!el)return;
  if(el._place)return confirmPlace(el._place);
  if(el.dataset.key)return typeKey(el.dataset.key);
  switch(el.id){
    case 'welcome-ok':settings.confirmed=true;saveSettings(settings);return close();
    case 'welcome-change':return openLocate();
    case 'set-location':return openLocate();
    case 'set-adjust':return startAdjust(settings.place);
    case 'confirm-ok':return choosePlace(pending);
    case 'confirm-adjust':return startAdjust(pending);
    case 'confirm-again':return close();
    case 'set-done':return close();
    default:if(el.dataset.adjust!==undefined)adjustSetting(el,1);
  }
}

let lastBack=0;
function back(){
  const now=Date.now();if(now-lastBack<350)return;lastBack=now; // the app and the page may both report one press
  if(adj)return endAdjust();
  close();
}
window.__whatsupBack=back;

// --- Adjust position: a close-up street map (OpenFreeMap z13, about 1 mi around) and
// a fixed centre dot; the remote's arrows move the map under it, ~50 m a press,
// faster while held. OK saves, Back cancels.
const ADJ_RANGE=1,STEP_M=50;
let adj=null;
async function startAdjust(place){
  if(!place)return;
  closeAll();
  adj={place,latitude:place.latitude,longitude:place.longitude,map:null,held:0};
  PPM=R/ADJ_RANGE;stage.classList.add('adjusting');
  $('trails').replaceChildren();$('blips').replaceChildren();$('blocks').replaceChildren();
  drawAdjust();syncApp();
  setText('scope-note','Loading street map…');
  try{
    const m=await buildMap(place,ADJ_RANGE+.5,{zoom:13,detail:true});
    if(adj?.place===place){adj.map=m;setText('scope-note','');drawAdjust();}
  }catch(e){console.error('adjust map',e?.message||e);if(adj)setText('scope-note','Street map unavailable');}
}
function drawAdjust(){
  const c={latitude:adj.latitude,longitude:adj.longitude};
  drawMap(adj.map||(mapData&&{...mapData,airports:[],shields:[]}),c,ADJ_RANGE);
  const nodes=[svg('circle',{class:'ring edge',cx:CX,cy:CY,r:R})];
  for(const f of [.25,.5,.75])nodes.push(svg('circle',{class:'ring',cx:CX,cy:CY,r:R*f}));
  nodes.push(svg('line',{class:'cross',x1:CX-26,y1:CY,x2:CX+26,y2:CY}),svg('line',{class:'cross',x1:CX,y1:CY-26,x2:CX,y2:CY+26}),
    svg('circle',{class:'home-dot',cx:CX,cy:CY,r:6}));
  const m100=100/1609.344*PPM;
  nodes.push(svg('line',{class:'scale',x1:500-m100,y1:40,x2:500,y2:40}),svg('text',{class:'ring-label',x:500,y:32,'text-anchor':'end'},'100 m'));
  $('rings').replaceChildren(...nodes);
  const dy=(adj.latitude-adj.place.latitude)*111320,dx=(adj.longitude-adj.place.longitude)*111320*Math.cos(adj.place.latitude*Math.PI/180);
  const moved=Math.hypot(dx,dy);
  setText('adjust-moved',moved<1?'Not moved yet':`Moved ${moved>=1000?(moved/1000).toFixed(2)+' km':Math.round(moved)+' m'} ${compass((Math.atan2(dx,dy)*180/Math.PI+360)%360)}`);
  setText('adjust-where',adj.place.street||placeLabel(adj.place));
  setText('ring-note','Rings 400 m');
}
function nudge(dir,held){
  adj.held=held?adj.held+1:0;
  const step=STEP_M*(held?Math.min(8,1+adj.held/3):1),cos=Math.cos(adj.latitude*Math.PI/180);
  const [e,n]={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]}[dir];
  adj.latitude+=n*step/111320;adj.longitude+=e*step/(111320*cos);
  drawAdjust();
}
function endAdjust(save=false){
  const a=adj;adj=null;PPM=R/RANGE;stage.classList.remove('adjusting');setText('scope-note','');
  if(save){
    const moved=Math.abs(a.latitude-a.place.latitude)+Math.abs(a.longitude-a.place.longitude)>1e-7;
    choosePlace({...a.place,latitude:a.latitude,longitude:a.longitude,accuracyKm:moved?.05:a.place.accuracyKm,
      source:moved?'adjusted':a.place.source});
  }
  drawRings();drawMap(mapData);if(lastModel)render(lastModel);syncApp();
}

const DIRS={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'};
document.addEventListener('keydown',e=>{
  const k=e.key,dir=DIRS[k];
  if(['Escape','GoBack','BrowserBack','Back'].includes(k)||e.keyCode===4){e.preventDefault();return back();}
  if(adj){
    if(dir){e.preventDefault();return nudge(dir,e.repeat);}
    if(k==='Enter'||k===' '){e.preventDefault();return endAdjust(true);}
    return;
  }
  if(!layer){
    if(k==='Enter'||k===' '||k==='ContextMenu'||k==='Menu'||e.keyCode===82){e.preventDefault();showSettings();open('settings');}
    return;
  }
  if(dir){
    e.preventDefault();
    if((dir==='left'||dir==='right')&&focused?.dataset.adjust!==undefined)return adjustSetting(focused,dir==='left'?-1:1);
    return move(dir);
  }
  if(k==='Enter'||k===' '&&layer.id!=='locate'){e.preventDefault();return select(focused);}
  if(layer.id==='locate'){
    if(k==='Backspace'){e.preventDefault();return typeKey('del');}
    if(k===' '){e.preventDefault();return typeKey('space');}
    if(/^[a-z0-9,\-'.]$/i.test(k)){e.preventDefault();return typeKey(k.toUpperCase());}
  }
});
document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&layer?.contains(b)){setFocus(b);select(b);}});

// First launch: the IP guess, said plainly.
function showWelcome(place){
  setText('welcome-city',placeLabel(place));
  const acc=place.accuracyKm;
  setText('welcome-note',`A first guess from your internet connection${acc?` (the lookup claims within ${settings.distance==='km'?`${acc} km`:`${Math.round(acc*.621)||1} mi`})`:''}. `+
    'Internet locations are often off by 10 miles or more, so enter your ZIP or street address for a sky that matches your window.');
  open('welcome','welcome-change');
}

// --- Boot
async function boot(){
  buildKeys();
  if(query.get('reset')==='1'){saveSettings({});settings=loadSettings();}
  if(query.get('units')==='metric'){settings.distance='km';settings.altitude='m';}
  // Dev/screenshot hook: ?q=London picks the first geocoding result.
  const q=query.get('q');
  if(q){const found=await searchPlaces(q);if(found?.[0]){settings.place=found[0];settings.confirmed=true;}}
  if(settings.place){
    applyPlace(settings.place);
    if(!settings.confirmed)showWelcome(settings.place);
    // Screenshot hooks: ?screen=settings, ?screen=locate&typed=CHICAGO
    const screen=query.get('screen');
    if(screen==='settings'){showSettings();open('settings');}
    if(screen==='adjust')startAdjust(settings.place).then(()=>{for(let i=0;i<4;i++)nudge('right');nudge('up');});
    if(screen==='welcome')showWelcome({...settings.place,accuracyKm:5});
    if(screen==='locate'){showSettings();open('settings');openLocate();for(const c of (query.get('typed')||'').toUpperCase())typeKey(c===' '?'space':c);runSearch(true);setFocus($('keys').children[2]);}
    return;
  }
  setText('city','Finding your location…');drawRings();
  const place=await locateByIp();
  if(!place)return openLocate('We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.');
  settings={...settings,place,confirmed:false};saveSettings(settings);
  applyPlace(place,{fresh:true});
  showWelcome(place);
  setTimeout(()=>{if(layer?.id==='welcome')close();},60000);
}
boot();
