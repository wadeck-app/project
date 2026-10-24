export interface Dispatch {
  /** Full command name (`add`, `paths remove`), undefined when the words do not form a known command. */
  name: string | undefined;
  /** The bare words that were read as the command (none when argv has only options). */
  words: string[];
  /** argv without those words, order kept. */
  rest: string[];
}

const PROJECT_FLAGS = new Set(['-p', '--project']);

/**
 * Finds the command in argv wherever the options are: the command words are the first bare tokens, skipping options and
 * the value of --project / -p. A group word (`paths`) needs a second word (`add`).
 */
export function splitCommand(argv: readonly string[], names: readonly string[]): Dispatch {
  const consumed: number[] = [];
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      break;
    }
    if (PROJECT_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (arg.startsWith('-')) {
      continue;
    }
    words.push(arg);
    consumed.push(i);
    const candidate = words.join(' ');
    const isGroup = words.length === 1 && names.some((name) => name.startsWith(`${candidate} `));
    if (isGroup) {
      continue;
    }
    break;
  }
  const name = names.includes(words.join(' ')) ? words.join(' ') : undefined;
  return { name, words, rest: argv.filter((_, i) => !consumed.includes(i)) };
}
