import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { makeModule } from './testKit.js';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');
const viewsDir = join(packageDir, 'src/dsl-views');

interface Point {
  kind: string;
  slot: string;
  path?: string;
  label?: string;
  view: { type: string; value: string };
}
const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8')) as {
  id?: string;
  expose?: { slots?: Record<string, { accepts: string[] }> };
  extensionPoints: Point[];
  [key: string]: unknown;
};

const viewFiles = readdirSync(viewsDir).filter((file) => /\.ya?ml$/.test(file));

function parseView(file: string): Record<string, unknown> {
  const parsed = load(readFileSync(join(viewsDir, file), 'utf8'));
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${file} must hold a YAML mapping at its root`);
  }
  return parsed as Record<string, unknown>;
}

/** Every value stored under `key` at any depth. */
function collect(node: unknown, key: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, key, found));
  } else if (node !== null && typeof node === 'object') {
    for (const [name, child] of Object.entries(node)) {
      if (name === key) {
        found.push(child);
      }
      collect(child, key, found);
    }
  }
  return found;
}

/** Every Form node, at any depth. */
function findForms(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findForms(child, found));
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['$type'] === 'Form') {
      found.push(record);
    }
    Object.values(record).forEach((child) => findForms(child, found));
  }
  return found;
}

describe('manifest.json', () => {
  it('has the id project, no version (the packaging stamps it), no dslLib and no backend path (the packaging fixes it)', () => {
    expect(manifest.id).toBe('project');
    for (const key of ['version', 'dslLib', 'backendEntryPath']) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });

  it('declares the pages: Projects (/), Tree, Trash in the menu and /p/:project for the detail', () => {
    expect(manifest.extensionPoints.filter((p) => p.kind === 'page').map((p) => `${p.kind}:${p.slot}:${p.path}:${p.label}`)).toEqual([
      'page:nav:/:Projects',
      'page:nav:/tree:Tree',
      'page:nav:/deleted:Trash',
      'page:route:/p/:project:Project',
    ]);
  });

  it('exposes the two slots with the types they accept', () => {
    expect(manifest.expose?.slots).toEqual({
      'project-panels': { accepts: ['Section', 'Collapsible', 'Badge', 'ButtonLink'] },
      'project-links': { accepts: ['ButtonLink', 'IconButton', 'Badge'] },
    });
  });

  it('references each view as ./src/dsl-views/<file>, each file exists, and every file of the folder is referenced', () => {
    const referenced = manifest.extensionPoints.map((p) => p.view.value);
    for (const value of referenced) {
      expect(value).toMatch(/^\.\/src\/dsl-views\/[\w.-]+\.ya?ml$/);
      expect(existsSync(join(packageDir, value)), value).toBe(true);
    }
    expect(referenced.map((v) => v.replace('./src/dsl-views/', '')).sort()).toEqual([...viewFiles].sort());
  });
});

describe('dsl-views', () => {
  it.each(viewFiles)('%s parses and has a $type', (file) => {
    expect(parseView(file)['$type']).toEqual(expect.any(String));
  });

  it.each(viewFiles)('%s holds only keys the installed dsl-ui knows', async (file) => {
    const require = createRequire(import.meta.url);
    const walker = (await import('@wadeck-app/dsl-renderer/build/unknownKeys')) as {
      findUnknownKeys: (doc: unknown, known: unknown) => { severity: string; message: string; nodePath: string }[];
    };
    const knownKeys = JSON.parse(readFileSync(require.resolve('@wadeck-app/dsl-ui/known-keys.json'), 'utf8')) as unknown;
    const errors = walker.findUnknownKeys(parseView(file), knownKeys).filter((d) => d.severity === 'error');
    expect(errors, errors.map((d) => `${d.nodePath} ${d.message}`).join('\n')).toEqual([]);
  });

  // Guards against a check that passes because it checks nothing (a renamed export, an empty key file).
  it('the key check does flag an unknown key and an unknown component', async () => {
    const require = createRequire(import.meta.url);
    const walker = (await import('@wadeck-app/dsl-renderer/build/unknownKeys')) as {
      findUnknownKeys: (doc: unknown, known: unknown) => { severity: string; message: string }[];
    };
    const knownKeys = JSON.parse(readFileSync(require.resolve('@wadeck-app/dsl-ui/known-keys.json'), 'utf8')) as unknown;
    const found = walker.findUnknownKeys({ $type: 'PageContent', sections: [{ $type: 'Badge', label: 'x', colour: 'red' }, { $type: 'NoSuchThing' }] }, knownKeys);
    expect(found.filter((d) => d.severity === 'error').length).toBeGreaterThanOrEqual(2);
  });

  it.each(viewFiles)('%s is English and ASCII only (UI texts and comments)', (file) => {
    const text = readFileSync(join(viewsDir, file), 'utf8');
    // eslint-disable-next-line no-control-regex
    expect(text.replace(/[\x00-\x7f]/g, '')).toBe('');
  });

  const routes = makeModule().routes;
  const urlsOf = (file: string, key: '$sources' | '$actions'): { name: string; method: string; path: string; url: string }[] => {
    const block = (parseView(file)[key] ?? {}) as Record<string, { url: string }>;
    return Object.entries(block).map(([name, spec]) => {
      const [method = '', rest = ''] = spec.url.split(' ');
      return { name, method, path: rest.replace(/^\/api\/modules\/project/, '').split('?')[0]!, url: rest };
    });
  };
  // `{ref}` and `{project}` stand for the :ref of the route.
  const shape = (path: string): string => path.replace(/\{[^}]+\}/g, ':ref');

  it.each(viewFiles)('%s: every source and action calls a route the module registers (same method, same shape)', (file) => {
    const calls = [...urlsOf(file, '$sources'), ...urlsOf(file, '$actions')].filter((c) => c.url.startsWith('/api/modules/project'));
    for (const call of calls) {
      expect(routes, `${file} ${call.name}: ${call.method} ${call.path}`).toContain(`${call.method} ${shape(call.path)}`);
    }
  });

  // The shell glues the params to the url with '?': a url that already has a query AND params became 'a?x=1?label=..' (seen in a browser).
  // So a source with params gets inlineErrors as one of them, and a source without params has it in the url.
  it.each(viewFiles)('%s: the sources of the module answer errors as data (inlineErrors), so that one failure does not blank the page', (file) => {
    const document = parseView(file);
    const sources = (document['$sources'] ?? {}) as Record<string, { url: string; params?: Record<string, unknown> }>;
    for (const [name, source] of Object.entries(sources).filter(([, spec]) => spec.url.includes('/api/modules/project'))) {
      // A param written as {key} in the url fills the path and is not glued to the query (checked in a browser on the detail page).
      const hasParams = Object.keys(source.params ?? {}).some((key) => key !== 'inlineErrors' && !source.url.includes(`{${key}}`));
      if (hasParams && source.url.includes('?')) {
        throw new Error(`${file} ${name}: a url with a query string and params break in the shell; move the query into params`);
      }
      const inline = source.url.includes('inlineErrors=true') || source.params?.['inlineErrors'] === 'true';
      expect(inline, `${file} ${name}`).toBe(true);
    }
  });

  it.each(viewFiles)('%s: every action used by a form is declared, and every declared action is used', (file) => {
    const document = parseView(file);
    const declared = Object.keys((document['$actions'] ?? {}) as object);
    const used = (collect(document, 'onSubmit') as string[]).map((value) => value.replace('$ctx.', ''));
    expect([...new Set(used)].sort()).toEqual([...declared].sort());
  });

  it.each(viewFiles)('%s: an action that deletes or clears asks for a confirmation, and every action says its success and its failure', (file) => {
    const actions = (parseView(file)['$actions'] ?? {}) as Record<string, { url: string; confirm?: string; successMessage?: string; errorPrefix?: string }>;
    for (const [name, action] of Object.entries(actions)) {
      expect(action.successMessage, `${file} ${name} successMessage`).toEqual(expect.any(String));
      expect(action.errorPrefix, `${file} ${name} errorPrefix`).toEqual(expect.any(String));
      if (action.url.startsWith('DELETE ')) {
        expect(action.confirm, `${file} ${name} is a DELETE: it must have a confirm`).toEqual(expect.any(String));
      }
    }
  });

  // ButtonSave stays disabled ("No changes to save") until a field changes: a form without fields could never be submitted (seen in a browser).
  it.each(viewFiles)('%s: a form without fields submits with a ButtonAction, not a ButtonSave', (file) => {
    const forms = collect(parseView(file), '$type').length === 0 ? [] : findForms(parseView(file));
    for (const form of forms.filter((f) => Array.isArray(f['fields']) && (f['fields'] as unknown[]).length === 0)) {
      const types = ((form['actions'] ?? []) as { $type: string }[]).map((a) => a.$type);
      expect(types, JSON.stringify(form['onSubmit'])).not.toContain('ButtonSave');
      expect(types).toContain('ButtonAction');
    }
  });

  // The Count column shows `countText` (built by countTextOf): the page must not read the provider's raw `count`.
  it('the Related table of the detail page shows countText and never the raw count of a provider', () => {
    const page = readFileSync(join(viewsDir, 'project-page.yaml'), 'utf8');
    expect(page).toContain("key: 'countText'");
    expect(page).not.toMatch(/key: 'count'/);
    expect(page).not.toContain('.count');
  });

  it('the detail page embeds both slots, with the sources of the shell', () => {
    const page = readFileSync(join(viewsDir, 'project-page.yaml'), 'utf8');
    expect(page).toContain('url: GET /api/slots/project:project-links');
    expect(page).toContain('url: GET /api/slots/project:project-panels');
    expect(page.match(/\$type: ExtensionSlot/g)).toHaveLength(2);
  });
});
