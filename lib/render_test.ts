import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  collectText,
  inlineImages,
  parseFontSpec,
  substitute,
} from "./render.ts";

Deno.test("substitute escapes XML and blanks unknown names", () => {
  assertEquals(
    substitute(`<text>{{a}} & {{ b }} {{c}}</text>`, { a: "<x>", b: '"q"' }),
    `<text>&lt;x&gt; & &quot;q&quot; </text>`,
  );
});

Deno.test("collectText gathers unique text characters", () => {
  const svg = `<svg><metadata id="og">{"x":"zzz"}</metadata><style>.a{}</style>
  <text>10 てん</text><text>&amp;1</text><!-- c --></svg>`;
  assertEquals([...collectText(svg)].sort().join(""), "&01てん");
});

Deno.test("parseFontSpec", () => {
  assertEquals(parseFontSpec("Noto Sans JP:700"), {
    family: "Noto Sans JP",
    weight: 700,
  });
  assertEquals(parseFontSpec("Roboto"), { family: "Roboto", weight: 400 });
});

Deno.test("inlineImages replaces remote hrefs with data URIs", async () => {
  const fakeFetch = ((input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith("/a.png")) {
      return Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        }),
      );
    }
    return Promise.resolve(new Response("nope", { status: 404 }));
  }) as typeof fetch;
  const svg =
    `<svg><image href="https://x.kbn.one/a.png"/><image xlink:href='https://x.kbn.one/missing.png'/></svg>`;
  const out = await inlineImages(svg, fakeFetch);
  assertStringIncludes(out, `href="data:image/png;base64,AQID"`);
  assertStringIncludes(out, `xlink:href='https://x.kbn.one/missing.png'`);
});
