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
  shell?: string;
  if?: string;
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

  describe('build-and-test', () => {
    const steps = workflow.jobs['build-and-test']!.steps;
    const named = (text: string): Step => steps.find((s) => s.name?.includes(text))!;

    it('runs the tests in bash with their output kept in a file and the exit code of the tests (pipefail)', () => {
      const run = named('Run tests');
      expect(run.shell).toBe('bash');
      expect(run.run).toContain('set -o pipefail');
      expect(run.run).toContain('npm test 2>&1 | tee "${{ runner.temp }}/tests.log"');
    });

    it('annotates the end of the log when the job fails, right after the tests (a Windows failure is otherwise unreadable)', () => {
      const index = steps.indexOf(named('Annotate the failure of the tests'));
      expect(index).toBe(steps.indexOf(named('Run tests')) + 1);
      expect(steps[index]!.if).toBe('failure()');
      expect(steps[index]!.run).toContain('annotate-failure.mjs');
      expect(steps[index]!.run).toContain('tests.log');
      expect(existsSync(join(repoRoot, 'packages', 'project-cli', 'ci', 'scripts', 'annotate-failure.mjs'))).toBe(true);
    });

    it('checks the app-core module (layout, manifest, slots) before the tests', () => {
      const check = named('Check the app-core module');
      expect(check.run).toBe('npm run check');
      expect(steps.indexOf(check)).toBeLessThan(steps.indexOf(named('Run tests')));
    });
  });

  it('publishes the app-module with the CLI: the generated dist package lists app-module/ (the canonical script is untouched, the extra is an argument)', () => {
    const generate = workflow.jobs['publish']!.steps.find((s) => s.run?.includes('generate-platform-packages.sh'))!;
    expect(generate.run).toContain('generate-platform-packages.sh project:app-module/');
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
      // The annotation steps only read a local log: they get no token.
      const runs = job.steps.filter((s) => s.run !== undefined && !s.run.includes('annotate-failure.mjs'));
      expect(runs.length).toBeGreaterThanOrEqual(2);
      for (const step of runs) {
        expect(step.env?.['NODE_AUTH_TOKEN'], step.name).toBe('${{ secrets.GITHUB_TOKEN }}');
      }
    });

    it('keeps the output of each check in a log and annotates the end of it when the check fails', () => {
      for (const [script, log] of [
        ['verify-install.sh', 'verify-install.log'],
        ['verify-update.sh', 'verify-update.log'],
      ] as const) {
        const run = job.steps.find((s) => s.run?.includes(script))!;
        expect(run.run, script).toContain('set -o pipefail');
        expect(run.run, script).toContain(`tee "\${{ runner.temp }}/${log}"`);
        const next = job.steps[job.steps.indexOf(run) + 1]!;
        expect(next.if, script).toBe('failure()');
        expect(next.run, script).toContain('annotate-failure.mjs');
        expect(next.run, script).toContain(log);
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
