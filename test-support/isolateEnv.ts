import { appendFileSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { LAST_TEST_VARIABLE, STARTED_FILES_VARIABLE } from './guardRealConfig.js';
import { isolateEnvironment } from './isolation.js';

/**
 * Mandatory setup file of every vitest config of the repository (see isolation.ts for what it does and why). It runs in each test worker before
 * the test file is loaded.
 */

const isolation = await isolateEnvironment();
afterAll(() => isolation.restore());

// Tell the guard (main process) which test is running, so that a change of the real folder names its likely author.
const lastTest = process.env[LAST_TEST_VARIABLE];
const startedFiles = process.env[STARTED_FILES_VARIABLE];
beforeAll(() => {
  if (startedFiles !== undefined) {
    appendFileSync(startedFiles, `${expect.getState().testPath ?? '?'}\n`);
  }
});
beforeEach(() => {
  if (lastTest !== undefined) {
    writeFileSync(lastTest, `${expect.getState().testPath ?? '?'} :: ${expect.getState().currentTestName ?? '?'}`);
  }
});
