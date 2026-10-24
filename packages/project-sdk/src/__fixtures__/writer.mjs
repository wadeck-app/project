// Child process used by concurrency.test.ts: adds `count` projects named `<prefix>-<i>` through the BUILT package.
import { addProject } from '../../dist/esm/index.js';

const [registryDir, prefix, countText] = process.argv.slice(2);
if (registryDir === undefined || prefix === undefined || countText === undefined) {
  throw new Error('usage: writer.mjs <registryDir> <prefix> <count>');
}
for (let i = 0; i < Number(countText); i++) {
  await addProject(registryDir, { name: `${prefix}-${i}` }, { lock: { timeoutMs: 120_000 } });
}
