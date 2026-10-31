import type { Project, Registry } from '@wadeck-app/project-sdk';
import { toNativePath } from '@wadeck-app/project-sdk';
import { describe, expect, it } from 'vitest';
import { detailOf, deletedRow, projectRow, treeRows } from './present.js';

const base = process.platform === 'win32' ? 'C:/work' : '/work';

function project(n: number, overrides: Partial<Project> = {}): Project {
  const id = n.toString(16).padStart(8, '0');
  return { id, name: `p${n}`, aliases: [], paths: [], labels: [], createdAt: '2026-10-30T00:00:00.000Z', ...overrides };
}

const registryOf = (...projects: Project[]): Registry => ({ schemaVersion: 1, projects });

describe('projectRow', () => {
  const root = project(1, { name: 'base', labels: ['shared'] });
  const shop = project(2, {
    name: 'shop',
    aliases: ['sh', 'store'],
    parent: root.id,
    labels: ['state::production', 'sandbox'],
    paths: [
      { path: `${base}/shop`, main: false },
      { path: `${base}/shop-main`, main: true },
    ],
  });
  const registry = registryOf(root, shop);

  it('has the id, the name, lists as data and the same as text for the table', () => {
    expect(projectRow(shop, registry)).toEqual({
      id: shop.id,
      name: 'shop',
      aliases: ['sh', 'store'],
      aliasesText: 'sh, store',
      parentId: root.id,
      parentName: 'base',
      labels: ['state::production', 'sandbox'],
      labelsText: 'state::production, sandbox',
      mainPath: `${base}/shop-main`,
      mainPathText: toNativePath(`${base}/shop-main`),
      virtual: false,
      virtualText: '',
      href: `/modules/project/p/${shop.id}`,
    });
  });

  it('marks a virtual project, and shows dashes for what is empty', () => {
    const row = projectRow(root, registry);
    expect(row).toMatchObject({ virtual: true, virtualText: 'virtual', mainPathText: '(virtual)', aliasesText: '-', parentName: '-', labelsText: 'shared' });
    expect(row).not.toHaveProperty('parentId');
    expect(row).not.toHaveProperty('mainPath');
  });

  it('reads a project of an old registry (no labels) as having none, and names a parent that is not in the registry', () => {
    const old = project(3, { parent: 'deadbeef' });
    delete (old as { labels?: string[] }).labels;
    expect(projectRow(old, registryOf(old))).toMatchObject({ labels: [], labelsText: '-', parentName: 'deadbeef (missing)' });
  });
});

describe('deletedRow', () => {
  it('is a row with the date of the deletion and a way to restore it', () => {
    const gone = { ...project(5, { name: 'gone', aliases: ['g'] }), deletedAt: '2026-10-30T10:00:00.000Z' };
    expect(deletedRow(gone, [gone])).toMatchObject({ id: gone.id, name: 'gone', aliasesText: 'g', deletedAt: '2026-10-30T10:00:00.000Z', hasDeletedParent: false });
  });

  it('says when the parent is deleted too, because the restore then needs the parent first', () => {
    const parent = { ...project(1, { name: 'base' }), deletedAt: '2026-10-30T10:00:00.000Z' };
    const kid = { ...project(2, { name: 'kid', parent: parent.id }), deletedAt: '2026-10-30T10:00:00.000Z' };
    expect(deletedRow(kid, [parent, kid])).toMatchObject({ parentName: 'base', hasDeletedParent: true });
  });
});

describe('treeRows', () => {
  it('walks the tree depth-first, parents before children, in registry order, with the depth and a drawn label', () => {
    const virtualRoot = project(1, { name: 'base' });
    const a = project(2, { name: 'a', parent: virtualRoot.id, paths: [{ path: `${base}/a`, main: true }] });
    const a1 = project(3, { name: 'a1', parent: a.id });
    const b = project(4, { name: 'b', parent: virtualRoot.id });
    const other = project(5, { name: 'other', paths: [{ path: `${base}/other`, main: true }] });
    const { rows, warnings } = treeRows(registryOf(b, a1, other, a, virtualRoot));
    expect(rows.map((r) => [r.name, r.depth, r.treeLabel])).toEqual([
      ['other', 0, 'other'],
      ['base', 0, 'base'],
      ['b', 1, '  |-- b'],
      ['a', 1, '  |-- a'],
      ['a1', 2, '      |-- a1'],
    ]);
    expect(rows.find((r) => r.name === 'base')).toMatchObject({ virtual: true, virtualText: 'virtual' });
    expect(rows.find((r) => r.name === 'other')).toMatchObject({ virtual: false, href: `/modules/project/p/${other.id}` });
    expect(warnings).toEqual([]);
  });

  it('survives a corrupted registry: a missing parent is shown as a root with a warning', () => {
    const orphan = project(1, { name: 'orphan', parent: 'deadbeef' });
    const { rows, warnings } = treeRows(registryOf(orphan));
    expect(rows.map((r) => [r.name, r.depth])).toEqual([['orphan', 0]]);
    expect(warnings).toEqual(["orphan (00000001) has the parent 'deadbeef', which is not in the registry: shown as a root"]);
  });

  it('survives a corrupted registry: a parent cycle never loops, each project is shown once, with a warning', () => {
    const x = project(1, { name: 'x' });
    const y = project(2, { name: 'y', parent: x.id });
    const z = project(3, { name: 'z', parent: y.id });
    x.parent = z.id;
    const { rows, warnings } = treeRows(registryOf(x, y, z));
    expect(rows.map((r) => r.name).sort()).toEqual(['x', 'y', 'z']);
    expect(rows).toHaveLength(3);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^parent cycle between .*x.*: shown from x/);
  });

  it('is empty for an empty registry', () => {
    expect(treeRows(registryOf())).toEqual({ rows: [], warnings: [] });
  });
});

describe('detailOf', () => {
  const registryDir = process.platform === 'win32' ? 'C:/cfg/project' : '/cfg/project';
  const grand = project(1, { name: 'grand' });
  const root = project(2, { name: 'base', parent: grand.id, labels: ['shared'] });
  const shop = project(3, {
    name: 'shop',
    aliases: ['sh'],
    parent: root.id,
    git: 'git@x:shop.git',
    labels: ['state::production'],
    paths: [
      { path: `${base}/shop`, main: true },
      { path: `${base}/shop-wt`, main: false },
    ],
  });
  const kid = project(4, { name: 'kid', parent: shop.id });
  const grandKid = project(5, { name: 'grandkid', parent: kid.id });
  const registry = registryOf(grand, root, shop, kid, grandKid);

  it('describes the project with its chain, children, descendants and paths', () => {
    const detail = detailOf(registryDir, registry, shop);
    expect(detail).toMatchObject({
      id: shop.id,
      name: 'shop',
      aliases: ['sh'],
      aliasesText: 'sh',
      labels: ['state::production'],
      labelsText: 'state::production',
      git: 'git@x:shop.git',
      gitText: 'git@x:shop.git',
      virtual: false,
      parentText: 'base',
      chainText: 'grand > base > shop',
      descendantsCount: 2,
      hasChildren: true,
      hasPaths: true,
      warnings: [],
      warningsText: '',
    });
    expect(detail.parent).toEqual({ id: root.id, name: 'base', href: `/modules/project/p/${root.id}` });
    expect(detail.chain.map((c) => c.name)).toEqual(['grand', 'base', 'shop']);
    expect(detail.children.map((c) => c.name)).toEqual(['kid']);
    expect(detail.descendants.map((c) => c.name)).toEqual(['kid', 'grandkid']);
    expect(detail.paths).toEqual([
      { path: `${base}/shop`, pathText: toNativePath(`${base}/shop`), main: true, mainText: 'main' },
      { path: `${base}/shop-wt`, pathText: toNativePath(`${base}/shop-wt`), main: false, mainText: '' },
    ]);
    expect(detail.aliasRows).toEqual([{ alias: 'sh' }]);
    expect(detail.labelRows).toEqual([{ label: 'state::production' }]);
  });

  it('gives the identity as labelled lines for the page (a badge shows a bare value without its meaning)', () => {
    const detail = detailOf(registryDir, registry, shop);
    expect(detail).toMatchObject({ idLine: 'ID: ' + shop.id, aliasesLine: 'Aliases: sh', labelsLine: 'Labels: state::production', gitLine: 'Git: git@x:shop.git' });
    expect(detailOf(registryDir, registry, grand)).toMatchObject({ aliasesLine: 'Aliases: none', labelsLine: 'Labels: none', gitLine: 'Git: none' });
  });

  it('says where the tool folders are, from the id', () => {
    const detail = detailOf(registryDir, registry, shop);
    expect(detail.folder).toBe(`${registryDir}/projects/${shop.id}`);
    expect(detail.folderText).toBe(toNativePath(`${registryDir}/projects/${shop.id}`));
    expect(detail.toolFoldersText).toBe(`${toNativePath(`${registryDir}/projects/${shop.id}`)} (one folder per tool, each with config, data, cache and logs)`);
  });

  it('shows a virtual project without paths, and "none" for what is empty', () => {
    const detail = detailOf(registryDir, registry, grand);
    expect(detail).toMatchObject({ virtual: true, virtualText: 'virtual', hasPaths: false, gitText: 'none', parentText: 'none', chainText: 'grand', aliasesText: 'none', labelsText: 'none' });
    expect(detail.paths).toEqual([]);
    expect(detail.parent).toBeNull();
  });

  it('survives a corrupted registry: a cycle or a dangling parent gives a chain of the project alone and a visible warning', () => {
    const lost = project(9, { name: 'lost', parent: 'deadbeef' });
    const detail = detailOf(registryDir, registryOf(lost), lost);
    expect(detail.chain.map((c) => c.name)).toEqual(['lost']);
    expect(detail.warnings).toHaveLength(1);
    expect(detail.warnings[0]).toContain("'deadbeef' which is not in the registry");
    expect(detail.warningsText).toBe(detail.warnings.join(' '));
    const x = project(10, { name: 'x' });
    const y = project(11, { name: 'y', parent: x.id });
    x.parent = y.id;
    expect(detailOf(registryDir, registryOf(x, y), x).warnings[0]).toContain('parent cycle');
    expect(detailOf(registryDir, registryOf(x, y), x).descendantsCount).toBe(1);
  });
});
