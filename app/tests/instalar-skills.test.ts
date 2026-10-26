// scripts/instalar-skills.sh con un HOME temporal (nunca el de verdad): las skills de diseño del repo se enlazan en
// ~/.claude/skills siempre y en la de agy sólo si agy está; no se baja nada y no se pisa una que ya exista y sea distinta.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const script = path.join(repo, "scripts", "instalar-skills.sh");
const NOMBRES = ["ui-ux-pro-max", "taste-skill", "diseno"];
const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-skills-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

let n = 0;
/** Un HOME vacío; `agy` = el ejecutable falso que se declara con HILOS_AGY (o ninguno). */
function casa(conAgy: boolean) {
  const home = path.join(tmp, `h${n++}`);
  mkdirSync(home, { recursive: true });
  const agy = path.join(home, "bin-agy");
  if (conAgy) { writeFileSync(agy, "#!/bin/sh\n"); chmodSync(agy, 0o755); }
  return { home, agy: conAgy ? agy : path.join(home, "no-hay-agy") };
}
function correr(c: { home: string; agy: string }) {
  const r = spawnSync("bash", [script], { env: { PATH: process.env.PATH, HOME: c.home, HILOS_AGY: c.agy }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r;
}
const enlaza = (destino: string, nombre: string) => readlinkSync(path.join(destino, nombre)) === path.join(repo, "skills", nombre);

test("las skills del repo están completas y con su licencia", () => {
  for (const s of NOMBRES) assert.ok(existsSync(path.join(repo, "skills", s, "SKILL.md")), s);
  for (const s of ["ui-ux-pro-max", "taste-skill"]) assert.match(readFileSync(path.join(repo, "skills", s, "LICENSE"), "utf8"), /^MIT License/);
  assert.ok(existsSync(path.join(repo, "skills", "ui-ux-pro-max", "scripts", "search.py")));
  assert.ok(existsSync(path.join(repo, "skills", "taste-skill", "scripts", "draw.mjs")));
});

test("la skill diseno es genérica: nada de rutas ni nombres del autor", () => {
  const t = readFileSync(path.join(repo, "skills", "diseno", "SKILL.md"), "utf8");
  assert.doesNotMatch(t, /f[e]rox|\/home\//i);
  assert.doesNotMatch(t, /estandar-/);
});

test("sin agy: enlaza en ~/.claude/skills y no crea nada de agy", () => {
  const c = casa(false);
  correr(c);
  for (const s of NOMBRES) assert.ok(enlaza(path.join(c.home, ".claude", "skills"), s), s);
  assert.equal(existsSync(path.join(c.home, ".gemini")), false);
});

test("con agy: también en la carpeta de skills de agy; repetir no cambia nada", () => {
  const c = casa(true);
  correr(c);
  const r = correr(c);
  for (const s of NOMBRES) {
    assert.ok(enlaza(path.join(c.home, ".claude", "skills"), s), s);
    assert.ok(enlaza(path.join(c.home, ".gemini", "config", "skills"), s), s);
  }
  assert.match(r.stdout, /ya enlaza a este checkout/);
});

test("no pisa una skill que ya existe y es distinta; avisa", () => {
  const c = casa(true);
  const mia = path.join(c.home, ".claude", "skills", "diseno");
  mkdirSync(mia, { recursive: true });
  writeFileSync(path.join(mia, "SKILL.md"), "la mía\n");
  const r = correr(c);
  assert.equal(lstatSync(mia).isSymbolicLink(), false);
  assert.equal(readFileSync(path.join(mia, "SKILL.md"), "utf8"), "la mía\n");
  assert.match(r.stderr, /distinta; no se pisa/);
  assert.ok(enlaza(path.join(c.home, ".claude", "skills"), "taste-skill"));
});

test("un enlace de otra persona a su propia copia tampoco se pisa", () => {
  const c = casa(false);
  const otra = path.join(c.home, "dotfiles", "taste-skill");
  mkdirSync(otra, { recursive: true });
  writeFileSync(path.join(otra, "SKILL.md"), "otra\n");
  mkdirSync(path.join(c.home, ".claude", "skills"), { recursive: true });
  symlinkSync(otra, path.join(c.home, ".claude", "skills", "taste-skill"));
  correr(c);
  assert.equal(readlinkSync(path.join(c.home, ".claude", "skills", "taste-skill")), otra);
});

test("un enlace roto se reemplaza", () => {
  const c = casa(false);
  mkdirSync(path.join(c.home, ".claude", "skills"), { recursive: true });
  symlinkSync(path.join(c.home, "no-existe"), path.join(c.home, ".claude", "skills", "diseno"));
  correr(c);
  assert.ok(enlaza(path.join(c.home, ".claude", "skills"), "diseno"));
});

test("si un plugin de agy ya ve las skills (skills -> ~/.claude/skills), no las duplica", () => {
  const c = casa(true);
  mkdirSync(path.join(c.home, ".claude", "skills", "diseno"), { recursive: true });
  writeFileSync(path.join(c.home, ".claude", "skills", "diseno", "SKILL.md"), "x\n");
  mkdirSync(path.join(c.home, ".gemini", "config", "plugins", "pa-worker"), { recursive: true });
  symlinkSync(path.join(c.home, ".claude", "skills"), path.join(c.home, ".gemini", "config", "plugins", "pa-worker", "skills"));
  const r = correr(c);
  assert.match(r.stdout, /agy ya ve diseno/);
  assert.equal(existsSync(path.join(c.home, ".gemini", "config", "skills", "diseno")), false);
});
