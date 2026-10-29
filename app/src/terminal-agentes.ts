// La terminal de los agentes (Ajustes > General, sólo en Windows) en el renderer. El main la pone en la query: `plataforma=win32`
// cuando la ventana es de Windows (sólo entonces Ajustes muestra el ajuste) y `terminal=gitbash` cuando es Git Bash; sin nada,
// PowerShell. Igual que avisos-worker.ts: al cambiar se avisa a quien esté mirando.
import type { TerminalAgentes } from "../electron/terminal-agentes.ts";

const q = typeof location === "undefined" ? null : new URLSearchParams(location.search);

/** `true` sólo en la ventana de Windows: fuera de ahí Ajustes no muestra el ajuste. */
export const esWindowsTerminal = (): boolean => q?.get("plataforma") === "win32";

let terminal: TerminalAgentes = q?.get("terminal") === "gitbash" ? "gitbash" : "powershell";
const oyentes = new Set<() => void>();

export const terminalAgentes = (): TerminalAgentes => terminal;
export function cambiarTerminalAgentes(t: TerminalAgentes) {
  if (t === terminal) return;
  terminal = t;
  for (const f of oyentes) f();
}
export function alCambiarTerminalAgentes(f: () => void): () => void {
  oyentes.add(f);
  return () => void oyentes.delete(f);
}
