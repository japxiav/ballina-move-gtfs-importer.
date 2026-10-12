"use strict";
// Fixture-only static preview. Never serves the checkout, env files or a backend.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = fs.realpathSync(path.resolve(__dirname, "../dist"));
const port = Number(process.env.BALLINA_PREVIEW_PORT || 5173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw Error("invalid_preview_port");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://preview.invalid").pathname,
    );
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  // Only known build entry points and assets; no directory listing or SPA fallback.
  if (
    !(
      pathname === "/" ||
      pathname === "/index.html" ||
      pathname === "/ballina-move.html" ||
      pathname === "/favicon.svg" ||
      pathname.startsWith("/assets/")
    )
  ) {
    res.writeHead(404);
    res.end();
    return;
  }
  const file = path.resolve(
    root,
    "." + (pathname === "/" ? "/index.html" : pathname),
  );
  let real;
  try {
    real = fs.realpathSync(file);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }
  if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    mime[path.extname(real)] || "application/octet-stream",
  );
  // Standalone HTML has its own CSP with hashes for the inline build.
  if (pathname !== "/ballina-move.html")
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
    );
  res.writeHead(200);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = fs.createReadStream(real);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
});
server.on("error", (error) => {
  console.error(error.code || "preview_server_failed");
  process.exitCode = 1;
});
server.listen(port, "0.0.0.0", () =>
  console.log(
    `Ballina fixture build listening on internal port ${port}; no private services.`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
