/**
 * リクエストごとのホスト機能（Workers の `ctx.waitUntil` など）。
 *
 * fetch-router の `context.request` はエントリが受け取った Request と同一なので、
 * Request をキーにして引き回す。Deno で動かすときは何も登録されず、
 * バックグラウンド処理は await にフォールバックする。
 */

export interface RequestScope {
  waitUntil?: (promise: Promise<unknown>) => void;
}

const scopes = new WeakMap<Request, RequestScope>();

export function setRequestScope(request: Request, scope: RequestScope): void {
  scopes.set(request, scope);
}

export function getRequestScope(request: Request): RequestScope {
  return scopes.get(request) ?? {};
}
