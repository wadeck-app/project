import { describe, expect, it } from 'vitest';
import { RequestError, toHttpError } from './httpError.js';
import { assertWriteAllowed } from './writeGuard.js';

const ok = { host: '127.0.0.1:4850', 'content-type': 'application/json' };

function refusal(method: string, headers: Record<string, string | string[] | undefined>): RequestError {
  try {
    assertWriteAllowed(method, headers);
  } catch (error) {
    if (error instanceof RequestError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the request to be refused');
}

describe('assertWriteAllowed', () => {
  it.each(['POST', 'PUT', 'DELETE'])('lets a %s with a JSON body, a local Host and no Origin through (a non-browser client)', (method) => {
    expect(() => assertWriteAllowed(method, ok)).not.toThrow();
  });

  it('does not look at read routes at all', () => {
    expect(() => assertWriteAllowed('GET', {})).not.toThrow();
    expect(() => assertWriteAllowed('HEAD', { host: 'evil.example' })).not.toThrow();
  });

  describe('content type', () => {
    it.each([
      ['none', undefined],
      ['form data', 'application/x-www-form-urlencoded'],
      ['plain text (a cross-site form can send it without a preflight)', 'text/plain'],
      ['multipart', 'multipart/form-data; boundary=x'],
    ])('answers 415 for %s, saying what to send', (_name, type) => {
      const error = refusal('POST', { ...ok, 'content-type': type });
      expect(error.status).toBe(415);
      expect(error.message).toContain('Content-Type: application/json');
      expect(error.hint).toContain('Content-Type: application/json');
      expect(toHttpError(error).body['error']).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it.each(['application/json', 'application/json; charset=utf-8', 'Application/JSON'])('accepts %s', (type) => {
      expect(() => assertWriteAllowed('PUT', { ...ok, 'content-type': type })).not.toThrow();
    });

    it('is also required on a DELETE without a body (the header is what proves the request is not a simple cross-site one)', () => {
      expect(refusal('DELETE', { host: ok.host }).status).toBe(415);
    });
  });

  describe('Host (DNS rebinding)', () => {
    it.each(['127.0.0.1', '127.0.0.1:4850', 'localhost', 'localhost:4850', 'LOCALHOST:1', '[::1]', '[::1]:4850'])('accepts %s', (host) => {
      expect(() => assertWriteAllowed('POST', { ...ok, host })).not.toThrow();
    });

    it.each([
      ['a foreign name', 'evil.example'],
      ['a foreign name with a port', 'evil.example:4850'],
      ['a name that starts like localhost', 'localhost.evil.example'],
      ['another address', '10.0.0.5:4850'],
      ['no Host', undefined],
      ['an empty Host', ''],
    ])('answers 403 for %s', (_name, host) => {
      const error = refusal('POST', { ...ok, host });
      expect(error.status).toBe(403);
      expect(error.message).toContain('Host');
      expect(toHttpError(error).body['error']).toBe('FORBIDDEN');
    });
  });

  describe('Origin (cross-site requests)', () => {
    it('accepts an Origin whose host is the Host of the request', () => {
      expect(() => assertWriteAllowed('POST', { ...ok, origin: 'http://127.0.0.1:4850' })).not.toThrow();
      expect(() => assertWriteAllowed('POST', { ...ok, host: 'localhost:4850', origin: 'http://localhost:4850' })).not.toThrow();
    });

    it.each([
      ['another site', 'https://evil.example'],
      ['another port of the same machine', 'http://127.0.0.1:9999'],
      ['another local name', 'http://localhost:4850'],
      ['an opaque origin', 'null'],
      ['something that is not an address', 'not an origin'],
    ])('answers 403 for %s', (_name, origin) => {
      const error = refusal('POST', { ...ok, origin });
      expect(error.status).toBe(403);
      expect(error.message).toContain('Origin');
      expect(error.hint).toBeDefined();
    });

    it('refuses a repeated Origin header', () => {
      expect(refusal('POST', { ...ok, origin: ['http://127.0.0.1:4850', 'http://127.0.0.1:4850'] }).status).toBe(403);
    });
  });
});
