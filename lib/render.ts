/**
 * SVG への変数埋め込みと PNG 描画。
 *
 * - `{{name}}` を XML エスケープした値で置換する。
 * - `<image href="https://…">` は resvg が外部取得しないので、取得して
 *   data URI にインライン化する。
 * - フォントは Google Fonts から、SVG 内の文字だけのサブセットを取得する。
 */
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { decodeXmlEntities, PLACEHOLDER_RE } from "./template.ts";

const FONT_UA =
  "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1";
const MAX_ASSET_BYTES = 2 * 1024 * 1024;
const ASSET_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** `{{name}}` を値で置換する。未知の名前は空文字になる。 */
export function substitute(
  text: string,
  vars: Record<string, string>,
  escape: (s: string) => string = escapeXml,
): string {
  return text.replace(PLACEHOLDER_RE, (_, name) => escape(vars[name] ?? ""));
}

/** SVG のテキストノードの文字を集める（フォントサブセット用）。 */
export function collectText(svg: string): string {
  const withoutMeta = svg
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "")
    .replace(/<(style|script|title|desc)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  const text = decodeXmlEntities(withoutMeta.replace(/<[^>]*>/g, ""));
  return [...new Set([...text.replace(/\s+/g, "")])].join("");
}

export interface FontSpec {
  family: string;
  weight: number;
}

/** `Noto Sans JP:700` → { family: "Noto Sans JP", weight: 700 } */
export function parseFontSpec(spec: string): FontSpec {
  const m = spec.trim().match(/^(.*?)(?::(\d{3}))?$/);
  return {
    family: (m?.[1] ?? spec).trim(),
    weight: m?.[2] ? Number(m[2]) : 400,
  };
}

interface FontEntry {
  data: Uint8Array | null;
  at: number;
}
const fontCache = new Map<string, Promise<FontEntry>>();

async function loadGoogleFont(
  spec: FontSpec,
  text: string,
  fetchFn: typeof fetch,
): Promise<Uint8Array | null> {
  // `+` はスペースの意味なので URLSearchParams を通さず手で組む。
  const family = spec.family.trim().replace(/\s+/g, "+");
  const url =
    `https://fonts.googleapis.com/css2?family=${family}:wght@${spec.weight}` +
    (text ? `&text=${encodeURIComponent(text)}` : "");
  const res = await fetchFn(url, {
    headers: { "user-agent": FONT_UA },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    console.warn(`google fonts responded ${res.status} for ${spec.family}`);
    return null;
  }
  const css = await res.text();
  const m = css.match(/src:\s*url\((.+?)\)\s*format\('(opentype|truetype)'\)/);
  if (!m) {
    console.warn(`google fonts css has no ttf/otf src for ${spec.family}`);
    return null;
  }
  const font = await fetchFn(m[1], {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!font.ok) {
    await font.body?.cancel();
    return null;
  }
  return new Uint8Array(await font.arrayBuffer());
}

/** 指定フォントを、`text` に含まれる文字だけのサブセットで取得する。 */
export async function loadFonts(
  specs: string[],
  text: string,
  fetchFn: typeof fetch = fetch,
): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const raw of specs) {
    const spec = parseFontSpec(raw);
    const key = `${spec.family}|${spec.weight}|${text}`;
    let p = fontCache.get(key);
    const now = Date.now();
    if (!p || (await p).at + ASSET_TTL_MS < now) {
      p = loadGoogleFont(spec, text, fetchFn)
        .catch((e) => {
          console.error("font load failed", raw, e);
          return null;
        })
        .then((data) => ({ data, at: Date.now() }));
      fontCache.set(key, p);
      trimCache(fontCache, 500);
    }
    const { data } = await p;
    if (data) out.push(data);
  }
  return out;
}

const assetCache = new Map<
  string,
  Promise<{ dataUri: string | null; at: number }>
>();

/** `<image href="https://…">` を data URI にインライン化する。 */
export async function inlineImages(
  svg: string,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  const re =
    /(<image\b[^>]*?\b(?:xlink:)?href\s*=\s*)(["'])(https?:\/\/[^"']+)\2/gi;
  const jobs = new Map<string, Promise<string | null>>();
  for (const m of svg.matchAll(re)) {
    const url = decodeXmlEntities(m[3]);
    if (!jobs.has(url)) jobs.set(url, fetchDataUri(url, fetchFn));
  }
  if (jobs.size === 0) return svg;
  const resolved = new Map<string, string | null>();
  for (const [url, p] of jobs) resolved.set(url, await p);
  return svg.replace(re, (whole, pre, q, href) => {
    const uri = resolved.get(decodeXmlEntities(href));
    return uri ? `${pre}${q}${uri}${q}` : whole;
  });
}

function fetchDataUri(
  url: string,
  fetchFn: typeof fetch,
): Promise<string | null> {
  const now = Date.now();
  let p = assetCache.get(url);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetchFn(url, {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return { dataUri: null, at: now };
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > MAX_ASSET_BYTES) return { dataUri: null, at: now };
        const type = res.headers.get("content-type")?.split(";")[0] ||
          guessType(url);
        return { dataUri: `data:${type};base64,${buf.toBase64()}`, at: now };
      } catch (e) {
        console.error("asset fetch failed", url, e);
        return { dataUri: null, at: now };
      }
    })();
    assetCache.set(url, p);
    trimCache(assetCache, 200);
  }
  return p.then((v) => {
    if (v.at + ASSET_TTL_MS < now) {
      assetCache.delete(url);
      return fetchDataUri(url, fetchFn);
    }
    return v.dataUri;
  });
}

function guessType(url: string): string {
  const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
  return ({
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
  } as Record<string, string>)[ext ?? ""] ?? "application/octet-stream";
}

function trimCache(map: Map<string, unknown>, max: number) {
  while (map.size > max) {
    const first = map.keys().next().value;
    if (first === undefined) break;
    map.delete(first);
  }
}

let wasmReady: Promise<void> | undefined;
function ensureWasm(): Promise<void> {
  if (!wasmReady) {
    const url = new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"));
    wasmReady = Deno.readFile(url).then((bytes) => initWasm(bytes));
  }
  return wasmReady;
}

export interface RenderOptions {
  fonts?: string[];
  fetch?: typeof fetch;
}

/** 置換済み SVG を PNG に描画する。 */
export async function renderPng(
  svg: string,
  opts: RenderOptions = {},
): Promise<Uint8Array> {
  const fetchFn = opts.fetch ?? fetch;
  await ensureWasm();
  const [inlined, fontBuffers] = await Promise.all([
    inlineImages(svg, fetchFn),
    loadFonts(opts.fonts ?? [], collectText(svg), fetchFn),
  ]);
  const defaultFontFamily = opts.fonts?.[0]
    ? parseFontSpec(opts.fonts[0]).family
    : undefined;
  const resvg = new Resvg(inlined, {
    font: {
      fontBuffers,
      loadSystemFonts: false,
      defaultFontFamily,
    },
  });
  try {
    const rendered = resvg.render();
    try {
      return rendered.asPng();
    } finally {
      rendered.free();
    }
  } finally {
    resvg.free();
  }
}
