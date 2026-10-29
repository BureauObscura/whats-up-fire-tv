import {readFileSync} from 'node:fs';import {spawn} from 'node:child_process';import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';
const src=readFileSync(new URL('./check.mjs',import.meta.url),'utf8');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const page=new Function('spawn','mkdtempSync','tmpdir','sleep',`return (${src.slice(src.indexOf('async function page(){'),src.indexOf('const PROBE')).replace('async function page()','async function()')})`)(spawn,mkdtempSync,tmpdir,sleep);
const p=await page();
// Consent is only pre-set for the first load.
await p.send('Page.navigate',{url:'http://localhost:8775/index.html?layout=radar&map=10&q=Cincinnati'});await sleep(12000);
console.log('before:',await p.ev(`Object.keys(localStorage).filter(k=>k.startsWith('whatsup.')).join(' ')`));
await p.ev(`(()=>{document.getElementById('erase').hidden=false;})()`);
// Open through the real path: Settings, Privacy, Erase.
for(const id of ['set-privacy','privacy-erase','erase-ok']){await p.ev(`(()=>{const b=document.getElementById('${id}');b&&b.closest('.overlay')&&(b.closest('.overlay').hidden=false);})()`);}
await p.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await p.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(800);
await p.ev(`(()=>{const b=document.getElementById('set-privacy');b.click();})()`);await sleep(500);
await p.ev(`document.getElementById('privacy-erase').click()`);await sleep(500);
await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__startKeys=Object.keys(localStorage)`});
await p.ev(`document.getElementById('erase-ok').click()`);await sleep(6000);
console.log('at reload start:',JSON.stringify(await p.ev(`window.__startKeys`)),'consent screen:',await p.ev(`!document.getElementById('consent').hidden`));
p.close();
