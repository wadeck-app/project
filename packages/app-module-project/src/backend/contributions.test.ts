import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '../..');

interface Point {
  kind: string;
  slot: string;
  label?: string;
  view: { type: string; value: string };
}
const manifest = JSON.parse(readFileSync(join(packageDir, 'manifest.json'), 'utf8')) as {
  requires?: Record<string, string>;
  optionalRequires?: Record<string, string>;
  extensionPoints: Point[];
};

/**
 * What the owners of the providers declared (their `expose.slots`) and what their pages give to a contribution. The real declarations are
 * checked against a COPY of each provider's packaged module in realServer.optional.integration.test.ts when the repositories are there.
 */
const PROVIDERS = {
  'task:project-header': { provider: 'task', accepts: ['ButtonLink', 'IconButton', 'Badge'] },
  'queue:project-header': { provider: 'queue', accepts: ['Badge', 'Link', 'ButtonLink'] },
  'flow:execution-project-header': { provider: 'flow', accepts: ['ButtonLink', 'IconButton', 'Badge', 'Link'] },
} as const;

/**
 * Not contributed to, on purpose: flow:executions-project-header. Its host has only the URL parameter `project`, and a contributed node
 * cannot read it (`$urlParam` is not in its context: checked in a browser, the link never rendered). A contribution there could only be
 * shown unconditionally, on every executions page. It needs the host to put the value in one of its sources.
 */
const NOT_CONTRIBUTED = ['flow:executions-project-header'];

const widgets = manifest.extensionPoints.filter((point) => point.kind === 'widget');

function viewOf(point: Point): Record<string, unknown> {
  return load(readFileSync(join(packageDir, point.view.value), 'utf8')) as Record<string, unknown>;
}

describe('independence: the project module works without task, queue and flow', () => {
  it('has NO `requires` at all: a hard requirement would make the whole module fail when a provider is missing', () => {
    expect(manifest, 'manifest.json must not have "requires": use "optionalRequires" for the modules the project module only contributes to').not.toHaveProperty('requires');
  });

  it('lists task, queue and flow in `optionalRequires`, with any version', () => {
    expect(manifest.optionalRequires).toEqual({ task: '*', queue: '*', flow: '*' });
  });

  it('contributes only to slots of a module listed in `optionalRequires` (a contribution to an unlisted module would need `requires`)', () => {
    for (const point of widgets) {
      const provider = point.slot.split(':')[0]!;
      expect(Object.keys(manifest.optionalRequires ?? {}), `${point.slot} is a slot of ${provider}`).toContain(provider);
    }
  });

  it('does not depend on a provider in package.json either (the packaging would then read it as a required dependency)', () => {
    const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    const names = ['dependencies', 'devDependencies', 'peerDependencies'].flatMap((key) => Object.keys(pkg[key] ?? {}));
    for (const forbidden of ['@wadeck-app/app-module-task', '@wadeck-app/app-module-queue', '@wadeck-app/app-module-flow']) {
      expect(names).not.toContain(forbidden);
    }
  });
});

describe('the widgets it contributes', () => {
  it('are exactly one per slot of the final contracts of the owners', () => {
    expect(widgets.map((point) => point.slot).sort()).toEqual(Object.keys(PROVIDERS).sort());
  });

  it('do not contribute to the slot whose host context a contributed node cannot read', () => {
    for (const slot of NOT_CONTRIBUTED) {
      expect(widgets.map((p) => p.slot), slot).not.toContain(slot);
    }
  });

  // A prop that is not ONE expression ("$a.b") is a literal: "/modules/project/p/$route.project" would be followed as it is (checked in a
  // browser: href="/modules/project/p/$route.project"). The link is therefore a fixed address until a host gives a ready-made one.
  it.each(Object.entries(PROVIDERS))('%s: the root $type is one the slot accepts, and it is a link to the project registry with a fixed address', (slot, contract) => {
    const point = widgets.find((p) => p.slot === slot)!;
    const view = viewOf(point);
    expect(contract.accepts, `${slot} accepts ${contract.accepts.join(', ')}`).toContain(view['$type']);
    expect(view['to'], slot).toBe('/modules/project/');
  });

  it.each(Object.keys(PROVIDERS))('%s: declares no $sources of its own (a contributed node cannot, app-core ignores them)', (slot) => {
    const view = viewOf(widgets.find((p) => p.slot === slot)!);
    expect(view).not.toHaveProperty('$sources');
  });

  it('read only what the host gives (final contracts)', () => {
    const text = (slot: string): string => readFileSync(join(packageDir, widgets.find((p) => p.slot === slot)!.view.value), 'utf8');
    expect(text('task:project-header')).toContain('$route.project');
    expect(text('queue:project-header')).toContain('$sources.projectScope.found');
    expect(text('flow:execution-project-header')).toContain('$sources.execution.projectId');
  });

  it('show nothing when the host has no project (queue: not found; flow: old executions without a project)', () => {
    const guard = (slot: string): unknown => viewOf(widgets.find((p) => p.slot === slot)!)['$if'];
    expect(guard('task:project-header')).toBe('$route.project');
    expect(guard('queue:project-header')).toBe('$sources.projectScope.found');
    expect(guard('flow:execution-project-header')).toBe('$sources.execution.projectId');
  });

  it('are labelled "Projects": the address is the registry, not the project, so the name of the project would mislead', () => {
    for (const slot of Object.keys(PROVIDERS)) {
      expect(viewOf(widgets.find((p) => p.slot === slot)!)['label'], slot).toBe('Projects');
    }
  });
});
