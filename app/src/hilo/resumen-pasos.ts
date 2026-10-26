// La línea que resume el trabajo de un turno cerrado, como la de Claude Code en la web: "Corrió 5 comandos, leyó 3 archivos, editó 2,
// buscó 4 veces". Cuenta las llamadas por clase de herramienta y las pone en palabras (singular / plural, es / en). Las tareas de
// fondo (Bash con `run_in_background`, un Agent en segundo plano) van aparte: "terminó una tarea de fondo (1 cortada)". Puro: lo prueba
// `tests/resumen-pasos.test.ts`.
import { t } from "../i18n/index.ts";
import type { Uso } from "./herramientas.ts";

export type Conteo = {
  comandos: number;
  leidos: number;
  editados: number;
  busquedas: number;
  web: number;
  delegadas: number;
  otras: number;
  /** Tareas de fondo que ya devolvieron algo, y de ésas las que cortaron con error (paradas o fallidas). */
  fondoListas: number;
  fondoCortadas: number;
  /** Tareas de fondo que siguen sin resultado. */
  fondoVivas: number;
};

const LEER = new Set(["Read", "NotebookRead"]);
const EDITAR = new Set(["Edit", "MultiEdit", "NotebookEdit", "Write"]);
const BUSCAR = new Set(["Grep", "Glob", "ToolSearch"]);
const WEB = new Set(["WebSearch", "WebFetch"]);
const DELEGAR = new Set(["Task", "Agent"]);

/** ¿La llamada pidió correr en segundo plano? (`run_in_background` en el Bash o el Agent.) */
export const enFondo = (u: Uso): boolean => (u.nombre === "Bash" || DELEGAR.has(u.nombre)) && u.det?.entrada?.run_in_background === true;

export function contar(usos: Uso[]): Conteo {
  const c: Conteo = { comandos: 0, leidos: 0, editados: 0, busquedas: 0, web: 0, delegadas: 0, otras: 0, fondoListas: 0, fondoCortadas: 0, fondoVivas: 0 };
  for (const u of usos) {
    if (enFondo(u)) {
      const r = u.det?.resultado;
      if (!r) c.fondoVivas++;
      else {
        c.fondoListas++;
        if (r.error) c.fondoCortadas++;
      }
    } else if (u.nombre === "Bash") c.comandos++;
    else if (LEER.has(u.nombre)) c.leidos++;
    else if (EDITAR.has(u.nombre)) c.editados++;
    else if (BUSCAR.has(u.nombre)) c.busquedas++;
    else if (WEB.has(u.nombre)) c.web++;
    else if (DELEGAR.has(u.nombre)) c.delegadas++;
    else c.otras++;
  }
  return c;
}

/** El resumen en palabras, o "" si no hubo ninguna llamada. */
export function resumenPasos(usos: Uso[]): string {
  const c = contar(usos);
  const partes: string[] = [];
  if (c.comandos) partes.push(c.comandos === 1 ? t("resumen.comando1") : t("resumen.comandos", { n: c.comandos }));
  if (c.leidos) partes.push(c.leidos === 1 ? t("resumen.leyo1") : t("resumen.leyo", { n: c.leidos }));
  if (c.editados) partes.push(c.editados === 1 ? t("resumen.edito1") : t("resumen.edito", { n: c.editados }));
  if (c.busquedas) partes.push(c.busquedas === 1 ? t("resumen.busco1") : t("resumen.busco", { n: c.busquedas }));
  if (c.web) partes.push(c.web === 1 ? t("resumen.web1") : t("resumen.web", { n: c.web }));
  if (c.delegadas) partes.push(c.delegadas === 1 ? t("resumen.delego1") : t("resumen.delego", { n: c.delegadas }));
  if (c.otras) partes.push(c.otras === 1 ? t("resumen.otra1") : t("resumen.otras", { n: c.otras }));
  if (c.fondoListas) {
    const base = c.fondoListas === 1 ? t("resumen.fondo1") : t("resumen.fondo", { n: c.fondoListas });
    partes.push(c.fondoCortadas ? `${base} (${c.fondoCortadas === 1 ? t("resumen.cortada1") : t("resumen.cortadas", { n: c.fondoCortadas })})` : base);
  }
  if (c.fondoVivas) partes.push(c.fondoVivas === 1 ? t("resumen.lanzo1") : t("resumen.lanzo", { n: c.fondoVivas }));
  const s = partes.join(", ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
