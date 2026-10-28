import type { Subagente } from "../../electron/subagentes.ts";

export const CLAVE_ARCHIVADOS = "trama:subagentes:archivados";

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

export const archivados = new Set<string>(guardado<string[]>(CLAVE_ARCHIVADOS, (c) => JSON.parse(c), []));

export const esSubArchivado = (sid: string, id: string): boolean => archivados.has(`${sid}:${id}`);

export function archivarSub(sid: string, id: string, alCambiar?: () => void) {
  archivados.add(`${sid}:${id}`);
  guardar(CLAVE_ARCHIVADOS, JSON.stringify([...archivados]));
  alCambiar?.();
}

export function archivarTodosSubs(sid: string, ahora = Math.floor(Date.now() * 0.001), lista?: readonly Subagente[], alCambiar?: () => void) {
  if (!lista) return;
  let cambio = false;
  for (const u of lista) {
    if (!activo(u, ahora)) {
      archivados.add(`${sid}:${u.id}`);
      cambio = true;
    }
  }
  if (cambio) {
    guardar(CLAVE_ARCHIVADOS, JSON.stringify([...archivados]));
    alCambiar?.();
  }
}

export function limpiarArchivadosSubs(alCambiar?: () => void) {
  archivados.clear();
  guardar(CLAVE_ARCHIVADOS, "[]");
  alCambiar?.();
}

/** Sin eventos nuevos por tanto y sin herramienta en vuelo, un subagente que "corre" en realidad se paró. */
export const OBSOLETO_S = 15 * 60;

export const activo = (u: Subagente, ahora = Math.floor(Date.now() * 0.001)) =>
  u.estado === "corriendo" && (u.en_vuelo === true || ahora - u.ultimo_en < OBSOLETO_S);

export const pintaSub = (u: Subagente, vivo: boolean) =>
  vivo
    ? ({ tipo: "trab", clave: "sub.corriendo" } as const)
    : u.estado === "error"
      ? ({ tipo: "frenado", clave: "sub.error" } as const)
      : u.estado === "corriendo" || u.estado === "parado"
        ? ({ tipo: "frenado", clave: "sub.parado" } as const)
        : ({ tipo: "term", clave: "sub.terminado" } as const);

export const corriendo = (lista: readonly Subagente[], ahora?: number) => lista.filter((u) => activo(u, ahora));
