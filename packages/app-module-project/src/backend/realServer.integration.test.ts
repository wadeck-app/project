import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerModule } from '@wadeck-app/app-core-sdk/register';
import { addProject, defaultRegistryDir } from '@wadeck-app/project-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Builds the module with `app-core-cli package` and serves it through a REAL app-core server (`app-core-cli dev`), together with a
 * prototype contributor module (the fixture), then calls the routes over HTTP. The unit tests call the handlers directly: they cannot
 * see how the router fills params, query and body, whether the packaged bundle loads, whether the slots are accepted by app-core, nor
 * the module calling its own server (the "related" aggregation).
 *
 * What this does NOT verify: that a browser renders the pages and the contributed widgets (no browser here; see the README).
 * The server runs on a fixed free port, not APP_CORE_PORT=0: the module calls its own server back, and needs to know the port.
 */

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureDir = join(packageDir, 'src/backend/__fixtures__/contributor');
// Guards against a hang, never performance limits: a shared CI runner (Windows especially) can be several times slower than a laptop.
const SERVER_START_TIMEOUT_MS = 120_000;
const PACKAGE_TIMEOUT_MS = 240_000;
const TEARDOWN_BUDGET_MS = 20_000;

const cliPackageJson = createRequire(import.meta.url).resolve('@wadeck-app/app-core-cli/package.json');
const cliEntry = join(dirname(cliPackageJson), 'dist/cli.bundle.js');

let child: ChildProcess | undefined;
let workDir: string;
let port: number;
let baseUrl: string;
let env: NodeJS.ProcessEnv;
let registryDir: string;
let shopId: string;
let shopFolder: string;
// Everything the server printed: shown in the message of a failure, so that a CI log tells why.
let serverOutput = '';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port: found } = server.address() as { port: number };
      server.close(() => resolve(found));
    });
  });
}

function packageModule(source: string, out: string, extra: string[] = []): void {
  try {
    execFileSync(process.execPath, [cliEntry, 'package', source, '--out', out, '--version', '0.0.0-test-real-server', ...extra], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: PACKAGE_TIMEOUT_MS,
      windowsHide: true,
      env,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    throw new Error(`app-core-cli package ${source} failed:\n${failure.stdout ?? ''}${failure.stderr ?? ''}`);
  }
}

function startServer(builtModule: string): Promise<void> {
  return new Promise((resolve, reject) => {
    serverOutput = '';
    const timer = setTimeout(() => reject(new Error(`app-core-cli dev did not print its URL within ${SERVER_START_TIMEOUT_MS} ms. Output so far:\n${serverOutput}`)), SERVER_START_TIMEOUT_MS);
    child = spawn(process.execPath, [cliEntry, 'dev', builtModule], { windowsHide: true, env });
    const onData = (chunk: Buffer): void => {
      serverOutput += chunk.toString();
      if (/app-core-cli dev: http:\/\/127\.0\.0\.1:\d+/.test(serverOutput)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`app-core-cli dev exited early (code ${code}). Output:\n${serverOutput}`));
    });
  });
}

async function waitPortFree(portToCheck: number, deadline: number): Promise<void> {
  for (;;) {
    const free = await new Promise<boolean>((resolve) => {
      const socket = connect({ port: portToCheck, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(true));
    });
    if (free || Date.now() >= deadline) {
      return;
    }
    await sleep(100);
  }
}

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      signal: AbortSignal.timeout(60_000),
      ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      throw new Error(`${method} ${path} answered ${response.status} with a body that is not JSON: ${text.slice(0, 300)}`);
    }
  } catch (error) {
    throw new Error(`${method} ${path} failed: ${error instanceof Error ? error.message : String(error)}
Output of the server:
${serverOutput}`);
  }
}

/** Waits until both modules are listed: registration and load are asynchronous, a slow runner needs time. */
async function waitForModules(): Promise<void> {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const { body } = await call('GET', '/api/modules');
      const ids = body.modules.map((m: { id: string }) => m.id).sort();
      last = JSON.stringify({ ids, failed: body.failed });
      if (ids.join() === 'project,project-contributor') {
        return;
      }
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`the modules were not both loaded within ${SERVER_START_TIMEOUT_MS} ms (last answer: ${last})
Output of the server:
${serverOutput}`);
}

const api = (path: string): string => `/api/modules/project${path}`;

describe('the packaged module through a real app-core server', () => {
  beforeAll(async () => {
    workDir = mkdtempSync(join(tmpdir(), 'app-module-project-real-server-'));
    const xdg = join(workDir, 'xdg');
    // app-core-cli schedules a detached updater from this config dir: without `autoUpdate: false` it would install a real app-core-cli globally.
    mkdirSync(join(xdg, 'app-core-cli'), { recursive: true });
    writeFileSync(join(xdg, 'app-core-cli', 'config.yml'), 'autoUpdate: false\n');
    port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;
    env = {
      ...process.env,
      APP_CORE_PORT: String(port),
      APP_CORE_CONFIG_DIR: join(workDir, 'app-core'),
      XDG_CONFIG_HOME: xdg,
      HOME: workDir,
      USERPROFILE: workDir,
      APPDATA: join(workDir, 'AppData', 'Roaming'),
      LOCALAPPDATA: join(workDir, 'AppData', 'Local'),
    };
    // The fixture registry: the module reads the shared registry in <xdg>/project at every request.
    registryDir = defaultRegistryDir({ XDG_CONFIG_HOME: xdg });
    shopFolder = join(workDir, 'shop');
    mkdirSync(shopFolder, { recursive: true });
    shopId = (await addProject(registryDir, { name: 'shop', aliases: ['sh'], path: shopFolder, labels: ['state::production'] })).id;

    // The provider is packaged where a dependency would be (`<folder>/dist-module`) so that the contributor can be checked against it.
    const providerFolder = join(workDir, 'provider');
    packageModule(packageDir, join(providerFolder, 'dist-module'));
    const contributorSource = join(workDir, 'contributor-src');
    cpSync(fixtureDir, contributorSource, { recursive: true });
    const contributorOut = join(workDir, 'contributor', 'dist-module');
    packageModule(contributorSource, contributorOut, ['--link', `@wadeck-app/app-module-project=${providerFolder}`]);

    await startServer(join(providerFolder, 'dist-module'));
    const outcome = await registerModule({ id: 'project-contributor', manifestPath: join(contributorOut, 'manifest.json'), env });
    if (outcome.status !== 'registered') {
      throw new Error(`the contributor fixture was not registered: ${JSON.stringify(outcome)}
Output of the server:
${serverOutput}`);
    }
    await waitForModules();
  }, SERVER_START_TIMEOUT_MS * 2 + PACKAGE_TIMEOUT_MS * 2 + 15_000);

  afterAll(async () => {
    const deadline = Date.now() + TEARDOWN_BUDGET_MS;
    if (child && child.exitCode === null) {
      const exited = new Promise<void>((resolve) => child!.once('exit', () => resolve()));
      child.kill();
      await Promise.race([exited, sleep(TEARDOWN_BUDGET_MS)]);
    }
    if (port !== undefined) {
      await waitPortFree(port, deadline);
    }
    // Windows keeps handles on a folder for a moment after its process is gone: retry, then say which folder stays.
    for (let attempt = 0; ; attempt += 1) {
      try {
        rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        return;
      } catch (error) {
        if (Date.now() >= deadline || attempt > 40) {
          console.warn(`[realServer teardown] could not remove the temp dir, delete it by hand: ${workDir} (${error instanceof Error ? error.message : String(error)})`);
          return;
        }
        await sleep(250);
      }
    }
  }, TEARDOWN_BUDGET_MS * 2 + 5_000);

  it('app-core loaded both modules, and the slots of the project module are exposed', async () => {
    const { status, body } = await call('GET', '/api/modules');
    expect(status).toBe(200);
    expect(body.modules.map((m: { id: string }) => m.id).sort()).toEqual(['project', 'project-contributor']);
    expect(body.failed).toEqual([]);
  });

  it('GET /projects reads the registry through the real router, with the label selector and the text filter', async () => {
    const all = await call('GET', api('/projects'));
    expect(all.status).toBe(200);
    expect(all.body.projects.map((p: { name: string }) => p.name)).toEqual(['shop']);
    expect((await call('GET', api('/projects?label=state::*'))).body.count).toBe(1);
    expect((await call('GET', api('/projects?label=state::sandbox'))).body.count).toBe(0);
    expect((await call('GET', api('/projects?q=SH'))).body.count).toBe(1);
    const invalid = await call('GET', api('/projects?label=bad%20label'));
    expect(invalid.status).toBe(400);
  });

  it('GET /projects/:ref hands the :ref param to the handler (id, name, alias)', async () => {
    for (const ref of [shopId, 'shop', 'sh']) {
      const { status, body } = await call('GET', api(`/projects/${ref}`));
      expect(status, ref).toBe(200);
      expect(body.project.id).toBe(shopId);
    }
    expect((await call('GET', api('/projects/nope'))).status).toBe(404);
  });

  it('POST /projects reads the JSON body; two simultaneous requests both succeed; the answers are visible at once on the list', async () => {
    const [one, two] = await Promise.all([call('POST', api('/projects'), { name: 'alpha', virtual: true }), call('POST', api('/projects'), { name: 'beta', labels: 'team::blue' })]);
    expect([one.status, two.status]).toEqual([201, 201]);
    const list = await call('GET', api('/projects'));
    expect(list.body.projects.map((p: { name: string }) => p.name).sort()).toEqual(['alpha', 'beta', 'shop']);
    expect((await call('POST', api('/projects'), { name: 'alpha' })).status).toBe(409);
    expect((await call('POST', api('/projects'), { nmae: 'typo' })).status).toBe(400);
  });

  it('the change routes work end to end: alias, label, parent, rename, remove, restore', async () => {
    expect((await call('POST', api('/projects/alpha/aliases'), { alias: 'al' })).status).toBe(200);
    expect((await call('POST', api('/projects/al/labels'), { labels: ['kind::group'] })).status).toBe(200);
    expect((await call('PUT', api('/projects/beta/parent'), { parent: 'alpha' })).status).toBe(200);
    expect((await call('PUT', api('/projects/beta/name'), { name: 'gamma' })).body.message).toBe("Renamed 'beta' to 'gamma'.");
    const refused = await call('DELETE', api('/projects/alpha'), {});
    expect(refused.status).toBe(409);
    expect(refused.body.message).toContain('Also remove the descendants');
    expect((await call('DELETE', api('/projects/alpha'), { recursive: true })).status).toBe(200);
    expect((await call('GET', api('/deleted'))).body.count).toBe(2);
    expect((await call('POST', api('/deleted/alpha/restore'), { recursive: true })).body.restored).toHaveLength(2);
    const tree = await call('GET', api('/tree'));
    expect(tree.body.rows.map((r: { name: string; depth: number }) => [r.name, r.depth])).toEqual([
      ['shop', 0],
      ['alpha', 0],
      ['gamma', 1],
    ]);
  });

  it('the contributor is accepted by app-core in both slots, and the slot routes answer its DSL nodes', async () => {
    const panels = await call('GET', '/api/slots/project:project-panels');
    expect(panels.status).toBe(200);
    expect(panels.body).toHaveLength(1);
    expect(panels.body[0]).toMatchObject({ $type: 'Section', title: 'Contributor panel' });
    const links = await call('GET', '/api/slots/project:project-links');
    expect(links.body[0]).toMatchObject({ $type: 'ButtonLink', label: 'Contributor link' });
  });

  it('GET /projects/:ref/related calls the contributor over the real server (the module calls its own app-core back)', async () => {
    const { status, body } = await call('GET', api(`/projects/shop/related`));
    expect(status).toBe(200);
    expect(body.warnings).toEqual([]);
    expect(body.panels).toEqual([
      {
        module: 'project-contributor',
        title: 'Fixture items',
        count: 1,
        items: [{ label: `Item of ${shopId}`, url: `/modules/project-contributor/items/${shopId}`, subtitle: 'from the fixture' }],
        moreUrl: `/modules/project-contributor/items?project=${shopId}`,
      },
    ]);
    expect(body.rows[0]).toMatchObject({ module: 'project-contributor', label: `Item of ${shopId}` });
  });
});
