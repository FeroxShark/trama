// Los worktrees de los workers de `pa` (`<estado de pa>/worktrees/<proyecto>`, `<proyecto>@N` o `<proyecto>-N`): carpetas de trabajo de
// los workers, nunca proyectos. Linux: `~/.local/state/pa/worktrees/…`; Windows: `%LOCALAPPDATA%\Trama\state\pa\worktrees\…`.
// Puro (sin `electron` ni disco): lo usan el registry, las altas automáticas y "De Claude Code"; lo prueba tests/worktrees-pa.test.ts.

/** Una ruta (con `/` o `\`) que pasa por `pa/worktrees/`. */
export const WORKTREE_PA = /[\\/]pa[\\/]worktrees[\\/]/i;

const sinBarraFinal = (r: string) => r.replace(/[\\/]+$/, "");
const llana = (r: string) => sinBarraFinal(r).replace(/\\/g, "/").toLowerCase();

/** ¿La ruta es (o está dentro de) un worktree de `pa`? `carpetas`: además, las carpetas `worktrees` reales de esta máquina (por si el estado de `pa` está en otro lado). */
export function esWorktreePa(ruta: string, carpetas: readonly string[] = []): boolean {
  if (WORKTREE_PA.test(ruta) || /[\\/]pa[\\/]worktrees$/i.test(ruta)) return true;
  const r = llana(ruta);
  return carpetas.some((c) => {
    const b = llana(c);
    return !!b && (r === b || r.startsWith(`${b}/`));
  });
}

/** El proyecto de un worktree por su nombre: `…/worktrees/atlas@2/src` → `atlas`, `…\worktrees\atlas-3` → `atlas`. `null`: no es un worktree. */
export function proyectoDeWorktree(ruta: string): string | null {
  const m = /[\\/]pa[\\/]worktrees[\\/]([^\\/]+)/i.exec(ruta);
  if (!m) return null;
  const nombre = m[1]!.replace(/@\d+$/, "").replace(/-\d+$/, "").toLowerCase();
  return nombre || null;
}
