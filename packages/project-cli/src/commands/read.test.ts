import { loadRegistry } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('read commands', () => {
  let h: Harness;
  let shop: string;
  let wt: string;

  beforeEach(async () => {
    h = makeHarness();
    shop = h.dir('shop');
    wt = h.dir('shop-wt');
    const setup = [
      ['add', '--virtual', '--name', 'base'],
      ['add', shop, '--alias', 'sh', '--parent', 'base', '--git', 'git@x:shop.git'],
      ['paths', 'add', 'shop', wt],
    ];
    for (const argv of setup) {
      const result = await h.cli(argv);
      expect(result.err, argv.join(' ')).not.toContain('error:');
    }
  });
  afterEach(() => h.cleanup());

  function idOf(name: string): string {
    return loadRegistry(h.registryDir).projects.find((p) => p.name === name)!.id;
  }

  describe('list', () => {
    it('tells how to register a project when there is none', async () => {
      const empty = makeHarness();
      const result = await empty.cli(['list']);
      empty.cleanup();
      expect(result).toMatchObject({ code: 0, out: 'no project registered; register a folder with: project add [path]' });
    });

    it('lists id, name, aliases, parent and main path, virtual projects included', async () => {
      const result = await h.cli(['list']);
      const lines = result.out.split('\n');
      expect(lines[0]).toMatch(/^ID\s+NAME\s+ALIASES\s+PARENT\s+MAIN PATH$/);
      expect(lines.find((l) => l.includes(idOf('shop')))).toMatch(new RegExp(`${idOf('shop')}\\s+shop\\s+sh\\s+base\\s+${shop}$`));
      expect(lines.find((l) => l.includes(idOf('base')))).toMatch(/base\s+-\s+-\s+\(virtual\)$/);
    });

    it('prints the projects as a JSON array', async () => {
      const result = await h.cli(['list', '--json']);
      expect(JSON.parse(result.out)).toEqual(loadRegistry(h.registryDir).projects);
      expect(result.err).toBe(`registry: ${h.registryDir}`);
    });
  });

  describe('show', () => {
    it('prints id, aliases, parent chain, paths with the main one marked, git and the folder', async () => {
      const result = await h.cli(['show', 'sh']);
      expect(result.code).toBe(0);
      expect(result.out.split('\n')).toEqual([
        `shop (${idOf('shop')})`,
        '  aliases: sh',
        `  parent chain: base > shop`,
        '  paths:',
        `    ${shop} (main)`,
        `    ${wt}`,
        '  git: git@x:shop.git',
        `  folder: ${h.registryDir.replace(/\\/g, '/')}/projects/${idOf('shop')}`,
      ]);
    });

    it('states how the project was found on stderr, first', async () => {
      const result = await h.cli(['show', 'sh']);
      expect(result.err).toBe(`project: shop (${idOf('shop')}) via <ref> argument, path ${shop} (main); registry: ${h.registryDir}`);
    });

    it('shows a virtual project without alias, parent or git', async () => {
      const result = await h.cli(['show', 'base']);
      expect(result.out).toContain('  aliases: none');
      expect(result.out).toContain('  parent chain: none');
      expect(result.out).toContain('    none (virtual)');
      expect(result.out).toContain('  git: none');
    });

    it('uses the project of the cwd when no ref is given', async () => {
      const result = await h.cli(['show'], { cwd: wt });
      expect(result.out).toContain(`shop (${idOf('shop')})`);
      expect(result.err).toContain('via cwd');
    });

    it('prints the project, its chain and its folder as JSON', async () => {
      const json = JSON.parse((await h.cli(['show', 'shop', '--json'])).out);
      expect(json).toMatchObject({ id: idOf('shop'), name: 'shop', aliases: ['sh'], chain: [{ name: 'base' }, { name: 'shop' }] });
      expect(json.folder).toBe(`${h.registryDir.replace(/\\/g, '/')}/projects/${idOf('shop')}`);
    });
  });

  describe('path', () => {
    it('prints the folder of the project in the registry', async () => {
      const result = await h.cli(['path', 'shop']);
      expect(result.out).toBe(`${h.registryDir.replace(/\\/g, '/')}/projects/${idOf('shop')}`);
    });

    it('prints it as JSON', async () => {
      const result = await h.cli(['path', 'shop', '--json']);
      expect(JSON.parse(result.out)).toEqual({ path: `${h.registryDir.replace(/\\/g, '/')}/projects/${idOf('shop')}` });
    });
  });

  describe('resolve', () => {
    it('reports the cwd and the registered path that contains it', async () => {
      const sub = h.dir('shop/src/deep');
      const result = await h.cli(['resolve'], { cwd: sub });
      expect(result.out.split('\n')).toEqual([`project: shop (${idOf('shop')})`, 'source: cwd', `path: ${shop} (cwd)`, `registry: ${h.registryDir}`]);
    });

    it('uses the second path when the cwd is inside it', async () => {
      const result = await h.cli(['resolve', '--json'], { cwd: wt });
      expect(JSON.parse(result.out)).toMatchObject({ name: 'shop', source: 'cwd', path: wt, pathVia: 'cwd' });
    });

    it('reports --project with the main path when run from an unrelated folder', async () => {
      const result = await h.cli(['-p', 'sh', 'resolve', '--json'], { cwd: h.dir('elsewhere') });
      expect(JSON.parse(result.out)).toMatchObject({ name: 'shop', source: 'flag', via: '--project', path: shop, pathVia: 'main' });
    });

    it('accepts --project after the command and prefers it to the environment variable', async () => {
      const result = await h.cli(['resolve', '--project', 'base', '--json'], { cwd: wt, env: { PROJECT_PROJECT: 'shop' } });
      expect(JSON.parse(result.out)).toMatchObject({ name: 'base', source: 'flag' });
    });

    it('reports the environment variable by name', async () => {
      const result = await h.cli(['resolve', '--json'], { cwd: h.dir('elsewhere'), env: { PROJECT_PROJECT: 'sh' } });
      expect(JSON.parse(result.out)).toMatchObject({ name: 'shop', source: 'env', via: 'PROJECT_PROJECT' });
    });

    it('reports a virtual project without path', async () => {
      const result = await h.cli(['resolve', '-p', 'base']);
      expect(result.out).toContain('path: none (virtual project)');
    });

    it('exits 1 with the registered projects and the add command when nothing resolves', async () => {
      const elsewhere = h.dir('elsewhere');
      const result = await h.cli(['resolve'], { cwd: elsewhere });
      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain(`error: no project in scope for ${elsewhere}`);
      expect(result.err).toContain('Registered: base, shop');
      expect(result.err).toContain(`
hint: pass a project reference, or register this folder with: project add "${elsewhere}"`);
    });

    it('fails on a typo with a suggestion and never selects it', async () => {
      const result = await h.cli(['resolve', '-p', 'shpo'], { cwd: shop });
      expect(result.code).toBe(1);
      expect(result.err).toContain("no project matches 'shpo'");
      expect(result.err).toContain('did you mean');
      expect(result.out).toBe('');
      expect(result.err).not.toContain('project: shop');
    });

    it('refuses a <ref> argument together with --project', async () => {
      const result = await h.cli(['show', 'base', '-p', 'shop']);
      expect(result.code).toBe(2);
      expect(result.err).toContain('pass only one');
    });
  });
});
