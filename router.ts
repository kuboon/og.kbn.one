/**
 * og.kbn.one — テンプレ駆動の og:image 生成サービス。
 *
 * ルート定義は ./routes.ts、各ルートのハンドラは ./controllers/ 配下。
 * `deno serve ./router.ts` で起動できる（default export がハンドラ）。
 */
import { createRouter } from "@remix-run/fetch-router";
import { routes } from "./routes.ts";
import { homeAction } from "./controllers/home.ts";
import { shareAction } from "./controllers/share.ts";
import { imgAction } from "./controllers/img.ts";
import { previewAction } from "./controllers/preview.ts";

const router = createRouter();

router.get(routes.home, homeAction);
router.get(routes.share, shareAction);
router.get(routes.img, imgAction);
router.get(routes.preview, previewAction);

export default router;
