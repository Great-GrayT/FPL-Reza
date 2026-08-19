import { FileStore } from './packages/store/dist/index.js';
const store = new FileStore({ root: 'data' });
const season='2026/27'; const pass={safeParse:v=>({success:true,data:v})};
const parts = await store.partitions({season, dataset:'player-gameweeks-history'});
console.log('seasons:', parts.join(' '));
for (const p of parts) {
  const rows = await store.read({season,dataset:'player-gameweeks-history',partition:p}, pass);
  const n=rows.length; const nn=(k)=>rows.filter(r=>r[k]!==null&&r[k]!==undefined).length;
  console.log(p, 'rows',n, 'xG',nn('expectedGoals'), 'xA',nn('expectedAssists'), 'xGC',nn('expectedGoalsConceded'), 'xP',nn('expectedPoints'), 'price',nn('price'), 'sel',nn('selectedBy'), 'gws', new Set(rows.map(r=>r.gameweek)).size, 'players', new Set(rows.map(r=>r.playerCode)).size);
}
const m = await store.partitions({season,dataset:'matches'});
console.log('match seasons', m.length, m[0], m[m.length-1]);
const d = await store.partitions({season,dataset:'match-details'});
console.log('detail seasons', d.join(','));
const one = await store.read({season,dataset:'match-details',partition:d[0]},pass);
console.log('detail sample', JSON.stringify(one[0]).slice(0,600));
