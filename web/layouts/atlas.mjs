// Layout 5, Atlas: a light, fully detailed printed city map (landuse, parks, water,
// buildings, every road class with casings, rail, aeroways, place names) with planes
// as bold markers and trails, and a slim side column carrying the most data of any
// layout: hero flight, route and progress, six stats, cargo tonight, today, recent.
// Layout 6, Atlas Dark, is the same code with the DARK palette and atlas-dark.css.
import {svg,el,setText,fmt,placeName,statusText,quietText,planeIcon,byInterest,makeCanvas,paintMap,toView,placesNear,
  airfieldsNear,shortField,cityName,compass,number,TrailBook,placeBox,metric,KM,alertRadius,ppmOf,niceDistance,range,overlap} from '../kit.mjs';

const DETAIL_MAX=15; // the street map is drawn up to this map radius (mapgen DETAIL_MAX_RANGE)
const W=700,H=540,VIEW={cx:350,cy:276,ppm:54,clip:{x:0,y:0,w:W,h:H}};
const road=(classes,casing,fill,cw,fw)=>[{layer:'roads',from:'detail',classes,stroke:casing,width:cw},{layer:'roads',from:'detail',classes,stroke:fill,width:fw}];
const DETAIL=[
  {layer:'landuse',classes:['residential'],fill:'#ece6da'},
  {layer:'landuse',classes:['commercial','retail'],fill:'#f2e0d8'},
  {layer:'landuse',classes:['industrial','railway','military'],fill:'#e6e0e8'},
  {layer:'landuse',classes:['school','university','college','hospital'],fill:'#f0e8cc'},
  {layer:'landuse',classes:['cemetery'],fill:'#d6e2cc'},
  {layer:'parks',classes:['wood'],fill:'#c6dbb1'},
  {layer:'parks',not:['wood'],fill:'#d2e6c2'},
  {layer:'landuse',classes:['stadium','pitch','playground','zoo','theme_park'],fill:'#cbe3bf'},
  {layer:'aero',classes:['aerodrome','apron'],fill:'#e2dfea'},
  {layer:'water',from:'detail',fill:'#a6cae0',stroke:'#8fb6cf',width:.6},
  {layer:'waterways',classes:['river','canal'],stroke:'#a6cae0',width:2.2},
  {layer:'waterways',classes:['stream'],stroke:'#a6cae0',width:1},
  {layer:'buildings',fill:'#d9cfbf',stroke:'#c3b59f',width:.35},
  {layer:'aero',classes:['taxiway'],stroke:'#bdb7cf',width:1.4},
  {layer:'aero',classes:['runway'],stroke:'#a29bb8',width:4.5,cap:'butt'},
  {layer:'roads',from:'detail',classes:['service'],stroke:'#fffdf8',width:.7},
  ...road(['minor'],'#d3cbbd','#fffdf8',2.1,1.2),
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#8d877d',width:1.1},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#f6f2ea',width:.6,dash:[4,4],cap:'butt'},
  ...road(['tertiary'],'#c9bfae','#fffaf0',3,2),
  ...road(['secondary'],'#d2ad5c','#fbe4a2',3.6,2.5),
  ...road(['primary','trunk'],'#cd8f42','#f8c574',4.2,3),
  ...road(['motorway'],'#b0612f','#ef9656',5,3.6),
];
// Atlas Dark: charcoal land, muted water, roads in greys (major ones brighter), faint buildings.
const DARK_DETAIL=[
  {layer:'landuse',classes:['residential'],fill:'#1a1d22'},
  {layer:'landuse',classes:['commercial','retail'],fill:'#1e1d22'},
  {layer:'landuse',classes:['industrial','railway','military'],fill:'#1c1d24'},
  {layer:'landuse',classes:['school','university','college','hospital'],fill:'#1f1f1e'},
  {layer:'landuse',classes:['cemetery'],fill:'#192119'},
  {layer:'parks',classes:['wood'],fill:'#16221a'},
  {layer:'parks',not:['wood'],fill:'#18241b'},
  {layer:'landuse',classes:['stadium','pitch','playground','zoo','theme_park'],fill:'#1a251c'},
  {layer:'aero',classes:['aerodrome','apron'],fill:'#1e1f27'},
  {layer:'water',from:'detail',fill:'#0f2230',stroke:'#173244',width:.6},
  {layer:'waterways',classes:['river','canal'],stroke:'#173244',width:2.2},
  {layer:'waterways',classes:['stream'],stroke:'#163040',width:1},
  {layer:'buildings',fill:'#24272d',stroke:'#2c3036',width:.35},
  {layer:'aero',classes:['taxiway'],stroke:'#3a3b46',width:1.4},
  {layer:'aero',classes:['runway'],stroke:'#585a69',width:4.5,cap:'butt'},
  {layer:'roads',from:'detail',classes:['service'],stroke:'#2b2e34',width:.7},
  ...road(['minor'],'#16181c','#33363d',2.1,1.2),
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#44464d',width:1.1},
  {layer:'roads',from:'detail',classes:['rail'],stroke:'#1a1c20',width:.6,dash:[4,4],cap:'butt'},
  ...road(['tertiary'],'#16181c','#41454c',3,2),
  ...road(['secondary'],'#16181c','#53575f',3.6,2.5),
  ...road(['primary','trunk'],'#16181c','#696e78',4.2,3),
  ...road(['motorway'],'#16181c','#868c97',5,3.6),
];
const DARK_BASE=[
  {layer:'water',fill:'#0f2230'},
  {layer:'rivers',stroke:'#173244',width:2.2},
  {layer:'roads',classes:['trunk'],stroke:'#696e78',width:2.8},
  {layer:'roads',classes:['motorway'],stroke:'#868c97',width:3.6},
  {layer:'runways',stroke:'#585a69',width:4},
];
const BASE=[
  {layer:'water',fill:'#a6cae0'},
  {layer:'rivers',stroke:'#a6cae0',width:2.2},
  {layer:'roads',classes:['trunk'],stroke:'#cd8f42',width:4},{layer:'roads',classes:['trunk'],stroke:'#f8c574',width:2.8},
  {layer:'roads',classes:['motorway'],stroke:'#b0612f',width:5},{layer:'roads',classes:['motorway'],stroke:'#ef9656',width:3.6},
  {layer:'runways',stroke:'#a29bb8',width:4},
];

let root,demo,dark=false,$={},maps={},trails=new TrailBook(360000,4000),staticBoxes=[];

function ui(){
  const map=el('div','at-map'),side=el('aside','at-side');
  $.canvas=makeCanvas(W,H,'at-canvas');
  $.labels=svg('svg',{class:'at-svg',viewBox:`0 0 ${W} ${H}`});
  $.over=svg('svg',{class:'at-svg',viewBox:`0 0 ${W} ${H}`});
  for(const k of ['ring','trails','marks','tags'])$.over.append($[k]=svg('g',{class:`at-${k}`}));
  $.scale=el('div','at-scale');$.note=el('div','at-note');
  const north=el('div','at-north');north.innerHTML='<b>N</b><i></i>';
  map.append($.canvas,$.labels,$.over,north,$.scale,$.note);
  side.innerHTML=`
    <div class="at-top"><header><div class="at-city"></div><div class="at-time"><b class="at-clock"></b><span class="at-status"></span></div></header>
    <div class="at-date"></div></div>
    <section class="at-hero">
      <div class="at-alert" hidden></div>
      <div class="at-kicker"></div>
      <div class="at-flight"><b class="at-fl"></b><div class="at-op"></div></div>
      <div class="at-route"></div>
      <div class="at-prog"><span class="at-bar"><i></i></span><span class="at-progt"></span></div>
      <dl class="at-stats">
        <div><dt>Altitude</dt><dd class="at-alt"></dd></div><div><dt>Speed</dt><dd class="at-spd"></dd></div>
        <div><dt>Climb</dt><dd class="at-vs"></dd></div><div><dt>Heading</dt><dd class="at-hdg"></dd></div>
        <div><dt>Look</dt><dd class="at-look"></dd></div><div><dt>Closest</dt><dd class="at-cpa"></dd></div>
      </dl>
      <div class="at-type"></div><div class="at-reg"></div>
    </section>
    <section class="at-quiet" hidden></section>
    <section class="at-books">
      <div class="at-cargo"><b class="at-cargo-n"></b><div><h4>Cargo tonight</h4><div class="at-cargo-by"></div></div></div>
      <h4>Today</h4><dl class="at-log"></dl>
    </section>
    <section class="at-recent"><h4>Recently above</h4><div class="at-rec"></div></section>`;
  for(const c of ['city','clock','status','date','hero','alert','kicker','fl','op','route','prog','bar','progt','alt','spd','vs','hdg','look','cpa',
    'type','reg','quiet','cargo-n','cargo-by','log','rec'])$[c]=side.querySelector('.at-'+c);
  $.barFill=$.bar.firstChild;
  root.append(map,side);
}

function drawMap(){
  paintMap($.canvas,maps,VIEW,maps.detail?(dark?DARK_DETAIL:DETAIL):(dark?DARK_BASE:BASE));
  setText($.note,maps.detail||maps.base&&range()>DETAIL_MAX?'':maps.base?'Drawing streets…':'Drawing the map…');
  // Labels, set once per map with a halo like print. Up to 15 mi: no place names, just the
  // airports with an official code (IATA/ICAO/FAA), each a ring marker (never a plane
  // shape: planes are the aircraft) with "CODE Name". Wider: those airports, then cities.
  // Any map label under a flight tag is hidden while the tag is there (see render).
  const home=toView(VIEW,0,0),nodes=[];staticBoxes=[{x:home.x-10,y:home.y-12,w:66,h:24}];
  const bounds={x:6,y:6,w:W-12,h:H-40},wide=range()>DETAIL_MAX;
  const field=a=>{
    const p=toView(VIEW,a.x,a.y);
    if(p.x<8||p.x>W-8||p.y<8||p.y>H-34)return;
    const name=shortField(a.name),major=a.kind==='international'||a.kind==='regional'||a.kind==='public';
    const w=(a.code?a.code.length*8.6+8:0)+name.length*6.6+16,h=17;
    const b=placeBox(staticBoxes,p,w,h,[[10,-h/2],[-w-10,-h/2],[-w/2,9],[-w/2,-h-9]],bounds);
    if(!b&&wide)return;
    staticBoxes.push({x:p.x-7,y:p.y-7,w:14,h:14});
    const g=svg('g',{class:'at-fieldg'});
    g.append(svg('circle',{class:`at-fieldm${major?' major':''}`,cx:p.x,cy:p.y,r:major?5.5:4.5}));
    if(b){
      const t=svg('text',{class:'at-field',x:b.x+2,y:b.y+13});
      t.append(svg('tspan',{class:'at-fieldc'},`${a.code} `),svg('tspan',{},name));g.append(t);
    }
    g._box=b?{x:Math.min(b.x,p.x-7),y:Math.min(b.y,p.y-7),w:Math.max(b.x+w,p.x+7)-Math.min(b.x,p.x-7),h:Math.max(b.y+h,p.y+7)-Math.min(b.y,p.y-7)}:{x:p.x-7,y:p.y-7,w:14,h:14};
    nodes.push(g);
  };
  // Coded airports claim their space first, then (wide) the cities. Uncoded fields
  // (farm strips, ultralight parks) aren't shown.
  airfieldsNear(maps,7).filter(a=>a.code).forEach(field);
  if(wide)for(const pl of placesNear(maps,7,{kinds:['city','town'],max:40})){
    const p=toView(VIEW,pl.x,pl.y),big=pl.c==='city',name=big?pl.name.toUpperCase():pl.name;
    const size=big?15:12.5,w=name.length*size*(big?.66:.52)+6,h=size+4;
    if(staticBoxes.length>44)break;
    const b=placeBox(staticBoxes,p,w,h,[[-w/2,-h/2]],bounds);if(!b)continue;
    const t=svg('text',{class:`at-place ${big?'big':''}`,x:b.x+w/2,y:b.y+h-4,'text-anchor':'middle'},name);
    t._box=b;nodes.push(t);
  }
  $.labels.replaceChildren(...nodes);
  // Scale bar: a round distance about 60 px long at the current map radius.
  const bar=niceDistance(VIEW,60);
  $.scale.innerHTML=`<i style="width:${bar.px.toFixed(0)}px"></i><span>${bar.label}</span>`;
}

function render(m){
  const {now,hero}=m;
  setText($.city,cityName()||placeName());setText($.clock,fmt.clock(now));
  setText($.date,fmt.date(now));
  // Status only when it matters (Connecting / No signal); Live and Preview go unsaid.
  const status=statusText(m,demo);setText($.status,status==='Live'||status==='Preview'?'':status);
  $.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);
  trails.update(m.planes,now);

  // Alert ring around home.
  const h=toView(VIEW,0,0),rr=alertRadius()*ppmOf(VIEW);
  $.ring.replaceChildren(svg('circle',{class:'at-alertring',cx:h.x,cy:h.y,r:rr}),
    svg('circle',{class:'at-home',cx:h.x,cy:h.y,r:6}),svg('text',{class:'at-homet',x:h.x+10,y:h.y+4},'HOME'));

  // Tags sit on white chips over the place names, so they only avoid each other and home.
  const lines=[],marks=[],tags=[],boxes=[{x:h.x-8,y:h.y-8,w:52,h:16}];
  const bounds={x:4,y:4,w:W-8,h:H-34};
  const ranked=byInterest(m);
  for(const a of ranked){
    const p=toView(VIEW,a.x,a.y);
    if(p.x<-20||p.x>W+20||p.y<-20||p.y>H+20)continue;
    const isHero=a===hero,t=trails.get(a.hex);
    if(t.length>1)lines.push(svg('polyline',{class:`at-trail${isHero?' hero':''}`,points:[...t.map(s=>toView(VIEW,s.x,s.y)),p].map(q=>`${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ')}));
    if(isHero)marks.push(svg('circle',{class:'at-target',cx:p.x,cy:p.y,r:19}));
    marks.push(planeIcon(a,p,isHero?28:21,`at-plane${isHero?' hero':''}${a.cargo?' cargo':''}`));
    if(tags.length>=7*2&&!isHero)continue;
    const text=`${a.flight}  ${fmt.alt(a.altitude_ft)}`,w=text.length*7.1+14,hh=22;
    const b=placeBox(boxes,p,w,hh,[[16,-hh-6],[-w-16,-hh-6],[16,8],[-w-16,8]],bounds);
    if(!b)continue;
    tags.push(svg('rect',{class:`at-tag${isHero?' hero':''}`,x:b.x,y:b.y,width:w,height:hh,rx:3}),
      svg('text',{class:`at-tagt${isHero?' hero':''}`,x:b.x+7,y:b.y+15.5},text));
  }
  $.trails.replaceChildren(...lines);$.marks.replaceChildren(...marks);$.tags.replaceChildren(...tags);
  // Map labels give way to flight tags: hidden while a tag covers them.
  const tagBoxes=boxes.slice(1);
  for(const n of $.labels.children)if(n._box)n.style.visibility=tagBoxes.some(t=>overlap(t,n._box))?'hidden':'';

  $.hero.hidden=!hero;$.quiet.hidden=!!hero;
  if(!hero)setText($.quiet,quietText(m,demo));
  if(hero){
    $.alert.hidden=!hero.emergency;setText($.alert,hero.emergency?`Squawk ${hero.squawk} · ${hero.emergency}`:'');
    setText($.kicker,`${hero.status} · ${fmt.dist(hero.ground)} ${compass(hero.bearing)}`);
    setText($.fl,hero.flight);setText($.op,hero.operator||(!hero.callsign||hero.callsign===hero.registration?'Private':''));
    const r=hero.route;
    setText($.route,r?`${r.from?.city||r.origin} → ${r.to?.city||r.destination}`:'Route not reported');
    $.prog.hidden=!hero.progress;
    if(hero.progress){$.barFill.style.width=`${Math.round(hero.progress.share*100)}%`;
      setText($.progt,`${r.origin} ${fmt.far(hero.progress.flown)} · ${fmt.far(hero.progress.left)} ${r.destination}`);}
    setText($.alt,fmt.alt(hero.altitude_ft));setText($.spd,fmt.speed(hero.speed_kt));
    setText($.vs,fmt.vs(hero.vertical));setText($.hdg,number(hero.heading)?`${String(Math.round(hero.heading)).padStart(3,'0')}° ${compass(hero.heading)}`:'—');
    setText($.look,`${compass(hero.bearing)} ${Math.max(0,Math.round(hero.elevation))}°`);
    const c=hero.cpa;setText($.cpa,!c?'—':c.receding?'passed':`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles)}`);
    setText($.type,hero.type||hero.aircraft_type||'Unknown type');
    setText($.reg,[hero.registration,hero.year&&`built ${hero.year}`].filter(Boolean).join(' · '));
  }
  const L=m.log;
  setText($['cargo-n'],L.cargoTonight);
  setText($['cargo-by'],L.cargoBy.length?L.cargoBy.slice(0,4).map(([b,n])=>`${b} ${n}`).join(' · '):L.night?'none yet':'counted 6 pm – 6 am');
  const cell=(k,v,cls='')=>{const d=el('div',cls);d.append(el('dt','',k),el('dd','',v));return d;};
  $.log.replaceChildren(cell('Seen',fmt.int(L.today)),cell('Highest',L.highest?fmt.alt(L.highest.value):'—'),
    cell('Fastest',L.fastest?fmt.speed(L.fastest.value):'—'),cell('Rarest',L.rarest?L.rarest.name:'—','wide'),
    cell('Farthest',L.farthest?`${L.farthest.name} · ${L.farthest.from} · ${fmt.far(L.farthest.value)}`:'—','wide far'));
  const rec=m.recent.slice(0,hero?3:5);
  $.rec.replaceChildren(...(rec.length?rec.map(a=>{
    const d=el('div','at-rr');d.append(el('b','',a.flight),el('span','',[a.route&&`${a.route.origin}–${a.route.destination}`,a.aircraft_type].filter(Boolean).join(' ')),el('i','',fmt.ago(a.last_seen,now)));return d;
  }):[el('div','at-rr none','Nothing inside the alert ring yet.')]));
  // Nothing is cut short: long names wrap, and the sections spread down the full
  // column. If a busy hero leaves no room, Recent goes (its space is shared out by
  // the column), then the type tightens.
  const side=$.rec.closest('.at-side'),sec=$.rec.parentNode;
  side.classList.remove('tight','tighter');sec.hidden=false;
  const over=()=>side.scrollHeight>side.clientHeight+1;
  if(over())sec.hidden=true;
  if(over())side.classList.add('tight');
  if(over())side.classList.add('tighter');
}

export default {
  name:'Atlas',map:'detail',
  mount(r,c){root=r;demo=c.demo;dark=c.layout?.()==='atlas-dark';$={};trails.clear();ui();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawMap();},
  unmount(){root=null;$={};maps={};trails.clear();},
};
