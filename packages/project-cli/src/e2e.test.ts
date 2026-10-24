import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Project, loadDeleted, loadRegistry, normalizePath, validateRegistry } from '@wadeck-app/project-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'dist', 'main.js');

interface Outcome {
  code: number | null;
  stdout: string;
  stderr: string;
}

interface Sandbox {
  root: string;
  registryDir: string;
  env: NodeJS.ProcessEnv;
  dir: (name: string) => string;
  cli: (argv: string[], cwd?: string, extraEnv?: NodeJS.ProcessEnv) => Promise<Outcome>;
}

function withoutFinalNewline(text: string): string {
  return text.replace(/\r?\n$/, '');
}

/** Real temporary home, XDG_CONFIG_HOME and work folders: the real ~/.config/project is never reachable from the spawned CLI. */
function makeSandbox(): Sandbox {
  // Real path on purpose: on macOS the temporary directory is a symlink (/var -> /private/var) and the spawned CLI sees process.cwd() as the real path.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'project-cli-e2e-')));
  const work = join(root, 'work');
  mkdirSync(work, { recursive: true });
  const { PROJECT_PROJECT: _inherited, ...inherited } = process.env;
  const env: NodeJS.ProcessEnv = { ...inherited, XDG_CONFIG_HOME: join(root, 'xdg'), HOME: join(root, 'home'), USERPROFILE: join(root, 'home') };
  return {
    root,
    registryDir: join(root, 'xdg', 'project'),
    env,
    dir: (name) => {
      mkdirSync(join(work, name), { recursive: true });
      return normalizePath(join(work, name));
    },
    cli: (argv, cwd = work, extraEnv = {}) =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entry, ...argv], { cwd, env: { ...env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout: withoutFinalNewline(stdout), stderr: withoutFinalNewline(stderr) }));
      }),
  };
}

function projectNamed(sandbox: Sandbox, name: string): Project {
  const found = loadRegistry(sandbox.registryDir).projects.find((p) => p.name === name);
  if (found === undefined) {
    throw new Error(`test setup: no project '${name}' in ${sandbox.registryDir}`);
  }
  return found;
}

beforeAll(() => {
  // These tests drive the BUILT CLI: a missing build is a failure, never a skip.
  if (!existsSync(entry)) {
    throw new Error(`${entry} is missing: run 'npm run build' before 'npm test' (the end-to-end tests spawn the compiled CLI)`);
  }
});

describe('end-to-end: a shop project with a worktree and a shared base', () => {
  let sandbox: Sandbox;
  let shop: string;
  let worktree: string;
  let elsewhere: string;

  beforeAll(() => {
    sandbox = makeSandbox();
    shop = sandbox.dir('shop');
    worktree = sandbox.dir('shop-wt');
    elsewhere = sandbox.dir('elsewhere');
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  // The steps build on each other and run in order.
  it('1. registers the folder with an alias', async () => {
    const result = await sandbox.cli(['add', 'shop', '--alias', 'sh']);
    expect(result.code, result.stderr).toBe(0);
    expect(projectNamed(sandbox, 'shop')).toMatchObject({ aliases: ['sh'], paths: [{ path: shop, main: true }] });
  });

  it('2. adds a second, non-main path', async () => {
    const result = await sandbox.cli(['paths', 'add', 'shop', worktree]);
    expect(result.code, result.stderr).toBe(0);
    expect(projectNamed(sandbox, 'shop').paths).toEqual([
      { path: shop, main: true },
      { path: worktree, main: false },
    ]);
  });

  it('3. resolves from the main path, from the worktree, and fails loudly from an unrelated folder', async () => {
    const deep = sandbox.dir('shop/src/deep');
    const fromMain = await sandbox.cli(['resolve', '--json'], deep);
    expect(JSON.parse(fromMain.stdout)).toMatchObject({ name: 'shop', source: 'cwd', path: shop, pathVia: 'cwd' });
    const fromWorktree = await sandbox.cli(['resolve', '--json'], worktree);
    expect(JSON.parse(fromWorktree.stdout)).toMatchObject({ name: 'shop', path: worktree, pathVia: 'cwd' });
    const unrelated = await sandbox.cli(['resolve'], elsewhere);
    expect(unrelated.code).toBe(1);
    expect(unrelated.stdout).toBe('');
    expect(unrelated.stderr).toContain(`error: no project in scope for ${elsewhere}`);
    expect(unrelated.stderr).toContain('Registered: shop');
    expect(unrelated.stderr).toContain(`
hint: pass a project reference, or register this folder with: project add "${elsewhere}"`);
  });

  it('3b. resolves from a cwd reached through a junction (symlink on POSIX) and refuses to register it as another project', async () => {
    const link = join(dirname(shop), 'shop-link');
    symlinkSync(shop, link, process.platform === 'win32' ? 'junction' : 'dir');
    const viaLink = await sandbox.cli(['resolve', '--json'], join(link, 'src'));
    expect(JSON.parse(viaLink.stdout)).toMatchObject({ name: 'shop', source: 'cwd', path: shop, pathVia: 'cwd' });
    const duplicate = await sandbox.cli(['add', link, '--name', 'dup']);
    expect(duplicate.code).toBe(1);
    expect(duplicate.stderr).toContain('is already registered by project shop');
  });

  it('4. resolves --project from an unrelated folder to the main path, and never auto-selects a typo', async () => {
    const byAlias = await sandbox.cli(['-p', 'sh', 'resolve', '--json'], elsewhere);
    expect(JSON.parse(byAlias.stdout)).toMatchObject({ name: 'shop', source: 'flag', path: shop, pathVia: 'main' });
    const typo = await sandbox.cli(['resolve', '-p', 'shpo'], elsewhere);
    expect(typo.code).toBe(1);
    expect(typo.stdout).toBe('');
    expect(typo.stderr).toContain("no project matches 'shpo'");
    expect(typo.stderr).toContain(`did you mean: sh (alias of shop (${projectNamed(sandbox, 'shop').id})), shop`);
    expect(typo.stderr).not.toContain('project: shop');
  });

  it('5. shows the parent chain once shop is made a child of a virtual base', async () => {
    expect((await sandbox.cli(['add', '--virtual', '--name', 'base'])).code).toBe(0);
    expect((await sandbox.cli(['parent', 'set', 'shop', 'base'])).code).toBe(0);
    const shown = await sandbox.cli(['show', 'shop']);
    expect(shown.stdout).toContain('parent chain: base > shop');
  });

  it('9. prints valid JSON on stdout for list, show and resolve, and the resolution line on stderr', async () => {
    const list = await sandbox.cli(['list', '--json'], elsewhere);
    expect(JSON.parse(list.stdout)).toHaveLength(2);
    expect(list.stderr).toBe(`registry: ${sandbox.registryDir}`);
    const show = await sandbox.cli(['show', 'shop', '--json'], elsewhere);
    expect(JSON.parse(show.stdout)).toMatchObject({ name: 'shop', chain: [{ name: 'base' }, { name: 'shop' }] });
    expect(show.stderr).toBe(`project: shop (${projectNamed(sandbox, 'shop').id}) via <ref> argument, path ${shop} (main); registry: ${sandbox.registryDir}`);
    const resolve = await sandbox.cli(['resolve', '--json'], worktree);
    expect(JSON.parse(resolve.stdout).name).toBe('shop');
    expect(resolve.stderr).toBe(`project: shop (${projectNamed(sandbox, 'shop').id}) via cwd, path ${worktree} (cwd); registry: ${sandbox.registryDir}`);
  });

  it('6. refuses to remove a parent, then soft-deletes both and keeps the data folders', async () => {
    const ids = [projectNamed(sandbox, 'base').id, projectNamed(sandbox, 'shop').id];
    const folders = await Promise.all(['base', 'shop'].map(async (name) => (await sandbox.cli(['path', name])).stdout.trim()));
    for (const folder of folders) {
      mkdirSync(join(folder, 'task', 'data'), { recursive: true });
      writeFileSync(join(folder, 'task', 'data', 'keep.txt'), 'kept');
    }
    const refused = await sandbox.cli(['remove', 'base']);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--recursive');
    const done = await sandbox.cli(['remove', 'base', '--recursive']);
    expect(done.code, done.stderr).toBe(0);
    expect(loadRegistry(sandbox.registryDir).projects).toEqual([]);
    expect(loadDeleted(sandbox.registryDir).projects.map((p) => p.id).sort()).toEqual([...ids].sort());
    for (const folder of folders) {
      expect(readFileSync(join(folder, 'task', 'data', 'keep.txt'), 'utf8')).toBe('kept');
    }
  });
});

describe('end-to-end: concurrent writers', () => {
  let sandbox: Sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  it('7. keeps all 30 projects when two CLI processes add 15 each at the same time', async () => {
    const writer = async (prefix: string): Promise<Outcome[]> => {
      const outcomes: Outcome[] = [];
      for (let i = 0; i < 15; i++) {
        outcomes.push(await sandbox.cli(['add', '--virtual', '--name', `${prefix}-${i}`]));
      }
      return outcomes;
    };
    const outcomes = (await Promise.all([writer('wa'), writer('wb')])).flat();
    for (const outcome of outcomes) {
      expect(outcome.code, outcome.stderr).toBe(0);
    }
    const registry = loadRegistry(sandbox.registryDir);
    expect(registry.projects).toHaveLength(30);
    expect(() => validateRegistry(registry, { checkPaths: false })).not.toThrow();
  });
});

describe('end-to-end: failures and isolation', () => {
  let sandbox: Sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  it('8. names the corrupt registry.json in an actionable error', async () => {
    mkdirSync(sandbox.registryDir, { recursive: true });
    const file = join(sandbox.registryDir, 'registry.json');
    writeFileSync(file, '{oops');
    const result = await sandbox.cli(['list']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('error: ');
    expect(result.stderr).toContain(file);
    expect(result.stderr).toContain('not valid JSON');
    expect(result.stderr).toContain('fix or restore');
  });

  it('writes under XDG_CONFIG_HOME and never under the real default directory', async () => {
    const fresh = makeSandbox();
    try {
      const realRegistry = join(homedir(), '.config', 'project', 'registry.json');
      const before = existsSync(realRegistry) ? readFileSync(realRegistry, 'utf8') : undefined;
      const result = await fresh.cli(['add', '--virtual', '--name', 'iso']);
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toBe(`registry: ${fresh.registryDir}`);
      expect(existsSync(join(fresh.registryDir, 'registry.json'))).toBe(true);
      expect(existsSync(realRegistry) ? readFileSync(realRegistry, 'utf8') : undefined).toBe(before);
    } finally {
      rmSync(fresh.root, { recursive: true, force: true });
    }
  });

  it('falls back to <home>/.config/project when XDG_CONFIG_HOME is not set', async () => {
    const fresh = makeSandbox();
    try {
      const home = join(fresh.root, 'home');
      const result = await fresh.cli(['add', '--virtual', '--name', 'iso'], undefined, { XDG_CONFIG_HOME: '' });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toBe(`registry: ${join(home, '.config', 'project')}`);
      expect(existsSync(join(home, '.config', 'project', 'registry.json'))).toBe(true);
    } finally {
      rmSync(fresh.root, { recursive: true, force: true });
    }
  });

  it('announces on stderr that it waits for a held registry lock, then completes once it is released', async () => {
    const fresh = makeSandbox();
    try {
      mkdirSync(fresh.registryDir, { recursive: true });
      const lock = join(fresh.registryDir, 'registry.lock');
      writeFileSync(lock, JSON.stringify({ pid: 4242, token: 'held-by-the-test', host: 'test', createdAt: new Date().toISOString() }));
      const pending = fresh.cli(['add', '--virtual', '--name', 'waiter']);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      rmSync(lock);
      const result = await pending;
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain('waiting for the registry lock held by pid 4242');
      expect(loadRegistry(fresh.registryDir).projects.map((p) => p.name)).toEqual(['waiter']);
    } finally {
      rmSync(fresh.root, { recursive: true, force: true });
    }
  });

  it('prints the version and fails with exit 2 on a usage error, as a real process', async () => {
    const version = await sandbox.cli(['--version']);
    expect(version).toMatchObject({ code: 0, stderr: '' });
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
    const usage = await sandbox.cli(['nope']);
    expect(usage.code).toBe(2);
    expect(usage.stderr).toContain("Run 'project --help' for usage.");
  });
});

describe('end-to-end: the update notice', () => {
  let sandbox: Sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
    mkdirSync(sandbox.registryDir, { recursive: true });
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  const stateFile = () => join(sandbox.registryDir, 'update-state.json');

  it('tells once, on stderr, that a background update installed a new version', async () => {
    writeFileSync(stateFile(), JSON.stringify({ status: 'success', targetVersion: '2026.10.25-001-abc', timestamp: 1 }));
    const first = await sandbox.cli(['list', '--json']);
    expect(first.stderr).toContain('[project] Updated to v2026.10.25-001-abc');
    expect(JSON.parse(first.stdout)).toEqual([]);
    const second = await sandbox.cli(['list', '--json']);
    expect(second.stderr).not.toContain('Updated to');
    // The state stays, for cli rollback, which needs its previousVersion.
    expect(existsSync(stateFile())).toBe(true);
  });

  it('tells that a background update failed, with its reason and what to run', async () => {
    writeFileSync(stateFile(), JSON.stringify({ status: 'failed', error: 'npm root -g failed', timestamp: 1 }));
    const result = await sandbox.cli(['list', '--json']);
    expect(result.stderr).toContain('[project] Background update failed (npm root -g failed). Run: project cli update');
  });
});

describe('end-to-end: the logs', () => {
  let sandbox: Sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  const today = () => new Date().toISOString().slice(0, 10);

  it('shows the invocations, their outcome and the updater entries of the same daily file with cli logs', async () => {
    await sandbox.cli(['add', '--virtual', '--name', 'base']);
    await sandbox.cli(['add', '--virtual', '--name', 'base']);
    // The updater (shared-updater) appends its own entries, same file and format.
    const file = join(sandbox.registryDir, 'logs', `${today()}.ndjson`);
    appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), level: 'info', msg: '@wadeck-app/project-cli checking for updates (current: 1)' })}\n`);
    const logs = await sandbox.cli(['cli', 'logs']);
    expect(logs.code, logs.stderr).toBe(0);
    expect(logs.stdout).toContain('"msg":"cmd: project add --virtual --name base"');
    expect(logs.stdout).toContain('"msg":"mutation: add project base (');
    expect(logs.stdout).toContain('"level":"error","msg":"exit 1 (LABEL_TAKEN)"');
    expect(logs.stdout).toContain('checking for updates (current: 1)');
    const updateLog = await sandbox.cli(['cli', 'update', '--log']);
    expect(updateLog.stdout).toContain('checking for updates (current: 1)');
  });

  it('follows the log: prints what is there, then new lines (stopped by the test)', async () => {
    const child = spawn(process.execPath, [entry, 'cli', 'logs', '--follow'], { env: sandbox.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    try {
      await waitFor(() => out.includes('cmd: project cli logs --follow'));
      await sandbox.cli(['list']);
      await waitFor(() => out.includes('cmd: project list'));
    } finally {
      child.kill();
    }
  });

  it('never writes to the real config folder of the user', async () => {
    const real = join(homedir(), '.config', 'project', 'logs', `${today()}.ndjson`);
    const sizeBefore = existsSync(real) ? statSync(real).size : undefined;
    await sandbox.cli(['list']);
    expect(existsSync(real) ? statSync(real).size : undefined).toBe(sizeBefore);
    expect(existsSync(join(sandbox.registryDir, 'logs', `${today()}.ndjson`))).toBe(true);
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for the log to show the expected line');
}

describe('end-to-end: labels', () => {
  let sandbox: Sandbox;

  beforeAll(() => {
    sandbox = makeSandbox();
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  const names = async (...selectors: string[]): Promise<string[]> => {
    const result = await sandbox.cli(['list', '--json', ...selectors.flatMap((s) => ['--label', s])]);
    expect(result.code, result.stderr).toBe(0);
    return (JSON.parse(result.stdout) as { name: string }[]).map((p) => p.name);
  };

  // The steps build on each other and run in order.
  it('registers projects with labels, and filters the list by key, key::value, bare value and AND', async () => {
    const shop = await sandbox.cli(['add', sandbox.dir('shop'), '--label', 'state::production', '--label', 'sandbox', '--json']);
    expect(JSON.parse(shop.stdout).labels).toEqual(['state::production', 'sandbox']);
    await sandbox.cli(['add', sandbox.dir('blog'), '--label', 'state::temp']);
    await sandbox.cli(['add', sandbox.dir('notes')]);
    expect(await names('state')).toEqual(['shop', 'blog']);
    expect(await names('state::production')).toEqual(['shop']);
    expect(await names('sandbox')).toEqual(['shop']);
    expect(await names('state', 'sandbox')).toEqual(['shop']);
    expect(await names('state::temp', 'sandbox')).toEqual([]);
  });

  it('adds and removes labels, and shows them', async () => {
    expect((await sandbox.cli(['label', 'add', 'blog', 'owner::alice', 'owner::bob'])).code).toBe(0);
    expect(await names('owner')).toEqual(['blog']);
    expect((await sandbox.cli(['show', 'blog'])).stdout).toContain('labels: state::temp, owner::alice, owner::bob');
    expect((await sandbox.cli(['label', 'remove', 'blog', 'owner::alice'])).code).toBe(0);
    expect(JSON.parse((await sandbox.cli(['show', 'blog', '--json'])).stdout).labels).toEqual(['state::temp', 'owner::bob']);
  });

  it('refuses an invalid label and the removal of an absent one, loudly', async () => {
    const invalid = await sandbox.cli(['label', 'add', 'blog', 'a::b::c']);
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain("label 'a::b::c' is invalid");
    const absent = await sandbox.cli(['label', 'remove', 'blog', 'sandbxo']);
    expect(absent.code).toBe(1);
    expect(absent.stderr).toContain("has no label 'sandbxo'");
  });

  it('keeps the labels of a removed project in deleted_projects.json', async () => {
    expect((await sandbox.cli(['remove', 'shop'])).code).toBe(0);
    const deleted = JSON.parse(readFileSync(join(sandbox.registryDir, 'deleted_projects.json'), 'utf8')) as { projects: { name: string; labels: string[] }[] };
    expect(deleted.projects.find((p) => p.name === 'shop')?.labels).toEqual(['state::production', 'sandbox']);
  });

  it('still loads and lists a registry.json written before labels existed', async () => {
    const file = join(sandbox.registryDir, 'registry.json');
    const registry = JSON.parse(readFileSync(file, 'utf8')) as { projects: Record<string, unknown>[] };
    registry.projects.forEach((project) => delete project['labels']);
    writeFileSync(file, JSON.stringify(registry));
    const listed = await sandbox.cli(['list', '--json']);
    expect(listed.code, listed.stderr).toBe(0);
    expect((JSON.parse(listed.stdout) as { labels: string[] }[]).every((p) => p.labels.length === 0)).toBe(true);
    expect((await sandbox.cli(['label', 'add', 'notes', 'back'])).code).toBe(0);
  });
});

describe('end-to-end: label wildcards in filters', () => {
  let sandbox: Sandbox;

  beforeAll(async () => {
    sandbox = makeSandbox();
    await sandbox.cli(['add', sandbox.dir('shop'), '--label', 'state::production', '--label', 'sandbox']);
    await sandbox.cli(['add', sandbox.dir('blog'), '--label', 'state::temp', '--label', 'env::sandbox']);
    await sandbox.cli(['add', sandbox.dir('notes')]);
  });
  afterAll(() => rmSync(sandbox.root, { recursive: true, force: true }));

  const names = async (...selectors: string[]): Promise<string[]> => {
    const result = await sandbox.cli(['list', '--json', ...selectors.flatMap((s) => ['--label', s])]);
    expect(result.code, result.stderr).toBe(0);
    return (JSON.parse(result.stdout) as { name: string }[]).map((p) => p.name);
  };

  it('filters with key::*, *::value and *::*, alone and combined', async () => {
    expect(await names('state::*')).toEqual(['shop', 'blog']);
    expect(await names('*::sandbox')).toEqual(['shop', 'blog']);
    expect(await names('*::*')).toEqual(['shop', 'blog']);
    expect(await names('*::sandbox', 'state::production')).toEqual(['shop']);
    expect(await names('*::sandbox', 'state::*', 'env::*')).toEqual(['blog']);
    expect(await names('sandbox::*')).toEqual([]);
  });

  it('keeps the bare selector as a shorthand', async () => {
    expect(await names('sandbox')).toEqual(['shop']);
    expect(await names('state')).toEqual(['shop', 'blog']);
  });

  it('refuses wildcards in stored labels, and a malformed selector', async () => {
    const stored = await sandbox.cli(['label', 'add', 'shop', 'state::*']);
    expect(stored.code).toBe(1);
    expect(stored.stderr).toContain('wildcards (*) are only allowed in filter selectors, not in labels');
    const selector = await sandbox.cli(['list', '--label', '**::x']);
    expect(selector.code).toBe(1);
    expect(selector.stderr).toContain("selector '**::x' is invalid");
  });
});
