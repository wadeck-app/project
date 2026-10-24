// Child process used by concurrency.test.ts: reads the registry without lock `count` times; any error fails the process.
import { loadRegistry } from '../../dist/esm/index.js';

const [registryDir, countText] = process.argv.slice(2);
if (registryDir === undefined || countText === undefined) {
  throw new Error('usage: reader.mjs <registryDir> <count>');
}
let max = 0;
for (let i = 0; i < Number(countText); i++) {
  max = Math.max(max, loadRegistry(registryDir).projects.length);
  await new Promise((resolve) => setTimeout(resolve, 1));
}
console.log(`read ok, max projects seen: ${max}`);
