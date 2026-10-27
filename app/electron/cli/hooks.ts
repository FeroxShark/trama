// Registro de los hooks del motor en `~/.claude/settings.json`, con la variante a elegir: los bash (`.sh`, los que se usan hoy en
// Linux) o los de Node (`.mjs`, sin jq ni bash; los de Windows y, desde la etapa 11, los de todos). Port a TypeScript de
// `registrar_hooks` de motor/scripts/instalar-producto.sh (que usa jq): mismo resultado en el settings, sin pisar lo que haya.
//
//   - PreToolUse (matcher Bash): destructive-guard, una sola vez.
//   - statusLine: statusline-espejo envuelve al statusline de la persona (`<espejo> bash -c '<el de antes>'`) o, si no había,
//     va solo. Si ya lo envuelve, no se toca.
//
// Quién llama decide qué variante. Esta función NO cambia qué hooks se registran en Linux: `instalar-producto.sh` sigue con los .sh;
// el cambio a .mjs es la etapa 11 del port (motor/docs/port-windows-plan.md). Si ya hay un hook nuestro de la OTRA variante, se
// pasa a la pedida (es lo que hace falta para ese cambio); si es de la misma variante, no se toca aunque la ruta sea otra.
import { copyFileSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { escribirAtomicoSync } from "./base/archivo.ts";

export type VarianteHook = "sh" | "mjs";
export type NombreHook = "latido" | "destructive-guard" | "statusline-espejo" | "agy-pa";

/** Los hooks que `instalar-producto.sh` enlaza en `~/.claude/hooks`. */
export const HOOKS_DE_CLAUDE: readonly NombreHook[] = ["latido", "destructive-guard", "statusline-espejo"];
/** El adaptador del plugin de agy (`~/.gemini/config/plugins/pa-worker`). */
export const HOOK_DE_AGY: NombreHook = "agy-pa";

/** `destructive-guard.sh` / `destructive-guard.mjs`. */
export const archivoHook = (nombre: NombreHook, variante: VarianteHook): string => `${nombre}.${variante}`;
/** Archivos que los hooks cargan desde su propia carpeta (tienen que viajar con ellos). */
export const apoyoDeHooks = (variante: VarianteHook): string[] => (variante === "sh" ? ["docker-guard.py"] : ["docker-guard.mjs"]);

export type OpcionesComando = {
  /** El intérprete de la variante `.mjs` (default `node`; el instalador de Windows pasa el `node.exe` empaquetado). */
  node?: string;
  /** Con `win32` las rutas van con `/`: el shell con el que Claude Code corre los hooks las lee mejor. */
  plataforma?: NodeJS.Platform;
};

/** `@sh` de jq: siempre entre comillas simples. */
export const entreComillas = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

function rutaParaShell(ruta: string, plataforma: NodeJS.Platform): string {
  return plataforma === "win32" ? ruta.replace(/\\/g, "/") : ruta;
}

/** El comando que se escribe en el settings (o en el JSON de `--settings` de `pa`): `bash '<ruta>.sh'` o `node '<ruta>.mjs'`. */
export function comandoHook(nombre: NombreHook, variante: VarianteHook, carpeta: string, o: OpcionesComando = {}): string {
  const plataforma = o.plataforma ?? process.platform;
  const ruta = rutaParaShell(plataforma === "win32" ? path.win32.join(carpeta, archivoHook(nombre, variante)) : path.posix.join(carpeta, archivoHook(nombre, variante)), plataforma);
  const interprete = variante === "sh" ? "bash" : rutaParaShell(o.node ?? "node", plataforma);
  const cmd = variante === "sh" || !/[\s'"]/.test(interprete) ? interprete : entreComillas(interprete);
  return `${cmd} ${entreComillas(ruta)}`;
}

/** El `hooks.json` del plugin de agy para la variante pedida (el de `motor/agy/pa-worker/hooks.json` es el de `sh`). */
export function hooksJsonAgy(variante: VarianteHook): Record<string, unknown> {
  const cmd = (fase: string) => (variante === "sh" ? `bash ./agy-pa.sh ${fase}` : `node ./agy-pa.mjs ${fase}`);
  return {
    "pa-worker": {
      PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd("pre"), timeout: 30 }] }],
      PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: cmd("post"), timeout: 30 }] }],
      PostInvocation: [{ type: "command", command: cmd("inv"), timeout: 10 }],
    },
  };
}

type Json = Record<string, unknown>;
const esObjeto = (v: unknown): v is Json => v !== null && typeof v === "object" && !Array.isArray(v);
const marca = (nombre: NombreHook) => new RegExp(`${nombre}\\.(sh|mjs)`);
/** Dentro de un comando nuestro, la variante en la que está escrito. */
const varianteDe = (comando: string, nombre: NombreHook): VarianteHook | null => {
  const m = marca(nombre).exec(comando);
  return m ? (m[1] as VarianteHook) : null;
};

export type OpcionesRegistro = OpcionesComando & {
  /** La carpeta donde están los hooks (en Linux, `~/.claude/hooks`, que son enlaces a `motor/hooks`). */
  carpeta: string;
  variante: VarianteHook;
};

/** Los hooks de los grupos de un evento (con `?` de jq: lo que no tiene la forma esperada se ignora). */
function comandosDe(grupos: unknown): Json[] {
  if (!Array.isArray(grupos)) return [];
  return grupos.flatMap((g) => (esObjeto(g) && Array.isArray(g.hooks) ? g.hooks.filter(esObjeto) : []));
}

/**
 * Aplica el registro al objeto de settings (lo muta). Devuelve true si cambió algo. Tira si el settings tiene una forma que no se
 * puede tocar sin adivinar (el llamador avisa y no escribe nada).
 */
export function registrarEnAjustes(ajustes: Json, o: OpcionesRegistro): boolean {
  const guard = comandoHook("destructive-guard", o.variante, o.carpeta, o);
  const espejo = comandoHook("statusline-espejo", o.variante, o.carpeta, o);
  let cambio = false;

  // PreToolUse: el guard, una vez.
  if (ajustes.hooks !== undefined && ajustes.hooks !== null && !esObjeto(ajustes.hooks)) throw new Error("hooks no es un objeto");
  const hooks = (ajustes.hooks as Json | undefined) ?? undefined;
  const existentes = comandosDe(hooks?.PreToolUse).filter((h) => typeof h.command === "string" && marca("destructive-guard").test(h.command));
  if (existentes.length === 0) {
    const nuevoGrupo = { matcher: "Bash", hooks: [{ type: "command", command: guard }] };
    const todos = (ajustes.hooks && esObjeto(ajustes.hooks) ? ajustes.hooks : (ajustes.hooks = {})) as Json;
    if (todos.PreToolUse !== undefined && todos.PreToolUse !== null && !Array.isArray(todos.PreToolUse)) throw new Error("hooks.PreToolUse no es una lista");
    todos.PreToolUse = [...((todos.PreToolUse as unknown[] | null | undefined) ?? []), nuevoGrupo];
    cambio = true;
  } else {
    for (const h of existentes) {
      if (varianteDe(h.command as string, "destructive-guard") !== o.variante) {
        h.command = guard;
        cambio = true;
      }
    }
  }

  // statusLine: el espejo envuelve al que haya.
  const sl = ajustes.statusLine;
  if (sl !== undefined && sl !== null && !esObjeto(sl)) throw new Error("statusLine no es un objeto");
  const actual = esObjeto(sl) && typeof sl.command === "string" ? sl.command : "";
  if (marca("statusline-espejo").test(actual)) {
    if (esObjeto(sl) && varianteDe(actual, "statusline-espejo") !== o.variante) {
      // `bash '<ruta>.sh' bash -c '…'` -> `node '<ruta>.mjs' bash -c '…'`: sólo cambia el principio.
      const resto = actual.replace(/^\S+\s+(?:'(?:[^']|'\\'')*'|\S+)/, "");
      sl.command = espejo + resto;
      cambio = true;
    }
  } else if (esObjeto(sl) && (sl.type === undefined || sl.type === null || sl.type === false ? "command" : sl.type) === "command" && actual !== "") {
    sl.command = `${espejo} bash -c ${entreComillas(actual)}`;
    cambio = true;
  } else if (sl === undefined || sl === null) {
    ajustes.statusLine = { type: "command", command: espejo };
    cambio = true;
  }
  return cambio;
}

export type ResultadoRegistro =
  | { estado: "registrado"; destino: string; copia?: string }
  | { estado: "ya"; destino: string }
  | { estado: "invalido"; motivo: string };

const aaaammdd = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;

/**
 * Registra los hooks en un `settings.json` (lo crea si falta). Si es un enlace (dotfiles) escribe el archivo real. Antes de
 * cambiar uno que ya tenía algo deja una copia `<settings>.trama-bak-AAAAMMDD` (sin pisar una anterior). Si el archivo no es un
 * objeto JSON no lo toca. Conserva el modo del archivo (un settings con claves no queda legible por todos).
 */
export function registrarEnArchivo(settings: string, o: OpcionesRegistro, ahora: Date = new Date()): ResultadoRegistro {
  const existe = existsSync(settings);
  const real = existe ? realpathSync(settings) : settings;
  let ajustes: Json = {};
  if (existe) {
    const texto = readFileSync(real, "utf8").replace(/^﻿/, "");
    if (texto.trim() !== "") {
      try {
        const j: unknown = JSON.parse(texto);
        if (!esObjeto(j)) return { estado: "invalido", motivo: `${settings} no es un objeto JSON` };
        ajustes = j;
      } catch {
        return { estado: "invalido", motivo: `${settings} no es un JSON válido` };
      }
    }
  }
  const antes = JSON.stringify(ajustes);
  const vacio = antes === "{}";
  try {
    if (!registrarEnAjustes(ajustes, o) || JSON.stringify(ajustes) === antes) return { estado: "ya", destino: real };
  } catch (e) {
    return { estado: "invalido", motivo: `${settings}: ${(e as Error).message}` };
  }
  let copia: string | undefined;
  if (existe && !vacio) {
    copia = `${settings}.trama-bak-${aaaammdd(ahora)}`;
    try {
      copyFileSync(settings, copia, constants.COPYFILE_EXCL);
    } catch {
      /* ya había una de hoy: no se pisa */
    }
  }
  escribirAtomicoSync(real, `${JSON.stringify(ajustes, null, 2)}\n`, { modo: existe ? statSync(real).mode & 0o777 : 0o600 });
  return { estado: "registrado", destino: real, copia };
}
