// `tablero probar` y `tablero tildar` (app/electron/cli/tablero.ts): los PROBAR de los workers se juntan en un item por proyecto y
// plataforma («Probar <proyecto> (Linux)»), un renglón cada uno; con una versión `vX.Y.Z` commiteada en main ese item pasa a
// «Probar vX.Y.Z (Linux)» y el siguiente PROBAR abre otro. Cada renglón se tilda aparte; todos tildados cierran el item. Contra un
// tablero y un repo TEMPORALES (el tablero real no se toca).
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/tablero.ts";

const TMP = mkdtempSync(path.join(os.tmpdir(), "tablero-probar-"));
after(() => rmSync(TMP, { recursive: true, force: true }));
const REPO = path.join(TMP, "demo");
mkdirSync(REPO);
const g = (...a: string[]) => execFileSync("git", ["-C", REPO, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8", windowsHide: true });
g("init", "-q", "-b", "main");
g("commit", "-q", "--allow-empty", "-m", "inicio");
const REGISTRY = path.join(TMP, "registry.json");
writeFileSync(REGISTRY, JSON.stringify({ projects: [{ name: "demo", path: REPO, estado: "activo" }] }));

let n = 0;
/** Un tablero vacío por test. */
const entorno = () => {
  const dir = path.join(TMP, `tablero-${++n}`);
  return { TABLERO_DIR: dir, TABLERO_VISTA: path.join(dir, "vista.json"), PA_STATE: path.join(TMP, "pa"), PROYECTOS_REGISTRY: REGISTRY, HOME: TMP, USERPROFILE: TMP, TRAMA_DUENO: "Ana" };
};
const correr = async (env: Record<string, string>, ...args: string[]) => {
  let out = "";
  let err = "";
  const rc = await main(args, env, { out: (s) => void (out += s), err: (s) => void (err += s) });
  return { rc, out: out.trim(), err };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const items = (env: Record<string, string>): any[] =>
  readFileSync(path.join(env.TABLERO_DIR, "items.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

test("dos PROBAR del mismo proyecto y plataforma: un solo item con dos renglones", async () => {
  const env = entorno();
  const a = await correr(env, "probar", "demo", "abrir la app y mirar el botón", "--plataforma", "linux", "--clave", "pa:1:p1", "--origen", "pa");
  const b = await correr(env, "probar", "demo", "mirar el aviso nuevo", "--plataforma", "linux", "--clave", "pa:2:p1", "--origen", "pa");
  assert.equal(a.rc, 0);
  assert.equal(a.out, b.out);
  const [it] = items(env);
  assert.equal(items(env).length, 1);
  assert.equal(it.titulo, "Probar demo (Linux)");
  assert.equal(it.columna, "espera-dueno");
  assert.equal(it.tipo, "prueba");
  assert.deepEqual(it.renglones.map((r: { texto: string; hecho: boolean }) => [r.texto, r.hecho]), [["abrir la app y mirar el botón", false], ["mirar el aviso nuevo", false]]);
  // `prueba` lleva los renglones con su marca: la interfaz de antes los muestra sin saber de renglones.
  assert.equal(it.prueba, "1. [ ] abrir la app y mirar el botón\n2. [ ] mirar el aviso nuevo");
  // La misma clave (un `pa --seguir`) actualiza su renglón, no suma otro.
  await correr(env, "probar", "demo", "mirar el aviso nuevo, en oscuro", "--plataforma", "linux", "--clave", "pa:2:p1");
  assert.deepEqual(items(env)[0].renglones.map((r: { texto: string }) => r.texto), ["abrir la app y mirar el botón", "mirar el aviso nuevo, en oscuro"]);
});

test("Linux y Windows van en items distintos", async () => {
  const env = entorno();
  const l = await correr(env, "probar", "demo", "en Linux", "--plataforma", "linux");
  const w = await correr(env, "probar", "demo", "en Windows", "--plataforma", "windows");
  assert.notEqual(l.out, w.out);
  assert.deepEqual(items(env).map((x) => [x.titulo, x.clave, x.renglones.length]), [["Probar demo (Linux)", "probar:demo:linux", 1], ["Probar demo (Windows)", "probar:demo:windows", 1]]);
});

test("una versión commiteada en main: el item pasa a «Probar vX.Y.Z» y el siguiente PROBAR abre otro", async () => {
  const env = entorno();
  const uno = await correr(env, "probar", "demo", "antes de la versión", "--plataforma", "linux");
  g("commit", "-q", "--allow-empty", "-m", "v1.2.3");
  const dos = await correr(env, "probar", "demo", "después de la versión", "--plataforma", "linux");
  assert.notEqual(uno.out, dos.out);
  const [viejo, nuevo] = items(env);
  assert.equal(viejo.titulo, "Probar v1.2.3 (Linux)");
  assert.equal(viejo.clave, "probar:demo:linux@v1.2.3");
  assert.equal(viejo.columna, "espera-dueno", "renombrado, sigue abierto con lo que falta probar");
  assert.deepEqual(viejo.renglones.map((r: { texto: string }) => r.texto), ["antes de la versión"]);
  assert.equal(nuevo.titulo, "Probar demo (Linux)");
  assert.equal(nuevo.version_base, "v1.2.3");
  // Sin versión nueva, el próximo va al mismo.
  const tres = await correr(env, "probar", "demo", "otro más", "--plataforma", "linux");
  assert.equal(tres.out, dos.out);
  assert.equal(items(env).length, 2);
});

test("tildar: cada renglón aparte; todos tildados cierran el item y destildar lo reabre", async () => {
  const env = entorno();
  const { out: id } = await correr(env, "probar", "demo", "uno", "--plataforma", "linux");
  await correr(env, "probar", "demo", "dos", "--plataforma", "linux");
  let r = await correr(env, "tildar", id, "2");
  assert.equal(r.rc, 0);
  assert.deepEqual(items(env)[0].renglones.map((x: { hecho: boolean }) => x.hecho), [false, true]);
  assert.equal(items(env)[0].columna, "espera-dueno");
  assert.equal(items(env)[0].prueba, "1. [ ] uno\n2. [x] dos");
  r = await correr(env, "tildar", id, "1");
  assert.equal(items(env)[0].columna, "hecho");
  assert.ok(items(env)[0].cerrado);
  r = await correr(env, "tildar", id, "1", "--no");
  assert.equal(items(env)[0].columna, "espera-dueno");
  assert.equal(items(env)[0].cerrado, null);
  r = await correr(env, "tildar", id, "3");
  assert.equal(r.rc, 2);
  assert.match(r.err, /no hay renglón 3/);
  // Cerrado del todo, el siguiente PROBAR abre uno nuevo.
  await correr(env, "tildar", id, "1");
  const otro = await correr(env, "probar", "demo", "tres", "--plataforma", "linux");
  assert.notEqual(otro.out, id);
});

test("los items viejos no se tocan: un «Probar: …» suelto sigue igual y no recibe renglones", async () => {
  const env = entorno();
  const { out: viejo } = await correr(env, "agregar", "Probar: algo de antes", "--columna", "espera-dueno", "--proyecto", "demo", "--clave", "pa:9:p1", "--tipo", "prueba", "--prueba", "algo de antes");
  const antes = items(env)[0];
  const { out: nuevo } = await correr(env, "probar", "demo", "algo nuevo", "--plataforma", "linux", "--clave", "pa:9:p1");
  assert.notEqual(nuevo, viejo);
  assert.deepEqual(items(env)[0], antes);
  const r = await correr(env, "tildar", viejo, "1");
  assert.equal(r.rc, 2);
  assert.match(r.err, /no tiene renglones/);
  assert.deepEqual(items(env)[0], antes);
});
