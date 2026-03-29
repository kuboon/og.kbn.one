// copy from https://github.com/ascorbic/og-edge/blob/d533ef878801d7f808eb004f254e782ec6ba1e3c/mod.ts
// modified by kuboon
import type { ReactNode } from "https://esm.sh/react@18.2.0";
import type { SatoriOptions } from "https://esm.sh/satori@0.10.3";

import satori, { init as initSatori } from "https://esm.sh/satori@0.10.3/wasm";
import { initStreaming, type Yoga } from "https://esm.sh/yoga-wasm-web@0.3.3";

import { initWasm, Resvg } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";
import {
  EmojiType,
  getIconCode,
  loadEmoji,
} from "https://deno.land/x/og_edge@0.0.6/emoji.ts";

import { encodeBase64 } from "@std/encoding/base64";

declare module "https://esm.sh/react@18.2.0" {
  interface HTMLAttributes<T> {
    /**
     * Specify styles using Tailwind CSS classes. This feature is currently experimental.
     * If `style` prop is also specified, styles generated with `tw` prop will be overridden.
     *
     * Example:
     * - `tw='w-full h-full bg-blue-200'`
     * - `tw='text-9xl'`
     * - `tw='text-[80px]'`
     *
     * @type {string}
     */
    tw?: string;
  }
}

const resvg_wasm = fetch(
  "https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm",
).then((res) => res.arrayBuffer());

const yoga_wasm = fetch(
  "https://esm.sh/yoga-wasm-web@0.3.3/dist/yoga.wasm",
);

const initializedResvg = initWasm(resvg_wasm);
const initializedYoga = initStreaming(yoga_wasm).then((yoga: unknown) =>
  initSatori(yoga as Yoga)
);

const isDev = Boolean(Deno.env.get("NETLIFY_LOCAL"));

type ImageResponseOptions = ConstructorParameters<typeof Response>[1] & {
  /**
   * The width of the image.
   *
   * @type {number}
   * @default 1200
   */
  width?: number;
  /**
   * The height of the image.
   *
   * @type {number}
   * @default 630
   */
  height?: number;
  /**
   * Display debug information on the image.
   *
   * @type {boolean}
   * @default false
   */
  debug?: boolean;
  /**
   * A list of fonts to use.
   *
   * @type {{ data: ArrayBuffer; name: string; weight?: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900; style?: 'normal' | 'italic' }[]}
   * @default Noto Sans Latin Regular.
   */
  fonts?: SatoriOptions["fonts"];
  /**
   * Using a specific Emoji style. Defaults to `twemoji`.
   *
   * @link https://github.com/vercel/og#emoji
   * @type {EmojiType}
   * @default 'twemoji'
   */
  emoji?: EmojiType;
};

// @TODO: Support font style and weights, and make this option extensible rather
// than built-in.
// @TODO: Cover most languages with Noto Sans.
const languageFontMap = {
  "ja-JP": "Noto+Sans+JP",
  "ko-KR": "Noto+Sans+KR",
  "zh-CN": "Noto+Sans+SC",
  "zh-TW": "Noto+Sans+TC",
  "zh-HK": "Noto+Sans+HK",
  "th-TH": "Noto+Sans+Thai",
  "bn-IN": "Noto+Sans+Bengali",
  "ar-AR": "Noto+Sans+Arabic",
  "ta-IN": "Noto+Sans+Tamil",
  "ml-IN": "Noto+Sans+Malayalam",
  "he-IL": "Noto+Sans+Hebrew",
  "te-IN": "Noto+Sans+Telugu",
  devanagari: "Noto+Sans+Devanagari",
  kannada: "Noto+Sans+Kannada",
  symbol: ["Noto+Sans+Symbols", "Noto+Sans+Symbols+2"],
  math: "Noto+Sans+Math",
  unknown: "Noto+Sans+JP",
};

export async function loadGoogleFont(fonts: string | string[], text?: string) {
  // @TODO: Support multiple fonts.
  const font = Array.isArray(fonts) ? fonts.at(-1) : fonts;
  if (!font || !text) return;

  let url = `https://fonts.googleapis.com/css2?family=${font}`;
  if (text) url += `&text=${encodeURIComponent(text)}`;

  const css = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
    },
  }).then((x) => x.text());

  const resource = css.match(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/,
  );
  if (!resource) throw new Error("Failed to load font");

  const res = await fetch(resource[1]);
  if (!res.ok) throw new Error("Failed to load font");
  return res.arrayBuffer();
}

type Asset = SatoriOptions["fonts"][0] | string;

const assetCache = new Map<string, Asset | undefined>();
const loadDynamicAsset = ({ emoji }: { emoji?: EmojiType }) => {
  const fn = async (
    code: keyof typeof languageFontMap | "emoji",
    text: string,
  ): Promise<Asset | undefined> => {
    if (code === "emoji") {
      // It's an emoji, load the image.
      const b64 = await loadEmoji(getIconCode(text), emoji).then((x) =>
        x.arrayBuffer()
      ).then(encodeBase64);
      return (`data:image/svg+xml;base64,${b64}`);
    }

    // Try to load from Google Fonts.
    if (!languageFontMap[code]) code = "unknown";

    try {
      const data = await loadGoogleFont(languageFontMap[code], text);

      if (data) {
        return {
          name: `satori_${code}_fallback_${text}`,
          data,
          weight: 400,
          style: "normal",
        };
      }
    } catch (e) {
      console.error("Failed to load dynamic font for", text, ". Error:", e);
    }
  };

  return async (...args: Parameters<typeof fn>) => {
    const key = JSON.stringify(args);
    const cache = assetCache.get(key);
    if (cache) return cache;

    const asset = await fn(...args);
    assetCache.set(key, asset);
    return asset;
  };
};

export class ImageResponse extends Response {
  constructor(element: ReactNode, options: ImageResponseOptions = {}) {
    const extendedOptions = Object.assign(
      {
        width: 1200,
        height: 630,
        debug: false,
      },
      options,
    );

    const result = new ReadableStream({
      async start(controller) {
        try {
          const fallbackFont = loadGoogleFont("Noto+Sans");
          await initializedYoga;
          await initializedResvg;
          const fontData = await fallbackFont;

          const svg = await satori(element, {
            width: extendedOptions.width,
            height: extendedOptions.height,
            debug: extendedOptions.debug,
            fonts: extendedOptions.fonts || [
              {
                name: "sans serif",
                data: fontData,
                weight: 700,
                style: "normal",
              },
            ],
            loadAdditionalAsset: loadDynamicAsset({
              emoji: extendedOptions.emoji,
            }) as SatoriOptions["loadAdditionalAsset"],
          });
          // console.log(svg);

          const resvgJS = new Resvg(svg, {
            fitTo: {
              mode: "width",
              value: extendedOptions.width,
            },
          });

          controller.enqueue(resvgJS.render().asPng());
          controller.close();
        } catch (e) {
          console.error("error in og-edge", e);
          controller.error(e);
        }
      },
    });

    super(result, {
      headers: {
        "content-type": "image/png",
        "cache-control": isDev
          ? "no-cache, no-store"
          : "public, max-age=31536000, no-transform, immutable",
        ...extendedOptions.headers,
      },
      status: extendedOptions.status,
      statusText: extendedOptions.statusText,
    });
  }
}
