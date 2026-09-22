# og.kbn.one

テンプレ駆動の og:image 生成サービス。Deno + Remix v3
(`@remix-run/fetch-router`) + resvg-wasm。Deno Deploy
上で動かし、テンプレのキャッシュに Deno KV を使う。

テンプレ（SVG または SVG を束ねた
JSON）は各プロジェクトが静的ファイルとして持ち、 このサーバはシェア URL
のクエリを埋めて PNG を描画する。使い方とテンプレ仕様は
トップページ（`controllers/home.ts`）に書いてある。

## エンドポイント

- `GET /share?tmpl=host/path&…` — OG メタ付き HTML。人間には JS で元 URL
  へ移動。
- `GET /img?tmpl=host/path&ar=1.91&…` — PNG。
- `GET /preview?url=<シェア URL>` — プレビューア。
- `GET /` — ドキュメント。

## 構成

```
worker.ts        Cloudflare Workers エントリ（wasm import、KV バインディング、waitUntil）
main.ts          Deno でのローカル起動（メモリキャッシュのみ）
router.ts        fetch-router（`deno serve ./router.ts` でも起動可）
routes.ts        ルート定義
controllers/     home / share / img / preview
lib/allowlist.ts tmpl ホストのホワイトリスト（*.kbn.one, kuboon.github.io）
lib/template.ts  テンプレ解析（SVG / JSON → Template）
lib/store.ts     取得・1 時間キャッシュ・条件付き GET 再検証（メモリ + KV、waitUntil で裏更新）
lib/kv.ts        KV 抽象（Workers KV / メモリ）
lib/aspect.ts    UA → 目標縦横比、画像選択
lib/render.ts    {{name}} 置換、Google Fonts サブセット、画像インライン化、resvg
lib/share.ts     シェア URL の解釈、/img URL・遷移先・OG の組み立て
wrangler.jsonc   Worker 名、KV バインディング `TEMPLATES`、カスタムドメイン og.kbn.one
```

`worker.ts` だけは Deno が wasm import を型チェックできないため `deno.json` の
`exclude` に入れてある。ロジックは router.ts 以下に置き、そちらを Deno
で検査する。

## 開発

```bash
deno task dev         # Deno で起動 http://localhost:8000/（KV 無し）
deno task dev:worker  # wrangler dev（workerd + ローカル KV）
deno task test
deno task check       # 型 / lint / fmt
deno task deploy      # wrangler deploy（CLOUDFLARE_API_TOKEN が必要）
```

`main` への push で `.github/workflows/deploy.yml` が `wrangler deploy` する。
リポジトリの secret `CLOUDFLARE_API_TOKEN`（Workers Scripts:Edit、Workers KV
Storage:Edit） が未設定のときはスキップされる。

ローカルでテンプレを試すときは `ALLOWED_HOSTS=*.kbn.one,localhost,127.0.0.1`
のように環境変数でホワイトリストを広げる（`localhost` / `127.0.0.1` は http
で取得）。
