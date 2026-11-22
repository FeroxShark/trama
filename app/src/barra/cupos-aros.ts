// La preferencia de los aros del costado (Ajustes > Plan y cupos): «automático» (los dos límites más apretados de todas las suscripciones) o
// de 1 a 3 límites fijados a mano. Se guarda en `localStorage` de la ventana (es de la interfaz, no de `pa`): la barra y Ajustes se avisan con un
// evento. Lo puro (`normalizarAros`) lo prueba `tests/riel.test.ts`.
import { useEffect, useState } from "react";
import type { Uso } from "../datos/contrato";
import { filasDeCupos } from "../datos/cuentas.ts";
import { t } from "../i18n/index.ts";
import { AROS_MAX, cuentasClaude, limitesRiel, type LimiteRiel, type PrefAros } from "./cupos-riel-logica.ts";

export const CLAVE_AROS = "trama:cupos:aros";
export const EVENTO_AROS = "trama:cupos:aros-cambio";

/** Lo que dice el disco, o lo que se quiere guardar, como preferencia válida: lo raro es «automático»; sin repetidos y a lo sumo `AROS_MAX`. */
export function normalizarAros(crudo: unknown): PrefAros {
  if (!Array.isArray(crudo)) return "auto";
  const claves = [...new Set(crudo.filter((k): k is string => typeof k === "string" && k !== ""))].slice(0, AROS_MAX);
  return claves.length ? claves : "auto";
}

export function leerAros(): PrefAros {
  if (typeof localStorage === "undefined") return "auto";
  try {
    const crudo = localStorage.getItem(CLAVE_AROS);
    return crudo === null ? "auto" : normalizarAros(JSON.parse(crudo));
  } catch {
    return "auto";
  }
}

export function guardarAros(pref: PrefAros): void {
  const p = normalizarAros(pref === "auto" ? null : pref);
  try {
    if (typeof localStorage !== "undefined") {
      if (p === "auto") localStorage.removeItem(CLAVE_AROS);
      else localStorage.setItem(CLAVE_AROS, JSON.stringify(p));
    }
  } catch {}
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENTO_AROS));
}

/** La preferencia al día: se relee cuando otro lugar la cambia (Ajustes mientras la barra está a la vista). */
export function useAros(): PrefAros {
  const [pref, setPref] = useState<PrefAros>(leerAros);
  useEffect(() => {
    const alCambiar = () => setPref(leerAros());
    window.addEventListener(EVENTO_AROS, alCambiar);
    window.addEventListener("storage", alCambiar);
    return () => {
      window.removeEventListener(EVENTO_AROS, alCambiar);
      window.removeEventListener("storage", alCambiar);
    };
  }, []);
  return pref;
}

/** Todos los límites que existen hoy con el uso que dice `reparto` (lo que Ajustes ofrece para fijar); sin uso, ninguno. */
export function limitesDeUso(uso: Uso | null | undefined): LimiteRiel[] {
  if (!uso || "error" in uso) return [];
  const cupos = filasDeCupos(uso.suscripciones, uso.claudeNombre, t("cuentas.principal"));
  const cuentas = cuentasClaude(uso, cupos.filas, cupos.claudeCorto ?? uso.claudeNombre ?? t("uso.claude"), null);
  return limitesRiel(uso, cuentas, cupos.filas);
}
