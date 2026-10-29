// Writes web/licenses.txt, the text of About & credits (also assets/licenses.txt), from one
// manifest: the data sources, every bundled model photo (web/models.mjs plus its Commons
// source in THIRD_PARTY_NOTICES.md), the vendored page libraries, every production package
// of the native shell (package-lock.json, transitive), and the fonts. Plain text: a blank
// line starts a paragraph, "## " a heading (rendered with textContent only).
// Fails on a production license it can't classify, or on GPL/LGPL/AGPL/MPL.
import {readFileSync,writeFileSync,readdirSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const read=(...p)=>readFileSync(join(root,...p),'utf8');
const out=[];const h=t=>out.push('','## '+t,'');const p=t=>out.push(t,'');

// --- Notices.
h('About');
p('Made by Spacely Digital. Questions, credit corrections or removal requests: spacelydigital@gmail.com.');
p('For fun and general information only. Positions can be late, incomplete or wrong, and many aircraft are not shown. Not for navigation, air traffic, safety or emergency use.');
p('Airline, operator and aircraft-manufacturer names are trademarks of their owners, used only to identify aircraft. This app is not affiliated with or endorsed by any airline, manufacturer or data provider.');

// --- Data.
h('Data');
p('Aircraft data: adsb.fi, https://adsb.fi (scan the code on this page).');
p('Flight routes: ADSB.lol (Open Database License).');
p('Maps: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors (Open Database License).');
p('Aircraft photos: Planespotters.net. Each photographer is credited beside their photo.');
p('Satellite imagery in the U.S.: USGS The National Map.');
p('Satellite imagery elsewhere: Sentinel-2 cloudless – https://s2maps.eu by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017).');
p('Place search and time zones: Open-Meteo (GeoNames data, CC BY 4.0).');
p('First location guess: GeoJS. This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com.');
p('U.S. street addresses: U.S. Census Bureau geocoder. Other addresses: Nominatim, © OpenStreetMap contributors.');

// --- Model photos.
const models=new Function(read('web','models.mjs').replace(/^export const MODELS\s*=/m,'return ').replace(/^export[\s\S]*$/m,''))();
const sources={};
for(const line of read('THIRD_PARTY_NOTICES.md').split('\n')){
  const m=/^\| (\w+) \| [^|]+ \| [^|]+ \| [^|]+ \| (https:\/\/commons\.wikimedia\.org\/wiki\/File:\S+) \|/.exec(line);
  if(m)sources[m[1]]=m[2];
}
const LICENSE_URL={'CC BY 2.0':'https://creativecommons.org/licenses/by/2.0/','CC BY 2.5':'https://creativecommons.org/licenses/by/2.5/',
  'CC BY 3.0':'https://creativecommons.org/licenses/by/3.0/','CC BY 3.0 pl':'https://creativecommons.org/licenses/by/3.0/pl/',
  'CC BY 4.0':'https://creativecommons.org/licenses/by/4.0/','CC0':'https://creativecommons.org/publicdomain/zero/1.0/','Public domain':''};
h('Aircraft model photos');
p('From Wikimedia Commons, resized for this app. Use does not imply endorsement by the photographers, Wikimedia, or any airline or manufacturer. Photos are provided as is, without warranties; see each license.');
const seen=new Set();
for(const [code,m] of Object.entries(models)){
  if(!(m.license in LICENSE_URL))throw new Error(`photo ${code}: unknown license ${m.license}`);
  const src=sources[code];if(!src)throw new Error(`photo ${code}: no Commons source in THIRD_PARTY_NOTICES.md`);
  const key=src+m.model;if(seen.has(key))continue;seen.add(key);
  const lic=LICENSE_URL[m.license]?`${m.license} (${LICENSE_URL[m.license]})`:'Public domain';
  p(`${m.model}: ${m.author}. ${lic}. ${decodeURI(src)}. Resized.`);
}

// --- Page libraries (vendored, minified into mvt.js and qr.js).
const vendorLicense=(dir,file)=>readFileSync(join(root,'vendor','node_modules',dir,file),'utf8').trim();
h('Software');
p('@mapbox/vector-tile 2.0.5 and pbf 4.0.2 (BSD-3-Clause):');
p(vendorLicense('@mapbox/vector-tile','LICENSE.txt'));
p('@mapbox/point-geometry 1.1.0 (ISC):');
p(vendorLicense('@mapbox/point-geometry','LICENSE'));
const MIT=t=>`Copyright (c) ${t}

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`;
p('qrcode-generator 2.0.4 (MIT):');
p(MIT('2009 Kazuhiko Arase'));
p('Parts of this app (the feed selection and route matching, aircraft types and silhouettes) are adapted from https://github.com/alexlmiller/overhead (MIT):');
p(MIT('2026 Alex Miller'));

// --- Native shell packages (production, transitive), one line each; texts once per license.
const lock=JSON.parse(read('package-lock.json'));
const ALLOWED=new Set(['MIT','ISC','BSD-2-Clause','BSD-3-Clause','Apache-2.0','0BSD','CC-BY-4.0','(MIT OR Apache-2.0)','(MIT OR CC0-1.0)','Python-2.0','BlueOak-1.0.0','CC0-1.0','Unlicense']);
const rows=[],notices=[];
for(const [path,pkg] of Object.entries(lock.packages)){
  if(!path||pkg.dev||pkg.devOptional||pkg.link)continue;
  const name=path.replace(/^.*node_modules\//,'');
  if(path.startsWith('native/')||name.startsWith('@whatsup/'))continue; // this app's own module
  let lic=String(pkg.license||'');
  const dir=join(root,path),files=existsSync(dir)?readdirSync(dir):[];
  const licFile=files.find(f=>/^(licen[cs]e|copying)/i.test(f));
  const text=licFile?readFileSync(join(dir,licFile),'utf8'):'';
  if(/GPL|MPL/i.test(lic))throw new Error(`${name}: ${lic} is not allowed`);
  if(name.startsWith('@amazon-devices/')&&(/Program Materials/.test(text)||lic==='See license in LICENSE'||!lic))lic='Amazon Program Materials License';
  else if(!ALLOWED.has(lic))throw new Error(`${name} ${pkg.version}: unclassified license "${lic}"`);
  const copyright=(text.match(/^\s*Copyright[^\n]{0,160}/im)||[''])[0].trim();
  rows.push(`${name} ${pkg.version}: ${lic}${copyright&&!/^Copyright\s*$/i.test(copyright)?'. '+copyright:''}`);
  const notice=files.find(f=>/^notice/i.test(f));
  if(notice&&/^Apache/.test(lic))notices.push(`${name}: ${readFileSync(join(dir,notice),'utf8').trim().replace(/\n{2,}/g,'\n')}`);
}
h('App framework');
p(`The app shell is built with React Native for Vega. It includes these packages (${rows.length}), each under the license named; the license texts follow.`);
for(const r of rows.sort())p(r);
for(const n of notices)p(n);
h('MIT License');p(MIT('the copyright holders named above').replace(/^Copyright \(c\) the copyright holders named above\n\n/,''));
h('ISC License');p('Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.');
h('BSD-2-Clause and BSD-3-Clause');p(vendorLicense('@mapbox/vector-tile','LICENSE.txt').replace(/^Copyright[^\n]*\n+(All rights reserved\.\n+)?/,''));
h('Apache License 2.0');p('Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0. Distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.');

// --- Fonts.
h('Fonts');
const fontDir=join(root,'web','fonts');
let ofl='';
for(const f of readdirSync(fontDir).filter(f=>/-OFL\.txt$/.test(f)).sort()){
  const t=readFileSync(join(fontDir,f),'utf8');
  const first=t.split('\n').find(l=>/Copyright/i.test(l)).trim();
  if(/with Reserved Font Name/i.test(t))throw new Error(`${f}: declares a Reserved Font Name; check the converted font`);
  p(`${f.replace(/-OFL\.txt$/,'').replace(/([a-z])([A-Z0-9])/g,'$1 $2')}: ${first}`);
  ofl=ofl||t.slice(t.indexOf('SIL OPEN FONT LICENSE'));
}
p('These fonts are licensed under the SIL Open Font License, Version 1.1:');
p(ofl.trim());

const text=out.join('\n').replace(/\n{3,}/g,'\n\n').trim()+'\n';
if(/…/.test(text))throw new Error('licenses.txt: no "…" in UI text');
writeFileSync(join(root,'web','licenses.txt'),text);
console.log(`web/licenses.txt written (${rows.length} framework packages, ${seen.size} photos, ${Math.round(text.length/1024)} KB)`);
