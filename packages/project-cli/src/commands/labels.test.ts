import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadDeleted, loadRegistry, registryFilePath } from '@wadeck-app/project-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('project labels', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  const labelsOf = (name: string) => loadRegistry(h.registryDir).projects.find((p) => p.name === name)?.labels;
  const logLines = () =>
    readFileSync(join(h.registryDir, 'logs', `${new Date().toISOString().slice(0, 10)}.ndjson`), 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => (JSON.parse(l) as { msg: string }).msg);

  describe('add --label', () => {
    it('registers the project with its labels, shown in the output and in --json', async () => {
      const result = await h.cli(['add', h.dir('shop'), '--label', 'State::Production', '--label', 'sandbox', '--json']);
      expect(result.code, result.err).toBe(0);
      expect(JSON.parse(result.out).labels).toEqual(['state::production', 'sandbox']);
      expect(labelsOf('shop')).toEqual(['state::production', 'sandbox']);
    });

    it('prints the labels in the human output', async () => {
      const result = await h.cli(['add', h.dir('shop'), '--label', 'sandbox']);
      expect(result.out).toContain('  labels: sandbox');
    });

    it('refuses an invalid label with the rule, registering nothing', async () => {
      const result = await h.cli(['add', h.dir('shop'), '--label', 'a::b::c']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("label 'a::b::c' is invalid");
      expect(result.err).toContain('^[a-z0-9][a-z0-9._-]*$');
      expect(loadRegistry(h.registryDir).projects).toEqual([]);
    });
  });

  describe('label add / label remove', () => {
    beforeEach(async () => {
      await h.cli(['add', h.dir('shop'), '--alias', 'sh']);
    });

    it('adds labels, in a set, and logs the change', async () => {
      const result = await h.cli(['label', 'add', 'sh', 'state::temp', 'sandbox', 'sandbox']);
      expect(result.code, result.err).toBe(0);
      expect(result.out.split('\n')[0]).toMatch(/^added 2 labels to shop \([0-9a-f]{8}\): state::temp, sandbox$/);
      expect(labelsOf('shop')).toEqual(['state::temp', 'sandbox']);
      expect(logLines().find((m) => m.startsWith('mutation: label add'))).toMatch(/^mutation: label add shop \([0-9a-f]{8}\) \+state::temp \+sandbox$/);
    });

    it('says when nothing was new', async () => {
      await h.cli(['label', 'add', 'shop', 'sandbox']);
      const result = await h.cli(['label', 'add', 'shop', 'sandbox']);
      expect(result.out.split('\n')[0]).toMatch(/^shop \([0-9a-f]{8}\) already has sandbox$/);
    });

    it('removes labels, and logs the change', async () => {
      await h.cli(['label', 'add', 'shop', 'a', 'k::v']);
      const result = await h.cli(['label', 'remove', 'shop', 'a']);
      expect(result.code, result.err).toBe(0);
      expect(result.out.split('\n')[0]).toMatch(/^removed 1 label from shop \([0-9a-f]{8}\): a$/);
      expect(labelsOf('shop')).toEqual(['k::v']);
      expect(logLines().find((m) => m.startsWith('mutation: label remove'))).toMatch(/^mutation: label remove shop \([0-9a-f]{8}\) -a$/);
    });

    it('fails loudly, naming the label, when removing one the project does not have', async () => {
      await h.cli(['label', 'add', 'shop', 'a']);
      const result = await h.cli(['label', 'remove', 'shop', 'sandbxo']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("has no label 'sandbxo' (its labels: a)");
      expect(labelsOf('shop')).toEqual(['a']);
    });

    it('fails with the rule on an invalid label', async () => {
      const result = await h.cli(['label', 'add', 'shop', 'bad label']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("label 'bad label' is invalid");
    });

    it('needs a project and at least one label', async () => {
      const noLabel = await h.cli(['label', 'add', 'shop']);
      expect(noLabel.code).toBe(2);
      expect(noLabel.err).toContain('expected <ref> <label>...');
      expect((await h.cli(['label', 'add'])).code).toBe(2);
    });

    it('prints the project as JSON', async () => {
      const result = await h.cli(['label', 'add', 'shop', 'x', '--json']);
      expect(JSON.parse(result.out)).toMatchObject({ name: 'shop', labels: ['x'] });
    });

    it('is described in the help', async () => {
      expect((await h.cli(['label', '--help'])).out).toContain('project label remove');
      expect((await h.cli(['label', 'add', '--help'])).out).toContain('Usage: project label add <ref> <label>...');
    });
  });

  describe('list --label', () => {
    beforeEach(async () => {
      await h.cli(['add', h.dir('a'), '--label', 'state::production', '--label', 'sandbox']);
      await h.cli(['add', h.dir('b'), '--label', 'state::temp']);
      await h.cli(['add', h.dir('c')]);
    });

    const names = async (...selectors: string[]) => {
      const result = await h.cli(['list', '--json', ...selectors.flatMap((s) => ['--label', s])]);
      expect(result.code, result.err).toBe(0);
      return (JSON.parse(result.out) as { name: string }[]).map((p) => p.name);
    };

    it('filters by key, key::value and bare value', async () => {
      expect(await names('state')).toEqual(['a', 'b']);
      expect(await names('state::production')).toEqual(['a']);
      expect(await names('sandbox')).toEqual(['a']);
      expect(await names('state::nothing')).toEqual([]);
    });

    it('combines several selectors with AND', async () => {
      expect(await names('state', 'sandbox')).toEqual(['a']);
      expect(await names('state::temp', 'sandbox')).toEqual([]);
    });

    it('fails on an invalid selector', async () => {
      const result = await h.cli(['list', '--label', 'a::b::c']);
      expect(result.code).toBe(1);
      expect(result.err).toContain("label 'a::b::c' is invalid");
    });

    it('says when no project matches, rather than printing an empty table', async () => {
      const result = await h.cli(['list', '--label', 'nothing']);
      expect(result.out).toBe('no project has all the labels: nothing');
    });

    it('shows a LABELS column', async () => {
      const lines = (await h.cli(['list'])).out.split('\n');
      expect(lines[0]).toMatch(/^ID\s+NAME\s+ALIASES\s+PARENT\s+LABELS\s+MAIN PATH$/);
      expect(lines.find((l) => /\sa\s/.test(l))).toMatch(/\sstate::production,sandbox\s/);
      expect(lines.find((l) => /\sc\s/.test(l))).toMatch(/\s-\s+-\s+-\s+\S/);
    });
  });

  describe('show and resolve', () => {
    it('show has a labels line and labels in --json; resolve prints them', async () => {
      const shop = h.dir('shop');
      await h.cli(['add', shop, '--label', 'state::production', '--label', 'sandbox']);
      expect((await h.cli(['show', 'shop'])).out).toContain('  labels: state::production, sandbox');
      expect(JSON.parse((await h.cli(['show', 'shop', '--json'])).out).labels).toEqual(['state::production', 'sandbox']);
      const resolved = await h.cli(['resolve'], { cwd: shop });
      expect(resolved.out).toContain('labels: state::production, sandbox');
      expect(JSON.parse((await h.cli(['resolve', '--json'], { cwd: shop })).out).labels).toEqual(['state::production', 'sandbox']);
    });

    it('a project without labels shows none', async () => {
      await h.cli(['add', h.dir('plain')]);
      expect((await h.cli(['show', 'plain'])).out).toContain('  labels: none');
      expect((await h.cli(['resolve', '-p', 'plain'])).out).toContain('labels: none');
    });
  });

  describe('old registries', () => {
    it('lists, shows and resolves a registry.json without labels, with empty labels in --json', async () => {
      await h.cli(['add', h.dir('old')]);
      const raw = JSON.parse(readFileSync(registryFilePath(h.registryDir), 'utf8')) as { projects: Record<string, unknown>[] };
      delete raw.projects[0]!['labels'];
      writeFileSync(registryFilePath(h.registryDir), JSON.stringify(raw));
      expect((await h.cli(['list'])).code).toBe(0);
      expect(JSON.parse((await h.cli(['list', '--json'])).out)[0].labels).toEqual([]);
      expect(JSON.parse((await h.cli(['show', 'old', '--json'])).out).labels).toEqual([]);
      expect(JSON.parse((await h.cli(['resolve', '-p', 'old', '--json'])).out).labels).toEqual([]);
      expect((await h.cli(['list', '--label', 'x', '--json'])).out).toBe('[]');
    });
  });

  it('keeps the labels of a removed project in deleted_projects.json', async () => {
    await h.cli(['add', h.dir('shop'), '--label', 'state::production']);
    await h.cli(['remove', 'shop']);
    expect(loadDeleted(h.registryDir).projects[0]!.labels).toEqual(['state::production']);
  });
});
