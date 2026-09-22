import { assert, assertEquals, assertRejects } from "@std/assert";
import { MemoryTemplateKv } from "./kv.ts";
import { type StoredMeta, TemplateFetchError, TemplateStore } from "./store.ts";

const SVG = `<svg width="1200" height="630"><text>{{score}}</text></svg>`;

function fakeOrigin() {
  const log: { url: string; inm: string | null }[] = [];
  let body = SVG;
  let etag = `"v1"`;
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const inm = new Headers(init?.headers).get("if-none-match");
    log.push({ url, inm });
    if (url.endsWith("/404")) {
      return Promise.resolve(new Response("x", { status: 404 }));
    }
    if (url.endsWith("/bad")) {
      return Promise.resolve(
        new Response("not a template", { headers: { etag } }),
      );
    }
    if (inm === etag) {
      return Promise.resolve(new Response(null, { status: 304 }));
    }
    return Promise.resolve(
      new Response(body, {
        headers: { etag, "content-type": "image/svg+xml" },
      }),
    );
  }) as typeof fetch;
  return {
    fetchFn,
    log,
    update(newBody: string, newEtag: string) {
      body = newBody;
      etag = newEtag;
    },
  };
}

Deno.test("TemplateStore caches, revalidates after TTL, and picks up changes", async () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one");
  const origin = fakeOrigin();
  let now = 1_000_000;
  const kv = new MemoryTemplateKv<StoredMeta>();
  const store = new TemplateStore({
    kv,
    fetch: origin.fetchFn,
    now: () => now,
    ttlMs: 1000,
  });

  const a = await store.get("g.kbn.one/og.svg");
  assertEquals(a.template.vars, { score: "" });
  assertEquals(a.etag, `"v1"`);
  assertEquals(origin.log.length, 1);

  await store.get("g.kbn.one/og.svg");
  assertEquals(origin.log.length, 1, "fresh: no fetch");

  now += 1500;
  const b = await store.get("g.kbn.one/og.svg");
  assertEquals(origin.log.length, 2, "stale: conditional fetch");
  assertEquals(origin.log[1].inm, `"v1"`);
  assertEquals(b.fetchedAt, now, "304 refreshes fetchedAt");
  assertEquals(b.version, a.version);

  origin.update(
    `<svg width="800" height="800"><text>{{score}} {{name}}</text></svg>`,
    `"v2"`,
  );
  now += 1500;
  const c = await store.get("g.kbn.one/og.svg");
  assertEquals(c.etag, `"v2"`);
  assertEquals(c.template.images[0].ratio, 1);
  assertEquals(Object.keys(c.template.vars).sort(), ["name", "score"]);

  // 新しいストア（別アイソレート相当）は KV から復元できる
  const store2 = new TemplateStore({
    kv,
    fetch: origin.fetchFn,
    now: () => now,
    ttlMs: 1000,
  });
  const d = await store2.get("g.kbn.one/og.svg");
  assertEquals(d.etag, `"v2"`);
  assertEquals(origin.log.length, 3, "restored from KV without fetching");
  Deno.env.delete("ALLOWED_HOSTS");
});

Deno.test("TemplateStore keeps stale template when upstream breaks", async () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one");
  const origin = fakeOrigin();
  let now = 0;
  const store = new TemplateStore({
    fetch: origin.fetchFn,
    now: () => now,
    ttlMs: 1000,
  });
  const a = await store.get("g.kbn.one/og.svg");
  origin.update("garbage", `"v3"`);
  now += 2000;
  const b = await store.get("g.kbn.one/og.svg");
  assertEquals(b.etag, a.etag, "invalid new body -> keep stale");
  Deno.env.delete("ALLOWED_HOSTS");
});

Deno.test("TemplateStore errors", async () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one");
  const origin = fakeOrigin();
  const store = new TemplateStore({ fetch: origin.fetchFn });
  const e404 = await assertRejects(
    () => store.get("g.kbn.one/404"),
    TemplateFetchError,
  );
  assertEquals(e404.status, 404);
  const e422 = await assertRejects(
    () => store.get("g.kbn.one/bad"),
    TemplateFetchError,
  );
  assertEquals(e422.status, 422);
  await assertRejects(() => store.get("example.com/og.svg"));
  assert(true);
  Deno.env.delete("ALLOWED_HOSTS");
});

Deno.test("TemplateStore.purge drops memory and KV so the next get refetches unconditionally", async () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one");
  const origin = fakeOrigin();
  const kv = new MemoryTemplateKv<StoredMeta>();
  const store = new TemplateStore({ kv, fetch: origin.fetchFn });
  await store.get("g.kbn.one/og.svg");
  assertEquals(origin.log.length, 1);
  await store.get("g.kbn.one/og.svg");
  assertEquals(origin.log.length, 1, "fresh: cached");
  await store.purge("g.kbn.one/og.svg");
  assertEquals(await kv.get("g.kbn.one/og.svg"), null);
  await store.get("g.kbn.one/og.svg");
  assertEquals(origin.log.length, 2, "purged: refetched");
  assertEquals(origin.log[1].inm, null, "unconditional GET after purge");
  Deno.env.delete("ALLOWED_HOSTS");
});

Deno.test("TemplateStore serves stale and revalidates in background with waitUntil", async () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one");
  const origin = fakeOrigin();
  let now = 0;
  const store = new TemplateStore({
    fetch: origin.fetchFn,
    now: () => now,
    ttlMs: 1000,
  });
  await store.get("g.kbn.one/og.svg");
  origin.update(
    `<svg width="800" height="800"><text>{{score}}</text></svg>`,
    `"v2"`,
  );
  now += 2000;
  const background: Promise<unknown>[] = [];
  const stale = await store.get("g.kbn.one/og.svg", {
    waitUntil: (p) => background.push(p),
  });
  assertEquals(
    stale.etag,
    `"v1"`,
    "responds with the stale template immediately",
  );
  assertEquals(background.length, 1);
  await Promise.all(background);
  const fresh = await store.get("g.kbn.one/og.svg", {
    waitUntil: (p) => background.push(p),
  });
  assertEquals(
    fresh.etag,
    `"v2"`,
    "background revalidation picked up the new version",
  );
  assertEquals(background.length, 1, "fresh entry does not revalidate again");
  Deno.env.delete("ALLOWED_HOSTS");
});
