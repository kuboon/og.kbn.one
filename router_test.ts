import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import router from "./router.ts";

const WIDE = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
<metadata id="og"><![CDATA[{"vars":{"score":"0"},"url":"https://g.kbn.one/play?date={{date}}&rec={{rec}}","og":{"title":"{{date}} で {{score}} 点","description":"desc"}}]]></metadata>
<rect width="1200" height="630" fill="#f2d4ef"/><text>{{score}}</text></svg>`;
const SQUARE =
  `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#eee"/><text>{{score}}</text></svg>`;

function withOrigin(fn: (base: string) => Promise<void>) {
  return async () => {
    const server = Deno.serve(
      { hostname: "127.0.0.1", port: 0, onListen() {} },
      (req) => {
        const path = new URL(req.url).pathname;
        if (path === "/og.svg") {
          return new Response(WIDE, {
            headers: { "content-type": "image/svg+xml", etag: `"w1"` },
          });
        }
        if (path === "/og.json") {
          return Response.json({
            vars: { score: "0" },
            url: "https://g.kbn.one/?rec={{rec}}",
            images: [WIDE, SQUARE],
          });
        }
        return new Response("nf", { status: 404 });
      },
    );
    const base = `127.0.0.1:${server.addr.port}`;
    Deno.env.set("ALLOWED_HOSTS", "*.kbn.one,127.0.0.1");
    try {
      await fn(base);
    } finally {
      Deno.env.delete("ALLOWED_HOSTS");
      await server.shutdown();
    }
  };
}

Deno.test("GET / serves docs", async () => {
  const res = await router.fetch(new Request("http://og.test/"));
  assertEquals(res.status, 200);
  assertStringIncludes(await res.text(), "og:image");
});

Deno.test(
  "GET /share renders OG meta, image URL without rec, and JS redirect",
  withOrigin(async (base) => {
    const rec =
      "hZXBjtMwEIYzv-M4DVWB1aoFCYk0TlK3aYvEZeHmExcOcNkj4sIbcOEZ4Bk48QBc4eFW";
    const res = await router.fetch(
      new Request(
        `http://og.test/share?date=2026-09-22&rec=${rec}&tmpl=${base}/og.svg&score=10`,
        {
          headers: { "user-agent": "Twitterbot/1.0" },
        },
      ),
    );
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(
      html,
      `<meta property="og:title" content="2026-09-22 で 10 点">`,
    );
    assertStringIncludes(
      html,
      `<meta property="og:description" content="desc">`,
    );
    assertStringIncludes(
      html,
      `<meta property="og:image" content="http://og.test/img?tmpl=127.0.0.1%3A`,
    );
    assertStringIncludes(html, `&amp;ar=2&amp;score=10">`);
    assert(
      !html.includes(
        `og:image" content="http://og.test/img?${"tmpl"}=${base}/og.svg&amp;ar=2&amp;rec`,
      ),
    );
    assertStringIncludes(
      html,
      `<meta property="og:image:width" content="1200">`,
    );
    assertStringIncludes(
      html,
      `<meta name="twitter:card" content="summary_large_image">`,
    );
    assertStringIncludes(
      html,
      `<meta property="og:url" content="http://og.test/share?date=2026-09-22&amp;rec=${rec}&amp;tmpl=`,
    );
    const dest = `https://g.kbn.one/play?date=2026-09-22&rec=${rec}`;
    assertStringIncludes(html, `<a href="${dest.replace(/&/g, "&amp;")}">`);
    assertStringIncludes(html, `location.replace("${dest}")`);
  }),
);

Deno.test(
  "GET /share picks the square image for square crawlers",
  withOrigin(async (base) => {
    const res = await router.fetch(
      new Request(`http://og.test/share?tmpl=${base}/og.json&score=3&rec=r`, {
        headers: { "user-agent": "WhatsApp/2.0" },
      }),
    );
    const html = await res.text();
    assertStringIncludes(
      html,
      `<meta property="og:image:width" content="800">`,
    );
    assertStringIncludes(html, `<meta name="twitter:card" content="summary">`);
    assertStringIncludes(html, `ar=1&amp;score=3`);

    const res2 = await router.fetch(
      new Request(`http://og.test/share?tmpl=${base}/og.json&score=3`, {
        headers: { "user-agent": "facebookexternalhit/1.1" },
      }),
    );
    assertStringIncludes(
      await res2.text(),
      `<meta property="og:image:width" content="1200">`,
    );
  }),
);

Deno.test(
  "GET /img renders a PNG of the selected image and honours ETag",
  withOrigin(async (base) => {
    const res = await router.fetch(
      new Request(`http://og.test/img?tmpl=${base}/og.json&ar=1&score=7`),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "image/png");
    assertEquals(res.headers.get("x-og-image-size"), "800x800");
    const png = new Uint8Array(await res.arrayBuffer());
    assertEquals([...png.subarray(0, 8)], [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
    ]);
    const etag = res.headers.get("etag")!;
    assert(etag);
    const res304 = await router.fetch(
      new Request(`http://og.test/img?tmpl=${base}/og.json&ar=1&score=7`, {
        headers: { "if-none-match": etag },
      }),
    );
    assertEquals(res304.status, 304);

    const wide = await router.fetch(
      new Request(`http://og.test/img?tmpl=${base}/og.json&score=7`),
    );
    assertEquals(wide.headers.get("x-og-image-size"), "1200x630");
    await wide.body?.cancel();
  }),
);

Deno.test(
  "GET /img rejects hosts outside the allowlist and missing tmpl",
  withOrigin(async () => {
    const res = await router.fetch(
      new Request(`http://og.test/img?tmpl=example.com/og.svg`),
    );
    assertEquals(res.status, 403);
    await res.body?.cancel();
    const res2 = await router.fetch(new Request(`http://og.test/img`));
    assertEquals(res2.status, 400);
    await res2.body?.cancel();
    const res3 = await router.fetch(
      new Request(`http://og.test/share?tmpl=nothing.kbn.one/og.svg`),
    );
    assert(res3.status === 502 || res3.status === 404, `got ${res3.status}`);
    await res3.body?.cancel();
  }),
);

Deno.test(
  "GET /preview shows selection table and inline SVGs",
  withOrigin(async (base) => {
    const share = `http://og.test/share?tmpl=${base}/og.json&score=42&rec=abc`;
    const res = await router.fetch(
      new Request(`http://og.test/preview?url=${encodeURIComponent(share)}`),
    );
    assertEquals(res.status, 200);
    const html = await res.text();
    assertStringIncludes(html, "画像 (2)");
    assertStringIncludes(html, "<text>42</text>");
    assertStringIncludes(html, "X (Twitter)");
    assertStringIncludes(html, "https://g.kbn.one/?rec=abc");
    const empty = await router.fetch(new Request(`http://og.test/preview`));
    assertEquals(empty.status, 200);
    assertStringIncludes(await empty.text(), "<form");
  }),
);
