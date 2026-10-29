// Line counts of every dashboard text element, old build vs new build, same data at the same time.
import {readFileSync,mkdtempSync,writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FEEDS={ORD:JSON.parse(readFileSync(new URL('./ord-feed.json',import.meta.url))),CVG:JSON.parse(readFileSync(new URL('./cvg-feed.json',import.meta.url)))};
async function page(feed){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,'--user-data-dir='+mkdtempSync(tmpdir()+'/ln'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  if(feed)await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const FEED=${JSON.stringify(feed)};let v;
    Object.defineProperty(window,'ReactNativeWebView',{configurable:true,get:()=>v,set:b=>{const pm=b.postMessage.bind(b);
      b.postMessage=d=>{const r=JSON.parse(d);if(/opendata\\.adsb\\.fi/.test(r.url||''))return setTimeout(()=>window.__whatsupReply(r.id,200,JSON.stringify({...FEED,now:Date.now()})),30);pm(d);};v=b;}});})();`});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value;
  return {send,ev,close(){ws.close();chrome.kill();}};
}
const MEASURE=`(()=>{const out={};const root=document.getElementById('layout');
  const path=e=>{const p=[];for(let x=e;x&&x!==root;x=x.parentElement){const i=x.parentElement?[...x.parentElement.children].indexOf(x):0;p.unshift(x.tagName+'.'+(typeof x.className==='string'?x.className.split(' ')[0]:'')+':'+i);}return p.join('>');};
  for(const e of root.querySelectorAll('*')){if(e.children.length||!(e.textContent||'').trim()||e.closest('svg'))continue;
    const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden')continue;const r=e.getBoundingClientRect();if(!r.width||!r.height)continue;
    const lh=parseFloat(cs.lineHeight)||parseFloat(cs.fontSize)*1.2;out[path(e)]={lines:Math.max(1,Math.round(r.height/lh)),t:e.textContent.slice(0,40),fit:!!e.style.fontSize,wrap:e.style.whiteSpace==='normal'};}
  return out;})()`;
const L=['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
const SC=[['ORD feed','q=Chicago&map=15','ORD'],['CVG feed','q=Cincinnati&map=15','CVG'],['demo long','q=Chicago&demo=1&scene=long&map=10',null],['demo','q=Cincinnati&demo=1&map=10',null]];
let rows=0,oneOld=0,changed=[],multiOld=0,multiNew=0,wraps=0;
for(const [name,qs,f] of SC)for(const layout of L){
  const [a,b]=await Promise.all([page(f&&FEEDS[f]),page(f&&FEEDS[f])]);
  await Promise.all([a.send('Page.navigate',{url:`http://localhost:8791/index.html?${qs}&layout=${layout}`}),b.send('Page.navigate',{url:`http://localhost:8775/index.html?${qs}&layout=${layout}`})]);
  await sleep(12000);
  const [o,n]=await Promise.all([a.ev(MEASURE),b.ev(MEASURE)]);a.close();b.close();
  for(const k of Object.keys(o||{})){if(!n||!n[k])continue;rows++;if(o[k].lines===1)oneOld++;else multiOld++;if(n[k].lines>1)multiNew++;if(n[k].wrap)wraps++;
    if(o[k].lines===1&&n[k].lines>1)changed.push(`${name} ${layout} ${k.split('>').slice(-2).join('>')} "${n[k].t}" ${o[k].lines}->${n[k].lines}`);}
  console.log(name.padEnd(9),layout.padEnd(16),'elements',Object.keys(o||{}).length,Object.keys(n||{}).length);
}
console.log({rows,oneLineOld:oneOld,multiOld,multiNew,wrapApplied:wraps,oneToTwo:changed.length});for(const c of changed)console.log(' ',c);
