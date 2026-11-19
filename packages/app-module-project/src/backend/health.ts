import { existsSync } from 'node:fs';
import { defaultRegistryDir, loadDeleted, loadRegistry, projectDir, registryFilePath, validateRegistry } from '@wadeck-app/project-sdk';
import { type RouteKit, ok } from './routeKit.js';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Runs one check; a throw becomes a failed check with the error message (which already says the file and the fix). */
function run(name: string, body: () => string): Check {
  try {
    return { name, ok: true, detail: body() };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The update test of app-core-cli: read-only and fast (a few small files). It answers what this module needs to work:
 * the registry parses and is consistent, the trash parses, and every project resolves to ONE data folder
 * (two folders for one project is the case the SDK refuses to guess). Nothing is created or written.
 */
export function registerHealthRoute(kit: RouteKit): void {
  kit.route('GET', '/health', async () => {
    const registryDir = defaultRegistryDir(process.env);
    const present = existsSync(registryFilePath(registryDir));
    const checks: Check[] = [];
    let projects: { id: string }[] = [];
    checks.push(
      run('registry', () => {
        if (!present) {
          return `no registry yet (${registryFilePath(registryDir)}); it is created by the first 'project add'`;
        }
        const registry = loadRegistry(registryDir);
        validateRegistry(registry);
        projects = registry.projects;
        return `${registry.projects.length} projects`;
      }),
    );
    checks.push(run('trash', () => `${loadDeleted(registryDir).projects.length} removed projects`));
    checks.push(
      run('folders', () => {
        // projectDir only reads the names in projects/ and throws on two folders for one id: first failure is enough to act on.
        projects.forEach((p) => projectDir(registryDir, p.id));
        return `${projects.length} projects, one folder each`;
      }),
    );
    return ok({ ok: checks.every((c) => c.ok), checks });
  });
}
