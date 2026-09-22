/**
 * ホスト環境変数へのアクセスを 1 箇所に集約する。
 *
 * Cloudflare Workers は `fetch(request, env, ctx)` の `env` に変数とバインディングを
 * 渡してくる。Deno では `Deno.env`。Workers エントリが {@link setHostEnv} で
 * `env` を登録し、それ以外は {@link getEnvVar} だけを使う。
 */

let hostEnv: Record<string, unknown> | undefined;

export function setHostEnv(env: Record<string, unknown>): void {
  hostEnv = env;
}

export function getEnvVar(name: string): string | undefined {
  const fromHost = hostEnv?.[name];
  if (typeof fromHost === "string") return fromHost;
  const deno = (globalThis as {
    Deno?: { env: { get(key: string): string | undefined } };
  }).Deno;
  return deno?.env.get(name);
}
