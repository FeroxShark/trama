// El CLI de `pa` en TypeScript (etapa 5): textos copiados del bash (ayuda, contrato), parseo, la lista -m a,b,c, la rúbrica,
// modelos.json y la política entera con reparto/cuentas/motores falsos. Lo observable sin lanzar se compara además contra el
// bash en tests/paridad/casos-pa-cli.ts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import { AYUDA } from "../electron/cli/pa/ayuda.ts";
import { CIERRE_TAREA, CONTRATO, CONTRATO_AGY, CONTRATO_CODEX, SIN_JEFE } from "../electron/cli/pa/contrato.ts";
import { main, type Deps } from "../electron/cli/pa/cli.ts";
import type { Env, Io } from "../electron/cli/pa/entorno.ts";
import { Modelos, problemaModelos } from "../electron/cli/pa/modelos.ts";
import { correrLista, escanear, opcionesIniciales, parsearOpciones, partirLista } from "../electron/cli/pa/opciones.ts";
import type { Llamada } from "../electron/cli/pa/politica.ts";
import type { Reparto } from "../electron/cli/pa/programas.ts";
import { resolverRubrica } from "../electron/cli/pa/rubrica.ts";

const PA_BASH = path.join(import.meta.dirname, "..", "..", "motor", "bin", "pa");

function captura(): Io & { o: string; e: string } {
  const c = { o: "", e: "", out: (s: string) => void (c.o += s), err: (s: string) => void (c.e += s) };
  return c;
}

/** Un sandbox: HOME, estado, registry con el proyecto git `demo`, y un env limpio (sin PA_*). */
function sandbox(extra: Env = {}): { env: Env; raiz: string; proyecto: string; estado: string } {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "cli-pa-")));
  const home = path.join(raiz, "home");
  const proyecto = path.join(raiz, "demo");
  const estado = path.join(raiz, "estado");
  mkdirSync(path.join(home, ".config", "proyectos"), { recursive: true });
  mkdirSync(proyecto, { recursive: true });
  spawnSync("git", ["-C", proyecto, "init", "-q", "-b", "main"]);
  const reg = path.join(home, ".config", "proyectos", "registry.json");
  writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env: Env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|REPARTO_|CLAUDE)/.test(k)) env[k] = v;
  Object.assign(env, {
    HOME: home,
    USER: "gonza",
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: estado,
    PROYECTOS_REGISTRY: reg,
    TRAMA_MODELOS: path.join(home, "no-hay.json"),
    PA_JEFE: "",
    PA_JEFE_ID: "",
    ...extra,
  });
  return { env, raiz, proyecto, estado };
}

/** Un reparto de mentira: contesta lo que se le diga y anota las llamadas. */
function repartoFalso(o: { elegir?: { rc: number; salida: string }; tabla?: string; enfriado?: Record<string, string> } = {}): Reparto & { llamadas: string[] } {
  const llamadas: string[] = [];
  return {
    ruta: "/falso/reparto",
    llamadas,
    ejecutable: () => true,
    enfriado: async (m) => (llamadas.push(`enfriado ${m}`), o.enfriado?.[m] ?? null),
    elegir: async (t) => (llamadas.push(`elegir ${t}`), o.elegir ?? { rc: 1, salida: "" }),
    tabla: async () => (llamadas.push("tabla"), o.tabla ?? ""),
    cuentaPara: async () => "",
    plan: () => 0,
  };
}

/** Corre `pa` en proceso; `lanzar` guarda la llamada final en vez de lanzar un worker. */
async function pa(argv: string[], env: Env, deps: Deps = {}): Promise<{ rc: number; o: string; e: string; l: Llamada | null }> {
  const io = captura();
  let l: Llamada | null = null;
  const rc = await main(argv, env, io, {
    reparto: () => repartoFalso(),
    ...deps,
    proyecto: { lanzar: (x) => ((l = x), 0), ...deps.proyecto },
  });
  return { rc, o: io.o, e: io.e, l };
}

// ------------------------------------------------------------------------------------------- textos del bash

testPosix("la ayuda es la del encabezado de motor/bin/pa", () => {
  const r = spawnSync(PA_BASH, ["--ayuda"], { encoding: "utf8", env: { ...sandbox().env } as NodeJS.ProcessEnv });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(`${AYUDA.join("\n")}\n`, r.stdout);
});

testPosix("el contrato y sus variantes son copia literal del bash", () => {
  // Las asignaciones del bash, desde CONTRATO hasta antes de con_jefe, evaluadas en un bash aparte.
  const src = readFileSync(PA_BASH, "utf8");
  const bloque = src.slice(src.indexOf("\nCONTRATO='") + 1, src.indexOf("\ncon_jefe()"));
  const vars = ["CONTRATO", "CIERRE_TAREA", "SIN_JEFE", "CONTRATO_AGY", "CONTRATO_CODEX"];
  const r = spawnSync("bash", ["-c", `${bloque}\nfor v in ${vars.join(" ")}; do printf '%s\\0' "\${!v}"; done`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const [contrato, cierre, sinJefe, agy, codex] = r.stdout.split("\0");
  assert.equal(CONTRATO, contrato);
  assert.equal(CIERRE_TAREA, cierre);
  assert.equal(SIN_JEFE, sinJefe);
  assert.equal(CONTRATO_AGY, agy);
  assert.equal(CONTRATO_CODEX, codex);
});

// ------------------------------------------------------------------------------------------- parseo

test("parseo: valores, flags que exportan y la tarea", () => {
  const env: Env = { PA_EFFORT: "low" };
  const notas: string[] = [];
  const o = parsearOpciones(
    ["--max-turns", "007", "--effort", "HIGH", "--sin-jefe", "--sucio-mio", "--nota", "n1", "-m", "x", "hacé", "-m", "esto"],
    opcionesIniciales("demo", env, "max"),
    { env, io: captura(), dueno: "Gonza", anotar: (t) => notas.push(t) },
  );
  assert.equal(o.maxTurns, "7");
  assert.equal(o.esfuerzo, "high");
  assert.equal(env.PA_EFFORT, "high");
  assert.equal(env.PA_JEFE, "");
  assert.ok(o.aca && o.sucioMio && o.modeloDeM);
  assert.equal(o.modelo, "x");
  assert.equal(o.tarea, "hacé -m esto");
  assert.deepEqual(notas, ["n1"]);
  const p = parsearOpciones(["--max-turns", "0", "--ok-gonza", "--", "-a", "b"], opcionesIniciales("demo", {}, "pro"), {
    env: {},
    io: captura(),
    dueno: "Gonza",
    anotar: () => {},
  });
  assert.equal(p.maxTurns, "");
  assert.ok(p.okDueno);
  assert.equal(p.tarea, "-a b");
  assert.equal(opcionesIniciales("demo", {}, "pro").maxTurns, "100");
});

test("parseo: el escaneo de -m mira sólo la zona de flags", () => {
  assert.deepEqual(escanear(["--effort", "XHIGH", "-m", "a,b", "--espejo", "f", "tarea", "-m", "c"], {}, "Gonza"), { m: 3, esp: 5, ti: -1, ef: "xhigh", ok: false });
  assert.equal(escanear(["tarea -m a,b"], {}, "Gonza").m, -1);
  assert.equal(escanear(["--ok-dueno", "-m"], {}, "Gonza").ok, true);
  assert.deepEqual(partirLista("a,b,"), ["a", "b"]);
  assert.deepEqual(partirLista("a,,b"), ["a", "", "b"]);
});

test("-m a,b,c: saltea apagados y enfriados, sigue con 96 y se queda con el primer código final", async () => {
  const d = sandbox();
  const f = path.join(d.raiz, "modelos.json");
  writeFileSync(f, JSON.stringify({ version: 1, excluir: ["fable"] }));
  const io = captura();
  const args = ["-m", "claude-fable-5-1,claude-opus-5-5,claude-haiku-5-5,claude-sonnet-5-5", "tarea"];
  const intentos: [string, string][] = [];
  const rc = await correrLista(args, escanear(args, {}, "Gonza"), new Modelos({ ...d.env, TRAMA_MODELOS: f }, io), io, {
    enfriado: (m) => (m === "claude-opus-5-5" ? "las 15:00" : null),
    intento: (a, resto) => (intentos.push([a[1]!, resto]), a[1] === "claude-haiku-5-5" ? 96 : 0),
  });
  assert.equal(rc, 0);
  assert.deepEqual(intentos, [["claude-haiku-5-5", "claude-sonnet-5-5"], ["claude-sonnet-5-5", ""]]);
  assert.match(io.e, /claude-fable-5-1 está excluido en modelos.json \(excluir: fable\): lo salteo/);
  assert.match(io.e, /claude-opus-5-5 sigue enfriado hasta las 15:00/);
  assert.match(io.e, /claude-haiku-5-5 salió 96 .* sigo con el siguiente de la lista/);
});

// ------------------------------------------------------------------------------------------- rúbrica y modelos.json

test("rúbrica: filas de la tabla", () => {
  const m = new Modelos({ TRAMA_MODELOS: "/no/hay.json" }, captura());
  const fila = (t: string) => {
    const r = resolverRubrica(t, m, captura());
    return [r.rc, r.fila, r.modelo, r.effort];
  };
  assert.deepEqual(fila("A=chico B=ejecutar C=completo D=bajo E=si"), [0, "10", "claude-haiku-5-5", "xhigh"]);
  assert.deepEqual(fila("A=2-3 B=decidir C=completo D=alto E=si"), [0, "4", "claude-opus-5-5", "medium"]);
  assert.deepEqual(fila("A=mediano B=ejecutar C=parcial D=bajo E=si"), [3, "7b", "", ""]);
  assert.deepEqual(fila("A=mediano B=ejecutar C=parcial D=bajo E=si I=si"), [0, "7b", "claude-sonnet-5-5", "high"]);
  assert.deepEqual(fila("A=grande B=ejecutar C=completo D=bajo E=si I=si K=si"), [3, "1c", "", ""]);
  assert.deepEqual(fila("a=1 b=ejecutar c=completo d=alto e=no"), [0, "3a", "claude-opus-5-5", "medium"]);
  assert.equal(fila("A=chico B=ejecutar C=completo D=bajo")[0], 2);
});

test("modelos.json: validación, excluir y efforts_permitidos", () => {
  assert.equal(problemaModelos([]), "no es un objeto JSON");
  assert.equal(problemaModelos({ version: 1 }), "");
  assert.equal(problemaModelos({ version: 1, workers: { rapido: { modelo: "claude-x" } } }), "tipo de worker desconocido: rapido");
  assert.equal(problemaModelos({ version: 1, workers: { debug: "claude-x" } }), "", "un worker que no es objeto no tiene .modelo? que mostrar (como jq)");
  assert.match(problemaModelos({ version: 1, workers: { debug: null } }), /^workers.debug: modelo desconocido null/);
  assert.equal(problemaModelos({ version: 1, sin_cupo: "nunca" }), 'sin_cupo "nunca" (otro, esperar o fallar)');
  const d = sandbox();
  const f = path.join(d.raiz, "m.json");
  writeFileSync(f, JSON.stringify({ version: 1, excluir: ["agy:*", "claude-opus-5-5", "Haiku"], efforts_permitidos: { sonnet: ["high", "low"], "claude-sonnet-5-5": ["medium"] } }));
  const m = new Modelos({ TRAMA_MODELOS: f }, captura());
  assert.equal(m.excluidoPor("agy:gpt-oss-120b-medium"), "agy:*");
  assert.equal(m.excluidoPor("claude-opus-5-5-high"), "claude-opus-5-5");
  assert.equal(m.excluidoPor("claude-opus-5-50"), null);
  assert.equal(m.excluidoPor("CLAUDE-HAIKU-5-5"), "Haiku");
  assert.deepEqual(m.effortsPermitidosDe("claude-sonnet-5-5"), ["medium"]);
  assert.deepEqual(m.effortsPermitidosDe("claude-sonnet-4"), ["low", "high"]);
  assert.equal(m.effortsPermitidosDe("claude-opus-5-5"), null);
  assert.equal(m.effortApagado("claude-sonnet-4", "medium"), "low high");
});

test("modelos.json roto: avisa en cada consulta hasta la primera lectura del shell principal (como los $(…) del bash)", () => {
  const d = sandbox();
  const f = path.join(d.raiz, "roto.json");
  writeFileSync(f, "{");
  const io = captura();
  const m = new Modelos({ TRAMA_MODELOS: f }, io);
  m.clave("sin_cupo");
  m.excluidoPor("x");
  assert.equal(io.e.split("\n").filter(Boolean).length, 2);
  assert.equal(m.cargar(), false);
  m.clave("sin_cupo");
  assert.equal(io.e.split("\n").filter(Boolean).length, 3);
  assert.match(io.e, /no va \(no es JSON válido\); sigo con los modelos de siempre/);
});

// ------------------------------------------------------------------------------------------- la política entera

test("desde un líder de agy (TRAMA_LIDER_AGY=1) el worker sale --async solo; --leer y un líder común no", async () => {
  const d = sandbox({ PA_PLAN: "pro", PA_REPARTO: "0" });
  const solo = await pa(["demo", "-m", "claude-opus-5-5", "hacé algo"], { ...d.env, TRAMA_LIDER_AGY: "1" });
  assert.equal(solo.l?.async, true);
  assert.match(solo.e, /tu líder corre dentro de agy.*--async/);
  const leer = await pa(["demo", "--leer", "-m", "claude-opus-5-5", "mirá algo"], { ...d.env, TRAMA_LIDER_AGY: "1" });
  assert.equal(leer.l?.async, false);
  const comun = await pa(["demo", "-m", "claude-opus-5-5", "hacé algo"], d.env);
  assert.equal(comun.l?.async, false);
  assert.doesNotMatch(comun.e, /tu líder corre dentro de agy/);
  const hijo = await pa(["demo", "-m", "claude-opus-5-5", "hacé algo"], { ...d.env, TRAMA_LIDER_AGY: "1", PA_ASYNC: "1" });
  assert.equal(hijo.l?.async, false, "el hijo de --async ya es el background: no se relanza");
});

test("política: plan pro, opus sin --effort va medium y avisa el brief incompleto", async () => {
  const d = sandbox({ PA_PLAN: "pro", PA_REPARTO: "0" });
  const r = await pa(["demo", "-m", "claude-opus-5-5", "hacé algo"], d.env);
  assert.equal(r.rc, 0, r.e);
  assert.equal(r.l?.esfuerzo, "medium");
  assert.equal(r.l?.motor, "claude");
  assert.equal(r.l?.maxTurns, "100");
  assert.equal(r.l?.cuentaUsada, "claude");
  assert.match(r.e, /a la tarea le falta "Listo cuando" .* y "Cómo verificar"/);
});

test("política: reparto elige modelo y effort sin -m", async () => {
  const d = sandbox();
  const rep = repartoFalso({ elegir: { rc: 0, salida: JSON.stringify({ modelo: "claude-haiku-5-5", effort: "high", motivo: "barato|y\ncon cupo" }) } });
  const r = await pa(["demo", "--tipo", "debug", "Listo cuando: x. Cómo verificar: y"], d.env, { reparto: () => rep });
  assert.equal(r.rc, 0, r.e);
  assert.equal(r.l?.modelo, "claude-haiku-5-5");
  assert.equal(r.l?.esfuerzo, "high");
  assert.ok(r.l?.vinoDeReparto);
  assert.equal(r.l?.repartoTipoRelanzable, "debug");
  assert.match(r.e, /pa: reparto \(debug\) → claude-haiku-5-5 effort high: barato y con cupo\n/);
  assert.match(r.e, /pa: aviso: sin -m\. Sigo con claude-haiku-5-5 effort high/);
  assert.deepEqual(rep.llamadas, ["elegir debug", "tabla"]);
});

test("política: reparto todo lleno con sin_cupo=fallar sale 96; reparto colgado cae al default", async () => {
  const d = sandbox();
  const f = path.join(d.raiz, "m.json");
  writeFileSync(f, JSON.stringify({ version: 1, sin_cupo: "fallar" }));
  const lleno = repartoFalso({ elegir: { rc: 0, salida: JSON.stringify({ modelo: "claude-haiku-5-5", todo_lleno: true }) } });
  const r = await pa(["demo", "x"], { ...d.env, TRAMA_MODELOS: f }, { reparto: () => lleno });
  assert.equal(r.rc, 96);
  assert.match(r.e, /no hay cupo para codigo-acotado .* sin_cupo=fallar \(sin_cupo de modelos.json\): no lanzo/);
  const colgado = repartoFalso({ elegir: { rc: 124, salida: "" } });
  const s = await pa(["demo", "--leer", "x"], d.env, { reparto: () => colgado });
  assert.equal(s.rc, 0, s.e);
  assert.equal(s.l?.modelo, "claude-sonnet-5-5");
  assert.match(s.e, /pa: reparto falló \(timeout tras 15s\); sigo con claude-sonnet-5-5\./);
});

test("política: -m sin cupo avisa y sugiere otro; con sin_cupo=fallar no lanza", async () => {
  const d = sandbox();
  const f = path.join(d.raiz, "m.json");
  writeFileSync(f, JSON.stringify({ version: 1, sin_cupo: "fallar" }));
  const tabla = JSON.stringify({ modelos: [{ id: "claude-opus-5-5", agotado: true, vuelve: "mañana" }] });
  const rep = repartoFalso({ tabla, elegir: { rc: 0, salida: JSON.stringify({ modelo: "claude-sonnet-5-5", effort: "high" }) } });
  const r = await pa(["demo", "-m", "claude-opus-5-5", "x"], { ...d.env, TRAMA_MODELOS: f }, { reparto: () => rep });
  assert.equal(r.rc, 96);
  assert.match(r.e, /claude-opus-5-5 no tiene cupo ahora \(vuelve mañana\)\. Alternativa que sugiere reparto para codigo-acotado: -m claude-sonnet-5-5 --effort high\./);
});

test("política: agy que no va cae a su equivalente Claude; --seguir retoma el modelo de la corrida", async () => {
  const d = sandbox({ PA_REPARTO: "0" });
  const r = await pa(["demo", "-m", "Gemini-4-Argon-High", "x"], d.env, { motores: { chequearGemini: async () => "agy no está instalado" } });
  assert.equal(r.rc, 0, r.e);
  assert.equal(r.l?.modelo, "claude-opus-5-5");
  assert.equal(r.l?.esfuerzo, "medium");
  assert.equal(r.l?.geminiPedido, "gemini-4-argon-high");
  assert.match(r.e, /pa: gemini-4-argon-high → claude-opus-5-5 effort medium: agy no está instalado\./);

  const e = sandbox();
  mkdirSync(path.join(e.estado, "demo"), { recursive: true });
  writeFileSync(path.join(e.estado, "demo.session.ts"), "20260101-000000-1\n");
  writeFileSync(path.join(e.estado, "demo", "20260101-000000-1.hilo"), "modelo=claude-opus-5-5\neffort=xhigh\ncuenta=claude\n");
  const s = await pa(["demo", "--seguir", "seguí"], e.env);
  assert.equal(s.rc, 0, s.e);
  assert.equal(s.l?.modelo, "claude-opus-5-5");
  assert.equal(s.l?.esfuerzo, "xhigh");
  assert.equal(s.l?.cuentaSeguir, "claude");
});

test("lo que no está portado sale 70 sin hacer nada", async () => {
  const d = sandbox();
  const r = await pa(["--estado"], d.env);
  assert.equal(r.rc, 70);
  assert.match(r.e, /pa --estado todavía no está en el pa de TypeScript/);
  const s = await pa(["demo", "--ramas"], d.env);
  assert.equal(s.rc, 70);
  const t = await pa(["--estado"], d.env, { globales: { estado: () => 0 } });
  assert.equal(t.rc, 0);
});
