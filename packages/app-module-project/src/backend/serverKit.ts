import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect, createServer } from 'node:net';
import { dirname, join } from 'node:path';

/**
 * Helpers of the tests that run a REAL app-core (`app-core-cli dev`) in a temp config folder, on a free port: never 4850, never the real
 * config folders. Guards (timeouts) are generous on purpose: they detect a hang, they are not performance limits.
 */
export const SERVER_START_TIMEOUT_MS = 120_000;
export const PACKAGE_TIMEOUT_MS = 240_000;

const cliPackageJson = createRequire(import.meta.url).resolve('@wadeck-app/app-core-cli/package.json');
export const cliEntry = join(dirname(cliPackageJson), 'dist/cli.bundle.js');

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

/** The environment of every process of the test: everything that could reach the real config of the developer points into `workDir`. */
export function isolatedEnv(workDir: string, port: number): NodeJS.ProcessEnv {
  const xdg = join(workDir, 'xdg');
  // app-core-cli schedules a detached updater from this config dir: without `autoUpdate: false` it would install a real app-core-cli globally.
  mkdirSync(join(xdg, 'app-core-cli'), { recursive: true });
  writeFileSync(join(xdg, 'app-core-cli', 'config.yml'), 'autoUpdate: false\n');
  return {
    ...process.env,
    APP_CORE_PORT: String(port),
    APP_CORE_CONFIG_DIR: join(workDir, 'app-core'),
    XDG_CONFIG_HOME: xdg,
    HOME: workDir,
    USERPROFILE: workDir,
    APPDATA: join(workDir, 'AppData', 'Roaming'),
    LOCALAPPDATA: join(workDir, 'AppData', 'Local'),
    QUEUE_SDK_OFF: '1',
  };
}

export interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr, for assertions on a message wherever it was printed. */
  output: string;
}

/** `app-core-cli <command> ...args`, to the end. Never throws on a non-zero exit: the caller asserts on the status and the output. */
export function runCli(env: NodeJS.ProcessEnv, command: string, args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliEntry, command, ...args], { encoding: 'utf8', env, timeout: PACKAGE_TIMEOUT_MS, windowsHide: true });
  if (result.error !== undefined) {
    throw new Error(`app-core-cli ${command} could not run: ${result.error.message}`);
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: `${result.stdout}${result.stderr}` };
}

/** `app-core-cli package`, failing with the whole output when it does not succeed. */
export function packageModule(env: NodeJS.ProcessEnv, source: string, out: string, extra: string[] = []): CliResult {
  const result = runCli(env, 'package', [source, '--out', out, '--version', '0.0.0-test-optional', ...extra]);
  if (result.status !== 0) {
    throw new Error(`app-core-cli package ${source} failed (status ${result.status}):\n${result.output}`);
  }
  return result;
}

export interface DevServer {
  baseUrl: string;
  port: number;
  /** Everything the server printed. */
  output: () => string;
  stop: () => Promise<void>;
}

/** Starts `app-core-cli dev <module>` and waits for its URL. */
export function startDevServer(env: NodeJS.ProcessEnv, moduleDir: string, port: number): Promise<DevServer> {
  return new Promise((resolve, reject) => {
    let output = '';
    const child: ChildProcess = spawn(process.execPath, [cliEntry, 'dev', moduleDir], { windowsHide: true, env });
    const timer = setTimeout(() => reject(new Error(`app-core-cli dev did not print its URL within ${SERVER_START_TIMEOUT_MS} ms. Output so far:\n${output}`)), SERVER_START_TIMEOUT_MS);
    const onData = (chunk: Buffer): void => {
      output += chunk.toString();
      if (/app-core-cli dev: http:\/\/127\.0\.0\.1:\d+/.test(output)) {
        clearTimeout(timer);
        resolve({
          baseUrl: `http://127.0.0.1:${port}`,
          port,
          output: () => output,
          stop: async () => {
            if (child.exitCode === null) {
              const exited = new Promise<void>((done) => child.once('exit', () => done()));
              child.kill();
              await Promise.race([exited, sleep(20_000)]);
            }
            await waitPortFree(port, Date.now() + 20_000);
          },
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`app-core-cli dev exited early (code ${code}). Output:\n${output}`));
    });
  });
}

async function waitPortFree(port: number, deadline: number): Promise<void> {
  for (;;) {
    const free = await new Promise<boolean>((resolve) => {
      const socket = connect({ port, host: '127.0.0.1' });
      socket.once('connect', () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('error', () => resolve(true));
    });
    if (free || Date.now() >= deadline) {
      return;
    }
    await sleep(100);
  }
}

/** Removes a temp folder; Windows can refuse for a moment (EBUSY / EPERM). A folder that stays is a warning, never a failed test. */
export function removeWorkDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`[tests] could not remove ${dir} (${error instanceof Error ? error.message : String(error)}); delete it by hand\n`);
  }
}
