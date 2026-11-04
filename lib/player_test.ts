import { assertEquals } from "@std/assert";
import {
  ancestorsAllowX,
  fetchPlayer,
  frameChecks,
  imageCheck,
  sizeCheck,
} from "./player.ts";

const img = (width: number, height: number) => ({
  svg: "",
  width,
  height,
  ratio: width / height,
});

Deno.test("ancestorsAllowX accepts x.com and twitter.com in any spelling", () => {
  assertEquals(ancestorsAllowX(["'self'", "https://x.com"]), true);
  assertEquals(ancestorsAllowX(["https://*.twitter.com"]), true);
  assertEquals(ancestorsAllowX(["*"]), true);
  assertEquals(ancestorsAllowX(["'self'"]), false);
  assertEquals(ancestorsAllowX(["'none'"]), false);
  assertEquals(ancestorsAllowX(["https://example.com"]), false);
});

Deno.test("frameChecks flags the headers that block X", () => {
  const ok = frameChecks({
    status: 200,
    headers: new Headers(),
    html: `<meta name="robots" content="noindex">`,
  });
  assertEquals(ok.map((c) => c.level), ["ok", "ok", "ok", "ok"]);

  const bad = frameChecks({
    status: 200,
    headers: new Headers({
      "x-frame-options": "DENY",
      "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
    }),
    html: "",
  });
  assertEquals(bad.map((c) => c.level), ["ok", "ng", "ng", "info"]);

  const redirect = frameChecks({
    status: 301,
    headers: new Headers(),
    html: "",
  });
  assertEquals(redirect[0].level, "ng");
});

Deno.test("imageCheck wants a square of enough pixels", () => {
  assertEquals(imageCheck(img(1200, 1200)).level, "ok");
  assertEquals(imageCheck(img(1200, 630)).level, "ng");
  assertEquals(imageCheck(img(200, 200)).level, "ng");
});

Deno.test("sizeCheck prefers 480 square", () => {
  assertEquals(
    sizeCheck({ url: "https://a.kbn.one/p", width: 480, height: 480 }).level,
    "ok",
  );
  assertEquals(
    sizeCheck({ url: "https://a.kbn.one/p", width: 800, height: 600 }).level,
    "warn",
  );
});

Deno.test("fetchPlayer does not follow redirects and caps the body", async () => {
  let seen: RequestInit | undefined;
  const fake: typeof fetch = (_input, init) => {
    seen = init;
    return Promise.resolve(
      new Response("x".repeat(300_000), {
        status: 200,
        headers: { "x-frame-options": "DENY" },
      }),
    );
  };
  const res = await fetchPlayer("https://a.kbn.one/p", fake);
  assertEquals(seen?.redirect, "manual");
  assertEquals(res.html.length, 256 * 1024);
  assertEquals(res.headers.get("x-frame-options"), "DENY");
});
