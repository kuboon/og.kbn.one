import { assertEquals } from "@std/assert";
import { parseRatio, ratioForUserAgent, selectImage } from "./aspect.ts";

const imgs = [{ ratio: 1200 / 630, id: "wide" }, { ratio: 1, id: "square" }, {
  ratio: 2,
  id: "2to1",
}];

Deno.test("selectImage picks closest not exceeding target", () => {
  assertEquals(selectImage(imgs, 2).id, "2to1");
  assertEquals(selectImage(imgs, 1.95).id, "wide");
  assertEquals(selectImage(imgs, 1.91).id, "wide");
  assertEquals(selectImage(imgs, 16 / 9).id, "square");
  assertEquals(selectImage(imgs, 1).id, "square");
});

Deno.test("selectImage falls back to closest when all are wider", () => {
  assertEquals(selectImage(imgs, 0.8).id, "square");
  assertEquals(selectImage([imgs[0], imgs[2]], 1).id, "wide");
});

Deno.test("selectImage with a single image always returns it", () => {
  assertEquals(selectImage([imgs[0]], 1).id, "wide");
  assertEquals(selectImage([imgs[0]], 3).id, "wide");
});

Deno.test("ratioForUserAgent", () => {
  assertEquals(ratioForUserAgent("Twitterbot/1.0"), 2);
  assertEquals(
    ratioForUserAgent("facebookexternalhit/1.1;line-poker/1.0"),
    1.91,
  );
  assertEquals(ratioForUserAgent("WhatsApp/2.23"), 1);
  assertEquals(
    ratioForUserAgent("Mozilla/5.0 (compatible; Discordbot/2.0)"),
    1.91,
  );
  assertEquals(ratioForUserAgent("Mozilla/5.0 Chrome"), 1.91);
  assertEquals(ratioForUserAgent(null), 1.91);
});

Deno.test("parseRatio", () => {
  assertEquals(parseRatio("1.91"), 1.91);
  assertEquals(parseRatio("2:1"), 2);
  assertEquals(parseRatio("1200x630"), 1200 / 630);
  assertEquals(parseRatio("abc"), undefined);
  assertEquals(parseRatio("0"), undefined);
  assertEquals(parseRatio(null), undefined);
});
