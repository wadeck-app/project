import { resolveAppCorePort } from '@wadeck-app/app-core-sdk/register';

/**
 * Where the app-core server this module runs in listens: APP_CORE_PORT, else the port app-core wrote for itself (server.port.json),
 * else 4850 (the rules of the SDK, shared with `project cli register`). A malformed APP_CORE_PORT throws: never another port.
 */
export function appCoreBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return `http://127.0.0.1:${resolveAppCorePort(env)}`;
}
