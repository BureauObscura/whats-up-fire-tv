// What's Up: the page. Owns the data (feed model, settings, maps) and the shared
// screens (Settings, location, Adjust position, layout picker); the chosen layout
// (web/layouts/<id>.mjs, loaded on demand, only one at a time) draws the dashboard.
// Remote: arrows move, Select chooses, Back closes, Select on the dashboard opens Settings.
import {CONFIG} from './config.js';
import {HISTORY_KEY,MAX_NM,store} from './live.mjs';
import {start,demo,query,compass,resetLog} from './model.mjs';
import {MAP_RADII,alertFor,loadSettings,saveSettings,locateByIp,searchPlaces,searchAddress,looksLikeAddress,placeLabel} from './place.mjs';
import {buildMap,savedMap,saveMap,buildDetail,savedDetail,saveDetail,decodeDetail,DETAIL_MAX_RANGE,detailRangeFor} from './mapgen.mjs';
import {svg,useSettings,fmt,makeCanvas,paintMap} from './kit.mjs';

const $=id=>document.getElementById(id);
const setText=(id,v)=>{const el=$(id);v=v??'';if(el&&el.textContent!==String(v))el.textContent=v;};
const stage=$('stage');
const fit=()=>{const s=Math.min(innerWidth/960,innerHeight/540);stage.style.transform=`translate(-50%,-50%) scale(${s})`;};
addEventListener('resize',fit);fit();

// --- Bridge to the Vega app: it handles the remote's Back button and asks us first.
const native=window.ReactNativeWebView;
const tellApp=msg=>{try{native?.postMessage(JSON.stringify(msg));}catch{/* desktop */}};
// Keep screen awake: the app plays a silent, invisible loop so the screensaver stays away.
const tellAwake=()=>tellApp({type:'awake',on:settings.keepAwake!==false});

let settings=loadSettings(),feed=null,lastModel=null,placeToken=0;
useSettings(settings);
const mapMiles=()=>settings.mapMiles||CONFIG.rangeMiles;
// The feed follows the map radius: adsb.fi is asked for ~1.5x the radius (wide layouts
// show that far sideways), at most its 250 NM, and polled less often over big areas.
const feedConfig=()=>{
  const r=mapMiles();
  return {...CONFIG,radiusMiles:alertFor(settings.radiusMiles,r),rangeMiles:r,
    searchNm:Math.min(MAX_NM,Math.max(CONFIG.searchNm,Math.ceil(r*1.5/1.15078))),
    pollSeconds:r<=25?CONFIG.pollSeconds:r<=100?10:15};
};
const maps={base:null,detail:null};

// --- Credits: always in Settings; on the dashboard one line that fades out ~5 s after
// the app opens, the layout changes or a new location's map is drawn.
let creditTimer=0;
function flashCredits(){
  const c=$('credit-flash');c.classList.add('on');
  clearTimeout(creditTimer);creditTimer=setTimeout(()=>c.classList.remove('on'),5000);
}

// --- Layouts. Order is the Settings order; the first is the default.
const LAYOUTS=[['radar','Radar'],['glass','Glass'],['departures','Departures'],['blueprint','Blueprint'],['atlas','Atlas'],
  ['atlas-dark','Atlas Dark'],['swiss','Swiss'],['synthwave','Synthwave'],['sectional','Sectional'],['cockpit','Cockpit'],['night-sky','Night Sky']];
const layoutName=id=>(LAYOUTS.find(([k])=>k===id)||LAYOUTS[0])[1];
const validLayout=id=>LAYOUTS.some(([k])=>k===id)?id:'radar';
// A variant reuses another layout's code with its own stylesheet on top (ctx.layout() tells it which).
const VARIANTS={'atlas-dark':'atlas'};
const codeOf=id=>VARIANTS[id]||id;
const bundled=!!window.__whatsupModules;
const registry={};
window.__whatsupLayout=(id,mod)=>{registry[id]=mod;};
function addCss(id,done){
  if(document.querySelector(`link[data-layout="${id}"]`))return done();
  const css=Object.assign(document.createElement('link'),{rel:'stylesheet',href:`layouts/${id}.css`,onload:done,onerror:done});
  css.dataset.layout=id;document.head.append(css);
}
function loadLayout(id){
  const code=codeOf(id);
  return new Promise((resolve,reject)=>{
    let waiting=code===id?2:3;
    const done=()=>{if(--waiting)return;registry[code]?resolve(registry[code]):reject(new Error(`layout ${id} failed to load`));};
    addCss(code,done);if(code!==id)addCss(id,done);
    if(registry[code])done();
    else if(bundled){
      const s=Object.assign(document.createElement('script'),{src:`layouts/${code}.js`});
      s.onload=s.onerror=()=>{s.remove();done();};document.head.append(s);
    }else import(`./layouts/${code}.mjs`).then(m=>{registry[code]=m.default;done();},e=>{console.error(e);done();});
  });
}
// Keep only the active layout's code and stylesheets so only it costs memory.
function unloadExcept(id){
  const keep=new Set([id,codeOf(id)]);
  for(const k of Object.keys(registry))if(!keep.has(k))delete registry[k];
  for(const l of document.querySelectorAll('link[data-layout]'))if(!keep.has(l.dataset.layout))l.remove();
}

let active=null,layoutToken=0;
const root=$('layout');
const ctx={settings:()=>settings,place:()=>settings.place,layout:()=>active?.id,demo};
async function useLayout(id){
  id=validLayout(id);
  if(active?.id===id)return;
  const token=++layoutToken;
  let mod;
  try{mod=await loadLayout(id);}catch(e){console.error(e.message);if(token===layoutToken&&!active&&id!=='radar')useLayout('radar');return;}
  if(token!==layoutToken)return;
  const old=active;
  if(old){
    try{old.mod.unmount?.();}catch(e){console.error('unmount',e);}
    stage.classList.remove(`L-${old.id}`,`L-${codeOf(old.id)}`);
  }
  unloadExcept(id);
  root.replaceChildren();root.className='layout';
  stage.classList.add(`L-${codeOf(id)}`,`L-${id}`);stage.dataset.layout=id;
  active={id,mod};
  if(mod.map!=='detail')maps.detail=null; // free it; it reloads from storage when needed
  try{
    mod.mount(root,ctx);
    mod.setMap?.({...maps});
    if(lastModel&&!adj)mod.render(lastModel);
  }catch(e){console.error(`layout ${id}`,e);}
  if(mod.map==='detail')ensureDetail();
  flashCredits();
}
function draw(m){
  if(!active||adj)return;
  try{active.mod.render(m);}catch(e){console.error(`render ${active.id}`,e);}
}
function mapsChanged(){
  try{active?.mod.setMap?.({...maps});}catch(e){console.error('setMap',e);}
}

// --- Detail map (streets, landuse, buildings) for the layouts that draw it.
let detailToken=0,detailBusy=false;
async function ensureDetail(){
  const place=settings.place;
  if(!place||maps.detail||detailBusy||mapMiles()>DETAIL_MAX_RANGE)return;
  const reach=detailRangeFor(mapMiles()),saved=savedDetail(place,reach);
  if(saved){maps.detail=decodeDetail(saved);return mapsChanged();}
  const token=++detailToken;detailBusy=true;
  setText('layout-note','Drawing the street map…');
  try{
    const built=await buildDetail(place,{range:reach});
    if(token!==detailToken||settings.place!==place)return;
    saveDetail(built);
    if(active?.mod.map==='detail'){maps.detail=decodeDetail(built);mapsChanged();}
    setText('layout-note','');
  }catch(e){
    console.error('detail map',e?.message||e);
    if(token===detailToken)setText('layout-note','Street map unavailable');
    setTimeout(()=>{if(token===detailToken)setText('layout-note','');},6000);
  }finally{if(token===detailToken)detailBusy=false;}
}

// --- Place, map and feed
function render(m){lastModel=m;draw(m);}
async function applyPlace(place,{fresh=false}={}){
  const token=++placeToken;
  feed?.stop();feed=null;
  if(fresh){store.remove(HISTORY_KEY);resetLog();}
  const range=mapMiles();
  maps.base=savedMap(place,range);maps.detail=null;detailToken++;detailBusy=false;
  mapsChanged();
  if(active?.mod.map==='detail')ensureDetail();
  const startFeed=()=>{if(token===placeToken&&!feed)feed=start(place,feedConfig(),render,maps.base?.airports);};
  if(!demo)startFeed();
  if(maps.base){startFeed();return;}
  for(let attempt=0;token===placeToken;attempt++){
    try{
      const m=await buildMap(place,range);
      if(token!==placeToken)return;
      maps.base=m;saveMap(m);mapsChanged();setText('layout-note','');flashCredits();
      break;
    }catch(e){
      console.error('map',e?.message||e);
      if(token!==placeToken)return;
      setText('layout-note',attempt?'Map unavailable, retrying…':'Map unavailable');
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
  settings={...settings,place,confirmed:true};saveSettings(settings);useSettings(settings);
  closeAll();
  if(changed)applyPlace(place,{fresh:true});else refreshLayout();
}
function refreshLayout(){try{active?.mod.refresh?.();}catch(e){console.error(e);}if(lastModel)draw(lastModel);}

// --- Focus and remote navigation
let layer=null,focused=null;
const layers=[];
function setFocus(el){focused?.classList.remove('focus');focused=el||null;focused?.classList.add('focus');}
// Focus must always be on something visible in the top screen.
function keepFocus(fallback){
  if(!layer||(focused&&layer.contains(focused)&&focused.offsetParent))return;
  setFocus((fallback&&layer.contains(fallback)?fallback:null)||focusables()[0]);
}
const focusables=()=>layer?[...layer.querySelectorAll('[data-focus]')].filter(el=>el.offsetParent):[];
function open(id,first){
  if(layer){layer._last=focused;layers.push(layer);}
  layer=$(id);layer.hidden=false;
  // Stack order follows opening order, not page order: a later screen must cover an earlier one.
  layer.style.zIndex=String(10+layers.length);setFocus(first?$(first):focusables()[0]);syncApp();
}
function close(){
  if(!layer)return;
  if(layer.id==='locate'&&!settings.place)return; // nothing to go back to
  if(layer.id==='picker')endPick(false);
  layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;
  if(layer){
    if(layer.id==='settings'){showSettings();setFocus($('set-layout'));}else{const last=layer._last;setFocus(last&&layer.contains(last)&&last.offsetParent?last:focusables()[0]);}
  }else setFocus(null);
  syncApp();
}
function closeAll(){while(layer){if(layer.id==='picker')endPick(false);layer.hidden=true;layer.style.zIndex='';layer=layers.pop()||null;}setFocus(null);syncApp();}
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
  const i=LAYOUTS.findIndex(([k])=>k===settings.layout);
  setText('set-layout-v',`${i+1}. ${layoutName(settings.layout)}`);
  setText('set-location-v',settings.place?[settings.place.street,placeLabel(settings.place)].filter(Boolean).join(', '):'Not set');
  const alert=alertFor(settings.radiusMiles,mapMiles());
  setText('set-radius-v',alert<settings.radiusMiles?`${fmt.dist(alert,0)} (the map radius)`:fmt.dist(settings.radiusMiles,0));
  setText('set-map-v',fmt.dist(mapMiles(),0));
  setText('set-distance-v',settings.distance==='km'?'Kilometres':'Miles');
  setText('set-altitude-v',settings.altitude==='m'?'Metres':'Feet');
  setText('set-awake-v',settings.keepAwake?'On':'Off');
}
function adjustSetting(el,dir){
  if(el.id==='set-layout')return startPick(dir);
  if(el.id==='set-radius')settings.radiusMiles=RADII[Math.max(0,Math.min(RADII.length-1,RADII.indexOf(settings.radiusMiles)+dir))];
  else if(el.id==='set-map')return stepMap(dir);
  else if(el.id==='set-distance')settings.distance=settings.distance==='km'?'mi':'km';
  else if(el.id==='set-altitude')settings.altitude=settings.altitude==='m'?'ft':'m';
  else if(el.id==='set-awake'){settings.keepAwake=!settings.keepAwake;saveSettings(settings);showSettings();return tellAwake();}
  else return;
  saveSettings(settings);useSettings(settings);showSettings();
  if(el.id==='set-radius'&&settings.place){refreshLayout();applyPlace(settings.place);} // the feed's alert radius
  else refreshLayout();
}

// Map radius: Settings > Map radius, or Up/Down on the dashboard. The view redraws at
// once (the current map, rescaled); the map for the new radius and the wider or
// narrower feed follow after a short pause, so stepping through sizes is cheap.
let mapTimer=0,toastTimer=0;
function stepMap(dir){
  const i=MAP_RADII.indexOf(mapMiles()),next=MAP_RADII[Math.max(0,Math.min(MAP_RADII.length-1,(i<0?2:i)+dir))];
  if(next===mapMiles())return toast(`Map radius ${fmt.dist(next,0)} (${dir<0?'closest':'widest'})`);
  settings.mapMiles=next;saveSettings(settings);useSettings(settings);
  if(layer?.id==='settings')showSettings();
  toast(`Map radius ${fmt.dist(next,0)}${alertFor(settings.radiusMiles,next)<settings.radiusMiles?` · alert ring ${fmt.dist(next,0)}`:''}`);
  if(next>DETAIL_MAX_RANGE||maps.detail&&maps.detail.range<detailRangeFor(next))maps.detail=null;
  mapsChanged();refreshLayout();
  clearTimeout(mapTimer);
  mapTimer=setTimeout(()=>{if(settings.place)applyPlace(settings.place);},700);
}
function toast(text){
  const t=$('toast');t.textContent=text;t.classList.add('on');
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('on'),1800);
}

// Layout picker: the dashboard behind the bar is the real layout, switched live.
let pick=null;
function startPick(dir){
  pick={index:Math.max(0,LAYOUTS.findIndex(([k])=>k===settings.layout))};
  stage.classList.add('picking');
  open('picker');setFocus(null);
  if(dir)stepPick(dir);else showPick();
}
function showPick(){
  setText('pick-count',`Layout ${pick.index+1} of ${LAYOUTS.length}`);
  setText('pick-name',LAYOUTS[pick.index][1]);
}
function stepPick(dir){
  pick.index=(pick.index+dir+LAYOUTS.length)%LAYOUTS.length;showPick();
  const btn=$(dir<0?'pick-prev':'pick-next');btn.classList.add('focus');setTimeout(()=>btn.classList.remove('focus'),180);
  useLayout(LAYOUTS[pick.index][0]);
}
// keep: save the previewed layout; else go back to the saved one.
function endPick(keep){
  if(!pick)return;
  const id=LAYOUTS[pick.index][0];pick=null;stage.classList.remove('picking');
  if(keep){settings.layout=id;saveSettings(settings);useLayout(id);}
  else useLayout(settings.layout);
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
// request per search, as Nominatim's usage policy asks). Every search ends in results,
// "no match", or an error with Retry; focus never falls off the screen.
const SEARCH_LIMIT_MS=25000;
async function runSearch(explicit=false){
  clearTimeout(searchTimer);
  const q=entry.trim(),seq=++searchSeq,box=$('results'),searchKey=$('keys').querySelector('[data-key="search"]');
  const show=(...nodes)=>{box.replaceChildren(...nodes);keepFocus(searchKey);};
  const msg=(text,cls='msg')=>Object.assign(document.createElement('div'),{className:cls,textContent:text});
  const retry=()=>{const b=document.createElement('button');b.dataset.focus='';b.id='search-retry';b.className='retry';b.textContent='Try again';return b;};
  if(q.length<2){
    if(explicit)show(msg('Type a ZIP or postal code, a city, or a street address first.'));else show();
    return;
  }
  const address=looksLikeAddress(q);
  if(address&&!explicit)return show(msg('Street address: press Search when done.'));
  show(msg(`Searching for “${q}”…`,'msg busy'));
  const elsewhere=settings.place?.countryCode&&settings.place.countryCode!=='US'&&settings.place.source!=='ip';
  const work=(async()=>{
    let found=address?await searchAddress(q,{skipCensus:elsewhere}):await searchPlaces(q);
    // Postcodes Open-Meteo doesn't know (e.g. UK "SW1A 2AA"): try the address geocoders once.
    if(!address&&explicit&&found&&!found.length)found=await searchAddress(q,{skipCensus:elsewhere});
    return found;
  })().catch(e=>{console.error('search',e?.message||e);return null;});
  const found=await Promise.race([work,new Promise(r=>setTimeout(()=>r('timeout'),SEARCH_LIMIT_MS))]);
  if(seq!==searchSeq||layer?.id!=='locate'&&!layers.some(l=>l.id==='locate'))return;
  lastQuery=q;
  if(found==='timeout'||!found){
    show(msg(found?'The search is taking too long.':'Search is unavailable. Check the connection.'),retry());
    if(explicit&&layer?.id==='locate')setFocus($('search-retry'));
    return;
  }
  if(!found.length)return show(msg(`No places match “${q}”. Check the spelling, or try a ZIP or postal code.`));
  show(...found.slice(0,5).map(p=>{
    const b=document.createElement('button');b.dataset.focus='';
    b.append(p.street||placeLabel(p),Object.assign(document.createElement('small'),{textContent:p.street?placeLabel(p):[p.admin,p.country].filter(Boolean).join(', ')}));
    b._place=p;return b;
  }));
  // After Search, go to the first match; while typing, stay on the keyboard.
  if(explicit&&layer?.id==='locate')setFocus(box.firstElementChild);
}
let lastQuery='';
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
    case 'set-layout':return startPick(0);
    case 'set-location':return openLocate();
    case 'set-adjust':return startAdjust(settings.place);
    case 'confirm-ok':return choosePlace(pending);
    case 'confirm-adjust':return startAdjust(pending);
    case 'confirm-again':return close();
    case 'set-done':return close();
    case 'pick-prev':return stepPick(-1);
    case 'pick-next':return stepPick(1);
    case 'search-retry':entry=lastQuery||entry;setText('entry-text',entry);setFocus($('keys').querySelector('[data-key="search"]'));return runSearch(true);
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
// faster while held. OK saves, Back cancels. Always drawn in the green scope style.
const ADJ_RANGE=1,STEP_M=50,ACX=270,ACY=270,AR=250;
const ADJ_MAP=[
  {layer:'water',fill:'rgba(61,255,116,.15)'},
  {layer:'rivers',stroke:'rgba(61,255,116,.3)',width:1.4},
  {layer:'roads',not:['motorway','trunk','primary','secondary'],stroke:'rgba(61,255,116,.32)',width:1},
  {layer:'roads',classes:['motorway','trunk','primary','secondary'],stroke:'rgba(61,255,116,.55)',width:2},
  {layer:'runways',stroke:'rgba(61,255,116,.85)',width:2.4},
];
let adj=null;
async function startAdjust(place){
  if(!place)return;
  closeAll();
  adj={place,latitude:place.latitude,longitude:place.longitude,map:null,held:0,canvas:makeCanvas(540,540)};
  $('adjust-map').replaceChildren(adj.canvas);
  stage.classList.add('adjusting');
  drawAdjust();syncApp();
  setText('adjust-note','Loading street map…');
  try{
    const m=await buildMap(place,ADJ_RANGE+.5,{zoom:13,detail:true});
    if(adj?.place===place){adj.map=m;setText('adjust-note','');drawAdjust();}
  }catch(e){console.error('adjust map',e?.message||e);if(adj)setText('adjust-note','Street map unavailable');}
}
function drawAdjust(){
  const c={latitude:adj.latitude,longitude:adj.longitude},ppm=AR/ADJ_RANGE;
  paintMap(adj.canvas,{base:adj.map||maps.base},{cx:ACX,cy:ACY,ppm,clip:{r:AR},center:c,fixed:true},ADJ_MAP);
  const nodes=[svg('circle',{class:'ring edge',cx:ACX,cy:ACY,r:AR})];
  for(const f of [.25,.5,.75])nodes.push(svg('circle',{class:'ring',cx:ACX,cy:ACY,r:AR*f}));
  nodes.push(svg('line',{class:'cross',x1:ACX-26,y1:ACY,x2:ACX+26,y2:ACY}),svg('line',{class:'cross',x1:ACX,y1:ACY-26,x2:ACX,y2:ACY+26}),
    svg('circle',{class:'home-dot',cx:ACX,cy:ACY,r:6}));
  const m100=100/1609.344*ppm;
  nodes.push(svg('line',{class:'scale',x1:500-m100,y1:40,x2:500,y2:40}),svg('text',{class:'label',x:500,y:32,'text-anchor':'end'},'100 m'),
    svg('text',{class:'label',x:528,y:528,'text-anchor':'end'},'Rings 400 m'));
  $('adjust-marks').replaceChildren(...nodes);
  const dy=(adj.latitude-adj.place.latitude)*111320,dx=(adj.longitude-adj.place.longitude)*111320*Math.cos(adj.place.latitude*Math.PI/180);
  const moved=Math.hypot(dx,dy);
  setText('adjust-moved',moved<1?'Not moved yet':`Moved ${moved>=1000?(moved/1000).toFixed(2)+' km':Math.round(moved)+' m'} ${compass((Math.atan2(dx,dy)*180/Math.PI+360)%360)}`);
  setText('adjust-where',adj.place.street||placeLabel(adj.place));
}
function nudge(dir,held){
  adj.held=held?adj.held+1:0;
  const step=STEP_M*(held?Math.min(8,1+adj.held/3):1),cos=Math.cos(adj.latitude*Math.PI/180);
  const [e,n]={up:[0,1],down:[0,-1],left:[-1,0],right:[1,0]}[dir];
  adj.latitude+=n*step/111320;adj.longitude+=e*step/(111320*cos);
  drawAdjust();
}
function endAdjust(save=false){
  const a=adj;adj=null;stage.classList.remove('adjusting');setText('adjust-note','');$('adjust-map').replaceChildren();
  if(save){
    const moved=Math.abs(a.latitude-a.place.latitude)+Math.abs(a.longitude-a.place.longitude)>1e-7;
    choosePlace({...a.place,latitude:a.latitude,longitude:a.longitude,accuracyKm:moved?.05:a.place.accuracyKm,
      source:moved?'adjusted':a.place.source});
  }
  if(lastModel)draw(lastModel);syncApp();
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
    // Up/Down on the dashboard: zoom the map in/out (Settings > Map radius).
    if(dir==='up'||dir==='down'){e.preventDefault();return stepMap(dir==='up'?-1:1);}
    if(k==='Enter'||k===' '||k==='ContextMenu'||k==='Menu'||e.keyCode===82){e.preventDefault();showSettings();open('settings');}
    return;
  }
  if(layer.id==='picker'){
    e.preventDefault();
    if(dir==='left'||dir==='up')return stepPick(-1);
    if(dir==='right'||dir==='down')return stepPick(1);
    if(k==='Enter'||k===' '){endPick(true);return close();}
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
  tellAwake();
  if(query.get('reset')==='1'){saveSettings({});settings=loadSettings();}
  if(query.get('units')==='metric'){settings.distance='km';settings.altitude='m';}
  // Screenshot hook: ?map=50 sets the map radius for this launch.
  if(MAP_RADII.includes(Number(query.get('map'))))settings.mapMiles=Number(query.get('map'));
  // Screenshot hook: ?layout=atlas shows that layout for this launch.
  if(query.get('layout'))settings.layout=validLayout(query.get('layout'));
  settings.layout=validLayout(settings.layout);
  useSettings(settings);
  // Dev/screenshot hook: ?q=London picks the first geocoding result.
  const q=query.get('q');
  if(q){const found=await searchPlaces(q);if(found?.[0]){settings.place=found[0];settings.confirmed=true;useSettings(settings);}}
  useLayout(settings.layout);
  if(settings.place){
    applyPlace(settings.place);
    if(!settings.confirmed)showWelcome(settings.place);
    // Screenshot hooks: ?screen=settings|picker|welcome|adjust, ?screen=locate&typed=CHICAGO
    const screen=query.get('screen');
    if(screen==='settings'){showSettings();open('settings');}
    if(screen==='picker'){showSettings();open('settings');startPick(0);}
    if(screen==='adjust')startAdjust(settings.place).then(()=>{for(let i=0;i<4;i++)nudge('right');nudge('up');});
    if(screen==='welcome')showWelcome({...settings.place,accuracyKm:5});
    if(screen==='locate'){showSettings();open('settings');openLocate();for(const c of (query.get('typed')||'').toUpperCase())typeKey(c===' '?'space':c);runSearch(true);setFocus($('keys').children[2]);}
    return;
  }
  setText('layout-note','Finding your location…');
  const place=await locateByIp();
  setText('layout-note','');
  if(!place)return openLocate('We couldn’t find your location automatically. Type a ZIP or postal code, or a city name.');
  settings={...settings,place,confirmed:false};saveSettings(settings);useSettings(settings);
  applyPlace(place,{fresh:true});
  showWelcome(place);
  setTimeout(()=>{if(layer?.id==='welcome')close();},60000);
}
boot();
