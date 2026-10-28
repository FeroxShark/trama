// Item 4 del protocolo de revisión (motor/docs/protocolo-revision-opus.md) en `pa`: el espejo oculto sale de tareas/
// (`--espejo`: se mueve a <proyecto>/espejos/<id>/ y los settings del worker le niegan Read y Bash ahí) y el test
// congelado puede ir pegado al brief (`--test-inline`). `claude` falso: anota sus argumentos; HOME y estado en un tmp.
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "pa-espejo-"));
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

// Sin las PA_* del proceso que corre el test (como scripts/test.mjs): si no, un pa de un worker se niega a lanzar.
const entorno = (): Record<string, string> => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PA_") && k !== "TRAMA_LOCAL") as [string, string][]),
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
});
function pa(args: string[]) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, { encoding: "utf8", timeout: 90_000, env: entorno() });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
function reparto(args: string[]) {
  const r = spawnSync("python3", [path.join(MOTOR, "bin", "reparto"), ...args], { encoding: "utf8", timeout: 60_000, env: entorno() });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
// Lo último que recibió el claude falso: el valor que sigue a `flag` en su línea de argumentos.
const argDe = (flag: string) => {
  const argv = readFileSync(argvFile, "utf8").split("\0");
  return argv[argv.indexOf(flag) + 1]!;
};
const tareaDir = (slug: string) => path.join(estado, "proy", "tareas", slug);

test("--espejo: el test sale de tareas/, queda en espejos/<id>/ y los settings del worker le niegan Read y Bash ahí", () => {
  const T = "espejo-deny";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.gate.test.ts");
  writeFileSync(src, "expect(suma(2, 3)).toBe(5);\n");
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--espejo", src, "--tarea", T, "--subtarea", "T1", "haz T1"]);
  assert.equal(r.rc, 0, r.err);
  assert.equal(existsSync(src), false, "el espejo ya no está bajo tareas/");
  assert.deepEqual(readdirSync(tareaDir(T)).filter((f) => f.includes("gate")), [], "y no quedó copia");
  const dest = /espejo movido fuera de tareas\/: (\S+) \(/.exec(r.err)?.[1];
  assert.ok(dest, `pa imprime la ruta final: ${r.err}`);
  assert.match(dest, /\/espejos\/\d{8}-\d{6}-\d+\/T1\.gate\.test\.ts$/);
  assert.equal(path.dirname(dest).startsWith(path.join(estado, "proy", "espejos") + path.sep), true);
  assert.equal(readFileSync(dest, "utf8"), "expect(suma(2, 3)).toBe(5);\n", "el contenido viaja intacto");
  const deny: string[] = JSON.parse(argDe("--settings")).permissions.deny;
  const dir = path.dirname(dest);
  assert.ok(deny.includes(`Read(/${dir}/**)`), JSON.stringify(deny));
  assert.ok(deny.some((d) => d.startsWith("Bash(*") && d.includes(dir)), JSON.stringify(deny));
  assert.ok(deny.some((d) => d.startsWith("Bash(*~/")), "y la forma con ~ para Bash");
});

test("sin --espejo los settings del worker no traen permisos (no cambia nada para las demás corridas)", () => {
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "sin espejo"]);
  assert.equal(r.rc, 0, r.err);
  assert.equal("permissions" in JSON.parse(argDe("--settings")), false);
});

test("--espejo con la ruta que pa imprimió (un reintento) la deja donde está: una sola carpeta en espejos/", () => {
  const T = "espejo-reintento";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.gate.test.ts");
  writeFileSync(src, "expect(1).toBe(1);\n");
  const espejos = path.join(estado, "proy", "espejos");
  const antes = existsSync(espejos) ? readdirSync(espejos).length : 0;
  const a = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--espejo", src, "--tarea", T, "--subtarea", "T1", "primer intento"]);
  assert.equal(a.rc, 0, a.err);
  const dest = /espejo movido fuera de tareas\/: (\S+) \(/.exec(a.err)![1]!;
  const b = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--espejo", dest, "--tarea", T, "--subtarea", "T1", "segundo intento"]);
  assert.equal(b.rc, 0, b.err);
  assert.equal(existsSync(dest), true, "sigue en su lugar");
  assert.equal(readdirSync(espejos).length, antes + 1, "el reintento no abrió otra carpeta");
  assert.equal(/espejo movido/.test(b.err), false, "no lo volvió a mover");
});

test("--espejo con -m a,b,c: el primer modelo se saltea (enfriado) y el segundo corre con el espejo movido una sola vez", () => {
  const T = "espejo-fallback";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.gate.test.ts");
  writeFileSync(src, "expect(2).toBe(2);\n");
  assert.equal(reparto(["--enfriar", "claude-sonnet-5-5"]).rc, 0);
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5,claude-haiku-5-5", "--espejo", src, "--tarea", T, "--subtarea", "T1", "con lista"]);
  assert.equal(r.rc, 0, r.err);
  assert.match(r.err, /claude-sonnet-5-5 sigue enfriado/);
  assert.equal(existsSync(src), false);
  assert.equal(r.err.match(/espejo movido/g)?.length, 1, "un solo movimiento");
  assert.equal(argDe("--model"), "claude-haiku-5-5");
  const dest = /espejo movido fuera de tareas\/: (\S+) \(/.exec(r.err)![1]!;
  const deny: string[] = JSON.parse(argDe("--settings")).permissions.deny;
  assert.ok(deny.includes(`Read(/${path.dirname(dest)}/**)`), "el intento que corrió trae el deny de la ruta movida");
  rmSync(rep, { recursive: true, force: true }); // que el enfriamiento no le toque a los tests de después
});

test("--espejo con --async: el hijo que corre el worker también recibe el deny de la ruta movida", () => {
  const T = "espejo-async";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.gate.test.ts");
  writeFileSync(src, "expect(4).toBe(4);\n");
  const a = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--async", "--espejo", src, "--tarea", T, "--subtarea", "T1", "en async"]);
  assert.equal(a.rc, 0, a.err);
  const id = /--id (\S+)/.exec(a.out)?.[1];
  assert.ok(id, a.out);
  const e = pa(["--esperar", "demo", "--id", id]);
  assert.equal(e.rc, 0, e.err);
  assert.equal(existsSync(src), false, "el padre ya lo movió antes del fork");
  const dest = /espejo movido fuera de tareas\/: (\S+) \(/.exec(a.err)![1]!;
  const deny: string[] = JSON.parse(argDe("--settings")).permissions.deny;
  assert.ok(deny.includes(`Read(/${path.dirname(dest)}/**)`), JSON.stringify(deny));
});

test("--espejo a un archivo que no existe → 2 y no lanza nada", () => {
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--espejo", path.join(tmp, "no-hay.ts"), "x"]);
  assert.equal(r.rc, 2);
  assert.match(r.err, /--espejo .* no es un archivo legible/);
});

test("--test-inline: el test va pegado al brief bajo el título, sin su ruta; el archivo se queda donde estaba", () => {
  const T = "inline-basico";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.test.ts");
  writeFileSync(src, 'test("suma", () => { expect(suma(2, 3)).toBe(5); });\n');
  const brief = path.join(tmp, "brief-T1.md");
  writeFileSync(brief, "Objetivo: sumar.\nListo cuando: el test pasa.\nCómo verificar: npm test\n");
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--brief-archivo", brief, "--test-inline", src, "--tarea", T, "--subtarea", "T1"]);
  assert.equal(r.rc, 0, r.err);
  const prompt = argDe("-p");
  assert.ok(prompt.startsWith("Objetivo: sumar."), prompt.slice(0, 80));
  assert.match(prompt, /Test que tiene que pasar, no lo modifiques:\n```ts\ntest\("suma", \(\) => \{ expect\(suma\(2, 3\)\)\.toBe\(5\); \}\);\n```/);
  assert.equal(prompt.includes(src), false, "la ruta del test no va al worker");
  assert.equal(existsSync(src), true, "--test-inline no mueve el test");
});

test("--test-inline con backticks adentro: la cerca se alarga para que el test no la cierre", () => {
  const T = "inline-cerca";
  mkdirSync(tareaDir(T), { recursive: true });
  const src = path.join(tareaDir(T), "T1.test.md");
  writeFileSync(src, "```\nesto dentro\n```\n");
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--test-inline", src, "--tarea", T, "--subtarea", "T1", "con cerca"]);
  assert.equal(r.rc, 0, r.err);
  const prompt = argDe("-p");
  assert.match(prompt, /no lo modifiques:\n````md\n```\nesto dentro\n```\n````/);
});

test("--test-inline a un archivo que no existe → 2", () => {
  const r = pa(["demo", "--sin-jefe", "-m", "claude-sonnet-5-5", "--test-inline", path.join(tmp, "no-hay.test.ts"), "x"]);
  assert.equal(r.rc, 2);
  assert.match(r.err, /--test-inline .* no se puede leer/);
});
