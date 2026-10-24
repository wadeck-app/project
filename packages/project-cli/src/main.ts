#!/usr/bin/env node
import { run } from './run.js';

process.exitCode = await run(
  process.argv.slice(2),
  {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  },
  process.env,
  process.cwd(),
);
