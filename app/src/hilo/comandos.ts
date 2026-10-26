// Los comandos con "/" de la caja de un líder (B13). Los modos, /clear,
// /model y /effort los resuelve la app y no le llegan al líder; el resto
// (/compact, los slash commands y skills que dice la sesión) se le manda como
// prompt, tal cual. Puro (sin imports de valores): lo prueba tests/comandos.test.ts.
import type { ComandoClaude } from "../datos/contrato";
import type { Modo } from "./modos";

/** Lo que hace la app con lo que se escribió en la caja. */
export type Accion =
  /** Mandarlo al líder tal cual (texto normal, /compact, una skill…). */
  | { tipo: "texto" }
  /** Cambiar de modo; con `resto` ("/plan armá X") se manda eso después. */
  | { tipo: "modo"; modo: Modo; resto: string }
  /** /clear: un líder nuevo, limpio. */
  | { tipo: "limpiar" }
  | { tipo: "modelo"; modelo: string }
  | { tipo: "effort"; effort: string }
  /** /output-style: el nombre tal cual lo lista el CLI. */
  | { tipo: "estilo"; estilo: string }
  | {
      tipo: "error";
      clave:
        | "comando.usoModelo"
        | "comando.usoEffort"
        | "comando.usoEffortVacio"
        | "comando.sinEffort"
        | "comando.sinEffortOpencode"
        | "comando.usoEstilo"
        | "comando.cambioProveedor";
      v: string;
    };

export type ClaveComando =
  | "comando.plan"
  | "comando.default"
  | "comando.acceptEdits"
  | "comando.bypass"
  | "comando.clear"
  | "comando.model"
  | "comando.effort"
  | "comando.compact"
  | "comando.outputStyle";

/**
 * Una fila del menú: de la app (`clave` de i18n) o de Claude Code (`descripcion` tal cual).
 * Con `valor`, es un valor del segundo nivel ("/model " → opus, sonnet…); `actual`: el que está puesto.
 */
export type Sugerencia = {
  nombre: string;
  args: string | null;
  clave: ClaveComando | null;
  descripcion: string | null;
  valor?: string;
  actual?: boolean;
  /** Sólo existe de un lado: Claude Code (`anthropic`) o `agy` (`google`). Sin marca: está en los dos, o no se sabe. */
  solo?: Proveedor;
};

export type Proveedor = "anthropic" | "google";

/**
 * ¿De qué proveedor es sólo la fila? Se compara con el otro lado: sus propios (`PROPIOS` / `PROPIOS_AGY`) y los
 * comandos y skills que dijo (`deOtro`). Sin lista del otro lado (no hay `agy`, o `claude` nunca arrancó) no se
 * afirma nada: ninguna marca. `agy`: el menú es el de un líder de `agy`.
 */
export function marcaDe(nombre: string, agy: boolean, deOtro: ComandoClaude[]): Proveedor | undefined {
  if (!deOtro.length) return undefined;
  const n = nombre.toLowerCase();
  const otro = new Set([...(agy ? PROPIOS : PROPIOS_AGY).map((p) => p.nombre), ...deOtro.map((c) => c.nombre.toLowerCase())]);
  return otro.has(n) ? undefined : agy ? "google" : "anthropic";
}

/** Los valores de un comando con lista fija (`/model`, `/effort`, `/output-style`): cada uno con su etiqueta. */
export type Valores = Record<string, { lista: { valor: string; desc: string | null }[]; actual: string | null }>;

/** Los que siempre están, primero. /compact es de Claude Code (va como prompt) pero se ofrece siempre. */
export const PROPIOS: { nombre: string; args: string | null; clave: ClaveComando }[] = [
  { nombre: "plan", args: null, clave: "comando.plan" },
  { nombre: "default", args: null, clave: "comando.default" },
  { nombre: "accept-edits", args: null, clave: "comando.acceptEdits" },
  { nombre: "bypass", args: null, clave: "comando.bypass" },
  { nombre: "clear", args: null, clave: "comando.clear" },
  { nombre: "model", args: "<opus|sonnet|fable|haiku>", clave: "comando.model" },
  { nombre: "effort", args: "<low|medium|high|xhigh|max>", clave: "comando.effort" },
  { nombre: "compact", args: null, clave: "comando.compact" },
  { nombre: "output-style", args: "<style>", clave: "comando.outputStyle" },
];

/**
 * Los de un líder de `agy` (`gemini-*` o `agy:*`): sólo lo que funciona con `agy -p` (`/clear`, `/model` entre los de
 * `agy` y `/effort` los resuelve la app; `/compact` se le manda y compacta de verdad). Los demás de `agy` (`/context`,
 * `/diff`, `/config`…) abren una pantalla de la terminal y en `-p` no existen; `/usage` ya lo muestran los límites.
 */
export const PROPIOS_AGY: { nombre: string; args: string | null; clave: ClaveComando }[] = [
  { nombre: "clear", args: null, clave: "comando.clear" },
  { nombre: "model", args: "<gemini-4-argon|gemini-3.8-flash>", clave: "comando.model" },
  { nombre: "effort", args: "<low|medium|high>", clave: "comando.effort" },
  { nombre: "compact", args: null, clave: "comando.compact" },
];

/** ¿El modelo corre por `agy` (`gemini-*` o `agy:*`)? Ollama (`ollama:*`) y los de Claude o GPU local corren por `claude`. */
export const esModeloAgy = (modelo: string | null | undefined): boolean => /^(?:gemini-|agy:)/.test(modelo ?? "");

/** El motor de un modelo: `dsh:*` corre por DeepSeek Harness; no se cruza con los otros en la misma sesión (sí entre los suyos). */
const motorDe = (modelo: string | null | undefined): "claude" | "agy" | "dsh" | "opencode" => (/^opencode:/.test(modelo ?? "") ? "opencode" : /^dsh:/.test(modelo ?? "") ? "dsh" : esModeloAgy(modelo) ? "agy" : "claude");

/** Si el CLI todavía no dijo cuáles hay (ningún líder arrancó nunca): los de fábrica. */
export const ESTILOS_FABRICA = ["default", "Explanatory", "Learning"];

const MODO_DE: Record<string, Modo> = {
  plan: "plan",
  default: "default",
  "accept-edits": "acceptEdits",
  acceptedits: "acceptEdits",
  bypass: "bypassPermissions",
  "bypass-permissions": "bypassPermissions",
  bypasspermissions: "bypassPermissions",
};

/** Los de la app (con sus alias): no se repiten con los de Claude Code. */
const DE_APP = new Set([...Object.keys(MODO_DE), "clear", "model", "effort", "compact", "output-style"]);

/**
 * Qué hacer con el texto de la caja. `modelos`: los del selector (`id` y
 * `clave`, "opus"); `efforts`: los ids del selector de esfuerzo; `estilos`: los
 * output styles que lista el CLI.
 */
export function parsearComando(
  texto: string,
  modelos: { id: string; clave: string }[],
  efforts: readonly string[],
  estilos: string[] = ESTILOS_FABRICA,
  modeloActual?: string | boolean | null,
): Accion {
  const m = texto.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/);
  if (!m) return { tipo: "texto" };
  const agy = typeof modeloActual === "boolean" ? modeloActual : esModeloAgy(modeloActual);
  const motor = typeof modeloActual === "boolean" ? (modeloActual ? "agy" : "claude") : motorDe(modeloActual);
  const tieneProveedor = modeloActual !== undefined && modeloActual !== null;
  const nombre = m[1].toLowerCase();
  const arg = (m[2] ?? "").trim();
  const modo = MODO_DE[nombre];
  if (modo && !agy) return { tipo: "modo", modo, resto: arg };
  if (nombre === "clear") return { tipo: "limpiar" };
  if (nombre === "model") {
    const a = arg.toLowerCase();
    const x = a ? modelos.find((o) => o.clave === a || o.id === a) ?? modelos.find((o) => o.id.includes(a)) : undefined;
    if (x) {
      if (tieneProveedor && motorDe(x.id) !== motor)
        return { tipo: "error", clave: "comando.cambioProveedor", v: x.id };
      return { tipo: "modelo", modelo: x.id };
    }
    if (tieneProveedor && a && (motor === "agy" ? /^(?:claude-|opus$|sonnet$|haiku$|fable$|ollama:|dsh:|opencode:)/.test(a) : motor === "dsh" || motor === "opencode" ? /^(?:claude-|opus$|sonnet$|haiku$|fable$|ollama:|gemini-|agy:|dsh:|opencode:)/.test(a) : /^(?:dsh|opencode):/.test(a) || esModeloAgy(a)))
      return { tipo: "error", clave: "comando.cambioProveedor", v: arg };
    return { tipo: "error", clave: "comando.usoModelo", v: arg };
  }
  if (nombre === "effort") {
    const a = arg.toLowerCase();
    // Sin niveles (un modelo de OpenCode o de dsh que no los declara) no hay qué elegir: se dice, en vez de "esfuerzo desconocido".
    if (!efforts.length) return { tipo: "error", clave: motor === "opencode" ? "comando.sinEffortOpencode" : "comando.sinEffort", v: arg };
    if (!a) return { tipo: "error", clave: "comando.usoEffortVacio", v: arg };
    return efforts.includes(a) ? { tipo: "effort", effort: a } : { tipo: "error", clave: "comando.usoEffort", v: arg };
  }
  if (nombre === "output-style" && !agy) {
    const x = estilos.find((e) => e === arg) ?? estilos.find((e) => e.toLowerCase() === arg.toLowerCase());
    return x ? { tipo: "estilo", estilo: x } : { tipo: "error", clave: "comando.usoEstilo", v: arg };
  }
  return { tipo: "texto" };
}

/**
 * El menú de "/": mientras lo escrito es "/" + un nombre sin espacios. Los de la
 * app primero, después los de Claude Code; dentro de cada tanda, los que empiezan
 * con lo escrito antes que los que sólo lo contienen. Con "/model " (un comando de
 * `valores` + espacio + una palabra a medias), el segundo nivel: sus valores, igual.
 */
export function sugerencias(
  texto: string,
  deClaude: ComandoClaude[],
  valores: Valores = {},
  modeloActual?: string | boolean | null,
  deOtro: ComandoClaude[] = [],
): Sugerencia[] {
  const agy = typeof modeloActual === "boolean" ? modeloActual : esModeloAgy(modeloActual);
  const motor = typeof modeloActual === "boolean" ? (modeloActual ? "agy" : "claude") : motorDe(modeloActual);
  const tieneProveedor = modeloActual !== undefined && modeloActual !== null;
  const v = texto.match(/^\/(\S+)\s+(\S*)$/);
  const cmd = v?.[1].toLowerCase();
  if (agy && cmd === "output-style") return [];
  const de = cmd ? valores[cmd] : undefined;
  if (v && de) {
    const q = v[2].toLowerCase();
    const lista = cmd === "model" && tieneProveedor ? de.lista.filter((x) => motorDe(x.valor) === motor) : de.lista;
    const filas: Sugerencia[] = lista.map((x) => ({
      nombre: cmd!,
      args: null,
      clave: null,
      descripcion: x.desc,
      valor: x.valor,
      actual: x.valor === de.actual,
    }));
    const n = (s: Sugerencia) => s.valor!.toLowerCase();
    return [...filas.filter((s) => n(s).startsWith(q)), ...filas.filter((s) => !n(s).startsWith(q) && n(s).includes(q))];
  }
  const m = texto.match(/^\/(\S*)$/);
  if (!m) return [];
  const q = m[1].toLowerCase();
  const base = agy ? PROPIOS_AGY : PROPIOS;
  // OpenCode y dsh no tienen los niveles de Claude: el /effort del menú sale con los del modelo puesto (`valores.effort`, que
  // arma Lider con la tabla) y, si no declara ninguno, no se ofrece.
  const nivelesPropios = (motor === "opencode" || motor === "dsh") && valores.effort ? valores.effort.lista.map((x) => x.valor) : null;
  const propios = nivelesPropios
    ? base.flatMap((p) => (p.nombre !== "effort" ? [p] : nivelesPropios.length ? [{ ...p, args: `<${nivelesPropios.join("|")}>` }] : []))
    : base;
  const todos: Sugerencia[] = [
    ...propios.map((p) => ({ nombre: p.nombre, args: p.args, clave: p.clave, descripcion: null, solo: marcaDe(p.nombre, agy, deOtro) })),
    ...deClaude
      .filter((c) => !DE_APP.has(c.nombre.toLowerCase()) && (c.agy === undefined || Boolean(c.agy) === agy))
      .map((c) => ({ nombre: c.nombre, args: c.args || null, clave: null, descripcion: c.descripcion, solo: marcaDe(c.nombre, agy, deOtro) })),
  ];
  const n = (s: Sugerencia) => s.nombre.toLowerCase();
  return [...todos.filter((s) => n(s).startsWith(q)), ...todos.filter((s) => !n(s).startsWith(q) && n(s).includes(q))];
}

/** Lo que el menú ofrece con el cursor donde está, y el tramo de la caja [ini, fin) que la fila elegida reemplaza. */
export type Menu = { filas: Sugerencia[]; ini: number; fin: number };

/**
 * El menú para el cursor en `caret`. Con el token "/xxx" donde está el cursor (al inicio de la caja o
 * tras espacio o salto de línea; nunca en medio de una palabra: a/b, una URL, una ruta), filtra con lo
 * escrito después de la barra y reemplaza sólo ese token. Al inicio, "/comando valor" ofrece sus valores
 * y reemplaza desde el inicio hasta el valor. Lo que sigue al tramo no se toca.
 */
export function menuEn(
  texto: string,
  caret: number,
  deClaude: ComandoClaude[],
  valores: Valores = {},
  modeloActual?: string | boolean | null,
  deOtro: ComandoClaude[] = [],
): Menu | null {
  const agy = typeof modeloActual === "boolean" ? modeloActual : esModeloAgy(modeloActual);
  const antes = texto.slice(0, caret);
  const v = antes.match(/^\/(\S+)\s+(\S*)$/);
  const cmd = v?.[1].toLowerCase();
  if (v && cmd && !(agy && cmd === "output-style") && valores[cmd]) {
    return {
      filas: sugerencias(antes, deClaude, valores, modeloActual, deOtro),
      ini: 0,
      fin: caret + (texto.slice(caret).match(/^\S*/)?.[0].length ?? 0),
    };
  }
  const m = antes.match(/(?:^|\s)(\/[^\s/]*)$/);
  if (!m) return null;
  return {
    filas: sugerencias(m[1], deClaude, valores, modeloActual, deOtro),
    ini: caret - m[1].length,
    fin: caret + (texto.slice(caret).match(/^[^\s/]*/)?.[0].length ?? 0),
  };
}

/** Lo que queda en la caja al elegir una fila: con argumentos, "/model " (abre sus valores); un valor, "/model opus". */
export const completar = (s: Sugerencia) => (s.valor !== undefined ? `/${s.nombre} ${s.valor}` : `/${s.nombre}${s.args ? " " : ""}`);

/**
 * La caja con la fila elegida puesta en lugar de su tramo, y dónde queda el cursor. Si lo que sigue ya
 * empieza con un espacio, el que trae `completar` no se duplica.
 */
export function reemplazar(texto: string, m: Menu, s: Sugerencia): { texto: string; caret: number } {
  const ins = completar(s);
  const fin = m.fin + (ins.endsWith(" ") && /^[ \t]/.test(texto.slice(m.fin)) ? 1 : 0);
  return { texto: texto.slice(0, m.ini) + ins + texto.slice(fin), caret: m.ini + ins.length };
}

/** Si elegir la fila ya la ejecuta (un valor, o un comando sin argumentos que completar). */
export const directo = (s: Sugerencia) => s.valor !== undefined || !s.args;

/**
 * La fila elegida tras una tecla del menú: flechas con vuelta (de la última a la
 * primera y al revés), Home y End a las puntas. `null`: la tecla no mueve nada.
 */
export function moverSel(sel: number, n: number, tecla: string): number | null {
  if (n <= 0) return null;
  if (tecla === "ArrowDown") return (sel + 1) % n;
  if (tecla === "ArrowUp") return (sel - 1 + n) % n;
  if (tecla === "Home") return 0;
  if (tecla === "End") return n - 1;
  return null;
}
