import { RequestError } from './httpError.js';
import type { RouteRequest } from './routeKit.js';

/** A query parameter given at most once; empty means absent (a cleared form field sends `?name=`). */
export function queryValue(query: RouteRequest['query'], name: string): string | undefined {
  const value = query?.[name];
  if (Array.isArray(value)) {
    throw new RequestError(400, `'${name}' must be given once, got ${value.length} values`);
  }
  if (value !== undefined && typeof value !== 'string') {
    throw new RequestError(400, `'${name}' must be text`);
  }
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}

/** A query parameter that may be repeated; empty values are dropped. */
export function queryList(query: RouteRequest['query'], name: string): string[] {
  const value = query?.[name];
  const items = Array.isArray(value) ? value : [value];
  if (items.some((item) => item !== undefined && typeof item !== 'string')) {
    throw new RequestError(400, `'${name}' must be text`);
  }
  return (items as (string | undefined)[]).map((item) => (item ?? '').trim()).filter((item) => item !== '');
}

/** The `:ref` of the path (id, name or alias of a project). */
export function refOf(req: RouteRequest): string {
  return req.params?.['ref'] ?? '';
}
