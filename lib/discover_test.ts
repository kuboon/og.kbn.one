import { assertEquals } from "@std/assert";
import { discoverPage, ogImageToParams, parseMetaTags } from "./discover.ts";

Deno.test("parseMetaTags reads property/name in any attribute order", () => {
  const html = `<html><head>
    <meta charset="utf-8" />
    <meta content="テトラ道" property="og:title">
    <meta property='og:image' content='https://og.kbn.one/img?tmpl=g.kbn.one/og.svg&amp;score=0'/>
    <meta name="twitter:card" content="summary_large_image">
    <meta property="og:title" content="dup ignored">
  </head></html>`;
  const m = parseMetaTags(html);
  assertEquals(m["og:title"], "テトラ道");
  assertEquals(
    m["og:image"],
    "https://og.kbn.one/img?tmpl=g.kbn.one/og.svg&score=0",
  );
  assertEquals(m["twitter:card"], "summary_large_image");
});

Deno.test("ogImageToParams accepts /img and /share with tmpl only", () => {
  assertEquals(
    ogImageToParams(
      "https://og.kbn.one/img?tmpl=g.kbn.one/og.svg&score=0",
      "https://x/",
    )?.get("tmpl"),
    "g.kbn.one/og.svg",
  );
  assertEquals(
    ogImageToParams("/share?tmpl=g.kbn.one/og.svg", "https://og.kbn.one/")?.get(
      "tmpl",
    ),
    "g.kbn.one/og.svg",
  );
  assertEquals(
    ogImageToParams("https://g.kbn.one/og/tetra-do.png", "https://x/"),
    null,
  );
  assertEquals(
    ogImageToParams("https://og.kbn.one/img?score=1", "https://x/"),
    null,
  );
});

Deno.test("discoverPage distinguishes html from templates", async () => {
  const fakeFetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/page")) {
      return Promise.resolve(
        new Response(
          `<!doctype html><html><head><meta property="og:image" content="/img?tmpl=g.kbn.one/og.svg&score=3"></head></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      );
    }
    return Promise.resolve(
      new Response(`<svg width="1" height="1"/>`, {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
  }) as typeof fetch;
  const page = await discoverPage(
    new URL("https://og.kbn.one/page"),
    fakeFetch,
  );
  assertEquals(page.kind, "html");
  if (page.kind === "html") {
    assertEquals(
      page.page.ogImage,
      "https://og.kbn.one/img?tmpl=g.kbn.one/og.svg&score=3",
    );
    assertEquals(page.page.ogImageParams?.get("score"), "3");
  }
  const svg = await discoverPage(
    new URL("https://g.kbn.one/og.svg"),
    fakeFetch,
  );
  assertEquals(svg.kind, "other");
});
