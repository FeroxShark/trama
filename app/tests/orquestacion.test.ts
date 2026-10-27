// La orquestación de `pa` en la app (electron/orquestacion.ts): lecciones que piden poda, auditar una rama y la plantilla de
// AGENTS.md, todo con un `pa` falso (scripts/pa-falso.sh anota el argv) y un estado de mentira.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-orq-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const LOG = path.join(tmp, "pa.log");
process.env.PA_FALSO_LOG = LOG;
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.PROYECTOS_REGISTRY = path.join(tmp, "sin-registry.json");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");

const { ejecutar } = await import("../electron/paneles.ts");
const { ENV } = await import("../electron/pa.ts");
const { argvAuditar, datosAgentsMd, guardarLecciones, leccionesPendientes, leerLecciones, marcaPoda, modeloAuditable, textoPoda } = await import("../electron/orquestacion.ts");

const ID = "20261003-100900-13131";
const estado = path.join(tmp, "estado-pa");
const lineas = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n") : []);
const larga = (n: number) => Array.from({ length: n }, (_, i) => `- 2026-10-26 lección ${i}\n`).join("");

test("las lecciones que piden poda salen de la marca lecciones.necesita-poda de cada proyecto", async () => {
  assert.deepEqual(await leccionesPendientes(path.join(tmp, "no-existe")), []);
  mkdirSync(path.join(estado, "atlas"), { recursive: true });
  mkdirSync(path.join(estado, "brote"), { recursive: true });
  writeFileSync(path.join(estado, "atlas", "lecciones.necesita-poda"), "34 líneas, 3410 caracteres (tope 30 / 3000)\n");
  assert.deepEqual(await leccionesPendientes(estado), [{ proyecto: "atlas", motivo: "34 líneas, 3410 caracteres (tope 30 / 3000)" }]);
});

test("podar con un agente: el texto es el de `pa <proy> --lecciones-podar`", async () => {
  const t = await textoPoda("atlas", ejecutar);
  assert.match(t, /^Podá las lecciones de 'atlas'/);
  assert.match(lineas().at(-1)!, /atlas --lecciones-podar$/);
  await assert.rejects(textoPoda("-x", ejecutar), /raro|Invalid|proyecto/i);
});

test("editar a mano: guardar pasa el tope y la marca se va; si sigue pasado, se queda", async () => {
  const f = path.join(estado, "atlas", "lecciones.md");
  writeFileSync(f, larga(34));
  assert.equal((await leerLecciones(estado, "atlas")).split("\n").length, 35);
  assert.equal((await guardarLecciones(estado, "atlas", larga(12))).necesitaPoda, false);
  assert.equal(readFileSync(f, "utf8"), larga(12));
  assert.equal(existsSync(path.join(estado, "atlas", "lecciones.necesita-poda")), false);
  assert.equal((await guardarLecciones(estado, "atlas", larga(33))).necesitaPoda, true);
  assert.match(readFileSync(path.join(estado, "atlas", "lecciones.necesita-poda"), "utf8"), /^33 líneas, \d+ caracteres \(tope 30 \/ 3000\)\n$/);
  assert.equal(marcaPoda(larga(30)), null);
  assert.ok(marcaPoda("x".repeat(3001)));
  assert.equal(await leerLecciones(estado, "brote"), "");
});

test("guardar lecciones rechaza un proyecto raro (no sale de la carpeta de estado) y un texto que no es texto", async () => {
  await assert.rejects(guardarLecciones(estado, "../x", "a"));
  await assert.rejects(guardarLecciones(estado, "nuevo-que-no-existe", "a"));
  await assert.rejects(guardarLecciones(estado, "atlas", 5 as unknown as string));
  await assert.rejects(leerLecciones(estado, "a/b"));
});

test("auditar: `--auditar <id> -m <modelo> --async`, sólo con Claude, y llega a pa", async () => {
  assert.deepEqual(argvAuditar({ id: ID, proyecto: "atlas", modelo: "claude-sonnet-5-5" }, "Atlas Web"), ["Atlas Web", "--auditar", ID, "-m", "claude-sonnet-5-5", "--async"]);
  for (const m of ["claude-opus-5-5", "sonnet", "opus"]) assert.equal(modeloAuditable(m), true, m);
  for (const m of ["dsh:deepseek-v4", "opencode:big-pickle", "gemini-3-pro", "-m", "", "claude x", undefined]) assert.equal(modeloAuditable(m), false, String(m));
  assert.throws(() => argvAuditar({ id: ID, proyecto: "atlas", modelo: "dsh:deepseek" }, "atlas"));
  assert.throws(() => argvAuditar({ id: "../1", proyecto: "atlas", modelo: "sonnet" }, "atlas"));
  assert.throws(() => argvAuditar({ id: ID, proyecto: "atlas", modelo: "sonnet" }, "--matar"));
  const r = await ejecutar(argvAuditar({ id: ID, proyecto: "atlas", modelo: "claude-sonnet-5-5" }, "atlas"));
  assert.equal(r.rc, 0, r.dijo);
  assert.match(lineas().at(-1)!, new RegExp(`atlas --auditar ${ID} -m claude-sonnet-5-5 --async$`));
});

test("AGENTS.md: sin archivo trae la plantilla; con archivo, sólo el aviso", async () => {
  const falta = await datosAgentsMd("atlas", ejecutar);
  assert.equal(falta.existe, false);
  assert.match(falta.plantilla!, /^# AGENTS\.md/);
  assert.match(lineas().at(-1)!, /atlas --agents-md$/);
  const hay = await datosAgentsMd("atlas", (a) => ejecutar(a, { ...ENV, PA_FALSO_AGENTS_MD: "1" }));
  assert.deepEqual({ existe: hay.existe, plantilla: hay.plantilla }, { existe: true, plantilla: null });
  assert.match(hay.aviso, /ya tiene AGENTS\.md/);
});

test("pa --hilos --json trae `verificado: false` sólo donde se pide (y los demás no lo traen)", async () => {
  const r = await ejecutar(["--hilos", "--json"], { ...ENV, PA_FALSO_NOVERIF: "20261003-100000-11111" });
  const hilos = JSON.parse(r.out).hilos as { id: string; verificado?: boolean }[];
  assert.equal(hilos.find((h) => h.id === "20261003-100000-11111")?.verificado, false);
  assert.equal(hilos.filter((h) => h.verificado === false).length, 1);
});

test("los canales nuevos están en el contrato de máquinas", () => {
  const c = readFileSync(path.join(import.meta.dirname, "..", "electron", "maquinas-contrato.ts"), "utf8");
  for (const k of ["orq:auditar", "orq:lecciones", "orq:podaTexto", "orq:leccionesLeer", "orq:leccionesGuardar", "orq:agentsMd"]) assert.match(c, new RegExp(`"${k}": "(local|maquina)"`), k);
});
