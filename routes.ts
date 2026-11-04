import { get, post, route } from "@remix-run/fetch-router/routes";

export const routes = route({
  home: get("/"),
  share: get("/share"),
  img: get("/img"),
  preview: get("/preview"),
  player: get("/player"),
  previewPurge: post("/preview/purge"),
});
