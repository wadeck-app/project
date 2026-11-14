import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidSlugError,
  ProjectDirAmbiguousError,
  ProjectFolderInUseError,
  ProjectNotFoundError,
  RegistryCorruptError,
  RegistryInvalidError,
  SlugRenameFailedError,
} from './errors.js';
import { addProject } from './projectMutations.js';
import { renameSlug } from './projectSlug.js';
import { loadRegistry, registryFilePath } from './registryIo.js';
import { removeProject } from './removal.js';
import { restoreProject } from './restore.js';
import { slugify, validateSlug } from './slug.js';
import { type Workspace, makeProject, makeRegistry, makeWorkspace } from './testHelpers.js';
import { getConfigLayers, projectDir, projectToolDir } from './toolDirs.js';
import { validateRegistry } from './validate.js';

describe('slugify', () => {
  it.each([
    ['Shop', 'shop'],
    ['Café Crème', 'cafe-creme'],
    ['  My  Shop_Front!! ', 'my-shop-front'],
    ['a/b\\c:d', 'a-b-c-d'],
    ['--x--', 'x'],
    ['Zoë & Ñandú', 'zoe-nandu'],
    ['v2.0', 'v2-0'],
    ['', ''],
    ['!!!', ''],
    ['日本語', ''],
  ])('%j -> %j', (name, slug) => {
    expect(slugify(name)).toBe(slug);
  });

  it('cuts to 20 characters then trims a trailing dash', () => {
    expect(slugify('abcdefghij-klmnopqrst-uvwxyz')).toBe('abcdefghij-klmnopqrs');
    expect(slugify('abcdefghijklmnopqrstuvwxyz')).toBe('abcdefghijklmnopqrst');
    // the 20 first characters end with a dash: 19 characters + '-'
    expect(slugify('abcdefghijklmnopqrs tuv')).toBe('abcdefghijklmnopqrs');
    expect(slugify('abcdefghijklmnopqrs tuv')).toHaveLength(19);
  });

  it('always yields a valid slug or an empty string', () => {
    for (const name of ['Shop front 2', 'é-é-é', 'x'.repeat(50), '9 lives', 'A.B.C']) {
      expect(() => validateSlug(slugify(name))).not.toThrow();
    }
  });
});

describe('validateSlug', () => {
  it.each(['a', 'shop', 'shop-front', 'a1-b2', '9', 'x'.repeat(20)])('accepts %j', (slug) => {
    expect(() => validateSlug(slug)).not.toThrow();
  });

  it.each(['', 'Shop', '-a', 'a-', 'a--b', 'a_b', 'a b', 'é', 'x'.repeat(21), '../x', 'a/b'])('refuses %j with the rule and an example', (slug) => {
    expect(() => validateSlug(slug)).toThrow(InvalidSlugError);
    expect(() => validateSlug(slug)).toThrow(/kebab-case.*1 to 20.*\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$.*shop-front/s);
  });
});

describe('registry validation of slug', () => {
  it('accepts a project with a valid slug and a project without slug (older registry)', () => {
    expect(() => validateRegistry(makeRegistry(makeProject(1, { slug: 'shop' }), makeProject(2)))).not.toThrow();
  });

  it('refuses an invalid slug naming the project and the fix', () => {
    const registry = makeRegistry(makeProject(1, { slug: 'Bad Slug' }));
    expect(() => validateRegistry(registry)).toThrow(RegistryInvalidError);
    expect(() => validateRegistry(registry)).toThrow(/p1.*not a valid slug.*project slug/s);
  });

  it('refuses a registry file whose slug is not a string', () => {
    const ws = makeWorkspace();
    try {
      mkdirSync(ws.registryDir, { recursive: true });
      writeFileSync(registryFilePath(ws.registryDir), JSON.stringify({ schemaVersion: 1, projects: [{ ...makeProject(1), slug: 3 }] }));
      expect(() => loadRegistry(ws.registryDir)).toThrow(RegistryCorruptError);
      expect(() => loadRegistry(ws.registryDir)).toThrow(/slug/);
    } finally {
      ws.cleanup();
    }
  });
});

describe('slug storage and folder resolution', () => {
  let ws: Workspace;
  const projectsDir = (): string => join(ws.registryDir, 'projects');

  beforeEach(() => {
    ws = makeWorkspace();
  });

  afterEach(() => {
    ws.cleanup();
  });

  it('addProject stores slugify(name), accepts an explicit valid slug and refuses an invalid one', async () => {
    const shop = await addProject(ws.registryDir, { name: 'shop.front' });
    const explicit = await addProject(ws.registryDir, { name: 'other', slug: 'oth' });
    expect(shop.slug).toBe('shop-front');
    expect(explicit.slug).toBe('oth');
    await expect(addProject(ws.registryDir, { name: 'third', slug: 'Bad Slug' })).rejects.toThrow(InvalidSlugError);
    expect(loadRegistry(ws.registryDir).projects.map((p) => p.slug)).toEqual(['shop-front', 'oth']);
  });

  it('restoring from the trash keeps the slug', async () => {
    const project = await addProject(ws.registryDir, { name: 'shop', slug: 'sh' });
    await removeProject(ws.registryDir, 'shop');
    expect(loadRegistry(ws.registryDir).projects).toEqual([]);
    const [restored] = await restoreProject(ws.registryDir, project.id);
    expect(restored?.slug).toBe('sh');
    expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('sh');
  });

  it('with no folder yet: <id>-<slug> of the registry, slugify(name) when the project has no slug, <id> when the slug is empty or the id unknown', () => {
    mkdirSync(ws.registryDir, { recursive: true });
    const registry = makeRegistry(makeProject(1, { name: 'shop front', slug: 'sf' }), makeProject(2, { name: 'café' }), makeProject(3, { name: '日本語' }));
    writeFileSync(registryFilePath(ws.registryDir), JSON.stringify(registry));
    expect(projectDir(ws.registryDir, '00000001')).toBe(join(projectsDir(), '00000001-sf'));
    expect(projectDir(ws.registryDir, '00000002')).toBe(join(projectsDir(), '00000002-cafe'));
    expect(projectDir(ws.registryDir, '00000003')).toBe(join(projectsDir(), '00000003'));
    expect(projectDir(ws.registryDir, '000000ff')).toBe(join(projectsDir(), '000000ff'));
    expect(existsSync(projectsDir())).toBe(false);
  });

  it('with no registry at all: <id> (no name known)', () => {
    expect(projectDir(ws.registryDir, '00000001')).toBe(join(projectsDir(), '00000001'));
  });

  it('a legacy <id> folder keeps working, whatever the slug of the registry', () => {
    mkdirSync(join(projectsDir(), '00000001'), { recursive: true });
    writeFileSync(registryFilePath(ws.registryDir), JSON.stringify(makeRegistry(makeProject(1, { slug: 'sf' }))));
    expect(projectDir(ws.registryDir, '00000001')).toBe(join(projectsDir(), '00000001'));
  });

  it('an existing named folder wins over the registry slug', () => {
    mkdirSync(join(projectsDir(), '00000001-old'), { recursive: true });
    mkdirSync(join(projectsDir(), '00000002-x'), { recursive: true });
    expect(projectDir(ws.registryDir, '00000001')).toBe(join(projectsDir(), '00000001-old'));
    expect(projectToolDir(ws.registryDir, '00000001', 'task', 'data')).toBe(join(projectsDir(), '00000001-old', 'task', 'data'));
  });

  it('two entries for one id throw, naming both folders and the fix', () => {
    mkdirSync(join(projectsDir(), '00000001'), { recursive: true });
    mkdirSync(join(projectsDir(), '00000001-shop'), { recursive: true });
    let caught: unknown;
    try {
      projectDir(ws.registryDir, '00000001');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProjectDirAmbiguousError);
    const error = caught as ProjectDirAmbiguousError;
    expect(error.message).toContain(join(projectsDir(), '00000001'));
    expect(error.message).toContain(join(projectsDir(), '00000001-shop'));
    expect(error.message).toMatch(/two folders hold the data of project 00000001: .*merge them by hand, keep one/);
    expect(error.folders).toHaveLength(2);
    expect(() => projectToolDir(ws.registryDir, '00000001', 'task', 'config')).toThrow(ProjectDirAmbiguousError);
  });

  it('a link named <id> next to the named folder counts as a second entry', () => {
    const named = join(projectsDir(), '00000001-shop');
    mkdirSync(named, { recursive: true });
    // 'junction' needs no privilege on Windows and is a plain symlink elsewhere; a failure to create it is a failure of the test, never a skip
    symlinkSync(named, join(projectsDir(), '00000001'), 'junction');
    expect(() => projectDir(ws.registryDir, '00000001')).toThrow(ProjectDirAmbiguousError);
  });

  it('another id that shares leading characters is never matched', () => {
    mkdirSync(join(projectsDir(), '00000010-x'), { recursive: true });
    expect(projectDir(ws.registryDir, '00000001')).toBe(join(projectsDir(), '00000001'));
  });

  it('getConfigLayers resolves each project folder on disk', () => {
    const root = makeProject(1, { slug: 'root' });
    const leaf = makeProject(2, { parent: root.id });
    mkdirSync(join(projectsDir(), '00000001'), { recursive: true });
    const layers = getConfigLayers(makeRegistry(root, leaf), ws.registryDir, leaf, 'task');
    expect(layers.map((l) => l.dir)).toEqual([join(projectsDir(), '00000001', 'task', 'config'), join(projectsDir(), '00000002-p2', 'task', 'config')]);
  });

  describe('renameSlug', () => {
    async function setup(name = 'shop'): Promise<{ id: string; dir: string }> {
      const project = await addProject(ws.registryDir, { name });
      const dir = join(projectsDir(), `${project.id}-${project.slug}`);
      mkdirSync(join(dir, 'task', 'data'), { recursive: true });
      writeFileSync(join(dir, 'task', 'data', 'f.txt'), 'payload');
      return { id: project.id, dir };
    }

    it('moves the folder with its data and updates the registry', async () => {
      const { id, dir } = await setup();
      const result = await renameSlug(ws.registryDir, 'shop', 'storefront');
      const to = join(projectsDir(), `${id}-storefront`);
      expect(result).toMatchObject({ from: dir, to, moved: true, unchanged: false });
      expect(result.project.slug).toBe('storefront');
      expect(readFileSync(join(to, 'task', 'data', 'f.txt'), 'utf8')).toBe('payload');
      expect(existsSync(dir)).toBe(false);
      expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('storefront');
      expect(projectDir(ws.registryDir, id)).toBe(to);
    });

    it('migrates a legacy <id> folder (even with the same slug)', async () => {
      const { id, dir } = await setup();
      const legacy = join(projectsDir(), id);
      renameSync(dir, legacy);
      const result = await renameSlug(ws.registryDir, id, 'shop');
      expect(result).toMatchObject({ from: legacy, to: dir, moved: true, unchanged: false });
      expect(readdirSync(projectsDir())).toEqual([`${id}-shop`]);
    });

    it('is a no-op with the same slug and the folder already named so', async () => {
      const { dir } = await setup();
      const before = readFileSync(registryFilePath(ws.registryDir), 'utf8');
      const result = await renameSlug(ws.registryDir, 'shop', 'shop');
      expect(result).toMatchObject({ from: dir, to: dir, moved: false, unchanged: true });
      expect(readFileSync(registryFilePath(ws.registryDir), 'utf8')).toBe(before);
    });

    it('only updates the registry when the folder does not exist', async () => {
      const project = await addProject(ws.registryDir, { name: 'shop' });
      const result = await renameSlug(ws.registryDir, 'shop', 'other');
      expect(result).toMatchObject({ moved: false, unchanged: false, to: join(projectsDir(), `${project.id}-other`) });
      expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('other');
      expect(existsSync(projectsDir())).toBe(false);
    });

    it('refuses an invalid slug and an unknown project, changing nothing', async () => {
      const { dir } = await setup();
      await expect(renameSlug(ws.registryDir, 'shop', 'Bad Slug')).rejects.toThrow(InvalidSlugError);
      await expect(renameSlug(ws.registryDir, 'nope', 'ok')).rejects.toThrow(ProjectNotFoundError);
      expect(existsSync(dir)).toBe(true);
    });

    it('refuses a project of the trash and leaves its folder alone', async () => {
      const { id, dir } = await setup();
      await removeProject(ws.registryDir, 'shop');
      await expect(renameSlug(ws.registryDir, id, 'other')).rejects.toThrow(ProjectNotFoundError);
      expect(existsSync(dir)).toBe(true);
    });

    it('fails loudly, changing nothing, when the folder of the new slug already exists next to the current one', async () => {
      const { id, dir } = await setup();
      mkdirSync(join(projectsDir(), `${id}-new`), { recursive: true });
      await expect(renameSlug(ws.registryDir, 'shop', 'new')).rejects.toThrow(ProjectDirAmbiguousError);
      expect(existsSync(dir)).toBe(true);
      expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('shop');
    });

    it('says nothing was changed, the folder is in use and which tools may hold it when the OS refuses the move', async () => {
      const { dir } = await setup();
      for (const code of ['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY']) {
        const refuse = (): void => {
          throw Object.assign(new Error(`${code}: operation not permitted, rename`), { code });
        };
        const error = await renameSlug(ws.registryDir, 'shop', 'other', { rename: refuse }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ProjectFolderInUseError);
        expect((error as Error).message).toMatch(/nothing was changed.*in use.*task, queue or flow.*stop them/s);
        expect((error as ProjectFolderInUseError).osCode).toBe(code);
      }
      expect(existsSync(dir)).toBe(true);
      expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('shop');
    });

    it('lets an unexpected move error through untouched', async () => {
      await setup();
      const boom = new Error('disk on fire');
      await expect(
        renameSlug(ws.registryDir, 'shop', 'other', {
          rename: () => {
            throw boom;
          },
        }),
      ).rejects.toBe(boom);
      expect(loadRegistry(ws.registryDir).projects[0]?.slug).toBe('shop');
    });

    it('moves the folder back and reports both facts when registry.json cannot be written', async () => {
      const { id, dir } = await setup();
      const to = join(projectsDir(), `${id}-other`);
      // after the real move, registry.json is replaced by a folder: the atomic rename onto it fails
      const sabotage = (from: string, target: string): void => {
        renameSync(from, target);
        rmSync(registryFilePath(ws.registryDir));
        mkdirSync(registryFilePath(ws.registryDir));
      };
      const error = await renameSlug(ws.registryDir, 'shop', 'other', { rename: sabotage }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SlugRenameFailedError);
      expect((error as SlugRenameFailedError).restored).toBe(true);
      expect((error as Error).message).toMatch(/could not be written.*moved back to/s);
      expect(existsSync(dir)).toBe(true);
      expect(existsSync(to)).toBe(false);
      expect(readFileSync(join(dir, 'task', 'data', 'f.txt'), 'utf8')).toBe('payload');
    });

    it('says where the data is when the move back fails too', async () => {
      const { id, dir } = await setup();
      const to = join(projectsDir(), `${id}-other`);
      const sabotage = (from: string, target: string): void => {
        renameSync(from, target);
        rmSync(registryFilePath(ws.registryDir));
        mkdirSync(registryFilePath(ws.registryDir));
        // the old place is taken by a non-empty folder, so the move back is refused
        mkdirSync(join(dir, 'blocker'), { recursive: true });
        writeFileSync(join(dir, 'blocker', 'x'), 'x');
      };
      const error = await renameSlug(ws.registryDir, 'shop', 'other', { rename: sabotage }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SlugRenameFailedError);
      expect((error as SlugRenameFailedError).restored).toBe(false);
      expect((error as Error).message).toContain(to);
      expect((error as Error).message).toMatch(/move it back by hand/);
    });
  });
});
