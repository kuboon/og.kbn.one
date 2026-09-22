/**
 * GET /preview?url=<シェア URL>
 *
 * シェア URL を貼ると、テンプレの各 SVG に変数を埋めた状態、UA ごとに
 * どの画像が選ばれるか、`/share` が出す OG メタ、遷移先を表示する。
 * `/preview?tmpl=…&score=10` のようにシェア URL と同じクエリを直接付けてもよい。
 */
import type { Action } from "@remix-run/fetch-router";
import { html, type SafeHtml } from "@remix-run/html-template";
import type { routes } from "../routes.ts";
import { formatRatio, parseRatio, UA_RATIOS } from "../lib/aspect.ts";
import { errorResponse, layout } from "../lib/page.ts";
import { collectText, parseFontSpec, substitute } from "../lib/render.ts";
import {
  buildDestination,
  buildImgUrl,
  buildOgFields,
  imageVars,
  parseShareParams,
  pickImage,
  twitterCard,
} from "../lib/share.ts";
import { getRequestScope } from "../lib/scope.ts";
import { getTemplateStore } from "../lib/store.ts";

export const previewAction = {
  async handler(context) {
    const own = context.url.searchParams;
    let search = own;
    const pasted = own.get("url");
    if (pasted) {
      try {
        search = new URL(pasted).searchParams;
      } catch {
        return layout(
          "preview",
          form(pasted, html`<p class="warn">URL として解釈できません。</p>`),
        );
      }
    }
    const params = parseShareParams(search);
    if (!params) {
      return layout("preview", form(pasted ?? "", html``));
    }
    const shareUrl = new URL("/share", context.url.origin);
    for (const [k, v] of search) shareUrl.searchParams.append(k, v);

    try {
      const { waitUntil } = getRequestScope(context.request);
      const cached = await getTemplateStore().get(params.tmpl, { waitUntil });
      const { template } = cached;
      const vars = imageVars(template, params.vars);
      const og = buildOgFields(template, params.vars);
      const dest = buildDestination(template, params.vars);
      const explicitRatio = parseRatio(params.ratio);

      const uaRows = [
        ...UA_RATIOS.map((u) => ({
          name: u.name,
          ratio: u.ratio,
          note: u.note,
        })),
        { name: "その他 / 既定", ratio: 1.91, note: "OG 標準の 1.91:1" },
      ].map((u) => {
        const ratio = explicitRatio ?? u.ratio;
        const image = pickImage(template, ratio);
        return { ...u, ratio, index: template.images.indexOf(image), image };
      });

      const fontLinks = template.fonts.map((f) => {
        const s = parseFontSpec(f);
        return html`
          <link rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=${s.family.replace(
              /\s+/g,
              "+",
            )}:wght@${String(s.weight)}&display=swap">
        `;
      });

      const body = html`
        ${form(pasted ?? shareUrl.href, html``)}
        ${fontLinks}
        <h2>テンプレ</h2>
        <table>
          <tr>
            <th>URL</th>
            <td><a href="${cached.url}">${cached.url}</a></td>
          </tr>
          <tr>
            <th>ETag</th>
            <td>${cached.etag ??
              html`<span class="muted">なし（本文ハッシュ ${cached.version}）</span>`}</td>
          </tr>
          <tr>
            <th>取得時刻</th>
            <td>${new Date(cached.fetchedAt).toISOString()}</td>
          </tr>
          <tr>
            <th>fonts</th>
            <td>${template.fonts.join(", ") ||
              html`<span class="muted">なし</span>`}</td>
          </tr>
          <tr>
            <th>画像用変数</th>
            <td>${Object.entries(vars).map(([k, v]) =>
              html`
                <code>${k}</code>=<code>${v}</code>
              `
            )}</td>
          </tr>
          <tr>
            <th>url</th>
            <td>${template.url ?? html`<span class="muted">なし</span>`}</td>
          </tr>
        </table>

        <h2>画像 (${String(template.images.length)})</h2>
        <p
          class="muted">ブラウザで SVG を直接描画したものです。実際の PNG はフォントの都合で微妙に異なることがあります。各図の下のリンクで PNG を確認できます。</p>
        ${template.images.map((img, i) => {
          const svg = sanitizeForInline(
            substitute(img.svg, vars),
            img.width,
            img.height,
          );
          const imgUrl = buildImgUrl(
            context.url.origin,
            params.tmpl,
            template,
            params.vars,
            img.ratio,
          );
          return html`
            <figure>
              <figcaption>#${String(i)} — ${String(img.width)}×${String(
                img.height,
              )}（比率 ${formatRatio(img.ratio)}）
            · <a href="${imgUrl
              .href}">PNG</a> · フォント取得に使う文字: <code>${collectText(
                svg,
              ) ||
              "(なし)"}</code></figcaption>
              <div class="frame" style="max-width:${String(
                Math.min(img.width, 800),
              )}px">${html.raw`${svg}`}</div>
            </figure>
          `;
        })}

        <h2>クローラごとの選択</h2>
        ${explicitRatio
          ? html`
            <p
              class="warn"><code>ar=${params.ratio ??
                ""}</code> が指定されているため、UA によらず比率 ${formatRatio(
                  explicitRatio,
                )} で固定されます。</p>
          `
          : ""}
        <table>
        <tr><th>クローラ</th><th>目標比率</th><th>選ばれる画像</th><th>twitter:card</th><th>備考</th></tr>
        ${uaRows.map((r) =>
          html`
            <tr>
              <td>${r.name}</td>
              <td>${formatRatio(r.ratio)}</td>
              <td>#${String(r.index)} (${String(r.image.width)}×${String(
                r.image.height,
              )})</td>
              <td>${twitterCard(r.image)}</td>
              <td class="muted">${r.note}</td>
            </tr>
          `
        )}
        </table>

        <h2>/share の出力</h2>
        <table>
        <tr><th>シェア URL</th><td><a href="${shareUrl.href}">${shareUrl
          .href}</a></td></tr>
        <tr><th>遷移先</th><td>${dest
          ? html`<a href="${dest}">${dest}</a>`
          : html`<span class="warn">テンプレに url がありません</span>`}</td></tr>
        ${Object.entries(og).map(([k, v]) =>
          html`
            <tr>
              <th>og:${k}</th>
              <td>${v}</td>
            </tr>
          `
        )}
        </table>
      `;
      return layout("preview", body);
    } catch (e) {
      if (e instanceof Error) {
        return layout(
          "preview",
          html`${
            form(pasted ?? shareUrl.href, html``)
          }<p class="warn">${e.message}</p>`,
        );
      }
      return errorResponse(e);
    }
  },
} satisfies Action<typeof routes.preview>;

function form(value: string, note: SafeHtml): SafeHtml {
  return html`
    <h1>preview</h1>
    <form method="get" action="/preview">
      <p><label>シェア URL<br><input type="url" name="url" value="${value}" placeholder="https://og.kbn.one/share?tmpl=example.kbn.one/og.svg&score=10" required></label></p>
      <p><button type="submit">表示</button></p>
    </form>
    ${note}
  `;
}

/**
 * インライン表示用に script と on* 属性を落とし、ルートを枠に収まるよう
 * `viewBox` + 幅 100% に書き換える。
 */
function sanitizeForInline(svg: string, width: number, height: number): string {
  const cleaned = svg
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, "");
  return cleaned.replace(/<svg\b([^>]*)>/i, (_, attrs: string) => {
    let a = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, "");
    if (!/\bviewBox\s*=/i.test(a)) a += ` viewBox="0 0 ${width} ${height}"`;
    return `<svg${a} width="100%" style="height:auto;display:block">`;
  });
}
