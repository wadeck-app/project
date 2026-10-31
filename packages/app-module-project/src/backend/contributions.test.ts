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
  'flow:executions-project-header': { provider: 'flow', accepts: ['ButtonLink', 'IconButton', 'Badge', 'Link'] },
} as const;

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

  // A prop is an expression only when it STARTS with $: "/modules/project/p/$route.project" is followed as typed (seen in a browser), the address is
  // therefore built with $concat(...) (dsl-renderer 2026.10.31-306 and later).
  const link = (id: string): string => `$concat('/modules/project/p/', ${id})`;
  const ID_OF: Record<keyof typeof PROVIDERS, string> = {
    'task:project-header': '$route.project',
    'queue:project-header': '$sources.projectScope.id',
    'flow:execution-project-header': '$sources.execution.projectId',
    'flow:executions-project-header': '$urlParam.project',
  };

  it.each(Object.entries(PROVIDERS))('%s: the root $type is one the slot accepts', (slot, contract) => {
    const view = viewOf(widgets.find((p) => p.slot === slot)!);
    expect(contract.accepts, `${slot} accepts ${contract.accepts.join(', ')}`).toContain(view['$type']);
  });

  it.each(Object.entries(ID_OF))('%s: links to the page of the project, built with $concat from what the host gives', (slot, id) => {
    expect(viewOf(widgets.find((p) => p.slot === slot)!)['to'], slot).toBe(link(id));
  });

  it.each(Object.keys(PROVIDERS))('%s: declares no $sources of its own (a contributed node cannot, app-core ignores them)', (slot) => {
    expect(viewOf(widgets.find((p) => p.slot === slot)!)).not.toHaveProperty('$sources');
  });

  it('is shown only when the host has a project (task: a project page; queue: found; flow: an execution with a project, a list with ?project=)', () => {
    const guard = (slot: string): unknown => viewOf(widgets.find((p) => p.slot === slot)!)['$if'];
    expect(guard('task:project-header')).toBe('$route.project');
    expect(guard('queue:project-header')).toBe('$sources.projectScope.found');
    expect(guard('flow:execution-project-header')).toBe('$sources.execution.projectId');
    expect(guard('flow:executions-project-header')).toBe('$urlParam.project');
  });

  it('is labelled with the name of the project when the host gives it, else "Project"', () => {
    const label = (slot: string): unknown => viewOf(widgets.find((p) => p.slot === slot)!)['label'];
    expect(label('task:project-header')).toBe('Project');
    expect(label('queue:project-header')).toBe('$sources.projectScope.name');
    // Old executions have no projectLabel: the guard on projectId decides whether to show, the label falls back.
    expect(label('flow:execution-project-header')).toBe("$sources.execution.projectLabel || 'Project'");
    expect(label('flow:executions-project-header')).toBe('Project');
  });
});
