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

/** El agregado al prompt de sistema de un líder de Claude: lo del chat y, en Windows con PowerShell, la línea de la terminal. */
export const lineaSistemaLider = (plat: string, terminal: TerminalAgentes): string => [LINEA_CHAT, lineaTerminalAgentes(plat, terminal)].filter(Boolean).join(" ");
