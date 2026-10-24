import { UsageError } from './errors.js';

export interface OptionSpec {
  type: 'boolean' | 'string' | 'list';
  /** One-letter alias used as `-x value`. */
  short?: string;
  /** Placeholder shown in the help for value options (default: the option name). */
  valueName?: string;
  description: string;
}

export type OptionSpecs = Record<string, OptionSpec>;

type OptionValue = boolean | string | string[];

/** Typed read access to the parsed options; absent options read as false, undefined or empty. */
export class Options {
  constructor(private readonly values: ReadonlyMap<string, OptionValue>) {}

  flag(name: string): boolean {
    return this.values.get(name) === true;
  }

  value(name: string): string | undefined {
    const value = this.values.get(name);
    return typeof value === 'string' ? value : undefined;
  }

  list(name: string): string[] {
    const value = this.values.get(name);
    return Array.isArray(value) ? value : [];
  }
}

export interface ParsedArgs {
  positionals: string[];
  options: Options;
}

interface Token {
  name: string;
  spec: OptionSpec;
  /** Value attached with `--name=value`. */
  inline?: string;
  shown: string;
}

function lookup(arg: string, specs: OptionSpecs, label: string): Token {
  const unknown = (): UsageError => new UsageError(`unknown option '${arg.split('=')[0]}' for '${label}'`, label);
  if (arg.startsWith('--')) {
    const eq = arg.indexOf('=');
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const spec = specs[name];
    if (spec === undefined) {
      throw unknown();
    }
    return { name, spec, shown: `--${name}`, ...(eq === -1 ? {} : { inline: arg.slice(eq + 1) }) };
  }
  const entry = Object.entries(specs).find(([, spec]) => spec.short === arg.slice(1));
  if (entry === undefined || arg.length !== 2) {
    throw unknown();
  }
  return { name: entry[0], spec: entry[1], shown: arg };
}

/**
 * Splits argv into positionals and the options declared in `specs`. Values are never taken from a token that looks
 * like an option (use `--name=value` for such a value); `--` ends the options. `label` names the command in errors.
 */
export function parseArgs(argv: readonly string[], specs: OptionSpecs, label: string): ParsedArgs {
  const positionals: string[] = [];
  const values = new Map<string, OptionValue>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      positionals.push(arg);
      continue;
    }
    const token = lookup(arg, specs, label);
    if (token.spec.type === 'boolean') {
      if (token.inline !== undefined) {
        throw new UsageError(`option '${token.shown}' does not take a value (got '${token.inline}')`, label);
      }
      values.set(token.name, true);
      continue;
    }
    let value = token.inline;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        throw new UsageError(`option '${token.shown}' needs a value (use '${token.shown}=<value>' if the value starts with '-')`, label);
      }
      value = next;
      i++;
    }
    if (token.spec.type === 'list') {
      values.set(token.name, [...(values.get(token.name) as string[] | undefined ?? []), value]);
    } else if (values.has(token.name)) {
      throw new UsageError(`option '${token.shown}' is given twice; pass it once`, label);
    } else {
      values.set(token.name, value);
    }
  }
  return { positionals, options: new Options(values) };
}
