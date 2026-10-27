// El paso previo de las acciones de Ramas que lanzan algo: lo elegido (modelo, effort, texto) llega a la línea de `pa`
// con `--tipo` siempre (con el `pa` falso, que anota su argv), y lo raro no sale. La lógica pura del paso (defaults,
// esfuerzo por modelo, texto sumado) va aparte. Los imports de src/ van sin extensión: un hook los lleva al `.ts`.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    const desde = ctx.parentURL ? path.dirname(fileURLToPath(ctx.parentURL)) : "";
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(desde, spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    if (spec.startsWith(".") && !path.extname(spec) && ctx.parentURL?.includes("/src/")) {
      for (const f of [path.join(desde, spec + ".ts"), path.join(desde, spec + ".tsx")])
        if (existsSync(f)) return next(path.relative(desde, f).replace(/^(?!\.)/, "./"), ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-lanzar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const LOG = path.join(tmp, "pa.log");
process.env.PA_FALSO_LOG = LOG;
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");

const { argvLanzarRama, lanzarRama, TIPO_DE } = await import("../electron/paneles.ts");
const { ACTUALIZAR, HAIKU_PA, conTexto, esfuerzoWorker } = await import("../src/paneles/lanzar.ts");
const { ErrorPa, RC_CONFLICTO, rcDe } = await import("../src/datos/errorpa.ts");

const ID = "20261003-100900-13131";
const lineas = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : []);

test("el default de Actualizar es lo de una tarea mecánica: Haiku al máximo que rinde, tipo mecanico", () => {
  assert.deepEqual({ ...ACTUALIZAR }, { modelo: HAIKU_PA, effort: "xhigh", tipo: "mecanico" });
  assert.equal(TIPO_DE.actualizar, ACTUALIZAR.tipo);
});

test("el modelo, el effort y el tipo elegidos llegan a la línea de pa", async () => {
  const args = await argvLanzarRama({ accion: "actualizar", id: ID, proyecto: "atlas", modelo: "claude-sonnet-5-5", effort: "high" });
  assert.deepEqual(args, ["atlas", "--actualizar", ID, "--async", "-m", "claude-sonnet-5-5", "--effort", "high", "--tipo", "mecanico"]);
  const r = await lanzarRama({ accion: "actualizar", id: ID, proyecto: "atlas", modelo: "claude-sonnet-5-5", effort: "high" });
  assert.equal(r.rc, 0);
  const ultima = lineas().at(-1)!;
  assert.match(ultima, /atlas --actualizar 20261003-100900-13131 --async -m claude-sonnet-5-5 --effort high --tipo mecanico$/);
});

test("con el default (Haiku xhigh) pa falso lo acepta, y el texto opcional va después de --", async () => {
  const r = await lanzarRama({ accion: "actualizar", id: ID, proyecto: "atlas", modelo: ACTUALIZAR.modelo, effort: ACTUALIZAR.effort, texto: "  mirá el choque en src/x.ts  " });
  assert.equal(r.rc, 0, r.dijo);
  const ultima = lineas().at(-1)!;
  assert.match(ultima, /-m claude-haiku-5-5 --effort xhigh --tipo mecanico -- mir/);
  assert.match(ultima, /choque/);
  assert.doesNotMatch(ultima, /--tipo mecanico -- {2}/, "el texto va sin los espacios de los bordes");
});

test("sin texto no hay --; lo que no es un modelo, un effort, un id o un proyecto no sale", async () => {
  const sin = await argvLanzarRama({ accion: "actualizar", id: ID, proyecto: "atlas", modelo: HAIKU_PA, effort: "xhigh", texto: "   " });
  assert.ok(!sin.includes("--"));
  const antes = lineas().length;
  const malos = [
    { modelo: "--ok-ana" },
    { modelo: "a b" },
    { effort: "ultra" },
    { effort: "--async" },
    { id: "../x" },
    { proyecto: "-rm" },
    { accion: "borrar" },
  ];
  for (const m of malos) {
    await assert.rejects(lanzarRama({ accion: "actualizar", id: ID, proyecto: "atlas", modelo: "claude-opus-5-5", effort: "high", ...m } as never), undefined, JSON.stringify(m));
  }
  assert.equal(lineas().length, antes, "nada de eso llegó a pa");
});

test("el esfuerzo con que arranca cada modelo: Haiku xhigh; el resto, el último elegido o el de routing", () => {
  assert.equal(esfuerzoWorker(HAIKU_PA, {}), "xhigh");
  assert.equal(esfuerzoWorker(HAIKU_PA, { [HAIKU_PA]: "high" }), "high");
  assert.equal(esfuerzoWorker("claude-opus-5-5", { "claude-opus-5-5": "xhigh" }), "xhigh");
  assert.equal(esfuerzoWorker("claude-opus-5-5", {}), "high");
});

test("el texto de Ana se suma al prompt en un párrafo aparte; vacío no suma nada", () => {
  assert.equal(conTexto("PROMPT", ""), "PROMPT");
  assert.equal(conTexto("PROMPT", "  \n "), "PROMPT");
  assert.equal(conTexto("PROMPT", " ojo con X "), "PROMPT\n\nojo con X");
});

test("un error de pa se acuerda del código: el 80 es el choque con main", () => {
  assert.equal(rcDe(new ErrorPa("choque", RC_CONFLICTO)), 80);
  assert.equal(rcDe(new Error("otro")), null);
  assert.equal(rcDe("texto"), null);
});
