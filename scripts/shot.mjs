// node scripts/shot.mjs <url> <out.png> [waitMs]  — 960x540 CSS at 2x (1920x1080), via local Chrome DevTools.
import {spawn} from 'node:child_process';import {writeFileSync,mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';
const [url,out,wait=6000]=process.argv.slice(2);
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9334',
  '--user-data-dir='+mkdtempSync(tmpdir()+'/shot'),'--hide-scrollbars','--window-size=960,540','about:blank'],{stdio:'ignore'});
let tabs;for(let i=0;i<40&&!tabs;i++){await new Promise(r=>setTimeout(r,250));try{tabs=await (await fetch('http://127.0.0.1:9334/json')).json();}catch{}}
const ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);let id=0;const waiting=new Map(),logs=[];
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waiting.has(m.id)){waiting.get(m.id)(m.result);waiting.delete(m.id);}
  if(m.method==='Runtime.consoleAPICalled'&&['error','warning'].includes(m.params.type))logs.push(m.params.type+': '+m.params.args.map(a=>a.value??a.description).join(' '));
  if(m.method==='Runtime.exceptionThrown')logs.push('exception: '+(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text));
  if(m.method==='Log.entryAdded'&&m.params.entry.level==='error')logs.push('log: '+m.params.entry.text+' '+(m.params.entry.url||''));};
await new Promise(r=>ws.onopen=r);
const send=(method,params={})=>new Promise(r=>{waiting.set(++id,r);ws.send(JSON.stringify({id,method,params}));});
await send('Runtime.enable');await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride',{width:960,height:540,deviceScaleFactor:2,mobile:false});
await send('Page.navigate',{url});await new Promise(r=>setTimeout(r,Number(wait)));
const shot=await send('Page.captureScreenshot',{format:'png'});writeFileSync(out,Buffer.from(shot.data,'base64'));
logs.forEach(l=>console.log(l));ws.close();chrome.kill();
