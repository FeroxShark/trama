// "Integrar solo lo seguro" (B22): cada lista nueva de `pa --hilos` se barre y
// lo seguro (seguro.ts) se integra con `pa <proy> --integrar <id> --tests` y
// `PA_AUTO=1` (así `pa` anota auto=1 en integradas.tsv, que lee salud.ts), de a una por proyecto
// (la misma cola que las acciones de Ramas). Si da 80 (conflicto con main), un
// `pa <proy> --actualizar <id> --async` y, cuando esa corrida termina (lo dice
// la lista siguiente: sin timers ni polling), un solo reintento. Cualquier otro
// rc, o el segundo 80, queda para el analista con el error corto. Lo integrado
// solo y lo que falló se recuerda en `~/.local/state/hilos/auto.json`.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { leerPreferencias } from "./preferencias.js";
import { argvIntegrarPa, ENV, ESTADO, escribirAtomico, nombrePa } from "./pa.js";
import { enCola, ejecutar } from "./paneles.js";
import { registro } from "./registro.js";
import { mientrasIntegra } from "./salud.js";
import { idLanzado, RC_CONFLICTO, RESUELTO, seguras, ultimasPorRama, vivo, type HiloSeguro } from "./seguro.js";
import { sesionesVivas } from "./sesiones.js";
import { silencio } from "./log.js";

const ARCHIVO = path.join(ESTADO, "auto.json");
/** Cuántas integradas solas se recuerdan. */
const TOPE = 50;

type HiloAuto = HiloSeguro & { tarea?: string };

export type Integrada = { id: string; proyecto: string; tarea: string; ts: number };
export type Falla = { id: string; rama: string; proyecto: string; error: string; rc: number; ts: number };
export type EnCurso = { id: string; rama: string; fase: "integrando" | "actualizando" };

/** Lo que ve el panel de Ramas. */
export type EstadoAuto = { version: 1; prendido: boolean; enCurso: EnCurso[]; integradas: Integrada[]; fallas: Falla[] };

type Guardado = { version: 1; integradas: Integrada[]; fallas: Falla[] };

let guardado: Guardado | null = null;
/** rama → lo que se está haciendo con ella; `desde`: cuándo se lanzó el `--actualizar`. */
const enCurso = new Map<string, EnCurso & { proyecto: string; tarea: string; desde?: number; lanzada?: string | null }>();
let avisar: (e: EstadoAuto) => void = () => {};
let prendido = true;

/** En bench y capturas no se toca nada. */
const apagado = () => !!(process.env.HILOS_BENCH || process.env.HILOS_CAPTURA || process.env.HILOS_CAPTURA_PNG);

async function leer(): Promise<Guardado> {
  if (guardado) return guardado;
  try {
    const j = JSON.parse(await readFile(ARCHIVO, "utf8"));
    guardado = {
      version: 1,
      integradas: j?.version === 1 && Array.isArray(j.integradas) ? j.integradas : [],
      fallas: j?.version === 1 && Array.isArray(j.fallas) ? j.fallas : [],
    };
  } catch {
    guardado = { version: 1, integradas: [], fallas: [] };
  }
  return guardado;
}

const guardar = () => (guardado ? escribirAtomico(ARCHIVO, JSON.stringify(guardado) + "\n").catch(silencio("autointegrar")) : Promise.resolve());

export async function estadoAuto(): Promise<EstadoAuto> {
  const g = await leer();
  prendido = (await leerPreferencias()).autoIntegrar !== false;
  return {
    version: 1,
    prendido: prendido && !apagado(),
    enCurso: [...enCurso.values()].map(({ id, rama, fase }) => ({ id, rama, fase })),
    integradas: g.integradas,
    fallas: g.fallas,
  };
}

const emitir = () => void estadoAuto().then(avisar, () => {});

/** Recibe cada cambio (para mandarlo al renderer). */
export function alCambiarAuto(fn: (e: EstadoAuto) => void) {
  avisar = fn;
}

/** El usuario prendió o apagó el toggle: si lo prendió, se barre la última lista. */
export function cambioPrendido() {
  emitir();
  if (ultimaLista) void barrer(ultimaLista);
}

let ultimaLista: HiloAuto[] | null = null;
const ahora = () => Math.floor(Date.now() / 1000);

async function fallo(e: EnCurso & { proyecto: string }, rc: number, dijo: string) {
  const g = await leer();
  g.fallas = [...g.fallas.filter((f) => f.rama !== e.rama), { id: e.id, rama: e.rama, proyecto: e.proyecto, error: dijo || `rc ${rc}`, rc, ts: ahora() }];
  enCurso.delete(e.rama);
  await guardar();
  emitir();
}

/** `pa <proy> --integrar <id> --tests` con PA_AUTO=1; `reintento`: ya pasó por un `--actualizar`. */
async function integrar(h: HiloAuto, reintento: boolean) {
  const e = { id: h.id, rama: h.rama!, fase: "integrando" as const, proyecto: h.proyecto, tarea: h.tarea ?? "" };
  enCurso.set(e.rama, e);
  emitir();
  const r = await enCola(h.proyecto, () =>
    mientrasIntegra(h.proyecto, async () => ejecutar(await argvIntegrarPa(h.proyecto, h.id), { ...ENV, PA_AUTO: "1" })),
  ).catch(
    (err) => ({ rc: -1, out: "", dijo: String(err?.message ?? err) }),
  );
  if (r.rc === 0) {
    const g = await leer();
    g.integradas = [{ id: h.id, proyecto: h.proyecto, tarea: e.tarea, ts: ahora() }, ...g.integradas.filter((x) => x.id !== h.id)].slice(0, TOPE);
    g.fallas = g.fallas.filter((f) => f.rama !== e.rama);
    enCurso.delete(e.rama);
    await guardar();
    return emitir();
  }
  if (r.rc !== RC_CONFLICTO || reintento) return fallo(e, r.rc, r.dijo);
  // Conflicto: que un worker rebasee la rama sobre main, y se reintenta cuando termine.
  const nombre = await nombrePa(h.proyecto);
  const a = await enCola(h.proyecto, () => ejecutar([nombre, "--actualizar", h.id, "--async"], { ...ENV, PA_AUTO: "1" }));
  if (a.rc !== 0) return fallo(e, a.rc, a.dijo);
  enCurso.set(e.rama, { ...e, fase: "actualizando", desde: ahora(), lanzada: idLanzado(a.out) });
  emitir();
}

/**
 * Una lista nueva de `pa --hilos`: los `--actualizar` que terminaron se
 * reintentan una vez y lo seguro que nadie tocó todavía se integra.
 */
export async function barrer(hilos: HiloAuto[]) {
  ultimaLista = hilos;
  if (apagado()) return;
  prendido = (await leerPreferencias()).autoIntegrar !== false;
  const ultimas = ultimasPorRama(hilos);

  for (const e of [...enCurso.values()]) {
    if (e.fase !== "actualizando") continue;
    const u = ultimas.get(e.rama);
    const lanzada = e.lanzada ? hilos.find((h) => h.id === e.lanzada) : u && u.id !== e.id && u.inicio >= (e.desde ?? 0) - 5 ? u : undefined;
    if (!lanzada || vivo(lanzada)) continue;
    if (lanzada.estado === "murio") {
      await fallo(e, -1, `--actualizar ${lanzada.id}: murio`);
      continue;
    }
    const original = hilos.find((h) => h.id === e.id);
    if (original) void integrar({ ...original, tarea: e.tarea }, true);
    else enCurso.delete(e.rama);
  }

  // Lo que falló y después se resolvió a mano (o ya no está en la lista) no se recuerda más.
  const g = await leer();
  const sigue = g.fallas.filter((f) => {
    const h = hilos.find((x) => x.id === f.id);
    return h && !RESUELTO.has(h.estado);
  });
  if (sigue.length !== g.fallas.length) {
    g.fallas = sigue;
    await guardar();
    emitir();
  }

  if (!prendido) return;
  const [reg, sesiones] = await Promise.all([registro(), sesionesVivas()]);
  const conTests = new Set(reg.filter((p) => p.tests).flatMap((p) => [p.slug, p.nombre]));
  const vivas = new Set(sesiones.map((s) => s.id));
  const yaFallo = new Set(g.fallas.map((f) => f.rama));
  for (const h of seguras(hilos, { tests: (p) => conTests.has(p), liderVivo: (sid) => vivas.has(sid) })) {
    if (enCurso.has(h.rama!) || yaFallo.has(h.rama!) || g.integradas.some((x) => x.id === h.id)) continue;
    void integrar(h, false);
  }
}
