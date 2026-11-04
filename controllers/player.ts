/**
 * X の Player Card（`twitter:card=player`）のシミュレータ。`/preview` の一節として出る。
 *
 * テンプレの `player` が X の条件を満たしているか（カードの種類、サイズ、正方形の画像、
 * プレイヤーのページのヘッダー）を表にし、プレイヤーのページを X と同じ `sandbox` の iframe で
 * 開く。X の枠は 245〜500px で伸び縮みするので、幅はスライダーで変える。
 *
 * X の検証ツールは無くなっていて、これは「実際に貼る前にここまでは確認できる」ためのもの。
 * 判定の根拠は lib/player.ts。
 */
import type { Action } from "@remix-run/fetch-router";
import { html, type SafeHtml } from "@remix-run/html-template";
import type { routes } from "../routes.ts";
import {
  type Check,
  fetchPlayer,
  frameChecks,
  imageCheck,
  sizeCheck,
  X_MAX_WIDTH,
  X_MIN_WIDTH,
  X_SANDBOX,
} from "../lib/player.ts";
import {
  buildImgUrl,
  buildOgFields,
  buildPlayer,
  pickImage,
  type ShareParams,
} from "../lib/share.ts";
import type { Template } from "../lib/template.ts";

const MARK: Record<Check["level"], string> = {
  ok: "✓",
  warn: "!",
  ng: "✗",
  info: "–",
};
const CLASS: Record<Check["level"], string> = {
  ok: "ok",
  warn: "warn",
  ng: "warn",
  info: "muted",
};

/**
 * `/preview` の「X の Player Card」の節。
 *
 * テンプレに `player` が無い、または使えない（https でない、別ホスト）ときは、その理由だけを返す。
 * あるときは、チェック表、再生前のカード、X と同じ sandbox の iframe を返す。
 *
 * @param origin og.kbn.one 自身の origin（`twitter:image` の URL を組み立てる）
 * @param template 取得済みのテンプレ
 * @param params シェア URL を解釈したもの
 * @returns 節の HTML（見出しを含む）
 */
export async function playerSection(
  origin: string,
  template: Template,
  params: ShareParams,
): Promise<SafeHtml> {
  if (!template.player) {
    return html`
      <h2 id="player">X の Player Card</h2>
      <p
        class="muted">このテンプレには <code>player</code> がありません。<code>{ "player": { "url": "https://…", "width": 480, "height": 480 } }</code> を足すと、X でポストの中で動く Player Card になります。</p>
    `;
  }
  const player = buildPlayer(template, params.vars, params.tmpl);
  if (!player) {
    return html`
      <h2 id="player">X の Player Card</h2>
      <p
        class="warn"><code>player.url</code>（<code>${template.player
          .url}</code>）は使われません。https で、テンプレと同じホスト（<code>${params
          .tmpl.split("/")[0]}</code>）のページだけが有効です。</p>
    `;
  }

  const square = pickImage(template, 1);
  const cardImage = buildImgUrl(
    origin,
    params.tmpl,
    template,
    params.vars,
    square.ratio,
  );
  const og = buildOgFields(template, params.vars);
  const title = og.title ?? params.tmpl.split("/")[0];

  const checks: Check[] = [
    {
      level: "ok",
      label: "twitter:card = player",
      detail: "テンプレに player があります。",
    },
    { level: "ok", label: `twitter:player = ${player.url}` },
    sizeCheck(player),
    imageCheck(square),
  ];
  try {
    checks.push(...frameChecks(await fetchPlayer(player.url)));
  } catch (e) {
    checks.push({
      level: "ng",
      label: "プレイヤーのページを取得できなかった",
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const failed = checks.filter((c) => c.level === "ng").length;
  const verdict = failed === 0
    ? html`
      <p
        class="ok">X の条件で見つかった問題はありません。最後は実際に X に貼って確かめてください。</p>
    `
    : html`<p class="warn">${
      String(failed)
    } 件、X で動かない原因になりそうなものがあります。</p>`;

  return html`
    <h2 id="player">X の Player Card</h2>
    ${verdict}
    <h3>チェック</h3>
    <table>
      ${checks.map((c) =>
        html`
          <tr>
            <td class="${CLASS[c.level]}">${MARK[c.level]}</td>
            <td>${c.label}${c.detail
              ? html`<br><span class="muted">${c.detail}</span>`
              : ""}</td>
          </tr>
        `
      )}
    </table>

    <h3>カード（再生前）</h3>
    <p
      class="muted">モバイルの X や、プレイヤーを開く前の表示です。画像は <code>twitter:image</code>（正方形）。</p>
    <figure>
      <div class="frame"
        style="max-width:360px"><img src="${cardImage
          .href}" alt="${title}" width="${String(
            square.width,
          )}" height="${String(
            square.height,
          )}"></div>
      <figcaption>${title}<br><span class="muted">From og.kbn.one</span></figcaption>
    </figure>

    <h3>プレイヤー</h3>
    <p
      class="muted">X と同じ <code>sandbox="${X_SANDBOX}"</code> の iframe です。X の枠は ${String(
        X_MIN_WIDTH,
      )}〜${String(X_MAX_WIDTH)}px 幅で、高さは ${String(
        player.width,
      )}:${String(
        player.height,
      )} の比で決まります。<code>alert</code> や <code>&lt;form&gt;</code> の送信は、この sandbox では効きません。</p>
    <p>
      <label>幅 <input type="range" id="w" min="${String(
        X_MIN_WIDTH,
      )}" max="${String(
        X_MAX_WIDTH,
      )}" value="${String(
        Math.min(player.width, X_MAX_WIDTH),
      )}" style="width:16rem;vertical-align:middle"></label>
      <output id="size"></output>
    </p>
    <iframe id="frame" src="${player.url}" sandbox="${X_SANDBOX}"
      style="border:1px solid #8886;max-width:100%;display:block"
      title="player"></iframe>
    <p><a href="${player.url}">プレイヤーのページを直接開く</a></p>
    ${html.raw`<script>
(() => {
  const ratio = ${JSON.stringify(player.height / player.width)};
  const frame = document.getElementById("frame");
  const range = document.getElementById("w");
  const out = document.getElementById("size");
  const apply = () => {
    const w = Number(range.value);
    const h = Math.round(w * ratio);
    frame.width = w;
    frame.height = h;
    out.textContent = w + "×" + h;
  };
  range.addEventListener("input", apply);
  apply();
})();
</script>`}
  `;
}

/**
 * GET /player?url=<シェア URL>
 *
 * 以前の単独ページ。シミュレータは `/preview` の一節になったので、そちらへ移す。
 */
export const playerAction = {
  handler(context) {
    const to = new URL("/preview", context.url.origin);
    to.search = context.url.search;
    to.hash = "player";
    return new Response(null, {
      status: 303,
      headers: { location: to.href },
    });
  },
} satisfies Action<typeof routes.player>;
