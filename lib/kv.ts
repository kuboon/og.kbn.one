/**
 * テンプレ本文とメタデータを保存する KV の抽象。
 *
 * Cloudflare Workers では KV バインディング（値 25MB まで、メタデータ 1KB まで）、
 * ローカルとテストではメモリ実装を使う。
 */
import type { KVNamespace } from "@cloudflare/workers-types";

export interface KvEntry<M> {
  value: Uint8Array;
  metadata: M;
}

export interface TemplateKv<M = Record<string, unknown>> {
  get(key: string): Promise<KvEntry<M> | null>;
  put(key: string, value: Uint8Array, metadata: M): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryTemplateKv<M = Record<string, unknown>>
  implements TemplateKv<M> {
  #map = new Map<string, KvEntry<M>>();
  get(key: string): Promise<KvEntry<M> | null> {
    return Promise.resolve(this.#map.get(key) ?? null);
  }
  put(key: string, value: Uint8Array, metadata: M): Promise<void> {
    this.#map.set(key, { value, metadata });
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.#map.delete(key);
    return Promise.resolve();
  }
}

export class CloudflareTemplateKv<M = Record<string, unknown>>
  implements TemplateKv<M> {
  constructor(private ns: KVNamespace) {}
  async get(key: string): Promise<KvEntry<M> | null> {
    const r = await this.ns.getWithMetadata<M>(key, "arrayBuffer");
    if (!r.value || !r.metadata) return null;
    return { value: new Uint8Array(r.value), metadata: r.metadata };
  }
  async put(key: string, value: Uint8Array, metadata: M): Promise<void> {
    await this.ns.put(key, value as Uint8Array<ArrayBuffer>, { metadata });
  }
  async delete(key: string): Promise<void> {
    await this.ns.delete(key);
  }
}
