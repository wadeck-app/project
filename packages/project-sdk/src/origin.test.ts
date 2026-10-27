import { describe, expect, it } from 'vitest';
import { buildOrigin, formatOrigin } from './origin.js';
import { toNativePath } from './paths.js';
import type { Scope } from './resolution.js';
import { makeProject } from './testHelpers.js';

const NOW = new Date('2026-10-27T10:20:30.000Z');
const base = process.platform === 'win32' ? 'C:/work' : '/work';

describe('buildOrigin', () => {
  const shop = makeProject(0x3fa9c1d2, { name: 'shop', paths: [{ path: `${base}/shop`, main: true }] });
  const scope: Scope = { project: shop, path: `${base}/shop`, pathVia: 'cwd', source: 'cwd', via: 'cwd' };

  it('takes the project and the working directory from the scope, and the time given', () => {
    expect(buildOrigin('task', scope, NOW)).toEqual({ tool: 'task', at: '2026-10-27T10:20:30.000Z', projectId: shop.id, projectName: 'shop', cwd: `${base}/shop` });
  });

  it('has no project field without scope: only the tool and the time', () => {
    const origin = buildOrigin('flow', undefined, NOW);
    expect(origin).toEqual({ tool: 'flow', at: '2026-10-27T10:20:30.000Z' });
    expect(origin).not.toHaveProperty('projectId');
    expect(origin).not.toHaveProperty('cwd');
  });

  it('has no cwd for a virtual project (no path)', () => {
    const virtual = makeProject(1, { name: 'base' });
    const origin = buildOrigin('queue', { project: virtual, source: 'flag', via: '--project' }, NOW);
    expect(origin).toEqual({ tool: 'queue', at: '2026-10-27T10:20:30.000Z', projectId: virtual.id, projectName: 'base' });
  });

  it('uses the current time by default', () => {
    const before = Date.now();
    const at = Date.parse(buildOrigin('task').at);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it('holds nothing but those fields: no environment value, no credential, no registry content', () => {
    const origin = buildOrigin('task', { ...scope, project: { ...shop, git: 'https://user:s3cret@host/x.git' } }, NOW);
    expect(Object.keys(origin).sort()).toEqual(['at', 'cwd', 'projectId', 'projectName', 'tool']);
    expect(JSON.stringify(origin)).not.toContain('s3cret');
  });

  it('is plain data: JSON round-trips to the same value', () => {
    const origin = buildOrigin('task', scope, NOW);
    expect(JSON.parse(JSON.stringify(origin))).toEqual(origin);
  });
});

describe('formatOrigin', () => {
  it('is "<tool> from <project> (<id>) at <cwd>", the path in the form of the platform', () => {
    const line = formatOrigin({ tool: 'task', at: 'x', projectId: '3fa9c1d2', projectName: 'shop', cwd: `${base}/shop` });
    expect(line).toBe(`task from shop (3fa9c1d2) at ${toNativePath(`${base}/shop`)}`);
  });

  it('leaves out the cwd when there is none', () => {
    expect(formatOrigin({ tool: 'flow', at: 'x', projectId: '00000001', projectName: 'base' })).toBe('flow from base (00000001)');
  });

  it('says so when the action came from outside any project', () => {
    expect(formatOrigin({ tool: 'task', at: 'x' })).toBe('task from outside any project');
  });
});
