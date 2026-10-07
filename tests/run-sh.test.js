import { describe, it, expect, afterEach } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { ROOT } from "./helpers/load-module.js";

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function getStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject);
    req.setTimeout(1000, () => req.destroy(new Error("timeout")));
  });
}

async function waitFor200(url, ms) {
  const end = Date.now() + ms;
  let last = null;
  while (Date.now() < end) {
    try { last = await getStatus(url); if (last === 200) return last; } catch (e) { last = e.message; }
    await new Promise((r) => setTimeout(r, 100));
  }
  return last;
}

let child = null;
let tmp = null;
afterEach(() => {
  if (child && child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch {} }
  child = null;
  if (tmp) { fs.rmSync(tmp, { recursive: true, force: true }); tmp = null; }
});

describe("run.sh", () => {
  it("run.sh is executable and passes bash -n", () => {
    const st = fs.statSync(path.join(ROOT, "run.sh"));
    expect(st.mode & 0o111, "executable bit").not.toBe(0);
    const r = spawnSync("bash", ["-n", "run.sh"], { cwd: ROOT, encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });

  it("run.sh with NO_BROWSER=1 serves index.html with 200 within 3 s", async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "runsh-"));
    const marker = path.join(tmp, "browser-opened");
    // Fake browser openers on PATH: if run.sh calls any of them, the marker appears.
    for (const name of ["xdg-open", "open", "cmd.exe"]) {
      const p = path.join(tmp, name);
      fs.writeFileSync(p, `#!/usr/bin/env bash\necho "$@" > "${marker}"\n`);
      fs.chmodSync(p, 0o755);
    }
    const port = await freePort();
    child = spawn("bash", ["run.sh", String(port)], {
      cwd: ROOT,
      env: { ...process.env, NO_BROWSER: "1", PATH: `${tmp}:${process.env.PATH}` },
      stdio: "ignore",
      detached: true,
    });
    const status = await waitFor200(`http://127.0.0.1:${port}/`, 3000);
    expect(status, "HTTP status for /").toBe(200);
    // give run.sh time to reach its browser step
    await new Promise((r) => setTimeout(r, 1500));
    expect(fs.existsSync(marker), "a browser opener was invoked despite NO_BROWSER=1").toBe(false);
  });
});
