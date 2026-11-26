// La terminal con la que corren los comandos de los agentes (líderes y workers) en Windows: PowerShell por defecto, o Git Bash si
// el dueño lo cambió en Ajustes > General. Acá sólo lo que depende de eso: las variables del entorno de `claude` y la línea que el
// líder recibe en el prompt de sistema. Fuera de Windows no cambia nada. Sin efectos al importar: lo prueba tests/terminal-agentes.test.ts.

/** `powershell` (default): Claude Code usa su herramienta PowerShell. `gitbash`: la de siempre, con bash. */
export type TerminalAgentes = "powershell" | "gitbash";
export const TERMINAL_AGENTES_DEFAULT: TerminalAgentes = "powershell";
export const esTerminalAgentes = (x: unknown): x is TerminalAgentes => x === "powershell" || x === "gitbash";

/** La línea que Trama le pasa al líder en su prompt de sistema cuando corre con PowerShell en Windows. */
export const LINEA_POWERSHELL = "En Windows usá PowerShell para los comandos, no bash";

/** Las variables que se suman al entorno de `claude` (líder o worker): sólo en Windows y con PowerShell. */
export function envTerminalAgentes(plat: string, terminal: TerminalAgentes): Record<string, string> {
  return plat === "win32" && terminal === "powershell" ? { CLAUDE_CODE_USE_POWERSHELL_TOOL: "1" } : {};
}

/** La línea del prompt de sistema del líder, o `null` cuando no corresponde (Linux, o Git Bash). */
export const lineaTerminalAgentes = (plat: string, terminal: TerminalAgentes): string | null =>
  plat === "win32" && terminal === "powershell" ? LINEA_POWERSHELL : null;

/**
 * Lo que todo líder de Claude sabe del chat de Trama: dónde aparece una imagen. Un `![](ruta)` se dibuja ahí mismo, grande; una ruta de imagen
 * sólo entre comillas invertidas sale como tarjeta al pie del mensaje (src/hilo/TarjetaRuta.tsx), lejos de lo que la nombra. Y qué rutas se pueden
 * tocar (src/hilo/rutas-mencionadas.ts: absolutas, sin `:línea`; Claude Code por defecto escribe `ruta:línea`). Una sola línea, sin
 * saltos: en Windows puede pasar por cmd.exe (`claude.cmd`).
 */
export const LINEA_CHAT =
  "Tu respuesta se ve en el chat de Trama, que muestra Markdown. Para mostrar una imagen de esta máquina escribí `![descripción](ruta absoluta completa, sin ~)` en su propia línea, justo donde va en el texto: Trama la dibuja ahí, grande. Una ruta de imagen sólo entre comillas invertidas sale como tarjeta al final del mensaje. Para que una ruta de archivo o carpeta se pueda tocar, escribila absoluta (empieza con / o ~/) entre comillas invertidas y sin `:línea` al final (la línea va en el texto: «en la línea 472»); una ruta relativa o con `:número` queda como texto.";

/** Cómo se escribe una ruta absoluta que se pueda tocar. Windows: con unidad (`C:\\...`) o `~\\`; es lo que reconoce `rutas-mencionadas.ts` ahí. */
const ABSOLUTA_POSIX = "(empieza con / o ~/)";
const ABSOLUTA_WINDOWS = "(empieza con la unidad, como `C:\\Users\\...`, o con ~\\)";

/** `LINEA_CHAT` para la plataforma: igual en Linux; en Windows la ruta tocable empieza con la unidad, no con `/`. */
export const lineaChat = (plat: string): string => (plat === "win32" ? LINEA_CHAT.replace(ABSOLUTA_POSIX, ABSOLUTA_WINDOWS) : LINEA_CHAT);

/**
 * Cómo gastar menos cupo, para todo líder de Claude. Sale de medir el uso real (2026-11-26): la mayor parte se va en reescribir caché
 * (subagentes retomados con la caché vencida, chats retomados después de 1 h) y en releer contexto (CLAUDE.md enormes, lecturas de más).
 * Texto fijo, sin datos que cambien: si cambiara, rompería la caché del prompt de sistema. Una sola línea, como `LINEA_CHAT`.
 */
export const LINEA_CACHE =
  "Cupo y caché: cada llamada relee todo el contexto; lo que está en caché cuesta ~1/10 y lo que se escribe o reescribe ~2×. La caché de tu chat dura 1 h; la de un subagente, 5 min. Por eso: no retomes (SendMessage) un subagente parado más de 5 min, que se reescribe entero: lanzá uno nuevo con un brief corto; dale a cada subagente una tarea cerrada que termine de una vez. Leé lo justo: Grep antes que Read, offset/limit en archivos grandes, no releas lo que ya tenés; una imagen ábrela sólo si hace falta verla y después describila en texto en vez de reabrirla. Effort alto y asesor sólo para lo difícil. Si el proyecto te hace perder pasos (CLAUDE.md de más de ~15 KB, muchas búsquedas antes de poder actuar, el mismo archivo releído, archivos gigantes), terminá lo pedido y seguí la guía RUTA_GUIA.";
const GUIA_POSIX = "`~/.claude/skills/trama-orquestar/ordenar-proyecto.md`";
const GUIA_WINDOWS = "`~\\.claude\\skills\\trama-orquestar\\ordenar-proyecto.md`"; // sin `%`: en Windows la línea puede pasar por cmd.exe

/** `LINEA_CACHE` con la ruta de la guía de la plataforma (en Windows, `~\.claude\skills`). */
export const lineaCache = (plat: string): string => LINEA_CACHE.replace("RUTA_GUIA", plat === "win32" ? GUIA_WINDOWS : GUIA_POSIX);

/** Delegar: el líder no edita código de proyectos directo; lo hacen workers de `pa` en ramas disjuntas. Una sola línea (ver `LINEA_CHAT`). */
export const LINEA_DELEGAR =
  "Sos líder de Trama: aunque esta sesión esté abierta en la carpeta de un proyecto, delegá los cambios de código, pruebas o interfaz a workers de pa (con la herramienta MCP lanzar_worker o pa <proyecto> --async --tipo <tipo>) sobre archivos disjuntos e integrá sus ramas al terminar; reservá tus ediciones directas sólo para respuestas rápidas o ajustes triviales de 1 archivo.";

/** Avances en vivo: el líder cuenta cada hallazgo o worker lanzado apenas ocurre (la Fase 2 de la ventana; configurable). Una sola línea. */
export const LINEA_AVANCES =
  "Avances en vivo: en tareas de varios pasos o al lanzar workers, escribí 1 línea corta con cada hallazgo concreto o worker lanzado apenas ocurra, sin repetirlo al cierre.";

/** Modo orquestador: las tareas no triviales van por `encargar_orquestador`, no por workers directos. Una sola línea. */
export const LINEA_ORQUESTADOR =
  "Modo orquestador activo: para tareas no triviales de un proyecto, prepará un encargo acotado (objetivo, restricciones textuales y verificación) y delegalo con encargar_orquestador en vez de abrir workers directo; si vuelve en estado consulta con observaciones u opciones, trasladáselo a la persona y retomá el mismo id con su decisión.";

/**
 * El recordatorio de las reglas de Trama que se re-inyecta tras `/compact` (Gemini, ChatGPT): delegar con `pa`, formato del chat y,
 * si corresponden, avances y modo orquestador. Un bloque de una sola línea, sin `%` (en Windows puede pasar por cmd.exe).
 */
export const recordatorioLiderPostCompact = (plat: string, opts?: { avances?: boolean; orquestador?: boolean }): string =>
  [
    "Recordatorio de Trama (seguí valiendo tras compactar):",
    LINEA_DELEGAR,
    lineaChat(plat),
    opts?.avances ? LINEA_AVANCES : null,
    opts?.orquestador ? LINEA_ORQUESTADOR : null,
  ]
    .filter(Boolean)
    .join(" ");

/**
 * El agregado al prompt de sistema de un líder de Claude: lo del chat, cómo ahorrar cupo y, en Windows con PowerShell, la línea de la terminal.
 * Con `extra` (sólo en líderes que lo piden) suma delegar con `pa`, avances y/o modo orquestador. Sin `extra`, lo de siempre, idéntico.
 */
export const lineaSistemaLider = (plat: string, terminal: TerminalAgentes, extra?: { avances?: boolean; delegar?: boolean; orquestador?: boolean }): string => {
  if (extra === undefined) return [lineaChat(plat), lineaCache(plat), lineaTerminalAgentes(plat, terminal)].filter(Boolean).join(" ");
  return [
    lineaChat(plat),
    lineaCache(plat),
    extra.delegar ? LINEA_DELEGAR : null,
    extra.avances ? LINEA_AVANCES : null,
    extra.orquestador ? LINEA_ORQUESTADOR : null,
    lineaTerminalAgentes(plat, terminal),
  ]
    .filter(Boolean)
    .join(" ");
};
