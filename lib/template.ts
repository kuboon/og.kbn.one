/**
 * テンプレの解析。
 *
 * テンプレは次のどちらか:
 *
 * - SVG 単体。`<metadata id="og">` に JSON を埋め込むと設定になる（省略可）。
 * - JSON。`images` に SVG 文字列を複数持てる（縦横比ごとの出し分け用）。
 *
 * どちらも {@link Template} に正規化する。
 */

export interface TemplateImage {
  svg: string;
  width: number;
  height: number;
  /** width / height */
  ratio: number;
}

export interface TemplateConfig {
  /** 画像描画に使う変数とデフォルト値。 */
  vars?: Record<string, string>;
  /** Google Fonts のファミリ名。`Noto Sans JP:700` のように weight を付けられる。 */
  fonts?: string[];
  /** 遷移先 URL のパターン。`{{name}}` はクエリ値で置換される。 */
  url?: string;
  /** og:title などのパターン。 */
  og?: Record<string, string>;
}

export interface Template extends TemplateConfig {
  vars: Record<string, string>;
  fonts: string[];
  og: Record<string, string>;
  images: TemplateImage[];
}

export class TemplateParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateParseError";
  }
}

export const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

export function placeholderNames(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) names.add(m[1]);
  return [...names];
}

/** テンプレ本文（SVG または JSON）を解析する。 */
export function parseTemplate(text: string): Template {
  const body = text.replace(/^\uFEFF/, "").trimStart();
  if (body.startsWith("{")) return fromJson(body);
  if (body.startsWith("<")) return fromSvg(body);
  throw new TemplateParseError("template must be SVG or JSON");
}

function fromJson(body: string): Template {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch (e) {
    throw new TemplateParseError(`invalid JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== "object") {
    throw new TemplateParseError("template JSON must be an object");
  }
  const obj = raw as Record<string, unknown>;
  const svgs: string[] = [];
  if (typeof obj.image === "string") svgs.push(obj.image);
  if (Array.isArray(obj.images)) {
    for (const s of obj.images) {
      if (typeof s !== "string") {
        throw new TemplateParseError("images must be SVG strings");
      }
      svgs.push(s);
    }
  }
  if (svgs.length === 0) {
    throw new TemplateParseError("template JSON has no image / images");
  }
  return normalize(obj as TemplateConfig, svgs.map(parseSvgImage));
}

function fromSvg(body: string): Template {
  const image = parseSvgImage(body);
  const meta = extractMetadata(body);
  return normalize(meta, [image]);
}

const METADATA_RE =
  /<metadata\b[^>]*\bid\s*=\s*["']og["'][^>]*>([\s\S]*?)<\/metadata>/i;

/** `<metadata id="og">` の中身を JSON として読む。無ければ空設定。 */
export function extractMetadata(svg: string): TemplateConfig {
  const m = svg.match(METADATA_RE);
  if (!m) return {};
  let inner = m[1].trim();
  const cdata = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  inner = cdata ? cdata[1] : decodeXmlEntities(inner);
  if (!inner.trim()) return {};
  try {
    const parsed = JSON.parse(inner);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    return parsed as TemplateConfig;
  } catch (e) {
    throw new TemplateParseError(
      `invalid JSON in <metadata id="og">: ${(e as Error).message}`,
    );
  }
}

export function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, h) => String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

/** SVG ルート要素から幅と高さを読む。`width`/`height` が無ければ `viewBox`。 */
export function parseSvgImage(svg: string): TemplateImage {
  const root = svg.match(/<svg\b([^>]*)>/i);
  if (!root) throw new TemplateParseError("no <svg> root element");
  const attrs = root[1];
  const attr = (name: string) => {
    const m = attrs.match(
      new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"),
    );
    return m ? m[1].trim() : undefined;
  };
  const num = (v: string | undefined) => {
    if (v === undefined) return undefined;
    const m = v.match(/^([\d.]+)(px)?$/);
    return m ? parseFloat(m[1]) : undefined;
  };
  let width = num(attr("width"));
  let height = num(attr("height"));
  if (width === undefined || height === undefined) {
    const vb = attr("viewBox")?.split(/[\s,]+/).map(Number);
    if (vb && vb.length === 4 && vb.every((n) => Number.isFinite(n))) {
      width ??= vb[2];
      height ??= vb[3];
    }
  }
  if (!width || !height || width <= 0 || height <= 0) {
    throw new TemplateParseError(
      "svg root needs width/height (or viewBox) to know its size",
    );
  }
  return { svg, width, height, ratio: width / height };
}

function normalize(cfg: TemplateConfig, images: TemplateImage[]): Template {
  const vars: Record<string, string> = {};
  if (cfg.vars && typeof cfg.vars === "object") {
    for (const [k, v] of Object.entries(cfg.vars)) vars[k] = String(v ?? "");
  }
  // SVG 内のプレースホルダは宣言が無くても画像用変数として扱う。
  // 設定を埋め込んだ <metadata> は描画に関係ないので除外する。
  for (const img of images) {
    const drawn = img.svg.replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "");
    for (const name of placeholderNames(drawn)) vars[name] ??= "";
  }
  const fonts = Array.isArray(cfg.fonts)
    ? cfg.fonts.map(String).filter(Boolean)
    : [];
  const og: Record<string, string> = {};
  if (cfg.og && typeof cfg.og === "object") {
    for (const [k, v] of Object.entries(cfg.og)) og[k] = String(v ?? "");
  }
  return {
    vars,
    fonts,
    url: typeof cfg.url === "string" ? cfg.url : undefined,
    og,
    images,
  };
}
