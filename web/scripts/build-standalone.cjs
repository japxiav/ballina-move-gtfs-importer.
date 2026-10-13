"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../dist");
let html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const jsPath = html.match(/<script[^>]+src="([^"]+)"[^>]*><\/script>/)?.[1];
const cssPath = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/)?.[1];
if (!jsPath || !cssPath) throw Error("unexpected_vite_entrypoints");
function readAsset(asset) {
  const file = path.resolve(root, "." + asset);
  if (!file.startsWith(root + path.sep)) throw Error("asset_outside_build");
  return fs.readFileSync(file, "utf8");
}
const js = readAsset(jsPath).replace(/<\/script/gi, "<\\/script");
const css = readAsset(cssPath).replace(/<\/style/gi, "<\\/style");
const hash = (value) => createHash("sha256").update(value).digest("base64");
html = html
  .replace(
    /<script[^>]+src="[^"]+"[^>]*><\/script>/,
    () => `<script type="module">${js}</script>`,
  )
  .replace(/<link[^>]+href="[^"]+\.css"[^>]*>/, () => `<style>${css}</style>`)
  .replace(/<link[^>]+rel="icon"[^>]*>/, "")
  .replace(
    "<head>",
    `<head><meta name="referrer" content="strict-origin-when-cross-origin"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash(js)}'; style-src 'sha256-${hash(css)}'; style-src-attr 'unsafe-inline'; img-src data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
  );
fs.writeFileSync(path.join(root, "ballina-move.html"), html);
console.log(
  "Standalone app generated; same-origin data and attributed OSM map tiles only.",
);
