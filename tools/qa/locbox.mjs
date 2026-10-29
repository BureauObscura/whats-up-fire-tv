import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync(new URL('./screens.mjs',import.meta.url),'utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {spawn}=await import('node:child_process');const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
const page=new Function('spawn','mkdtempSync','tmpdir','sleep','writeFileSync',`return (${src.slice(src.indexOf('async function page(consent){'),src.indexOf('const OUT')).replace('async function page(consent)','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep,writeFileSync);
const L=['atlas-dark','atlas','atlas-satellite','swiss','synthwave','sectional','cockpit','radar','glass','departures','blueprint','night-sky'];
for(const port of [8775,8776])for(const layout of L){
  const p=await page();await p.send('Page.navigate',{url:`http://localhost:${port}/index.html?q=Cincinnati&layout=${layout}&screen=locate&typed=CINCINNATI`});await sleep(4500);
  await p.ev(`document.querySelector('#keys [data-key="search"]').click()`);await sleep(2500);
  const r=await p.ev(`(()=>{const st=document.getElementById('stage').getBoundingClientRect(),c=document.querySelector('#locate .card').getBoundingClientRect(),s=document.getElementById('search-src'),sr=s.getBoundingClientRect();return {top:Math.round(c.top-st.top),bottom:Math.round(c.bottom-st.top),src:Math.round(sr.bottom-st.top),clip:s.scrollWidth>s.clientWidth+1}})()`);
  const ok=r.top>=27&&r.bottom<=513&&!r.clip;console.log(ok?'ok  ':'FAIL',port,layout.padEnd(16),JSON.stringify(r));
  if(layout==='synthwave'||!ok)await p.shot(`shots/profiles/locate-${port}-${layout}.png`);p.close();
}
