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
