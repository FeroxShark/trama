// La carpeta de un líder nuevo queda anotada sola en el registry de proyectos (electron/proyectos-auto.ts), y al abrir Trama las de los
// líderes que ya existen. Mismo armado que tests/lider-carpeta.test.ts (claude falso, estado y registry en un tmp).
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-auto-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "registry.json");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");

const lider = await import("../electron/lider.ts");
after(() => lider.cerrarTodos(true));


const proyectos = () => (existsSync(process.env.PROYECTOS_REGISTRY!) ? JSON.parse(readFileSync(process.env.PROYECTOS_REGISTRY!, "utf8")).projects : []) as { name: string; path: string }[];
const base = { modelo: "claude-opus-5-5", effort: "high", texto: "hola" };
const mi = path.join(tmp, "casa", "mi-app");
mkdirSync(mi, { recursive: true });

test("un líder nuevo en una carpeta la deja anotada como proyecto, una sola vez", { timeout: 20_000 }, async () => {
  await lider.nuevo({ ...base, carpeta: mi });
  await lider.nuevo({ ...base, carpeta: mi + "/" });
  await lider.nuevo(base); // en el home: nada
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(proyectos(), [{ name: "mi-app", path: mi }]);
});

test("al abrir Trama: las carpetas de los líderes que ya existen se anotan; lo ya anotado no se repite", { timeout: 20_000 }, async () => {
  writeFileSync(process.env.PROYECTOS_REGISTRY!, JSON.stringify({ projects: [] }));
  assert.deepEqual(await lider.anotarProyectosDeLideres(), ["mi-app"]);
  assert.deepEqual(proyectos().map((p) => p.name), ["mi-app"]);
  assert.deepEqual(await lider.anotarProyectosDeLideres(), []);
});
