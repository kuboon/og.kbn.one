/** HTML ページの共通レイアウトとエラー応答。 */
import { html, type SafeHtml } from "@remix-run/html-template";
import { createHtmlResponse } from "@remix-run/response/html";
import { TemplateRefError } from "./allowlist.ts";
import { TemplateFetchError } from "./store.ts";
import { TemplateParseError } from "./template.ts";

const STYLE = `
:root { color-scheme: light dark; font-family: system-ui, sans-serif; line-height: 1.6; }
body { margin: 0 auto; max-width: 56rem; padding: 1.5rem 1rem 4rem; }
header nav a { margin-right: 1rem; }
h1, h2, h3 { line-height: 1.25; }
h2 { margin-top: 2.5rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
pre { overflow-x: auto; background: #8881; padding: .75rem 1rem; border-radius: .5rem; }
code { background: #8882; padding: .1em .3em; border-radius: .25rem; font-size: .95em; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #8884; padding: .35rem .6rem; text-align: left; vertical-align: top; }
input[type=url], input[type=text] { width: 100%; box-sizing: border-box; padding: .5rem; font: inherit; }
button { font: inherit; padding: .5rem 1rem; }
figure { margin: 1rem 0; }
figure .frame { border: 1px solid #8886; background: repeating-conic-gradient(#8882 0 25%, transparent 0 50%) 0 0 / 20px 20px; }
figure .frame svg, figure .frame img { display: block; max-width: 100%; height: auto; }
.muted { opacity: .7; }
.warn { color: #b45309; }
.ok { color: #15803d; }
`;

export function layout(title: string, body: SafeHtml): Response {
  const page = html`
    <!DOCTYPE html>
    <html lang="ja">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${title}</title>
        <style>${html.raw`${STYLE}`}</style>
      </head>
      <body>
    <header><nav><a href="/">og.kbn.one</a><a href="/preview">preview</a></nav></header>
    ${body}
      </body>
    </html>
  `;
  return createHtmlResponse(String(page));
}

export function statusOf(e: unknown): number {
  if (e instanceof TemplateRefError) return e.status;
  if (e instanceof TemplateFetchError) return e.status;
  if (e instanceof TemplateParseError) return 422;
  return 500;
}

export function errorResponse(e: unknown): Response {
  const status = statusOf(e);
  if (status >= 500) console.error(e);
  const message = e instanceof Error ? e.message : String(e);
  return new Response(`${status}: ${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export function badRequest(message: string): Response {
  return new Response(`400: ${message}\n`, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
