// Protocolo por fases (motor/docs/protocolo-orquestacion.txt, items 1, 2, 4 y 10) en `pa` y `reparto`:
//   1. `-m a,b,c`: lista de fallback.   2. exit 97 (OpenCode cortó por límite) + enfriamiento por modelo en reparto.
//   4. `--fase` / `--tarea` en medicion.tsv y `--rinde --por fase|tarea`.   10. `pa --rubrica` y `--rinde --rubrica`.
// `claude` y `opencode` falsos; HOME, estado y registry en un tmp: no toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-fases-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const home = path.join(tmp, "home");
const proy = path.join(tmp, "proy");
const estado = path.join(tmp, "estado");
const rep = path.join(tmp, "rep");
const shim = path.join(tmp, "shim");
for (const d of [path.join(home, ".config", "proyectos"), proy, estado, shim]) mkdirSync(d, { recursive: true });
const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("commit", "-q", "--allow-empty", "-m", "init");
writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));

const argvFile = path.join(tmp, "argv");
const BIEN = "RESULTADO: hecho\nARCHIVOS: ninguno\nVERIFICACION: npm test\n  ok 12 - todo pasa\nDECISION: nada\nSIGUE: nada";
writeFileSync(
  path.join(shim, "claude"),
  `#!/bin/bash
if [[ "$1" == --version ]]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\\0' "$@" > "${argvFile}"
printf '{"type":"result","is_error":false,"result":%s,"session_id":"%s","num_turns":2,"duration_ms":1000,"total_cost_usd":0.01}' "$(printf '%s' "$FALSO_RESULT" | jq -Rs .)" "$(cat /proc/sys/kernel/random/uuid)"
`,
);
chmodSync(path.join(shim, "claude"), 0o755);
// opencode falso: los modelos de FALSO_CORTE (separados por coma) cortan por límite (FreeUsageLimitError); el resto contesta bien.
// Anota en OC_LOG qué modelo corrió.
const ocLog = path.join(tmp, "oc.log");
const ocFalso = path.join(tmp, "opencode-falso.sh");
writeFileSync(
  ocFalso,
  `#!/bin/bash
if [[ "$1" == models ]]; then printf 'opencode/beam-free\\nopencode/big-pickle\\n'; exit 0; fi
cat >/dev/null
m=""; while [[ $# -gt 0 ]]; do [[ "$1" == -m ]] && m="$2"; shift; done
echo "$m" >> "${ocLog}"
if [[ ",\${FALSO_CORTE:-}," == *",$m,"* ]]; then
  echo '{"type":"error","error":{"name":"APIError","data":{"message":"FreeUsageLimitError: Free usage limit reached","statusCode":429}}}'
  echo "FreeUsageLimitError: 429 Too Many Requests" >&2
  exit 1
fi
echo '{"type":"step_start","sessionID":"ses_falso","part":{}}'
echo '{"type":"text","sessionID":"ses_falso","part":{"text":"RESULTADO: listo\\nARCHIVOS: ninguno\\nDECISION: nada\\nSIGUE: nada"}}'
echo '{"type":"step_finish","sessionID":"ses_falso","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(ocFalso, 0o755);
if (spawnSync("sh", ["-c", "command -v uuidgen"]).status !== 0) {
  writeFileSync(path.join(shim, "uuidgen"), "#!/bin/sh\ncat /proc/sys/kernel/random/uuid\n");
  chmodSync(path.join(shim, "uuidgen"), 0o755);
}

const entorno = (env: Record<string, string> = {}) => {
  const e: Record<string, string> = {
    ...(process.env as Record<string, string>),
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, ".config"),
    PA_STATE: estado,
    STATE: estado,
    PA_PROJ: path.join(home, "claude-proyectos"),
    PROYECTOS_REGISTRY: path.join(home, ".config", "proyectos", "registry.json"),
    TRAMA_MODELOS: path.join(home, "no-hay.json"),
    TRAMA_CLAVES: path.join(home, "no-hay.env"),
    REPARTO_STATE: rep,
    REPARTO_CLAUDE: "0",
    PA_REPARTO: "0",
    HILOS_OPENCODE: ocFalso,
    FALSO_RESULT: BIEN,
    PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
    ...env,
  };
  for (const k of ["PA_WORKER", "PA_FASE", "PA_TAREA", "PA_ENFRIAR_HORAS"]) if (!(k in env)) delete e[k];
  return e;
};
function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, { encoding: "utf8", timeout: 90_000, env: entorno(env) });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function reparto(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("python3", [path.join(MOTOR, "bin", "reparto"), ...args], { encoding: "utf8", timeout: 60_000, env: entorno(env) });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const ocCorridos = () => (existsSync(ocLog) ? readFileSync(ocLog, "utf8").split("\n").filter(Boolean) : []);
const limpiar = () => {
  rmSync(ocLog, { force: true });
  rmSync(rep, { recursive: true, force: true });
};
const BEAM = "opencode:opencode/beam-free";
const PICKLE = "opencode:opencode/big-pickle";
const medicion = () => {
  const [h, ...filas] = readFileSync(path.join(estado, "medicion.tsv"), "utf8").trim().split("\n");
  const cols = h!.split("\t");
  return filas.map((f) => Object.fromEntries(f.split("\t").map((v, i) => [cols[i], v])));
};
const hilos = () => readdirSync(path.join(estado, "proy")).filter((f) => f.endsWith(".hilo")).sort();

// ---- item 2: exit 97 y enfriamiento -------------------------------------------------------------------------------

test("reparto --enfriar/--enfriado/--horas: marca un modelo, dice hasta cuándo, y no toca a los demás", () => {
  limpiar();
  assert.equal(reparto(["--enfriado", BEAM]).rc, 1, "sin marca: no está enfriado");
  const e = reparto(["--enfriar", BEAM, "--horas", "2"]);
  assert.equal(e.rc, 0, e.err);
  const q = reparto(["--enfriado", BEAM]);
  assert.equal(q.rc, 0, "enfriado");
  assert.match(q.out.trim(), /^\d{4}-\d{2}-\d{2}T/, "imprime hasta cuándo");
  assert.equal(reparto(["--enfriado", PICKLE]).rc, 1, "otro modelo del mismo grupo no se enfría");
  // las horas vencidas no cuentan
  reparto(["--enfriar", PICKLE, "--horas", "0"]);
  assert.equal(reparto(["--enfriado", PICKLE]).rc, 1);
  // --olvidar-agotados lo limpia
  const o = reparto(["--olvidar-agotados"]);
  assert.equal(o.rc, 0, o.err);
  assert.equal(reparto(["--enfriado", BEAM]).rc, 1);
});

test("reparto --tipo: descarta el modelo enfriado y elige otro", () => {
  limpiar();
  const antes = JSON.parse(reparto(["--tipo", "mecanico", "--json"], { REPARTO_OPENCODE: "1" }).out);
  const elegido = antes.modelo as string;
  assert.ok(elegido.startsWith("opencode:"), `sin Claude gana un opencode (fue ${elegido})`);
  reparto(["--enfriar", elegido]);
  const despues = JSON.parse(reparto(["--tipo", "mecanico", "--json"], { REPARTO_OPENCODE: "1" }).out);
  assert.notEqual(despues.modelo, elegido, "el enfriado no se vuelve a elegir");
});

test("pa con OpenCode cortado por límite: sale 97 y ese modelo queda enfriado (el otro no)", () => {
  limpiar();
  const r = pa(["demo", "--sin-jefe", "-m", BEAM, "haceme algo"], { FALSO_CORTE: "opencode/beam-free" });
  assert.equal(r.rc, 97, r.err);
  assert.match(r.err, /OpenCode cortó por límite de uso con opencode:opencode\/beam-free/);
  assert.equal(reparto(["--enfriado", BEAM]).rc, 0, "beam-free enfriado");
  assert.equal(reparto(["--enfriado", PICKLE]).rc, 1, "big-pickle no");
});

// ---- item 1: -m a,b,c ---------------------------------------------------------------------------------------------

test("-m a,b,c: si el primero corta por límite (97) pasa al segundo y termina con su código", () => {
  limpiar();
  const r = pa(["demo", "--sin-jefe", "-m", `${BEAM},${PICKLE}`, "haceme algo"], { FALSO_CORTE: "opencode/beam-free" });
  assert.equal(r.rc, 0, r.err);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free", "opencode/big-pickle"]);
  assert.match(r.err, /sigo con el siguiente de la lista/);
});

test("-m a,b,c: los enfriados se saltean sin lanzarlos; todos enfriados → no lanza y sale distinto de 0", () => {
  limpiar();
  reparto(["--enfriar", BEAM]);
  const r = pa(["demo", "--sin-jefe", "-m", `${BEAM},${PICKLE}`, "haceme algo"]);
  assert.equal(r.rc, 0, r.err);
  assert.deepEqual(ocCorridos(), ["opencode/big-pickle"], "beam-free ni se lanzó");
  assert.match(r.err, /beam-free sigue enfriado/);
  limpiar();
  reparto(["--enfriar", BEAM]);
  reparto(["--enfriar", PICKLE]);
  const todos = pa(["demo", "--sin-jefe", "-m", `${BEAM},${PICKLE}`, "haceme algo"]);
  assert.notEqual(todos.rc, 0);
  assert.match(todos.err, /todos los modelos de la lista están enfriados/);
  assert.deepEqual(ocCorridos(), []);
});

test("-m a,b,c: un fallo que no es de cupo corta la lista; el último que falla deja su código; lista con hueco → 2", () => {
  limpiar();
  // el último de la lista corta por límite: sale 97 y no hay más a quién pasar
  const r = pa(["demo", "--sin-jefe", "-m", `${BEAM},${PICKLE}`, "haceme algo"], { FALSO_CORTE: "opencode/beam-free,opencode/big-pickle" });
  assert.equal(r.rc, 97, r.err);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free", "opencode/big-pickle"]);
  const vacio = pa(["demo", "--sin-jefe", "-m", `${BEAM},,${PICKLE}`, "haceme algo"]);
  assert.equal(vacio.rc, 2);
  assert.match(vacio.err, /modelo vacío/);
  // un "-m a,b" dentro del texto de la tarea no activa la lista
  limpiar();
  const texto = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "usá -m a,b para probar"]);
  assert.equal(texto.rc, 0, texto.err);
});

test("-m con un solo modelo: igual que siempre (una corrida, sin lista)", () => {
  limpiar();
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "haceme algo"]);
  assert.equal(r.rc, 0, r.err);
  assert.doesNotMatch(r.err, /lista de fallback|sigo con el siguiente/);
  const a = readFileSync(argvFile, "utf8").split("\0");
  assert.equal(a[a.indexOf("--model") + 1] ?? a[a.indexOf("-m") + 1], "claude-sonnet-5-5");
});

// ---- item 4: --fase / --tarea -------------------------------------------------------------------------------------

test("--fase y --tarea: van a medicion.tsv y al .hilo; env PA_FASE/PA_TAREA también sirven", () => {
  limpiar();
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--fase", "F5", "--tarea", "login-nuevo", "hacé el paso uno"]);
  assert.equal(r.rc, 0, r.err);
  const fila = medicion().at(-1)!;
  assert.equal(fila.fase, "F5");
  assert.equal(fila.tarea, "login-nuevo");
  const hilo = hilos().map((h) => readFileSync(path.join(estado, "proy", h), "utf8")).find((t) => t.startsWith("tarea=hacé el paso uno"))!;
  assert.match(hilo, /^fase=F5$/m);
  assert.match(hilo, /^tarea_id=login-nuevo$/m);
  const env = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "otra cosa"], { PA_FASE: "F6", PA_TAREA: "login-nuevo" });
  assert.equal(env.rc, 0, env.err);
  assert.equal(medicion().at(-1)!.fase, "F6");
  const sin = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "una más"]);
  assert.equal(sin.rc, 0, sin.err);
  assert.equal(medicion().at(-1)!.fase ?? "", "");
});

test("--fase/--tarea con valores raros → 2", () => {
  const f = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--fase", "fase uno", "x"]);
  assert.equal(f.rc, 2);
  assert.match(f.err, /--fase/);
  const t = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--tarea", "con espacios y/barras", "x"]);
  assert.equal(t.rc, 2);
  assert.match(t.err, /--tarea/);
});

test("--rinde --por fase|tarea agrupa por la columna; una medicion.tsv de antes (sin las columnas) se sigue leyendo", () => {
  const dir = path.join(estado, "viejo");
  mkdirSync(dir, { recursive: true });
  const hoy = new Date().toISOString().slice(0, 19) + "+00:00";
  const h = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta";
  const fila = (id: string) => [hoy, id, "proy", "claude-haiku-5-5", "xhigh", "0", "0", "false", "3", "10", "100", "0.1", "si", "pro", "0", "180000", "jefe", "", "", "", "", "mecanico", "1", "0", "claude"].join("\t");
  const viejo = path.join(estado, "viejo.tsv");
  writeFileSync(viejo, `${h}\n${fila("a")}\n${fila("b")}\n`);
  const copia = path.join(estado, "medicion.tsv");
  const guardado = readFileSync(copia, "utf8");
  try {
    writeFileSync(copia, readFileSync(viejo, "utf8"));
    const t = pa(["--rinde", "--json"]);
    assert.equal(t.rc, 0, t.err);
    assert.ok(JSON.parse(t.out).celdas?.length ?? JSON.parse(t.out).length >= 1);
    const f = pa(["--rinde", "--por", "fase", "--json"]);
    assert.equal(f.rc, 0, f.err);
    assert.match(f.out, /"\?"|"sin fase"|\?/, "las filas viejas caen en la celda sin fase");
    // ahora con filas nuevas: el header se actualiza solo y las dos formas conviven
    const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--fase", "F5", "--tarea", "t1", "nueva"]);
    assert.equal(r.rc, 0, r.err);
    const porFase = JSON.parse(pa(["--rinde", "--por", "fase", "--json"]).out);
    assert.match(JSON.stringify(porFase), /F5/);
    const porTarea = pa(["--rinde", "--por", "tarea"]);
    assert.equal(porTarea.rc, 0, porTarea.err);
    assert.match(porTarea.out, /t1/);
    const mal = pa(["--rinde", "--por", "cosa"]);
    assert.equal(mal.rc, 2);
  } finally {
    writeFileSync(copia, guardado);
  }
});

// ---- item 10: rúbrica -------------------------------------------------------------------------------------------

test("pa --rubrica: da la fila de la tabla (modelo, effort, tipo) y --json; filas 1 y 2 salen 3 (no se lanza)", () => {
  const caso = (resp: string) => {
    const r = pa(["--rubrica", resp, "--json"]);
    return { rc: r.rc, j: r.out.trim() ? JSON.parse(r.out) : null, err: r.err };
  };
  const f10 = caso("A=1 B=ejecutar C=completo D=bajo E=si");
  assert.equal(f10.rc, 0);
  assert.deepEqual([f10.j.fila, f10.j.modelo, f10.j.effort, f10.j.lanza], [10, "claude-haiku-5-5", "xhigh", true]);
  const f1 = caso("A=4 B=ejecutar C=completo D=bajo E=si");
  assert.equal(f1.rc, 3);
  assert.deepEqual([f1.j.fila, f1.j.lanza, f1.j.modelo], [1, false, null]);
  const f2 = caso("A=1 B=ejecutar C=ninguno D=bajo E=si");
  assert.equal(f2.rc, 3);
  assert.equal(f2.j.fila, 2);
  assert.equal(caso("A=1 B=ejecutar C=completo D=bajo E=no").j.fila, "3b");
  assert.equal(caso("A=1 B=decidir C=completo D=alto E=si").j.fila, 4);
  assert.equal(caso("A=1 B=decidir C=completo D=bajo E=si").j.fila, 5);
  assert.equal(caso("A=1 B=ejecutar C=parcial D=alto E=si").j.fila, 6);
  assert.equal(caso("A=1 B=ejecutar C=parcial D=bajo E=si").j.fila, 7);
  assert.equal(caso("A=2-3 B=ejecutar C=completo D=alto E=si").j.fila, "8b");
  const f9 = caso("A=1 B=ejecutar C=completo D=bajo E=si M=si");
  assert.deepEqual([f9.j.fila, f9.j.modelo, f9.j.tipo], [9, "opencode:opencode/glm-5.3-flash-free", "mecanico"]);
  const txt = pa(["--rubrica", "A=1 B=ejecutar C=completo D=bajo E=si"]);
  assert.match(txt.out, /^fila 10: -m claude-haiku-5-5 --effort xhigh/);
  assert.match(pa(["--rubrica", "A=5 B=ejecutar C=completo D=bajo E=si"]).out, /^fila 1: no se lanza/);
});

test("pa --rubrica con respuestas malas o incompletas → 2", () => {
  for (const mal of ["A=1 B=x C=completo D=bajo E=si", "A=1 B=ejecutar", "A=1 B=ejecutar C=completo D=bajo E=si Z=1", "suelto", "A=cero B=ejecutar C=completo D=bajo E=si"]) {
    const r = pa(["--rubrica", mal]);
    assert.equal(r.rc, 2, mal);
    assert.match(r.err, /--rubrica/);
  }
  assert.equal(pa(["--rubrica"]).rc, 2);
});

test("pa <p> --rubrica: lanza con el modelo/effort de la fila y anota rub_* en medicion.tsv; un -m explícito gana; filas 1/2 no lanzan", () => {
  limpiar();
  const resp = "A=1 B=decidir C=completo D=bajo E=si"; // fila 5: sonnet high
  const r = pa(["demo", "--sin-jefe", "--rubrica", resp, "haceme algo"]);
  assert.equal(r.rc, 0, r.err);
  let fila = medicion().at(-1)!;
  assert.equal(fila.modelo, "claude-sonnet-5-5");
  assert.equal(fila.effort, "high");
  assert.equal(fila.rub_fila, "5");
  assert.equal(fila.rub_modelo, "claude-sonnet-5-5");
  assert.match(fila.rubrica ?? "", /A=chico B=decidir/);
  const gana = pa(["demo", "--sin-jefe", "--rubrica", resp, "-m", "claude-haiku-5-5", "otra"]);
  assert.equal(gana.rc, 0, gana.err);
  fila = medicion().at(-1)!;
  assert.equal(fila.modelo, "claude-haiku-5-5", "el -m del jefe gana");
  assert.equal(fila.rub_modelo, "claude-sonnet-5-5", "pero la rúbrica anota lo que estimó");
  const antes = medicion().length;
  const no = pa(["demo", "--sin-jefe", "--rubrica", "A=9 B=ejecutar C=completo D=bajo E=si", "x"]);
  assert.equal(no.rc, 3, no.err);
  assert.equal(medicion().length, antes, "no corrió nada");
});

test("pa --rinde --rubrica: acierto por fila (corridas, cuántas corrieron con el modelo estimado, % de buenas)", () => {
  const j = JSON.parse(pa(["--rinde", "--rubrica", "--json"]).out);
  assert.ok(JSON.stringify(j).includes('"5"') || JSON.stringify(j).includes(":5"), "la fila 5 aparece");
  const t = pa(["--rinde", "--rubrica"]);
  assert.equal(t.rc, 0, t.err);
  assert.match(t.out, /fila\s*5|^5\b/m);
  assert.equal(pa(["--rinde", "--rubrica", "--por", "fase"]).rc, 2, "--por y --rubrica no se mezclan");
});

// Tabla v2 (motor/docs/protocolo-orquestacion-v2.md, sección 6), un caso por punto de la revisión de Opus (protocolo-revision-opus.md).
const rub = (resp: string, env: Record<string, string> = {}) => {
  const r = pa(["--rubrica", resp, "--json"], env);
  return { rc: r.rc, j: r.out.trim() ? JSON.parse(r.out) : null, err: r.err };
};

test("pa --rubrica v2 punto 1: A acepta chico|mediano|grande y los viejos 1|2-3|>3; mediano y grande cambian la fila", () => {
  assert.equal(rub("A=chico B=ejecutar C=parcial D=bajo E=si").j.fila, 7);
  assert.equal(rub("A=1 B=ejecutar C=parcial D=bajo E=si").j.fila, 7);
  for (const a of ["mediano", "2-3", "2", "3"]) {
    const r = rub(`A=${a} B=ejecutar C=parcial D=bajo E=si`);
    assert.deepEqual([r.rc, r.j.fila, r.j.lanza], [3, "7b", false], a);
  }
  for (const a of ["grande", ">3", "4"]) assert.deepEqual([rub(`A=${a} B=ejecutar C=parcial D=bajo E=si`).j.fila], [1], a);
  assert.equal(rub("A=chico B=ejecutar C=completo D=bajo E=si M=si").j.fila, 9, "la 9 (gratis) sólo con A chico");
  assert.equal(rub("A=mediano B=ejecutar C=completo D=bajo E=si M=si").j.fila, 10, "mediano no va a la 9");
  const mal = pa(["--rubrica", "A=enorme B=ejecutar C=completo D=bajo E=si"]);
  assert.equal(mal.rc, 2);
  assert.match(mal.err, /A='enorme' no va/);
});

test("pa --rubrica v2 punto 2: C=ninguno va primero: sale fila 2 aunque el tamaño sea grande o E=no", () => {
  for (const r of [
    "A=grande B=ejecutar C=ninguno D=bajo E=si I=si",
    "A=grande B=ejecutar C=ninguno D=bajo E=si",
    "A=mediano B=decidir C=ninguno D=alto E=no",
    "A=chico B=ejecutar C=ninguno D=alto E=no",
  ]) {
    const x = rub(r);
    assert.deepEqual([x.rc, x.j.fila, x.j.lanza], [3, 2, false], r);
  }
});

test("pa --rubrica v2 punto 3: 1b (grande indivisible, I=si) da Sonnet high, Opus medium con D=alto; sin I es la fila 1", () => {
  const b = rub("A=grande B=ejecutar C=completo D=bajo E=si I=si");
  assert.deepEqual([b.rc, b.j.fila, b.j.modelo, b.j.effort, b.j.lanza], [0, "1b", "claude-sonnet-5-5", "high", true]);
  const ba = rub("A=grande B=ejecutar C=parcial D=alto E=si I=si");
  assert.deepEqual([ba.j.fila, ba.j.modelo, ba.j.effort], ["1b", "claude-opus-5-5", "medium"]);
  const sinI = rub("A=grande B=ejecutar C=completo D=bajo E=si");
  assert.deepEqual([sinI.rc, sinI.j.fila, sinI.j.lanza], [3, 1, false]);
});

test("pa --rubrica v2 punto 4: una 1b que compactó (K=si) no vuelve a partir: estado final al dueño (tablero)", () => {
  limpiar();
  const k = rub("A=grande B=ejecutar C=completo D=bajo E=si I=si K=si");
  assert.deepEqual([k.rc, k.j.fila, k.j.lanza], [3, "1c", false]);
  const txt = pa(["--rubrica", "A=grande B=ejecutar C=completo D=bajo E=si I=si K=si"]);
  assert.match(txt.out, /^fila 1c: no se lanza\. .*al dueño \(tablero\)/);
  // la 1b que sí se lanza queda anotada con su id, y --rinde --rubrica la cuenta
  const l = pa(["demo", "--sin-jefe", "--rubrica", "A=grande B=ejecutar C=completo D=bajo E=si I=si", "x"]);
  assert.equal(l.rc, 0, l.err);
  assert.equal(medicion().at(-1)!.rub_fila, "1b");
  assert.match(pa(["--rinde", "--rubrica"]).out, /^1b\b/m);
});

test("pa --rubrica v2 punto 5: E=no da 3b (Sonnet high) con D=bajo y 3a (Opus medium) con D=alto", () => {
  const b = rub("A=chico B=ejecutar C=completo D=bajo E=no");
  assert.deepEqual([b.j.fila, b.j.modelo, b.j.effort], ["3b", "claude-sonnet-5-5", "high"]);
  const a = rub("A=chico B=ejecutar C=completo D=alto E=no");
  assert.deepEqual([a.j.fila, a.j.modelo, a.j.effort], ["3a", "claude-opus-5-5", "medium"]);
});

test("pa --rubrica v2 punto 6: nunca devuelve un modelo o effort que modelos.json apagó (exit 98); pa <p> tampoco lanza", () => {
  const con = { TRAMA_MODELOS: path.join(home, "modelos-rubrica.json") };
  writeFileSync(con.TRAMA_MODELOS, JSON.stringify({ version: 1, excluir: ["haiku"], efforts_permitidos: { sonnet: ["low", "medium"] } }));
  const ex = pa(["--rubrica", "A=chico B=ejecutar C=completo D=bajo E=si"], con); // fila 10: haiku excluido
  assert.equal(ex.rc, 98, ex.err);
  assert.match(ex.err, /excluye/);
  assert.equal(ex.out, "");
  const ef = rub("A=chico B=decidir C=completo D=bajo E=si", con); // fila 5: sonnet high, y sólo quedan low y medium
  assert.equal(ef.rc, 98);
  assert.match(ef.err, /apagado/);
  const ok = rub("A=chico B=ejecutar C=completo D=alto E=no", con); // fila 3a: opus medium, permitido
  assert.deepEqual([ok.rc, ok.j.fila, ok.j.modelo], [0, "3a", "claude-opus-5-5"]);
  limpiar();
  const medPath = path.join(estado, "medicion.tsv");
  const antes = existsSync(medPath) ? medicion().length : 0;
  const lanza = pa(["demo", "--sin-jefe", "--rubrica", "A=chico B=ejecutar C=completo D=bajo E=si", "x"], con);
  assert.equal(lanza.rc, 98, lanza.err);
  assert.equal(existsSync(medPath) ? medicion().length : 0, antes, "no corrió nada");
});
