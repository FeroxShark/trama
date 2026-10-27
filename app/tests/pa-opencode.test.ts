// El motor `opencode` de pa (motor/bin/pa + reparto + motor/opencode/correr.mjs) con un `opencode` FALSO (un script que imprime los eventos
// de `opencode run --format json`): validación del modelo, los códigos de salida (2 argumentos, 95 sin opencode), el .json que deja el
// runner, `pa --modelos --json`, y que `reparto` ofrece los gratis cuando no hay Claude. HOME, estado y registry en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-opencode-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const home = path.join(tmp, "home");
const proy = path.join(tmp, "proy");
const estado = path.join(tmp, "estado");
const shim = path.join(tmp, "shim");
for (const d of [path.join(home, ".config", "proyectos"), proy, estado, shim]) mkdirSync(d, { recursive: true });
const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("commit", "-q", "--allow-empty", "-m", "init");
writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
// El opencode falso: `models` lista dos gratis; lo demás (run) cuenta con qué argumentos lo llamaron.
const falso = path.join(tmp, "opencode-falso.sh");
writeFileSync(
  falso,
  `#!/bin/bash
if [[ "$1" == models ]]; then printf 'opencode/beam-free\\nopencode/big-pickle\\nopencode/gpt-5\\n'; exit 0; fi
cat >/dev/null
echo '{"type":"step_start","sessionID":"ses_falso","part":{}}'
echo '{"type":"text","sessionID":"ses_falso","part":{"text":"RESULTADO: llamado: '"$*"'\\nARCHIVOS: ninguno\\nDECISION: ninguna\\nSIGUE: nada"}}'
echo '{"type":"step_finish","sessionID":"ses_falso","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(falso, 0o755);
if (spawnSync("sh", ["-c", "command -v uuidgen"]).status !== 0) {
  writeFileSync(path.join(shim, "uuidgen"), "#!/bin/sh\ncat /proc/sys/kernel/random/uuid\n");
  chmodSync(path.join(shim, "uuidgen"), 0o755);
}

function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, ".config"),
      PA_STATE: estado,
      STATE: estado,
      PROYECTOS_REGISTRY: path.join(home, ".config", "proyectos", "registry.json"),
      TRAMA_MODELOS: path.join(home, "no-hay.json"),
      TRAMA_CLAVES: path.join(home, "no-hay.env"),
      PA_REPARTO: "0",
      HILOS_OPENCODE: falso,
      PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`,
      ...env,
    },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

test("pa -m opencode:…: corre el runner con `opencode run --format json -m <proveedor>/<modelo>` y deja el .json de motor opencode", () => {
  const r = pa(["demo", "-m", "opencode:opencode/beam-free", "haceme algo"]);
  assert.equal(r.rc, 0, r.err + r.out);
  assert.match(r.out, /llamado: run --format json (--thinking )?-m opencode\/beam-free/);
  const jsons = readdirSync(path.join(estado, "proy")).filter((f) => f.endsWith(".json"));
  const j = JSON.parse(readFileSync(path.join(estado, "proy", jsons[0]!), "utf8"));
  assert.equal(j.motor, "opencode");
  assert.equal(j.is_error, false);
  assert.equal(j.total_cost_usd, 0, "un gratis no cuesta");
  assert.equal(j.num_turns, 1);
});

test("validación: modelo mal armado → 2; --effort → 2; sin opencode → 95 con cómo instalarlo", () => {
  const mal = pa(["demo", "-m", "opencode:suelto", "x"]);
  assert.equal(mal.rc, 2);
  assert.match(mal.err, /opencode:<proveedor>\/<modelo>/);
  // opencode sí tiene effort (su --variant): ya no se rechaza (acá llega al 95 por no estar instalado); dsh sigue sin tenerlo.
  const ef = pa(["demo", "-m", "opencode:opencode/beam-free", "--effort", "high", "x"], { HILOS_OPENCODE: path.join(tmp, "no-existe") });
  assert.equal(ef.rc, 95);
  assert.doesNotMatch(ef.err, /no tiene effort/);
  const efDsh = pa(["demo", "-m", "dsh:opencode/big-pickle", "--effort", "high", "x"], { HILOS_DSH: path.join(tmp, "no-existe") });
  assert.equal(efDsh.rc, 2);
  assert.match(efDsh.err, /dsh no tiene effort/);
  const sin = pa(["demo", "-m", "opencode:opencode/beam-free", "x"], { HILOS_OPENCODE: path.join(tmp, "no-existe") });
  assert.equal(sin.rc, 95);
  assert.match(sin.err, /opencode no está instalado.*npm i -g opencode-ai/);
  const dshViejo = pa(["demo", "-m", "dsh:opencode/big-pickle", "x"], { HILOS_DSH: path.join(tmp, "no-existe") });
  assert.equal(dshViejo.rc, 95, "dsh:opencode/* sigue siendo un modelo válido (sólo no se ofrece solo)");
});

test("pa --modelos --json lista los gratis de opencode (sólo opencode/*-free y big-pickle) y ya no los de dsh:opencode", () => {
  const r = pa(["--modelos", "--json"]);
  assert.equal(r.rc, 0, r.err);
  const j = JSON.parse(r.out);
  assert.equal(j.opencode.instalado, true);
  assert.deepEqual(j.opencode.modelos.map((m: any) => m.id), ["opencode:opencode/beam-free", "opencode:opencode/big-pickle"]);
  assert.ok(j.opencode.modelos.every((m: any) => m.gratis && m.disponible));
  assert.ok(!j.dsh.modelos.some((m: any) => m.id.startsWith("dsh:opencode/")));
  const sin = JSON.parse(pa(["--modelos", "--json"], { HILOS_OPENCODE: path.join(tmp, "no-existe") }).out);
  assert.equal(sin.opencode.instalado, false);
  assert.ok(sin.opencode.modelos.every((m: any) => !m.disponible));
});

test("reparto ofrece los gratis de opencode: sin Claude, el mejor gana; REPARTO_OPENCODE=0 los apaga", () => {
  const rep = (env: Record<string, string>) =>
    spawnSync(path.join(MOTOR, "bin", "reparto"), ["--tipo", "mecanico", "--json"], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, REPARTO_STATE: path.join(tmp, "rep"), PA_STATE: estado, TRAMA_MODELOS: path.join(home, "no-hay.json"), REPARTO_CLAUDE: "0", REPARTO_AGY: "0", HILOS_OPENCODE: falso, ...env },
    });
  const r = rep({});
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.equal(j.modelo, "opencode:opencode/big-pickle", "big-pickle (60) gana a beam-free (40)");
  assert.ok(j.candidatos.some((c: any) => c.modelo === "opencode:opencode/beam-free"));
  assert.ok(!j.candidatos.some((c: any) => c.modelo === "opencode:opencode/gpt-5"), "uno de pago no se elige solo");
  const fijo = JSON.parse(rep({ REPARTO_OPENCODE_FIJO: '["opencode/glm-5.3-flash-free"]' }).stdout);
  assert.equal(fijo.modelo, "opencode:opencode/glm-5.3-flash-free");
  const apagado = rep({ REPARTO_OPENCODE: "0" });
  assert.ok(!JSON.parse(apagado.stdout || "{}").modelo?.startsWith?.("opencode:"));
  const res = spawnSync(path.join(MOTOR, "bin", "reparto"), ["--resolver", "opencode:opencode/beam-free", "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(res.stdout).motor, "opencode");
});

test("pa sin -m, sin Claude: reparto elige opencode y la corrida sale con ese modelo", () => {
  const r = pa(["demo", "haceme algo"], { PA_REPARTO: "", REPARTO_CLAUDE: "0", REPARTO_STATE: path.join(tmp, "rep2") });
  assert.equal(r.rc, 0, r.err + r.out);
  assert.match(r.err, /reparto \(.*\) → opencode:opencode\/big-pickle/);
  assert.match(r.out, /-m opencode\/big-pickle/);
  });
