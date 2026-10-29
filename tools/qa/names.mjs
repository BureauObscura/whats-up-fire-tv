import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page(init){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,'--user-data-dir='+mkdtempSync(tmpdir()+'/nm'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const w=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m.result);w.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);const send=(m,p={})=>new Promise(r=>{w.set(++id,r);ws.send(JSON.stringify({id,method:m,params:p}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:init});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value;
  return {send,ev,close(){ws.close();chrome.kill();}};
}
const L=['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
const NAMES={normal:{name:'Cincinnati',admin:'Ohio',country:'United States',countryCode:'US',latitude:39.10,longitude:-84.66,timeZone:'America/New_York'},
  welsh:{name:'Llanfairpwllgwyngyll',admin:'Wales',country:'United Kingdom',countryCode:'GB',latitude:53.22,longitude:-4.20,timeZone:'Europe/London'},
  hostile:{name:'Springfield<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>‮RTL​😀&amp;&lt;b&gt;',admin:'Illinois',country:'United States',countryCode:'US',latitude:39.78,longitude:-89.65,timeZone:'America/Chicago'},
  word120:{name:'X'.repeat(120),admin:'Ohio',country:'United States',countryCode:'US',latitude:39.10,longitude:-84.66,timeZone:'America/New_York',street:'Y'.repeat(80)}};
const OUT=process.argv[2];mkdirSync(OUT,{recursive:true});let bad=0;
for(const [k,place] of Object.entries(NAMES))for(const layout of L){
  const init=`localStorage.setItem('whatsup.consent',JSON.stringify({v:2,at:'2026-10-29'}));localStorage.setItem('whatsup.settings.v1',JSON.stringify({place:${JSON.stringify(place)},confirmed:true,layout:'${layout}',mapMiles:10}));`;
  const p=await page(init);await p.send('Page.navigate',{url:`http://localhost:8776/index.html?demo=1&layout=${layout}&screen=settings`});await sleep(3500);
  // Focus the Location row too (its hint takes room).
  const r=await p.ev(`(()=>{const b=document.getElementById('set-location-v'),st=document.getElementById('stage').getBoundingClientRect(),c=document.querySelector('#settings .card').getBoundingClientRect(),cs=getComputedStyle(b);
    return {text:b.textContent,font:parseFloat(cs.fontSize),wrap:b.classList.contains('wrap'),clipX:b.scrollWidth>b.clientWidth+1,clipY:b.scrollHeight>b.clientHeight+1,top:Math.round(c.top-st.top),bottom:Math.round(c.bottom-st.top),ink:cs.color,pwned:!!window.__pwned,ell:/…/.test(b.textContent)}})()`);
  const ok=r&&!r.clipX&&!r.clipY&&r.top>=27&&r.bottom<=513&&!r.pwned&&!r.ell;if(!ok)bad++;
  console.log(ok?'ok  ':'FAIL',k.padEnd(8),layout.padEnd(16),r.font+'px',r.wrap?'wrap':'one-line',`card ${r.top}-${r.bottom}`,JSON.stringify(r.text.slice(0,50)));
  if(layout==='swiss'||layout==='synthwave'||!ok){const s=await p.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${OUT}/loc-${k}-${layout}.png`,Buffer.from(s.data,'base64'));}
  p.close();
}
process.exit(bad?1:0);
