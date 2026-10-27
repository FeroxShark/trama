import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    const desde = ctx.parentURL ? path.dirname(fileURLToPath(ctx.parentURL)) : "";
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(desde, spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const {
  argvTareaMd,
  briefTareaMd,
  lanzarTareaMd,
  reiniciarTareasMd,
  tareaMdEnCurso,
  MARCADOR_MD_ACORTAR,
  MARCADOR_MD_FUSIONAR,
} = await import("../electron/paneles.ts");

test("briefTareaMd: las 5 secciones requeridas por pa en ambos tipos", () => {
  for (const tipo of ["acortar", "fusionar"] as const) {
    const b = briefTareaMd(tipo, 18000);
    assert.match(b, /^Objetivo:/m);
    assert.match(b, /^Archivos:/m);
    assert.match(b, /^Listo cuando:/m);
    assert.match(b, /^Cómo verificar:/m);
    assert.match(b, /^No tocar:/m);
    assert.match(b, /commiteados en su rama/);
  }
});

test("briefTareaMd fusionar: no perder reglas, deduplicar lo idéntico, stubs y tope", () => {
  const b = briefTareaMd("fusionar", 20000);
  assert.ok(b.includes(MARCADOR_MD_FUSIONAR));
  assert.match(b, /sin perder reglas/i);
  assert.match(b, /deduplicar sólo lo idéntico/);
  assert.match(b, /contradicciones dejar las dos versiones/);
  assert.match(b, /CLAUDE\.md y GEMINI\.md quedan como stubs/);
  assert.match(b, /20000 caracteres/);
});

test("briefTareaMd acortar: por debajo del tope, docs enlazados y sin perder reglas", () => {
  const b = briefTareaMd("acortar", 20000);
  assert.ok(b.includes(MARCADOR_MD_ACORTAR));
  assert.match(b, /por debajo del tope/);
  assert.match(b, /SIN perder ninguna regla/);
  assert.match(b, /compactar redacción/);
  assert.match(b, /docs\/\.\.\.md citado desde AGENTS\.md/);
  assert.match(b, /20000 caracteres/);
});

test("argvTareaMd: sin -m, tipo codigo-acotado, valida slug y tipo", async () => {
  const argsFusion = await argvTareaMd("atlas", "fusionar");
  assert.equal(argsFusion[1], "--async");
  assert.equal(argsFusion[2], "--tipo");
  assert.equal(argsFusion[3], "codigo-acotado");
  assert.ok(!argsFusion.includes("-m"), "reparto debe elegir el modelo: sin -m");
  assert.ok(argsFusion[4].includes(MARCADOR_MD_FUSIONAR));

  const argsAcortar = await argvTareaMd("atlas", "acortar");
  assert.ok(!argsAcortar.includes("-m"));
  assert.ok(argsAcortar[4].includes(MARCADOR_MD_ACORTAR));

  for (const malo of [`../fuera`, "-proy", "con espacio", ""]) {
    await assert.rejects(argvTareaMd(malo, "fusionar"), /main\.proyectoRaro/);
  }
  await assert.rejects(argvTareaMd("atlas", "otro" as any), /main\.accionRara/);
});

test("tareaMdEnCurso y no relanzar: Set en memoria, hilo vivo y rama sin integrar", async () => {
  reiniciarTareasMd();
  assert.equal(tareaMdEnCurso("atlas", []), null);

  const hiloVivo = [
    {
      id: "20261027-100000-1",
      proyecto: "atlas",
      estado: "trabajando",
      tarea: `Objetivo: x \n ${MARCADOR_MD_ACORTAR}`,
      rama: "pa/atlas/20261027-100000-1",
      commits: 1,
    },
  ];
  assert.equal(tareaMdEnCurso("atlas", hiloVivo), "acortar");
  await assert.rejects(
    lanzarTareaMd("atlas", "acortar", { hilos: hiloVivo }),
    /main\.tareaMdEnCurso/
  );

  const hiloListoRama = [
    {
      id: "20261027-100000-2",
      proyecto: "atlas",
      estado: "listo",
      tarea: `Objetivo: x \n ${MARCADOR_MD_FUSIONAR}`,
      rama: "pa/atlas/20261027-100000-2",
      commits: 2,
    },
  ];
  assert.equal(tareaMdEnCurso("atlas", hiloListoRama), "fusionar");
  await assert.rejects(
    lanzarTareaMd("atlas", "fusionar", { hilos: hiloListoRama }),
    /main\.tareaMdEnCurso/
  );

  const hiloIntegrado = [
    {
      id: "20261027-100000-3",
      proyecto: "atlas",
      estado: "integrado",
      tarea: `Objetivo: x \n ${MARCADOR_MD_FUSIONAR}`,
      rama: "pa/atlas/20261027-100000-3",
      commits: 2,
    },
  ];
  assert.equal(tareaMdEnCurso("atlas", hiloIntegrado), null);
});
