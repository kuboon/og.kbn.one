/**
 * GET /share?tmpl=host/path&score=10&…
 *
 * クローラ向けに OG メタ付きの HTML を返す。人間には遷移先へ JS で移動させる。
 * HTTP リダイレクトや meta refresh は使わない（クローラが追いかけて
 * 遷移先の静的 OG を読んでしまうため）。
 */
import type { Action } from "@remix-run/fetch-router";
import { html } from "@remix-run/html-template";
import { createHtmlResponse } from "@remix-run/response/html";
import type { routes } from "../routes.ts";
import { parseRatio, ratioForUserAgent } from "../lib/aspect.ts";
import { badRequest, errorResponse } from "../lib/page.ts";
import {
  buildDestination,
  buildImgUrl,
  buildOgFields,
  parseShareParams,
  pickImage,
  twitterCard,
} from "../lib/share.ts";
import { getRequestScope } from "../lib/scope.ts";
import { getTemplateStore } from "../lib/store.ts";

export const shareAction = {
  async handler(context) {
    const params = parseShareParams(context.url.searchParams);
    if (!params) return badRequest("tmpl is required");
    try {
      const { waitUntil } = getRequestScope(context.request);
      const { template } = await getTemplateStore().get(params.tmpl, {
        waitUntil,
      });
      const ratio = parseRatio(params.ratio) ??
        ratioForUserAgent(context.headers.get("user-agent"));
      const image = pickImage(template, ratio);
      const imgUrl = buildImgUrl(
        context.url.origin,
        params.tmpl,
        template,
        params.vars,
        ratio,
      );
      const dest = buildDestination(template, params.vars);
      const og = buildOgFields(template, params.vars);
      const title = og.title ?? params.tmpl.split("/")[0];
      const shareUrl = context.url.href;

      const metaPairs: [string, string][] = [
        ["og:url", shareUrl],
        ["og:type", og.type ?? "website"],
        ["og:title", title],
        ...(og.description
          ? [["og:description", og.description] as [string, string]]
          : []),
        ...(og.site_name
          ? [["og:site_name", og.site_name] as [string, string]]
          : []),
        ["og:image", imgUrl.href],
        ["og:image:type", "image/png"],
        ["og:image:width", String(image.width)],
        ["og:image:height", String(image.height)],
      ];
      const twitter: [string, string][] = [
        ["twitter:card", twitterCard(image)],
        ["twitter:title", title],
        ...(og.description
          ? [["twitter:description", og.description] as [string, string]]
          : []),
        ["twitter:image", imgUrl.href],
      ];

      const page = html`
        <!DOCTYPE html>
        <html lang="ja">
          <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta name="robots" content="noindex">
        <title>${title}</title>
        ${metaPairs.map(([p, c]) =>
          html`<meta property="${p}" content="${c}">\n`
        )}
        ${twitter.map(([n, c]) => html`<meta name="${n}" content="${c}">\n`)}
        ${dest ? html`<link rel="canonical" href="${dest}">` : ""}
        <style>
        body { margin: 0; min-height: 100svh; display: grid; place-items: center; font-family: system-ui, sans-serif; }
        main { text-align: center; padding: 1rem; }
        img { max-width: 100%; height: auto; }
        </style>
          </head>
          <body>
        <main>
        ${dest ? html`<a href="${dest}">` : ""}<img src="${imgUrl
          .href}" width="${image.width}" height="${image
          .height}" alt="${title}">${dest ? html`</a>` : ""}
        ${dest ? html`<p><a href="${dest}">${title}</a></p>` : ""}
        ${og.description ? html`<p>${og.description}</p>` : ""}
        </main>
        ${dest
          ? html`<script>location.replace(${html.raw`${
            JSON.stringify(dest)
          }`});</script>`
          : ""}
          </body>
        </html>
      `;
      return createHtmlResponse(String(page), {
        headers: {
          "cache-control": "public, max-age=300",
          vary: "user-agent",
        },
      });
    } catch (e) {
      return errorResponse(e);
    }
  },
} satisfies Action<typeof routes.share>;
