// Los temas de color (Ajustes > General). Lo puro: qué ids hay, muestras de acento, contraste WCAG, derivación
// de tema personalizado ("Mío") y cuál se pinta de verdad. Los colores de fábrica están en src/temas-colores.css
// (un bloque `[data-tema]` por tema) y aplicarlos a <html> lo hace tipografia.ts.
// "sistema" no es un tema con colores propios: sigue el claro/oscuro del sistema operativo.

export const TEMAS = ["sistema", "grafito", "tinta", "carbon", "shell", "catppuccin", "tokyo", "gruvbox", "nord", "rosepine", "dracula", "claro", "contraste"] as const;
export type TemaFabrica = (typeof TEMAS)[number];
export const TEMA_MIO = "mio" as const;
export type Tema = TemaFabrica | typeof TEMA_MIO;
export const TEMA_DEF: Tema = "grafito";

/** Los ids que hubo antes (piel de vidrio): una preferencia guardada con uno de ellos pasa a grafito. */
export const TEMAS_VIEJOS: readonly string[] = ["oscuro", "bosque", "atardecer"];

/** El que se pinta (el que va en `data-tema`): "sistema" pasa a claro o grafito. */
export type TemaPintado = Exclude<Tema, "sistema">;

export type IdAcento = "niebla" | "celeste" | "agua" | "menta" | "ambar" | "coral" | "rosa" | "lavanda";
export type MuestraAcento = { id: IdAcento; hex: string };

/** Las 8 muestras fijas de acento (paleta de la maqueta E · Taller). */
export const ACENTOS: readonly MuestraAcento[] = [
  { id: "niebla", hex: "#d3d7de" },
  { id: "celeste", hex: "#8fb5f0" },
  { id: "agua", hex: "#7fd1c7" },
  { id: "menta", hex: "#9ad48a" },
  { id: "ambar", hex: "#f0c27a" },
  { id: "coral", hex: "#f0a08a" },
  { id: "rosa", hex: "#eaa0c8" },
  { id: "lavanda", hex: "#b9a3f0" },
] as const;

export type BaseTema = {
  fondo: string;
  superficie: string;
  texto: string;
  acento: string;
};

export const BASE_TEMA_DEF: BaseTema = {
  fondo: "#08080a",
  superficie: "#17171a",
  texto: "#f5f5f6",
  acento: "#8fb5f0",
};

export const esTemaFabrica = (x: unknown): x is TemaFabrica => typeof x === "string" && (TEMAS as readonly string[]).includes(x);

export const esTema = (x: unknown): x is Tema => esTemaFabrica(x) || x === TEMA_MIO;

export const resolverTema = (t: Tema, sistemaClaro: boolean): TemaPintado => (t === "sistema" ? (sistemaClaro ? "claro" : "grafito") : t);

/** Dónde se espeja lo elegido para el script de index.html (el primer pintado, antes de que cargue nada). */
export const CLAVE_TEMA = "trama.tema";
export const CLAVE_ACENTO = "trama.acento";
export const CLAVE_TEMA_MIO = "trama.temaMio";

const RE_HEX = /^#[0-9a-f]{6}$/i;

export const esHexColor = (x: unknown): x is string => typeof x === "string" && RE_HEX.test(x.trim());

export function normalizarHex(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const s = x.trim().toLowerCase();
  return RE_HEX.test(s) ? s : null;
}

export function validarBaseTema(x: unknown): BaseTema | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const fondo = normalizarHex(o.fondo);
  const superficie = normalizarHex(o.superficie);
  const texto = normalizarHex(o.texto);
  const acento = normalizarHex(o.acento);
  if (!fondo || !superficie || !texto || !acento) return null;
  return { fondo, superficie, texto, acento };
}

export function leerTemaMioJson(raw: string | null | undefined): BaseTema | null {
  if (!raw) return null;
  try {
    return validarBaseTema(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function rgbDeHex(hex: string): [number, number, number] {
  const h = hex.startsWith("#") ? hex.slice(1) : hex;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const canalLineal = (c: number) => {
  const u = c / 255;
  return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4;
};

/** Luminancia relativa WCAG 2.1 (0 = negro, 1 = blanco). */
export function luminanciaRelativa(hex: string): number {
  const [r, g, b] = rgbDeHex(hex).map(canalLineal);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Relación de contraste WCAG 2.1 (1 a 21). */
export function contraste(a: string, b: string): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const mayor = Math.max(la, lb);
  const menor = Math.min(la, lb);
  return (mayor + 0.05) / (menor + 0.05);
}

/**
 * Elige texto oscuro o claro sobre un color de acento, garantizando contraste ≥ 4,5:1.
 * Prefiere la tinta oscura del diseño (`#08080a`) o blanco (`#ffffff`), y cae a negro puro
 * sólo en la banda intermedia estrecha donde `#08080a` y `#ffffff` quedan apenas debajo de 4,5.
 */
export function textoSobreAcento(acentoHex: string): string {
  const oscuro = "#08080a";
  const claro = "#ffffff";
  const cOsc = contraste(acentoHex, oscuro);
  const cCla = contraste(acentoHex, claro);
  if (cOsc >= cCla) return cOsc >= 4.5 ? oscuro : "#000000";
  return cCla >= 4.5 ? claro : "#000000";
}

/** Mezcla lineal en sRGB entre dos colores `#rrggbb`, con `pctB` de 0 a 100 hacia `b`. */
export function mezclarHex(a: string, b: string, pctB: number): string {
  const t = Math.max(0, Math.min(100, pctB)) / 100;
  const [ar, ag, ab] = rgbDeHex(a);
  const [br, bg, bb] = rgbDeHex(b);
  const comp = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${comp(ar, br)}${comp(ag, bg)}${comp(ab, bb)}`;
}

/** Variables CSS derivadas de un color de acento elegido por el usuario. */
export function derivarAcento(acentoHex: string): Record<string, string> {
  const acento = normalizarHex(acentoHex) ?? BASE_TEMA_DEF.acento;
  const [r, g, b] = rgbDeHex(acento);
  const sobre = textoSobreAcento(acento);
  const palido = sobre === "#ffffff" ? mezclarHex(acento, "#000000", 55) : mezclarHex(acento, "#ffffff", 75);
  return {
    "--acento": acento,
    "--acento-texto": sobre,
    "--acento-tinte": `rgb(${r} ${g} ${b} / 0.22)`,
    "--enlace-subrayado": `rgb(${r} ${g} ${b} / 0.35)`,
    "--sint-fn": acento,
    "--azul-palido": palido,
    "--paso-texto": palido,
  };
}

export const VARS_ACENTO: readonly string[] = Object.keys(derivarAcento(BASE_TEMA_DEF.acento));

const ESTADOS_OSCURO: Record<string, string> = {
  "--ok": "#55d0c8",
  "--aviso": "#e3b65a",
  "--critico": "#f07a7a",
  "--ok-tinte": "rgb(85 208 200 / 0.12)",
  "--aviso-tinte": "rgb(227 182 90 / 0.12)",
  "--critico-tinte": "rgb(240 122 122 / 0.12)",
  "--probar": "#b79cf0",
  "--carpeta": "#ee9c74",
  "--fam-opus": "#d98fb2",
  "--fam-sonnet": "#9cc58a",
  "--fam-haiku": "#cdb68a",
  "--verde-palido": "#ccf1ef",
  "--rojo-texto": "#f19393",
  "--rojo-claro": "#f2abac",
  "--rojo-palido": "#f3cacb",
  "--rojo-borde": "rgb(240 122 122 / 0.35)",
  "--rosa": "#d98fb2",
  "--modo-plan": "rgb(85 208 200 / 0.85)",
  "--sint-str": "#9cc58a",
  "--sint-num": "#cdb68a",
  "--sint-kw": "#b79cf0",
  "--sint-var": "#55d0c8",
  "--sint-menos": "#ee9c74",
  "--paso-pensar": "#b79cf0",
  "--fallo-sobre": "#2a0707",
  "--fallo-texto": "#ffaaa3",
  "--decision-sobre": "#2b1d02",
  "--decision-texto": "#f8d78a",
  "--sombra": "rgb(0 0 0 / 65%)",
  "--fondo-modal": "rgb(0 0 0 / 70%)",
  "--sombra-popover": "rgb(0 0 0 / 70%)",
  "--velo": "rgb(0 0 0 / 0.82)",
  "--resalte-1": "rgb(255 255 255 / 0.02)",
  "--resalte-2": "rgb(255 255 255 / 0.06)",
};

const ESTADOS_CLARO: Record<string, string> = {
  "--ok": "#006a8e",
  "--aviso": "#8a5c00",
  "--critico": "#a50e48",
  "--ok-tinte": "rgb(0 106 142 / 0.12)",
  "--aviso-tinte": "rgb(138 92 0 / 0.12)",
  "--critico-tinte": "rgb(165 14 72 / 0.12)",
  "--probar": "#6a3fc4",
  "--carpeta": "#a8501a",
  "--fam-opus": "#a02a74",
  "--fam-sonnet": "#2a6e1a",
  "--fam-haiku": "#7a5a1a",
  "--verde-palido": "#064a63",
  "--rojo-texto": "#a50e48",
  "--rojo-claro": "#8c0c3c",
  "--rojo-palido": "#6e0a2e",
  "--rojo-borde": "rgb(165 14 72 / 0.4)",
  "--rosa": "#a02a74",
  "--modo-plan": "rgb(0 106 142 / 0.9)",
  "--sint-str": "#2a6e1a",
  "--sint-num": "#8f4f00",
  "--sint-kw": "#6a3fc4",
  "--sint-var": "#00706a",
  "--sint-menos": "#a8402a",
  "--paso-pensar": "#6a3fc4",
  "--fallo-sobre": "#ffffff",
  "--fallo-texto": "#8c0c3c",
  "--decision-sobre": "#ffffff",
  "--decision-texto": "#6b4600",
  "--sombra": "rgb(30 40 70 / 22%)",
  "--fondo-modal": "rgb(20 25 40 / 40%)",
  "--sombra-popover": "rgb(30 40 70 / 28%)",
  "--velo": "rgb(240 242 247 / 0.86)",
  "--resalte-1": "rgb(14 20 35 / 0.03)",
  "--resalte-2": "rgb(14 20 35 / 0.06)",
};

/**
 * Deriva todos los tokens de un tema completo a partir de sus 4 colores base (fondo, superficie, texto, acento).
 * Bordes, superficies intermedias y textos atenuados mezclan superficie y texto, igual que en la maqueta;
 * los estados (ok, aviso, crítico) quedan fijos para claro u oscuro sin tomar el acento.
 */
export function derivarTema(base: BaseTema): { colorScheme: "dark" | "light"; vars: Record<string, string> } {
  const fondo = normalizarHex(base.fondo) ?? BASE_TEMA_DEF.fondo;
  const sup = normalizarHex(base.superficie) ?? BASE_TEMA_DEF.superficie;
  const texto = normalizarHex(base.texto) ?? BASE_TEMA_DEF.texto;
  const esClaro = luminanciaRelativa(sup) > 0.35;
  const mix = (p: number) => mezclarHex(sup, texto, p);

  const sup1 = mix(5);
  const sup2 = mix(9);
  const sup3 = mix(12);
  const sup4 = mix(15);
  const borde1 = mix(8);
  const borde2 = mix(11);
  const borde3 = mix(14);
  const borde4 = mix(19);
  const borde5 = mix(24);
  const borde6 = mix(40);
  const apagado = mix(85);
  const inactivo = mix(65);

  const vars: Record<string, string> = {
    "--fondo": fondo,
    "--fondo-ventana": fondo,
    "--vidrio": sup,
    "--vidrio-a": sup,
    "--vidrio-opaco": sup,
    "--luz": sup4,
    "--luz-arriba": sup4,
    "--texto": texto,
    "--apagado": apagado,
    "--inactivo": inactivo,
    "--capa-card": sup1,
    "--capa-div": borde1,
    "--capa-tile": sup2,
    "--capa-hover": mezclarHex(fondo, sup, 65),
    "--capa-track": borde5,
    "--capa-input": sup1,
    "--txt-1": texto,
    "--txt-2": apagado,
    "--txt-3": mix(73),
    "--txt-4": inactivo,
    "--negro": esClaro ? "#ffffff" : fondo,
    "--blanco": esClaro ? "#000000" : "#ffffff",
    "--sup-0": sup,
    "--sup-1": sup1,
    "--sup-2": sup2,
    "--sup-3": sup3,
    "--sup-4": sup4,
    "--borde-1": borde1,
    "--borde-2": borde2,
    "--borde-3": borde3,
    "--borde-4": borde4,
    "--borde-5": borde5,
    "--borde-6": borde6,
    "--texto-1": texto,
    "--texto-2": mix(93),
    "--texto-3": apagado,
    "--texto-4": mix(76),
    "--texto-5": inactivo,
    "--texto-6": inactivo,
    "--texto-7": inactivo,
    "--texto-8": borde5,
    "--sint-com": borde6,
    "--paso-correr": apagado,
    ...(esClaro ? ESTADOS_CLARO : ESTADOS_OSCURO),
    ...derivarAcento(base.acento),
  };

  return { colorScheme: esClaro ? "light" : "dark", vars };
}

export const VARS_TEMA_MIO: readonly string[] = Object.keys(derivarTema(BASE_TEMA_DEF).vars);
