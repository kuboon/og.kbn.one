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
main.ts          Deno.serve（Deno Deploy のエントリ）
router.ts        fetch-router（`deno serve ./router.ts` でも起動可）
routes.ts        ルート定義
controllers/     home / share / img / preview
lib/allowlist.ts tmpl ホストのホワイトリスト（*.kbn.one, kuboon.github.io）
lib/template.ts  テンプレ解析（SVG / JSON → Template）
lib/store.ts     取得・1 時間キャッシュ・条件付き GET 再検証（メモリ + Deno KV）
lib/aspect.ts    UA → 目標縦横比、画像選択
lib/render.ts    {{name}} 置換、Google Fonts サブセット、画像インライン化、resvg
lib/share.ts     シェア URL の解釈、/img URL・遷移先・OG の組み立て
```

## 開発

```bash
deno task dev     # http://localhost:8000/
deno task test
deno task check   # 型 / lint / fmt
```

ローカルでテンプレを試すときは `ALLOWED_HOSTS=*.kbn.one,localhost,127.0.0.1`
のように環境変数でホワイトリストを広げる（`localhost` / `127.0.0.1` は http
で取得）。
