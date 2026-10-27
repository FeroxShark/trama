// El campo "Carpeta" de un líder nuevo (`carpetaDe` y `nuevo({ carpeta })` de electron/lider.ts): absoluta o con ~, que exista y
// sea un directorio; vacía o el home = el líder de siempre. Mismo armado que tests/lider-proceso.test.ts (claude falso, estado en un tmp).
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-carpeta-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));

const casa = path.join(tmp, "casa");
const proyecto = path.join(casa, "mi-app");
mkdirSync(proyecto, { recursive: true });
const archivo = path.join(casa, "nota.txt");
writeFileSync(archivo, "x");
const motivo = (e: unknown) => String((e as Error).message);

test("carpetaDe: vacía o el home es el líder de siempre; ~ se expande; una ruta buena vuelve resuelta", async () => {
  for (const v of [undefined, null, "", "   ", casa, casa + "/", "~"]) assert.equal(await lider.carpetaDe(v, casa), undefined, String(v));
  assert.equal(await lider.carpetaDe("~/mi-app", casa), proyecto);
  assert.equal(await lider.carpetaDe(`  ${proyecto}/  `, casa), proyecto);
});

test("carpetaDe: relativa, inexistente, un archivo o algo que no es texto tiran con su motivo", async () => {
  await assert.rejects(lider.carpetaDe("mi-app", casa), (e) => /main\.carpetaRelativa/.test(motivo(e)));
  await assert.rejects(lider.carpetaDe(path.join(casa, "no-existe"), casa), (e) => /main\.carpetaNoExiste/.test(motivo(e)));
  await assert.rejects(lider.carpetaDe(archivo, casa), (e) => /main\.carpetaNoEsCarpeta/.test(motivo(e)));
  await assert.rejects(lider.carpetaDe(3, casa), (e) => /main\.carpetaRara/.test(motivo(e)));
  await assert.rejects(lider.carpetaDe("/tmp/\0x", casa), (e) => /main\.carpetaRara/.test(motivo(e)));
});

test("nuevo con carpeta: queda anotada como cwd del líder; con una mala no nace nada", { timeout: 20_000 }, async () => {
  const lideres = () => JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "lideres.json"), "utf8")).lideres as { sid: string; cwd?: string }[];
  const base = { modelo: "claude-opus-5-5", effort: "high", texto: "hola" };
  const sid = await lider.nuevo({ ...base, carpeta: proyecto });
  assert.equal(lideres().find((l) => l.sid === sid)?.cwd, proyecto);
  const antes = existsSync(path.join(process.env.HILOS_STATE!, "lideres.json")) ? lideres().length : 0;
  await assert.rejects(lider.nuevo({ ...base, carpeta: path.join(tmp, "nada") }), (e) => /main\.carpetaNoExiste/.test(motivo(e)));
  assert.equal(lideres().length, antes, "no quedó un líder sin carpeta");
  const sinCarpeta = await lider.nuevo(base);
  assert.equal(lideres().find((l) => l.sid === sinCarpeta)?.cwd, undefined);
});
