import type { ModuleContext } from '@wadeck-app/app-core-sdk';
import { toHttpError } from './httpError.js';
import { assertWriteAllowed } from './writeGuard.js';

/** The parts of a Fastify request the routes read (the SDK types them loosely). */
export interface RouteRequest {
  params?: Record<string, string>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

/** What a route returns: the HTTP status and the JSON body. */
export interface RouteAnswer {
  status: number;
  body: unknown;
}

export const ok = (body: unknown): RouteAnswer => ({ status: 200, body });

export interface RouteKit {
  /** Registers a route; every error thrown by `run` becomes its HTTP answer (see httpError.ts). */
  route(method: string, subPath: string, run: (req: RouteRequest) => Promise<RouteAnswer>): void;
}

type Reply = { code(status: number): { send(body: unknown): unknown } };

/**
 * `?inlineErrors=true`: the caller is a view whose source must not fail (a failed source blanks the whole page): the error is answered
 * 200 as data, with `errorText` (message and hint, one line) to display.
 */
function inline(failure: { status: number; body: Record<string, unknown> }): { status: number; body: Record<string, unknown> } {
  const message = typeof failure.body['message'] === 'string' ? failure.body['message'] : `Request failed with status ${failure.status}.`;
  return { status: 200, body: { ...failure.body, failed: true, httpStatus: failure.status, errorText: message } };
}

export function createRouteKit(ctx: ModuleContext, writeStderr: (text: string) => void = (text) => void process.stderr.write(text)): RouteKit {
  return {
    route(method, subPath, run) {
      ctx.registerRoute(method, subPath, async (req, reply) => {
        const out = reply as unknown as Reply;
        const request = req as unknown as RouteRequest;
        try {
          // Before anything else: a refused write never reaches the registry.
          assertWriteAllowed(method, request.headers ?? {});
          const answer = await run(request);
          return out.code(answer.status).send(answer.body);
        } catch (error) {
          const failure = toHttpError(error);
          // Only unexpected failures: a 4xx is the caller's mistake and is already in its answer.
          if (failure.status >= 500) {
            const cause = error instanceof Error ? (error.stack ?? error.message) : String(error);
            writeStderr(`[project module] ${method} ${subPath} failed with ${failure.status}: ${cause}\n`);
          }
          // Only a read is answered as data: a refused or failed change must be an error for the shell.
          const asData = request.query?.['inlineErrors'] === 'true' && method.toUpperCase() === 'GET';
          const answer = asData ? inline(failure) : failure;
          return out.code(answer.status).send(answer.body);
        }
      });
    },
  };
}
