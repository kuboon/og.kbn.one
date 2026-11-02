/**
 * シェア URL のクエリを解釈し、`/img` の URL・遷移先・OG メタを組み立てる。
 *
 * シェア URL: `/share?tmpl=host/path&score=10&date=…&rec=…`
 * - `tmpl` はテンプレの場所（スキーム無し）。
 * - `ar` は目標縦横比（省略時は UA から決める）。
 * - それ以外はすべて変数。画像用（テンプレの `vars`）は `/img` に渡し、
 *   全部を遷移先 `url` と `og` の `{{name}}` 置換に使う。
 */
import type { Template, TemplateImage, TemplatePlayer } from "./template.ts";
import { formatRatio, selectImage } from "./aspect.ts";
import { substitute } from "./render.ts";

export const RESERVED_PARAMS = new Set(["tmpl", "ar"]);

export interface ShareParams {
  tmpl: string;
  ratio: string | null;
  vars: Record<string, string>;
}

export function parseShareParams(search: URLSearchParams): ShareParams | null {
  const tmpl = search.get("tmpl");
  if (!tmpl) return null;
  const vars: Record<string, string> = {};
  for (const [k, v] of search) {
    if (RESERVED_PARAMS.has(k)) continue;
    if (!(k in vars)) vars[k] = v; // 同名が複数あれば最初のもの
  }
  return { tmpl, ratio: search.get("ar"), vars };
}

/** 画像用変数だけを、テンプレのデフォルトで補完して返す（キー順は固定）。 */
export function imageVars(
  template: Template,
  vars: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(template.vars).sort()) {
    const v = vars[name];
    out[name] = v === undefined || v === "" ? template.vars[name] : v;
  }
  return out;
}

export function buildImgUrl(
  origin: string,
  tmpl: string,
  template: Template,
  vars: Record<string, string>,
  ratio: number,
): URL {
  const url = new URL("/img", origin);
  url.searchParams.set("tmpl", tmpl);
  url.searchParams.set("ar", formatRatio(ratio));
  for (const [k, v] of Object.entries(imageVars(template, vars))) {
    url.searchParams.set(k, v);
  }
  return url;
}

/** テンプレの `url` パターンに変数を埋めて遷移先を作る。 */
export function buildDestination(
  template: Template,
  vars: Record<string, string>,
): string | null {
  if (!template.url) return null;
  const merged = { ...template.vars, ...vars };
  return substitute(template.url, merged, encodeURIComponent);
}

export function buildOgFields(
  template: Template,
  vars: Record<string, string>,
): Record<string, string> {
  const merged = { ...template.vars, ...vars };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template.og)) {
    out[k] = substitute(v, merged, (s) => s);
  }
  return out;
}

/**
 * Player Card に出すページを組み立てる。
 *
 * テンプレの `player.url` に変数を埋める。https で、テンプレと同じホストのものだけを採用する
 * （テンプレの持ち主が自分のサイトのページを iframe に出すための機能で、他所のページを
 * og.kbn.one のカードから埋め込ませないため）。
 */
export function buildPlayer(
  template: Template,
  vars: Record<string, string>,
  tmpl: string,
): TemplatePlayer | null {
  if (!template.player) return null;
  const merged = { ...template.vars, ...vars };
  const filled = substitute(template.player.url, merged, encodeURIComponent);
  let url: URL;
  try {
    url = new URL(filled);
  } catch {
    return null;
  }
  const host = tmpl.split("/")[0].toLowerCase();
  if (url.protocol !== "https:" || url.host.toLowerCase() !== host) return null;
  return { ...template.player, url: url.href };
}

export function pickImage(template: Template, ratio: number): TemplateImage {
  return selectImage(template.images, ratio);
}

export function twitterCard(
  image: TemplateImage,
  player?: TemplatePlayer | null,
): "summary" | "summary_large_image" | "player" {
  if (player) return "player";
  return Math.abs(Math.log(image.ratio)) < Math.log(1.3)
    ? "summary"
    : "summary_large_image";
}
