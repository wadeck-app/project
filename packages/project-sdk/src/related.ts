import { InvalidRelatedResponseError } from './errors.js';

/** One line of a related panel: a link to a page of the app. */
export interface RelatedItem {
  label: string;
  /** A page of the app: starts with `/modules/` (see isModuleUrl). */
  url: string;
  subtitle?: string;
}

/**
 * What a module answers to `GET /api/modules/<its id>/related/project/<projectId>`: the things it holds that concern one project.
 * `count` may be larger than `items.length` (a short list of a long one); `countLabel` is the word after it ("3 open"); `truncated` says
 * the list is partial; `moreUrl` opens the full list.
 */
export interface RelatedPanel {
  title: string;
  count?: number;
  countLabel?: string;
  truncated?: boolean;
  items: RelatedItem[];
  moreUrl?: string;
}

const PREFIX = '/modules/';
// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[\u0000-\u001f\u007f\\]/;

/**
 * True for an address of a page of this app: starts with `/modules/`, no `//` anywhere (a protocol-relative or absolute address hidden
 * in the path or the query), no backslash and no control character. An external address, a scheme (`javascript:`) and any other
 * path of the app are refused: the shell follows these addresses as they are.
 */
export function isModuleUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith(PREFIX) && !url.includes('//') && !FORBIDDEN.test(url);
}

function invalid(path: string, reason: string): InvalidRelatedResponseError {
  return new InvalidRelatedResponseError(`invalid related response at ${path}: ${reason}`, { path, reason });
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalid(path, `must be a non-empty text, got ${JSON.stringify(value)}`);
  }
  return value;
}

function moduleUrl(value: unknown, path: string): string {
  if (!isModuleUrl(value)) {
    throw invalid(path, `must start with '${PREFIX}' (a page of this app, no '//' and no scheme), got ${JSON.stringify(value)}`);
  }
  return value;
}

function itemOf(value: unknown, index: number): RelatedItem {
  const at = `items[${index}]`;
  if (!isObject(value)) {
    throw invalid(at, `must be an object { label, url, subtitle? }, got ${JSON.stringify(value)}`);
  }
  const label = text(value['label'], `${at}.label`);
  const url = moduleUrl(value['url'], `${at}.url`);
  const subtitle = value['subtitle'];
  if (subtitle !== undefined && typeof subtitle !== 'string') {
    throw invalid(`${at}.subtitle`, `must be a text, got ${JSON.stringify(subtitle)}`);
  }
  return { label, url, ...(subtitle === undefined ? {} : { subtitle }) };
}

/**
 * Validates an answer of a module against the contract and returns the panel, with only the fields of the contract: unknown fields are
 * ignored (the contract can grow). Throws InvalidRelatedResponseError naming the first offending path.
 */
export function parseRelatedResponse(input: unknown): RelatedPanel {
  if (!isObject(input)) {
    throw invalid('$', `the answer must be an object { title, items, count?, countLabel?, truncated?, moreUrl? }, got ${JSON.stringify(input)}`);
  }
  const title = text(input['title'], 'title');
  const items = input['items'];
  if (!Array.isArray(items)) {
    throw invalid('items', `must be a list of { label, url, subtitle? }, got ${JSON.stringify(items)}`);
  }
  const { count, countLabel, truncated, moreUrl } = input;
  if (count !== undefined && (typeof count !== 'number' || !Number.isInteger(count) || count < 0)) {
    throw invalid('count', `must be a whole number, 0 or more, got ${JSON.stringify(count)}`);
  }
  if (countLabel !== undefined) {
    text(countLabel, 'countLabel');
  }
  if (truncated !== undefined && typeof truncated !== 'boolean') {
    throw invalid('truncated', `must be true or false, got ${JSON.stringify(truncated)}`);
  }
  return {
    title,
    ...(count === undefined ? {} : { count }),
    ...(countLabel === undefined ? {} : { countLabel: countLabel as string }),
    ...(truncated === undefined ? {} : { truncated }),
    items: items.map(itemOf),
    ...(moreUrl === undefined ? {} : { moreUrl: moduleUrl(moreUrl, 'moreUrl') }),
  };
}

/** For providers: the panel to send, validated like the consumer validates it, so that a provider cannot emit garbage. */
export function buildRelatedResponse(panel: RelatedPanel): RelatedPanel {
  return parseRelatedResponse(panel);
}

/** For the tests of providers: throws InvalidRelatedResponseError (with the path) unless `input` conforms to the contract. */
export function assertRelatedResponse(input: unknown): asserts input is RelatedPanel {
  parseRelatedResponse(input);
}
