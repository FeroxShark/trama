// «Borrar proyecto…» (electron/proyectos-borrar.ts): quitar de Trama, deshacer, negarse con trabajo vivo y cada guarda de la ruta antes de la papelera.
// Registry y HOME temporales, `trash` falso inyectado: no se manda nada real a ninguna papelera, ni se toca el `pa` ni los líderes de verdad.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { armarArbol } from "../src/barra/arbol.ts";
import { accionesCarpeta } from "../src/barra/menu-logica.ts";
import { avisoGit, puedeConfirmar } from "../src/barra/borrar-logica.ts";
import type { Hilo, Lider } from "../src/datos/contrato.ts";
import { listarProyectos } from "../electron/proyectos-alias.ts";
import { contarVivos, motivoPapelera, papeleraProyecto, quitarProyecto, reactivarProyecto, vistaBorrar, type Deps, type ResultadoPapelera } from "../electron/proyectos-borrar.ts";
import { mapaQuitados, mapaReemplazos } from "../electron/reemplazos.ts";
import { textoT } from "../electron/errores.ts";

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), "borrar-")));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const casa = path.join(tmp, "casa");
// El HOME de la prueba (os.homedir() lo lee en cada llamada): el home de verdad no entra en ninguna cuenta.
const homeAntes = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = casa;
process.env.USERPROFILE = casa;
test.after(() => {
  for (const [k, v] of Object.entries(homeAntes)) v === undefined ? delete process.env[k] : (process.env[k] = v);
});
const reg = path.join(tmp, "registry.json");
const carpeta = (n: string) => {
  const d = path.join(casa, "Proyectos", n);
  mkdirSync(d, { recursive: true });
  return d;
};
const leerReg = () => JSON.parse(readFileSync(reg, "utf8")).projects as Record<string, unknown>[];
const escribirReg = (projects: Record<string, unknown>[]) => writeFileSync(reg, JSON.stringify({ projects }, null, 2));

/** Los `Deps` de las pruebas: nada vivo, git falso, papelera falsa que anota qué le mandaron. */
function deps(o: Partial<Deps> & { vivos?: { lideres: number; workers: number }; papelera?: ResultadoPapelera } = {}) {
  const mandadas: string[] = [];
  const d: Deps = {
    vivos: async () => o.vivos ?? { lideres: 0, workers: 0 },
    git: o.git ?? (async (_r, args) => (args[0] === "status" ? " M a.ts\n?? b.ts\n" : "2\n")),
    papelera: async (r) => (mandadas.push(r), o.papelera ?? "ok"),
    casa,
    ahora: () => new Date("2026-11-05T12:00:00.000Z"),
  };
  return { d, mandadas };
}

const nuevoRegistro = (extra: Record<string, unknown>[] = []) => {
  mkdirSync(casa, { recursive: true });
  escribirReg([
    { name: "atlas", path: carpeta("atlas"), desc: "uno", estado: "infra" },
    { name: "duna", path: carpeta("duna"), titulo: "Duna Studio" },
    { name: "madre", path: carpeta("madre") },
    { name: "hija", path: path.join(carpeta("madre"), "hija") },
    ...extra,
  ]);
  mkdirSync(path.join(carpeta("madre"), "hija"), { recursive: true });
};

test("quitar: marca retirado + retirado_el (y guarda el estado de antes) por la vía de siempre y no toca la carpeta", async () => {
  nuevoRegistro();
  const { d } = deps();
  const r = await quitarProyecto(reg, "atlas", d);
  assert.equal(r.estado, "retirado");
  assert.equal(r.retiradoEl, "2026-11-05T12:00:00.000Z");
  const e = leerReg().find((x) => x.name === "atlas")!;
  assert.deepEqual([e.estado, e.retirado_el, e.estado_antes], ["retirado", "2026-11-05T12:00:00.000Z", "infra"]);
  // Los demás quedan como estaban, hay respaldo del registry y la carpeta sigue.
  assert.equal(leerReg().find((x) => x.name === "duna")!.estado, undefined);
  assert.ok(readFileSync(`${reg}.bak`, "utf8").includes('"infra"'));
  assert.equal((await listarProyectos(reg)).find((p) => p.slug === "atlas")!.existe, true);
  // Quitar dos veces: se niega.
  await assert.rejects(quitarProyecto(reg, "atlas", d), /main\.borrar\.yaQuitado/);
});

test("deshacer: vuelve el estado de antes (o ninguno) y saca retirado_el", async () => {
  nuevoRegistro();
  const { d } = deps();
  await quitarProyecto(reg, "atlas", d);
  await quitarProyecto(reg, "duna", d);
  const a = await reactivarProyecto(reg, "atlas");
  assert.equal(a.estado, "infra");
  assert.equal(a.retiradoEl, null);
  const du = await reactivarProyecto(reg, "duna");
  assert.equal(du.estado, null);
  const e = leerReg().find((x) => x.name === "duna")!;
  assert.equal("estado" in e || "retirado_el" in e || "estado_antes" in e, false);
  // Lo que `pa` retiró (sin retirado_el) no se reactiva desde acá.
  escribirReg([{ name: "viejo", path: carpeta("viejo"), estado: "retirado" }]);
  await assert.rejects(reactivarProyecto(reg, "viejo"), /main\.borrar\.noQuitado/);
});

test("se niega con líderes con proceso o workers de pa vivos: el registry no cambia", async () => {
  nuevoRegistro();
  const antes = readFileSync(reg, "utf8");
  for (const vivos of [{ lideres: 1, workers: 0 }, { lideres: 0, workers: 2 }]) {
    const { d, mandadas } = deps({ vivos });
    await assert.rejects(quitarProyecto(reg, "atlas", d), /main\.borrar\.vivos/);
    await assert.rejects(papeleraProyecto(reg, "atlas", "atlas", d), /main\.borrar\.vivos/);
    assert.deepEqual(mandadas, []);
    assert.equal(readFileSync(reg, "utf8"), antes);
  }
  // La vista lo dice (para que el diálogo no deje confirmar) sin cambiar nada.
  const v = await vistaBorrar(reg, "atlas", deps({ vivos: { lideres: 1, workers: 2 } }).d);
  assert.match(v.negado ?? "", /main\.borrar\.vivos/);
  assert.match(v.negado ?? "", /"workers":2/);
  assert.equal(readFileSync(reg, "utf8"), antes);
});

test("contarVivos: líderes con proceso dentro de la carpeta y workers vivos del proyecto (trabajando, colgado o en cola)", async () => {
  const ruta = carpeta("atlas");
  const hilos = [
    { proyecto: "atlas", estado: "trabajando" },
    { proyecto: "atlas", estado: "colgado" },
    { proyecto: "atlas", estado: "listo", en_cola: true },
    { proyecto: "atlas", estado: "listo" },
    { proyecto: "atlas", estado: "murio" },
    { proyecto: "duna", estado: "trabajando" },
  ];
  const lideres = [{ cwd: ruta }, { cwd: path.join(ruta, "src") }, { cwd: carpeta("duna") }, {}];
  assert.deepEqual(await contarVivos({ slug: "atlas", ruta }, lideres, hilos), { lideres: 2, workers: 3 });
  // Una carpeta con el mismo prefijo (atlas-2) no cuenta.
  assert.deepEqual(await contarVivos({ slug: "atlas", ruta }, [{ cwd: `${ruta}-2` }], []), { lideres: 0, workers: 0 });
});

test("papelera: cada guarda de la ruta niega antes de tocar nada (home, raíz, contiene otros proyectos, worktree de pa, no existe)", async () => {
  const hogar = realpathSync(casa);
  const otros = [{ nombre: "hija", ruta: path.join(hogar, "Proyectos", "madre", "hija") }];
  const motivo = (r: string) => motivoPapelera(r, otros, hogar);
  assert.match(motivo(hogar) ?? "", /main\.borrar\.casa/);
  assert.match(motivo(path.parse(hogar).root) ?? "", /main\.borrar\.casa/);
  assert.match(motivo(path.dirname(hogar)) ?? "", /main\.borrar\.casa/); // el home está adentro
  assert.match(motivo(path.join(hogar, "Proyectos", "madre")) ?? "", /main\.borrar\.contiene/);
  assert.match(motivo(path.join(hogar, ".local", "state", "pa", "worktrees", "atlas")) ?? "", /main\.borrar\.worktree/);
  assert.equal(motivo(path.join(hogar, "Proyectos", "atlas")), null);
  assert.equal(motivo(path.join(hogar, "Proyectos", "madre", "hija")), null);

  // De punta a punta, con el registry temporal: nada llega a la papelera y el proyecto no se quita.
  nuevoRegistro([{ name: "casa", path: path.join(hogar, "Proyectos", "casita") }]);
  const antes = readFileSync(reg, "utf8");
  const { d, mandadas } = deps();
  await assert.rejects(papeleraProyecto(reg, "madre", "madre", d), /main\.borrar\.contiene/);
  await assert.rejects(papeleraProyecto(reg, "casita", "casa", d), /main\.borrar\.noExiste/);
  await assert.rejects(papeleraProyecto(reg, "atlas", "otro-nombre", d), /main\.borrar\.nombre/);
  await assert.rejects(papeleraProyecto(reg, "atlas", "", d), /main\.borrar\.nombre/);
  await assert.rejects(papeleraProyecto(reg, "no-existe", "x", d), /main\.proyectoRaro/);
  await assert.rejects(papeleraProyecto(reg, "../etc", "x", d), /main\.proyectoRaro/);
  assert.deepEqual(mandadas, []);
  assert.equal(readFileSync(reg, "utf8"), antes);
});

test("papelera: un enlace se resuelve con realpath (apuntar al home no engaña) y el home mismo ni está en la lista de proyectos", async () => {
  const hogar = realpathSync(casa);
  mkdirSync(hogar, { recursive: true });
  const enlace = path.join(tmp, "atajo");
  try {
    (await import("node:fs")).symlinkSync(hogar, enlace);
  } catch {
    return; // sin permiso para enlaces simbólicos (Windows sin modo desarrollador): la guarda por realpath ya está cubierta arriba
  }
  escribirReg([{ name: "atajo", path: enlace }, { name: "casa", path: hogar }]);
  const { d, mandadas } = deps();
  // El home no es un proyecto (listarProyectos lo salta) y el atajo que apunta a él tampoco.
  assert.deepEqual((await listarProyectos(reg)).map((p) => p.slug), []);
  await assert.rejects(papeleraProyecto(reg, "atajo", "atajo", d), /main\.proyectoRaro/);
  assert.deepEqual(mandadas, []);
});

test("papelera: con el nombre exacto quita y manda la carpeta (realpath) a la papelera falsa", async () => {
  nuevoRegistro();
  const { d, mandadas } = deps();
  const r = await papeleraProyecto(reg, "duna", "Duna Studio", d);
  assert.equal(r.papelera, "ok");
  assert.equal(r.proyecto.estado, "retirado");
  assert.deepEqual(mandadas, [realpathSync(path.join(casa, "Proyectos", "duna"))]);
  assert.equal(leerReg().find((x) => x.name === "duna")!.estado, "retirado");
});

test("papelera: sin papelera o si falla, no borra nada y el proyecto queda quitado (se puede deshacer)", async () => {
  for (const papelera of ["sin", "fallo"] as const) {
    nuevoRegistro();
    const { d, mandadas } = deps({ papelera });
    const r = await papeleraProyecto(reg, "atlas", "atlas", d);
    assert.equal(r.papelera, papelera);
    assert.equal(r.proyecto.estado, "retirado");
    assert.equal(mandadas.length, 1);
    assert.equal((await reactivarProyecto(reg, "atlas")).estado, "infra");
  }
});

test("la vista: ruta, git (cambios y commits sin empujar), y qué niega la papelera", async () => {
  nuevoRegistro();
  const v = await vistaBorrar(reg, "duna", deps().d);
  assert.deepEqual([v.nombre, v.ruta, v.existe, v.negado, v.papeleraNegada], ["Duna Studio", realpathSync(path.join(casa, "Proyectos", "duna")), true, null, null]);
  assert.deepEqual(v.git, { sinCommitear: 2, sinEmpujar: 2 });
  // No es un repo: git contesta null.
  assert.equal((await vistaBorrar(reg, "duna", deps({ git: async () => null }).d)).git, null);
  // Un proyecto que contiene a otro: la papelera se niega, quitar sigue valiendo.
  const m = await vistaBorrar(reg, "madre", deps().d);
  assert.match(m.papeleraNegada ?? "", /main\.borrar\.contiene/);
  assert.equal(m.negado, null);
  assert.equal(m.git, null);
  // Ya quitado: la vista lo dice.
  await quitarProyecto(reg, "duna", deps().d);
  assert.match((await vistaBorrar(reg, "duna", deps().d)).negado ?? "", /main\.borrar\.yaQuitado/);
});

test("el diálogo: puedeConfirmar y el aviso de git", async () => {
  nuevoRegistro();
  const vista = await vistaBorrar(reg, "duna", deps().d);
  assert.equal(puedeConfirmar({ vista: null, papelera: false, escrito: "", ocupado: false }), false);
  assert.equal(puedeConfirmar({ vista, papelera: false, escrito: "", ocupado: false }), true);
  assert.equal(puedeConfirmar({ vista, papelera: false, escrito: "", ocupado: true }), false);
  assert.equal(puedeConfirmar({ vista, papelera: true, escrito: "", ocupado: false }), false);
  assert.equal(puedeConfirmar({ vista, papelera: true, escrito: "duna studio", ocupado: false }), false);
  assert.equal(puedeConfirmar({ vista, papelera: true, escrito: "Duna Studio", ocupado: false }), true);
  assert.equal(puedeConfirmar({ vista: { ...vista, negado: textoT("main.borrar.vivos", { lideres: 1, workers: 0 }) }, papelera: false, escrito: "", ocupado: false }), false);
  assert.equal(puedeConfirmar({ vista: { ...vista, papeleraNegada: textoT("main.borrar.casa") }, papelera: true, escrito: "Duna Studio", ocupado: false }), false);
  assert.deepEqual(avisoGit(null), { tipo: "norepo" });
  assert.deepEqual(avisoGit({ sinCommitear: 0, sinEmpujar: 0 }), { tipo: "limpio" });
  assert.deepEqual(avisoGit({ sinCommitear: 3, sinEmpujar: 0 }), { tipo: "sucio", sinCommitear: 3, sinEmpujar: 0 });
});

test("el menú del proyecto ofrece «Borrar proyecto…» sólo si es un proyecto del registry", () => {
  assert.ok(accionesCarpeta(false, undefined, undefined, true).some((o) => o.a === "borrarProyecto"));
  assert.ok(!accionesCarpeta(false, undefined, { propio: false }).some((o) => o.a === "borrarProyecto"));
  assert.ok(accionesCarpeta(false, undefined, { propio: false }, true).some((o) => o.a === "renombrar"));
});

const AHORA = 2_000_000_000;
const lider = (id: string, inferido: string | null): Lider => ({
  id,
  nombre: `ana-${id}`,
  proyecto: "lo-que-diga-el-cwd",
  titulo: "Opus 5.5",
  actividad: AHORA - 60,
  creado: AHORA - 6 * 3600,
  cache_ttl_s: 3600,
  cache_vence: AHORA + 1800,
  origen: "app",
  pid: 4242,
  vivo: true,
  ocupado: false,
  modelo: "claude-opus-5-5",
  effort: "high",
  inferido,
});

test("un quitado desaparece del riel de verdad: su carpeta no sale y sus chats se ven en la general; un retirado por pa conserva la suya", async () => {
  nuevoRegistro();
  const ps0 = await listarProyectos(reg);
  const sinQuitar = new Map([...mapaQuitados(ps0, "general"), ...mapaReemplazos(ps0)]);
  assert.equal(sinQuitar.size, 0);
  const lideres = [lider("a", "atlas"), lider("b", "duna")];
  assert.deepEqual(armarArbol([] as Hilo[], { lideres, reemplazos: sinQuitar, ahora: AHORA }).carpetas.map((c) => c.proyecto).sort(), ["atlas", "duna"]);

  await quitarProyecto(reg, "atlas", deps().d);
  const ps = await listarProyectos(reg);
  const reemplazos = new Map([...mapaQuitados(ps, "general"), ...mapaReemplazos(ps)]);
  assert.deepEqual([...reemplazos], [["atlas", "general"]]);
  const a = armarArbol([] as Hilo[], { lideres, reemplazos, ahora: AHORA });
  assert.ok(!a.carpetas.some((c) => c.proyecto === "atlas"), "la carpeta quitada sigue en el riel");
  assert.equal(a.lideres.get("a")!.proyecto, "general"); // el chat no se pierde
  assert.equal(a.lideres.get("b")!.proyecto, "duna");

  // Reactivado, vuelve.
  await reactivarProyecto(reg, "atlas");
  const vuelve = new Map([...mapaQuitados(await listarProyectos(reg), "general")]);
  assert.equal(vuelve.size, 0);

  // Un retirado por `pa` (sin retirado_el) conserva su carpeta, como siempre.
  escribirReg([{ name: "viejo", path: carpeta("viejo"), estado: "retirado" }]);
  assert.equal(mapaQuitados(await listarProyectos(reg), "general").size, 0);
});

test("los canales: papelera sólo desde la PC; quitar y deshacer valen también desde el celular; están en el contrato y en la carcasa de Windows", () => {
  // (nucleo.ts no se importa acá: arrastra medio programa. Se lee la lista tal cual está escrita.)
  const fuente = readFileSync(new URL("../electron/nucleo.ts", import.meta.url), "utf8");
  const soloPc = /export const SOLO_PC_TAILNET[^=]*= new Set\(\[([^\]]*)\]/.exec(fuente)?.[1] ?? "";
  assert.ok(soloPc.includes('"proyectos:papelera"'));
  for (const c of ["proyectos:quitar", "proyectos:reactivar", "proyectos:borrarVista"]) assert.ok(!soloPc.includes(`"${c}"`), c);
  const rutas = readFileSync(new URL("../electron/maquinas-contrato.ts", import.meta.url), "utf8");
  for (const c of ["proyectos:borrarVista", "proyectos:quitar", "proyectos:reactivar", "proyectos:papelera"]) assert.ok(rutas.includes(`"${c}": "local"`), c);
  const canales = JSON.parse(readFileSync(new URL("../../windows/src/canales.json", import.meta.url), "utf8"));
  const todos = JSON.stringify(canales);
  for (const c of ["proyectos:borrarVista", "proyectos:quitar", "proyectos:reactivar", "proyectos:papelera"]) assert.ok(todos.includes(`"${c}"`), c);
});
