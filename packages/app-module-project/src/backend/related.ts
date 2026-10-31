import { InvalidRelatedResponseError, type RelatedPanel, parseRelatedResponse } from '@wadeck-app/project-sdk';
import { RequestError } from './httpError.js';

/** The id of this module: it does not ask itself. */
const SELF = 'project';
const DEFAULT_TIMEOUT_MS = 2000;
const NEGATIVE_TTL_MS = 60_000;

/** What the page gets for one module: its panel (contract of the SDK, see parseRelatedResponse), or the reason it has none. */
export type RelatedEntry = { module: string; error?: string } & Partial<RelatedPanel>;

/**
 * Modules that answered "nothing to say" (404: no such route, 409: not applicable to this project) are not asked again for 60 s.
 * In memory, keyed by module id and project id. Only these two outcomes are remembered: a failure, a timeout, an invalid answer and
 * a good one are always asked again.
 */
export class NegativeCache {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = NEGATIVE_TTL_MS,
  ) {}

  private key(module: string, projectId: string): string {
    return `${module}\u0000${projectId}`;
  }

  has(module: string, projectId: string): boolean {
    const key = this.key(module, projectId);
    const expires = this.until.get(key);
    if (expires === undefined) {
      return false;
    }
    if (expires <= this.now()) {
      this.until.delete(key);
      return false;
    }
    return true;
  }

  add(module: string, projectId: string): void {
    this.until.set(this.key(module, projectId), this.now() + this.ttlMs);
  }
}

export interface RelatedOptions {
  /** Base URL of the app-core server (see appCoreBaseUrl). */
  baseUrl: string;
  /** Time given to each module to answer. Default 2000. */
  timeoutMs?: number;
  /** When given, modules that answered 404 or 409 are not asked again for 60 s. */
  cache?: NegativeCache;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new InvalidRelatedResponseError(`invalid related response at $: the answer is not JSON (it starts with ${JSON.stringify(text.slice(0, 40))})`, {
      path: '$',
      reason: 'not JSON',
    });
  }
}

/**
 * The entry of one module, or undefined when it has nothing to say: 404 (no such route) or 409 (not applicable to this project).
 * A failure is an entry with `error`: it never throws.
 */
async function ask(module: string, projectId: string, options: Required<Omit<RelatedOptions, 'cache'>> & Pick<RelatedOptions, 'cache'>): Promise<RelatedEntry | undefined> {
  if (options.cache?.has(module, projectId) === true) {
    return undefined;
  }
  const path = `/api/modules/${encodeURIComponent(module)}/related/project/${encodeURIComponent(projectId)}`;
  try {
    const response = await fetch(`${options.baseUrl}${path}`, { signal: AbortSignal.timeout(options.timeoutMs) });
    if (response.status === 404 || response.status === 409) {
      options.cache?.add(module, projectId);
      return undefined;
    }
    if (!response.ok) {
      return { module, error: `the module answered with status ${response.status} on ${path}` };
    }
    return { module, ...parseRelatedResponse(await readJson(response)) };
  } catch (error) {
    if (error instanceof InvalidRelatedResponseError) {
      return { module, error: `invalid answer: ${error.message}` };
    }
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { module, error: `the module did not answer within ${options.timeoutMs} ms` };
    }
    return { module, error: `the request failed: ${reasonOf(error)}` };
  }
}

async function installedModules(options: { baseUrl: string; timeoutMs: number }): Promise<string[]> {
  try {
    const response = await fetch(`${options.baseUrl}/api/modules`, { signal: AbortSignal.timeout(options.timeoutMs) });
    if (!response.ok) {
      throw new Error(`status ${response.status}`);
    }
    const body = (await response.json()) as unknown;
    const modules = typeof body === 'object' && body !== null ? (body as { modules?: unknown }).modules : undefined;
    if (!Array.isArray(modules)) {
      throw new Error('the answer has no list of modules');
    }
    return modules.flatMap((entry) => (typeof entry === 'object' && entry !== null && typeof (entry as { id?: unknown }).id === 'string' ? [(entry as { id: string }).id] : []));
  } catch (error) {
    throw new RequestError(502, `cannot reach app-core at ${options.baseUrl} to list the installed modules (${reasonOf(error)})`, 'Check that app-core is running, and APP_CORE_PORT if it is set.');
  }
}

/**
 * The entries the other modules contribute for a project: asks every installed module except this one, in parallel,
 * GET /api/modules/<id>/related/project/<projectId> (the contract is parseRelatedResponse of @wadeck-app/project-sdk).
 * Sorted by module id.
 */
export async function collectRelated(projectId: string, options: RelatedOptions): Promise<RelatedEntry[]> {
  const resolved = { baseUrl: options.baseUrl, timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, cache: options.cache };
  const modules = (await installedModules(resolved)).filter((id) => id !== SELF).sort();
  const entries = await Promise.all(modules.map((module) => ask(module, projectId, resolved)));
  return entries.filter((entry): entry is RelatedEntry => entry !== undefined);
}
