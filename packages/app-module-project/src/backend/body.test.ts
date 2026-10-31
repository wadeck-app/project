import { describe, expect, it } from 'vitest';
import { RequestError } from './httpError.js';
import { parseBody } from './body.js';

const SPEC = { name: 'string', path: 'string?', aliases: 'strings?', virtual: 'boolean?' } as const;

describe('parseBody', () => {
  it('returns the fields that are given, typed, and leaves out the others', () => {
    expect(parseBody({ name: 'shop', aliases: ['sh', 'store'], virtual: true }, SPEC)).toEqual({ name: 'shop', aliases: ['sh', 'store'], virtual: true });
  });

  it('trims strings and treats an empty optional string as absent (a form sends empty fields)', () => {
    expect(parseBody({ name: '  shop ', path: '   ' }, SPEC)).toEqual({ name: 'shop' });
  });

  it('accepts a list as text separated by commas, spaces or new lines, and drops empty items', () => {
    expect(parseBody({ name: 'a', aliases: 'sh, store\nshop  ' }, SPEC).aliases).toEqual(['sh', 'store', 'shop']);
    expect(parseBody({ name: 'a', aliases: ['', ' x '] }, SPEC).aliases).toEqual(['x']);
  });

  it('requires a required string, saying which one', () => {
    const run = () => parseBody({ path: '/x' }, SPEC);
    expect(run).toThrow(RequestError);
    expect(run).toThrow("the field 'name' is required");
    expect(() => parseBody({ name: '  ' }, SPEC)).toThrow("the field 'name' is required");
  });

  it.each([
    [{ name: 3 }, "the field 'name' must be text"],
    [{ name: 'a', aliases: [1] }, "the field 'aliases' must be a list of text"],
    [{ name: 'a', aliases: { x: 1 } }, "the field 'aliases' must be a list of text"],
    [{ name: 'a', virtual: 'yes' }, "the field 'virtual' must be true or false"],
  ])('refuses a wrongly typed field %j', (body, message) => {
    const run = () => parseBody(body, SPEC);
    expect(run).toThrow(message);
    try {
      run();
    } catch (error) {
      expect((error as RequestError).status).toBe(400);
    }
  });

  it('refuses a field it does not know, listing the accepted ones (a typo must not be ignored)', () => {
    expect(() => parseBody({ name: 'a', nmae: 'b' }, SPEC)).toThrow("unknown field 'nmae'; the accepted fields are: name, path, aliases, virtual");
  });

  it('refuses a body that is not a JSON object', () => {
    for (const body of [undefined, null, 'text', 3, [], [{}]]) {
      expect(() => parseBody(body, SPEC), JSON.stringify(body)).toThrow('the request body must be a JSON object');
    }
  });

  it('with nothing required, an empty object is fine and gives nothing', () => {
    expect(parseBody({}, { recursive: 'boolean?' } as const)).toEqual({});
  });

  it('a boolean given as null is absent', () => {
    expect(parseBody({ recursive: null }, { recursive: 'boolean?' } as const)).toEqual({});
  });
});

describe('parseBody with a field that only repeats the address', () => {
  // A form posts its whole initialData, which carries the id used in the URL of the route.
  const spec = { ref: 'ignored?', alias: 'string' } as const;

  it('accepts the field of a form and does not return it', () => {
    expect(parseBody({ ref: '0000000a', alias: 'x' }, spec)).toEqual({ alias: 'x' });
  });

  it('does not require it', () => {
    expect(parseBody({ alias: 'x' }, spec)).toEqual({ alias: 'x' });
  });
});
