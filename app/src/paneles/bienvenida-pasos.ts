// La lógica pura de la bienvenida (src/paneles/Bienvenida.tsx): qué pasos hay, qué familias de modelos se pueden dejar de usar y cómo
// se arma la lista `excluir` de modelos.json sin pisar lo que la persona ya tenía. Sin React ni imports de la app: la prueba el test.
import { validarRed } from "../../electron/valida-ajustes";
import type { ResultadoDeteccion } from "../../electron/locales-deteccion";

export const PASOS = ["idioma", "proveedores", "automatico", "excluir", "max", "compactacion", "celular"] as const;
export type Paso = (typeof PASOS)[number];

/** Los pasos que se muestran: el del celular sólo existe donde se puede editar (no por la tailnet; en modo local sí, con Tailscale). */
export const pasosVisibles = (celularEditable: boolean): Paso[] => PASOS.filter((p) => p !== "celular" || celularEditable);

/** Las familias que `reparto` sabe sacar (`excluir` de modelos.json: una familia saca a todo id que la contenga). `sugerida`: viene marcada de fábrica. */
export const FAMILIAS = [
  { id: "fable", nombre: "Fable", empresa: "anthropic", sugerida: true },
  { id: "opus", nombre: "Opus", empresa: "anthropic", sugerida: false },
  { id: "sonnet", nombre: "Sonnet", empresa: "anthropic", sugerida: false },
  { id: "haiku", nombre: "Haiku", empresa: "anthropic", sugerida: false },
  { id: "argon", nombre: "Gemini Argon", empresa: "google", sugerida: false },
  { id: "flash", nombre: "Gemini Flash", empresa: "google", sugerida: false },
] as const;
export type Familia = (typeof FAMILIAS)[number]["id"];
const IDS = new Set<string>(FAMILIAS.map((f) => f.id));

/**
 * Qué familias salen marcadas: las que ya dice el archivo; si no tiene `excluir` (nunca se tocó), la sugerida (Fable).
 * Una lista vacía es una decisión ("no excluyo nada") y se respeta.
 */
export function familiasMarcadas(excluir: readonly string[] | undefined): Set<Familia> {
  if (excluir === undefined) return new Set(FAMILIAS.filter((f) => f.sugerida).map((f) => f.id));
  return new Set(FAMILIAS.filter((f) => excluir.includes(f.id)).map((f) => f.id));
}

/** La lista nueva: lo que el archivo ya excluía y no es una de estas familias (un `agy:*`, un id exacto) se queda, más las marcadas. */
export function excluirCon(excluir: readonly string[] | undefined, marcadas: ReadonlySet<Familia>): string[] {
  const ajenas = (excluir ?? []).filter((e) => !IDS.has(e));
  return [...ajenas, ...FAMILIAS.filter((f) => marcadas.has(f.id)).map((f) => f.id)];
}

/** ¿Son las mismas familias marcadas? */
export function mismasFamilias(a: ReadonlySet<Familia>, b: ReadonlySet<Familia>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** Lo que se sugiere para la red de seguridad (`autoCompactWindow`): 200 k tokens. */
export const COMPACTACION_SUGERIDA = 200_000;

/** El campo de compactación: lo guardado, o la sugerencia si no hay nada. */
export const textoCompactacion = (guardado: number | null): string => String(guardado ?? COMPACTACION_SUGERIDA);

/** Lo que se guarda del campo: el número, o por qué no (clave de i18n, la misma que Ajustes). Vacío no vale acá: quitar la red es de Ajustes. */
export function compactacionDe(texto: string): { valor: number | null; error: string | null } {
  if (!texto.trim()) return { valor: null, error: "bv.compVacia" };
  return validarRed(texto);
}

/** El reparto automático está prendido salvo que el archivo diga `fijo` (sin archivo, de fábrica, prendido). */
export const automaticoPrendido = (reparto: string | undefined): boolean => reparto !== "fijo";

/** Qué se ve de los modelos locales: `andando` si algún servidor contesta, `apagado` si hay modelos y ninguno contesta, `instalado` si sólo hay un arnés (Ollama, OpenCode, dsh), `ninguno` si no hay nada y `sinDato` si no se pudo mirar. */
export type SituacionLocales = "andando" | "apagado" | "instalado" | "ninguno" | "sinDato";

export function estadoLocales(r: ResultadoDeteccion | null): { estado: SituacionLocales; andando: number; apagados: number; arneses: string[] } {
  if (!r) return { estado: "sinDato", andando: 0, apagados: 0, arneses: [] };
  const andando = r.modelos.filter((m) => m.estadoServidor === "prendido").length;
  const apagados = r.modelos.length - andando;
  const arneses = r.arneses.filter((a) => a.instalado).map((a) => a.nombre);
  const estado: SituacionLocales = andando > 0 ? "andando" : r.modelos.length > 0 ? "apagado" : arneses.length > 0 ? "instalado" : "ninguno";
  return { estado, andando, apagados, arneses };
}
