import { assert, assertEquals, assertThrows } from "@std/assert";
import { isAllowedHost, TemplateRefError, tmplRefToUrl } from "./allowlist.ts";

const P = ["*.kbn.one", "kuboon.github.io"];

Deno.test("isAllowedHost: wildcard matches subdomains only", () => {
  assert(isAllowedHost("tetra-do.kbn.one", P));
  assert(isAllowedHost("a.b.kbn.one", P));
  assert(!isAllowedHost("kbn.one", P));
  assert(!isAllowedHost("evil-kbn.one", P));
  assert(!isAllowedHost("kbn.one.evil.com", P));
});

Deno.test("isAllowedHost: exact host", () => {
  assert(isAllowedHost("kuboon.github.io", P));
  assert(isAllowedHost("KUBOON.github.io", P));
  assert(!isAllowedHost("other.github.io", P));
});

Deno.test("tmplRefToUrl builds https URL and rejects unknown hosts", () => {
  Deno.env.set("ALLOWED_HOSTS", "*.kbn.one,localhost");
  assertEquals(
    tmplRefToUrl("tetra-do.kbn.one/og.json").href,
    "https://tetra-do.kbn.one/og.json",
  );
  assertEquals(
    tmplRefToUrl("https://tetra-do.kbn.one/og.svg?v=2").href,
    "https://tetra-do.kbn.one/og.svg?v=2",
  );
  assertEquals(
    tmplRefToUrl("localhost:8080/og.svg").href,
    "http://localhost:8080/og.svg",
  );
  const err = assertThrows(
    () => tmplRefToUrl("example.com/og.svg"),
    TemplateRefError,
  );
  assertEquals(err.status, 403);
  assertThrows(() => tmplRefToUrl(""), TemplateRefError);
  Deno.env.delete("ALLOWED_HOSTS");
});
