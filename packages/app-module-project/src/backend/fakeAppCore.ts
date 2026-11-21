import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach } from 'vitest';

export type Behavior = (req: IncomingMessage, res: ServerResponse) => void;

export interface Fake {
  baseUrl: string;
  calls: string[];
  close(): Promise<void>;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

export const json = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

/**
 * A fake app-core: `modules` are the installed modules, `behaviors[id]` answers GET /api/modules/<id>/related/project/<projectId>.
 * A string is a module that declares an optional dependency on project (what a module that contributes to the project page does); an object says
 * exactly what the module declares in its manifest (requires, optionalRequires).
 */
export type FakeModule = string | { id: string; requires?: Record<string, string>; optionalRequires?: Record<string, string> };

export async function fakeAppCore(modules: FakeModule[], behaviors: Record<string, Behavior>): Promise<Fake> {
  const calls: string[] = [];
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    if (url === '/api/modules') {
      return json(res, 200, {
        modules: modules.map((m) => (typeof m === 'string' ? { id: m, version: '1.0.0', requires: {}, optionalRequires: { project: '*' } } : { version: '1.0.0', requires: {}, optionalRequires: {}, ...m })),
        failed: [],
      });
    }
    const match = /^\/api\/modules\/([^/]+)\/related\/project\/([^/]+)$/.exec(url);
    const behavior = match === null ? undefined : behaviors[match[1]!];
    if (match === null || behavior === undefined) {
      return json(res, 404, { error: 'no such route' });
    }
    calls.push(`${match[1]}:${match[2]}`);
    return behavior(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { baseUrl: `http://127.0.0.1:${port}`, calls, close: () => new Promise((resolve) => server.close(() => resolve(undefined))) };
}

