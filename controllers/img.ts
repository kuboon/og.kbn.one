/**
 * GET /img?tmpl=host/path&ar=1.91&score=10
 *
 * テンプレから縦横比に合う SVG を選び、変数を埋めて PNG を返す。
 * User-Agent は見ない。`ar` を省略すると 1.91。
 *
 * 描画結果はアイソレート内のメモリと、使える環境では Cache API
 * （Cloudflare Workers の `caches.default`）に置く。
 */
import type { Action } from "@remix-run/fetch-router";
import type { routes } from "../routes.ts";
import { DEFAULT_RATIO, parseRatio } from "../lib/aspect.ts";
import { badRequest, errorResponse } from "../lib/page.ts";
import { renderPng, substitute } from "../lib/render.ts";
import { getRequestScope } from "../lib/scope.ts";
import { imageVars, parseShareParams, pickImage } from "../lib/share.ts";
import { getTemplateStore } from "../lib/store.ts";

const PNG_CACHE_MAX = 100;
const pngCache = new Map<string, Promise<Uint8Array>>();

export const imgAction = {
  async handler(context) {
    const params = parseShareParams(context.url.searchParams);
    if (!params) return badRequest("tmpl is required");
    const { waitUntil } = getRequestScope(context.request);
    try {
      const store = getTemplateStore();
      const cached = await store.get(params.tmpl, { waitUntil });
      const { template } = cached;
      const ratio = parseRatio(params.ratio) ?? DEFAULT_RATIO;
      const image = pickImage(template, ratio);
      const vars = imageVars(template, params.vars);
      const cacheKey = JSON.stringify([
        cached.key,
        cached.version,
        template.images.indexOf(image),
        vars,
      ]);
      const etag = `"${await shortHash(cacheKey)}"`;
      if (context.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }
      const headers = {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
        etag,
        "x-og-image-size": `${image.width}x${image.height}`,
      };
      const edge = edgeCache();
      const edgeKey = new Request(
        new URL(`/img/${etag.replace(/"/g, "")}`, context.url.origin),
      );
      const hit = await edge?.match(edgeKey);
      if (hit) return new Response(hit.body, { headers });

      let job = pngCache.get(cacheKey);
      if (!job) {
        job = renderPng(substitute(image.svg, vars), { fonts: template.fonts });
        pngCache.set(cacheKey, job);
        job.catch(() => pngCache.delete(cacheKey));
        while (pngCache.size > PNG_CACHE_MAX) {
          const first = pngCache.keys().next().value!;
          pngCache.delete(first);
        }
      }
      const png = await job;
      if (edge) {
        const put = edge.put(
          edgeKey,
          new Response(png as Uint8Array<ArrayBuffer>, { headers }),
        );
        if (waitUntil) waitUntil(put);
        else await put.catch(() => {});
      }
      return new Response(png as Uint8Array<ArrayBuffer>, {
        headers: { ...headers, "content-length": String(png.byteLength) },
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies Action<typeof routes.img>;

/** Workers の `caches.default`。Deno には無いので undefined。 */
function edgeCache(): Cache | undefined {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

async function shortHash(s: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(s),
  );
  return new Uint8Array(digest).subarray(0, 16).toHex();
}
