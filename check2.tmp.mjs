import { loess } from './packages/quant/dist/regress.js';
const x = Array.from({length:400},(_,i)=>i/40);
const y = x.map(v=>Math.sin(v));
for (const span of [0.05,0.1,0.2]) {
  const s = loess(x,y,{span,points:60});
  let worst=0, worstIn=0;
  s.forEach((p,i)=>{ const e=Math.abs(p.y-Math.sin(p.x)); if(e>worst)worst=e; if(i>0&&i<s.length-1&&e>worstIn)worstIn=e;});
  console.log('span',span,'worst',worst.toFixed(4),'interior',worstIn.toFixed(4));
}
