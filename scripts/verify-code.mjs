// Verifies every code excerpt is verbatim from the pinned Convex sources and
// records the real line number of each excerpt line into src/code/lines.json.
// Usage: node scripts/verify-code.mjs <dir containing convex-backend and convex-js clones>
import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2];
const { clientRefs } = await import(path.resolve('src/code/client.ts'));
const { backendRefs } = await import(path.resolve('src/code/backend.ts'));
const refs = { ...clientRefs, ...backendRefs };
const result = {};
let bad = 0;
for (const [key, r] of Object.entries(refs)) {
  const file = path.join(root, r.repo, r.path);
  if (!fs.existsSync(file)) { console.log(`✗ ${key}: missing file ${r.path}`); bad++; continue; }
  const real = fs.readFileSync(file, 'utf8').split('\n');
  const lines = r.code.replace(/\s+$/, '').split('\n');
  let cursor = Math.max(0, r.startLine - 3);
  const nums = [];
  const misses = [];
  for (const l of lines) {
    if (l.trim() === '// …' || l.trim() === '/* … */') { nums.push(null); continue; }
    if (l.trim() === '') {
      const j = real.findIndex((x, i) => i >= cursor && x.trim() === '');
      if (j >= 0 && j - cursor < 3) { nums.push(j + 1); cursor = j + 1; } else nums.push(null);
      continue;
    }
    let j = real.findIndex((x, i) => i >= cursor && x.trimEnd() === l.trimEnd());
    if (j < 0) j = real.findIndex((x, i) => i >= cursor && x.trim() === l.trim());
    if (j < 0) { misses.push(l); nums.push(null); continue; }
    nums.push(j + 1);
    cursor = j + 1;
  }
  const found = nums.filter((n) => n !== null);
  if (misses.length) { bad++; console.log(`✗ ${key}: ${misses.length} non-verbatim lines, e.g. ${JSON.stringify(misses[0])}`); }
  if (found.length && (Math.abs(found[0] - r.startLine) > 2)) console.log(`~ ${key}: startLine ${r.startLine} but first match at ${found[0]}`);
  result[key] = nums;
}
fs.writeFileSync('src/code/lines.json', JSON.stringify(result));
console.log(`${Object.keys(refs).length} refs checked, ${bad} with problems`);
if (bad) process.exit(1);
