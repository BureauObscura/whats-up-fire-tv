import {readFileSync,writeFileSync} from 'node:fs';
const src=readFileSync(new URL('./screens.mjs',import.meta.url),'utf8');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const {spawn}=await import('node:child_process');const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
const page=new Function('spawn','mkdtempSync','tmpdir','sleep','writeFileSync',`return (${src.slice(src.indexOf('async function page(consent){'),src.indexOf('const OUT')).replace('async function page(consent)','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep,writeFileSync);
const key=async(p,k,code=13)=>{for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key:k,code:k,windowsVirtualKeyCode:code});};
for(const typed of (process.argv[2]||'ROSEMONT ILLINOIS|10000 W OHARE AVE, CHICAGO, IL|10000 W O HARE AVE, CHICAGO, IL').split('|')){
  const p=await page();
  // A fresh store install near CVG (a public place), then Change location to the test place.
  await p.send('Page.navigate',{url:`http://localhost:8776/index.html?q=Cincinnati&layout=atlas-dark&map=10&screen=locate&typed=${encodeURIComponent(typed)}`});await sleep(4500);
  await p.ev(`document.querySelector('#keys [data-key="search"]').click()`);await sleep(5000);
  const res=await p.ev(`[...document.querySelectorAll('#results button')].map(b=>b.textContent)`);
  const msg=await p.ev(`document.getElementById('results').textContent`);
  if(res?.length){await p.ev(`document.querySelector('#results button').click()`);await sleep(2500);
    // Confirm screens (if any): press OK on whatever is focused, a few times, until the dashboard.
    for(let i=0;i<3;i++){const open=await p.ev(`[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id)`);if(!open.length)break;await key(p,'Enter');await sleep(1500);}
  }
  await sleep(30000);
  const st=await p.ev(`({open:[...document.querySelectorAll('.overlay')].filter(o=>!o.hidden).map(o=>o.id),city:document.querySelector('.at-city')?.textContent,planes:document.querySelectorAll('.at-plane').length,status:document.querySelector('.at-status')?.textContent})`);
  console.log(JSON.stringify(typed),'results:',JSON.stringify(res),'msg:',JSON.stringify(msg),'→',JSON.stringify(st));
  await p.shot(`shots/store/amazon-${typed.replace(/\W+/g,'_')}.png`);p.close();
}
