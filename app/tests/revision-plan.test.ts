// «Revisar con otro modelo»: el prompt, la lectura de lo que contesta el revisor, la marca del mensaje que recibe el líder, los
// revisores permitidos y la orquestación de punta a punta con un revisor simulado (sin gastar cupo).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearCola, type Encolado } from "../electron/cola.ts";
import { crearModificador, crearTrabajos, type Pendiente } from "../electron/revision-trabajo.ts";
import { LectorAgy, LectorClaude, LectorCodex } from "../electron/revision-flujo.ts";
import { codexListo, correrRevisor, falloDeRevisor, type RevisionEstado } from "../electron/revision-plan.ts";
import { esperarHasta } from "./esperar.ts";
import { esfuerzosDeRevisor } from "../src/hilo/esfuerzo-revisor.ts";
import { effortApagado, effortsPermitidosDe, esfuerzosRevisor, ADJUNTO_BYTES, ADJUNTOS_MAX, ADJUNTOS_TOTAL, archivosDelPlan, rutasDelPlan, leerMensajeRevision, mensajeParaLider, parsearRevision, promptRevisor, revisarPlan, revisoresPermitidos, respuestaDeAgy, type DepsRevision } from "../electron/revision-plan.ts";

const RESPUESTA = "## Qué está bien\n- El orden\n\n## Riesgos y huecos\n- Falta un test\n\n## Mejoras concretas\n- Agregar el test\n\n## Plan mejorado\n1. Test\n2. Código\n";

test("promptRevisor: lleva el pedido, el plan, las rutas y las cuatro secciones", () => {
  const p = promptRevisor({ plan: "# Plan\n1. Hacer X", pedido: "armá X", cwd: "/p/trama" });
  for (const s of ["armá X", "# Plan", "/p/trama", "## Qué está bien", "## Riesgos y huecos", "## Mejoras concretas", "## Plan mejorado"]) assert.ok(p.includes(s), s);
});

test("parsearRevision: parte las cuatro secciones; sin encabezados queda todo en libre", () => {
  const r = parsearRevision(RESPUESTA);
  assert.deepEqual([r.bien, r.riesgos, r.mejoras], ["- El orden", "- Falta un test", "- Agregar el test"]);
  assert.equal(r.plan, "1. Test\n2. Código");
  assert.equal(parsearRevision("Está bien, dale.").libre, "Está bien, dale.");
});

test("parsearRevision: un «## Riesgos» o «### Cambios» dentro del plan mejorado es parte del plan (B019)", () => {
  const r = parsearRevision("## Qué está bien\n- A\n\n## Riesgos y huecos\n- R1\n\n## Mejoras concretas\n- M1\n\n## Plan mejorado\n1. Paso\n\n## Riesgos\n- del plan\n\n### Cambios\n- otros");
  assert.equal(r.riesgos, "- R1");
  assert.equal(r.mejoras, "- M1");
  assert.equal(r.plan, "1. Paso\n\n## Riesgos\n- del plan\n\n### Cambios\n- otros");
});

test("el mensaje del líder va y vuelve con su marca (y un mensaje común no es una revisión)", () => {
  const m = mensajeParaLider("gemini-4-argon", "Gemini 4 Argon", parsearRevision(RESPUESTA));
  assert.match(m, /ExitPlanMode/);
  const v = leerMensajeRevision(m)!;
  assert.equal(v.modelo, "gemini-4-argon");
  assert.equal(v.nombre, "Gemini 4 Argon");
  assert.equal(v.riesgos, "- Falta un test");
  assert.equal(v.plan, "1. Test\n2. Código");
  assert.equal(leerMensajeRevision("hola"), null);
  assert.equal(leerMensajeRevision(mensajeParaLider("m", "M", parsearRevision("sin formato")))?.libre, "sin formato");
});

test("revisoresPermitidos: sólo Claude y Gemini, sin lo desactivado en Ajustes", () => {
  const ids = ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon", "ollama:qwen", "opencode:opencode/x-free"];
  assert.deepEqual(revisoresPermitidos(ids, []), ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-4-argon"]);
  assert.deepEqual(revisoresPermitidos(ids, ["opus", "gemini-4-argon"]), ["claude-sonnet-5-5"]);
});

test("respuestaDeAgy: el response del result; un error rechaza", () => {
  assert.equal(respuestaDeAgy('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"hola"}}\n'), "hola");
  assert.throws(() => respuestaDeAgy('{"event":"result","result":{"status":"ERROR","response":"sin red"}}\n'), /sin red/);
});

function deps(salida: string | Error): { d: DepsRevision; hecho: { prompt: string; negado: string[]; mandado: string[] } } {
  const hecho = { prompt: "", negado: [] as string[], mandado: [] as string[] };
  return {
    hecho,
    d: {
      correr: async (_m, _e, p) => {
        hecho.prompt = p;
        if (salida instanceof Error) throw salida;
        return salida;
      },
      pedidoOriginal: async () => "armá X",
      cwd: () => "/p/trama",
      nombre: () => "Gemini 4 Argon",
      negar: (m) => hecho.negado.push(m),
      entregar: async (t) => void hecho.mandado.push(t),
    },
  };
}

test("revisarPlan (revisor simulado): niega el plan, le manda la revisión al líder y devuelve la tarjeta", async () => {
  const { d, hecho } = deps(RESPUESTA);
  const v = await revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# Plan\n1. X" }, d);
  assert.ok(hecho.prompt.includes("armá X") && hecho.prompt.includes("# Plan"));
  assert.equal(hecho.negado.length, 1);
  assert.equal(hecho.mandado.length, 1);
  assert.equal(leerMensajeRevision(hecho.mandado[0])?.mejoras, "- Agregar el test");
  assert.equal(v.nombre, "Gemini 4 Argon");
  assert.equal(v.plan, "1. Test\n2. Código");
});

test("revisarPlan: si el revisor falla o no dice nada, el plan sigue pendiente (no se niega ni se manda nada)", async () => {
  for (const salida of [new Error("sin respuesta"), "   "]) {
    const { d, hecho } = deps(salida);
    await assert.rejects(revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# P" }, d));
    assert.deepEqual([hecho.negado, hecho.mandado], [[], []]);
  }
  await assert.rejects(revisarPlan({ modelo: "m", effort: "", plan: "  " }, deps("x").d));
});

test("rutasDelPlan: saca las rutas de archivo del texto, sin versiones ni dominios ni repetidas", () => {
  const r = rutasDelPlan("1. Tocar `app/electron/lider.ts` y ./src/a.css.\n2. Subir a v1.2 y mirar example.com, otra vez app/electron/lider.ts y README.md");
  assert.deepEqual(r, ["app/electron/lider.ts", "src/a.css", "README.md"]);
});

test("archivosDelPlan: sólo lo que está dentro del proyecto, con topes y sin secretos", async () => {
  // Rutas de la plataforma: en Windows la raíz lleva unidad y las claves tienen que coincidir con las que arma path.resolve.
  const dir = path.resolve(path.sep, "p", "trama");
  const en = (r: string) => path.join(dir, r);
  const grande = "x".repeat(ADJUNTO_BYTES + 500);
  const archivos: Record<string, string> = {
    [en("app/lider.ts")]: "export const a = 1;",
    [en("grande.md")]: grande,
    [en(".env")]: "CLAVE=secreta",
    [path.resolve(path.sep, "etc", "passwd")]: "root",
  };
  const d = { leer: async (r: string) => archivos[r], esArchivo: async (r: string) => r in archivos };
  const r = await archivosDelPlan("app/lider.ts grande.md .env ../../etc/passwd /etc/passwd falta.ts", dir, d);
  assert.deepEqual(r.map((a) => [a.ruta, a.cortado]), [["app/lider.ts", false], ["grande.md", true]]);
  assert.equal(r[1].texto.length, ADJUNTO_BYTES);
  assert.deepEqual(await archivosDelPlan("app/lider.ts", undefined, d), []);
  const muchos = Array.from({ length: 12 }, (_, i) => `f${i}.ts`);
  const m = Object.fromEntries(muchos.map((f) => [en(f), "y".repeat(9000)]));
  const rr = await archivosDelPlan(muchos.join(" "), dir, { leer: async (r) => m[r], esArchivo: async (r) => r in m });
  assert.ok(rr.length <= ADJUNTOS_MAX && rr.reduce((n, a) => n + a.texto.length, 0) <= ADJUNTOS_TOTAL);
});

test("revisarPlan: los archivos que pide `archivos` van pegados en el prompt del revisor", async () => {
  const { d, hecho } = deps(RESPUESTA);
  await revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# P\ntocar app/a.ts" }, { ...d, archivos: async () => [{ ruta: "app/a.ts", texto: "const SECRETO_VISIBLE = 1;", cortado: false }] });
  assert.ok(hecho.prompt.includes("### app/a.ts") && hecho.prompt.includes("SECRETO_VISIBLE"));
});

// ---- Entrega por la cola, progreso en vivo, cancelar y reintentar ----

const SID = "5a1f0c1d-0000-4000-8000-0000000000aa";
const tic = () => new Promise((r) => setImmediate(r));

test("la entrega con el líder respondiendo se encola (no se rechaza) y llega al terminar el turno", async () => {
  const llegaron: string[] = [];
  let disp: "ocupado" | "app" = "ocupado";
  const cola = crearCola({
    disponible: async () => disp,
    traer: async () => ({ ok: true }),
    mandar: async (_sid, x) => void llegaron.push(x.texto),
    total: async () => 1,
    textoError: () => "x",
    guardar: async () => {},
    avisar: () => {},
    puedeEnTurno: () => false,
    enTurno: async () => {},
    agrupar: 5,
  });
  const { d } = deps(RESPUESTA);
  // Como nucleo.ts: la revisión va a la cola del líder, que está respondiendo (ocupado).
  const entregar = async (texto: string) => cola.encolar(SID, { texto, modelo: "claude-opus-5-5", effort: "high" } as Omit<Encolado, "id">);
  const v = await revisarPlan({ modelo: "gemini-4-argon", effort: "high", plan: "# Plan\n1. X" }, { ...d, entregar });
  assert.equal(v.nombre, "Gemini 4 Argon");
  assert.deepEqual(llegaron, [], "con el líder respondiendo espera en la cola");
  disp = "app";
  void cola.libre(SID);
  await esperarHasta(() => llegaron.length === 1);
  assert.equal(leerMensajeRevision(llegaron[0])?.riesgos, "- Falta un test");
});

/** Los trabajos de revisión con un disco de mentira y los estados que se emiten anotados. */
function trabajos(extra: Partial<Parameters<typeof crearTrabajos>[0]> = {}) {
  let disco: Pendiente[] = [];
  const emitidos: RevisionEstado[] = [];
  let t = 1000;
  const tr = crearTrabajos({ ahora: () => (t += 1000), emitir: (e) => emitidos.push(e), leer: async () => disco, escribir: async (l) => void (disco = l), juntarMs: 1, ...extra });
  return { tr, emitidos, disco: () => disco };
}
const pedido = { sid: SID, planId: "p1", modelo: "claude-fable-5-2", effort: "high", plan: "# Plan\n1. X", nombre: "Fable 5.2" };

test("el progreso se actualiza con un revisor que emite pasos y texto; al final queda entregada", async () => {
  const { tr, emitidos, disco } = trabajos();
  const { d, hecho } = deps(RESPUESTA);
  let suelta!: () => void;
  const espera = new Promise<void>((r) => (suelta = r));
  const e0 = tr.iniciar(pedido, () => ({
    ...d,
    correr: async (_m, _e, _p, o) => {
      o.avance({ paso: { k: "leer", v: "app/a.ts" } });
      o.avance({ texto: "## Qué está" });
      await espera;
      o.avance({ paso: { k: "buscar", v: "mandar" } });
      return RESPUESTA;
    },
  }));
  assert.equal(e0.fase, "corriendo");
  await esperarHasta(() => emitidos.some((e) => e.pasos.length === 1));
  await esperarHasta(() => emitidos.some((e) => e.texto === "## Qué está"));
  assert.equal((await tr.estado(SID))?.fase, "corriendo");
  suelta();
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "hecha");
  const fin = (await tr.estado(SID))!;
  assert.deepEqual(fin.pasos.map((p) => p.v), ["app/a.ts", "mandar"]);
  assert.ok(fin.fin! > fin.inicio);
  assert.equal(hecho.mandado.length, 1);
  assert.deepEqual(disco(), [], "entregada: ya no queda en disco");
  assert.ok(emitidos.some((e) => e.fase === "entregando"));
});

test("si la entrega falla, la revisión queda en disco con un error traducible y «Reintentar entregar» la entrega", async () => {
  const { tr, disco } = trabajos();
  const { d, hecho } = deps(RESPUESTA);
  tr.iniciar(pedido, () => ({ ...d, entregar: async () => Promise.reject(new Error("se cayó la cola")) }));
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "fallo");
  const e = (await tr.estado(SID))!;
  assert.equal(e.reintentable, true);
  assert.match(e.error!, /i18n:main\.revisionNoEntro/);
  assert.equal(disco().length, 1);
  assert.equal(hecho.negado.length, 1, "el plan ya estaba negado: no se niega dos veces");
  const r = await tr.reintentar(SID, async (t) => void hecho.mandado.push(t));
  assert.equal(r.fase, "hecha");
  assert.equal(hecho.mandado.length, 1);
  assert.deepEqual(disco(), []);
});

test("cancelar mata al revisor: el plan sigue pendiente (nada negado ni entregado)", async () => {
  const { tr } = trabajos();
  const { d, hecho } = deps(RESPUESTA);
  let visto: AbortSignal | null = null;
  tr.iniciar(pedido, () => ({
    ...d,
    correr: (_m, _e, _p, o) =>
      new Promise((_ok, no) => {
        visto = o.señal;
        o.señal.addEventListener("abort", () => no(new Error("cortado")));
      }),
  }));
  await esperarHasta(() => visto !== null);
  assert.equal(tr.cancelar(SID), true);
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "cancelada");
  assert.deepEqual([hecho.negado, hecho.mandado], [[], []]);
  assert.equal(tr.cancelar(SID), false);
  // Y se puede empezar otra.
  assert.equal(tr.iniciar(pedido, () => deps(RESPUESTA).d).fase, "corriendo");
});

test("una revisión por líder: otra mientras corre se rechaza con un texto traducible", async () => {
  const { tr } = trabajos();
  tr.iniciar(pedido, () => ({ ...deps(RESPUESTA).d, correr: () => new Promise(() => {}) }));
  assert.throws(() => tr.iniciar(pedido, () => deps(RESPUESTA).d), /i18n:main\.revisionYaCorre/);
});

test("un fallo del revisor se dice en palabras simples: sin sesión, sin «salió 1»", () => {
  assert.match(falloDeRevisor("gemini", "error: authentication failed or timed out").message, /i18n:main\.revisorSinSesion.*Google AI Pro/s);
  const general = falloDeRevisor("claude", "salió 1: ").message;
  assert.doesNotMatch(general, /salió 1/);
  assert.match(falloDeRevisor("claude", "rate limit hit").message, /revisorFalloDetalle/);
});

test("los lectores del stream: Claude saca pasos y texto vivo; agy, herramientas y text_delta", () => {
  const c = new LectorClaude("/home/yo");
  assert.equal(c.linea('{"type":"stream_event","event":{"type":"message_start"}}'), null);
  assert.deepEqual(c.linea('{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hola"}}}'), { texto: "Hola" });
  assert.deepEqual(c.linea('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"/home/yo/a.ts"}}]}}'), { paso: { k: "leer", v: "~/a.ts" } });
  assert.deepEqual(c.linea('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"mandar"}}]}}'), { paso: { k: "buscar", v: "mandar" } });
  c.linea('{"type":"result","subtype":"success","is_error":false,"result":"FINAL"}');
  assert.equal(c.final, "FINAL");
  const f = new LectorClaude();
  f.linea('{"type":"result","subtype":"success","is_error":true,"result":"Not logged in"}');
  assert.equal(f.falla, "Not logged in");
  const a = new LectorAgy();
  assert.deepEqual(a.linea('{"event":"step_update","step_update":{"step_type":"agent_response","step_index":3,"text_delta":"Hola "}}'), { texto: "Hola " });
  assert.deepEqual(a.linea('{"event":"step_update","step_update":{"step_type":"agent_response","step_index":3,"text_delta":"mundo"}}'), { texto: "Hola mundo" });
  assert.deepEqual(a.linea('{"event":"step_update","step_update":{"step_type":"tool","step_index":4,"state":"ACTIVE","tool_name":"view_file","tool_info":{"parameters":{"AbsolutePath":"/p/x.ts"}}}}'), { paso: { k: "leer", v: "/p/x.ts" } });
  assert.equal(a.linea('{"event":"step_update","step_update":{"step_type":"tool","step_index":4,"state":"DONE","tool_name":"view_file"}}'), null);
});

test("effortsPermitidosDe: la regla se busca por id, por id sin esfuerzo o por familia; sin regla valen todos", () => {
  assert.equal(effortsPermitidosDe("claude-opus-5-5", null), null);
  assert.equal(effortsPermitidosDe("claude-opus-5-5", { sonnet: ["low"] }), null);
  assert.deepEqual(effortsPermitidosDe("claude-opus-5-5", { opus: ["high", "low"] }), ["low", "high"]);
  assert.deepEqual(effortsPermitidosDe("gemini-4-argon-high", { "gemini-4-argon": ["medium"], argon: ["low"] }), ["medium"]);
  assert.deepEqual(effortsPermitidosDe("gemini-4-hydrogen", { hydrogen: [] }), []);
  assert.equal(effortApagado("claude-opus-5-5", "max", { opus: ["low", "high"] }), true);
  assert.equal(effortApagado("claude-opus-5-5", "high", { opus: ["low", "high"] }), false);
  assert.equal(effortApagado("claude-opus-5-5", "", { opus: [] }), false);
});

test("esfuerzosRevisor: ofrece lo que el modelo corre y Ajustes deja prendido; el de entrada es el de fábrica y nunca max", () => {
  const todos = ["low", "medium", "high", "xhigh", "max"];
  assert.deepEqual(esfuerzosRevisor("claude-opus-5-5", todos, "high", null), { niveles: todos, defecto: "high" });
  // Apagados en Ajustes: no se ofrecen, y si cae el de fábrica queda `high` o, si tampoco, el más alto que no sea max.
  assert.deepEqual(esfuerzosRevisor("claude-opus-5-5", todos, "high", { opus: ["low", "medium", "max"] }), { niveles: ["low", "medium", "max"], defecto: "medium" });
  assert.equal(esfuerzosRevisor("claude-opus-5-5", todos, "max", null).defecto, "high");
  // Max sólo es el de entrada si es lo único que queda.
  assert.deepEqual(esfuerzosRevisor("claude-opus-5-5", todos, "high", { opus: ["max"] }), { niveles: ["max"], defecto: "max" });
  // Todo apagado o sin niveles (`off` no es un nivel): nada que ofrecer, se corre con el esfuerzo del modelo.
  assert.deepEqual(esfuerzosRevisor("claude-opus-5-5", todos, "high", { opus: [] }), { niveles: [], defecto: "" });
  assert.deepEqual(esfuerzosRevisor("ollama:x", ["off"], null, null), { niveles: [], defecto: "" });
});

test("esfuerzosDeRevisor: con la tabla de modelos de la ventana (Claude y Gemini)", () => {
  assert.deepEqual(esfuerzosDeRevisor("claude-opus-5-5", null), { niveles: ["low", "medium", "high", "xhigh", "max"], defecto: "high" });
  assert.deepEqual(esfuerzosDeRevisor("claude-opus-5-5", { opus: ["low", "xhigh"] }), { niveles: ["low", "xhigh"], defecto: "xhigh" });
  assert.deepEqual(esfuerzosDeRevisor("gemini-4-argon", null), { niveles: ["low", "medium", "high"], defecto: "high" });
  assert.deepEqual(esfuerzosDeRevisor("gemini-4-argon", { argon: ["low", "medium"] }), { niveles: ["low", "medium"], defecto: "medium" });
});

// --- ChatGPT (codex) de revisor, con scripts/codex-falso.mjs ---------------------------------------------------------------
const FALSO_CODEX = path.join(import.meta.dirname, "..", "scripts", "codex-falso.mjs");
const noWin = { skip: process.platform === "win32" ? "el codex falso es un script de Node con shebang" : false };

test("revisoresPermitidos: ChatGPT sólo entra con codex listo y si Ajustes no lo desactivó", () => {
  const ids = ["claude-opus-5-5", "codex:gpt-6.1-sol", "codex:gpt-6.1-luna"];
  assert.deepEqual(revisoresPermitidos(ids, []), ["claude-opus-5-5"]);
  assert.deepEqual(revisoresPermitidos(ids, [], true), ids);
  assert.deepEqual(revisoresPermitidos(ids, ["codex"], true), ["claude-opus-5-5"]);
  assert.deepEqual(revisoresPermitidos(ids, ["codex:gpt-6.1-sol"], true), ["claude-opus-5-5", "codex:gpt-6.1-luna"]);
});

test("codexListo: instalado y con sesión; sin sesión (o sin codex) no", noWin, async () => {
  const env = { ...process.env, HILOS_CODEX: FALSO_CODEX };
  assert.equal(await codexListo({ ...env, TRAMA_FALSO_CODEX_LOGIN: "1" }, os.homedir()), true);
  assert.equal(await codexListo({ ...env, TRAMA_FALSO_CODEX_LOGIN: "0" }, os.homedir()), false);
  assert.equal(await codexListo({ ...env, HILOS_CODEX: path.join(os.tmpdir(), "no-existe-codex") }, os.homedir()), false);
});

test("el lector del stream de codex: comandos y búsquedas son pasos, el mensaje es el texto vivo y el final; un turno fallido deja su motivo", () => {
  const l = new LectorCodex();
  assert.equal(l.linea('{"type":"thread.started","thread_id":"t"}'), null);
  assert.deepEqual(l.linea('{"type":"item.started","item":{"id":"i0","type":"command_execution","command":"bash -lc \'rg mandar\'"}}'), { paso: { k: "otro", v: "rg mandar" } });
  assert.deepEqual(l.linea('{"type":"item.started","item":{"type":"web_search","query":"node test"}}'), { paso: { k: "buscar", v: "node test" } });
  assert.deepEqual(l.linea('{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Hola"}}'), { texto: "Hola" });
  assert.equal(l.final, "Hola");
  l.linea('{"type":"turn.failed","error":{"message":"Not logged in"}}');
  assert.equal(l.falla, "Not logged in");
  assert.match(falloDeRevisor("codex", "Not logged in").message, /i18n:main\.revisorSinSesion.*ChatGPT.*codex login/s);
});

test("correrRevisor con ChatGPT: codex exec en sólo lectura, sin claves de OpenAI en el entorno del hijo, y la revisión llega al líder con su marca", noWin, async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "revisor-codex-"));
  const log = path.join(tmp, "codex.log");
  const antes = { ...process.env };
  Object.assign(process.env, { HILOS_CODEX: FALSO_CODEX, HILOS_STATE: tmp, TRAMA_FALSO_LOG: log, TRAMA_FALSO_MS: "5", OPENAI_API_KEY: "sk-no", CODEX_API_KEY: "sk-no" });
  try {
    const avances: string[] = [];
    const { d, hecho } = deps("");
    d.correr = (m, e, p, o) => correrRevisor(m, e, p, tmp, { ...o, avance: (a) => avances.push(a.texto ?? a.paso?.v ?? "") });
    d.nombre = () => "ChatGPT Sol";
    const v = await revisarPlan({ modelo: "codex:gpt-6.1-sol", effort: "high", plan: "# Plan\n1. X" }, d);
    assert.equal(hecho.negado.length, 1);
    assert.ok(hecho.mandado[0]!.startsWith('[[revision-de-plan modelo="codex:gpt-6.1-sol"'), hecho.mandado[0]!.slice(0, 80));
    assert.equal(v.modelo, "codex:gpt-6.1-sol");
    assert.ok(avances.some((t) => t.includes("eco:")), "el texto vivo llega por avance");
    const l = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1)!);
    assert.equal(l.args[0], "exec");
    assert.equal(l.args[l.args.indexOf("--sandbox") + 1], "read-only");
    assert.equal(l.args[l.args.indexOf("-m") + 1], "gpt-6.1-sol");
    assert.ok(l.args.includes('model_reasoning_effort="high"'));
    assert.deepEqual(l.env.filter((k: string) => /^(OPENAI|CODEX_API)/.test(k)), [], "sin claves de la API en el hijo");
    assert.ok(l.prompt.includes("# Plan"), "el prompt va por stdin");
  } finally {
    for (const k of ["HILOS_CODEX", "HILOS_STATE", "TRAMA_FALSO_LOG", "TRAMA_FALSO_MS", "OPENAI_API_KEY", "CODEX_API_KEY"]) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
});

test("correrRevisor con ChatGPT: si codex sale con error sin respuesta, el fallo se dice en palabras simples", noWin, async () => {
  const antes = process.env.HILOS_CODEX;
  process.env.HILOS_CODEX = FALSO_CODEX;
  try {
    // «morite» en el pedido hace que el codex falso escriba en stderr y salga con 1 sin responder.
    await assert.rejects(correrRevisor("codex:gpt-6.1-sol", "low", "morite", os.tmpdir()), /i18n:main\.revisorFalloDetalle.*ChatGPT/s);
  } finally {
    if (antes === undefined) delete process.env.HILOS_CODEX;
    else process.env.HILOS_CODEX = antes;
  }
});

test("una revisión no arranca si el líder ya tiene un debate vivo (B023)", async () => {
  let debate = true;
  const { tr, emitidos } = trabajos({ ocupado: (sid) => sid === SID && debate });
  const { d } = deps(RESPUESTA);
  assert.throws(() => tr.iniciar(pedido, () => d), /revisionYaCorre/);
  assert.equal(emitidos.length, 0);
  debate = false;
  assert.equal(tr.iniciar(pedido, () => d).fase, "corriendo");
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "hecha");
});

test("una revisión nueva descarta la guardada sin entregar de un plan viejo, y no se reintenta mientras corre (B024)", async () => {
  const { tr, disco } = trabajos();
  const { d } = deps(RESPUESTA);
  tr.iniciar(pedido, () => ({ ...d, entregar: async () => Promise.reject(new Error("se cayó la cola")) }));
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "fallo");
  const vieja = disco()[0]!.id;
  let suelta!: () => void;
  const espera = new Promise<void>((r) => (suelta = r));
  tr.iniciar({ ...pedido, planId: "p2" }, () => ({ ...deps(RESPUESTA).d, correr: async () => (await espera, RESPUESTA) }));
  await assert.rejects(tr.reintentar(SID, async () => {}), /revisionYaCorre/);
  await esperarHasta(() => !disco().some((p) => p.id === vieja));
  suelta();
  await esperarHasta(async () => (await tr.estado(SID))?.fase === "hecha");
  assert.deepEqual(disco(), []);
});

test("el archivo de pendientes se cambia de a una modificación: dos a la vez no se pisan (B025)", async () => {
  let disco: Pendiente[] = [];
  const mod = crearModificador(
    async () => {
      const copia = [...disco];
      await new Promise<void>((r) => setImmediate(r)); // lectura lenta: sin cola, la otra lee lo mismo y pisa
      return copia;
    },
    async (l) => void (disco = l),
  );
  const p = (id: string): Pendiente => ({ id, sid: id, planId: "x", modelo: "m", nombre: "M", mensaje: "t", inicio: 0 });
  await Promise.all([mod((l) => [...l, p("a")]), mod((l) => [...l, p("b")]), mod((l) => l.filter((x) => x.id !== "a"))]);
  assert.deepEqual(disco.map((x) => x.id), ["b"]);
});
