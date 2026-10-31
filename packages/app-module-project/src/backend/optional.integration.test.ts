import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerModule, unregisterModule } from '@wadeck-app/app-core-sdk/register';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type DevServer, PACKAGE_TIMEOUT_MS, SERVER_START_TIMEOUT_MS, freePort, isolatedEnv, packageModule, removeWorkDir, runCli, startDevServer } from './serverKit.js';

/**
 * The project module contributes to task, queue and flow through `optionalRequires`. Provider fixtures replicate each slot (same module id,
 * same `expose.slots` and `accepts`, a page that embeds the slot with the host context of the real page) and are loaded by a REAL app-core
 * (`app-core-cli dev`) in a temp config folder, on a free port: never 4850, never the real config folders.
 */

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtures = join(packageDir, 'src/backend/__fixtures__/providers');
const PROVIDERS = ['task', 'queue', 'flow'] as const;
const SLOTS: Record<(typeof PROVIDERS)[number], string[]> = {
  task: ['task:project-header'],
  queue: ['queue:project-header'],
  flow: ['flow:execution-project-header'],
};

let workDir: string;
let port: number;
let env: NodeJS.ProcessEnv;
let server: DevServer;
// <workDir>/<id>/dist-module: the packaged fixtures, where `--link <id>=<workDir>/<id>` finds them.
let linkDir: (id: string) => string;

/** The npm package names the providers are linked under (see checkAgainst). */
const PACKAGE_OF: Record<(typeof PROVIDERS)[number], string> = {
  task: '@wadeck-app/app-module-task',
  queue: '@wadeck-app/app-module-queue',
  flow: '@wadeck-app/app-module-flow',
};

/**
 * `app-core-cli check` looks for a provider only among the dependencies of package.json (dependencies, devDependencies, peerDependencies),
 * and `--link` is keyed by the PACKAGE name, not by the module id; the warning "(node_modules, or --link task=<folder>)" suggests the id and
 * does not work. The real package.json lists no provider (the module is independent of them), so the check is run on a COPY of the module
 * whose package.json lists the providers as devDependencies, linked to the given folders.
 */
function checkAgainst(folders: Partial<Record<(typeof PROVIDERS)[number], string>>) {
  const copy = mkdtempSync(join(workDir, 'check-copy-'));
  for (const entry of ['manifest.json', 'package.json', '.gitignore', 'src']) {
    cpSync(join(packageDir, entry), join(copy, entry), { recursive: true });
  }
  const pkg = JSON.parse(readFileSync(join(copy, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  const links: string[] = [];
  for (const [id, folder] of Object.entries(folders)) {
    pkg.devDependencies[PACKAGE_OF[id as (typeof PROVIDERS)[number]]] = '*';
    links.push('--link', `${PACKAGE_OF[id as (typeof PROVIDERS)[number]]}=${folder}`);
  }
  writeFileSync(join(copy, 'package.json'), JSON.stringify(pkg, null, 2));
  return runCli(env, 'check', [copy, ...links]);
}

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${server.baseUrl}${path}`, { signal: AbortSignal.timeout(60_000) });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

async function project(): Promise<{ warnings: string[]; extensionPoints: { kind: string; slot: string; inactive?: string }[] }> {
  const { body } = await get('/api/modules');
  const found = body.modules.find((m: { id: string }) => m.id === 'project');
  if (found === undefined) {
    throw new Error(`the project module is not loaded: ${JSON.stringify(body)}\nOutput of the server:\n${server.output()}`);
  }
  return { warnings: found.warnings ?? [], extensionPoints: found.extensionPoints };
}

const widgetsOf = async (provider: string) => (await project()).extensionPoints.filter((point) => point.kind === 'widget' && point.slot.startsWith(`${provider}:`));

async function register(id: (typeof PROVIDERS)[number]): Promise<void> {
  const outcome = await registerModule({ id, manifestPath: join(linkDir(id), 'dist-module', 'manifest.json'), env });
  if (outcome.status !== 'registered') {
    throw new Error(`the fixture ${id} was not registered: ${JSON.stringify(outcome)}\nOutput of the server:\n${server.output()}`);
  }
}

describe('optional contributions to task, queue and flow', () => {
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'app-module-project-optional-'));
    port = await freePort();
    env = isolatedEnv(workDir, port);
    linkDir = (id) => join(workDir, 'providers', id);
    for (const id of PROVIDERS) {
      // A copy: `check` refuses extra folders at the module root, and the fixture folder must stay untouched.
      const source = join(workDir, 'src', id);
      cpSync(join(fixtures, id), source, { recursive: true });
      packageModule(env, source, join(linkDir(id), 'dist-module'));
    }
    // The project module is packaged WITHOUT the providers (they are absent: the warnings are the expected outcome).
    packageModule(env, packageDir, join(workDir, 'project'));
    server = await startDevServer(env, join(workDir, 'project'), port);
  }, SERVER_START_TIMEOUT_MS + PACKAGE_TIMEOUT_MS * 2);

  afterAll(async () => {
    await server?.stop();
    removeWorkDir(workDir);
  }, 120_000);

  describe('the providers are absent', () => {
    it('check and package pass (exit 0) and print one warning per optional provider that was not found', () => {
      for (const command of ['check', 'package'] as const) {
        const args = command === 'check' ? [packageDir] : [packageDir, '--out', join(workDir, 'again'), '--version', '0.0.0-test-optional'];
        const result = runCli(env, command, args);
        expect(result.status, `${command}: ${result.output}`).toBe(0);
        for (const provider of PROVIDERS) {
          expect(result.output, `${command} must warn about ${provider}`).toContain(`optional module "${provider}" was not found`);
        }
      }
    });

    it('the project module is loaded, not failed, and works', async () => {
      const { status, body } = await get('/api/modules/project/projects');
      expect(status).toBe(200);
      expect(body.projects).toEqual([]);
      const modules = (await get('/api/modules')).body;
      expect(modules.failed).toEqual([]);
    });

    it('says, in warnings and per contribution, that the contributions are inactive and why', async () => {
      const loaded = await project();
      expect(loaded.warnings.length).toBeGreaterThan(0);
      for (const provider of PROVIDERS) {
        const widgets = await widgetsOf(provider);
        expect(widgets.length, provider).toBeGreaterThan(0);
        for (const widget of widgets) {
          expect(widget.inactive, `${widget.slot} is inactive`).toContain(`module "${provider}" is not loaded`);
        }
      }
    });

    it('gives nothing to show on a slot of a provider that is not there', async () => {
      const { body } = await get('/api/slots/task:project-header');
      expect(JSON.stringify(body ?? '')).not.toContain('/modules/project/');
    });
  });

  describe.each(PROVIDERS)('when %s is loaded (later)', (provider) => {
    it('activates its contributions, which the slot then serves', async () => {
      await register(provider);
      for (const widget of await widgetsOf(provider)) {
        expect(widget.inactive, `${widget.slot} must be active`).toBeUndefined();
      }
      for (const slot of SLOTS[provider]) {
        const { status, body } = await get(`/api/slots/${slot}`);
        expect(status, slot).toBe(200);
        expect(body, slot).toEqual([expect.objectContaining({ $type: 'ButtonLink', to: '/modules/project/' })]);
      }
    });

    it('leaves the contributions to the others inactive, with their reason', async () => {
      const others = PROVIDERS.filter((id) => id !== provider && !loadedSoFar.includes(id));
      for (const other of others) {
        for (const widget of await widgetsOf(other)) {
          expect(widget.inactive, widget.slot).toContain(`module "${other}" is not loaded`);
        }
      }
      loadedSoFar.push(provider);
    });
  });

  describe('when a provider goes away', () => {
    it('deactivates its contributions and unloads nobody (no cascade)', async () => {
      const outcome = await unregisterModule({ id: 'task', env });
      expect(outcome.status).toBe('unregistered');
      for (const widget of await widgetsOf('task')) {
        expect(widget.inactive).toContain('module "task" is not loaded');
      }
      expect((await get('/api/modules/project/projects')).status).toBe(200);
      const ids = (await get('/api/modules')).body.modules.map((m: { id: string }) => m.id).sort();
      expect(ids).toEqual(['flow', 'project', 'queue']);
    });
  });

  describe('check against the providers (--link)', () => {
    it('validates the contributions against the slots they find: exit 0 and no "not found" warning', () => {
      const result = checkAgainst({ task: linkDir('task'), queue: linkDir('queue'), flow: linkDir('flow') });
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain('was not found');
    });

    it('refuses a contribution whose root $type the provider does not accept, naming the slot and the types', () => {
      const bad = join(workDir, 'bad-task');
      cpSync(join(fixtures, 'task'), bad, { recursive: true });
      const manifest = JSON.parse(readFileSync(join(bad, 'manifest.json'), 'utf8')) as { expose: { slots: Record<string, { accepts: string[] }> } };
      manifest.expose.slots['project-header'] = { accepts: ['Badge'] };
      writeFileSync(join(bad, 'manifest.json'), JSON.stringify(manifest, null, 2));
      packageModule(env, bad, join(workDir, 'bad-providers', 'task', 'dist-module'));
      const result = checkAgainst({ task: join(workDir, 'bad-providers', 'task') });
      expect(result.status, result.output).not.toBe(0);
      expect(result.output).toContain('task:project-header');
      expect(result.output).toContain('ButtonLink');
    });
  });

  describe('the real built modules of the owners (read-only copies)', () => {
    const roots = {
      task: join(packageDir, '../../../task/packages/app-module-task/dist-module'),
      queue: join(packageDir, '../../../queue/packages/app-module-queue/dist-module'),
      flow: join(packageDir, '../../../agent-fleet/packages/app-module-flow/dist-module'),
    };
    const present = Object.values(roots).every((root) => existsSync(join(root, 'manifest.json')));

    // Not a silent skip: the title says why. These repositories are not part of this one, so they are absent on CI.
    it.skipIf(!present)('accept the widgets of the project module (their real expose.slots and accepts) [needs the sibling repositories built]', () => {
      const real = join(workDir, 'real');
      const folders: Partial<Record<(typeof PROVIDERS)[number], string>> = {};
      for (const [id, root] of Object.entries(roots)) {
        mkdirSync(join(real, id), { recursive: true });
        cpSync(root, join(real, id, 'dist-module'), { recursive: true });
        folders[id as (typeof PROVIDERS)[number]] = join(real, id);
      }
      const result = checkAgainst(folders);
      expect(result.status, result.output).toBe(0);
      expect(result.output).not.toContain('was not found');
    });
  });
});

// The providers loaded so far by the tests above, in order (they share one server).
const loadedSoFar: string[] = [];
