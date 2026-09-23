/** GET / — テンプレの作り方とシェア URL の組み立て方のドキュメント。 */
import type { Action } from "@remix-run/fetch-router";
import { html } from "@remix-run/html-template";
import type { routes } from "../routes.ts";
import { DEFAULT_ALLOWED_HOSTS } from "../lib/allowlist.ts";
import { formatRatio, UA_RATIOS } from "../lib/aspect.ts";
import { layout } from "../lib/page.ts";

const SVG_EXAMPLE =
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <metadata id="og"><![CDATA[
  {
    "vars": { "score": "0" },
    "fonts": ["Noto Sans JP:700"],
    "url": "https://tetra-do.kbn.one/?date={{date}}&rec={{rec}}",
    "og": {
      "title": "tetra-do {{date}} で {{score}} 点",
      "description": "ブラウザで遊べる落ちものパズル"
    }
  }
  ]]></metadata>
  <rect width="1200" height="630" fill="#f2d4ef"/>
  <text x="600" y="360" font-family="Noto Sans JP" font-weight="700"
        font-size="160" text-anchor="middle">{{score}}</text>
</svg>`;

const JSON_EXAMPLE = `{
  "vars": { "score": "0" },
  "fonts": ["Noto Sans JP:700"],
  "url": "https://tetra-do.kbn.one/?date={{date}}&rec={{rec}}",
  "og": { "title": "tetra-do {{date}} で {{score}} 点" },
  "images": [
    "<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"1200\\" height=\\"630\\">…</svg>",
    "<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"800\\" height=\\"800\\">…</svg>"
  ]
}`;

const BUILD_EXAMPLE =
  `// build_og.ts — 複数の SVG を 1 つの JSON テンプレにまとめる
const svgs = ["og-wide.svg", "og-square.svg"].map((f) => Deno.readTextFileSync(f));
const tmpl = {
  vars: { score: "0" },
  fonts: ["Noto Sans JP:700"],
  url: "https://tetra-do.kbn.one/?date={{date}}&rec={{rec}}",
  og: { title: "tetra-do {{date}} で {{score}} 点" },
  images: svgs,
};
Deno.writeTextFileSync("public/og.json", JSON.stringify(tmpl));`;

const CLIENT_EXAMPLE =
  `// ゲーム側: 自分のクエリに tmpl と画像用の変数を足すだけ
const share = new URL("https://og.kbn.one/share");
for (const [k, v] of new URLSearchParams(location.search)) share.searchParams.set(k, v);
share.searchParams.set("tmpl", "tetra-do.kbn.one/og.json");
share.searchParams.set("score", String(score));
navigator.share?.({ url: share.href }) ?? navigator.clipboard.writeText(share.href);`;

const SHARE_ELEMENT_EXAMPLE =
  `<!-- バンドラ無しなら esm.sh 経由で読み込める（Deno なら deno add jsr:@kuboon/share-element） -->
<script type="module" src="https://esm.sh/jsr/@kuboon/share-element"></script>

<share-buttons id="share"></share-buttons>
<script type="module">
  // 上で組み立てた share (URL) を渡す
  document.getElementById("share").url = share.href;
</script>`;

export const homeAction = {
  handler() {
    const body = html`
      <h1>og.kbn.one</h1>
      <p>テンプレ駆動の og:image 生成サービス。テンプレ（SVG）は各プロジェクトが静的ファイルとして持ち、
            このサーバはクエリの値を埋めて PNG を描画します。サーバを持たないクライアントだけのゲームでも、
            静的ホスティングにテンプレを 1 ファイル置けば使えます。</p>
      <p
        class="warn"><strong>注意:</strong> 本インスタンスは <code>*.kbn.one</code> 専用です。
      ご自身のドメインで利用したい方は <a href="https://github.com/kuboon/og.kbn.one">kuboon/og.kbn.one</a> から Fork してどうぞ（要 Cloudflare Workers かそれに準ずるもの）。</p>

      <h2>仕組み</h2>
      <ol>
        <li>ゲームは <code>https://og.kbn.one/share?tmpl=…&amp;score=10&amp;…</code> という<strong>シェア URL</strong> を作ってユーザーに共有させる。</li>
        <li>SNS のクローラが <code>/share</code> を読むと、OG メタ（<code>og:image</code> は <code>/img?…</code>）が返る。</li>
        <li>クローラが <code>/img</code> を読むと、テンプレに値を埋めた PNG が返る。</li>
        <li>人間が <code>/share</code> を開くと、テンプレの <code>url</code> で組み立てた元のゲーム URL へ移動する。</li>
      </ol>
      <p>SPA はクローラが JS を実行しないため、ページ自身の og:image を動的に変えられません。<code>/share</code> はその代わりになるページです。</p>

      <h2>シェア URL</h2>
      <pre><code>https://og.kbn.one/share?tmpl=HOST/PATH&amp;name=value&amp;…</code></pre>
      <table>
        <tr>
          <th><code>tmpl</code></th>
          <td>必須。テンプレの場所を <code>host/path</code> で（スキーム無し。常に https で取得）。<code>tetra-do.kbn.one/og.svg</code> のように書く。</td>
        </tr>
        <tr>
          <th><code>ar</code></th>
          <td>任意。目標の縦横比（<code>1.91</code>、<code>2:1</code>、<code>1200x630</code>）。省略時はクローラの User-Agent から決める。</td>
        </tr>
        <tr>
          <th>その他</th>
          <td>すべて変数。<code>{{name}}</code> の置換に使う。テンプレの <code>vars</code> にある名前だけが <code>/img</code> に渡る。</td>
        </tr>
      </table>
      <p>ゲーム側の実装例:</p>
      <pre><code>${CLIENT_EXAMPLE}</code></pre>
      <p>シェア UI は <a href="https://jsr.io/@kuboon/share-element">@kuboon/share-element</a> の
      <code>&lt;share-buttons&gt;</code> を使うのを推奨します（必須ではありません）。
      X、LINE、Threads のボタンと、端末が対応していればネイティブの共有シート、無ければクリップボードへのコピーをまとめて出してくれます。
      <code>url</code> 属性に上で組み立てたシェア URL を渡すだけです。</p>
      <pre><code>${SHARE_ELEMENT_EXAMPLE}</code></pre>
      <p>操作ログのような長い値も、通常のクエリ値として 1 回だけエンコードすれば済みます。
            <code>/share</code> は受け取った値をデコードし、<code>url</code> パターンに埋めるときに 1 回エンコードし直すので、
            ゲームが <code>URLSearchParams</code> で読めば元の値がそのまま戻ります。</p>

      <h2>テンプレの形式</h2>
      <p>先頭が <code>&lt;</code> なら SVG、<code>{</code> なら JSON として読みます。どちらも最終的に同じ構造に正規化されます。</p>

      <h3>1. SVG 単体（画像が 1 枚のとき）</h3>
      <p>ルート要素直下の <code>&lt;metadata id="og"&gt;</code> に設定 JSON を書きます。CDATA で包めば <code>&amp;</code> や <code>&lt;</code> をエスケープせずに済みます。設定は省略可能で、<code>{{name}}</code> だけ書いた SVG でも動きます。</p>
      <pre><code>${SVG_EXAMPLE}</code></pre>

      <h3>2. JSON（縦横比ごとに画像を出し分けるとき）</h3>
      <pre><code>${JSON_EXAMPLE}</code></pre>
      <p>ビルドスクリプトで SVG ファイルからまとめると楽です:</p>
      <pre><code>${BUILD_EXAMPLE}</code></pre>

      <h3>設定項目</h3>
      <table>
        <tr>
          <th><code>vars</code></th>
          <td>画像描画に使う変数とデフォルト値。省略すると SVG 内の <code>{{name}}</code> から推定し、デフォルトは空文字。ここにある名前だけが <code>/img</code> の URL に載るので、画像に無関係な長い値（操作ログなど）は入れないこと。</td>
        </tr>
        <tr>
          <th><code>fonts</code></th>
          <td>Google Fonts のファミリ名の配列。<code>"Noto Sans JP:700"</code> のように <code>:weight</code> を付けられる。SVG に含まれる文字だけをサブセット取得する。先頭のフォントが既定になる。</td>
        </tr>
        <tr>
          <th><code>url</code></th>
          <td>人間を送る元 URL のパターン。<code>{{name}}</code> はシェア URL のクエリ値で置換される（URL エンコード済み）。<code>vars</code> に無い名前も使える。</td>
        </tr>
        <tr>
          <th><code>og</code></th>
          <td><code>title</code>、<code>description</code>、<code>site_name</code>、<code>type</code>。値の中で <code>{{name}}</code> が使える。</td>
        </tr>
        <tr>
          <th><code>images</code> / <code>image</code></th>
          <td>JSON 形式のときの SVG 文字列（配列または単体）。</td>
        </tr>
      </table>

      <h3>SVG の書き方</h3>
      <ul>
        <li>ルート要素に <code>width</code> と <code>height</code>（または <code>viewBox</code>）が必要です。そこから縦横比を読みます。</li>
        <li><code>{{name}}</code> はテキストにも属性にも書けます。値は XML エスケープして埋め込まれます。</li>
        <li><code>&lt;image href="https://…"&gt;</code> は取得して data URI に埋め込みます（2MB まで）。</li>
        <li>外部 CSS や <code>@import</code> によるフォント読込は効きません。フォントは <code>fonts</code> で指定してください。</li>
        <li>描画は resvg です。フィルタやマスクは概ね動きますが、<code>foreignObject</code> は使えません。</li>
      </ul>

      <h3>中央の正方形に要点を収める</h3>
      <p>横長の画像でも、表示される場所によっては<strong>中央を正方形に切り出したサムネイル</strong>になります。
      代表的なのは Facebook のコメント欄や Messenger で、投稿本文なら 1.91:1 の大きなカードになるのに、コメントに貼ると小さな正方形になります。
      クローラの User-Agent は投稿とコメントで同じなので、サーバ側では区別できません。WhatsApp や Telegram のサムネイルも同様に正方形です。</p>
      <p>そのため横長テンプレは、<strong>中央の正方形（1200×630 なら中央の 630×630）にスコアやタイトルなどの要点を収め、左右の帯には背景や装飾だけを置く</strong>ようにしてください。
      こうしておけば、横長で表示される場所ではそのまま、正方形に切り出される場所でも要点が残ります。</p>
      <p>Facebook 向けにあえて正方形の画像を返す手は勧めません。投稿本文のカードまで小さなサムネイル表示に落ちてしまい、失うものの方が大きいためです。
      正方形の画像を別に用意するのは、WhatsApp や Telegram のように<strong>常に</strong>正方形になるクローラ向けの最適化と考えてください。</p>

      <h2>縦横比の出し分け</h2>
      <p><code>/share</code> はクローラの User-Agent から目標の縦横比を決め、テンプレの画像のうち
            <strong>目標を超えない範囲で最も近いもの</strong>を選びます（目標以下が無ければ最も近いもの）。
            選んだ画像の比率を <code>ar</code> として <code>/img</code> に渡すので、<code>/img</code> 自体は User-Agent を見ません。</p>
      <table>
            <tr><th>クローラ</th><th>目標比率</th><th>備考</th></tr>
            ${UA_RATIOS.map((u) =>
              html`
                <tr>
                  <td>${u.name}</td>
                  <td>${formatRatio(u.ratio)}</td>
                  <td>${u.note}</td>
                </tr>
              `
            )}
            <tr><td>その他</td><td>1.91</td><td>OG 標準の 1200×630</td></tr>
            </table>
      <p>画像が 1 枚しか無いテンプレは常にそれが使われます。<code>twitter:card</code> は選ばれた画像が正方形に近ければ <code>summary</code>、それ以外は <code>summary_large_image</code> になります。</p>

      <h2>キャッシュと更新</h2>
      <ul>
        <li>テンプレは取得から 1 時間キャッシュします（Worker のメモリと Cloudflare KV）。</li>
        <li>1 時間を過ぎると <code>If-None-Match</code> / <code>If-Modified-Since</code> 付きで再検証します。再検証はバックグラウンドで行い、そのリクエストには手元のテンプレで応答します。304 なら本文は流れません。静的ホスティングなら ETag は自動で付きます。</li>
        <li>再検証に失敗したときは古いテンプレを使い続けます。</li>
        <li>すぐに反映したいときは <a href="/preview">/preview</a> の「キャッシュを消して再取得」で、そのテンプレのキャッシュを捨てて取り直せます。</li>
        <li>描画済み PNG はエッジキャッシュに置き、<code>Cache-Control: public, max-age=3600</code> を返します。</li>
        <li>テンプレは 1MB まで。</li>
      </ul>

      <h2>利用できるドメイン</h2>
      <p><code>tmpl</code> のホストは次に限られます: ${DEFAULT_ALLOWED_HOSTS
        .map((h) =>
          html`
            <code>${h}</code>
          `
        )}</p>

      <h2>プレビュー</h2>
      <p><a href="/preview">/preview</a> にシェア URL を貼ると、各画像に値を埋めた状態、クローラごとにどの画像が選ばれるか、OG メタ、遷移先を確認できます。</p>

      <h2>エンドポイント</h2>
      <table>
        <tr>
          <th><code>GET /share</code></th>
          <td>OG メタ付き HTML。人間には JS で遷移先へ移動。</td>
        </tr>
        <tr>
          <th><code>GET /img</code></th>
          <td>PNG。<code>tmpl</code>、<code>ar</code>、画像用変数を受け取る。</td>
        </tr>
        <tr>
          <th><code>GET /preview</code></th>
          <td>プレビューア。</td>
        </tr>
      </table>
    `;
    return layout("og.kbn.one", body);
  },
} satisfies Action<typeof routes.home>;
