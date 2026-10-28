import { createContext, useEffect, useState, useSyncExternalStore } from "react";
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

// El snapshot tiene que ser estable entre lecturas (useSyncExternalStore): se reusa la lista previa si trae lo mismo.
let ultimo: Subagentes = {};
const igual = (x: readonly Subagente[], y: readonly Subagente[]) => x.length === y.length && x.every((u, i) => u === y[i]);
const todos = (): Subagentes => {
  const res: Subagentes = {};
  for (const [sid, lista] of Object.entries(actual)) {
    const visibles = lista.filter((u) => !archivados.has(`${sid}:${u.id}`));
    if (visibles.length) res[sid] = visibles;
  }
  const ks = Object.keys(res);
  if (ks.length === Object.keys(ultimo).length && ks.every((k) => ultimo[k] && igual(ultimo[k], res[k]))) return ultimo;
  return (ultimo = res);
};

export const useSubagentes = (sid: string | null): readonly Subagente[] => {
  const t = useSyncExternalStore(suscribir, todos);
  return (sid && t[sid]) || SIN;
};

/**
 * El paso del tiempo cuenta: un subagente deja de estar activo por callarse (`activo`), sin que llegue ningún evento nuevo.
 * Devuelve un número que cambia cada medio minuto mientras alguno de los `listas` figure corriendo, para volver a calcular.
 */
export function useTicSubagentes(listas: Subagentes | readonly Subagente[]): number {
  const [tic, setTic] = useState(0);
  const hay = (Array.isArray(listas) ? [listas as readonly Subagente[]] : Object.values(listas as Subagentes)).some((l) => l.some((u) => u.estado === "corriendo"));
  useEffect(() => {
    if (!hay) return;
    const i = setInterval(() => setTic((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, [hay]);
  return tic;
}

export const useTodosSubagentes = (): Subagentes => useSyncExternalStore(suscribir, todos);

export { claveSub, deClaveSub } from "./subagente-clave";

export const SubAbierto = createContext<{ abierta: string | null; abrir: (sid: string, id: string) => void } | null>(null);
