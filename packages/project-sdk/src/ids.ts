import { randomBytes } from 'node:crypto';
import { ProjectError } from './errors.js';

const ID_PATTERN = /^[0-9a-f]{8}$/;
const MAX_ATTEMPTS = 100;

/** True when the text has the shape of a project id (8 lowercase hex chars). */
export function isIdLike(text: string): boolean {
  return ID_PATTERN.test(text);
}

function randomId(): string {
  return randomBytes(4).toString('hex');
}

/** Generates a project id, regenerating while `isTaken` says the candidate collides with a live or deleted project. */
export function generateId(isTaken: (candidate: string) => boolean, random: () => string = randomId): string {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = random();
    if (!isTaken(candidate)) {
      return candidate;
    }
  }
  throw new ProjectError(
    'ID_EXHAUSTED',
    `could not generate a free project id after ${MAX_ATTEMPTS} attempts; the registry is unexpectedly full of ids or the random source is broken, retry the command`,
  );
}
