import { RequestError } from './httpError.js';

/** The id of this module: it does not ask itself. */
const SELF = 'project';
const DEFAULT_TIMEOUT_MS = 2000;
const LOCAL_URL = '/modules/';

export interface RelatedItem {
  label: string;
  url: string;
  subtitle?: string;
}

/** One panel of the "Related" section of a project: what a module contributes (`error` instead when it failed or answered wrongly). */
export interface RelatedPanel {
  module: string;
  title?: string;
  count?: number;
  items?: RelatedItem[];
  moreUrl?: string;
  error?: string;
}

export interface RelatedOptions {
  /** Base URL of the app-core server (see appCoreBaseUrl). */
  baseUrl: string;
  /** Time given to each module to answer. Default 2000. */
  timeoutMs?: number;
}

class ContractError extends Error {}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function localUrl(value: unknown, what: string): string {
  // '/modules/...' only: no external site, no '//host', no 'javascript:' (the shell would follow the address as it is).
  if (typeof value !== 'string' || !value.startsWith(LOCAL_URL)) {
    throw new ContractError(`${what} must start with '${LOCAL_URL}' (a page of this app), got ${JSON.stringify(value)}`);
  }
  return value;
}

function itemOf(value: unknown, index: number): RelatedItem {
  const where = `items[${index}]`;
  if (!isObject(value)) {
    throw new ContractError(`${where} must be an object`);
  }
  if (typeof value['label'] !== 'string' || value['label'].trim() === '') {
    throw new ContractError(`${where}.label must be a non-empty text`);
  }
  const url = localUrl(value['url'], `${where}.url`);
  const subtitle = value['subtitle'];
  if (subtitle !== undefined && typeof subtitle !== 'string') {
    throw new ContractError(`${where}.subtitle must be a text`);
  }
  return { label: value['label'], url, ...(subtitle === undefined ? {} : { subtitle }) };
}

/** Checks the answer of a module against the contract and keeps only its fields. */
function panelOf(module: string, answer: unknown): RelatedPanel {
  if (!isObject(answer)) {
    throw new ContractError('the answer must be an object { title, items, count?, moreUrl? }');
  }
  const { title, count, items, moreUrl } = answer;
  if (typeof title !== 'string' || title.trim() === '') {
    throw new ContractError("'title' must be a non-empty text");
  }
  if (!Array.isArray(items)) {
    throw new ContractError("'items' must be a list of { label, url, subtitle? }");
  }
  if (count !== undefined && (typeof count !== 'number' || !Number.isInteger(count) || count < 0)) {
    throw new ContractError("'count' must be a whole number, 0 or more");
  }
  return {
    module,
    title,
    ...(count === undefined ? {} : { count }),
    items: items.map(itemOf),
    ...(moreUrl === undefined ? {} : { moreUrl: localUrl(moreUrl, "'moreUrl'") }),
  };
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ContractError(`the answer is not JSON (it starts with ${JSON.stringify(text.slice(0, 40))})`);
  }
}

/** The panel of one module, or undefined when it has nothing to say: 404 (no such route) or 409 (not applicable to this project). A failure is a panel with `error`: it never throws. */
async function ask(module: string, projectId: string, options: Required<RelatedOptions>): Promise<RelatedPanel | undefined> {
  const url = `${options.baseUrl}/api/modules/${encodeURIComponent(module)}/related/project/${encodeURIComponent(projectId)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(options.timeoutMs) });
    if (response.status === 404 || response.status === 409) {
      return undefined;
    }
    if (!response.ok) {
      return { module, error: `the module answered with status ${response.status} on ${url.slice(options.baseUrl.length)}` };
    }
    return panelOf(module, await readJson(response));
  } catch (error) {
    if (error instanceof ContractError) {
      return { module, error: `invalid answer: ${error.message}` };
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { module, error: `the module did not answer within ${options.timeoutMs} ms` };
    }
    return { module, error: `the request failed: ${reasonOf(error)}` };
  }
}

async function installedModules(options: Required<RelatedOptions>): Promise<string[]> {
  try {
    const response = await fetch(`${options.baseUrl}/api/modules`, { signal: AbortSignal.timeout(options.timeoutMs) });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    const modules = isObject(body) ? body['modules'] : undefined;
    if (!Array.isArray(modules)) {
      throw new Error('the answer has no list of modules');
    }
    return modules.flatMap((entry) => (isObject(entry) && typeof entry['id'] === 'string' ? [entry['id']] : []));
  } catch (error) {
    throw new RequestError(502, `cannot reach app-core at ${options.baseUrl} to list the installed modules (${reasonOf(error)})`, 'Check that app-core is running, and APP_CORE_PORT if it is set.');
  }
}

/**
 * The panels the other modules contribute for a project: asks every installed module except this one, in parallel,
 * GET /api/modules/<id>/related/project/<projectId> (the convention is documented in the README). Sorted by module id.
 */
export async function collectRelated(projectId: string, options: RelatedOptions): Promise<RelatedPanel[]> {
  const resolved = { baseUrl: options.baseUrl, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const modules = (await installedModules(resolved)).filter((id) => id !== SELF).sort();
  const panels = await Promise.all(modules.map((module) => ask(module, projectId, resolved)));
  return panels.filter((panel): panel is RelatedPanel => panel !== undefined);
}
