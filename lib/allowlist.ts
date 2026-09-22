/**
 * テンプレ取得先ホストのホワイトリスト。
 *
 * 既定は `*.kbn.one` と `kuboon.github.io`。環境変数 `ALLOWED_HOSTS`
 * （カンマ区切り）で上書きできる。`*.example.com` は 1 段以上のサブドメインに
 * マッチし、`example.com` 自身にはマッチしない。
 */

export const DEFAULT_ALLOWED_HOSTS = ["*.kbn.one", "kuboon.github.io"];

export function allowedHostPatterns(): string[] {
  const env = Deno.env.get("ALLOWED_HOSTS");
  if (!env) return DEFAULT_ALLOWED_HOSTS;
  return env.split(",").map((s) => s.trim()).filter(Boolean);
}

export function isAllowedHost(
  host: string,
  patterns: string[] = allowedHostPatterns(),
): boolean {
  const h = host.toLowerCase();
  return patterns.some((p) => {
    const pat = p.toLowerCase();
    if (pat.startsWith("*.")) {
      const suffix = pat.slice(1); // ".kbn.one"
      return h.endsWith(suffix) && h.length > suffix.length;
    }
    return h === pat;
  });
}

/** `tmpl` クエリの値（`host/path` 形式）を絶対 URL に変換する。 */
export function tmplRefToUrl(ref: string): URL {
  const trimmed = ref.trim().replace(/^https?:\/\//, "");
  if (!trimmed) throw new TemplateRefError("tmpl is empty");
  const [hostPort] = trimmed.split(/[/?#]/, 1);
  const host = hostPort.split(":")[0];
  if (!host) throw new TemplateRefError("tmpl has no host");
  const isLocal = host === "localhost" || host === "127.0.0.1";
  const url = new URL(`${isLocal ? "http" : "https"}://${trimmed}`);
  if (!isAllowedHost(url.hostname)) {
    throw new TemplateRefError(`host not allowed: ${url.hostname}`, 403);
  }
  return url;
}

export class TemplateRefError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "TemplateRefError";
  }
}
