import {
  AmbiguousReferenceError,
  HasChildrenError,
  InvalidLabelSelectorError,
  LabelTakenError,
  LockTimeoutError,
  MainPathError,
  ProjectNotFoundError,
  RegistryCorruptError,
  RestoreConflictError,
} from '@wadeck-app/project-sdk';
import { describe, expect, it } from 'vitest';
import { RequestError, toHttpError } from './httpError.js';

describe('toHttpError', () => {
  it('keeps the actionable message of the SDK error and its code, nothing swallowed', () => {
    const error = new ProjectNotFoundError("no project matches 'shpo'; did you mean: shop (3fa9c1d2)?", { ref: 'shpo', suggestions: [] });
    expect(toHttpError(error)).toEqual({
      status: 404,
      body: { error: 'PROJECT_NOT_FOUND', message: "no project matches 'shpo'; did you mean: shop (3fa9c1d2)?" },
    });
  });

  it('puts the hint of the module (what to do in this UI) in the message the shell shows, and apart', () => {
    const error = new HasChildrenError('project base (00000001) has 1 descendant(s): kid (00000002); remove them first, or remove the project together with all its descendants', {
      project: { id: '00000001', name: 'base' },
      children: [{ id: '00000002', name: 'kid' }],
    });
    const { status, body } = toHttpError(error);
    expect(status).toBe(409);
    expect(body['hint']).toBe("Tick 'Also remove the descendants' to remove base together with its 1 descendant(s): kid.");
    expect(body['message']).toBe(`${error.message}. ${body['hint']}`);
  });

  it('adds a hint for a main path that cannot be removed', () => {
    const { body } = toHttpError(new MainPathError('C:\\a is the main path of project shop (00000001) and other paths exist'));
    expect(body['hint']).toBe('Choose another main path first, or name the new main path when removing this one.');
  });

  it.each([
    [new LabelTakenError('name taken', { kind: 'name', label: 'x' }), 409, 'LABEL_TAKEN'],
    [new RestoreConflictError('cannot restore', { project: { id: '00000001', name: 'a' } }), 409, 'RESTORE_CONFLICT'],
    [new AmbiguousReferenceError('ambiguous', { ref: 'x', candidates: [] }), 409, 'AMBIGUOUS_REFERENCE'],
    [new InvalidLabelSelectorError('bad selector', { input: 'a*', reason: 'r' }), 400, 'INVALID_LABEL_SELECTOR'],
    [new LockTimeoutError('lock held by pid 1'), 503, 'LOCK_TIMEOUT'],
    [new RegistryCorruptError('registry.json is not valid JSON'), 500, 'REGISTRY_CORRUPT'],
  ])('maps %s to its status', (error, status, code) => {
    const result = toHttpError(error);
    expect(result.status).toBe(status);
    expect(result.body['error']).toBe(code);
    expect(result.body['message']).toContain(error.message);
  });

  it('answers a request the route layer rejects with its own status, message and hint', () => {
    const result = toHttpError(new RequestError(400, 'the body must be a JSON object', 'Send {"name": "..."}.'));
    expect(result).toEqual({
      status: 400,
      body: { error: 'BAD_REQUEST', message: 'the body must be a JSON object. Send {"name": "..."}.', hint: 'Send {"name": "..."}.' },
    });
  });

  it('turns anything else into a 500 that says it is a bug, with the cause', () => {
    const result = toHttpError(new TypeError('boom'));
    expect(result.status).toBe(500);
    expect(result.body['error']).toBe('UNEXPECTED');
    expect(result.body['message']).toBe('unexpected error in the project module (this is a bug, please report it): TypeError: boom');
    expect(toHttpError('text').body['message']).toContain('text');
  });
});
