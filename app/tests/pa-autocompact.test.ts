// `autocompact` y `efforts_permitidos` de modelos.json en `pa` (motor/bin/pa):
//   - --autocompact por modelo (por_modelo > defecto > de fábrica), PA_AUTOCOMPACT lo pisa; sin valor no se pasa el flag y medicion.tsv anota "nativo".
//   - un -m (excluir) o --effort (efforts_permitidos) que el dueño apagó se rechaza con exit 98; la lista -m a,b,c saltea los apagados.
// `claude` falso; HOME, estado y registry en un tmp: no toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-autocompact-"));
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
    FALSO_RESULT: BIEN,
    PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
    ...env,
  };
  for (const k of ["PA_WORKER", "PA_FASE", "PA_TAREA", "PA_AUTOCOMPACT", "PA_EFFORT", "PA_ASYNC", "PA_JEFE", "PA_JEFE_ID", "PA_TS", "PA_MAX_TURNS", "PA_PUESTOS", "PA_RECORTE"]) if (!(k in env)) delete e[k];
  return e;
};
function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, { encoding: "utf8", timeout: 90_000, env: entorno(env) });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const modelosJson = path.join(home, "modelos.json");
/** Corre pa con un modelos.json (o sin, con `null`) y devuelve lo que vio el claude falso. */
function corre(cfg: object | null, args: string[], env: Record<string, string> = {}) {
  if (cfg === null) rmSync(modelosJson, { force: true });
  else writeFileSync(modelosJson, JSON.stringify({ version: 1, ...cfg }));
  rmSync(argvFile, { force: true });
  const r = pa(["demo", "--sin-jefe", ...args, "tarea"], { TRAMA_MODELOS: cfg === null ? path.join(home, "no-hay.json") : modelosJson, ...env });
  const argv = existsSync(argvFile) ? readFileSync(argvFile, "utf8").split("\0").slice(0, -1) : [];
  return { ...r, argv, tiene: (f: string) => argv.includes(f), valor: (f: string) => argv[argv.indexOf(f) + 1] };
}
const ultimaFila = () => {
  const [h, ...filas] = readFileSync(path.join(estado, "medicion.tsv"), "utf8").trim().split("\n");
  const cols = h!.split("\t");
  return Object.fromEntries(filas.at(-1)!.split("\t").map((v, i) => [cols[i], v]));
};
const SONNET = ["-m", "claude-sonnet-5-5"];
const AC = { autocompact: { defecto: null, por_modelo: { haiku: 300000, sonnet: null, opus: null } } };

// ---- autocompact ------------------------------------------------------------------------------------------------

test("autocompact null (sonnet): pa no pasa --autocompact y medicion.tsv anota «nativo»", () => {
  const r = corre(AC, SONNET);
  assert.equal(r.rc, 0, r.err);
  assert.ok(r.argv.length > 0, "el claude falso corrió");
  assert.equal(r.tiene("--autocompact"), false);
  assert.equal(ultimaFila().autocompact, "nativo");
});

test("autocompact con un número (haiku 300000): pa pasa --autocompact 300000 y lo anota", () => {
  const r = corre(AC, ["-m", "claude-haiku-5-5"]);
  assert.equal(r.rc, 0, r.err);
  assert.equal(r.valor("--autocompact"), "300000");
  assert.equal(ultimaFila().autocompact, "300000");
});

test("autocompact: por_modelo gana a defecto, defecto vale para el resto, y un id exacto gana a la familia", () => {
  const cfg = { autocompact: { defecto: 250000, por_modelo: { sonnet: 150000, "claude-opus-5-5": null } } };
  assert.equal(corre(cfg, SONNET).valor("--autocompact"), "150000", "la familia");
  assert.equal(corre(cfg, ["-m", "claude-opus-5-5", "--effort", "high"]).tiene("--autocompact"), false, "el id exacto en null = nativo");
  assert.equal(corre(cfg, ["-m", "claude-haiku-5-5"]).valor("--autocompact"), "250000", "sin entrada: defecto (gana al de fábrica)");
});

test("sin modelos.json o sin la clave: sonnet nativo, haiku 300000 de fábrica; haiku: null lo deja nativo", () => {
  assert.equal(corre(null, SONNET).tiene("--autocompact"), false);
  assert.equal(corre({}, ["-m", "claude-haiku-5-5"]).valor("--autocompact"), "300000");
  assert.equal(corre({ autocompact: { por_modelo: { haiku: null } } }, ["-m", "claude-haiku-5-5"]).tiene("--autocompact"), false);
});

test("PA_AUTOCOMPACT pisa a modelos.json; «nativo» lo apaga; uno inválido se ignora con aviso", () => {
  const cfg = { autocompact: { defecto: null, por_modelo: { sonnet: 150000 } } };
  const a = corre(cfg, SONNET, { PA_AUTOCOMPACT: "400000" });
  assert.equal(a.valor("--autocompact"), "400000");
  assert.equal(ultimaFila().autocompact, "400000");
  assert.equal(corre(cfg, SONNET, { PA_AUTOCOMPACT: "nativo" }).tiene("--autocompact"), false);
  const mal = corre(cfg, SONNET, { PA_AUTOCOMPACT: "50" });
  assert.match(mal.err, /PA_AUTOCOMPACT='50' no va/);
  assert.equal(mal.valor("--autocompact"), "150000", "ignorada: vale modelos.json");
});

test("autocompact inválido en modelos.json: el archivo se ignora entero, con aviso", () => {
  const r = corre({ autocompact: { por_modelo: { sonnet: 5 } } }, SONNET);
  assert.equal(r.rc, 0, r.err);
  assert.match(r.err, /autocompact .* no va|no va \(autocompact/);
  assert.equal(r.tiene("--autocompact"), false);
});

test("--rinde lee una medicion.tsv con «nativo» y números en la columna autocompact", () => {
  const dir = path.join(estado, "rinde");
  mkdirSync(dir, { recursive: true });
  const hoy = new Date().toISOString().slice(0, 19) + "+00:00";
  const h = "fecha\tid\tproyecto\tmodelo\teffort\tleer\tseguir\tis_error\tnum_turns\tduration_s\ttokens\tcosto_usd\tbien\tplan\tcompactaciones\tautocompact\torigen\tcache_read\tcache_creation\tephemeral_1h\tephemeral_5m\ttipo\tintegrada\tretrabajo\tcuenta";
  const fila = (id: string, ac: string) => [hoy, id, "proy", "claude-sonnet-5-5", "high", "0", "0", "false", "3", "10", "100", "0.1", "si", "pro", "0", ac, "jefe", "", "", "", "", "mecanico", "1", "0", "claude"].join("\t");
  const copia = path.join(estado, "medicion.tsv");
  const guardado = existsSync(copia) ? readFileSync(copia, "utf8") : null;
  try {
    writeFileSync(copia, `${h}\n${fila("a", "nativo")}\n${fila("b", "180000")}\n`);
    const t = pa(["--rinde", "--json"]);
    assert.equal(t.rc, 0, t.err);
    const celdas = JSON.parse(t.out).celdas;
    assert.equal(celdas.length, 1);
    assert.equal(celdas[0].n, 2, "las dos filas cuentan, sea cual sea el autocompact");
  } finally {
    if (guardado !== null) writeFileSync(copia, guardado);
  }
});

// ---- exclusiones del dueño: excluir y efforts_permitidos -------------------------------------------------------------

const SOLO_HIGH = { efforts_permitidos: { sonnet: ["high"] } };

test("efforts_permitidos {sonnet:[high]}: sonnet --effort medium se rechaza (exit 98); high y sin --effort corren", () => {
  const no = corre(SOLO_HIGH, [...SONNET, "--effort", "medium"]);
  assert.equal(no.rc, 98, no.err);
  assert.match(no.err, /effort 'medium' con 'claude-sonnet-5-5' está apagado en modelos\.json \(efforts_permitidos: high\)/);
  assert.equal(no.argv.length, 0, "no lanzó nada");
  const si = corre(SOLO_HIGH, [...SONNET, "--effort", "high"]);
  assert.equal(si.rc, 0, si.err);
  assert.equal(si.valor("--effort"), "high");
  assert.equal(corre(SOLO_HIGH, SONNET).valor("--effort"), "high", "sin --effort: el default de sonnet ya es high");
});

test("efforts_permitidos: PA_EFFORT también cuenta como pedido; --ok-dueno lo deja pasar; otra familia no se toca", () => {
  assert.equal(corre(SOLO_HIGH, SONNET, { PA_EFFORT: "low" }).rc, 98);
  const ok = corre(SOLO_HIGH, [...SONNET, "--effort", "low", "--ok-dueno"]);
  assert.equal(ok.rc, 0, ok.err);
  assert.equal(ok.valor("--effort"), "low");
  assert.equal(corre(SOLO_HIGH, ["-m", "claude-haiku-5-5", "--effort", "low"]).rc, 0, "haiku no tiene regla");
});

test("efforts_permitidos: sin --effort y con el de siempre apagado, va el primero permitido de la familia", () => {
  const r = corre({ efforts_permitidos: { haiku: ["low", "medium"] } }, ["-m", "claude-haiku-5-5"]);
  assert.equal(r.rc, 0, r.err);
  assert.equal(r.valor("--effort"), "low", "el default de haiku (xhigh) está apagado");
  assert.match(r.err, /sin --effort, uso low/);
  const id = corre({ efforts_permitidos: { "claude-sonnet-5-5": ["medium", "xhigh"] } }, SONNET);
  assert.equal(id.valor("--effort"), "medium", "la regla por id exacto también vale");
});

test("efforts_permitidos con lista vacía: el modelo no admite ningún effort (exit 98)", () => {
  const r = corre({ efforts_permitidos: { sonnet: [] } }, SONNET);
  assert.equal(r.rc, 98, r.err);
  assert.match(r.err, /no deja ningún effort/);
});

test("excluir: un -m excluido sale 98 (--ok-dueno lo deja pasar)", () => {
  const r = corre({ excluir: ["sonnet"] }, SONNET);
  assert.equal(r.rc, 98, r.err);
  assert.match(r.err, /excluido en modelos\.json/);
  assert.equal(corre({ excluir: ["sonnet"] }, [...SONNET, "--ok-dueno"]).rc, 0);
});

test("-m a,b,c saltea los apagados: excluir y efforts_permitidos; si no queda ninguno, sale 98", () => {
  const excl = corre({ excluir: ["opus"] }, ["-m", "claude-opus-5-5,claude-sonnet-5-5"]);
  assert.equal(excl.rc, 0, excl.err);
  assert.match(excl.err, /claude-opus-5-5 está excluido en modelos\.json .*lo salteo/);
  assert.equal(excl.valor("--model"), "claude-sonnet-5-5", "trabajó el segundo");
  const ef = corre(SOLO_HIGH, ["-m", "claude-sonnet-5-5,claude-haiku-5-5", "--effort", "medium"]);
  assert.equal(ef.rc, 0, ef.err);
  assert.match(ef.err, /claude-sonnet-5-5 está apagado en modelos\.json/);
  assert.equal(ef.valor("--model"), "claude-haiku-5-5");
  const nada = corre({ excluir: ["opus", "sonnet"] }, ["-m", "claude-opus-5-5,claude-sonnet-5-5"]);
  assert.equal(nada.rc, 98, nada.err);
  assert.match(nada.err, /todos los modelos de la lista están apagados/);
  assert.equal(nada.argv.length, 0);
});
