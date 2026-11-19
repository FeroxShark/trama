// «Historial de chats» (electron/historial-chats.ts): qué entra en la lista, cómo figura cada chat (archivado o cerrado), y que borrar mande a la
// papelera SÓLO el transcript de esa sesión, nunca uno en curso ni una ruta de afuera de la carpeta de transcripts. La papelera es falsa e
// inyectada: no se manda nada real a ningún lado. Las carpetas son temporales.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync as realpathJs, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { ConvListada } from "../electron/claude-code.ts";
import { vistaConvs } from "../electron/claude-code.ts";
import {
  armarHistorial,
  borrarDelHistorial,
  comoDeMotivo,
  crearRegistroCierres,
  REGISTRO_MAX,
  transcriptSeguro,
  type DepsBorrar,
  type ResultadoPapelera,
} from "../electron/historial-chats.ts";
import { esperarHasta } from "./esperar.ts";

// El nativo: en Windows expande el nombre corto de la carpeta temporal (RUNNER~1).
const tmp = realpathJs.native(mkdtempSync(path.join(os.tmpdir(), "hist-chats-")));
test.after(() => rmSync(tmp, { recursive: true, force: true }));

const SID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const raiz = path.join(tmp, "projects");
const casa = path.join(tmp, "casa");

/** Un transcript de verdad en `<raíz>/<carpeta>/<sid>.jsonl`. */
function transcript(n: number, carpeta = "-casa-atlas", r = raiz) {
  const dir = path.join(r, carpeta);
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${SID(n)}.jsonl`);
  writeFileSync(f, '{"type":"user"}\n');
  return f;
}

const conv = (n: number, extra: Partial<ConvListada> = {}): ConvListada => ({ sid: SID(n), titulo: `t${n}`, ms: n * 1000, modelo: "claude-opus-5-5", cwd: path.join(casa, "atlas"), ajena: false, ...extra });
const vista = async (convs: ConvListada[], extra: Partial<Parameters<typeof vistaConvs>[1]> = {}) =>
  vistaConvs(convs, { excluidas: new Set(), rutas: [[path.join(casa, "atlas"), "atlas"]], casa, real: async (p) => p, existe: async () => true, de: "trama", ...extra });

// --- Cómo figura ----------------------------------------------------------------------------------------------------------

test("cada motivo de cierre: archivar archiva, cerrar/borrar/quitar cierran, lo que no es de la persona no cuenta", () => {
  assert.equal(comoDeMotivo("archivar"), "archivado");
  for (const m of ["cerrar", "borrar", "quitar", undefined]) assert.equal(comoDeMotivo(m), "cerrado", String(m));
  for (const m of ["analista", "traer-fallido", "reinicio", "salida", "cualquiera", 7, null]) assert.equal(comoDeMotivo(m), null, String(m));
});

test("el registro anota cómo y cuándo salió cada chat, lo guarda en disco y se lo quita al volver o borrarse", async () => {
  let disco: string | null = null;
  let reloj = 1000;
  const nuevo = () =>
    crearRegistroCierres({ leer: async () => disco, guardar: async (j) => void (disco = j), ahora: () => reloj });
  const r = nuevo();
  await r.anotar(SID(1), "archivar");
  reloj = 2000;
  await r.anotar(SID(2), "cerrar");
  await r.anotar(SID(3), "analista");
  await r.anotar("../../etc/passwd", "cerrar");
  assert.deepEqual([...(await r.leer())], [
    [SID(1), { como: "archivado", ts: 1000 }],
    [SID(2), { como: "cerrado", ts: 2000 }],
  ]);
  // Otra instancia (otro arranque de Trama) lo lee de disco.
  assert.deepEqual([...(await nuevo().leer())].map(([s, c]) => [s, c.como]).sort(), [[SID(1), "archivado"], [SID(2), "cerrado"]]);
  await r.quitar(SID(1));
  assert.deepEqual([...(await nuevo().leer())].map(([s]) => s), [SID(2)]);
});

test("un registro roto o de otra versión se ignora; el tope se queda con los más recientes", async () => {
  for (const roto of ["{no es json", '{"version":9,"chats":{}}', "null", ""]) {
    const r = crearRegistroCierres({ leer: async () => roto, guardar: async () => {}, ahora: () => 1 });
    assert.equal((await r.leer()).size, 0, roto);
  }
  let disco = "";
  let t = 0;
  const r = crearRegistroCierres({ leer: async () => null, guardar: async (j) => void (disco = j), ahora: () => ++t, max: 5 });
  for (let i = 0; i < 9; i++) await r.anotar(`s${i}`, "cerrar");
  const guardado = JSON.parse(disco).chats as Record<string, unknown>;
  assert.deepEqual(Object.keys(guardado).sort(), ["s4", "s5", "s6", "s7", "s8"]);
  assert.ok(REGISTRO_MAX >= 1000);
});

// --- La lista ---------------------------------------------------------------------------------------------------------------

test("la lista: sólo lo que lanzó Trama y ya no tiene líder; archivado según el registro, cerrado si no hay nada; lo más reciente primero", async () => {
  const convs = [
    conv(1, { deTrama: true }), // archivado según el registro
    conv(2, { deTrama: true }), // cerrado antes del registro
    conv(3), // de Claude Code: no es de acá
    conv(4, { deTrama: true }), // hoy tiene líder: no está en el historial
    conv(5, { deTrama: true, cwd: path.join(tmp, "worktrees", "x") }), // sin marca en la lista de abajo, pero conocida (registro)
    conv(6, { cwd: path.join(casa, "otra") }), // conocida por el registro aunque su transcript no tenga la marca
  ];
  const vistas = await vista(convs, { excluidas: new Set([SID(4)]), conocidas: new Set([SID(6)]) });
  const h = armarHistorial(vistas, new Map([[SID(1), { como: "archivado" as const, ts: 9_000_000 }]]));
  assert.deepEqual(h.map((c) => [c.sid, c.como]), [
    [SID(1), "archivado"],
    [SID(6), "cerrado"],
    [SID(5), "cerrado"],
    [SID(2), "cerrado"],
  ]);
  // Sin registro, «cuándo» es su última actividad; con registro, cuándo se archivó.
  assert.equal(h[0]!.cuando, 9_000_000);
  assert.equal(h[3]!.cuando, 2000);
  assert.equal(h.find((c) => c.sid === SID(6))!.proyecto, null);
  assert.equal(h.find((c) => c.sid === SID(1))!.proyecto, "atlas");
});

test("la lista de siempre (De Claude Code) no cambia: sigue sin las de Trama", async () => {
  const v = await vista([conv(1, { deTrama: true }), conv(2)], { de: "ajenas" });
  assert.deepEqual(v.map((c) => c.sid), [SID(2)]);
  const sin = await vista([conv(1, { deTrama: true }), conv(2)], { de: undefined });
  assert.deepEqual(sin.map((c) => c.sid), [SID(2)]);
});

// --- Borrar ---------------------------------------------------------------------------------------------------------------

/** Las `Deps` de borrar: papelera falsa que anota y (como la de verdad) saca el archivo de su lugar; un registro que anota lo que se le quita. */
function deps(o: Partial<Omit<DepsBorrar, "papelera">> & { papelera?: ResultadoPapelera; rutas?: Record<string, string> } = {}) {
  const { papelera: resultado = "ok", rutas, ...resto } = o;
  const mandado: string[] = [];
  const quitados: string[] = [];
  const d: DepsBorrar = {
    rutaDe: async (sid) => rutas?.[sid] ?? null,
    raices: () => [raiz],
    estado: async () => "libre",
    papelera: async (ruta) => {
      mandado.push(ruta);
      if (resultado === "ok") rmSync(ruta);
      return resultado;
    },
    quitar: async (sid) => void quitados.push(sid),
    ...resto,
  };
  return { d, mandado, quitados };
}

test("borrar manda a la papelera sólo el transcript de esa sesión y saca el chat del registro", async () => {
  const f1 = transcript(1);
  const f2 = transcript(2);
  const otroDeLaCarpeta = path.join(path.dirname(f1), "notas.txt");
  writeFileSync(otroDeLaCarpeta, "no tocar");
  const { d, mandado, quitados } = deps({ rutas: { [SID(1)]: f1, [SID(2)]: f2 } });
  assert.deepEqual(await borrarDelHistorial(SID(1), d), { ok: true });
  assert.deepEqual(mandado, [f1]);
  assert.deepEqual(quitados, [SID(1)]);
  assert.ok(!existsSync(f1));
  assert.ok(existsSync(f2), "el de otra sesión sigue");
  assert.ok(existsSync(otroDeLaCarpeta), "lo que no es ese archivo sigue");
  assert.ok(existsSync(path.dirname(f1)), "la carpeta sigue");
});

test("no borra un chat en curso ni uno que volvió a la barra", async () => {
  const f = transcript(3);
  for (const estado of ["enCurso", "abierto"] as const) {
    const { d, mandado, quitados } = deps({ rutas: { [SID(3)]: f }, estado: async () => estado });
    assert.deepEqual(await borrarDelHistorial(SID(3), d), { ok: false, motivo: estado });
    assert.deepEqual([mandado, quitados], [[], []]);
    assert.ok(existsSync(f));
  }
});

test("una ruta fuera de la carpeta de transcripts nunca se toca", async () => {
  const fuera = path.join(tmp, "fuera");
  mkdirSync(fuera, { recursive: true });
  const secreto = path.join(fuera, `${SID(4)}.jsonl`);
  writeFileSync(secreto, "x");
  const profundo = transcript(5, path.join("a", "b"));
  const sinCarpeta = path.join(raiz, `${SID(6)}.jsonl`);
  writeFileSync(sinCarpeta, "x");
  // Un enlace en la carpeta de transcripts que apunta afuera.
  const dirEnlace = path.join(raiz, "-enlazada");
  mkdirSync(dirEnlace, { recursive: true });
  const enlace = path.join(dirEnlace, `${SID(7)}.jsonl`);
  let hayEnlaces = true;
  try {
    symlinkSync(secreto, enlace);
  } catch {
    hayEnlaces = false; // Windows sin permiso: la prueba de enlaces no aplica
  }
  const casos: [string, number][] = [
    [secreto, 4],
    [profundo, 5],
    [sinCarpeta, 6],
    ...(hayEnlaces ? ([[enlace, 7]] as [string, number][]) : []),
    [path.join(raiz, "..", "fuera", `${SID(4)}.jsonl`), 4],
    ["relativa.jsonl", 4],
    [path.join(raiz, "-casa-atlas", "otro-nombre.jsonl"), 4],
  ];
  for (const [ruta, n] of casos) {
    const { d, mandado } = deps({ rutas: { [SID(n)]: ruta } });
    assert.deepEqual(await borrarDelHistorial(SID(n), d), { ok: false, motivo: "noEsta" }, ruta);
    assert.deepEqual(mandado, [], ruta);
  }
  assert.ok(existsSync(secreto));
  // Un sid que no es de nadie, o con forma rara, tampoco.
  for (const sid of ["../x", "", SID(99), 5, null]) {
    const { d, mandado } = deps();
    assert.deepEqual(await borrarDelHistorial(sid, d), { ok: false, motivo: "noEsta" }, String(sid));
    assert.deepEqual(mandado, []);
  }
});

test("la raíz de otra cuenta de Claude también vale, y la ventana no elige la ruta", async () => {
  const otra = path.join(tmp, "cuenta2", "projects");
  const f = transcript(8, "-casa-atlas", otra);
  assert.equal(await transcriptSeguro(f, SID(8), [raiz, otra]), f);
  assert.equal(await transcriptSeguro(f, SID(8), [raiz]), null);
  // `borrarDelHistorial` pide la ruta al índice del main, no a quien llama: no hay forma de pasarle una.
  const { d, mandado } = deps({ rutas: { [SID(8)]: f }, raices: () => [raiz, otra] });
  assert.deepEqual(await borrarDelHistorial(SID(8), { ...d }), { ok: true });
  assert.deepEqual(mandado, [f]);
});

test("sin papelera o con la papelera fallando no se borra nada y el chat sigue en el historial", async () => {
  for (const [papelera, motivo] of [["sin", "sinPapelera"], ["fallo", "fallo"]] as const) {
    const f = transcript(9);
    const { d, quitados } = deps({ rutas: { [SID(9)]: f }, papelera });
    assert.deepEqual(await borrarDelHistorial(SID(9), d), { ok: false, motivo });
    assert.deepEqual(quitados, []);
    assert.ok(existsSync(f));
  }
});

test("el mismo test sin esperar por reloj: el registro termina de guardar antes de seguir", async () => {
  let guardados = 0;
  const r = crearRegistroCierres({ leer: async () => null, guardar: async () => void guardados++, ahora: () => 1 });
  void r.anotar(SID(1), "cerrar");
  void r.anotar(SID(2), "archivar");
  await esperarHasta(() => guardados === 2);
  assert.equal(guardados, 2);
});
