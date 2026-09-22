/** Deno でのローカル起動（メモリキャッシュのみ）。本番は worker.ts。 */
import router from "./router.ts";

Deno.serve((request) => router.fetch(request));
