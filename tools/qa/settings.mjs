import {readFileSync} from 'node:fs';import {spawn} from 'node:child_process';import {mkdtempSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';
const src=readFileSync(new URL('./check.mjs',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const page=new Function('spawn','mkdtempSync','tmpdir','sleep',`return (${src.slice(src.indexOf('async function page(){'),src.indexOf('const PROBE')).replace('async function page()','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep);
const L=['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
let bad=0;
for(const layout of L){
  const p=await page();await p.send('Page.navigate',{url:`${process.env.BASE||'http://localhost:8775/index.html'}?q=Cincinnati&layout=${layout}&map=10`});await sleep(4000);
  for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
  await sleep(1500);
  const r=await p.ev(`(()=>{const st=document.getElementById('stage').getBoundingClientRect(),c=document.querySelector('#settings .card').getBoundingClientRect();return {top:Math.round(c.top-st.top),bottom:Math.round(c.bottom-st.top),h:Math.round(c.height)}})()`);
  const ok=r.top>=27&&r.bottom<=513;if(!ok)bad++;
  if(process.argv[2]){const s=await p.send('Page.captureScreenshot',{format:'png'});writeFileSync(`${process.argv[2]}/settings-${layout}.png`,Buffer.from(s.data,'base64'));}
  console.log(ok?'ok  ':'FAIL',layout.padEnd(16),JSON.stringify(r));p.close();
}
process.exit(bad?1:0);
