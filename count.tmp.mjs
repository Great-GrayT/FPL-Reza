import { FileStore } from './packages/store/dist/index.js';
const store = new FileStore({ root: 'data' });
const season = '2026/27';
const pass = { safeParse: (v) => ({ success: true, data: v }) };
const ds = await store.datasets(season);
for (const d of ds) {
  const parts = await store.partitions({ season, dataset: d });
  const list = parts.length ? parts : [undefined];
  let total = 0; let sample = null;
  for (const p of list) {
    try {
      const rows = await store.read({ season, dataset: d, ...(p?{partition:p}:{}) }, pass);
      total += rows.length; if (!sample && rows.length) sample = rows[0];
    } catch (e) { console.log('  ERR', d, p, String(e).slice(0,80)); }
  }
  console.log(`${d}\trows=${total}\tparts=${parts.length}${parts.length?` [${parts.slice(0,3).join(',')}...]`:''}`);
  if (sample) console.log('  keys:', Object.keys(sample).join(','));
}
