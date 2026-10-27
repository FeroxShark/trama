import { createContext, useSyncExternalStore } from "react";
import type { Subagente, Subagentes } from "../../electron/subagentes";
import { fuente } from "../datos/fuente";
import {
  CLAVE_ARCHIVADOS,
  OBSOLETO_S,
  activo,
  archivados,
  archivarSub as archivarSubLogica,
  archivarTodosSubs as archivarTodosSubsLogica,
  corriendo,
  esSubArchivado,
  limpiarArchivadosSubs as limpiarArchivadosSubsLogica,
  pintaSub,
} from "./subagentes-archivado";

export { CLAVE_ARCHIVADOS, OBSOLETO_S, activo, corriendo, esSubArchivado, pintaSub };

let actual: Subagentes = {};
let pedido = false;
const oyentes = new Set<() => void>();
const SIN: readonly Subagente[] = [];

export function archivarSub(sid: string, id: string) {
  archivarSubLogica(sid, id, () => poner({ ...actual }));
}

export function archivarTodosSubs(sid: string, ahora = Math.floor(Date.now() * 0.001)) {
  archivarTodosSubsLogica(sid, ahora, actual[sid], () => poner({ ...actual }));
}

export function limpiarArchivadosSubs() {
  limpiarArchivadosSubsLogica(() => poner({ ...actual }));
}

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
