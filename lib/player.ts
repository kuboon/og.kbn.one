/**
 * X の Player Card が動く条件の判定。
 *
 * `/player`（シミュレータ）が表に出す。X の公式ドキュメントはほぼ無く、ここの条件は
 * 「動いている例が報告している設定」を元にしている（`x-player-card` スキル）。X の
 * 都合でいつでも変わりうるので、判定は目安で、最終確認は実際に X に貼ること。
 */
import type { TemplateImage, TemplatePlayer } from "./template.ts";

export type Level = "ok" | "warn" | "ng" | "info";

export interface Check {
  level: Level;
  label: string;
  detail?: string;
}

/** iframe に付く sandbox。X が付けているものに合わせる（クライアントによって差がある）。 */
export const X_SANDBOX =
  "allow-popups allow-same-origin allow-scripts allow-presentation";

/** X が iframe を作るときの幅。実際のカードの幅はこの範囲で変わる。 */
export const X_MIN_WIDTH = 245;
export const X_MAX_WIDTH = 500;

/** 小さい画像だと X が Player Card を諦める。 */
export const MIN_IMAGE_PIXELS = 68_600;

/** X のクロールで使う名前の候補。frame-ancestors にこれらのどれかがあれば X から開ける。 */
const X_HOSTS = ["x.com", "twitter.com"];

/** プレイヤーのサイズ。480×480 が動いている例の定番で、大きいと画像カードに戻るという報告がある。 */
export function sizeCheck(player: TemplatePlayer): Check {
  const label = `twitter:player のサイズ ${player.width}×${player.height}`;
  if (player.width === 480 && player.height === 480) {
    return { level: "ok", label };
  }
  if (player.width > 500 || player.height > 500) {
    return {
      level: "warn",
      label,
      detail:
        "大きいサイズは画像だけのカードに戻ることがあると報告されています。480×480 が確実です。",
    };
  }
  return {
    level: "info",
    label,
    detail: "480×480 が動いている例の定番です。",
  };
}

/** twitter:image。正方形で、小さすぎないこと。 */
export function imageCheck(image: TemplateImage): Check {
  const label = `twitter:image ${image.width}×${image.height}（比率 ${
    image.ratio.toFixed(2)
  }）`;
  const square = Math.abs(Math.log(image.ratio)) < Math.log(1.05);
  const pixels = image.width * image.height;
  if (!square) {
    return {
      level: "ng",
      label,
      detail:
        "正方形でないと Player Card が出ないことがあります。正方形のテンプレ画像を足してください。",
    };
  }
  if (pixels < MIN_IMAGE_PIXELS) {
    return {
      level: "ng",
      label,
      detail: `${MIN_IMAGE_PIXELS.toLocaleString("en-US")} px 以上が必要です。`,
    };
  }
  return { level: "ok", label };
}

/** `frame-ancestors` の中身から、X が開けるかどうか。 */
export function ancestorsAllowX(sources: readonly string[]): boolean {
  return sources.some((raw) => {
    const s = raw.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (raw === "*" || raw.toLowerCase() === "https:") return true;
    return X_HOSTS.some((h) => s === h || s === `*.${h}`);
  });
}

function frameAncestors(csp: string): string[] | null {
  for (const policy of csp.split(",")) {
    for (const directive of policy.split(";")) {
      const [name, ...sources] = directive.trim().split(/\s+/);
      if (name?.toLowerCase() === "frame-ancestors") return sources;
    }
  }
  return null;
}

/** プレイヤーのページの応答。フレームに入れられるかどうか。 */
export function frameChecks(res: {
  status: number;
  headers: Headers;
  html: string;
}): Check[] {
  const out: Check[] = [];
  out.push(
    res.status === 200
      ? { level: "ok", label: "プレイヤーのページが 200 で返る" }
      : {
        level: "ng",
        label: `プレイヤーのページが ${res.status} を返した`,
        detail: res.status >= 300 && res.status < 400
          ? "リダイレクトは辿っていません。最終的な URL を twitter:player にしてください。"
          : undefined,
      },
  );

  const xfo = res.headers.get("x-frame-options");
  out.push(
    xfo === null ? { level: "ok", label: "X-Frame-Options が無い" } : {
      level: "ng",
      label: `X-Frame-Options: ${xfo}`,
      detail:
        "DENY や SAMEORIGIN は X の iframe を拒否します。ヘッダーを外してください。",
    },
  );

  const csp = res.headers.get("content-security-policy");
  const ancestors = csp === null ? null : frameAncestors(csp);
  if (ancestors === null) {
    out.push({
      level: "ok",
      label: "CSP の frame-ancestors が無い（どこからでも開ける）",
    });
  } else if (ancestorsAllowX(ancestors)) {
    out.push({
      level: "ok",
      label: `frame-ancestors が X を許可: ${ancestors.join(" ")}`,
    });
  } else {
    out.push({
      level: "ng",
      label: `frame-ancestors が X を許可していない: ${ancestors.join(" ")}`,
      detail:
        "https://x.com https://*.x.com https://twitter.com https://*.twitter.com を足してください。",
    });
  }

  const robots = /<meta\b[^>]*name=["']robots["'][^>]*>/i.exec(res.html)?.[0];
  out.push(
    robots && /noindex/i.test(robots)
      ? { level: "ok", label: "noindex が付いている" }
      : {
        level: "info",
        label: "noindex が無い",
        detail:
          "プレイヤーのページは検索に出さない方が安全です（canonical を共有ページに向けるのも）。",
      },
  );
  return out;
}

export interface PlayerFetch {
  status: number;
  headers: Headers;
  html: string;
}

/**
 * プレイヤーのページを取る。リダイレクトは辿らない。
 *
 * 呼び出し側が URL をテンプレと同じホスト（許可リスト内）に限っているので、任意の
 * ホストを og.kbn.one に取らせることにはならない。
 */
export async function fetchPlayer(
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<PlayerFetch> {
  const res = await fetchFn(url, {
    redirect: "manual",
    headers: { accept: "text/html" },
    signal: AbortSignal.timeout(10_000),
  });
  const html = (await res.text()).slice(0, 256 * 1024);
  return { status: res.status, headers: res.headers, html };
}
