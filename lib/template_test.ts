import { assertEquals, assertThrows } from "@std/assert";
import {
  parseSvgImage,
  parseTemplate,
  TemplateParseError,
} from "./template.ts";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <metadata id="og"><![CDATA[
  { "vars": { "score": "0" }, "fonts": ["Noto Sans JP:700"],
    "url": "https://g.kbn.one/?date={{date}}&rec={{rec}}",
    "og": { "title": "{{date}} で {{score}} 点" } }
  ]]></metadata>
  <text>{{score}} / {{title}}</text>
</svg>`;

Deno.test("parseTemplate: SVG with metadata", () => {
  const t = parseTemplate(SVG);
  assertEquals(t.images.length, 1);
  assertEquals(t.images[0].width, 1200);
  assertEquals(t.images[0].height, 630);
  assertEquals(t.vars, { score: "0", title: "" });
  assertEquals(t.fonts, ["Noto Sans JP:700"]);
  assertEquals(t.url, "https://g.kbn.one/?date={{date}}&rec={{rec}}");
  assertEquals(t.og.title, "{{date}} で {{score}} 点");
});

Deno.test("parseTemplate: bare SVG without metadata, viewBox only", () => {
  const t = parseTemplate(
    `<?xml version="1.0"?>\n<svg viewBox="0 0 800 800"><text>{{ score }}</text></svg>`,
  );
  assertEquals(t.images[0].ratio, 1);
  assertEquals(t.vars, { score: "" });
  assertEquals(t.url, undefined);
});

Deno.test("parseTemplate: metadata without CDATA is entity-decoded", () => {
  const t = parseTemplate(
    `<svg width="10" height="5"><metadata id="og">{"url":"https://x.kbn.one/?a=1&amp;b={{b}}"}</metadata></svg>`,
  );
  assertEquals(t.url, "https://x.kbn.one/?a=1&b={{b}}");
});

Deno.test("parseTemplate: JSON with multiple images", () => {
  const t = parseTemplate(JSON.stringify({
    vars: { score: "0" },
    images: [
      `<svg width="1200px" height="630px"><text>{{score}}</text></svg>`,
      `<svg width="800" height="800"><text>{{score}} {{name}}</text></svg>`,
    ],
  }));
  assertEquals(t.images.map((i) => i.ratio.toFixed(2)), ["1.90", "1.00"]);
  assertEquals(Object.keys(t.vars).sort(), ["name", "score"]);
});

Deno.test("parseTemplate: JSON with single image", () => {
  const t = parseTemplate(`{"image":"<svg width='2' height='1'></svg>"}`);
  assertEquals(t.images.length, 1);
});

Deno.test("parseTemplate: errors", () => {
  assertThrows(() => parseTemplate("hello"), TemplateParseError);
  assertThrows(() => parseTemplate("{}"), TemplateParseError);
  assertThrows(() => parseTemplate("{"), TemplateParseError);
  assertThrows(
    () => parseTemplate(`<svg><text>x</text></svg>`),
    TemplateParseError,
  );
  assertThrows(
    () =>
      parseTemplate(
        `<svg width="1" height="1"><metadata id="og">nope</metadata></svg>`,
      ),
    TemplateParseError,
  );
});

Deno.test("parseSvgImage prefers width/height over viewBox", () => {
  const i = parseSvgImage(
    `<svg viewBox="0 0 10 10" width="200" height="100"/>`,
  );
  assertEquals([i.width, i.height], [200, 100]);
});
