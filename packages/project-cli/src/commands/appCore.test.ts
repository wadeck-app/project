import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

const registration = vi.hoisted(() => ({
  attemptStagedRegistration: vi.fn(),
  attemptUnregistration: vi.fn(),
}));
vi.mock('../AppCoreRegistration.js', () => registration);

const manifest = vi.hoisted(() => ({ resolveAppModuleManifest: vi.fn() }));
vi.mock('../appModuleManifest.js', () => manifest);

describe('project cli register | unregister', () => {
  let h: Harness;

  beforeEach(() => {
    vi.resetAllMocks();
    h = makeHarness();
    manifest.resolveAppModuleManifest.mockReturnValue('/pkg/app-module/manifest.json');
  });

  afterEach(() => h.cleanup());

  describe('register', () => {
    it.each([
      ['registered', 'app-core: module "project" registered'],
      ['deferred', 'app-core is not running: module "project" will be loaded at its next start'],
      ['skipped', 'app-core is not installed'],
      ['unconfirmed', 'app-core did not confirm. To settle it, wait a few seconds and run: project cli register'],
    ])('exits 0 and prints the message when the outcome is "%s"', async (status, message) => {
      registration.attemptStagedRegistration.mockResolvedValue({ ok: true, status, message });
      const result = await h.cli(['cli', 'register']);
      expect(result.code).toBe(0);
      expect(result.out).toBe(message);
      expect(registration.attemptStagedRegistration).toHaveBeenCalledWith('/pkg/app-module/manifest.json');
    });

    it('--json prints ok, the status and the message (a script that needs certainty tests the status)', async () => {
      registration.attemptStagedRegistration.mockResolvedValue({ ok: true, status: 'deferred', message: 'later' });
      const result = await h.cli(['cli', 'register', '--json']);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out)).toEqual({ ok: true, status: 'deferred', message: 'later' });
    });

    it('exits 1 with the reason when app-core refuses, and never prints it as a success', async () => {
      registration.attemptStagedRegistration.mockResolvedValue({ ok: false, status: 'refused', message: 'app-core: refused module "project" (HTTP 422): bad manifest' });
      const result = await h.cli(['cli', 'register']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('refused module "project" (HTTP 422): bad manifest');
      expect(result.out).toBe('');
    });

    it('exits 1 naming the places it looked and the fix when no packaged manifest exists', async () => {
      manifest.resolveAppModuleManifest.mockImplementation(() => {
        throw new Error('No app-module manifest found. Looked for /a and /b');
      });
      const result = await h.cli(['cli', 'register']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('No app-module manifest found. Looked for /a and /b');
      expect(registration.attemptStagedRegistration).not.toHaveBeenCalled();
    });
  });

  describe('unregister', () => {
    it('exits 0 and prints the message', async () => {
      registration.attemptUnregistration.mockResolvedValue({ ok: true, status: 'unregistered', message: 'app-core: module "project" removed' });
      const result = await h.cli(['cli', 'unregister']);
      expect(result.code).toBe(0);
      expect(result.out).toBe('app-core: module "project" removed');
    });

    it('exits 1 with the reason on a refusal', async () => {
      registration.attemptUnregistration.mockResolvedValue({ ok: false, status: 'refused', message: 'app-core: refused module "project" (HTTP 500): x' });
      const result = await h.cli(['cli', 'unregister']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('(HTTP 500): x');
    });

    it('does not need the manifest (it works after the package was removed)', async () => {
      registration.attemptUnregistration.mockResolvedValue({ ok: true, status: 'skipped', message: 'nothing' });
      await h.cli(['cli', 'unregister']);
      expect(manifest.resolveAppModuleManifest).not.toHaveBeenCalled();
    });
  });

  it('the help says that the first registration is explicit and that only this command does it', async () => {
    const result = await h.cli(['--help']);
    expect(result.out).toContain('first registration');
    expect(result.out).toContain('only this command');
  });

  it('both commands are in the help of the cli group', async () => {
    const result = await h.cli(['--help']);
    expect(result.out).toContain('cli register');
    expect(result.out).toContain('cli unregister');
  });
});
