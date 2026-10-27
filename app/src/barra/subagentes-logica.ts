// Los subagentes que lanza cada sesión con su herramienta Agent (electron/subagentes.ts, por src/datos/fuente.ts):
// se piden una sola vez, cuando alguien pregunta por primera vez, y después llega cada cambio. Cada fila se suscribe
// sólo a su sesión: que otra lance un subagente no la repinta.
import { createContext, useSyncExternalStore } from "react";
import type { Subagente, Subagentes } from "../../electron/subagentes";
import { fuente } from "../datos/fuente";

let actual: Subagentes = {};
let pedido = false;
const oyentes = new Set<() => void>();
const SIN: readonly Subagente[] = [];

const CLAVE_ARCHIVADOS = "trama:subagentes:archivados";

function guardado<T>(clave: string, leer: (crudo: string) => T, defecto: T): T {
  if (typeof localStorage === "undefined") return defecto;
  try {
    const crudo = localStorage.getItem(clave);
    return crudo === null ? defecto : leer(crudo);
  } catch {
    return defecto;
  }
}

function guardar(clave: string, valor: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(clave, valor);
  } catch {}
}

const archivados = new Set<string>(guardado<string[]>(CLAVE_ARCHIVADOS, (c) => JSON.parse(c), []));

export const esSubArchivado = (sid: string, id: string): boolean => archivados.has(`${sid}:${id}`);

export function archivarSub(sid: string, id: string) {
  archivados.add(`${sid}:${id}`);
  guardar(CLAVE_ARCHIVADOS, JSON.stringify([...archivados]));
  poner({ ...actual });
}

export function archivarTodosSubs(sid: string, ahora = Math.floor(Date.now() / 1000)) {
  const lista = actual[sid] ?? [];
  let cambio = false;
  for (const u of lista) {
    if (!activo(u, ahora)) {
      archivados.add(`${sid}:${u.id}`);
      cambio = true;
    }
  }
  if (cambio) {
    guardar(CLAVE_ARCHIVADOS, JSON.stringify([...archivados]));
    poner({ ...actual });
  }
}

export function limpiarArchivadosSubs() {
  archivados.clear();
  guardar(CLAVE_ARCHIVADOS, "[]");
  poner({ ...actual });
}

export const OBSOLETO_S = 30 * 60;

export const activo = (u: Subagente, ahora = Math.floor(Date.now() / 1000)) => u.estado === "corriendo" && ahora - u.ultimo_en < OBSOLETO_S;

export const pintaSub = (u: Subagente, vivo: boolean) =>
  vivo
    ? ({ tipo: "trab", clave: "sub.corriendo" } as const)
    : u.estado === "error"
      ? ({ tipo: "fallo", clave: "sub.error" } as const)
      : u.estado === "corriendo"
        ? ({ tipo: "frenado", clave: "sub.sinNoticias" } as const)
        : ({ tipo: "term", clave: "sub.terminado" } as const);

export const corriendo = (lista: readonly Subagente[], ahora?: number) => lista.filter((u) => activo(u, ahora));

export function ponerSubagentes(s: Subagentes) {
  poner(s);
}

function poner(s: Subagentes) {
  actual = s;
  oyentes.forEach((f) => f());
}

function suscribir(fn: () => void) {
  if (!pedido) {
    pedido = true;
    let llego = false;
    fuente.alCambiarSubagentes((s) => {
      llego = true;
      poner(s);
    });
    void fuente.subagentes().then((s) => !llego && poner(s), () => {});
  }
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
}

export const useSubagentes = (sid: string | null): readonly Subagente[] =>
  useSyncExternalStore(suscribir, () => {
    if (!sid) return SIN;
    const lista = actual[sid];
    if (!lista) return SIN;
    const visibles = lista.filter((u) => !archivados.has(`${sid}:${u.id}`));
    return visibles.length ? visibles : SIN;
  });

export const useTodosSubagentes = (): Subagentes =>
  useSyncExternalStore(suscribir, () => {
    const res: Subagentes = {};
    for (const [sid, lista] of Object.entries(actual)) {
      const visibles = lista.filter((u) => !archivados.has(`${sid}:${u.id}`));
      if (visibles.length) res[sid] = visibles;
    }
    return res;
  });

export { claveSub, deClaveSub } from "./subagente-clave";

export const SubAbierto = createContext<{ abierta: string | null; abrir: (sid: string, id: string) => void } | null>(null);
