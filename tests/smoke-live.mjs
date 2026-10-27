// Manual check against the real APIs: node tests/smoke-live.mjs <lat> <lon> [seconds] [radiusMiles]
import {startLive} from '../web/live.mjs';
import {IDS} from '../web/core.mjs';
import {CONFIG} from '../web/config.js';
const [latitude,longitude]=process.argv.slice(2,4).map(Number);
if(!Number.isFinite(latitude)||!Number.isFinite(longitude)){console.error('usage: node tests/smoke-live.mjs <lat> <lon> [seconds] [radiusMiles]');process.exit(2);}
const seconds=Number(process.argv[4])||40,radius=Number(process.argv[5])||CONFIG.radiusMiles;
let last;
const live=startLive((s,ok)=>{last=s;
  console.log(new Date().toISOString().slice(11,19),ok?'ok':'no data',
    'feed',s[IDS.feed].attributes.ac.length,'current',s[IDS.current].state,
    'history',s[IDS.candidate].attributes.history.length,
    'routes',s[IDS.routes].attributes.routes.map(r=>`${r.callsign}:${r.origin}-${r.destination}${r.historical?'(h)':''}`).join(' '));
},{...CONFIG,latitude,longitude,radiusMiles:radius});
setTimeout(()=>{live.stop();process.exit(0);},seconds*1000);
