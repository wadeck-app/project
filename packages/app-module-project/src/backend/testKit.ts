import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { defaultRegistryDir, normalizePath } from '@wadeck-app/project-sdk';
import registerProjectRoutes from './index.js';

export interface Call {
  status: number;
  // The routes answer plain JSON: the tests read it freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Added to the headers of a local browser request (Host and Content-Type); a value of undefined removes the header. */
  headers?: Record<string, string | undefined>;
}

interface Route {
  method: string;
  segments: string[];
  handler: (req: unknown, reply: unknown) => unknown;
}

/** A module context that only records the routes, and `call` runs one the way app-core's router does (method, segments, decoded params). */
export function makeModule(): { call: (method: string, path: string, options?: CallOptions) => Promise<Call>; routes: string[] } {
  const routes: Route[] = [];
  const ctx = {
    dataDir: tmpdir(),
    registerRoute: (method: string, subPath: string, handler: Route['handler']) => {
      routes.push({ method, segments: subPath.split('/').filter(Boolean), handler });
    },
  } as unknown as ModuleContext;
  registerProjectRoutes(ctx);

  return {
    routes: routes.map((r) => `${r.method} /${r.segments.join('/')}`),
    async call(method, path, options = {}) {
      const [pathOnly = '', queryString] = path.split('?');
      const segments = pathOnly.split('/').filter(Boolean);
      const query: Record<string, unknown> = { ...(options.query ?? {}) };
      for (const [key, value] of new URLSearchParams(queryString ?? '')) {
        const previous = query[key];
        query[key] = previous === undefined ? value : [previous, value].flat();
      }
      const found = routes.find((r) => r.method === method && r.segments.length === segments.length && r.segments.every((s, i) => s.startsWith(':') || s === decodeURIComponent(segments[i]!)));
      if (found === undefined) {
        return { status: 404, body: { error: 'NO_ROUTE', message: `no route ${method} ${pathOnly}` } };
      }
      const params: Record<string, string> = { ...(options.params ?? {}) };
      found.segments.forEach((s, i) => {
        if (s.startsWith(':')) {
          params[s.slice(1)] = decodeURIComponent(segments[i]!);
        }
      });
      let status = 200;
      let body: unknown;
      const reply = {
        code(value: number) {
          status = value;
          return reply;
        },
        send(payload: unknown) {
          body = payload;
          return reply;
        },
      };
      const headers: Record<string, string | undefined> = { host: '127.0.0.1:4850', 'content-type': 'application/json', ...(options.headers ?? {}) };
      for (const name of Object.keys(headers)) {
        if (headers[name] === undefined) {
          delete headers[name];
        }
      }
      await found.handler({ params, query, body: options.body, headers }, reply);
      return { status, body };
    },
  };
}

export interface World {
  /** The folder of the shared registry the module reads (XDG_CONFIG_HOME points at it, set by vitest.setup.ts). */
  registryDir: string;
  root: string;
  /** Makes `<root>/<name>` and returns its stored (forward-slash) path. */
  folder(name: string): string;
  cleanup(): void;
}

/** Real temp folders and an empty registry in the sandbox of the test file; `cleanup` empties it again. */
export function makeWorld(): World {
  const root = mkdtempSync(join(tmpdir(), 'project-module-world-'));
  const registryDir = defaultRegistryDir(process.env);
  return {
    registryDir,
    root,
    folder(name) {
      const path = join(root, name);
      mkdirSync(path, { recursive: true });
      return normalizePath(path);
    },
    cleanup() {
      // Windows can refuse to remove a folder for a moment (antivirus, indexer): retry before failing.
      for (const dir of [root, registryDir]) {
        try {
          rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
        } catch (error) {
          // Never a failed test over a temp folder: said, and left for the user.
          process.stderr.write(`[tests] could not remove ${dir} (${error instanceof Error ? error.message : String(error)}); delete it by hand\n`);
        }
      }
    },
  };
}
