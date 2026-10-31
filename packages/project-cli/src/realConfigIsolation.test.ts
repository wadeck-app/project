import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { defaultRegistryDir } from '@wadeck-app/project-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attemptUnregistration } from './AppCoreRegistration.js';
import { hasStagedModule, removeStagedModules } from './appModuleStaging.js';

const sdk = vi.hoisted(() => ({
  registerModule: vi.fn(),
  unregisterModule: vi.fn(),
  describeRegistration: vi.fn(),
}));
vi.mock('@wadeck-app/app-core-sdk/register', () => sdk);

/**
 * A test that FORGETS to isolate itself, on purpose: it sets no environment variable, as the test that removed the staged module of the user's
 * real app-core did (attemptUnregistration() resolves the registry folder from the environment). The shared setup of the repository
 * (test-support/isolateEnv.ts) must make it act on a temp folder; the guard of the run (test-support/guardRealConfig.ts) fails the run if it
 * did not.
 */
describe('a test that does not isolate itself still cannot reach the real configuration folder', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdk.describeRegistration.mockReturnValue('described');
    sdk.unregisterModule.mockResolvedValue({ status: 'unregistered' });
  });

  it('the registry folder it resolves is a temp folder, not the real one', () => {
    const resolved = defaultRegistryDir(process.env);
    expect(path.relative(os.tmpdir(), resolved).startsWith('..')).toBe(false);
    expect(resolved).not.toBe(process.env['PROJECT_TEST_REAL_CONFIG_DIR']);
  });

  it('the real unregistration, called with no setup of its own, removes the staged copy of the TEMP folder', async () => {
    const registryDir = defaultRegistryDir(process.env);
    const staged = path.join(registryDir, 'app-module', '2026.10.31-000-feedface');
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, 'manifest.json'), '{}');
    expect(hasStagedModule(registryDir)).toBe(true);
    await attemptUnregistration();
    expect(hasStagedModule(registryDir)).toBe(false);
    expect(fs.existsSync(path.join(registryDir, 'app-module'))).toBe(false);
  });

  it('removeStagedModules on the default folder is the temp one too', () => {
    const registryDir = defaultRegistryDir(process.env);
    fs.mkdirSync(path.join(registryDir, 'app-module', 'x'), { recursive: true });
    removeStagedModules(registryDir);
    expect(fs.existsSync(path.join(registryDir, 'app-module'))).toBe(false);
  });

  it('app-core is not the real one: the port of the environment is not 4850', () => {
    expect(process.env['APP_CORE_PORT']).toBeDefined();
    expect(process.env['APP_CORE_PORT']).not.toBe('4850');
  });
});
