// El lanzador que escribe scripts/instalar.sh: con un WAYLAND_DISPLAY que no existe (heredado viejo por la unidad) usa el socket que haya.
// Sin esto Electron se cae al iniciar y «Actualizar» vuelve a la versión anterior (2026-11-10).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";

const SALTAR = process.platform === "win32";
const trozo = (() => {
  const s = readFileSync(path.join(import.meta.dirname, "..", "scripts", "instalar.sh"), "utf8");
  const a = s.indexOf("# --- wayland");
  const b = s.indexOf("# --- fin wayland");
  assert.ok(a > 0 && b > a, "el lanzador tiene su bloque wayland");
  // El instalador lo escribe en un heredoc sin comillas: `\$` es `$`.
  return s.slice(a, b).replaceAll("\\$", "$");
})();

const correr = (wayland: string | undefined, dir: string) =>
  execFileSync("sh", ["-c", `${trozo}\nprintf %s "$WAYLAND_DISPLAY"`], { env: { PATH: process.env.PATH ?? "", XDG_RUNTIME_DIR: dir, ...(wayland === undefined ? {} : { WAYLAND_DISPLAY: wayland }) }, encoding: "utf8" });

const conSocket = async (nombre: string, f: (dir: string) => void) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tw-"));
  const srv = createServer();
  await new Promise<void>((ok) => srv.listen(path.join(dir, nombre), ok));
  try {
    f(dir);
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

test("WAYLAND_DISPLAY que no existe: usa el socket que hay", { skip: SALTAR }, async () => {
  await conSocket("wayland-1", (dir) => assert.equal(correr("wayland-2", dir), "wayland-1"));
});

test("WAYLAND_DISPLAY válido o ausente: no se toca", { skip: SALTAR }, async () => {
  await conSocket("wayland-1", (dir) => {
    assert.equal(correr("wayland-1", dir), "wayland-1");
    assert.equal(correr(undefined, dir), "");
  });
});

test("sin ningún socket: queda como estaba", { skip: SALTAR }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tw-"));
  try {
    assert.equal(correr("wayland-2", dir), "wayland-2");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
