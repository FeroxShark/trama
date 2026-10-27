// cli/proyecto-ruta.ts: nombre → carpeta real (exacto, sin mayúsculas, titulo/alias, substring, ambigüedad, ~, archivos suelto). Corre también en Windows.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { main, resolverProyecto } from "../electron/cli/proyecto-ruta.ts";
import { soloPosix } from "./plataforma.ts";

function entorno() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pr-")));
  const home = path.join(raiz, "home");
  mkdirSync(home);
  const registry = path.join(raiz, "registry.json");
  const env = { HOME: home, USERPROFILE: home, PROYECTOS_REGISTRY: registry };
  const dir = (...r: string[]) => {
    const d = path.join(raiz, ...r);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const poner = (projects: unknown[]) => writeFileSync(registry, JSON.stringify({ projects }));
  return { raiz, home, env, dir, poner, registry };
}

function correr(env: Record<string, string>, args: string[]) {
  let out = "";
  let err = "";
  const codigo = main(args, env, { out: (s) => (out += s), err: (s) => (err += s) });
  return { codigo, out, err };
}

test("proyecto-ruta: exacto, sin distinguir mayúsculas y por substring", () => {
  const t = entorno();
  const a = t.dir("a");
  const u = t.dir("u");
  t.poner([{ name: "demo", path: a }, { name: "Unico-Mayus", path: u }]);
  assert.deepEqual(correr(t.env, ["demo"]), { codigo: 0, out: a + "\n", err: "" });
  assert.equal(correr(t.env, ["DEMO"]).out, a + "\n");
  assert.equal(correr(t.env, ["mayus"]).out, u + "\n");
});

test("proyecto-ruta: substring ambiguo falla y lista los candidatos; si son la misma carpeta no es ambiguo", () => {
  const t = entorno();
  t.poner([{ name: "proyecto-a", path: t.dir("a") }, { name: "proyecto-b", path: t.dir("b") }]);
  const r = correr(t.env, ["proyecto"]);
  assert.equal(r.codigo, 1);
  assert.match(r.err, /'proyecto' es ambiguo, hay 2 candidatos:\n {2}proyecto-a\t.*\n {2}proyecto-b\t.*\nusá el nombre exacto\.\n/);
  const d = t.dir("d");
  t.poner([{ name: "mpv-guard", path: d }, { name: "mpv-guard / vram", path: d }]);
  assert.equal(correr(t.env, ["mpv"]).out, d + "\n");
});

test("proyecto-ruta: titulo, alias y aliases; el nombre exacto gana al alias", () => {
  const t = entorno();
  const x = t.dir("x");
  const b = t.dir("b");
  t.poner([{ name: "x", path: x, titulo: "Mi Titulo", alias: ["Otro"], aliases: "Tercero" }, { name: "a", path: t.dir("a"), alias: "b" }, { name: "b", path: b }]);
  for (const n of ["mi titulo", "OTRO", "tercero"]) assert.equal(correr(t.env, [n]).out, x + "\n", n);
  assert.equal(correr(t.env, ["b"]).out, b + "\n");
});

test("proyecto-ruta: un alias en dos carpetas distintas es ambiguo; repetido en la misma, no", () => {
  const t = entorno();
  t.poner([{ name: "uno", path: t.dir("uno"), alias: "comun" }, { name: "dos", path: t.dir("dos"), titulo: "Comun" }]);
  const r = correr(t.env, ["comun"]);
  assert.equal(r.codigo, 1);
  assert.match(r.err, /'comun' es el nombre de más de un proyecto:\n {2}uno\t.*\n {2}dos\t.*\nusá el nombre exacto del registry\.\n/);
  const d = t.dir("misma");
  t.poner([{ name: "uno", path: d, alias: "comun" }, { name: "dos", path: d, alias: "comun" }]);
  assert.equal(correr(t.env, ["comun"]).out, d + "\n");
});

test("proyecto-ruta: ~ al HOME y un archivo suelto va a su carpeta", () => {
  const t = entorno();
  mkdirSync(path.join(t.home, "dir-tilde"));
  const d = t.dir("solo");
  writeFileSync(path.join(d, "run.sh"), "x");
  t.poner([{ name: "tilde", path: "~/dir-tilde" }, { name: "script", path: path.join(d, "run.sh") }]);
  assert.equal(correr(t.env, ["tilde"]).out, path.join(t.home, "dir-tilde") + "\n");
  assert.equal(correr(t.env, ["script"]).out, d + "\n");
});

test("proyecto-ruta: errores de uso y de registry", () => {
  const t = entorno();
  t.poner([{ name: "demo", path: t.dir("a") }, { name: "zeta", path: t.dir("z") }, { name: "alfa", path: t.dir("al") }, { name: "alfa", path: t.dir("al") }]);
  assert.deepEqual([correr(t.env, []).codigo, correr(t.env, ["a", "b"]).codigo, correr(t.env, [""]).codigo], [2, 2, 2]);
  assert.equal(correr(t.env, [""]).err, "proyecto-ruta: nombre vacío\n");
  assert.equal(correr(t.env, []).err, "uso: proyecto-ruta <nombre> | --listar\n");
  const nf = correr(t.env, ["fantasma"]);
  assert.deepEqual([nf.codigo, nf.err], [1, "no encontré 'fantasma'. Proyectos:\nalfa\ndemo\nzeta\n"]);
  assert.equal(correr(t.env, ["--listar"]).out, "alfa\ndemo\nzeta\n");
  const sin = correr({ ...t.env, PROYECTOS_REGISTRY: path.join(t.raiz, "no.json") }, ["demo"]);
  assert.deepEqual([sin.codigo, sin.err], [1, `no existe el registry: ${path.join(t.raiz, "no.json")}\n`]);
});

test("proyecto-ruta: la ruta que no existe", () => {
  const t = entorno();
  t.poner([{ name: "roto", path: path.join(t.raiz, "no-esta") }, { name: "mas", path: path.join(t.raiz, "no", "esta", "tampoco") }]);
  const r = correr(t.env, ["roto"]);
  assert.deepEqual([r.codigo, r.err], [1, `la ruta no existe: ${path.join(t.raiz, "no-esta")}\n`]);
  // faltan varios componentes: el original (readlink -f) sale con 1 sin decir nada
  assert.deepEqual([correr(t.env, ["mas"]).codigo, correr(t.env, ["mas"]).err], [1, ""]);
});

test("proyecto-ruta: resuelve el symlink a la ruta real", { skip: soloPosix("symlinks") }, () => {
  const t = entorno();
  const real = t.dir("real");
  symlinkSync(real, path.join(t.raiz, "enlace"));
  t.poner([{ name: "enlace", path: path.join(t.raiz, "enlace") }]);
  assert.equal(resolverProyecto("enlace", t.env).ok && (resolverProyecto("enlace", t.env) as { ruta: string }).ruta, real);
});
