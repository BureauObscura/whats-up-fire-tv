'use strict';
(()=>{
const __modules=window.__whatsupModules;
const {svg,el,setText,overlap,fmt,metric,KM,placeName,alertRadius,statusText,quietText,planeIcon,byInterest,
  makeCanvas,paintMap,airportsNear,mapShift,offset,compass,number,RANGE}=__modules["kit.mjs"];
// Layout 1, Radar: the green phosphor scope (10-mile range, sweep, data blocks) and
// a panel with the hero flight, cargo tonight, today's logbook and recent sightings.

const CX=270,CY=270,R=250,PPM=R/RANGE;
const MAP=[
  {layer:'water',fill:'rgba(61,255,116,.15)'},
  {layer:'rivers',stroke:'rgba(61,255,116,.3)',width:1.4},
  {layer:'roads',classes:['trunk'],stroke:'rgba(61,255,116,.2)',width:1,dash:[4,3],cap:'butt'},
  {layer:'roads',classes:['motorway'],stroke:'rgba(61,255,116,.28)',width:1.2,dash:[4,3],cap:'butt'},
  {layer:'runways',stroke:'rgba(61,255,116,.85)',width:2.4},
];
const P=(x,y)=>({x:CX+x*PPM,y:CY-y*PPM});

let root,$={},maps={},ringBoxes=[],labelBoxes=[],demo=false;

function ui(){
  root.append(
    el('div','scope-wrap'),
    el('section','panel'));
  const wrap=root.firstChild,panel=root.lastChild;
  $.canvas=makeCanvas(540,540,'scope-map');
  $.scope=svg('svg',{class:'scope',viewBox:'0 0 540 540','aria-hidden':'true'});
  for(const id of ['rings','labels','trails','blips','blocks'])$.scope.append($[id]=svg('g'));
  $.note=el('div','scope-note');
  $.ringNote=el('div','corner br');
  wrap.append(el('div','sweep'),$.canvas,$.scope,$.note,$.ringNote,el('div','corner tr','Select ▸ Settings'));
  panel.innerHTML=`
    <header class="head"><div class="city"></div><div class="clock"></div></header>
    <div class="where"><span class="today"></span><span class="status"></span></div>
    <div class="hero">
      <div class="label hero-label">Nearest</div>
      <div class="alert" hidden></div>
      <div class="flight"><b class="fl"></b><span class="op"></span></div>
      <div class="route"></div>
      <div class="progress"><span class="bar"><i></i></span><span class="prog"></span></div>
      <div class="stats">
        <div><span>Altitude</span><b class="alt"></b></div><div><span>Speed</span><b class="spd"></b></div>
        <div><span>Look</span><b class="look"></b></div><div><span>Closest</span><b class="cpa"></b></div>
      </div>
      <div class="aircraft"></div>
    </div>
    <div class="empty-sky" hidden></div>
    <div class="lower">
      <div class="cargo"><div class="label">Cargo tonight</div><div class="cargo-row"><b class="cargo-n"></b><div class="cargo-by"></div></div></div>
      <div class="today-log"><div class="label">Today</div><div class="log"></div></div>
    </div>
    <div class="recent-wrap"><div class="label">Recently above</div><div class="recent"></div></div>`;
  for(const c of ['city','clock','today','status','hero','hero-label','alert','fl','op','route','progress','bar','prog','alt','spd','look','cpa',
    'aircraft','empty-sky','cargo-n','cargo-by','log','recent'])$[c]=panel.querySelector('.'+c);
  $.barFill=$.bar.firstChild;
}

function drawRings(){
  const nodes=[],km=metric();ringBoxes=[];
  const step=km?2/KM:1,major=km?4/KM:2,label=km?4:2;
  for(let mi=step,i=1;mi<RANGE-.01;mi+=step,i++){
    const isMajor=Math.abs(mi/major-Math.round(mi/major))<.01;
    nodes.push(svg('circle',{class:`ring${isMajor?' major':''}`,cx:CX,cy:CY,r:mi*PPM}));
    if(isMajor&&mi<RANGE-.6)nodes.push(svg('text',{class:'ring-label',x:CX+4,y:CY-mi*PPM-3},String(Math.round(i*step*(km?KM:1)/label)*label)));
  }
  nodes.push(svg('circle',{class:'ring edge',cx:CX,cy:CY,r:R}));
  nodes.push(svg('circle',{class:'ring boundary',cx:CX,cy:CY,r:alertRadius()*PPM}));
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
  $.rings.replaceChildren(...nodes);
  setText($.ringNote,`Rings ${km?'2 km':'1 mi'} · alert ${fmt.dist(alertRadius(),0)}`);
}

function drawMap(){
  paintMap($.canvas,maps,{cx:CX,cy:CY,ppm:PPM,clip:{r:R}},MAP);
  const labels=[];labelBoxes=[];
  let shown=0;
  for(const a of airportsNear(maps,RANGE-.6,12)){
    if(shown>=6||(!a.iata&&shown>=3))continue;
    const p=P(a.x,a.y),x=p.x,y=p.y+20,w=(a.iata||a.code).length*7.6+4,box={x:x-w/2,y:y-11,w,h:14};
    if(labelBoxes.some(b=>overlap(b,box)))continue;
    labelBoxes.push(box);shown++;
    labels.push(svg('text',{class:'map-airport',x,y,'text-anchor':'middle'},a.iata||a.code));
  }
  const m=maps.base,[sx,sy]=mapShift(m);
  for(const s of (m?.shields||[]).slice(0,6)){
    const x=s.x+sx,y=s.y+sy,p=P(x,y),ref=s.ref.replace(/^I /,'I-').replace(/^US /,'US-');
    const box={x:p.x-ref.length*3.2,y:p.y-9,w:ref.length*6.4,h:11};
    if(Math.hypot(x,y)>RANGE-1||Math.hypot(x,y)<1||labelBoxes.some(b=>overlap(b,box)))continue;
    labelBoxes.push(box);labels.push(svg('text',{class:'map-shield',x:p.x,y:p.y,'text-anchor':'middle'},ref));
  }
  $.labels.replaceChildren(...labels);
  setText($.note,m?'':'Drawing the map…');
}

function blockText(a){
  const ft=a.altitude_ft,vs=a.vertical>300?'↑':a.vertical<-300?'↓':'';
  const alt=fmt.altUnit()==='m'?`${(ft*.3048/1000).toFixed(1)}k`:String(Math.round(ft/100)).padStart(3,'0');
  const spd=metric()?Math.round((a.speed_kt||0)*1.852):Math.round(a.speed_kt||0);
  return [a.flight,`${alt}${vs} ${String(spd).padStart(3,'0')}`,`${a.aircraft_type||'----'} ${a.route?.destination||''}`.trim()];
}

function render(m){
  const {now,hero}=m;
  setText($.city,placeName());setText($.clock,fmt.clock(now));setText($.today,fmt.date(now,{weekday:'long',day:'numeric',month:'short'}));
  setText($.status,statusText(m,demo));$.status.classList.toggle('off',!demo&&!m.fresh&&!m.connecting);
  root.classList.toggle('emergency',!!hero?.emergency);

  const trails=[],blips=[],blocks=[],boxes=[...labelBoxes,...ringBoxes,{x:CX-6,y:CY-6,w:12,h:12}];
  const visible=m.planes.filter(a=>a.ground<=RANGE);
  const labelled=new Set(byInterest({...m,planes:visible}).slice(0,9));
  for(const a of visible){
    const p=P(a.x,a.y),isHero=a===hero;
    const dots=svg('g',{class:'trail'});
    a.trend.trail.filter((_,i,l)=>(l.length-1-i)%3===0).slice(-7,-1).forEach(s=>{
      const o=offset(s.lat,s.lon),q=P(o.x,o.y);
      dots.append(svg('circle',{cx:q.x.toFixed(1),cy:q.y.toFixed(1),r:1.3}));
    });
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
  $.trails.replaceChildren(...trails);$.blips.replaceChildren(...blips);$.blocks.replaceChildren(...blocks);

  $.hero.hidden=!hero;$['empty-sky'].hidden=!!hero;
  if(!hero)setText($['empty-sky'],quietText(m,demo));
  if(hero){
    setText($['hero-label'],`${hero.status} · ${fmt.dist(hero.distance_mi??hero.ground)}`);
    $.alert.hidden=!hero.emergency;setText($.alert,hero.emergency?`SQUAWK ${hero.squawk} · ${hero.emergency}`:'');
    setText($.fl,hero.flight);setText($.op,hero.operator||(!hero.callsign||hero.callsign===hero.registration?'Private':''));
    const r=hero.route,city=p=>p?.city?` ${p.city}`:'';
    setText($.route,r?`${r.origin}${city(r.from)}  →  ${r.destination}${city(r.to)}`:'Route not reported');
    $.progress.hidden=!hero.progress;
    if(hero.progress){$.barFill.style.width=`${Math.round(hero.progress.share*100)}%`;
      setText($.prog,`${fmt.far(hero.progress.flown)} flown · ${fmt.int(metric()?hero.progress.left*KM:hero.progress.left)} to go`);}
    const arrow=hero.trend.alt>0?' ↑':hero.trend.alt<0?' ↓':'';
    setText($.alt,number(hero.vertical)&&Math.abs(hero.vertical)>=100?`${fmt.alt(hero.altitude_ft)} ${fmt.vs(hero.vertical)}`:`${fmt.alt(hero.altitude_ft)}${arrow}`);
    setText($.spd,fmt.speed(hero.speed_kt));
    setText($.look,`${compass(hero.bearing)} · ${Math.max(0,Math.round(hero.elevation))}° up`);
    const c=hero.cpa;
    setText($.cpa,!c?'—':c.receding?'moving away':`${fmt.mmss(c.seconds)} · ${fmt.dist(c.miles)}`);
    const bits=[hero.registration,hero.year&&`built ${hero.year}`,hero.cargo&&`${hero.cargo} cargo`].filter(Boolean).join(' · ');
    $.aircraft.replaceChildren(document.createTextNode((hero.type||hero.aircraft_type||'Unknown type')+'  '),el('small','',bits));
  }

  const L=m.log;
  setText($['cargo-n'],String(L.cargoTonight).padStart(2,'0'));
  $['cargo-by'].replaceChildren(...(L.cargoBy.length?L.cargoBy.slice(0,4).map(([brand,n])=>{
    const d=el('div');d.append(`${brand} `,el('em','',n));return d;
  }):[el('div','',L.night?'none yet':'counts 6 pm to 6 am')]));
  const cell=(text,tag='span',cls='')=>el(tag,cls,text);
  $.log.replaceChildren(cell('Seen'),cell(`${fmt.int(L.today)} aircraft`,'b'),
    cell('High'),cell(L.highest?`${L.highest.name} ${fmt.alt(L.highest.value)}`:'—','b'),
    cell('Fast'),cell(L.fastest?`${L.fastest.name} ${fmt.speed(L.fastest.value)}`:'—','b'),
    cell('Rare'),cell(L.rarest?L.rarest.name:'—','b'));
  const recent=m.recent.slice(0,3);
  $.recent.replaceChildren(...(recent.length?recent.flatMap(a=>[
    cell(a.flight,'b',a.cargo?'cargo-row-t':''),
    cell([a.route&&`${a.route.origin}→${a.route.destination}`,a.type].filter(Boolean).join(' ')),
    cell(fmt.ago(a.last_seen,now),'span','t')]):[cell('Nothing inside the alert ring yet.')]));
}


window.__whatsupLayout("radar",{
  name:'Radar',map:'base',
  mount(r,c){root=r;demo=c.demo;$={};ui();drawRings();drawMap();},
  setMap(m){maps=m;drawMap();},
  render,
  refresh(){drawRings();},
  unmount(){root=null;$={};maps={};},
});
})();
