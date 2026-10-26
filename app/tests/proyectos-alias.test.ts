// El nombre para mostrar de un proyecto (`titulo` del registry): las reglas (electron/proyectos-nombre.ts), leerlo y escribirlo
// (electron/proyectos-alias.ts), que `pa` lo entienda como alias (`pa Shark …` == `pa asistente-voz …`, `pa --renombrar`, `pa --proyectos`),
// que el tablero también, y que nada de lo que no se puede renombrar (slug, ruta, carpeta de estado) cambie. El `pa` de la app y el de
// bash usan las mismas reglas: se cruzan con los mismos nombres. Todo en un tmp: no toca el registry ni el estado de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { en } from "../src/i18n/en.ts";
import { es } from "../src/i18n/es.ts";
import { NOMBRE_MAX, mapaNombres, nombreVisible, validarNombre, type NombreUsado } from "../electron/proyectos-nombre.ts";
import { listarProyectos, renombrarProyecto } from "../electron/proyectos-alias.ts";
import { textoT } from "../electron/errores.ts";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "alias-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const home = path.join(tmp, "home");
const estado = path.join(tmp, "estado");
const reg = path.join(home, ".config", "proyectos", "registry.json");
const carpetas = { "asistente-voz": path.join(tmp, "asistente-voz"), hilos: path.join(tmp, "hilos"), atlas: path.join(tmp, "Atlas Web") };
mkdirSync(path.dirname(reg), { recursive: true });
mkdirSync(estado, { recursive: true });
for (const d of Object.values(carpetas)) mkdirSync(d, { recursive: true });
const registro0 = {
  projects: [
    { name: "asistente-voz", path: carpetas["asistente-voz"], tests: "npm test" },
    // Dos nombres para la misma carpeta (alias viejo): el titulo va a todas sus entradas.
    { name: "hilos", path: carpetas.hilos, alias: ["Trama App"] },
    { name: "Hilos Viejo", path: carpetas.hilos },
    { name: "atlas", path: carpetas.atlas },
  ],
};
const escribirRegistro = (r: unknown = registro0) => writeFileSync(reg, JSON.stringify(r, null, 2));
const leerRegistro = () => JSON.parse(readFileSync(reg, "utf8")) as { projects: Record<string, unknown>[] };
escribirRegistro();

const usados: NombreUsado[] = [
  { nombre: "asistente-voz", slug: "asistente-voz", ruta: "/p/av", otros: [] },
  { nombre: "hilos", slug: "hilos", ruta: "/p/hi", otros: ["Trama App"] },
];

test("validarNombre: recorta, y rechaza lo vacío, lo largo, el guion adelante, los caracteres de control y lo que ya usa otro proyecto", () => {
  assert.deepEqual(validarNombre("  Shark  ", "/p/av", usados), { ok: true, valor: "Shark" });
  assert.deepEqual(validarNombre("Mi app ñandú 🦈", "/p/av", usados), { ok: true, valor: "Mi app ñandú 🦈" });
  assert.deepEqual(validarNombre("   ", "/p/av", usados), { ok: false, motivo: "vacio" });
  assert.deepEqual(validarNombre("x".repeat(NOMBRE_MAX), "/p/av", usados).ok, true);
  assert.deepEqual(validarNombre("x".repeat(NOMBRE_MAX + 1), "/p/av", usados), { ok: false, motivo: "largo" });
  assert.deepEqual(validarNombre("-Shark", "/p/av", usados), { ok: false, motivo: "guion" });
  assert.deepEqual(validarNombre("--force", "/p/av", usados), { ok: false, motivo: "guion" });
  assert.deepEqual(validarNombre("dos\nlíneas", "/p/av", usados), { ok: false, motivo: "control" });
  assert.deepEqual(validarNombre("a\u0000b", "/p/av", usados), { ok: false, motivo: "control" });
  // otro proyecto: por nombre, slug, alias o nombre para mostrar, sin distinguir mayúsculas
  assert.deepEqual(validarNombre("HILOS", "/p/av", usados), { ok: false, motivo: "repetido", con: "hilos" });
  assert.deepEqual(validarNombre("trama app", "/p/av", usados), { ok: false, motivo: "repetido", con: "hilos" });
  // el propio proyecto sí puede quedarse con su nombre o su slug
  assert.equal(validarNombre("Asistente-Voz", "/p/av", usados).ok, true);
});

test("nombreVisible: el nombre para mostrar de un proyecto por su nombre del registry o su slug, sin distinguir mayúsculas; lo demás tal cual", () => {
  const ps = [
    { nombre: "Local AI", slug: "llama.cpp", titulo: "Shark" },
    { nombre: "atlas", slug: "atlas", titulo: null },
  ];
  assert.equal(nombreVisible(ps, "Local AI"), "Shark");
  assert.equal(nombreVisible(ps, "llama.cpp"), "Shark");
  assert.equal(nombreVisible(ps, "LOCAL ai"), "Shark");
  assert.equal(nombreVisible(ps, "atlas"), "atlas");
  assert.equal(nombreVisible(ps, "otro"), "otro");
  assert.equal(mapaNombres(ps).size, 2);
});

test("listarProyectos: uno por carpeta, con el slug, el nombre para mostrar y los alias", async () => {
  const l = await listarProyectos(reg);
  assert.deepEqual(l.map((p) => p.slug).sort(), ["asistente-voz", "atlas-web", "hilos"]);
  const hilos = l.find((p) => p.slug === "hilos")!;
  assert.equal(hilos.nombre, "hilos");
  assert.deepEqual(hilos.alias, ["Trama App"]);
  assert.equal(hilos.titulo, null);
  assert.equal(hilos.existe, true);
  // el slug sale del basename de la ruta: "Atlas Web" -> "atlas-web"
  assert.equal(l.find((p) => p.nombre === "atlas")!.slug, "atlas-web");
});

test("renombrarProyecto: guarda `titulo` en todas las entradas de la carpeta, deja un .bak y no toca nada más", async () => {
  const antes = readFileSync(reg, "utf8");
  const p = await renombrarProyecto(reg, "hilos", "  trama  ");
  assert.equal(p.titulo, "trama");
  assert.equal(p.slug, "hilos");
  assert.equal(p.nombre, "hilos");
  const j = leerRegistro();
  assert.deepEqual(j.projects.filter((x) => x.titulo).map((x) => x.name), ["hilos", "Hilos Viejo"]);
  assert.equal(j.projects[1].path, carpetas.hilos, "la ruta no cambia");
  assert.equal(j.projects[1].name, "hilos", "el name del registry no cambia");
  assert.deepEqual(j.projects[1].alias, ["Trama App"], "los alias no se pierden");
  assert.equal(readFileSync(`${reg}.bak`, "utf8"), antes, "queda la copia del registry anterior");
  assert.equal(existsSync(`${reg}.trama-${process.pid}.tmp`), false);
});

test("renombrarProyecto: rechaza con la clave de i18n del motivo; nada se escribe", async () => {
  const antes = readFileSync(reg, "utf8");
  const dice = (e: unknown) => String((e as Error).message);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", "trama"), (e) => dice(e) === textoT("main.nombre.repetido", { max: NOMBRE_MAX, con: "hilos" }));
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", "TRAMA APP"), /main\.nombre\.repetido/);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", "hilos"), /main\.nombre\.repetido/);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", ""), /main\.nombre\.vacio/);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", "-x"), /main\.nombre\.guion/);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", "y".repeat(41)), /main\.nombre\.largo/);
  await assert.rejects(renombrarProyecto(reg, "asistente-voz", 5 as unknown as string), /main\.nombre\.vacio/);
  await assert.rejects(renombrarProyecto(reg, "../etc", "x"), /main\.proyectoRaro/);
  await assert.rejects(renombrarProyecto(reg, "no-existe", "x"), /main\.proyectoRaro/);
  assert.equal(readFileSync(reg, "utf8"), antes);
  await assert.rejects(renombrarProyecto(path.join(tmp, "no-hay.json"), "hilos", "x"), /main\.registroIlegible/);
});

test("renombrarProyecto: null o el nombre del registry sacan el titulo; el propio proyecto puede repetir su nombre para mostrar", async () => {
  assert.equal((await renombrarProyecto(reg, "asistente-voz", "Shark")).titulo, "Shark");
  assert.equal((await renombrarProyecto(reg, "asistente-voz", "shark ")).titulo, "shark", "cambiar mayúsculas del propio es válido");
  assert.equal((await renombrarProyecto(reg, "asistente-voz", "asistente-voz")).titulo, null, "igual al nombre del registry: se saca");
  assert.equal("titulo" in leerRegistro().projects[0], false);
  await renombrarProyecto(reg, "asistente-voz", "Shark");
  assert.equal((await renombrarProyecto(reg, "asistente-voz", null)).titulo, null);
  await renombrarProyecto(reg, "asistente-voz", "Shark");
});

test("el registry con el titulo se lee como siempre: registro() trae titulo y los nombres originales", async () => {
  process.env.PROYECTOS_REGISTRY = reg;
  const { registro } = await import("../electron/registro.ts");
  const por = new Map((await registro()).map((p) => [p.slug, p]));
  assert.equal(por.get("asistente-voz")?.titulo, "Shark");
  assert.equal(por.get("asistente-voz")?.nombre, "asistente-voz");
  assert.equal(por.get("hilos")?.titulo, "trama");
});

test("i18n: cada motivo de nombre y cada texto de Proyectos están en los dos idiomas con las mismas variables", () => {
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  const claves = ["vacio", "largo", "guion", "control", "repetido"].flatMap((m) => [`pry.err.${m}`, `main.nombre.${m}`]);
  for (const k of [...claves, ...Object.keys(es).filter((x) => x.startsWith("pry."))]) {
    assert.ok(k in en && k in es, k);
    assert.deepEqual(vars((es as Record<string, string>)[k]), vars((en as Record<string, string>)[k]), k);
  }
});

// --- `pa` ---------------------------------------------------------------------------------------------------------------

function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, STATE: estado, PROYECTOS_REGISTRY: reg, PATH: `${MOTOR}/bin:${process.env.PATH}`, ...env },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const ruta = (n: string) => spawnSync(path.join(MOTOR, "bin", "proyecto-ruta"), [n], { encoding: "utf8", env: { ...process.env, HOME: home, PROYECTOS_REGISTRY: reg } });

test("pa: el nombre para mostrar es un alias: `pa Shark …` apunta a la misma carpeta y al mismo estado que `pa asistente-voz …`", () => {
  escribirRegistro();
  assert.equal(pa(["--renombrar", "asistente-voz", "Shark"]).rc, 0);
  for (const n of ["Shark", "shark", "SHARK", "asistente-voz"]) {
    const r = ruta(n);
    assert.equal(r.status, 0, `${n}: ${r.stderr}`);
    assert.equal(r.stdout.trim(), carpetas["asistente-voz"], n);
  }
  // la ruta, el slug y la carpeta de estado son los de siempre: nada de `shark` ni `Shark` en el estado
  const a = pa(["Shark", "--agents-md"]);
  assert.equal(a.rc, 0, a.err);
  assert.match(a.err, new RegExp(`plantilla para ${carpetas["asistente-voz"]}/AGENTS\\.md`));
  const b = pa(["asistente-voz", "--agents-md"]);
  assert.equal(b.out, a.out);
  assert.deepEqual(readdirSync(estado).filter((x) => /shark/i.test(x)), []);
  assert.ok(existsSync(path.join(estado, "asistente-voz")), "la carpeta de estado sigue siendo la del slug");
  // un nombre que no existe sigue fallando
  assert.notEqual(ruta("Tiburon").status, 0);
});

test("pa: un alias del registry (`alias`) también vale; dos carpetas con el mismo alias es ambiguo y no elige", () => {
  escribirRegistro();
  assert.equal(ruta("Trama App").stdout.trim(), carpetas.hilos);
  assert.equal(ruta("trama app").stdout.trim(), carpetas.hilos);
  const dup = { projects: [...registro0.projects, { name: "otro", path: carpetas.atlas, titulo: "Trama App" }] };
  escribirRegistro(dup);
  const r = ruta("Trama App");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /más de un proyecto/);
  escribirRegistro();
});

test("pa --renombrar: valida igual que la app (único, ≤ 40, sin '-' adelante), --quitar lo saca y avisa qué no cambia", () => {
  escribirRegistro();
  const ok = pa(["--renombrar", "hilos", "trama"]);
  assert.equal(ok.rc, 0, ok.err);
  assert.match(ok.out, /'hilos' ahora se muestra como 'trama'/);
  assert.match(ok.out, /el slug 'hilos', la ruta, las ramas pa\/hilos\/… y el historial quedan como están/);
  assert.equal(leerRegistro().projects[1].titulo, "trama");
  assert.equal(leerRegistro().projects[2].titulo, "trama", "también en el alias de la misma carpeta");
  assert.equal(existsSync(`${reg}.bak`), true);

  // las mismas reglas que validarNombre, con los mismos nombres
  const usadosReales: NombreUsado[] = [
    { nombre: "asistente-voz", slug: "asistente-voz", ruta: carpetas["asistente-voz"], otros: [] },
    { nombre: "atlas", slug: "atlas-web", ruta: carpetas.atlas, otros: [] },
  ];
  for (const nombre of ["Shark", "x".repeat(40), "x".repeat(41), "-x", "ATLAS", "Atlas-Web", "asistente-voz", "Hilos Viejo", "trama app", "ñandú"]) {
    const app = validarNombre(nombre, carpetas.hilos, [...usadosReales, { nombre: "hilos", slug: "hilos", ruta: carpetas.hilos, otros: ["Trama App"] }, { nombre: "Hilos Viejo", slug: "hilos", ruta: carpetas.hilos, otros: [] }]);
    const r = pa(["--renombrar", "hilos", nombre]);
    assert.equal(r.rc === 0, app.ok, `${nombre}: app ${JSON.stringify(app)} / pa ${r.rc} ${r.err}`);
  }
  assert.equal(pa(["--renombrar", "hilos", ""]).rc, 2);
  assert.equal(pa(["--renombrar", "hilos", "dos\nlíneas"]).rc, 2);
  assert.equal(pa(["--renombrar", "hilos"]).rc, 2, "sin nombre: uso");
  assert.notEqual(pa(["--renombrar", "no-existe", "x"]).rc, 0);

  const q = pa(["--renombrar", "hilos", "--quitar"]);
  assert.equal(q.rc, 0, q.err);
  assert.equal("titulo" in leerRegistro().projects[1], false);
  assert.equal("titulo" in leerRegistro().projects[2], false);
  assert.deepEqual(leerRegistro().projects[1].alias, ["Trama App"]);
});

test("pa --proyectos: lista nombre, nombre para mostrar, slug y ruta; --json lo mismo", () => {
  escribirRegistro();
  pa(["--renombrar", "asistente-voz", "Shark"]);
  const t = pa(["--proyectos"]);
  assert.equal(t.rc, 0, t.err);
  assert.match(t.out, /NOMBRE\s+MUESTRA\s+SLUG\s+RUTA/);
  assert.match(t.out, new RegExp(`asistente-voz\\s+Shark\\s+asistente-voz\\s+${carpetas["asistente-voz"]}`));
  assert.match(t.out, /atlas\s+-\s+atlas-web/);
  const j = JSON.parse(pa(["--proyectos", "--json"]).out) as { nombre: string; titulo: string | null; slug: string; ruta: string }[];
  assert.deepEqual(j.find((p) => p.nombre === "asistente-voz"), { nombre: "asistente-voz", titulo: "Shark", slug: "asistente-voz", ruta: carpetas["asistente-voz"] });
  assert.equal(j.find((p) => p.nombre === "atlas")?.titulo, null);
  escribirRegistro();
});

test("el tablero entiende el nombre para mostrar y el alias, y anota con el nombre del registry", () => {
  escribirRegistro();
  pa(["--renombrar", "asistente-voz", "Shark"]);
  const py = `
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("tab", ${JSON.stringify(path.join(MOTOR, "bin", "tablero"))})
sp = importlib.util.spec_from_loader("tab", l); m = importlib.util.module_from_spec(sp); sys.argv = ["x"]; l.exec_module(m)
r = m.Registro()
print("|".join(r.resolver(n)[0] for n in ["Shark", "shark", "asistente-voz", "Trama App"]))
`;
  const r = spawnSync("python3", ["-I", "-c", py], { encoding: "utf8", env: { ...process.env, HOME: home, PROYECTOS_REGISTRY: reg } });
  assert.equal(r.stdout.trim(), "asistente-voz|asistente-voz|asistente-voz|hilos", r.stderr);
  escribirRegistro();
});
