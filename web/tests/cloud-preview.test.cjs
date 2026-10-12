"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const path = require("node:path");
const fs = require("node:fs");

test("cloud preview serves only fixture build, including forwarded hosts", async () => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const child = spawn(
    process.execPath,
    [path.resolve(__dirname, "../scripts/serve-cloud-preview.cjs")],
    {
      env: { ...process.env, BALLINA_PREVIEW_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));
  try {
    await Promise.race([
      once(child.stdout, "data"),
      once(child, "exit").then(() => {
        throw Error("preview exited: " + stderr);
      }),
      new Promise((_, reject) => {
        const t = setTimeout(() => reject(Error("preview timeout")), 5000);
        t.unref();
      }),
    ]);
    const base = `http://127.0.0.1:${port}`;
    const response = await fetch(base, {
      headers: { Host: "preview.example.invalid" },
    });
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Ballina Move/);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.match(
      response.headers.get("content-security-policy"),
      /connect-src 'none'/,
    );
    const asset = html.match(/src="([^"]+\.js)"/)[1];
    assert.equal((await fetch(base + asset)).status, 200);
    for (const endpoint of [
      "/package.json",
      "/.env",
      "/src/main.tsx",
      "/scripts/serve-cloud-preview.cjs",
      "/assets/",
      "/assets/%2e%2e%2f%2e%2e%2fpackage.json",
    ])
      assert.equal((await fetch(base + endpoint)).status, 404, endpoint);
    assert.equal((await fetch(base, { method: "POST" })).status, 405);
    const head = await fetch(base, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const standalone = await fetch(base + "/ballina-move.html");
    assert.equal(standalone.status, 200);
    const portable = await standalone.text();
    assert.match(portable, /connect-src 'none'/);
    assert.doesNotMatch(portable, /<script[^>]+src=/);
    assert.doesNotMatch(portable, /<link[^>]+href=/);
    // A symlink inside build assets must not bypass the served-root boundary.
    const link = path.resolve(
      __dirname,
      "../dist/assets/preview-boundary-test.json",
    );
    fs.symlinkSync(path.resolve(__dirname, "../package.json"), link);
    try {
      assert.equal(
        (await fetch(base + "/assets/preview-boundary-test.json")).status,
        404,
      );
    } finally {
      fs.unlinkSync(link);
    }
  } finally {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
});
