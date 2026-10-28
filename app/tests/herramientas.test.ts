// El ayudante único para lanzar las herramientas propias (pa, reparto, tablero, cuentas, workers, trama-estado, gate, clasificar):
// con `process.platform` simulado, en win32 es `node <app>\dist-electron\cli\<x>.js` (nunca un .cmd ni cmd.exe) y en linux lo de siempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { comandoPropio, entornoCmd, HERRAMIENTAS_PROPIAS } from "../electron/binario.ts";
import { prefijoDe } from "../electron/cli/pa/programas.ts";

const WENV = { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: "C:\\Users\\Ana", Path: "C:\\Windows;C:\\Users\\Ana\\AppData\\Local\\trama\\bin" };
const WHOME = "C:\\Users\\Ana";
const RAIZ = "C:\\Users\\Ana\\AppData\\Local\\trama";
const NODE = `${RAIZ}\\node\\node.exe`;
const hay = (...fs: string[]) => (f: string) => fs.includes(f);

/** Corre `f` con `process.platform` simulado. */
function conPlataforma<T>(plat: NodeJS.Platform, f: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: plat });
  try {
    return f();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

test("win32 simulado: cada herramienta propia es node + su .js de dist-electron\\cli, aunque en bin\\ sólo haya .cmd", () => {
  conPlataforma("win32", () => {
    for (const h of Object.keys(HERRAMIENTAS_PROPIAS)) {
      const js = `${RAIZ}\\app\\dist-electron\\cli\\${h}.js`;
      // el .cmd está en bin\ y en el PATH, pero no se usa
      const r = comandoPropio(h, WENV, WHOME, hay(NODE, js, `${RAIZ}\\bin\\${h}.cmd`));
      assert.deepEqual(r, [NODE, js], h);
      assert.ok(!r.some((x) => /\.(cmd|bat)$/i.test(x) || /cmd\.exe/i.test(x)), `${h} no pasa por cmd`);
    }
  });
});

test("win32 simulado: TRAMA_APP mueve la app; la variable HILOS_* gana; sin script queda el nombre pelado", () => {
  conPlataforma("win32", () => {
    const js = "D:\\trama-app\\dist-electron\\cli\\pa.js";
    assert.deepEqual(comandoPropio("pa", { ...WENV, TRAMA_APP: "D:\\trama-app" }, WHOME, hay(NODE, js)), [NODE, js]);
    assert.deepEqual(comandoPropio("pa", { ...WENV, HILOS_PA: "D:\\x\\pa.js" }, WHOME, hay(NODE)), [NODE, "D:\\x\\pa.js"]);
    assert.deepEqual(comandoPropio("reparto", WENV, WHOME, hay(NODE)), ["reparto"]);
  });
});

test("win32 simulado: sin el node propio se usa el ejecutable actual, y Electron se porta como node", () => {
  conPlataforma("win32", () => {
    const js = `${RAIZ}\\app\\dist-electron\\cli\\tablero.js`;
    const r = comandoPropio("tablero", WENV, WHOME, hay(js));
    assert.deepEqual(r, [process.execPath, js]);
    const antes = process.versions.electron;
    Object.defineProperty(process.versions, "electron", { value: "99", configurable: true });
    try {
      assert.equal(entornoCmd(r, {}).ELECTRON_RUN_AS_NODE, "1");
    } finally {
      if (antes === undefined) delete (process.versions as Record<string, string>).electron;
      else Object.defineProperty(process.versions, "electron", { value: antes, configurable: true });
    }
  });
});

test("linux simulado: lo de siempre (el binario del PATH o ~/.local/bin, o la variable)", () => {
  conPlataforma("linux", () => {
    assert.deepEqual(comandoPropio("pa", { PATH: "/usr/bin" }, "/home/ana", hay("/usr/bin/pa")), ["/usr/bin/pa"]);
    assert.deepEqual(comandoPropio("reparto", { PATH: "/usr/bin" }, "/home/ana", hay("/home/ana/.local/bin/reparto")), ["/home/ana/.local/bin/reparto"]);
    assert.deepEqual(comandoPropio("cuentas", { HILOS_CUENTAS: "/falso/cuentas" }, "/home/ana", hay()), ["/falso/cuentas"]);
    assert.deepEqual(comandoPropio("workers", { PATH: "/usr/bin" }, "/home/ana", hay()), ["workers"]);
  });
});

test("pa --plan: el prefijo de reparto/cuentas/tablero según la plataforma de pa", () => {
  const pa = (plat: "linux" | "win32", env: Record<string, string> = {}) => ({ plat, home: plat === "win32" ? WHOME : "/home/ana", env: { ...(plat === "win32" ? WENV : {}), ...env } }) as never;
  assert.deepEqual(prefijoDe(pa("linux"), "reparto", undefined, "/m/bin/reparto"), ["/m/bin/reparto"]);
  assert.deepEqual(prefijoDe(pa("linux", { PA_TABLERO: "/x/t" }), "tablero", "/x/t", "/x/t"), ["/x/t"]);
  // win32: sin script a mano queda el nombre pelado (no hay node.exe real en esta máquina); con la variable de pa, ese script
  const r = prefijoDe(pa("win32", { PA_CUENTAS_BIN: "D:\\x\\cuentas.js" }), "cuentas", "D:\\x\\cuentas.js", "D:\\x\\cuentas.js");
  assert.equal(r.length, 2);
  assert.equal(r[1], "D:\\x\\cuentas.js");
  assert.ok(!r.some((x) => /\.(cmd|bat)$/i.test(x)));
  assert.deepEqual(prefijoDe(pa("win32", { PA_REPARTO: "0" }), "reparto", "0", "x"), ["reparto"]);
});
