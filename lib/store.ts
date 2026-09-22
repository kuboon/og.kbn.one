/**
 * テンプレの取得とキャッシュ。
 *
 * - メモリ（アイソレート内）と Deno KV の二層。
 * - 取得から 1 時間は再検証しない。超えたら `If-None-Match` /
 *   `If-Modified-Since` 付きの条件付き GET で再検証し、304 なら取得時刻だけ更新。
 * - 再検証や再取得に失敗した場合は、手元にある古いテンプレを使い続ける。
 * - KV の値は 64KiB 上限なので本文はチャンクに分けて保存する。
 */
import { tmplRefToUrl } from "./allowlist.ts";
import { parseTemplate, type Template } from "./template.ts";

export const TEMPLATE_TTL_MS = 60 * 60 * 1000;
export const MAX_TEMPLATE_BYTES = 1024 * 1024;
const CHUNK_BYTES = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

interface StoredMeta {
  ver: string;
  chunks: number;
  size: number;
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
  kv?: Deno.Kv | null;
  fetch?: typeof fetch;
  now?: () => number;
  ttlMs?: number;
}

export class TemplateStore {
  #memory = new Map<string, CachedTemplate>();
  #inflight = new Map<string, Promise<CachedTemplate>>();
  #kv: Deno.Kv | null;
  #fetch: typeof fetch;
  #now: () => number;
  #ttl: number;

  constructor(opts: TemplateStoreOptions = {}) {
    this.#kv = opts.kv ?? null;
    this.#fetch = opts.fetch ?? fetch;
    this.#now = opts.now ?? Date.now;
    this.#ttl = opts.ttlMs ?? TEMPLATE_TTL_MS;
  }

  /** `tmpl` クエリ値からテンプレを取得する。ホワイトリスト検査を含む。 */
  async get(ref: string): Promise<CachedTemplate> {
    const url = tmplRefToUrl(ref);
    const key = url.host + url.pathname + url.search;
    const running = this.#inflight.get(key);
    if (running) return await running;
    const p = this.#resolve(key, url).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, p);
    return await p;
  }

  async #resolve(key: string, url: URL): Promise<CachedTemplate> {
    let cached = this.#memory.get(key) ?? null;
    if (!cached) {
      cached = await this.#readKv(key, url);
      if (cached) this.#memory.set(key, cached);
    }
    if (cached && this.#now() - cached.fetchedAt < this.#ttl) return cached;
    return await this.#revalidate(key, url, cached);
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
    if (res.url && finalHost !== url.hostname) {
      const { isAllowedHost } = await import("./allowlist.ts");
      if (!isAllowedHost(finalHost)) {
        await res.body?.cancel();
        throw new TemplateFetchError(
          `template redirected to a host that is not allowed: ${finalHost}`,
          403,
        );
      }
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
    await this.#writeKv(key, entry, bytes).catch((e) =>
      console.error("kv write failed", key, e)
    );
    return entry;
  }

  async #touch(key: string, entry: CachedTemplate): Promise<CachedTemplate> {
    const touched = { ...entry, fetchedAt: this.#now() };
    this.#memory.set(key, touched);
    if (this.#kv) {
      const metaKey = ["tmpl", key];
      const cur = await this.#kv.get<StoredMeta>(metaKey);
      if (cur.value) {
        await this.#kv.set(metaKey, {
          ...cur.value,
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
      const meta = (await this.#kv.get<StoredMeta>(["tmpl", key])).value;
      if (!meta) return null;
      const parts: Uint8Array[] = [];
      for (let i = 0; i < meta.chunks; i += 10) {
        const keys = [];
        for (let j = i; j < Math.min(i + 10, meta.chunks); j++) {
          keys.push(["tmplbody", key, meta.ver, j]);
        }
        const got = await this.#kv.getMany<Uint8Array[]>(keys);
        for (const g of got) {
          if (!g.value) return null; // 欠損: 取り直す
          parts.push(g.value);
        }
      }
      const bytes = concat(parts, meta.size);
      const text = new TextDecoder().decode(bytes);
      return {
        key,
        url: url.href,
        template: parseTemplate(text),
        text,
        etag: meta.etag,
        lastModified: meta.lastModified,
        fetchedAt: meta.fetchedAt,
        version: await versionOf(meta.etag, bytes),
      };
    } catch (e) {
      console.error("kv read failed", key, e);
      return null;
    }
  }

  async #writeKv(key: string, entry: CachedTemplate, bytes: Uint8Array) {
    if (!this.#kv) return;
    const ver = crypto.randomUUID();
    const chunks = Math.ceil(bytes.byteLength / CHUNK_BYTES);
    // 本文チャンクを先に書き、最後にメタを差し替える。
    for (let i = 0; i < chunks; i += 10) {
      const op = this.#kv.atomic();
      for (let j = i; j < Math.min(i + 10, chunks); j++) {
        op.set(
          ["tmplbody", key, ver, j],
          bytes.subarray(j * CHUNK_BYTES, (j + 1) * CHUNK_BYTES),
        );
      }
      const r = await op.commit();
      if (!r.ok) throw new Error("kv chunk commit failed");
    }
    const metaKey = ["tmpl", key];
    const prev = (await this.#kv.get<StoredMeta>(metaKey)).value;
    const meta: StoredMeta = {
      ver,
      chunks,
      size: bytes.byteLength,
      etag: entry.etag,
      lastModified: entry.lastModified,
      fetchedAt: entry.fetchedAt,
    };
    await this.#kv.set(metaKey, meta);
    if (prev && prev.ver !== ver) {
      for (let j = 0; j < prev.chunks; j++) {
        await this.#kv.delete(["tmplbody", key, prev.ver, j]);
      }
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
  const parts: Uint8Array[] = [];
  let total = 0;
  if (!res.body) return new Uint8Array();
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > limit) {
      await res.body.cancel().catch(() => {});
      return null;
    }
    parts.push(chunk);
  }
  return concat(parts, total);
}

function concat(parts: Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size);
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

/** 本番用のストア。Deno Deploy 上では Deno KV、ローカルではメモリ KV を使う。 */
export async function getTemplateStore(): Promise<TemplateStore> {
  if (defaultStore) return defaultStore;
  const kvPath = Deno.env.get("KV_PATH") ??
    (Deno.env.get("DENO_DEPLOYMENT_ID") ? undefined : ":memory:");
  let kv: Deno.Kv | null = null;
  try {
    kv = await Deno.openKv(kvPath);
  } catch (e) {
    console.error("Deno KV unavailable, using memory only:", e);
  }
  defaultStore = new TemplateStore({ kv });
  return defaultStore;
}
