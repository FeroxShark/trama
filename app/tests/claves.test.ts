// Las API keys de DeepSeek Harness (electron/claves.ts): `claves.env` en 0600, sólo los nombres que se conocen, sin pisar lo que
// ya está en el entorno, y nada de la key de vuelta hacia la interfaz.
import { test, after } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analizarClaves, conClaves, guardarClave, hayClaves, leerClaves, rutaClaves } from "../electron/claves.ts";
import { cambiarIdioma, textoMain } from "../src/i18n/index.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-claves-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const nueva = () => path.join(tmp, `c${++n}`, "trama", "claves.env");
const enEs = (s: string) => {
  cambiarIdioma("es");
  try {
    return textoMain(s);
  } finally {
    cambiarIdioma("en");
  }
};

test("la ruta sale de XDG_CONFIG_HOME, de ~/.config o de TRAMA_CLAVES", { skip: soloPosix("la ruta de claves.env en Windows sale de %LOCALAPPDATA%") }, () => {
  assert.equal(rutaClaves({ XDG_CONFIG_HOME: "/x/cfg" }), "/x/cfg/trama/claves.env");
  assert.equal(rutaClaves({ HOME: "/home/u" }), "/home/u/.config/trama/claves.env");
  assert.equal(rutaClaves({ TRAMA_CLAVES: "/t/c.env", HOME: "/h" }), "/t/c.env");
});

test("analizar: sólo los nombres conocidos, sin comillas ni export, ignorando lo roto", () => {
  const r = analizarClaves(["# nota", "OPENCODE_API_KEY=abc123", "export DEEPSEEK_API_KEY=\"sk-1\"", "OTRA=1", "DEEPSEEK_API_KEY=", "roto", ""].join("\n"));
  assert.deepEqual(r, { OPENCODE_API_KEY: "abc123", DEEPSEEK_API_KEY: "sk-1" });
  assert.deepEqual(analizarClaves("OPENCODE_API_KEY=a\r\nDEEPSEEK_API_KEY=b\r\n"), { OPENCODE_API_KEY: "a", DEEPSEEK_API_KEY: "b" });
});

test("guardar crea la carpeta en 0700 y el archivo en 0600, con una línea por key", { skip: soloPosix("modos 0600/0700") }, async () => {
  const ruta = nueva();
  await guardarClave("OPENCODE_API_KEY", "oc-secreta", ruta);
  assert.equal(readFileSync(ruta, "utf8"), "OPENCODE_API_KEY=oc-secreta\n");
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
  assert.equal(statSync(path.dirname(ruta)).mode & 0o777, 0o700);
  const r = await guardarClave("DEEPSEEK_API_KEY", " sk-1 ", ruta);
  assert.deepEqual(r, { OPENCODE_API_KEY: true, DEEPSEEK_API_KEY: true, ARTIFICIAL_ANALYSIS_API_KEY: false } satisfies Record<string, boolean>);
  assert.equal(readFileSync(ruta, "utf8"), "OPENCODE_API_KEY=oc-secreta\nDEEPSEEK_API_KEY=sk-1\n");
  assert.deepEqual(await leerClaves(ruta), { OPENCODE_API_KEY: "oc-secreta", DEEPSEEK_API_KEY: "sk-1" });
});

test("guardar sobre un archivo con permisos de más lo deja en 0600 y no pierde nada ajeno al formato", { skip: soloPosix("modos 0600") }, async () => {
  const ruta = nueva();
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, "DEEPSEEK_API_KEY=viejo\n", { mode: 0o644 });
  await guardarClave("DEEPSEEK_API_KEY", "nuevo", ruta);
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
  assert.equal(readFileSync(ruta, "utf8"), "DEEPSEEK_API_KEY=nuevo\n");
});

test("borrar con null saca la línea y deja el archivo vacío cuando era la última", { skip: soloPosix("modos 0600") }, async () => {
  const ruta = nueva();
  await guardarClave("OPENCODE_API_KEY", "a", ruta);
  await guardarClave("DEEPSEEK_API_KEY", "b", ruta);
  assert.deepEqual(await guardarClave("OPENCODE_API_KEY", null, ruta), { OPENCODE_API_KEY: false, DEEPSEEK_API_KEY: true, ARTIFICIAL_ANALYSIS_API_KEY: false });
  assert.equal(readFileSync(ruta, "utf8"), "DEEPSEEK_API_KEY=b\n");
  await guardarClave("DEEPSEEK_API_KEY", null, ruta);
  assert.equal(readFileSync(ruta, "utf8"), "");
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
});

test("rechaza un nombre desconocido o un valor con espacios/comillas sin escribir nada", async () => {
  const ruta = nueva();
  await assert.rejects(guardarClave("PATH", "x", ruta), (e) => /no se conoce|desconoc|PATH/i.test(enEs((e as Error).message)) || /PATH/.test(enEs((e as Error).message)));
  for (const malo of ["a b", 'a"b', "a\nb", "", "   "]) await assert.rejects(guardarClave("OPENCODE_API_KEY", malo, ruta));
  assert.deepEqual(await leerClaves(ruta), {});
  assert.throws(() => statSync(ruta));
});

test("sin archivo no hay claves; hayClaves cuenta también las del entorno y no devuelve valores", () => {
  assert.deepEqual(hayClaves({}, {}), { OPENCODE_API_KEY: false, DEEPSEEK_API_KEY: false, ARTIFICIAL_ANALYSIS_API_KEY: false });
  assert.deepEqual(hayClaves({ OPENCODE_API_KEY: "x" }, { DEEPSEEK_API_KEY: "y" }), { OPENCODE_API_KEY: true, DEEPSEEK_API_KEY: true, ARTIFICIAL_ANALYSIS_API_KEY: false });
});

test("conClaves: lo ya puesto en el entorno gana", () => {
  const e = conClaves({ OPENCODE_API_KEY: "del-entorno", PATH: "/bin" }, { OPENCODE_API_KEY: "del-archivo", DEEPSEEK_API_KEY: "ds" });
  assert.equal(e.OPENCODE_API_KEY, "del-entorno");
  assert.equal(e.DEEPSEEK_API_KEY, "ds");
  assert.equal(e.PATH, "/bin");
});

test("la key de Artificial Analysis se guarda como las otras, se cuenta como presente y no pasa al entorno de los líderes", { skip: soloPosix("modos 0600") }, async () => {
  const ruta = nueva();
  const hay = await guardarClave("ARTIFICIAL_ANALYSIS_API_KEY", "aa-secreta", ruta);
  assert.equal(hay.ARTIFICIAL_ANALYSIS_API_KEY, true);
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
  assert.deepEqual(await leerClaves(ruta), { ARTIFICIAL_ANALYSIS_API_KEY: "aa-secreta" });
  assert.equal(conClaves({}, await leerClaves(ruta)).ARTIFICIAL_ANALYSIS_API_KEY, undefined);
  await guardarClave("ARTIFICIAL_ANALYSIS_API_KEY", null, ruta);
  assert.deepEqual(await leerClaves(ruta), {});
});
