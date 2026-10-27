// Registro de los hooks del motor en settings.json (electron/cli/hooks.ts): elige entre los bash (.sh) y los de Node (.mjs).
// Corre también en Windows; sólo la comparación contra el jq de instalar-producto.sh y los enlaces simbólicos son POSIX.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { apoyoDeHooks, archivoHook, comandoHook, entreComillas, hooksJsonAgy, registrarEnAjustes, registrarEnArchivo, type OpcionesRegistro } from "../electron/cli/hooks.ts";
import { soloPosix } from "./plataforma.ts";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-hooks-registro-"));
const conTemporal = (f: (dir: string) => void) => {
  const dir = temporal();
  try {
    f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const HOOKS = "/home/ana/.claude/hooks";
const sh: OpcionesRegistro = { carpeta: HOOKS, variante: "sh" };
const mjs: OpcionesRegistro = { carpeta: HOOKS, variante: "mjs" };
const clon = <T>(x: T): T => JSON.parse(JSON.stringify(x));

test("comandoHook: bash para .sh, node para .mjs, la ruta siempre entre comillas simples", () => {
  assert.equal(comandoHook("destructive-guard", "sh", HOOKS), `bash '${HOOKS}/destructive-guard.sh'`);
  assert.equal(comandoHook("destructive-guard", "mjs", HOOKS), `node '${HOOKS}/destructive-guard.mjs'`);
  assert.equal(comandoHook("latido", "mjs", "/x/it's here", { node: "/opt/node" }), `/opt/node '/x/it'\\''s here/latido.mjs'`);
  assert.equal(comandoHook("statusline-espejo", "mjs", "C:\\Users\\ana\\.claude\\hooks", { plataforma: "win32", node: "C:\\Program Files\\trama\\node.exe" }), `'C:/Program Files/trama/node.exe' 'C:/Users/ana/.claude/hooks/statusline-espejo.mjs'`);
  assert.equal(entreComillas("a b"), "'a b'");
  assert.equal(archivoHook("agy-pa", "mjs"), "agy-pa.mjs");
  assert.deepEqual(apoyoDeHooks("sh"), ["docker-guard.py"]);
  assert.deepEqual(apoyoDeHooks("mjs"), ["docker-guard.mjs"]);
});

test("hooksJsonAgy: la variante sh es exactamente el hooks.json del plugin", () => {
  assert.deepEqual(hooksJsonAgy("sh"), JSON.parse(readFileSync(path.join(MOTOR, "agy", "pa-worker", "hooks.json"), "utf8")));
  assert.match(JSON.stringify(hooksJsonAgy("mjs")), /node \.\/agy-pa\.mjs pre/);
  assert.doesNotMatch(JSON.stringify(hooksJsonAgy("mjs")), /bash|\.sh/);
});

test("registrarEnAjustes: en un settings vacío agrega el guard (PreToolUse/Bash) y el statusline", () => {
  for (const [o, interprete, ext] of [[sh, "bash", "sh"], [mjs, "node", "mjs"]] as const) {
    const a: Record<string, unknown> = {};
    assert.equal(registrarEnAjustes(a, o), true);
    assert.deepEqual(a, {
      hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: `${interprete} '${HOOKS}/destructive-guard.${ext}'` }] }] },
      statusLine: { type: "command", command: `${interprete} '${HOOKS}/statusline-espejo.${ext}'` },
    });
    assert.equal(registrarEnAjustes(a, o), false, "idempotente");
  }
});

test("registrarEnAjustes: no pisa lo que hay; envuelve el statusline de la persona", () => {
  const a = {
    model: "opus",
    hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "/usr/bin/otro.sh" }] }], Stop: [{ hooks: [{ type: "command", command: "x" }] }] },
    statusLine: { type: "command", command: "~/.claude/mi-linea.sh --corta", padding: 0 },
  };
  const antes = clon(a);
  assert.equal(registrarEnAjustes(a, mjs), true);
  assert.equal(a.model, "opus");
  assert.deepEqual(a.hooks.Stop, antes.hooks.Stop);
  assert.deepEqual(a.hooks.PreToolUse[0], antes.hooks.PreToolUse[0]);
  assert.equal(a.hooks.PreToolUse.length, 2);
  assert.equal(a.statusLine.command, `node '${HOOKS}/statusline-espejo.mjs' bash -c '~/.claude/mi-linea.sh --corta'`);
  assert.equal(a.statusLine.padding, 0);
  assert.equal(registrarEnAjustes(a, mjs), false);
});

test("registrarEnAjustes: comillas simples dentro del statusline original", () => {
  const a = { statusLine: { type: "command", command: "echo 'hola mundo'" } };
  registrarEnAjustes(a, sh);
  assert.equal(a.statusLine.command, `bash '${HOOKS}/statusline-espejo.sh' bash -c 'echo '\\''hola mundo'\\'''`);
});

test("registrarEnAjustes: un statusline que no es de tipo command o no tiene comando se deja como está", () => {
  const a: any = { statusLine: { type: "static", text: "hola" } };
  registrarEnAjustes(a, sh);
  assert.deepEqual(a.statusLine, { type: "static", text: "hola" });
  const b: any = { statusLine: { type: "command" } };
  registrarEnAjustes(b, sh);
  assert.deepEqual(b.statusLine, { type: "command" });
});

test("registrarEnAjustes: pasar de .sh a .mjs (y volver) cambia el comando en su lugar, sin duplicar", () => {
  const a: any = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/otro.sh" }, { type: "command", command: `bash '/viejo/destructive-guard.sh'`, timeout: 5 }] }] }, statusLine: { type: "command", command: `bash '/viejo/statusline-espejo.sh' bash -c 'mi linea'` } };
  assert.equal(registrarEnAjustes(a, mjs), true);
  assert.deepEqual(a.hooks.PreToolUse[0].hooks[1], { type: "command", command: `node '${HOOKS}/destructive-guard.mjs'`, timeout: 5 });
  assert.equal(a.hooks.PreToolUse[0].hooks[0].command, "/usr/bin/otro.sh");
  assert.equal(a.statusLine.command, `node '${HOOKS}/statusline-espejo.mjs' bash -c 'mi linea'`);
  assert.equal(registrarEnAjustes(a, mjs), false);
  assert.equal(registrarEnAjustes(a, sh), true);
  assert.equal(a.statusLine.command, `bash '${HOOKS}/statusline-espejo.sh' bash -c 'mi linea'`);
  // misma variante con otra ruta (otro checkout): no se toca, como el instalador de siempre
  const b: any = { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "bash '/otro/destructive-guard.sh'" }] }] }, statusLine: { type: "command", command: "bash '/otro/statusline-espejo.sh'" } };
  assert.equal(registrarEnAjustes(b, sh), false);
});

test("registrarEnAjustes: formas que no se pueden tocar sin adivinar tiran", () => {
  assert.throws(() => registrarEnAjustes({ hooks: [] }, sh), /hooks no es un objeto/);
  assert.throws(() => registrarEnAjustes({ hooks: { PreToolUse: {} } }, sh), /no es una lista/);
  assert.throws(() => registrarEnAjustes({ statusLine: "x" }, sh), /statusLine/);
  // lo raro dentro de PreToolUse se ignora al buscar (como el `?` de jq) y se agrega a la lista
  const a: any = { hooks: { PreToolUse: ["x", { hooks: "no" }, { hooks: [1, null] }] } };
  assert.equal(registrarEnAjustes(a, sh), true);
  assert.equal(a.hooks.PreToolUse.length, 4);
});

test("registrarEnArchivo: crea el settings, es idempotente y no toca un JSON roto", () => {
  conTemporal((dir) => {
    const settings = path.join(dir, "sub", "settings.json");
    const o = { ...mjs, carpeta: path.join(dir, "hooks") };
    const r1 = registrarEnArchivo(settings, o);
    assert.equal(r1.estado, "registrado");
    const texto = readFileSync(settings, "utf8");
    assert.equal(texto.endsWith("}\n"), true);
    assert.equal(texto.includes("\r"), false);
    assert.equal(JSON.parse(texto).hooks.PreToolUse[0].matcher, "Bash");
    assert.equal(registrarEnArchivo(settings, o).estado, "ya");
    assert.equal(readFileSync(settings, "utf8"), texto, "la segunda corrida no reescribe");
    writeFileSync(settings, "{roto");
    const r3 = registrarEnArchivo(settings, o);
    assert.equal(r3.estado, "invalido");
    assert.equal(readFileSync(settings, "utf8"), "{roto");
    writeFileSync(settings, "[1]");
    assert.equal(registrarEnArchivo(settings, o).estado, "invalido");
    writeFileSync(settings, "  \n");
    assert.equal(registrarEnArchivo(settings, o).estado, "registrado", "un archivo vacío es como uno nuevo");
  });
});

test("registrarEnArchivo: deja una copia fechada la primera vez y no pisa una anterior", () => {
  conTemporal((dir) => {
    const settings = path.join(dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ model: "opus" }));
    const o = { ...sh, carpeta: path.join(dir, "hooks") };
    const r = registrarEnArchivo(settings, o, new Date(2026, 9, 27, 12));
    assert.equal(r.estado, "registrado");
    assert.equal((r as { copia?: string }).copia, `${settings}.trama-bak-20261027`);
    assert.deepEqual(JSON.parse(readFileSync(`${settings}.trama-bak-20261027`, "utf8")), { model: "opus" });
    // pasar a .mjs el mismo día: la copia de hoy (la original) no se pisa
    registrarEnArchivo(settings, { ...o, variante: "mjs" }, new Date(2026, 9, 27, 18));
    assert.deepEqual(JSON.parse(readFileSync(`${settings}.trama-bak-20261027`, "utf8")), { model: "opus" });
    assert.deepEqual(readdirSync(dir).filter((n) => n.includes("bak")), ["settings.json.trama-bak-20261027"]);
    assert.equal(readdirSync(dir).some((n) => n.includes(".tmp.")), false, "no quedan temporales");
  });
});

test("registrarEnArchivo: un settings vacío ({}) no deja copia", () => {
  conTemporal((dir) => {
    const settings = path.join(dir, "settings.json");
    writeFileSync(settings, "{}");
    registrarEnArchivo(settings, { ...sh, carpeta: dir });
    assert.equal(readdirSync(dir).some((n) => n.includes("bak")), false);
  });
});

test("registrarEnArchivo: si el settings es un enlace escribe el archivo real y conserva el modo", { skip: soloPosix("symlinks y modos") }, () => {
  conTemporal((dir) => {
    const real = path.join(dir, "dotfiles", "settings.json");
    mkdirSync(path.dirname(real));
    writeFileSync(real, JSON.stringify({ env: { A: "1" } }));
    chmodSync(real, 0o600);
    const enlace = path.join(dir, "settings.json");
    symlinkSync(real, enlace);
    const r = registrarEnArchivo(enlace, { ...mjs, carpeta: dir });
    assert.equal(r.estado, "registrado");
    assert.equal(lstatSync(enlace).isSymbolicLink(), true, "el enlace sigue siendo un enlace");
    assert.equal(existsSync(real), true);
    assert.equal(JSON.parse(readFileSync(real, "utf8")).hooks.PreToolUse.length, 1);
    assert.equal(statSync(real).mode & 0o777, 0o600);
    const nuevo = path.join(dir, "nuevo", "settings.json");
    registrarEnArchivo(nuevo, { ...mjs, carpeta: dir });
    assert.equal(statSync(nuevo).mode & 0o777, 0o600, "un settings nuevo no sale legible por todos");
  });
});

// El filtro de jq de instalar-producto.sh es la referencia de la variante .sh: el resultado del port tiene que ser el mismo.
function filtroJq(): string {
  const texto = readFileSync(path.join(MOTOR, "scripts", "instalar-producto.sh"), "utf8");
  const m = /nuevo="\$\(jq --arg guard "\$guard" --arg espejo "\$espejo" '([\s\S]*?)' "\$CFG"\)"/.exec(texto);
  assert.ok(m, "no encontré el filtro de jq en instalar-producto.sh");
  return m[1]!;
}
const hayJq = () => spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;

test("registrarEnAjustes (sh) da lo mismo que el jq de instalar-producto.sh", { skip: soloPosix("jq") || (!hayJq() && "sin jq") }, () => {
  const filtro = filtroJq();
  const guard = `${HOOKS}/destructive-guard.sh`;
  const espejo = `${HOOKS}/statusline-espejo.sh`;
  const entradas: unknown[] = [
    {},
    { model: "opus", permissions: { allow: ["Bash(ls:*)"] } },
    { hooks: {} },
    { hooks: { PreToolUse: [] } },
    { hooks: { PreToolUse: [{ matcher: "Edit", hooks: [{ type: "command", command: "x" }] }], Stop: [] } },
    { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "bash '/otro/destructive-guard.sh'" }] }] } },
    { statusLine: { type: "command", command: "mi-linea --x" } },
    { statusLine: { command: "mi-linea 'con comillas'", padding: 2 } },
    { statusLine: { type: "command", command: "bash '/otro/statusline-espejo.sh' bash -c 'x'" } },
    { statusLine: { type: "command", command: "" } },
    { statusLine: { type: "static" } },
    { statusLine: null },
    { hooks: { PreToolUse: [{ hooks: "no" }] }, statusLine: { type: "command", command: "a" } },
  ];
  for (const e of entradas) {
    const r = spawnSync("jq", ["--arg", "guard", guard, "--arg", "espejo", espejo, filtro], { input: JSON.stringify(e), encoding: "utf8" });
    assert.equal(r.status, 0, `jq falló con ${JSON.stringify(e)}: ${r.stderr}`);
    const esperado = JSON.parse(r.stdout);
    const a = clon(e) as Record<string, unknown>;
    registrarEnAjustes(a, sh);
    assert.deepEqual(a, esperado, `entrada ${JSON.stringify(e)}`);
    assert.equal(JSON.stringify(a), JSON.stringify(esperado), "mismo orden de claves");
  }
});
