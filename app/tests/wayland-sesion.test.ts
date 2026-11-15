// Trama elige Wayland nativo aunque el proceso que la lanza no traiga WAYLAND_DISPLAY (electron/wayland.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { aplicarWayland, resolverWayland } from "../electron/wayland.ts";

// Sockets falsos: un «socket» es lo que dice esSocket; el listado es lo que hay en el directorio.
const sesion = (sockets: string[], extra: NodeJS.ProcessEnv = {}) => {
  const run = "/run/user/1000";
  const env = { XDG_RUNTIME_DIR: run, ...extra };
  const lista = (d: string) => (d === run ? [...sockets, "otro.txt"] : []);
  const esSocket = (ruta: string) => sockets.some((s) => ruta === path.join(run, s));
  return { env, lista, esSocket };
};

test("sin WAYLAND_DISPLAY y con un socket wayland-N: lo usa y fuerza wayland", () => {
  const s = sesion(["wayland-1"], { DISPLAY: ":0" });
  assert.deepEqual(resolverWayland(s.env, 1000, s.lista, s.esSocket), { waylandDisplay: "wayland-1", forzarWayland: true });
});

test("WAYLAND_DISPLAY que existe: se respeta", () => {
  const s = sesion(["wayland-1", "wayland-2"], { WAYLAND_DISPLAY: "wayland-2" });
  assert.deepEqual(resolverWayland(s.env, 1000, s.lista, s.esSocket), { waylandDisplay: "wayland-2", forzarWayland: true });
});

test("WAYLAND_DISPLAY viejo (no existe): usa el socket que hay", () => {
  const s = sesion(["wayland-1"], { WAYLAND_DISPLAY: "wayland-9" });
  assert.deepEqual(resolverWayland(s.env, 1000, s.lista, s.esSocket), { waylandDisplay: "wayland-1", forzarWayland: true });
});

test("sin socket (X11, Xvfb de las pruebas): no toca nada y no fuerza wayland", () => {
  const s = sesion([], { DISPLAY: ":99" });
  assert.deepEqual(resolverWayland(s.env, 1000, s.lista, s.esSocket), { forzarWayland: false });
});

test("un archivo wayland-N que no es socket no cuenta", () => {
  const s = sesion([], {});
  const lista = () => ["wayland-1"];
  assert.deepEqual(resolverWayland(s.env, 1000, lista, () => false), { forzarWayland: false });
});

test("sin XDG_RUNTIME_DIR: cae en /run/user/<uid>", () => {
  let visto = "";
  const lista = (d: string) => {
    visto = d;
    return ["wayland-0"];
  };
  const r = resolverWayland({}, 1234, lista, () => true);
  assert.equal(visto, "/run/user/1234");
  assert.deepEqual(r, { waylandDisplay: "wayland-0", forzarWayland: true });
});

test("aplicarWayland exporta WAYLAND_DISPLAY sobre un socket real", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tw-"));
  const srv = createServer();
  await new Promise<void>((ok) => srv.listen(path.join(dir, "wayland-7"), ok));
  try {
    const env: NodeJS.ProcessEnv = { XDG_RUNTIME_DIR: dir, DISPLAY: ":0" };
    assert.equal(aplicarWayland(env), true);
    assert.equal(env.WAYLAND_DISPLAY, "wayland-7");
  } finally {
    srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("aplicarWayland sin socket real: no exporta y no fuerza", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tw-"));
  try {
    writeFileSync(path.join(dir, "wayland-3"), "no es un socket");
    const env: NodeJS.ProcessEnv = { XDG_RUNTIME_DIR: dir, DISPLAY: ":99" };
    assert.equal(aplicarWayland(env), false);
    assert.equal(env.WAYLAND_DISPLAY, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
