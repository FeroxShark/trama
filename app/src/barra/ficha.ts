// Lo que dice una fila de worker además del título: con qué modelo corre
// (el nombre corto de la familia) y dónde (el ícono de la máquina), con la ficha
// entera en el tooltip. Sin React: lo prueban los tests.
import type { Hilo } from "../datos/contrato.ts";
import { t } from "../i18n/index.ts";
import { esfuerzoDe } from "./esfuerzo.ts";

export type Familia = "opus" | "sonnet" | "fable" | "haiku" | "otro";

const FAMILIAS: Exclude<Familia, "otro">[] = ["opus", "sonnet", "fable", "haiku"];

/** "claude-sonnet-5-5[1m]" → "sonnet". Lo que no es de la casa (un local, etc.), "otro". */
export const familiaDe = (modelo: string | null | undefined): Familia =>
  FAMILIAS.find((f) => modelo?.toLowerCase().includes(f)) ?? "otro";

/** El nombre corto de cada familia: va en la fila tal cual (nada de letras sueltas que no se entienden). */
export const CORTO: Record<Exclude<Familia, "otro">, string> = { opus: "Opus", sonnet: "Sonnet", fable: "Fable", haiku: "Haiku" };

/**
 * Lo que dice el chip del modelo en la fila: la familia con su versión ("Opus 5.5", "Flash 3.8") o, si no
 * es de la casa, las dos primeras palabras del id ("deepseek-v4.1-flash-free" → "Deepseek V4.1"). `null`
 * sin modelo: no hay chip.
 */
export function modeloCorto(modelo: string | null | undefined): string | null {
  const id = modelo?.trim().toLowerCase().replace(/\[.*\]$/, "");
  if (!id) return null;
  const f = familiaDe(id);
  // Claude: la familia y su versión ("claude-opus-5-5" → "Opus 5.5"), así se distingue de otra generación.
  if (f !== "otro") {
    const v = id.match(new RegExp(`${f}-(\\d+)(?:[-.](\\d+))?`));
    return v ? `${CORTO[f]} ${v[1]}${v[2] ? `.${v[2]}` : ""}` : CORTO[f];
  }
  // Lo demás: sin el motor (agy:, opencode:, dsh:), el proveedor (opencode/), "-free" ni el esfuerzo pegado al final.
  const base = id.replace(/^[\w-]+:/, "").replace(/^.*\//, "").replace(/-free$/, "").replace(/-(?:minimal|low|medium|high|max)$/, "");
  const p = base.split(/[-_:\s]+/).filter(Boolean);
  const cap = (w: string) => (/^v?\d/.test(w) ? w.toUpperCase().replace(/^V/, "V") : w[0].toUpperCase() + w.slice(1));
  // Gemini: la variante y la versión ("gemini-3.8-flash" → "Flash 3.8"), que es lo que cambia entre uno y otro.
  if (p[0] === "gemini" && p.length > 2) return `${cap(p.slice(2).find((w) => !/^\d/.test(w)) ?? p[2])} ${p[1]}`;
  return p.slice(0, 2).map(cap).join(" ").slice(0, 18) || null;
}

/**
 * Dónde corre un worker. Hoy todo es "local" (esta máquina); "nube" queda
 * listo para cuando `pa` lance corridas remotas.
 */
export type Lugar = "local" | "nube";

export const lugarDe = (_h: Hilo): Lugar => "local";

/** El tooltip de la fila: proyecto, máquina, rama y modelo completo, un dato por renglón. */
export function ficha(h: Hilo, maquina: string | null): string {
  const lugar = lugarDe(h);
  const esf = esfuerzoDe(h.modelo, h.effort);
  const donde = lugar === "nube" ? t("ficha.nube") : maquina ? t("ficha.localEn", { maquina }) : t("ficha.local");
  return [
    t("ficha.proyecto", { v: h.proyecto }),
    t("ficha.maquina", { v: donde }),
    t("ficha.rama", { v: h.rama ?? t("comun.sinRama") }),
    t("ficha.modelo", { v: `${h.modelo || t("comun.sinDato")}${esf ? ` · ${esf.nivel}` : h.effort && h.effort !== "-" ? ` · ${h.effort}` : ""}` }),
    ...(esf ? [t("ficha.esfuerzo", { v: esf.nivel, n: esf.lleno, total: esf.niveles.length })] : []),
  ].join("\n");
}
