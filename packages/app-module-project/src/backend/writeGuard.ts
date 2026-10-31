import { RequestError } from './httpError.js';

type Headers = Record<string, string | string[] | undefined>;

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]']);

const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? undefined : value);

/** `127.0.0.1:4850` -> `127.0.0.1`, `[::1]:4850` -> `[::1]`. */
function hostnameOf(host: string): string {
  const end = host.startsWith('[') ? host.indexOf(']') + 1 : host.indexOf(':');
  return (end > 0 ? host.slice(0, end) : host).toLowerCase();
}

function forbidden(message: string, hint: string): RequestError {
  return new RequestError(403, message, hint, 'FORBIDDEN');
}

/**
 * Protection of the routes that change the registry (anything but a read). app-core listens on the loopback only, but a page of another
 * site open in the same browser can still reach it:
 * - Host must be a local name (127.0.0.1, localhost, [::1]): a DNS rebinding attack arrives with the attacker's name;
 * - Origin, when the browser sends one, must be the Host of the request: a request from another site is refused. A client that is not
 *   a browser sends no Origin and passes;
 * - the body must be declared JSON: a form or a text/plain body (the "simple" cross-site requests, sent without a preflight) is refused.
 */
export function assertWriteAllowed(method: string, headers: Headers): void {
  if (READ_METHODS.has(method.toUpperCase())) {
    return;
  }
  const host = one(headers['host']);
  if (host === undefined || !LOCAL_HOSTNAMES.has(hostnameOf(host))) {
    throw forbidden(
      `refused: the Host of the request is ${JSON.stringify(host ?? '')}, not a local address`,
      'Open app-core at http://127.0.0.1:<port> or http://localhost:<port>; the project pages only change the registry for requests addressed to the local machine.',
    );
  }
  const origin = headers['origin'];
  if (origin !== undefined) {
    let originHost: string | undefined;
    try {
      originHost = typeof origin === 'string' ? new URL(origin).host.toLowerCase() : undefined;
    } catch {
      originHost = undefined;
    }
    if (originHost === undefined || originHost !== host.toLowerCase()) {
      throw forbidden(
        `refused: the Origin of the request is ${JSON.stringify(origin)}, not ${JSON.stringify(host)}`,
        'The registry is only changed by the project pages served by this app-core; a request coming from another site is refused.',
      );
    }
  }
  const type = one(headers['content-type']);
  if (type === undefined || type.split(';')[0]!.trim().toLowerCase() !== 'application/json') {
    throw new RequestError(
      415,
      `refused: this route needs the header Content-Type: application/json (got ${JSON.stringify(type ?? 'none')})`,
      'Send the header Content-Type: application/json, even on a request without a body.',
      'UNSUPPORTED_MEDIA_TYPE',
    );
  }
}
