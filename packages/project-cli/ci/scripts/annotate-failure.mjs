// Prints a GitHub Actions error annotation made of the end of a log, so that the reason of a failed step is on the summary
// page of the run (the job logs are not readable without admin rights).
// usage: annotate-failure.mjs <title> <log file>
// Always exits 0 once it printed: it runs in an `if: failure()` step and must not hide the failure it reports.
import { existsSync, readFileSync } from 'node:fs';

const LAST_LINES = 60;
const MAX_CHARS = 1400;

const [title, file] = process.argv.slice(2);
if (title === undefined || file === undefined) {
  process.stderr.write('usage: annotate-failure.mjs <title> <log file>\n');
  process.exit(2);
}

// Escaping of the workflow commands: the data and the property differ only by `:` and `,`.
const escapeData = (text) => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const escapeProperty = (text) => escapeData(text).replace(/:/g, '%3A').replace(/,/g, '%2C');

function messageOf() {
  if (!existsSync(file)) {
    return `no log file at ${file}: the failure is in an earlier step, or the step did not write its log`;
  }
  const text = readFileSync(file, 'utf8').replace(/\s+$/, '');
  if (text === '') {
    return `the log is empty (${file}): the step failed without printing anything`;
  }
  let tail = text.split('\n').slice(-LAST_LINES).join('\n');
  if (tail.length > MAX_CHARS) {
    tail = `(truncated) ${tail.slice(-MAX_CHARS)}`;
  }
  return tail;
}

process.stdout.write(`::error title=${escapeProperty(title)}::${escapeData(messageOf())}\n`);
