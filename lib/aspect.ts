/**
 * 縦横比の選択。
 *
 * クローラの User-Agent から目標縦横比を決め、テンプレが持つ画像の中から
 * 「目標を超えない範囲で最も近いもの」を選ぶ。目標以下の候補が無ければ
 * 最も近いものにする。
 */
import type { TemplateImage } from "./template.ts";

export const DEFAULT_RATIO = 1.91;

export interface UaRatio {
  name: string;
  pattern: RegExp;
  ratio: number;
  note: string;
}

/** 先頭から順に評価し、最初にマッチしたものを採用する。 */
export const UA_RATIOS: UaRatio[] = [
  {
    name: "WhatsApp",
    pattern: /WhatsApp/i,
    ratio: 1,
    note: "サムネイルが正方形にトリミングされる",
  },
  {
    name: "Telegram",
    pattern: /TelegramBot/i,
    ratio: 1,
    note: "サムネイルが正方形にトリミングされる",
  },
  {
    name: "Mastodon / Misskey",
    pattern: /Mastodon|Misskey|Pleroma|Akkoma/i,
    ratio: 16 / 9,
    note: "カードが 16:9",
  },
  {
    name: "X (Twitter)",
    pattern: /Twitterbot/i,
    ratio: 2,
    note: "summary_large_image は 2:1",
  },
  {
    name: "Facebook / LINE / Threads",
    pattern: /facebookexternalhit|Facebot|line-poker/i,
    ratio: DEFAULT_RATIO,
    note: "OG 標準の 1.91:1",
  },
  {
    name: "Discord",
    pattern: /Discordbot/i,
    ratio: DEFAULT_RATIO,
    note: "OG 標準の 1.91:1",
  },
  {
    name: "Slack",
    pattern: /Slackbot/i,
    ratio: DEFAULT_RATIO,
    note: "OG 標準の 1.91:1",
  },
  {
    name: "Bluesky",
    pattern: /Bluesky Cardyb/i,
    ratio: DEFAULT_RATIO,
    note: "OG 標準の 1.91:1",
  },
];

export function ratioForUserAgent(ua: string | null | undefined): number {
  if (!ua) return DEFAULT_RATIO;
  for (const entry of UA_RATIOS) {
    if (entry.pattern.test(ua)) return entry.ratio;
  }
  return DEFAULT_RATIO;
}

/** `ar` クエリ値を数値に。`1.91` のような小数か `1200x630` / `2:1` 形式。 */
export function parseRatio(
  value: string | null | undefined,
): number | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const pair = v.match(/^([\d.]+)\s*[x:\/]\s*([\d.]+)$/i);
  if (pair) {
    const w = parseFloat(pair[1]), h = parseFloat(pair[2]);
    return w > 0 && h > 0 ? w / h : undefined;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function formatRatio(ratio: number): string {
  return (Math.round(ratio * 100) / 100).toString();
}

/**
 * 目標縦横比に対して描画する画像を選ぶ。
 *
 * 目標以下（同じか、より縦長）の候補のうち最も近いものを返す。
 * 目標以下が無ければ全候補で最も近いものを返す。
 * 距離は比率の対数差で測る（1:2 と 2:1 が 1:1 から等距離になる）。
 */
export function selectImage<T extends Pick<TemplateImage, "ratio">>(
  images: readonly T[],
  target: number,
): T {
  if (images.length === 0) throw new Error("template has no images");
  const EPS = 1e-6;
  const dist = (img: T) => Math.abs(Math.log(img.ratio) - Math.log(target));
  const notWider = images.filter((img) => img.ratio <= target + EPS);
  const pool = notWider.length ? notWider : images;
  return pool.reduce((best, img) => dist(img) < dist(best) ? img : best);
}
