import { RequestError } from './httpError.js';

/** `string`: required text. `string?`: optional text. `strings?`: optional list of text. `boolean?`: optional flag. `ignored?`: accepted and dropped (a form posts its initialData, which repeats the id of the address). */
type FieldKind = 'string' | 'string?' | 'strings?' | 'boolean?' | 'ignored?';
export type BodySpec = Readonly<Record<string, FieldKind>>;

type Parsed<S extends BodySpec> = {
  [K in keyof S as S[K] extends 'string' ? K : never]: string;
} & {
  [K in keyof S as S[K] extends 'string?' ? K : never]?: string;
} & {
  [K in keyof S as S[K] extends 'strings?' ? K : never]?: string[];
} & {
  [K in keyof S as S[K] extends 'boolean?' ? K : never]?: boolean;
};

function bad(message: string): RequestError {
  return new RequestError(400, message);
}

function toList(name: string, value: unknown): string[] {
  const items = typeof value === 'string' ? value.split(/[\s,]+/) : value;
  if (!Array.isArray(items) || items.some((item) => typeof item !== 'string')) {
    throw bad(`the field '${name}' must be a list of text`);
  }
  return (items as string[]).map((item) => item.trim()).filter((item) => item !== '');
}

/**
 * Checks a JSON body against a small spec and returns only the fields that carry a value. Strict on purpose: an unknown field is refused
 * (a typo must not be ignored), a wrong type is refused naming the field. An empty optional text counts as absent: forms send empty fields.
 */
export function parseBody<S extends BodySpec>(raw: unknown, spec: S): Parsed<S> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('the request body must be a JSON object');
  }
  const body = raw as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(spec, key)) {
      throw bad(`unknown field '${key}'; the accepted fields are: ${Object.keys(spec).join(', ')}`);
    }
  }
  const result: Record<string, unknown> = {};
  for (const [name, kind] of Object.entries(spec)) {
    if (kind === 'ignored?') {
      continue;
    }
    const value = body[name];
    if (kind === 'boolean?') {
      if (value === undefined || value === null) {
        continue;
      }
      if (typeof value !== 'boolean') {
        throw bad(`the field '${name}' must be true or false`);
      }
      result[name] = value;
    } else if (kind === 'strings?') {
      if (value === undefined || value === null) {
        continue;
      }
      const list = toList(name, value);
      if (list.length > 0) {
        result[name] = list;
      }
    } else {
      if (value !== undefined && value !== null && typeof value !== 'string') {
        throw bad(`the field '${name}' must be text`);
      }
      const text = typeof value === 'string' ? value.trim() : '';
      if (text !== '') {
        result[name] = text;
      } else if (kind === 'string') {
        throw bad(`the field '${name}' is required`);
      }
    }
  }
  return result as Parsed<S>;
}
