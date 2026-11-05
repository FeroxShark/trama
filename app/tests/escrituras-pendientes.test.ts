// `esperarEscrituras` (electron/pa.ts): las escrituras atómicas disparadas sin esperar (`void guardar()` al cerrar un líder)
// terminan antes de que se devuelva el control. Sin eso, un `rmSync` de la carpeta de estado en la limpieza choca con un tmp
// recién creado (ENOTEMPTY, visto en el CI de Linux). Acá: muchas escrituras a la vez, se espera, y se borra sin reintentos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { escribirAtomico, esperarEscrituras } = await import("../electron/pa.ts");

test("esperarEscrituras: las escrituras disparadas sin await terminan; después la carpeta se borra sin reintentos", async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "escrituras-"));
  const dir = path.join(tmp, "estado");
  const archivos = ["lideres.json", "uso.json", "titulos-fijos.json"].map((n) => path.join(dir, n));
  try {
    // Disparadas y olvidadas, como `void guardar()`: la última de cada archivo es la que queda.
    for (let k = 0; k < 40; k++) for (const a of archivos) void escribirAtomico(a, `${path.basename(a)}-${k}-${"x".repeat(20_000)}`);
    await esperarEscrituras();
    for (const a of archivos) assert.equal(readFileSync(a, "utf8"), `${path.basename(a)}-39-${"x".repeat(20_000)}`);
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".tmp")), [], "no queda ningún tmp a medio hacer");
    // Sin reintentos: si quedara una escritura viva, esto da ENOTEMPTY.
    rmSync(tmp, { recursive: true, force: true, maxRetries: 0 });
    assert.equal(existsSync(tmp), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
