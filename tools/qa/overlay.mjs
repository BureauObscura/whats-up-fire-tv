// Settings opened while the credit is up: it disappears, and after Back it shows for a full 5 s.
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./check.mjs',import.meta.url),'utf8');
const pageFn=src.slice(src.indexOf('async function page(){'),src.indexOf('const PROBE'));
const {spawn}=await import('node:child_process');const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const page=new Function('spawn','mkdtempSync','tmpdir','sleep',`return (${pageFn.replace('async function page()','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep);
const p=await page();
await p.send('Page.navigate',{url:'http://localhost:8775/index.html?q=Cincinnati&layout=radar&map=10'});
for(let i=0;i<100;i++){await sleep(100);if(await p.ev(`document.getElementById('credit-flash').classList.contains('on')`))break;}
await sleep(1000);
const key=async(key,code)=>{for(const type of ['keyDown','keyUp'])await p.send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:code==='Enter'?13:27});};
await key('Enter','Enter');await sleep(300);
const during=await p.ev(`[document.getElementById('credit-flash').classList.contains('on'),!document.getElementById('settings').hidden]`);
await sleep(7000);
const still=await p.ev(`document.getElementById('credit-flash').classList.contains('on')`);
await key('Escape','Escape');
const t=Date.now();let back=false;for(let i=0;i<20;i++){await sleep(100);if(await p.ev(`document.getElementById('credit-flash').classList.contains('on')`)){back=true;break;}}
await sleep(4500);const at45=await p.ev(`document.getElementById('credit-flash').classList.contains('on')`);
await sleep(1500);const at6=await p.ev(`document.getElementById('credit-flash').classList.contains('on')`);
console.log({onWithSettingsOpen:during[0],settingsOpen:during[1],onAfter7sInSettings:still,shownAfterBack:back,onAt4_5s:at45,offAt6s:!at6});
p.close();
