/**
 * Cloudflare Workers エントリ。
 *
 * wasm はバンドラ（wrangler）が `WebAssembly.Module` として import する。
 * Deno はこの import を型チェックできないので、このファイルだけ deno.json の
 * `exclude` に入れてある。ロジックはすべて router.ts 以下にあり、そちらは
 * Deno で型チェック・テストする。
 */
import type { ExecutionContext, KVNamespace } from "@cloudflare/workers-types";
import wasm from "@resvg/resvg-wasm/index_bg.wasm";
import router from "./router.ts";
import { setHostEnv } from "./lib/config.ts";
import { CloudflareTemplateKv } from "./lib/kv.ts";
import { setResvgWasm } from "./lib/render.ts";
import { setRequestScope } from "./lib/scope.ts";
import { configureTemplateStore } from "./lib/store.ts";

interface Env {
  TEMPLATES: KVNamespace;
  ALLOWED_HOSTS?: string;
}

setResvgWasm(wasm);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    setHostEnv(env as unknown as Record<string, unknown>);
    configureTemplateStore({ kv: new CloudflareTemplateKv(env.TEMPLATES) });
    setRequestScope(request, { waitUntil: (p) => ctx.waitUntil(p) });
    return router.fetch(request);
  },
};
