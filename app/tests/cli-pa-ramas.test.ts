// La etapa 9 del port (app/electron/cli/pa/{ramas,ramas-base,lecciones,auditar}.ts): las piezas puras, y lo que --auditar y
// --actualizar le mandan al worker comparado con lo que manda el bash (que sí lanza: el claude falso guarda el argv).
// Las de bash son POSIX; las puras corren en todos lados.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { testPosix } from "./plataforma.ts";
import { comandoOriginal, correr, PA_BASH, type Contexto } from "./paridad/arnes.ts";
import { normalizar } from "./paridad/normalizar.ts";
import { armarActualizar, contratoActualizar, prepararAuditar, validarCombinaciones, verificacionDe, verificadoDe } from "../electron/cli/pa/auditar.ts";
import { prologo } from "../electron/cli/pa/entorno.ts";
import { leccionAgregar, leccionesBloque } from "../electron/cli/pa/lecciones.ts";
import { comoQ, fijarProyecto, leerCampo, realpathM, rutaPorcelain, slugDe } from "../electron/cli/pa/ramas-base.ts";
import { decisionEsNada, isoSegundos } from "../electron/cli/pa/ramas.ts";

const M = "claude-sonnet-5-5";
const ID = "20261028-101010-4242";
const io = { out: () => {}, err: () => {} };
const paDe = (c: Contexto) =>
  prologo(["demo"], { HOME: c.home, PA_STATE: c.estado, PROYECTOS_REGISTRY: path.join(c.home, ".config", "proyectos", "registry.json"), PATH: process.env.PATH }, io);
const g = (c: Contexto, ...a: string[]) => spawnSync("git", ["-C", c.proyecto, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" }).stdout.trim();

/** Una rama `pa/proy/<ID>` con un commit y su `.corrida`. */
function corrida(c: Contexto) {
  const base = g(c, "rev-parse", "HEAD");
  g(c, "checkout", "-q", "-b", `pa/proy/${ID}`);
  writeFileSync(path.join(c.proyecto, "a.txt"), "x\n");
  g(c, "add", "-A");
  g(c, "commit", "-q", "-m", "trabajo");
  g(c, "checkout", "-q", "main");
  mkdirSync(path.join(c.estado, "proy"), { recursive: true });
  writeFileSync(path.join(c.estado, "proy", `${ID}.corrida`), `ruta_trabajo=${c.proyecto}\nrama=pa/proy/${ID}\nbase=${base}\nproyecto=demo\norigen=\nleer=0\npuesto=1\n`);
  return base;
}

/** El argumento que sigue a `-p` en el argv (normalizado) que recibió claude. */
const prompt = (argv: string) => argv.split("\n--model\n")[0]!.replace(/^-p\n/, "");

// ---------------------------------------------------------------- puras

test("comoQ: como el %q de bash", () => {
  assert.equal(comoQ("demo"), "demo");
  assert.equal(comoQ("mi proyecto"), "mi\\ proyecto");
  assert.equal(comoQ("a'b"), "a\\'b");
  assert.equal(comoQ(""), "''");
});

test("rutaPorcelain: rename, comillas y lo común", () => {
  assert.equal(rutaPorcelain(" M a.txt"), "a.txt");
  assert.equal(rutaPorcelain("R  viejo -> nuevo"), "nuevo");
  assert.equal(rutaPorcelain('?? "con espacio"'), "con espacio");
});

test("slugDe, decisionEsNada, isoSegundos", () => {
  assert.equal(slugDe("/x/Mi App"), "mi-app");
  assert.ok(decisionEsNada(" **Nada.** "));
  assert.ok(!decisionEsNada("nada que hacer"));
  assert.match(isoSegundos(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
});

test("validarCombinaciones: lo que el bash rechaza al parsear", () => {
  assert.match(validarCombinaciones({ tests: true }) ?? "", /--tests va con --integrar/);
  assert.match(validarCombinaciones({ auditar: "x", seguir: true }) ?? "", /--auditar no va/);
  assert.match(validarCombinaciones({ decisiones: "f" }) ?? "", /--decisiones sólo va con --auditar/);
  assert.equal(validarCombinaciones({ auditar: "x", decisiones: "f" }), null);
});

testPosix("realpathM: resuelve lo que existe y deja lo que falta", () => {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), "rpm-")));
  mkdirSync(path.join(d, "real"));
  symlinkSync(path.join(d, "real"), path.join(d, "enlace"));
  assert.equal(realpathM(path.join(d, "enlace", "no", "hay")), path.join(d, "real", "no", "hay"));
  assert.equal(realpathM(path.join(d, "a", "..", "b")), path.join(d, "b"));
});

test("lecciones: no repite, corta en 45 y el bloque son las últimas 12", async () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "lec-"));
  for (let i = 1; i <= 50; i++) assert.ok(await leccionAgregar(d, `lección ${i}`));
  assert.ok(await leccionAgregar(d, "lección 50"));
  const ls = readFileSync(path.join(d, "lecciones.md"), "utf8").trimEnd().split("\n");
  assert.equal(ls.length, 45);
  assert.match(ls.at(-1)!, /lección 50$/);
  assert.ok(!(await leccionAgregar(d, " \n\t ")));
  const b = leccionesBloque(d);
  assert.match(b, /^\nLecciones de corridas anteriores/);
  assert.equal(b.split("\n").length, 2 + 12);
  assert.match(readFileSync(path.join(d, "lecciones.necesita-poda"), "utf8"), /^45 líneas/);
});

// ---------------------------------------------------------------- contra el bash

/** Corre una función del bash (sacada de motor/bin/pa) con `texto` por stdin. */
function funcionBash(nombre: string, texto: string): { salida: string; rc: number } {
  const src = readFileSync(PA_BASH, "utf8");
  const ini = src.indexOf(`\n${nombre}() {`);
  const fin = src.indexOf("\n}\n", ini);
  const r = spawnSync("bash", ["-c", `${src.slice(ini, fin + 3)}\n${nombre}`], { input: texto, encoding: "utf8" });
  return { salida: r.stdout, rc: r.status ?? -1 };
}

testPosix("verificacionDe / verificadoDe: igual que verificacion_de / verificado_de", () => {
  const textos = [
    "RESULTADO: listo\nVERIFICACION: npm test\n  ok 3\nDECISION: nada\n",
    "RESULTADO: x\n**Verificación:** ninguna, no había tests\nSIGUE: nada\n",
    "- VERIFICACIÓN:\n```\n$ cargo test\ntest result: ok\n```\n- PROBAR: mirar\n",
    "RESULTADO: sin la sección\n",
    "verificacion: n/a\n",
    "VERIFICACION: -\n",
    "VERIFICACION: sin verificar todavía\n",
    "VERIFICACION:\n\n",
  ];
  for (const t of textos) {
    // los que la usan la toman con $(…): sin los `\n` del final
    assert.equal(verificacionDe(t), funcionBash("verificacion_de", t).salida.replace(/\n+$/, ""), JSON.stringify(t));
    // verificado_de llama a verificacion_de: se le pasan las dos
    const src = readFileSync(PA_BASH, "utf8");
    const def = (n: string) => src.slice(src.indexOf(`\n${n}() {`), src.indexOf("\n}\n", src.indexOf(`\n${n}() {`)) + 3);
    const rc = spawnSync("bash", ["-c", `${def("verificacion_de")}\n${def("verificado_de")}\nverificado_de`], { input: t, encoding: "utf8" }).status;
    assert.equal(verificadoDe(t), rc === 0, JSON.stringify(t));
  }
});

testPosix("--auditar: la tarea es la misma que arma el bash (con la del autor y --decisiones)", { timeout: 120_000 }, async () => {
  let ctx: Contexto | undefined;
  const preparar = (c: Contexto) => {
    ctx = c;
    corrida(c);
    writeFileSync(path.join(c.estado, "proy", `${ID}.json`), JSON.stringify({ result: "RESULTADO: hecho\nVERIFICACION: npm test\n  ok 12\nDECISION: nada\n" }));
    writeFileSync(path.join(c.aux, "dec.md"), "El nombre raro es a propósito.\n");
  };
  const a = correr({ nombre: "auditar", preparar, args: (c) => ["demo", "--sin-jefe", "-m", M, "--auditar", ID, "--decisiones", path.join(c.aux, "dec.md"), "fijate el borde"] }, comandoOriginal());
  assert.equal(a.pasos[0]?.rc, 78, a.pasos[0]?.stderr);
  const c = ctx!;
  const x = fijarProyecto(paDe(c), "demo", c.proyecto);
  const p = await prepararAuditar(x, ID, path.join(c.aux, "dec.md"), "fijate el borde");
  assert.ok(p.ok);
  assert.equal(normalizar(p.tarea, { tmp: [c.raiz] }), prompt(a.argvClaude[0]!));
});

testPosix("--actualizar: tarea, línea de contrato, lecciones y la base nueva de la corrida, como el bash", { timeout: 120_000 }, async () => {
  let ctx: Contexto | undefined;
  let base = "";
  const preparar = (c: Contexto) => {
    ctx = c;
    base = corrida(c);
    g(c, "commit", "-q", "--allow-empty", "-m", "main avanzó");
    mkdirSync(path.join(c.estado, "proy"), { recursive: true });
    writeFileSync(path.join(c.estado, "proy", "lecciones.md"), "- 2026-10-01 no tocar dist/\n");
  };
  const a = correr({ nombre: "actualizar", preparar, args: ["demo", "--sin-jefe", "-m", M, "--actualizar", ID, "ojo con a.txt"] }, comandoOriginal());
  assert.equal(a.pasos[0]?.rc, 78, a.pasos[0]?.stderr);
  const c = ctx!;
  const n = (s: string) => normalizar(s, { tmp: [c.raiz] });
  const shaBash = leerCampo(path.join(c.estado, "proy", `${ID}.corrida`), "base");
  const x = fijarProyecto(paDe(c), "demo", c.proyecto);
  const r = await armarActualizar(x, ID, { rama: `pa/proy/${ID}`, base, extra: "ojo con a.txt" });
  assert.equal(r.shaMain, shaBash, "la base de la corrida pasa a ser el HEAD de main");
  assert.equal(n(r.tarea), prompt(a.argvClaude[0]!));
  const contrato = a.argvClaude[0]!.split("\n--append-system-prompt\n")[1] ?? "";
  const wt = path.join(c.estado, "worktrees", "proy");
  assert.ok(contrato.includes(n(leccionesBloque(x.dir) + contratoActualizar(`pa/proy/${ID}`, wt, r.shaMain))), contrato.slice(-1500));
});
