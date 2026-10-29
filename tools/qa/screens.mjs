import {readFileSync,writeFileSync,mkdtempSync,mkdirSync} from 'node:fs';import {spawn} from 'node:child_process';import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function page(consent){
  const port=9400+Math.floor(Math.random()*500);
  const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new',`--remote-debugging-port=${port}`,'--user-data-dir='+mkdtempSync(tmpdir()+'/scr'),'--window-size=960,540','about:blank'],{stdio:'ignore'});
  let tabs;for(let i=0;i<40&&!tabs;i++){await sleep(250);try{tabs=await (await fetch(`http://127.0.0.1:${port}/json`)).json();}catch{}}
  const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}};
  await new Promise(r=>ws.onopen=r);
  const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:1,mobile:false});
  const ev=async e=>(await send('Runtime.evaluate',{expression:e,returnByValue:true})).result?.value;
  const shot=async f=>{const s=await send('Page.captureScreenshot',{format:'png'});writeFileSync(f,Buffer.from(s.data,'base64'));};
  return {send,ev,shot,close(){ws.close();chrome.kill();}};
}
const OUT=process.argv[2];mkdirSync(OUT,{recursive:true});
for(const [prof,port] of [['personal',8775],['store',8776]])for(const layout of ['atlas-dark','synthwave','departures','glass']){
  const B=`http://localhost:${port}/index.html`;
  let p=await page();await p.send('Page.navigate',{url:`${B}?layout=${layout}`});await sleep(3500);
  const body=await p.ev(`document.getElementById('consent-body').textContent`);await p.shot(`${OUT}/consent-${prof}-${layout}.png`);p.close();
  p=await page();await p.send('Page.navigate',{url:`${B}?q=Cincinnati&layout=${layout}&screen=locate&typed=CINCINNATI`});await sleep(6000);
  await p.ev(`(()=>{const b=[...document.querySelectorAll('#keys [data-key="search"]')][0];b&&b.click();})()`);await sleep(3000);
  const loc=await p.ev(`[document.getElementById('search-src').textContent,document.getElementById('results-src').textContent]`);await p.shot(`${OUT}/search-${prof}-${layout}.png`);p.close();
  p=await page();await p.send('Page.navigate',{url:`${B}?q=Cincinnati&layout=${layout}&screen=settings`});await sleep(5000);
  await p.ev(`document.getElementById('set-about').click()`);await sleep(800);
  const qr=await p.ev(`!document.getElementById('about-qr').closest('figure').hidden`);await p.shot(`${OUT}/about-${prof}-${layout}.png`);
  await p.ev(`document.getElementById('about-back')?.click()`);await sleep(300);await p.ev(`document.getElementById('set-privacy').click()`);await sleep(800);
  const priv=await p.ev(`document.getElementById('privacy-doc').textContent.slice(0,400)`);await p.shot(`${OUT}/privacy-${prof}-${layout}.png`);p.close();
  console.log(prof,layout,'| search:',loc.join(' | '),'| adsb.fi QR:',qr);
  if(layout==='atlas-dark')console.log('  consent:',body,'\n  privacy:',priv);
}
