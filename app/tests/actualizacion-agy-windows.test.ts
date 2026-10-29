// Actualizar agy en Windows, con la plataforma inyectada o simulada (process.platform): `agy update` sin terminal, la
// última sólo del actualizador (no hay AUR), sin el aviso de pacman, y el PATH de la app con `;` y la clave `Path`.
// Lo que corre un `agy` falso (un sh) es POSIX (testPosix): en Windows se saltea.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPosix } from "./plataforma.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-agy-win-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
mkdirSync(process.env.HILOS_STATE, { recursive: true });
// Sin pacman (Windows no lo tiene) y el actualizador de Google como única fuente: las URLs son un servidor que no existe.
process.env.HILOS_PACMAN = "";
process.env.HILOS_AGY_ACTUALIZADOR = "http://127.0.0.1:9/";

const { crearActualizador, entorno } = await import("../electron/actualizador.ts");
const { actualizarDe, noSePuedeDe, ultimaAgy } = await import("../electron/actualizacion-agy.ts");

/** Simula `process.platform` mientras corre `f` (la propiedad es configurable en Node). */
async function comoPlataforma<T>(plat: string, f: () => Promise<T> | T): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: plat });
  try {
    return await f();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

/** Un `traer` falso que anota a qué URL se pidió y contesta según el mapa (`cae`: error de red). */
function traerFalso(actualizador: string | "cae", aur: string | "cae") {
  const pedidos: string[] = [];
  const traer = async (url: string) => {
    pedidos.push(url);
    const r = url.includes("aur.archlinux.org") ? aur : actualizador;
    if (r === "cae") throw new Error("sin red");
    return { ok: true, text: async () => r };
  };
  return { traer, pedidos };
}
const AUR = JSON.stringify({ results: [{ Version: "1.4.7-1" }] });

test("agy en Windows: `agy update` sin terminal; en Linux, paru en una terminal", () => {
  assert.deepEqual(actualizarDe("win32"), { args: ["update"] });
  assert.deepEqual(actualizarDe("linux"), { terminal: ["paru", "-S", "antigravity-cli"] });
});

test("agy en Windows: nunca pide el aviso de pacman (no hay pacman, y no hace falta)", () => {
  assert.equal(noSePuedeDe("win32"), null);
  assert.match(noSePuedeDe("linux") ?? "", /main\.agySinPacman/);
});

test("agy en Windows: la última sale del actualizador; AUR (paquete de Arch) no se consulta", async () => {
  const { traer, pedidos } = traerFalso("Stable Version: 1.4.8. Rolled out to 100%", AUR);
  assert.equal(await ultimaAgy(traer, false, "win32"), "1.4.8");
  assert.equal(pedidos.length, 1);
  assert.ok(pedidos[0]!.includes("127.0.0.1"));
});

test("agy en Windows: si el actualizador no contesta, null (no cae a AUR)", async () => {
  const { traer, pedidos } = traerFalso("cae", AUR);
  assert.equal(await ultimaAgy(traer, true, "win32"), null);
  assert.ok(!pedidos.some((u) => u.includes("aur.archlinux.org")));
});

test("process.platform simulado en win32: las decisiones por defecto son de Windows", async () => {
  const { traer, pedidos } = traerFalso("Stable Version: 1.4.8.", AUR);
  const delSistema = actualizarDe();
  await comoPlataforma("win32", async () => {
    assert.deepEqual(actualizarDe(), { args: ["update"] });
    assert.equal(noSePuedeDe(), null);
    assert.equal(await ultimaAgy(traer), "1.4.8");
  });
  assert.ok(!pedidos.some((u) => u.includes("aur.archlinux.org")));
  // Y vuelve a lo del sistema real al terminar.
  assert.deepEqual(actualizarDe(), delSistema);
});

test("PATH en Windows: se arma con `;` delante de ~/.local/bin, bajo la clave que ya trae el entorno (`Path`)", async () => {
  const guardado = { PATH: process.env.PATH, Path: process.env.Path };
  delete process.env.PATH;
  process.env.Path = "C:\\Windows;C:\\Tools";
  try {
    const env = await comoPlataforma("win32", () => entorno());
    assert.equal(env.PATH, undefined, "no duplica la clave");
    assert.deepEqual((env.Path as string).split(";"), [path.join(os.homedir(), ".local", "bin"), path.join(os.homedir(), ".npm-global", "bin"), "C:\\Windows", "C:\\Tools"]);
  } finally {
    if (guardado.PATH === undefined) delete process.env.PATH;
    else process.env.PATH = guardado.PATH;
    if (guardado.Path === undefined) delete process.env.Path;
    else process.env.Path = guardado.Path;
  }
});

testPosix("agy en Windows: Actualizar corre `agy update` (sin terminal) y deja la versión nueva", async () => {
  const v = path.join(tmp, "win.ver");
  const bin = path.join(tmp, "agy-win");
  writeFileSync(v, "1.4.2");
  writeFileSync(bin, `#!/bin/sh\ncase "$1" in --version) cat '${v}';; update) printf '%s' 1.4.3 > '${v}'; echo actualizado;; *) exit 2;; esac\n`);
  chmodSync(bin, 0o755);
  const a = crearActualizador({
    archivo: path.join(tmp, "win.json"),
    bin,
    nombre: "agy-win",
    ultima: async () => "1.4.3",
    actualizar: actualizarDe("win32"),
    entornoActualizar: entorno,
    noSePuedeActualizar: () => noSePuedeDe("win32"),
    olvidarSiFalta: true,
  });
  assert.deepEqual(await a.leerAviso(), { instalada: "1.4.2", ultima: "1.4.3" });
  assert.deepEqual(await a.actualizar(), { ok: true, version: "1.4.3" });
  assert.equal(readFileSync(v, "utf8"), "1.4.3");
});
