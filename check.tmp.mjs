import { tTwoSided, fP } from './packages/quant/dist/special.js';
import { loess } from './packages/quant/dist/regress.js';
console.log('t 2.1213 df9 p =', tTwoSided(2.1213203435596424, 9));
console.log('t 2.1213 df3 p =', tTwoSided(2.1213203435596424, 3));
console.log('F 4.9646 5,10 =', fP(4.964602743, 5, 10));
console.log('F 3.0 3,20 =', fP(3.0, 3, 20));
const x = Array.from({length:200},(_,i)=>i/20);
const y = x.map(v=>Math.sin(v));
const s = loess(x,y,{span:0.2,points:40});
let worst=0, at=0;
for (const p of s) { const e=Math.abs(p.y-Math.sin(p.x)); if(e>worst){worst=e;at=p.x;} }
console.log('loess worst err', worst, 'at x', at);
