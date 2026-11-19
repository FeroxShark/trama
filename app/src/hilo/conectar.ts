// A dónde lleva «Conectar» cuando se elige un modelo de un proveedor sin conectar: la fila de Ajustes donde se inicia sesión o se instala.
// Sin React: lo prueba tests/selector-conectar.test.ts. Los destinos son filas que existen en `ITEMS` de paneles/ajustes-nav.ts.
import type { Empresa } from "./modelos.ts";
import { abrirAjustes, type CatId } from "../paneles/ajustes-nav.ts";

export type Destino = { cat: CatId; opc: string };

/** Anthropic, Google y OpenAI se conectan en Plan y cupos (cada suscripción con su «Conectar»); lo demás, en su categoría. */
export const DESTINO_CONECTAR: Readonly<Record<Empresa, Destino>> = {
  anthropic: { cat: "cupos", opc: "cu.claude" },
  google: { cat: "cupos", opc: "cu.google" },
  openai: { cat: "cupos", opc: "cu.chatgpt" },
  opencode: { cat: "opencode", opc: "ajustes.ocPrograma" },
  dsh: { cat: "dsh", opc: "ajustes.dshPrograma" },
  local: { cat: "locales", opc: "ajustes.mdlLocales" },
  ollama: { cat: "locales", opc: "ajustes.mdlLocales" },
};

/** Abre Ajustes en la fila de ese proveedor. */
export const conectarEmpresa = (empresa: Empresa): void => {
  const d = DESTINO_CONECTAR[empresa];
  abrirAjustes(d.cat, d.opc);
};

/**
 * Qué hace tocar una opción del selector: un modelo de un proveedor sin conectar NO se elige (el menú ofrece «Conectar»); uno de otro motor
 * pide confirmar; el resto se elige. Lo usa `Selector.tsx` y lo prueba tests/selector-conectar.test.ts.
 */
export const alTocar = (o: { sinConectar?: boolean }, pideConfirmar: boolean): "conectar" | "confirmar" | "elegir" => (o.sinConectar ? "conectar" : pideConfirmar ? "confirmar" : "elegir");

/** Lo que una opción del selector lleva si su proveedor no está conectado: la marca y lo que hace «Conectar». Vacío si está conectado. */
export const marcaConexion = (m: { empresa: Empresa; sinConectar?: boolean }): { sinConectar?: true; conectar?: () => void } => (m.sinConectar ? { sinConectar: true, conectar: () => conectarEmpresa(m.empresa) } : {});
