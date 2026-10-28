// Casos de paridad de los globales que usa la app todo el tiempo (app/electron/cli/pa/hilos.ts, hilo.ts, archivar.ts, revertir.ts,
// proyectos.ts, traspaso.ts, limpiar.ts): --hilos, --hilo, --archivar, --revertir, --proyectos, --renombrar, --traspaso y --limpiar.
// El bash (motor/bin/pa) contra electron/cli/pa.ts. Los ids son de hoy y de hace días (la ventana de --hilos es de 7), calculados una
// vez al cargar el módulo para que los dos lados vean los mismos.
import { spawnSync } from "node:child_process";
import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";

const SLUG = "proy"; // basename de c.proyecto
const FECHA = "2026-10-01T12:00:00+00:00";
const ahora = Math.floor(Date.now() / 1000);

/** `AAAAMMDD-HHMMSS-pid` de hace `dias` días (en UTC: el sandbox corre con TZ=UTC). */
function idDe(dias: number, hms: string, pid: number): string {
  const d = new Date(Date.now() - dias * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}-${hms}-${pid}`;
}

const ID_LISTO = idDe(0, "000101", 4301);
const ID_DECISION = idDe(0, "000102", 4302);
const ID_NADA = idDe(0, "000103", 4303);
const ID_MURIO = idDe(1, "101010", 4304);
const ID_MURIO_FIN = idDe(1, "101011", 4305);
const ID_INTEGRADA = idDe(2, "101010", 4306);
const ID_REVERTIDA = idDe(2, "101011", 4307);
const ID_DESCARTADA = idDe(2, "101012", 4308);
const ID_ARCHIVADA = idDe(1, "111111", 4309);
const ID_VIEJA = idDe(30, "101010", 4310);
const ID_COLA = idDe(0, "000104", 4311);
const ID_RUN = idDe(0, "000105", 4312);
const ID_RAMA = idDe(20, "101010", 4313);
const ID_ENTREGADO = idDe(3, "101010", 4314);
const ID_FRIO_OK = idDe(0, "000106", 4315);
const ID_FRIO_MODELO = idDe(0, "000107", 4316);
const ID_FRIO_DIR = idDe(0, "000108", 4317);
const ID_FRIO_VENCIDO = idDe(0, "000109", 4318);
const ID_SEGUIDA = idDe(0, "000110", 4319);

const dirEstado = (c: Contexto) => path.join(c.estado, SLUG);
function escribir(c: Contexto, rel: string, texto: string) {
  const f = path.join(c.estado, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, texto);
}
const hilo = (c: Contexto, id: string, texto: string) => escribir(c, `${SLUG}/${id}.hilo`, texto);
const salida = (c: Contexto, id: string, j: unknown) => escribir(c, `${SLUG}/${id}.json`, typeof j === "string" ? j : JSON.stringify(j));

function gitFijo(c: Contexto, ...a: string[]) {
  const r = spawnSync("git", ["-C", c.proyecto, ...a], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_DATE: FECHA, GIT_COMMITTER_DATE: FECHA, GIT_AUTHOR_NAME: "x", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "x", GIT_COMMITTER_EMAIL: "a@b" },
  });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
/** El commit inicial con fecha fija y la identidad del repo (los rebase y los revert de pa commitean). */
function fijo(c: Contexto) {
  gitFijo(c, "config", "user.email", "a@b");
  gitFijo(c, "config", "user.name", "x");
  gitFijo(c, "commit", "-q", "--amend", "--reset-author", "--allow-empty", "-m", "init");
}
function enMain(c: Contexto, archivos: Record<string, string>, msg = "main") {
  for (const [k, v] of Object.entries(archivos)) writeFileSync(path.join(c.proyecto, k), v);
  gitFijo(c, "add", "-A");
  gitFijo(c, "commit", "-q", "-m", msg);
}
/** Una rama de corrida con un commit (a.txt) y su `.corrida`. */
function corrida(c: Contexto, id: string, archivos: Record<string, string> | null, extra = "") {
  const rama = `pa/${SLUG}/${id}`;
  const base = gitFijo(c, "rev-parse", "HEAD");
  gitFijo(c, "checkout", "-q", "-b", rama);
  if (archivos) {
    for (const [k, v] of Object.entries(archivos)) writeFileSync(path.join(c.proyecto, k), v);
    gitFijo(c, "add", "-A");
    gitFijo(c, "commit", "-q", "-m", `trabajo de ${id}`);
  }
  gitFijo(c, "checkout", "-q", "main");
  escribir(c, `${SLUG}/${id}.corrida`, `ruta_trabajo=${c.proyecto}\nrama=${rama}\nbase=${base}\nproyecto=demo\norigen=\nleer=0\npuesto=1\njefe=\njefe_id=\n${extra}`);
}

const CABECERA = "fecha\tid\tproyecto\trama\trama_ppal\thead_antes\thead_despues\tcommits\tauto\taccion\n";
const fila = (id: string, accion: string, antes = "a".repeat(40), despues = "b".repeat(40), n = 1) =>
  `2026-10-20T10:00:00+00:00\t${id}\t${SLUG}\tpa/${SLUG}/${id}\tmain\t${antes}\t${despues}\t${n}\t0\t${accion}\n`;
const integradas = (c: Contexto, ...filas: string[]) => escribir(c, "integradas.tsv", CABECERA + filas.join(""));

const RESULT = (extra = "") => `RESULTADO: hice **lo** pedido\ncon dos líneas.\nARCHIVOS: a.ts\nVERIFICACION: ok\n${extra}`;
const jsonOk = (result: string, extra: Record<string, unknown> = {}) => ({
  type: "result",
  is_error: false,
  result,
  duration_ms: 125_000,
  session_id: "00000000-0000-0000-0000-000000000000",
  modelUsage: { "claude-haiku-5-5": { outputTokens: 10 }, "claude-sonnet-5-5": { outputTokens: 500 } },
  ...extra,
});

// ---------------------------------------------------------------- transcripts de Claude

const iso = (msAtras: number) => new Date(Date.now() - msAtras).toISOString();
const proj = (c: Contexto) => path.join(c.home, "claude-proyectos");
function transcript(c: Contexto, sid: string, lineas: unknown[]) {
  const d = path.join(proj(c), "-tmp-proy");
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, `${sid}.jsonl`), lineas.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n") + "\n");
}
const usuario = (texto: unknown, extra: Record<string, unknown> = {}) => ({ type: "user", timestamp: iso(600_000), message: { role: "user", content: texto }, ...extra });
const asistente = (id: string, contenido: unknown[], cwd: string, modelo = "claude-sonnet-5-5", ts = iso(60_000), usage: Record<string, unknown> = { input_tokens: 3, cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 0 } }) => ({
  type: "assistant",
  timestamp: ts,
  cwd,
  message: { id, model: modelo, content: contenido, usage },
});

/** Una corrida con `.json`, `.sid` y su transcript (para la caché: ok, vencida, otro modelo, otro directorio). */
function conCache(c: Contexto, id: string, sid: string, o: { modelo?: string; cwd?: string; ts?: string; modeloJson?: string } = {}) {
  hilo(c, id, `inicio=${ahora - 600}\ntarea=con caché ${id.slice(-4)}\nlanzo=jefe\n`);
  salida(c, id, jsonOk(RESULT(), { modelUsage: { [o.modeloJson ?? "claude-sonnet-5-5"]: { outputTokens: 5 } } }));
  escribir(c, `${SLUG}/${id}.sid`, `${sid}\n`);
  escribir(c, `${SLUG}/${id}.corrida`, `ruta_trabajo=${c.proyecto}\nrama=\nproyecto=demo\n`);
  transcript(c, sid, [
    usuario("la tarea del transcript", { cwd: c.proyecto }),
    asistente("m1", [{ type: "text", text: "listo" }], o.cwd ?? c.proyecto, o.modelo ?? "claude-sonnet-5-5", o.ts ?? iso(60_000)),
  ]);
}

/** Un estado con corridas de todos los tipos. */
function escenario(c: Contexto) {
  fijo(c);
  const inicioReciente = ahora - 3600;
  // listo, con decisión pendiente y con decisión «nada»
  hilo(c, ID_LISTO, `inicio=${inicioReciente}\ntarea=primera tarea\nmodelo=claude-sonnet-5-5\neffort=medium\ncuenta=extra\npuesto=2\njefe=shark\njefe_id=abc\nverificado=1\nsigue=seguir con lo otro\n`);
  salida(c, ID_LISTO, jsonOk(RESULT("DECISION: nada\nSIGUE: lo otro\n")));
  escribir(c, `${SLUG}/${ID_LISTO}.listo`, "salida=x\nrc=0\n");
  hilo(c, ID_DECISION, `inicio=${inicioReciente}\ntarea=una con decisión\nlanzo=jefe\n`);
  salida(c, ID_DECISION, jsonOk(RESULT("**DECISION:** elegir entre A y B\n\nSIGUE: después\n")));
  escribir(c, `${SLUG}/${ID_DECISION}.listo`, "salida=x\nrc=0\n");
  hilo(c, ID_NADA, `inicio=${inicioReciente}\ntarea=una con decisión nada\n`);
  salida(c, ID_NADA, jsonOk(RESULT("DECISION: Nada.\n")));
  escribir(c, `${SLUG}/${ID_NADA}.listo`, "salida=x\nrc=0\n");
  // sin .json: murió (una con la hora exacta de muerte y otra con la estimada por lo último que se movió)
  hilo(c, ID_MURIO, `inicio=${ahora - 90_000}\ntarea=murió sola\n`);
  escribir(c, `${SLUG}/${ID_MURIO}.err`, "boom\n");
  hilo(c, ID_MURIO_FIN, `inicio=${ahora - 90_000}\ntarea=murió con fin\nfin=${ahora - 80_000}\n`);
  // resueltas por integradas.tsv
  salida(c, ID_INTEGRADA, jsonOk(RESULT()));
  salida(c, ID_REVERTIDA, jsonOk(RESULT()));
  salida(c, ID_DESCARTADA, jsonOk(RESULT()));
  integradas(c, fila(ID_INTEGRADA, "integrada"), fila(ID_REVERTIDA, "integrada"), fila(ID_REVERTIDA, "revertida"), fila(ID_DESCARTADA, "descartada"));
  // archivada, entregada hace días, y una vieja que sale sólo con --todo
  hilo(c, ID_ARCHIVADA, `inicio=${ahora - 100_000}\narchivado=2026-10-27T10:00:00+00:00\ntarea=archivada\n`);
  salida(c, ID_ARCHIVADA, jsonOk(RESULT()));
  hilo(c, ID_ENTREGADO, `tarea=entregada hace días\nlanzo=app\nlibre=1\n`);
  salida(c, ID_ENTREGADO, jsonOk("sin bloque de resultado\nDECISION: algo que decidir\n"));
  salida(c, ID_VIEJA, jsonOk(RESULT()));
  // en cola, corriendo (colgada) y con una rama viva sin integrar de hace 20 días
  escribir(c, `${SLUG}/${ID_COLA}.pid`, `${process.pid}\n`);
  hilo(c, ID_COLA, `tarea=en cola\n`);
  escribir(c, `${SLUG}.running`, `id=${ID_RUN}\nproyecto=${SLUG}\npid=${process.pid}\ninicio=${ahora - 4000}\ntarea=corriendo ahora\n`);
  escribir(c, `${SLUG}.heartbeat`, `epoch=${ahora - 4000}\n`);
  hilo(c, ID_RUN, `tarea=la que corre\n`);
  corrida(c, ID_RAMA, { "a.txt": "ahí\n" });
  hilo(c, ID_RAMA, `tarea=con rama viva\n`);
  // la caché del transcript
  conCache(c, ID_FRIO_OK, "sid-ok");
  conCache(c, ID_FRIO_MODELO, "sid-modelo", { modelo: "claude-opus-5-5" });
  conCache(c, ID_FRIO_DIR, "sid-dir", { cwd: "/otro/lado" });
  conCache(c, ID_FRIO_VENCIDO, "sid-vencido", { ts: "2026-01-01T10:00:00.123Z" });
  // dos corridas de la misma sesión: la última es la que murió con el transcript
  hilo(c, ID_SEGUIDA, `tarea=seguida\n`);
  escribir(c, `${SLUG}/${ID_SEGUIDA}.sid`, "sid-ok\n");
}

/** El escenario sin nada vivo: lo vivo cambia su duración de un segundo al otro (sólo se mira en la salida de texto). */
function escenarioQuieto(c: Contexto) {
  escenario(c);
  escribir(c, `${SLUG}.running`, "");
  escribir(c, `${SLUG}/${ID_COLA}.pid`, "0\n");
}

const hilos = (nombre: string, args: string[], extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `globales: hilos ${nombre}`, args, rc: 0, ...extra });

// ---------------------------------------------------------------- --hilo: un transcript con de todo

const SID_TRANS = "sid-trans";
const ID_TRANS = idDe(0, "000120", 4320);
function conTranscript(c: Contexto) {
  fijo(c);
  hilo(c, ID_TRANS, `inicio=${ahora - 600}\ntarea=con transcript\n`);
  salida(c, ID_TRANS, jsonOk(RESULT()));
  escribir(c, `${SLUG}/${ID_TRANS}.sid`, `${SID_TRANS}\n`);
  const larga = "x".repeat(2100);
  transcript(c, SID_TRANS, [
    usuario("primera pregunta"),
    asistente("m1", [{ type: "text", text: "pienso" }], c.proyecto),
    // el mismo mensaje del asistente en dos fragmentos: se juntan
    asistente("m2", [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls", largo: larga, n: 3 } }], c.proyecto),
    asistente("m2", [{ type: "text", text: "listé" }], c.proyecto, "claude-sonnet-5-5", iso(50_000), { input_tokens: 9, output_tokens: 4 }),
    // tool_result: un mensaje de usuario sin texto, se descarta
    usuario([{ type: "tool_result", tool_use_id: "t1", content: "archivos" }]),
    usuario([{ type: "text", text: "con imagen" }, { type: "image", source: {} }], { isMeta: true, origin: { kind: "task-notification" } }),
    usuario([{ type: "image", source: {} }]),
    { ...asistente("m3", [{ type: "text", text: "de un sidechain" }], c.proyecto), isSidechain: true },
    { type: "system", subtype: "compact_boundary", timestamp: iso(40_000), content: "Conversation compacted" },
    { type: "system", subtype: "otro", timestamp: iso(40_000), content: "no entra" },
    usuario("resumen", { isCompactSummary: true }),
    { ...asistente("m4", [{ type: "text", text: "falló" }], c.proyecto), isApiErrorMessage: true, error: "rate_limit" },
    asistente("m5", [{ type: "thinking", thinking: "..." }], c.proyecto), // sin texto ni herramientas: se descarta
    "esto no es json",
    asistente("m6", [{ type: "text", text: "última" }, { type: "tool_use", id: "t2", name: "Read", input: { file: "a.ts" } }], c.proyecto, "claude-opus-5-5", iso(10_000), { output_tokens: 7 }),
  ]);
}
const hilo1 = (nombre: string, args: string[], rc = 0, extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `globales: hilo ${nombre}`, args, rc, ...extra });

// ---------------------------------------------------------------- revertir

const ID_REV = idDe(0, "000130", 4330);
const unaRama = (c: Contexto) => {
  fijo(c);
  corrida(c, ID_REV, { "a.txt": "hola\n" });
};
const integrar: Paso = { args: ["demo", "--integrar", ID_REV], rc: 0 };

// ---------------------------------------------------------------- proyectos y renombrar

const registro = (c: Contexto, proyectos: unknown) => writeFileSync(path.join(c.home, ".config", "proyectos", "registry.json"), typeof proyectos === "string" ? proyectos : JSON.stringify(proyectos));
const dosProyectos = (c: Contexto) => {
  mkdirSync(path.join(c.raiz, "Otro Proyecto"), { recursive: true });
  registro(c, {
    projects: [
      { name: "demo", path: c.proyecto },
      { name: "otro", path: path.join(c.raiz, "Otro Proyecto"), titulo: "Mi Otro", alias: ["segundo"] },
      { name: "tres", path: "~/tres", aliases: ["t3"] },
    ],
  });
};
const ren = (nombre: string, args: string[], rc: number, extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `globales: renombrar ${nombre}`, args, rc, ...extra });

// ---------------------------------------------------------------- traspaso

function paraTraspaso(c: Contexto) {
  escenario(c);
  escribir(c, "jefe/jefe-a.notas", Array.from({ length: 45 }, (_, i) => `2026-10-27 10:${String(i).padStart(2, "0")} · nota ${i + 1}`).join("\n") + "\n");
  // terminadas sin cobrar y cobradas: su .json es la salida
  const out = path.join(dirEstado(c), `${ID_LISTO}.json`);
  escribir(c, `${SLUG}/${ID_LISTO}.listo`, `salida=${out}\nrc=0\n`);
  escribir(c, `${SLUG}/${ID_DECISION}.listo`, `salida=${path.join(dirEstado(c), `${ID_DECISION}.json`)}\nrc=1\n`);
  escribir(c, `${SLUG}/${ID_NADA}.listo`, `salida=${path.join(c.raiz, "no-existe.json")}\n`);
  escribir(c, `${SLUG}/${ID_ENTREGADO}.entregado`, `salida=${path.join(dirEstado(c), `${ID_ENTREGADO}.json`)}\nrc=0\n`);
  escribir(c, `${SLUG}/${ID_FRIO_OK}.entregado`, `salida=${path.join(dirEstado(c), `${ID_FRIO_OK}.json`)}\nrc=0\n`);
  escribir(c, `${SLUG}/${ID_RAMA}.corrida`, `ruta_trabajo=${c.proyecto}\nrama=pa/${SLUG}/${ID_RAMA}\nproyecto=demo\njefe_id=jefe-b\n`);
  escribir(c, `${SLUG}.running`, `id=${ID_RUN}\nproyecto=${SLUG}\npid=${process.pid}\ninicio=${ahora - 4000}\ntarea=${"corriendo ñandú ".repeat(15)}\njefe_id=jefe-a\n`);
  escribir(c, `${SLUG}@2.running`, `id=${ID_COLA}\nproyecto=${SLUG}\npid=${process.pid}\ninicio=${ahora - 30}\ntarea=de otro jefe\njefe_id=jefe-b\n`);
  // una corrida con rama pendiente de mi jefe
  corrida(c, ID_FRIO_VENCIDO, { "b.txt": "pendiente\n" }, "");
  escribir(c, `${SLUG}/${ID_FRIO_VENCIDO}.corrida`, `ruta_trabajo=${c.proyecto}\nrama=pa/${SLUG}/${ID_FRIO_VENCIDO}\nproyecto=demo\njefe_id=jefe-a\n`);
}

// ---------------------------------------------------------------- limpiar

const dias = (n: number) => ahora - n * 86_400;
function build(c: Contexto, puesto: string, dir: string, viejo: boolean, bytes = 1000) {
  const wt = path.join(c.estado, "worktrees", puesto);
  mkdirSync(path.join(wt, dir), { recursive: true });
  writeFileSync(path.join(wt, ".git"), "gitdir: /no/existe\n");
  writeFileSync(path.join(wt, dir, "x.bin"), "x".repeat(bytes));
  writeFileSync(path.join(wt, "codigo.ts"), "export {};\n");
  if (viejo) for (const p of [path.join(wt, dir, "x.bin"), path.join(wt, dir), wt]) utimesSync(p, dias(30), dias(30));
}
const lim = (nombre: string, args: string[], extra: Partial<Caso> = {}): Caso => ({ herramienta: "pa-cli", nombre: `globales: limpiar ${nombre}`, args, rc: 0, ...extra });

export const casosGlobales: Caso[] = [
  // --- --hilos ---
  hilos("vacío, texto", ["--hilos"]),
  hilos("vacío, json", ["--hilos", "--json"]),
  hilos("opción que no va", ["--hilos", "--xx"], { rc: 2 }),
  hilos("de todo, texto", ["--hilos"], { preparar: escenario }),
  hilos("de todo, json", ["--hilos", "--json"], { preparar: (c) => escenarioQuieto }),
  hilos("de todo con --todo, json", ["--hilos", "--todo", "--json"], { preparar: (c) => escenarioQuieto }),
  hilos("de todo con --todo, texto", ["--hilos", "--todo"], { preparar: escenario }),
  hilos("sin jq: archivos rotos", ["--hilos", "--json"], {
    preparar: (c) => {
      hilo(c, ID_LISTO, "esto no es clave=valor\n=sin clave\nINICIO=1\ninicio=abc\ntarea=\n");
      salida(c, ID_LISTO, "{no es json");
      salida(c, ID_DECISION, "[1,2]");
      salida(c, ID_NADA, jsonOk(5 as unknown as string));
      hilo(c, ID_MURIO, "");
    },
  }),

  // --- --hilo ---
  hilo1("sin id", ["--hilo"], 2),
  hilo1("id con guion", ["--hilo", "-x"], 2),
  hilo1("opción que no va", ["--hilo", ID_TRANS, "--xx"], 2, { preparar: conTranscript }),
  hilo1("-n que no es número", ["--hilo", ID_TRANS, "-n", "x"], 2, { preparar: conTranscript }),
  hilo1("-n sin valor (el bash sale 1 callado)", ["--hilo", ID_TRANS, "-n"], 1, { preparar: conTranscript }),
  hilo1("--antes que no es número", ["--hilo", ID_TRANS, "--antes", "1.5"], 2, { preparar: conTranscript }),
  hilo1("corrida que no existe", ["--hilo", "20261028-101010-1"], 1),
  hilo1("sin transcript", ["--hilo", ID_LISTO, "--json"], 0, { preparar: (c) => (fijo(c), hilo(c, ID_LISTO, "tarea=x\n"), salida(c, ID_LISTO, jsonOk(RESULT()))) }),
  hilo1("transcript completo", ["--hilo", ID_TRANS, "--json"], 0, { preparar: conTranscript }),
  hilo1("sin --json", ["--hilo", ID_TRANS], 0, { preparar: conTranscript }),
  hilo1("los 2 últimos", ["--hilo", ID_TRANS, "-n", "2"], 0, { preparar: conTranscript }),
  hilo1("-n 2 antes del 4", ["--hilo", ID_TRANS, "--json", "-n", "2", "--antes", "4"], 0, { preparar: conTranscript }),
  hilo1("--antes pasado de largo", ["--hilo", ID_TRANS, "--antes", "999"], 0, { preparar: conTranscript }),
  hilo1("-n 0", ["--hilo", ID_TRANS, "-n", "0"], 0, { preparar: conTranscript }),
  hilo1("el sid sale del .json", ["--hilo", ID_TRANS], 0, {
    preparar: (c) => {
      conTranscript(c);
      escribir(c, `${SLUG}/${ID_TRANS}.sid`, "");
      salida(c, ID_TRANS, jsonOk(RESULT(), { session_id: SID_TRANS }));
    },
  }),

  // --- --archivar ---
  { herramienta: "pa-cli", nombre: "globales: archivar sin id", args: ["--archivar"], rc: 2 },
  { herramienta: "pa-cli", nombre: "globales: archivar corrida que no existe", args: ["--archivar", "20261028-101010-1"], rc: 1 },
  {
    herramienta: "pa-cli",
    nombre: "globales: archivar y verla archivada",
    preparar: escenarioQuieto,
    pasos: [{ args: ["--archivar", ID_LISTO], rc: 0 }, { args: ["--hilos", "--json"], rc: 0 }],
  },
  {
    herramienta: "pa-cli",
    nombre: "globales: archivar con la forma <proyecto> --archivar <id>",
    preparar: escenario,
    args: ["demo", "--archivar", ID_ENTREGADO],
    rc: 0,
  },
  { herramienta: "pa-cli", nombre: "globales: archivar con la corrida viva (92)", preparar: escenario, args: ["--archivar", ID_RUN], rc: 92 },
  { herramienta: "pa-cli", nombre: "globales: archivar con la corrida en cola (92)", preparar: escenario, args: ["--archivar", ID_COLA], rc: 92 },
  {
    herramienta: "pa-cli",
    nombre: "globales: archivar dos veces",
    preparar: escenario,
    pasos: [{ args: ["--archivar", ID_ENTREGADO], rc: 0 }, { args: ["--archivar", ID_ENTREGADO], rc: 0 }],
  },

  // --- --revertir ---
  { herramienta: "pa-cli", nombre: "globales: revertir sin id", args: ["--revertir"], rc: 2 },
  { herramienta: "pa-cli", nombre: "globales: revertir corrida que no existe", args: ["--revertir", "20261028-101010-1"], rc: 1 },
  { herramienta: "pa-cli", nombre: "globales: revertir una que nunca se integró", preparar: unaRama, args: ["--revertir", ID_REV], rc: 1 },
  {
    herramienta: "pa-cli",
    nombre: "globales: revertir una ya revertida",
    preparar: (c) => (fijo(c), integradas(c, fila(ID_REV, "integrada"), fila(ID_REV, "revertida"))),
    args: ["--revertir", ID_REV],
    rc: 1,
  },
  { herramienta: "pa-cli", nombre: "globales: revertir una descartada", preparar: (c) => (fijo(c), integradas(c, fila(ID_REV, "descartada"))), args: ["--revertir", ID_REV], rc: 1 },
  { herramienta: "pa-cli", nombre: "globales: revertir una integración sin commits (91)", preparar: (c) => (fijo(c), integradas(c, fila(ID_REV, "integrada", "a".repeat(40), "a".repeat(40), 0))), args: ["--revertir", ID_REV], rc: 91 },
  { herramienta: "pa-cli", nombre: "globales: revertir con HEAD que no la contiene", preparar: (c) => (fijo(c), integradas(c, fila(ID_REV, "integrada"))), args: ["--revertir", ID_REV], rc: 1 },
  { herramienta: "pa-cli", nombre: "globales: integrar y revertir", preparar: unaRama, pasos: [integrar, { args: ["--revertir", ID_REV], rc: 0 }] },
  {
    herramienta: "pa-cli",
    nombre: "globales: revertir con la forma <proyecto> --revertir <id>",
    preparar: unaRama,
    pasos: [integrar, { args: ["demo", "--revertir", ID_REV], rc: 0 }],
  },
  {
    herramienta: "pa-cli",
    nombre: "globales: revertir dos veces",
    preparar: unaRama,
    pasos: [integrar, { args: ["--revertir", ID_REV], rc: 0 }, { args: ["--revertir", ID_REV], rc: 1 }],
  },
  {
    herramienta: "pa-cli",
    nombre: "globales: revertir choca con lo que entró después (90)",
    preparar: unaRama,
    pasos: [
      integrar,
      {
        args: (c) => {
          enMain(c, { "a.txt": "cambió después\n" });
          return ["--revertir", ID_REV];
        },
        rc: 90,
      },
    ],
  },
  {
    herramienta: "pa-cli",
    nombre: "globales: revertir con sucio lo que toca (89)",
    preparar: unaRama,
    pasos: [
      integrar,
      {
        args: (c) => {
          writeFileSync(path.join(c.proyecto, "a.txt"), "sucio\n");
          return ["--revertir", ID_REV];
        },
        rc: 89,
      },
    ],
  },

  // --- --proyectos ---
  { herramienta: "pa-cli", nombre: "globales: proyectos, tabla", args: ["--proyectos"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos, json", args: ["--proyectos", "--json"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos varios, tabla", preparar: dosProyectos, args: ["--proyectos"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos varios, json", preparar: dosProyectos, args: ["--proyectos", "--json"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos con el registry vacío", preparar: (c) => registro(c, { projects: [] }), args: ["--proyectos"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos con el registry vacío, json", preparar: (c) => registro(c, { projects: [] }), args: ["--proyectos", "--json"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: proyectos con el registry roto", preparar: (c) => registro(c, "{no"), args: ["--proyectos"], rc: 0 },
  {
    herramienta: "pa-cli",
    nombre: "globales: proyectos sin registry (1)",
    args: ["--proyectos"],
    env: (c) => ({ PROYECTOS_REGISTRY: path.join(c.raiz, "no-hay.json") }),
    rc: 1,
  },

  // --- --renombrar ---
  ren("sin argumentos", ["--renombrar"], 2),
  ren("sin nombre", ["--renombrar", "demo"], 2),
  ren("proyecto que no existe", ["--renombrar", "fantasma", "X"], 1),
  ren("poner un nombre", ["--renombrar", "demo", "  Mi Demo  "], 0, { pasos: [{ args: ["--renombrar", "demo", "  Mi Demo  "], rc: 0 }, { args: ["--proyectos", "--json"], rc: 0 }] }),
  ren("poner y usarlo como alias", ["--renombrar", "demo", "Mi Demo"], 0, {
    pasos: [{ args: ["--renombrar", "demo", "Mi Demo"], rc: 0 }, { args: ["Mi Demo", "--ramas"], rc: 0 }],
  }),
  ren("sacarlo", ["--renombrar", "otro", "--quitar"], 0, {
    preparar: dosProyectos,
    pasos: [{ args: ["--renombrar", "otro", "--quitar"], rc: 0 }, { args: ["--proyectos"], rc: 0 }],
  }),
  ren("igual al nombre del registry lo saca", ["--renombrar", "otro", "otro"], 0, {
    preparar: dosProyectos,
    pasos: [{ args: ["--renombrar", "otro", "otro"], rc: 0 }, { args: ["--proyectos", "--json"], rc: 0 }],
  }),
  ren("vacío", ["--renombrar", "demo", ""], 2),
  ren("de puros espacios", ["--renombrar", "demo", "   "], 2),
  ren("de más de 40 caracteres", ["--renombrar", "demo", "x".repeat(41)], 2),
  ren("de exactamente 40", ["--renombrar", "demo", "ñ".repeat(40)], 0),
  ren("que empieza con guion", ["--renombrar", "demo", "-x"], 2),
  ren("con salto de línea", ["--renombrar", "demo", "a\nb"], 2),
  ren("ya es el nombre de otro", ["--renombrar", "demo", "OTRO"], 2, { preparar: dosProyectos }),
  ren("ya es el slug de otro", ["--renombrar", "demo", "Otro-Proyecto"], 2, { preparar: dosProyectos }),
  ren("ya es el nombre para mostrar de otro", ["--renombrar", "demo", "mi otro"], 2, { preparar: dosProyectos }),
  ren("ya es un alias de otro", ["--renombrar", "demo", "SEGUNDO"], 2, { preparar: dosProyectos }),
  ren("ya es un alias (aliases) de otro", ["--renombrar", "demo", "t3"], 2, { preparar: dosProyectos }),
  ren("conserva el nombre propio al repetirlo", ["--renombrar", "otro", "Mi Otro"], 0, { preparar: dosProyectos }),

  // --- --traspaso ---
  { herramienta: "pa-cli", nombre: "globales: traspaso vacío", args: ["--traspaso"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: traspaso con todo", preparar: paraTraspaso, args: ["--traspaso"], rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: traspaso de un jefe", preparar: paraTraspaso, args: ["--traspaso"], env: { PA_JEFE_ID: "jefe-a", PA_JEFE: "jefe uno" }, rc: 0 },
  { herramienta: "pa-cli", nombre: "globales: traspaso de otro jefe", preparar: paraTraspaso, args: ["--traspaso"], env: { PA_JEFE_ID: "jefe-b" }, rc: 0 },

  // --- --limpiar ---
  lim("sin worktrees", ["--limpiar"]),
  lim("sin worktrees, --si", ["--limpiar", "--si"]),
  lim("dry-run", ["--limpiar"], { preparar: (c) => (build(c, SLUG, "node_modules", true), build(c, `${SLUG}@2`, "target", true, 20000)) }),
  lim("lo reciente no se toca", ["--limpiar"], { preparar: (c) => (build(c, SLUG, "node_modules", false), build(c, `${SLUG}@2`, "target", true, 5000)) }),
  lim("PA_LIMPIAR_DIAS", ["--limpiar"], { preparar: (c) => build(c, SLUG, "node_modules", true), env: { PA_LIMPIAR_DIAS: "60" } }),
  lim("borra con --si", ["--limpiar", "--si"], {
    preparar: (c) => (build(c, SLUG, "node_modules", true, 3000), build(c, "otro@3", "dist", true, 2_000_000), build(c, "reciente", ".venv", false)),
    pasos: [{ args: ["--limpiar", "--si"], rc: 0 }, { args: ["--limpiar"], rc: 0 }],
  }),
];
