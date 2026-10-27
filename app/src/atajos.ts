// Los atajos de teclado de la app, en un solo lugar: cada manejador de teclas (la barra, la caja del
// líder, la letra) pregunta acá si la tecla es suya con `es(id, e)`, y la lista que se ve dentro de la
// app (`?`, y Ajustes) sale de esta misma tabla. Un atajo nuevo se agrega acá y aparece solo en la lista.
import type { ClaveSola } from "./i18n";
import { atajoLetra } from "./tipografia";

type Tecla = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; code?: string };

export type GrupoAtajo = "global" | "barra" | "caja";

type Def = {
  grupo: GrupoAtajo;
  /** Cada alternativa es una combinación; cada combinación, las teclas que se aprietan juntas. */
  teclas: readonly (readonly string[])[];
  desc: ClaveSola;
  coincide: (e: Tecla) => boolean;
};

const ctrl = (e: Tecla) => (e.ctrlKey || e.metaKey) && !e.altKey;
const sola = (e: Tecla) => !e.ctrlKey && !e.metaKey && !e.altKey;
const ctrlLetra = (k: string) => (e: Tecla) => ctrl(e) && e.key.toLowerCase() === k;
const letra = (k: string) => (e: Tecla) => sola(e) && e.key === k;

export const ATAJOS = {
  buscar: { grupo: "global", teclas: [["Ctrl", "K"]], desc: "atajos.buscar", coincide: ctrlLetra("k") },
  nuevo: { grupo: "global", teclas: [["Ctrl", "N"]], desc: "atajos.nuevo", coincide: ctrlLetra("n") },
  salir: { grupo: "global", teclas: [["Ctrl", "Q"]], desc: "atajos.salir", coincide: ctrlLetra("q") },
  letraMas: { grupo: "global", teclas: [["Ctrl", "+"]], desc: "atajos.letraMas", coincide: (e) => atajoLetra(e) === 1 },
  letraMenos: { grupo: "global", teclas: [["Ctrl", "−"]], desc: "atajos.letraMenos", coincide: (e) => atajoLetra(e) === -1 },
  letraBase: { grupo: "global", teclas: [["Ctrl", "0"]], desc: "atajos.letraBase", coincide: (e) => atajoLetra(e) === 0 },
  atajos: { grupo: "global", teclas: [["?"]], desc: "atajos.lista", coincide: (e) => !e.ctrlKey && !e.metaKey && !e.altKey && e.key === "?" },
  atras: { grupo: "global", teclas: [["Esc"]], desc: "atajos.atras", coincide: (e) => e.key === "Escape" },
  siguiente: { grupo: "barra", teclas: [["J"], ["↓"]], desc: "atajos.siguiente", coincide: (e) => letra("j")(e) || (sola(e) && e.key === "ArrowDown") },
  anterior: { grupo: "barra", teclas: [["K"], ["↑"]], desc: "atajos.anterior", coincide: (e) => letra("k")(e) || (sola(e) && e.key === "ArrowUp") },
  abrir: { grupo: "barra", teclas: [["Enter"]], desc: "atajos.abrir", coincide: (e) => e.key === "Enter" },
  cerrar: { grupo: "barra", teclas: [["C"]], desc: "atajos.cerrarFila", coincide: letra("c") },
  vista: { grupo: "barra", teclas: [["W"]], desc: "atajos.vista", coincide: letra("w") },
  consumo: { grupo: "barra", teclas: [["T"]], desc: "atajos.consumo", coincide: letra("t") },
  enviar: { grupo: "caja", teclas: [["Enter"]], desc: "atajos.enviar", coincide: (e) => e.key === "Enter" && !e.shiftKey },
  renglon: { grupo: "caja", teclas: [["Shift", "Enter"]], desc: "atajos.renglon", coincide: (e) => e.key === "Enter" && e.shiftKey },
  modo: { grupo: "caja", teclas: [["Shift", "Tab"]], desc: "atajos.modo", coincide: (e) => e.key === "Tab" && e.shiftKey },
  comandos: { grupo: "caja", teclas: [["/"]], desc: "atajos.comandos", coincide: (e) => e.key === "/" },
  salirCaja: { grupo: "caja", teclas: [["Esc"]], desc: "atajos.salirCaja", coincide: (e) => e.key === "Escape" },
} as const satisfies Record<string, Def>;

export type IdAtajo = keyof typeof ATAJOS;

/** ¿Esta tecla es el atajo `id`? */
export const es = (id: IdAtajo, e: Tecla): boolean => (ATAJOS[id] as Def).coincide(e);

export const GRUPOS: readonly GrupoAtajo[] = ["global", "barra", "caja"];

/** La tabla ordenada por grupo, para pintar la lista. */
export function listaAtajos(): { grupo: GrupoAtajo; items: { id: IdAtajo; teclas: readonly (readonly string[])[]; desc: ClaveSola }[] }[] {
  const ids = Object.keys(ATAJOS) as IdAtajo[];
  return GRUPOS.map((grupo) => ({
    grupo,
    items: ids.filter((id) => ATAJOS[id].grupo === grupo).map((id) => ({ id, teclas: ATAJOS[id].teclas, desc: ATAJOS[id].desc })),
  }));
}
