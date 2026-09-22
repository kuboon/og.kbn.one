import router from "./router.ts";

Deno.serve((request) => router.fetch(request));
