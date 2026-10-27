import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
}

interface Job {
  needs?: string | string[];
  'runs-on'?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  strategy?: { matrix: { os: string[] }; 'fail-fast'?: boolean };
  defaults?: { run?: { shell?: string } };
  steps: Step[];
}

const workflow = parse(readFileSync(join(repoRoot, '.github', 'workflows', 'publish.yml'), 'utf8')) as { jobs: Record<string, Job> };

const OS = ['ubuntu-latest', 'windows-latest', 'macos-latest'];

describe('publish.yml', () => {
  it('still builds and tests on the three systems before publishing', () => {
    expect(workflow.jobs['build-and-test']!.strategy!.matrix.os).toEqual(OS);
    expect([workflow.jobs['publish']!.needs].flat()).toContain('build-and-test');
  });

  it('exposes the published version as an output of the publish job', () => {
    expect(workflow.jobs['publish']!.outputs).toEqual({ version: '${{ steps.version.outputs.version }}' });
  });

  describe('verify-install', () => {
    const job = workflow.jobs['verify-install']!;

    it('runs after publish only (it is skipped when publish did not run), on the three systems, without cancelling the others', () => {
      expect([job.needs].flat()).toEqual(['publish']);
      expect(job.strategy!.matrix.os).toEqual(OS);
      expect(job.strategy!['fail-fast']).toBe(false);
      expect(job['runs-on']).toBe('${{ matrix.os }}');
    });

    it('may only read packages (and the repository, for the scripts)', () => {
      expect(job.permissions).toEqual({ contents: 'read', packages: 'read' });
    });

    it('installs from GitHub Packages with the token of the workflow, and runs the scripts in bash on every system', () => {
      const node = job.steps.find((s) => s.uses?.startsWith('actions/setup-node'))!;
      expect(node.with).toMatchObject({ 'registry-url': 'https://npm.pkg.github.com', scope: '@wadeck-app' });
      expect(job.defaults?.run?.shell).toBe('bash');
      const runs = job.steps.filter((s) => s.run !== undefined);
      expect(runs.length).toBeGreaterThanOrEqual(2);
      for (const step of runs) {
        expect(step.env?.['NODE_AUTH_TOKEN'], step.name).toBe('${{ secrets.GITHUB_TOKEN }}');
      }
    });

    it('verifies the install of the version just published, then the update from the previous one, with scripts that can also be run locally', () => {
      const commands = job.steps.map((s) => s.run ?? '');
      expect(commands.some((c) => c.includes('verify-install.sh') && c.includes('${{ needs.publish.outputs.version }}'))).toBe(true);
      expect(commands.some((c) => c.includes('verify-update.sh') && c.includes('${{ needs.publish.outputs.version }}'))).toBe(true);
      for (const script of ['verify-install.sh', 'verify-update.sh', 'verify-lib.sh', 'previous-version.mjs']) {
        expect(existsSync(join(repoRoot, 'packages', 'project-cli', 'ci', 'scripts', script)), script).toBe(true);
      }
    });
  });
});
