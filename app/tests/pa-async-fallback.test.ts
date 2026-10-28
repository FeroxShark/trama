// `-m a,b,c` con --async (motor/bin/pa): si OpenCode corta por límite (97) con el modelo lanzado, la MISMA corrida (mismo id,
// mismo puesto) sigue con el siguiente de la lista, y `--esperar --id` trae el resultado del último intento. Un `opencode`
// falso (como en pa-fases.test.ts): FALSO_CORTE son los modelos que cortan; anota en ocLog qué modelo corrió.
// HOME, estado y registry en un tmp: no toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-async-fb-"));
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

// claude falso: sólo `--version` (el jefe no lo usa en estas pruebas; la lista es de OpenCode).
writeFileSync(path.join(shim, "claude"), '#!/bin/bash\nif [[ "$1" == --version ]]; then echo "9.9.9 (Claude Code)"; exit 0; fi\nexit 1\n');
// opencode falso: FALSO_CORTE (separados por coma) cortan por límite; el resto contesta con el modelo que corrió.
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
echo "{\\"type\\":\\"text\\",\\"sessionID\\":\\"ses_falso\\",\\"part\\":{\\"text\\":\\"RESULTADO: corrio con $m\\\\nARCHIVOS: ninguno\\\\nDECISION: nada\\\\nSIGUE: nada\\"}}"
echo '{"type":"step_finish","sessionID":"ses_falso","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(ocFalso, 0o755);
chmodSync(path.join(shim, "claude"), 0o755);

const BEAM = "opencode:opencode/beam-free";
const PICKLE = "opencode:opencode/big-pickle";
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
    PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
    ...env,
  };
  for (const k of Object.keys(e)) if (k.startsWith("PA_") && !(k in env) && k !== "PA_STATE") delete e[k];
  return e;
};
function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, { encoding: "utf8", timeout: 90_000, env: entorno(env) });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function reparto(args: string[]) {
  return spawnSync("python3", [path.join(MOTOR, "bin", "reparto"), ...args], { encoding: "utf8", timeout: 60_000, env: entorno() });
}
const limpiar = () => {
  rmSync(ocLog, { force: true });
  rmSync(rep, { recursive: true, force: true });
};
const ocCorridos = () => (existsSync(ocLog) ? readFileSync(ocLog, "utf8").split("\n").filter(Boolean) : []);
/** Lanza con --async y devuelve el id que imprime pa. */
function lanzar(args: string[], env: Record<string, string>) {
  const r = pa(["demo", "--sin-jefe", "--async", ...args], env);
  assert.equal(r.rc, 0, r.err);
  const id = /--id (\S+)/.exec(r.out)?.[1];
  assert.ok(id, r.out);
  return id;
}
/** `--esperar --id` de esa corrida; el log de la corrida (lo que el hijo dijo por stderr) va en `log`. */
function esperar(id: string) {
  const e = pa(["--esperar", "demo", "--id", id]);
  const log = readFileSync(path.join(estado, "proy", `${id}.log`), "utf8");
  return { ...e, log };
}

test("--async con -m a,b: si OpenCode corta (97) con a, la misma corrida sigue con b y --esperar --id trae el de b", () => {
  limpiar();
  const id = lanzar(["-m", `${BEAM},${PICKLE}`, "haceme algo"], { FALSO_CORTE: "opencode/beam-free" });
  const e = esperar(id);
  assert.equal(e.rc, 0, e.err + e.log);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free", "opencode/big-pickle"]);
  assert.match(e.out, /corrio con opencode\/big-pickle/);
  assert.match(e.log, /OpenCode cortó por límite con opencode:opencode\/beam-free: sigo con opencode:opencode\/big-pickle/);
});

test("--async con -m a,b: si b también corta, no hay más en la lista y --esperar --id trae el 97 del último intento", () => {
  limpiar();
  const id = lanzar(["-m", `${BEAM},${PICKLE}`, "haceme algo"], { FALSO_CORTE: "opencode/beam-free,opencode/big-pickle" });
  const e = esperar(id);
  assert.equal(e.rc, 97, e.err + e.log);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free", "opencode/big-pickle"]);
});

test("--async con -m a,b: un b enfriado no se relanza; a corta y sale 97 sin correr b", () => {
  limpiar();
  assert.equal(reparto(["--enfriar", PICKLE]).status, 0);
  const id = lanzar(["-m", `${BEAM},${PICKLE}`, "haceme algo"], { FALSO_CORTE: "opencode/beam-free" });
  const e = esperar(id);
  assert.equal(e.rc, 97, e.err + e.log);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free"]);
  assert.match(e.log, /big-pickle sigue enfriado/);
});

test("--async con -m a (sin lista): un 97 sale 97 como siempre, sin relanzar", () => {
  limpiar();
  const id = lanzar(["-m", BEAM, "haceme algo"], { FALSO_CORTE: "opencode/beam-free" });
  const e = esperar(id);
  assert.equal(e.rc, 97, e.err + e.log);
  assert.deepEqual(ocCorridos(), ["opencode/beam-free"]);
  assert.doesNotMatch(e.log, /sigo con/);
});
