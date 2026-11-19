// «Historial de chats» (ventana desde la barra): los chats que Trama lanzó y ya no están a la vista, archivados o cerrados, para abrirlos de
// nuevo o borrarlos del todo. De dónde sale:
//  · La lista es lo que Trama lanzó alguna vez (el transcript lleva su marca `trama-xxxx`, ver `claude-code.ts`) y hoy no tiene líder
//    (`lideres.json`). El transcript ya trae el título, el modelo y la carpeta.
//  · Archivado o cerrado no está en el transcript: lo anota `RegistroCierres` (`historial-chats.json`) cuando la barra cierra un chat.
//    Lo que se cerró antes de que existiera el registro figura «cerrado», con la fecha de su última actividad.
//  · Borrar manda a la papelera del sistema SÓLO el archivo de ese transcript (`<raíz>/<carpeta>/<sid>.jsonl`), nunca otra cosa, y saca el chat
//    del registro. La ruta sale del índice del main (jamás de la ventana) y pasa por las guardas de `borrarDelHistorial`.
// Sin Electron: lo que toca el disco o la papelera entra por `Deps`, así los tests no mandan nada real a ningún lado.
import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import type { VistaConv } from "./claude-code.ts";
import { claveRuta } from "./proyectos-auto.ts";
import { plataformaActual, type Plataforma } from "./rutas.ts";

/** Cómo salió el chat de la barra: «Archivar» (o limpiar) lo archiva; Cerrar, Borrar y Quitar lo cierran. */
export type ComoSalio = "archivado" | "cerrado";

/** Un chat del historial tal como lo ve la ventana. `ms`: su última actividad; `cuando`: cuándo salió de la barra (epoch ms). */
export type ChatHistorial = VistaConv & { como: ComoSalio; cuando: number };

const SID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** Lo más que recuerda el registro: pasado esto se olvidan los más viejos (el transcript sigue y el chat figura «cerrado»). */
export const REGISTRO_MAX = 2000;
const VERSION = 1;

/** El motivo con que la barra cerró el chat (`MOTIVOS` de lider.ts) → cómo figura. `null`: no es un chat que la persona sacó (analista, un traer que falló, la salida de Trama). */
export function comoDeMotivo(motivo: unknown): ComoSalio | null {
  switch (motivo) {
    case "archivar":
      return "archivado";
    case undefined:
    case "cerrar":
    case "borrar":
    case "quitar":
      return "cerrado";
    default:
      return null;
  }
}

// --- El registro de cierres ----------------------------------------------------------------------------------------------

export type Cierre = { como: ComoSalio; ts: number };
type Guardado = { version: number; chats: Record<string, Cierre> };

export type DepsRegistro = {
  leer: () => Promise<string | null>;
  guardar: (json: string) => Promise<void>;
  /** Epoch ms. */
  ahora: () => number;
  /** Cuántos recuerda como mucho (default `REGISTRO_MAX`). */
  max?: number;
};

const esCierre = (x: unknown): x is Cierre => {
  const o = x as Partial<Cierre> | null;
  return (o?.como === "archivado" || o?.como === "cerrado") && typeof o.ts === "number" && Number.isFinite(o.ts);
};

export function crearRegistroCierres(deps: DepsRegistro) {
  let chats: Map<string, Cierre> | null = null;
  // Escrituras de a una: dos cierres seguidos no se pisan.
  let cola: Promise<unknown> = Promise.resolve();

  async function cargar(): Promise<Map<string, Cierre>> {
    if (chats) return chats;
    const m = new Map<string, Cierre>();
    try {
      const g = JSON.parse((await deps.leer()) ?? "") as Guardado;
      if (g?.version === VERSION && g.chats && typeof g.chats === "object")
        for (const [sid, c] of Object.entries(g.chats)) if (SID.test(sid) && esCierre(c)) m.set(sid, { como: c.como, ts: c.ts });
    } catch {}
    return (chats ??= m);
  }

  const guardar = (m: Map<string, Cierre>) => {
    // Los más recientes primero: si se pasa del tope, se van los más viejos.
    const lista = [...m].sort((a, b) => b[1].ts - a[1].ts).slice(0, deps.max ?? REGISTRO_MAX);
    const json = JSON.stringify({ version: VERSION, chats: Object.fromEntries(lista) } satisfies Guardado);
    const hecho = cola.then(() => deps.guardar(json));
    cola = hecho.catch(() => {});
    return hecho;
  };

  return {
    leer: async (): Promise<ReadonlyMap<string, Cierre>> => new Map(await cargar()),
    /** La barra cerró el chat: queda anotado cómo y cuándo. Un motivo que no es de la persona no anota nada. */
    async anotar(sid: unknown, motivo: unknown): Promise<void> {
      const como = comoDeMotivo(motivo);
      if (!como || typeof sid !== "string" || !SID.test(sid)) return;
      const m = await cargar();
      m.set(sid, { como, ts: deps.ahora() });
      await guardar(m);
    },
    /** El chat volvió a la barra (se abrió desde el historial) o se borró: ya no es del historial. */
    async quitar(sid: string): Promise<void> {
      const m = await cargar();
      if (m.delete(sid)) await guardar(m);
    },
  };
}
export type RegistroCierres = ReturnType<typeof crearRegistroCierres>;

// --- La lista -----------------------------------------------------------------------------------------------------------

/**
 * Las conversaciones que lanzó Trama y hoy no tienen líder (`vistaConvs` con `de: "trama"`), con cómo y cuándo salieron: lo anotado por el
 * registro o, si no hay nada (salió antes de que existiera), «cerrado» con la fecha de su última actividad. Lo más reciente primero.
 */
export function armarHistorial(vistas: readonly VistaConv[], cierres: ReadonlyMap<string, Cierre>): ChatHistorial[] {
  return vistas
    .map((v) => {
      const c = cierres.get(v.sid);
      return { ...v, como: c?.como ?? ("cerrado" as ComoSalio), cuando: c?.ts ?? v.ms };
    })
    .sort((a, b) => b.cuando - a.cuando || a.sid.localeCompare(b.sid));
}

/** El transcript de un chat del historial: sólo si figura en la lista (`vistas`); uno de Claude Code que no es de Trama no se puede borrar por acá. */
export const rutaDeHistorial = (sid: string, vistas: readonly { sid: string }[], convs: readonly { sid: string; ruta?: string }[]): string | null =>
  vistas.some((v) => v.sid === sid) ? (convs.find((c) => c.sid === sid)?.ruta ?? null) : null;

// --- Borrar -------------------------------------------------------------------------------------------------------------

export type ResultadoPapelera = "ok" | "sin" | "fallo";
/** Por qué no se borró: el chat tiene un turno en curso, volvió a la barra, ya no está en el historial, no hay papelera o ésta falló. */
export type MotivoNoBorrado = "enCurso" | "abierto" | "noEsta" | "sinPapelera" | "fallo";
export type ResultadoBorrar = { ok: true } | { ok: false; motivo: MotivoNoBorrado };

export type DepsBorrar = {
  /** El archivo del transcript de este chat según el índice del main; `null`: no se lo conoce. */
  rutaDe: (sid: string) => Promise<string | null>;
  /** Los `projects` donde Claude guarda los transcripts (la raíz de cada cuenta). */
  raices: () => string[];
  /** `enCurso`: está respondiendo (o recibiendo un mensaje); `abierto`: tiene líder en la barra; `libre`: ninguna de las dos. */
  estado: (sid: string) => Promise<"libre" | "abierto" | "enCurso">;
  /** Manda ESE archivo a la papelera del sistema. */
  papelera: (ruta: string) => Promise<ResultadoPapelera>;
  /** Saca el chat del registro de cierres. */
  quitar: (sid: string) => Promise<void>;
  plat?: Plataforma;
};

/**
 * La ruta del transcript si es seguro tocarla, o `null`: un archivo común (no un enlace) llamado `<sid>.jsonl`, directo adentro de una carpeta
 * que cuelga de una raíz de transcripts (`<raíz>/<carpeta>/<sid>.jsonl`), mirado con `realpath` en las dos puntas (un enlace que saca de la
 * raíz, o una raíz que es un enlace, no engañan).
 */
export async function transcriptSeguro(ruta: string, sid: string, raices: readonly string[], plat: Plataforma = plataformaActual()): Promise<string | null> {
  if (!SID.test(sid) || !path.isAbsolute(ruta) || path.basename(ruta) !== `${sid}.jsonl`) return null;
  const s = await lstat(ruta).catch(() => null);
  if (!s || !s.isFile() || s.isSymbolicLink()) return null;
  const real = await realpath(ruta).catch(() => null);
  if (!real || path.basename(real) !== `${sid}.jsonl`) return null;
  const carpeta = claveRuta(path.dirname(path.dirname(real)), plat);
  for (const r of raices) {
    const raiz = await realpath(r).catch(() => null);
    if (raiz && claveRuta(raiz, plat) === carpeta) return real;
  }
  return null;
}

/** Borra del todo un chat del historial: sólo su transcript, a la papelera. Nada de lo que dice la ventana más que el `sid` cuenta. */
export async function borrarDelHistorial(sid: unknown, deps: DepsBorrar): Promise<ResultadoBorrar> {
  if (typeof sid !== "string" || !SID.test(sid)) return { ok: false, motivo: "noEsta" };
  const estado = await deps.estado(sid);
  if (estado !== "libre") return { ok: false, motivo: estado };
  const dado = await deps.rutaDe(sid);
  const ruta = dado ? await transcriptSeguro(dado, sid, deps.raices(), deps.plat) : null;
  if (!ruta) return { ok: false, motivo: "noEsta" };
  const r = await deps.papelera(ruta);
  if (r !== "ok") return { ok: false, motivo: r === "sin" ? "sinPapelera" : "fallo" };
  await deps.quitar(sid);
  return { ok: true };
}

/**
 * La papelera del sistema para UN archivo, nunca borrado definitivo. Linux: `gio trash`. Windows: la Papelera de Reciclaje por PowerShell
 * (`Microsoft.VisualBasic.FileIO`, `DeleteFile`), con la ruta por el entorno (sin armar comandos con texto de nadie). `sin`: no hay con qué.
 */
export const papeleraArchivoReal: DepsBorrar["papelera"] = (ruta) =>
  new Promise((resolve) => {
    const plat = plataformaActual();
    if (plat === "darwin") return resolve("sin");
    const [cmd, args, env] =
      plat === "win32"
        ? ([
            "powershell.exe",
            [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:TRAMA_PAPELERA, 'OnlyErrorDialogs', 'SendToRecycleBin')",
            ],
            { ...process.env, TRAMA_PAPELERA: ruta },
          ] as const)
        : (["gio", ["trash", "--", ruta], process.env] as const);
    execFile(cmd, [...args], { windowsHide: true, timeout: 60_000, env: env as NodeJS.ProcessEnv }, (e) => {
      if (!e) return resolve("ok");
      resolve((e as NodeJS.ErrnoException).code === "ENOENT" ? "sin" : "fallo");
    });
  });
