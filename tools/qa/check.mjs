// Credit line: shown ≥5 s, inside the 5% title-safe area, topmost, with both credits, in all 12 layouts.
import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';
const BASE=process.env.CHECK_URL||'http://localhost:8775/index.html',OUT=process.argv[2]||'/tmp';
const LAYOUTS=process.env.ONLY?process.env.ONLY.split(','):['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page(){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,
    '--user-data-dir='+mkdtempSync(tmpdir()+'/credit'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`try{localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:Date.now()}))}catch{};window.__cl=[];addEventListener('DOMContentLoaded',()=>{const c=document.getElementById('credit-flash');new MutationObserver(()=>__cl.push([Math.round(performance.now()),c.className,c.textContent.slice(0,30)])).observe(c,{attributes:true,childList:true,subtree:true,characterData:true});})`});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value;
  return {send,ev,close(){ws.close();chrome.kill();}};
}
const PROBE=`(()=>{const c=document.getElementById('credit-flash'),st=document.getElementById('stage').getBoundingClientRect(),r=c.getBoundingClientRect(),cs=getComputedStyle(c);
  c.style.pointerEvents='auto';const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);c.style.pointerEvents='';
  return {on:c.classList.contains('on'),op:+cs.opacity,text:c.textContent,font:parseFloat(cs.fontSize),x0:r.x-st.x,x1:r.right-st.x,y1:r.bottom-st.y,topmost:top===c||c.contains(top),clip:c.scrollWidth>c.clientWidth+1};})()`;
const fails=[];
for(const layout of LAYOUTS){
  const p=await page();
  await p.send('Page.navigate',{url:`${BASE}?q=${process.env.Q||"Cincinnati"}&layout=${layout}&map=10`});
  let t0=0,first=null;for(let i=0;i<120;i++){await sleep(100);const s=await p.ev(PROBE);if(s?.on){t0=Date.now();first=s;break;}}
  if(!first){console.log('FAIL',layout,'never shown');fails.push(layout);p.close();continue;}
  await sleep(600);const shot=await p.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${OUT}/credit-${layout}.png`,Buffer.from(shot.data,'base64'));
  // Sample until 4.9 s after it appeared (the map can redraw meanwhile and re-flash, which only extends it).
  let worst=null;while(Date.now()-t0<4600){const s=await p.ev(PROBE);if(s.on&&!s.topmost)worst=worst||s;await sleep(200);}
  await sleep(1500);
  // How long it stayed on, timed in the page: first "on" to the first removal after it.
  const shown=await p.ev(`(()=>{let a=null;for(const [t,c] of __cl){const on=/\\bon\\b/.test(c);if(on&&a===null)a=t;if(!on&&a!==null)return t-a;}return a===null?-1:9999;})()`);
  if(shown<4990)worst=worst||{on:false,op:0,topmost:'n/a',shown};
  const s=first;
  const prob=[];
  if(worst)prob.push(`gone or covered before 5 s (on ${worst.on}, topmost ${worst.topmost}, shown ${worst.shown??'?'} ms)`);
  if(!/© OpenMapTiles © OpenStreetMap/.test(s.text))prob.push('credit text');
  if(s.x0<48||s.x1>912||s.y1>513)prob.push(`outside title-safe ${Math.round(s.x0)}..${Math.round(s.x1)}, bottom ${Math.round(s.y1)}`);
  if(s.clip)prob.push('clipped');if(s.font<10)prob.push(`font ${s.font}px`);
  console.log(`${prob.length?'FAIL':'ok  '} ${layout.padEnd(16)} ${s.font}px x ${Math.round(s.x0)}–${Math.round(s.x1)} bottom ${Math.round(s.y1)}  "${s.text}"${prob.length?'  '+prob.join('; '):''}`);
  if(prob.length){fails.push(layout);if(process.env.DEBUG)console.log(JSON.stringify(await p.ev('__cl')));}p.close();
}
process.exit(fails.length?1:0);
