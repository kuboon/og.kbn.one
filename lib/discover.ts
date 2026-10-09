/**
 * ページの HTML から OG メタを読み取り、og:image が og.kbn.one の画像 URL
 * （`/img?tmpl=…` または `/share?tmpl=…`）ならテンプレと変数を取り出す。
 *
 * ゲームのページ URL を /preview に貼ったときに使う。
 */
import { decodeXmlEntities } from "./template.ts";

const MAX_HTML_BYTES = 512 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export interface PageMeta {
  /** `property` または `name` → `content`。最初に出てきたものを採用。 */
  meta: Record<string, string>;
  /** og:image から取り出した og.kbn.one 向けのクエリ。無ければ null。 */
  ogImageParams: URLSearchParams | null;
  /** og:image の値そのもの（絶対 URL に解決済み）。 */
  ogImage: string | null;
}

export type DiscoverResult =
  | { kind: "html"; page: PageMeta }
  | { kind: "other"; contentType: string };

/** `<meta property="og:image" content="…">` 形式を順不同の属性で読む。 */
export function parseMetaTags(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const head = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const m of head.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = m[1];
    const get = (name: string) => {
      const a = attrs.match(
        new RegExp(
          `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
          "i",
        ),
      );
      return a ? decodeXmlEntities(a[1] ?? a[2] ?? a[3] ?? "") : undefined;
    };
    const key = get("property") ?? get("name");
    const content = get("content");
    if (!key || content === undefined) continue;
    const k = key.trim().toLowerCase();
    if (!(k in out)) out[k] = content.trim();
  }
  return out;
}

/** og.kbn.one の `/img` か `/share` で `tmpl` を持つ URL ならそのクエリを返す。 */
export function ogImageToParams(
  image: string,
  base: string,
): URLSearchParams | null {
  let url: URL;
  try {
    url = new URL(image, base);
  } catch {
    return null;
  }
  if (!/^\/(img|share)\/?$/.test(url.pathname)) return null;
  if (!url.searchParams.has("tmpl")) return null;
  return url.searchParams;
}

/**
 * URL を取得して HTML なら OG メタを読む。HTML でなければ `other` を返す
 * （SVG や JSON のテンプレがこれに当たる）。
 */
export async function discoverPage(
  url: URL,
  fetchFn: typeof fetch = fetch,
): Promise<DiscoverResult> {
  const res = await fetchFn(url, {
    headers: { accept: "text/html, image/svg+xml, application/json, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${url} responded ${res.status}`);
  }
  const text = await readText(res, MAX_HTML_BYTES);
  const looksHtml = /text\/html/i.test(contentType) ||
    /^\s*(<!doctype\s+html|<html)/i.test(text);
  if (!looksHtml) return { kind: "other", contentType };
  const meta = parseMetaTags(text);
  const ogImage = meta["og:image"] ?? meta["og:image:url"] ??
    meta["twitter:image"] ?? null;
  const resolved = ogImage ? safeResolve(ogImage, res.url || url.href) : null;
  return {
    kind: "html",
    page: {
      meta,
      ogImage: resolved,
      ogImageParams: resolved
        ? ogImageToParams(resolved, res.url || url.href)
        : null,
    },
  };
}

function safeResolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

async function readText(res: Response, limit: number): Promise<string> {
  if (!res.body) return "";
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    parts.push(chunk);
    total += chunk.byteLength;
    if (total >= limit) {
      await res.body.cancel().catch(() => {});
      break;
    }
  }
  const buf = new Uint8Array(Math.min(total, limit));
  let off = 0;
  for (const p of parts) {
    const n = Math.min(p.byteLength, buf.byteLength - off);
    buf.set(p.subarray(0, n), off);
    off += n;
    if (off >= buf.byteLength) break;
  }
  return new TextDecoder().decode(buf);
}
