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

/** Every Form and DialogForm node, at any depth. */
function findForms(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findForms(child, found));
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['$type'] === 'Form' || record['$type'] === 'DialogForm') {
      found.push(record);
    }
    Object.values(record).forEach((child) => findForms(child, found));
  }
  return found;
}

/** Every node of the given `$type`, at any depth. */
function findNodes(node: unknown, type: string, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    node.forEach((child) => findNodes(child, type, found));
  } else if (node !== null && typeof node === 'object') {
    const record = node as Record<string, unknown>;
    if (record['$type'] === type) {
      found.push(record);
    }
    Object.values(record).forEach((child) => findNodes(child, type, found));
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

  it('declares the pages: Projects (/projects), Tree, Trash in the menu and /projects/:project for the detail', () => {
    expect(manifest.extensionPoints.filter((p) => p.kind === 'page').map((p) => `${p.kind}:${p.slot}:${p.path}:${p.label}`)).toEqual([
      'page:nav:/projects:Projects',
      'page:nav:/tree:Tree',
      'page:nav:/deleted:Trash',
      'page:route:/projects/:project:Project',
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
    const block = (parseView(file)[key] ?? {}) as Record<string, { url?: string }>;
    return Object.entries(block).filter(([, spec]) => spec.url !== undefined).map(([name, spec]) => {
      const [method = '', rest = ''] = spec.url!.split(' ');
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
    const used = [...(collect(document, 'onSubmit') as string[]), ...(collect(document, 'onClick') as string[]), ...(collect(document, 'onClose') as string[])].map((value) => value.replace('$ctx.', ''));
    expect([...new Set(used)].sort()).toEqual([...declared].sort());
  });

  it.each(viewFiles)('%s: an action that deletes or clears asks for a confirmation, and every action says its success and its failure', (file) => {
    const actions = Object.fromEntries(Object.entries((parseView(file)['$actions'] ?? {}) as Record<string, { url?: string; confirm?: string; successMessage?: string; errorPrefix?: string }>).filter(([, a]) => a.url !== undefined)) as Record<string, { url: string; confirm?: string; successMessage?: string; errorPrefix?: string }>;
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
    // `.countText` is the allowed field; the raw `.count` (alone) is not
    expect(page).not.toMatch(/\.count(?![A-Za-z])/);
  });

  // The page is one AbTest: `current` is the tabbed page (overview, one tab per tool, settings last, the tab kept in the URL).
  interface AbVariant {
    label: string;
    hint: string;
    view: unknown;
  }
  function abVariants(): { id: string; initial: string; variants: Record<string, AbVariant> } {
    const page = parseView('project-page.yaml') as { sections: { $type: string; id?: string; initial?: string; variants?: Record<string, AbVariant> }[] };
    expect(page.sections.map((s) => s.$type)).toEqual(['AbTest']);
    const test = page.sections[0]!;
    expect(test.id).toBe('detail-layout');
    return { id: test.id!, initial: test.initial!, variants: test.variants! };
  }

  it('the detail page is organised in tabs kept in the URL in its current variant: overview, one per tool, settings last', () => {
    const { initial, variants } = abVariants();
    expect(initial).toBe('current');
    const tabs = findNodes(variants['current']!.view, 'PageTabs')[0] as { urlParam?: string; tabs?: { id: string; label: string; children: unknown[] }[] };
    expect(tabs.urlParam).toBe('tab');
    expect(tabs.tabs?.map((t) => t.id)).toEqual(['overview', 'task', 'flow', 'queue', 'settings']);
    for (const tab of tabs.tabs ?? []) {
      expect(tab.children.length, tab.id).toBeGreaterThan(0);
    }
  });

  it('every layout variant keeps every action of the page, both slots and the removal switch', () => {
    const { variants } = abVariants();
    expect(Object.keys(variants).length).toBeGreaterThanOrEqual(3);
    const page = parseView('project-page.yaml') as { $actions: Record<string, { url?: string }> };
    // The actions that call a route; the ones that only open a popup are checked in the popups test below.
    const actions = Object.entries(page.$actions).filter(([, a]) => a.url !== undefined).map(([name]) => name).sort();
    const submitted = (view: unknown): string[] => [...new Set(findForms(view).map((f) => String(f['onSubmit']).replace('$ctx.', '')))].sort();
    for (const [id, variant] of Object.entries(variants)) {
      expect(variant.label, id).toBeTruthy();
      expect(variant.hint, id).toBeTruthy();
      expect(submitted(variant.view), id).toEqual(actions);
      expect(findNodes(variant.view, 'ExtensionSlot').map((n) => n['items']).sort(), id).toEqual(['$sources.links', '$sources.panels']);
      expect(findNodes(variant.view, 'Switch').filter((n) => n['bind'] === 'recursive'), id).toHaveLength(1);
      expect(findNodes(variant.view, 'PageHeader'), id).toHaveLength(1);
    }
  });

  it('every layout variant has the folder name (slug) form, and its action warns that the folder is moved and the tools must be stopped', () => {
    const { variants } = abVariants();
    for (const [id, variant] of Object.entries(variants)) {
      const forms = findForms(variant.view).filter((f) => f['onSubmit'] === '$ctx.setSlug');
      expect(forms, id).toHaveLength(1);
    }
    const action = (parseView('project-page.yaml') as { $actions: Record<string, { url: string; confirm?: string }> }).$actions['setSlug']!;
    expect(action.url).toBe('PUT /api/modules/project/projects/{ref}/slug');
    expect(action.confirm).toMatch(/MOVED.*Stop the tools/s);
  });

  // A provider's moreUrl must be a visible link, not only the click on the row: a column with the text "See all" whose address is the row href.
  it('the Related table shows a "See all" link per panel (empty text, so no link, when the provider sent no moreUrl)', () => {
    const page = readFileSync(join(viewsDir, 'project-page.yaml'), 'utf8');
    expect(page).toContain("{ key: 'seeAllText', label: '', href: '{href}', nowrap: true }");
  });

  it('the detail page embeds both slots, with the sources of the shell', () => {
    const page = readFileSync(join(viewsDir, 'project-page.yaml'), 'utf8');
    expect(page).toContain('url: GET /api/slots/project:project-links');
    expect(page).toContain('url: GET /api/slots/project:project-panels');
    expect(page.match(/\$type: ExtensionSlot/g)).toHaveLength(2);
  });
});

// Seen in a browser (isolated app-core, removed projects): the form sent {id} and the route refused "unknown field 'id'; the accepted fields are: ref, recursive".
// A row action takes the placeholder from the row, a form from the field it binds: both must be `ref`, the field the restore route accepts.
describe('trash page: the restore action matches the route', () => {
  const page = parseView('deleted-page.yaml');

  it('puts {ref} in the url and every form that submits it binds `ref` (the body field of POST /deleted/:ref/restore)', () => {
    const action = (page['$actions'] as Record<string, { url: string }>)['restoreProject']!;
    expect(action.url).toBe('POST /api/modules/project/deleted/{ref}/restore');
    const forms = findForms(page).filter((f) => f['onSubmit'] === '$ctx.restoreProject');
    expect(forms.length).toBeGreaterThan(0);
    for (const form of forms) {
      const binds = ((form['fields'] ?? []) as { bind?: string }[]).map((f) => f.bind).filter((b) => b !== 'recursive');
      expect(binds).toEqual(['ref']);
    }
  });
});

// Round 2 of the detail page: every change is a popup. A popup opens when its button runs an action with a `resultKey` and no url; the DialogForm
// has `visible: $<resultKey>`. A button without its dialog (or the reverse) opens nothing and says nothing.
describe('detail page: popups are wired from a button to a DialogForm', () => {
  const page = parseView('project-page.yaml') as { $actions: Record<string, { url?: string; resultKey?: string; clear?: boolean }>; sections: { variants: Record<string, { view: unknown }> }[] };
  const openActions = Object.entries(page.$actions).filter(([, a]) => a.url === undefined && a.clear !== true);
  const variantsWithDialogs = Object.entries(page.sections[0]!.variants).filter(([, v]) => findNodes(v.view, 'DialogForm').length > 0);

  it('has at least two variants with popups, and every action without a url has a resultKey', () => {
    expect(variantsWithDialogs.length).toBeGreaterThanOrEqual(2);
    for (const [name, action] of openActions) {
      expect(action.resultKey, name).toEqual(expect.any(String));
    }
  });

  it.each(variantsWithDialogs.map(([id]) => id))('%s: every open button has its dialog, every dialog has a button, once each', (id) => {
    const view = page.sections[0]!.variants[id]!.view;
    const visibles = findNodes(view, 'DialogForm').map((d) => String(d['visible']).replace(/^\$/, ''));
    expect(new Set(visibles).size, 'two dialogs share a visible key').toBe(visibles.length);
    const keys = openActions.map(([, a]) => a.resultKey!);
    expect([...visibles].sort()).toEqual([...keys].sort());
    const clicked = (collect(view, 'onClick') as string[]).map((v) => v.replace('$ctx.', ''));
    for (const [name] of openActions) {
      expect(clicked, `no button runs ${name}`).toContain(name);
    }
  });
});

// A popup that opens and cannot close was seen in a browser (a DialogForm without onClose stays open after Cancel, the X and a successful Save).
describe('detail page: every popup closes', () => {
  const page = parseView('project-page.yaml') as { $actions: Record<string, { url?: string; resultKey?: string; clear?: boolean }>; sections: { variants: Record<string, { view: unknown }> }[] };

  it('every dialog has an onClose that runs an action which clears the very key of its `visible`', () => {
    const dialogs = Object.values(page.sections[0]!.variants).flatMap((v) => findNodes(v.view, 'DialogForm'));
    expect(dialogs.length).toBeGreaterThan(0);
    for (const dialog of dialogs) {
      const name = String(dialog['onClose']).replace('$ctx.', '');
      const action = page.$actions[name];
      expect(action, `${String(dialog['title'])}: onClose ${String(dialog['onClose'])} is not a declared action`).toBeDefined();
      expect(action!.clear, `${name} must clear`).toBe(true);
      expect(action!.url, `${name} must have no url`).toBeUndefined();
      expect(`$${action!.resultKey}`, `${name} must clear the key the dialog shows`).toBe(String(dialog['visible']));
    }
  });
});
