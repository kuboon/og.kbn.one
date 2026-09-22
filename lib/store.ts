/**
 * テンプレの取得とキャッシュ。
 *
 * - メモリ（アイソレート内）と KV の二層。
 * - 取得から 1 時間は再検証しない。超えたら `If-None-Match` /
 *   `If-Modified-Since` 付きの条件付き GET で再検証し、304 なら取得時刻だけ更新。
 * - `waitUntil` が使える環境（Cloudflare Workers）では、期限切れでも手元の
 *   テンプレで即応答し、再検証はバックグラウンドで行う。
 * - 再検証や再取得に失敗した場合は、手元にある古いテンプレを使い続ける。
 */
import { isAllowedHost, tmplRefToUrl } from "./allowlist.ts";
import { type TemplateKv } from "./kv.ts";
import { parseTemplate, type Template } from "./template.ts";

export const TEMPLATE_TTL_MS = 60 * 60 * 1000;
export const MAX_TEMPLATE_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export interface StoredMeta {
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
}

export interface CachedTemplate {
  key: string;
  url: string;
  template: Template;
  text: string;
  etag?: string;
  lastModified?: string;
  fetchedAt: number;
  /** キャッシュキー用の短い識別子（ETag があればそれ、無ければ本文ハッシュ）。 */
  version: string;
}

export class TemplateFetchError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = "TemplateFetchError";
  }
}

export interface TemplateStoreOptions {
  kv?: TemplateKv<StoredMeta> | null;
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}

export interface GetOptions {
  /** 期限切れ時の再検証をバックグラウンドに回す（Workers の `ctx.waitUntil`）。 */
  waitUntil?: (promise: Promise<unknown>) => void;
}

export class TemplateStore {
  #memory = new Map<string, CachedTemplate>();
  #inflight = new Map<string, Promise<CachedTemplate>>();
  #kv: TemplateKv<StoredMeta> | null;
  #fetch: typeof fetch;
  #now: () => number;
  #ttl: number;

  constructor(opts: TemplateStoreOptions = {}) {
    this.#kv = opts.kv ?? null;
    // メソッド呼び出しになると `this` が付いて Workers で Illegal invocation になるので包む。
    const f = opts.fetch ?? fetch;
    this.#fetch = (input, init) => f(input, init);
    this.#now = opts.now ?? Date.now;
    this.#ttl = opts.ttlMs ?? TEMPLATE_TTL_MS;
  }

  /** `tmpl` クエリ値からテンプレを取得する。ホワイトリスト検査を含む。 */
  async get(ref: string, opts: GetOptions = {}): Promise<CachedTemplate> {
    const url = tmplRefToUrl(ref);
    const key = url.host + url.pathname + url.search;

    let cached = this.#memory.get(key) ?? null;
    if (!cached) {
      cached = await this.#readKv(key, url);
      if (cached) this.#memory.set(key, cached);
    }
    if (cached && this.#now() - cached.fetchedAt < this.#ttl) return cached;

    const revalidation = this.#dedupe(
      key,
      () => this.#revalidate(key, url, cached),
    );
    if (cached && opts.waitUntil) {
      // 古いテンプレで即応答し、更新は裏で行う。
      opts.waitUntil(
        revalidation.catch((e) => console.error("revalidate failed", key, e)),
      );
      return cached;
    }
    return await revalidation;
  }

  #dedupe(
    key: string,
    run: () => Promise<CachedTemplate>,
  ): Promise<CachedTemplate> {
    const running = this.#inflight.get(key);
    if (running) return running;
    const p = run().finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, p);
    return p;
  }

  async #revalidate(
    key: string,
    url: URL,
    stale: CachedTemplate | null,
  ): Promise<CachedTemplate> {
    const headers = new Headers({
      accept: "image/svg+xml, application/json, */*",
    });
    if (stale?.etag) headers.set("if-none-match", stale.etag);
    else if (stale?.lastModified) {
      headers.set("if-modified-since", stale.lastModified);
    }
    let res: Response;
    try {
      res = await this.#fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      if (stale) return this.#touch(key, stale);
      throw new TemplateFetchError(
        `failed to fetch template ${url}: ${(e as Error).message}`,
      );
    }
    if (res.status === 304) {
      await res.body?.cancel();
      if (stale) return this.#touch(key, stale);
      // 304 なのに手元に無い（KV が消えた等）。条件無しで取り直す。
      return await this.#revalidate(key, url, null);
    }
    if (!res.ok) {
      await res.body?.cancel();
      if (stale) return this.#touch(key, stale);
      throw new TemplateFetchError(
        `template ${url} responded ${res.status}`,
        res.status === 404 ? 404 : 502,
      );
    }
    // リダイレクト先もホワイトリスト内であること。
    const finalHost = new URL(res.url || url).hostname;
    if (res.url && finalHost !== url.hostname && !isAllowedHost(finalHost)) {
      await res.body?.cancel();
      throw new TemplateFetchError(
        `template redirected to a host that is not allowed: ${finalHost}`,
        403,
      );
    }
    const bytes = await readLimited(res, MAX_TEMPLATE_BYTES);
    if (!bytes) {
      if (stale) return this.#touch(key, stale);
      throw new TemplateFetchError(
        `template ${url} exceeds ${MAX_TEMPLATE_BYTES} bytes`,
      );
    }
    const text = new TextDecoder().decode(bytes);
    let template: Template;
    try {
      template = parseTemplate(text);
    } catch (e) {
      if (stale) return this.#touch(key, stale);
      throw new TemplateFetchError(
        `template ${url} is invalid: ${(e as Error).message}`,
        422,
      );
    }
    const etag = res.headers.get("etag") ?? undefined;
    const lastModified = res.headers.get("last-modified") ?? undefined;
    const entry: CachedTemplate = {
      key,
      url: url.href,
      template,
      text,
      etag,
      lastModified,
      fetchedAt: this.#now(),
      version: await versionOf(etag, bytes),
    };
    this.#memory.set(key, entry);
    await this.#kv?.put(key, bytes, {
      etag,
      lastModified,
      fetchedAt: entry.fetchedAt,
    })
      .catch((e) => console.error("kv write failed", key, e));
    return entry;
  }

  async #touch(key: string, entry: CachedTemplate): Promise<CachedTemplate> {
    const touched = { ...entry, fetchedAt: this.#now() };
    this.#memory.set(key, touched);
    if (this.#kv) {
      const cur = await this.#kv.get(key).catch(() => null);
      if (cur) {
        await this.#kv.put(key, cur.value, {
          ...cur.metadata,
          fetchedAt: touched.fetchedAt,
        })
          .catch((e) => console.error("kv touch failed", key, e));
      }
    }
    return touched;
  }

  async #readKv(key: string, url: URL): Promise<CachedTemplate | null> {
    if (!this.#kv) return null;
    try {
      const entry = await this.#kv.get(key);
      if (!entry) return null;
      const text = new TextDecoder().decode(entry.value);
      return {
        key,
        url: url.href,
        template: parseTemplate(text),
        text,
        etag: entry.metadata.etag,
        lastModified: entry.metadata.lastModified,
        fetchedAt: entry.metadata.fetchedAt,
        version: await versionOf(entry.metadata.etag, entry.value),
      };
    } catch (e) {
      console.error("kv read failed", key, e);
      return null;
    }
  }
}

async function readLimited(
  res: Response,
  limit: number,
): Promise<Uint8Array | null> {
  const len = Number(res.headers.get("content-length"));
  if (Number.isFinite(len) && len > limit) {
    await res.body?.cancel();
    return null;
  }
  if (!res.body) return new Uint8Array();
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > limit) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    parts.push(chunk);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

async function versionOf(
  etag: string | undefined,
  bytes: Uint8Array,
): Promise<string> {
  if (etag) return etag.replace(/^W\//, "").replace(/"/g, "");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return new Uint8Array(digest).subarray(0, 12).toHex();
}

let defaultStore: TemplateStore | undefined;

/**
 * 本番用ストアを設定する。Workers エントリが KV バインディングを渡す。
 * 一度設定したら以降の呼び出しは無視される（アイソレート内で共有）。
 */
export function configureTemplateStore(
  opts: TemplateStoreOptions,
): TemplateStore {
  defaultStore ??= new TemplateStore(opts);
  return defaultStore;
}

/** 設定済みのストア。未設定ならメモリのみ（ローカル開発用）。 */
export function getTemplateStore(): TemplateStore {
  defaultStore ??= new TemplateStore();
  return defaultStore;
}
