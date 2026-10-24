import { loadRegistry } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('project add', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('registers the cwd by default, named after its lowercased folder', async () => {
    const cwd = h.dir('Shop');
    const result = await h.cli(['add'], { cwd });
    const [project] = loadRegistry(h.registryDir).projects;
    expect(result.code).toBe(0);
    expect(project).toMatchObject({ name: 'shop', aliases: [], paths: [{ path: cwd, main: true }] });
    expect(result.out).toBe(`added shop (${project!.id})\n  path: ${cwd} (main)`);
  });

  it('first states the registry in use on stderr', async () => {
    const result = await h.cli(['add'], { cwd: h.dir('shop') });
    expect(result.err).toBe(`registry: ${h.registryDir}`);
  });

  it('resolves a relative path against the cwd and takes name, aliases, git and parent from the options', async () => {
    h.dir('shop');
    await h.cli(['add', '--virtual', '--name', 'base']);
    const result = await h.cli(['add', 'shop', '--name', 'store', '--alias', 'st', '--alias', 'sto', '--git', 'git@x:s.git', '--parent', 'base']);
    const registry = loadRegistry(h.registryDir);
    const base = registry.projects.find((p) => p.name === 'base')!;
    expect(result.code).toBe(0);
    expect(registry.projects.find((p) => p.name === 'store')).toMatchObject({
      aliases: ['st', 'sto'],
      git: 'git@x:s.git',
      parent: base.id,
      paths: [{ path: h.dir('shop'), main: true }],
    });
  });

  it('prints the project as JSON with --json', async () => {
    const result = await h.cli(['add', '--json'], { cwd: h.dir('shop') });
    expect(JSON.parse(result.out)).toEqual(loadRegistry(h.registryDir).projects[0]);
  });

  it('registers a virtual project without path', async () => {
    const result = await h.cli(['add', '--virtual', '--name', 'base']);
    expect(result.code).toBe(0);
    expect(loadRegistry(h.registryDir).projects[0]).toMatchObject({ name: 'base', paths: [] });
    expect(result.out).toContain('(virtual)');
  });

  it('asks for --name when the folder name is not a valid name, with the reason', async () => {
    const result = await h.cli(['add'], { cwd: h.dir('My Shop') });
    expect(result.code).toBe(2);
    expect(result.err).toContain("cannot derive a project name from the folder 'My Shop'");
    expect(result.err).toContain('must match');
    expect(result.err).toContain('pass an explicit name (--name <name>)');
    expect(loadRegistry(h.registryDir).projects).toEqual([]);
  });

  it('refuses --virtual without --name and --virtual with a path', async () => {
    const noName = await h.cli(['add', '--virtual']);
    expect(noName.code).toBe(2);
    expect(noName.err).toContain('--virtual needs --name');
    const withPath = await h.cli(['add', 'x', '--virtual', '--name', 'v']);
    expect(withPath.code).toBe(2);
    expect(withPath.err).toContain('--virtual registers a project without path');
  });

  it('exits 1 with the SDK message when the path already belongs to a project', async () => {
    const cwd = h.dir('shop');
    await h.cli(['add'], { cwd });
    const again = await h.cli(['add', '--name', 'other'], { cwd });
    expect(again.code).toBe(1);
    expect(again.err).toContain('error: ');
    expect(again.err).toContain('shop');
  });

  it('exits 1 when the folder does not exist', async () => {
    const result = await h.cli(['add', 'missing', '--name', 'm']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('does not exist');
  });

  it('rejects a --project option: it does not act on an existing project', async () => {
    const result = await h.cli(['add', '-p', 'x'], { cwd: h.dir('shop') });
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown option '-p' for 'project add'");
  });
});

describe('project add with a name taken from the folder', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('points at --name when the derived name is already used', async () => {
    await h.cli(['add'], { cwd: h.dir('shop') });
    const result = await h.cli(['add'], { cwd: h.dir('other/shop') });
    expect(result.code).toBe(2);
    expect(result.err).toContain("name 'shop' is already used by project shop");
    expect(result.err).toContain('the name comes from the folder: pass --name <name>');
  });

  it('keeps the SDK error as is when the name was given explicitly', async () => {
    await h.cli(['add'], { cwd: h.dir('shop') });
    const result = await h.cli(['add', '--name', 'shop'], { cwd: h.dir('other/shop') });
    expect(result.code).toBe(1);
    expect(result.err).not.toContain('the name comes from the folder');
  });
});
