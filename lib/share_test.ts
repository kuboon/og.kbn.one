import { assertEquals } from "@std/assert";
import { parseTemplate } from "./template.ts";
import {
  buildDestination,
  buildImgUrl,
  buildOgFields,
  imageVars,
  parseShareParams,
  twitterCard,
} from "./share.ts";

const tpl = parseTemplate(JSON.stringify({
  vars: { score: "0", title: "無題" },
  url: "https://g.kbn.one/play?date={{date}}&rec={{rec}}#top",
  og: { title: "{{date}} に {{score}} 点 ({{title}})" },
  images: [`<svg width="1200" height="630"><text>{{score}}</text></svg>`],
}));

Deno.test("parseShareParams separates reserved params", () => {
  const p = parseShareParams(
    new URLSearchParams("tmpl=g.kbn.one/og&ar=2&score=10&rec=a_b-c"),
  );
  assertEquals(p?.tmpl, "g.kbn.one/og");
  assertEquals(p?.ratio, "2");
  assertEquals(p?.vars, { score: "10", rec: "a_b-c" });
  assertEquals(parseShareParams(new URLSearchParams("score=1")), null);
});

Deno.test("imageVars keeps only template vars, filling defaults", () => {
  assertEquals(imageVars(tpl, { score: "10", rec: "xyz" }), {
    score: "10",
    title: "無題",
  });
  assertEquals(imageVars(tpl, { title: "" }), { score: "0", title: "無題" });
});

Deno.test("buildImgUrl carries only image vars plus ar", () => {
  const u = buildImgUrl("https://og.kbn.one", "g.kbn.one/og", tpl, {
    score: "10",
    rec: "x".repeat(2000),
    date: "2026-09-22",
  }, 1200 / 630);
  assertEquals(
    u.href,
    "https://og.kbn.one/img?tmpl=g.kbn.one%2Fog&ar=1.9&score=10&title=%E7%84%A1%E9%A1%8C",
  );
});

Deno.test("buildDestination encodes values once", () => {
  const rec =
    "hZXBjtMwEIYzv-M4DVWB1aoFCYk0TlK3aYvEZeHmExcOcNkj4sIbcOEZ4Bk48QBc4eFWQnGcxHEcIUufZ5x0ZvyP4yJCVDhDhgYkSUhINlgkhYT-zNJhJS1QUIGBkf5NnFWoqELFatSoaaS-JivHZwcccKAZM30nMmszxRQU13dsLKgnV1BQif5DqydHHHGkY1xSiRKWvCT9IYlqZhNym4LpVyI14bkiE4RUrEi_T6HWXcIj2Yhc";
  const dest = buildDestination(tpl, { date: "2026-09-22", rec, score: "10" })!;
  assertEquals(dest, `https://g.kbn.one/play?date=2026-09-22&rec=${rec}#top`);
  const back = new URL(dest).searchParams.get("rec");
  assertEquals(back, rec);
  const withSpace = buildDestination(tpl, { date: "a b&c", rec: "日本" })!;
  assertEquals(new URL(withSpace).searchParams.get("date"), "a b&c");
  assertEquals(new URL(withSpace).searchParams.get("rec"), "日本");
});

Deno.test("buildDestination is null without url", () => {
  const t = parseTemplate(`<svg width="1" height="1"/>`);
  assertEquals(buildDestination(t, {}), null);
});

Deno.test("buildOgFields substitutes without escaping (html-template escapes later)", () => {
  assertEquals(
    buildOgFields(tpl, { date: "9/22", score: "10" }).title,
    "9/22 に 10 点 (無題)",
  );
  assertEquals(buildOgFields(tpl, { score: "<b>" }).title, " に <b> 点 (無題)");
});

Deno.test("twitterCard", () => {
  assertEquals(twitterCard({ ratio: 1 } as never), "summary");
  assertEquals(twitterCard({ ratio: 1.2 } as never), "summary");
  assertEquals(twitterCard({ ratio: 1.91 } as never), "summary_large_image");
});
