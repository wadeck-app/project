import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeleted, loadRegistry } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('project restore / project list --deleted', () => {
  let h: Harness;

  beforeEach(async () => {
    h = makeHarness();
    await h.cli(['add', h.dir('shop'), '--alias', 'sh', '--label', 'state::production']);
  });
  afterEach(() => h.cleanup());

  const live = () => loadRegistry(h.registryDir).projects;
  const logLines = () =>
    readFileSync(join(h.registryDir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`), 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { msg: string }).msg);

  describe('restore', () => {
    it('brings a removed project back by name, alias or id, and logs the change', async () => {
      const id = live()[0]!.id;
      await h.cli(['remove', 'shop']);
      expect(live()).toEqual([]);
      const result = await h.cli(['restore', 'SH']);
      expect(result.code, result.err).toBe(0);
      expect(result.out).toBe(`restored shop (${id})`);
      expect(live().map((p) => p.id)).toEqual([id]);
      expect(live()[0]!.labels).toEqual(['state::production']);
      expect(logLines()).toContain(`mutation: restore project shop (${id})`);
      await h.cli(['remove', 'shop']);
      expect((await h.cli(['restore', id])).code).toBe(0);
    });

    it('prints the restored projects as JSON, labels included', async () => {
      await h.cli(['remove', 'shop']);
      const result = await h.cli(['restore', 'shop', '--json']);
      expect(JSON.parse(result.out)).toMatchObject([{ name: 'shop', labels: ['state::production'] }]);
      expect(JSON.parse(result.out)[0]).not.toHaveProperty('deletedAt');
    });

    it('with --recursive, brings back the project and its deleted descendants, one log line for the change', async () => {
      await h.cli(['add', '--virtual', '--name', 'base']);
      await h.cli(['parent', 'set', 'shop', 'base']);
      await h.cli(['remove', 'base', '--recursive']);
      const refused = await h.cli(['restore', 'shop']);
      expect(refused.code).toBe(1);
      expect(refused.err).toContain('restore the parent first');
      const result = await h.cli(['restore', 'base', '--recursive']);
      expect(result.code, result.err).toBe(0);
      expect(result.out.split('\n')).toEqual([expect.stringMatching(/^restored base \(/), expect.stringMatching(/^restored shop \(/)]);
      expect(logLines().find((m) => m.startsWith('mutation: restore project base'))).toMatch(/^mutation: restore project base \([0-9a-f]{8}\), shop \([0-9a-f]{8}\)$/);
    });

    it('fails with the colliding live project and the fix, changing nothing', async () => {
      await h.cli(['remove', 'shop']);
      await h.cli(['add', h.dir('other'), '--name', 'shop']);
      const result = await h.cli(['restore', 'sh']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("its name 'shop' is used by the live project shop");
      expect(result.err).toContain('rename or remove that project, then restore again');
      expect(loadDeleted(h.registryDir).projects).toHaveLength(1);
    });

    it('suggests close names of deleted projects when nothing matches', async () => {
      await h.cli(['remove', 'shop']);
      const result = await h.cli(['restore', 'shpo']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("no deleted project matches 'shpo'");
      expect(result.err).toContain('did you mean');
    });

    it('needs an explicit reference, like remove', async () => {
      const result = await h.cli(['restore']);
      expect(result.code).toBe(2);
      expect(result.err).toContain('expected <ref>, got none');
    });

    it('is described in the help, with --recursive', async () => {
      const help = (await h.cli(['restore', '--help'])).out;
      expect(help).toContain('Usage: project restore <ref> [options]');
      expect(help).toContain('--recursive');
      expect((await h.cli(['--help'])).out).toContain('project restore <ref>');
    });
  });

  describe('list --deleted', () => {
    it('says when nothing is deleted', async () => {
      const result = await h.cli(['list', '--deleted']);
      expect(result.out).toBe('no deleted project');
    });

    it('lists the deleted projects with the date of their deletion, not the live ones', async () => {
      await h.cli(['add', h.dir('blog')]);
      await h.cli(['remove', 'shop']);
      const result = await h.cli(['list', '--deleted']);
      const rows = result.out.split('\n');
      expect(rows[0]).toMatch(/^ID\s+NAME\s+ALIASES\s+PARENT\s+LABELS\s+MAIN PATH\s+DELETED$/);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatch(/shop\s+sh\s+-\s+state::production\s+.*\s\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
      expect(result.out).not.toContain('blog');
    });

    it('prints them as JSON, with deletedAt and labels, and honors --label', async () => {
      await h.cli(['remove', 'shop']);
      await h.cli(['add', h.dir('blog'), '--label', 'sandbox']);
      await h.cli(['remove', 'blog']);
      const all = JSON.parse((await h.cli(['list', '--deleted', '--json'])).out) as { name: string; deletedAt: string; labels: string[] }[];
      expect(all.map((p) => p.name).sort()).toEqual(['blog', 'shop']);
      expect(all.every((p) => typeof p.deletedAt === 'string' && Array.isArray(p.labels))).toBe(true);
      const filtered = JSON.parse((await h.cli(['list', '--deleted', '--json', '--label', 'sandbox'])).out) as { name: string }[];
      expect(filtered.map((p) => p.name)).toEqual(['blog']);
    });

    it('after a restore the project is listed as live again and no longer as deleted', async () => {
      await h.cli(['remove', 'shop']);
      await h.cli(['restore', 'shop']);
      expect((await h.cli(['list', '--deleted'])).out).toBe('no deleted project');
      expect((await h.cli(['list'])).out).toContain('shop');
    });
  });
});
