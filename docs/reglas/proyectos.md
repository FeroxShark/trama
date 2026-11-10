# Reglas: proyectos

Salieron de `AGENTS.md` (sección «Cómo se trabaja» y «Mapa rápido»): van enteras, sin resumir.

## «Borrar proyecto…»

- **«Borrar proyecto…» (menú del proyecto en el riel, `app/electron/proyectos-borrar.ts`, diálogo `src/barra/BorrarProyecto.tsx`, lógica pura `borrar-logica.ts`):** dos niveles. Por defecto *Quitar de Trama*: el registry (misma vía que `renombrarProyecto`: `escribir`, temporal + `.bak`)
marca `estado: "retirado"`, `retirado_el` (ISO) y, si tenía, `estado_antes`; un «quitado» es `retirado` **con** `retirado_el` (lo que `pa` retiró no lo tiene y conserva su carpeta). Su carpeta no sale del riel por el `estado` solo: `mapaQuitados` (`electron/reemplazos.ts`) lo manda a la general en
`armarArbol` (los chats no se pierden). Aparte, apagado: *También mandar la carpeta a la papelera* (`proyectos:papelera`, SOLO_PC_TAILNET; quitar/reactivar/vista valen desde el celular): escribir el nombre exacto, ruta y aviso de git
(`git status --porcelain` y `rev-list --branches --not --remotes`), sólo `gio trash` (Linux) o Papelera de Reciclaje por PowerShell/`Microsoft.VisualBasic` (Windows, `windowsHide`, ruta por entorno): nunca borrado definitivo; sin papelera no borra y el proyecto queda quitado. Guardas en el main: slug del
registry, `realpath`, no el home/raíz/sistema ni una carpeta que lo contenga, no una que contiene a otro proyecto, no un worktree de `pa`, y nada vivo (líderes con proceso en la carpeta o workers de `pa` vivos del slug: `contarVivos`). Deshacer = `reactivarProyecto` (también la fila «Reactivar» de Ajustes > Proyectos > Quitados de Trama).
Los tests (`tests/borrar-proyecto.test.ts`) usan un HOME y un registry temporales y inyectan `git`/`papelera` falsos por `Deps`: nunca la papelera real. Capturas: `borrar-proyecto` (`HILOS_VARIANTE=vivos|papelera`).

## Limpieza de ramas y worktrees

- **Limpieza de ramas y worktrees:** vive en `app/src/paneles/AjustesLimpieza.tsx` (`LimpiezaPa`) y se ve en dos lugares: Ajustes > Proyectos y el panel de Ramas (botón «Limpiar ramas y puestos viejos», captura `ramas-limpieza`). Un solo componente, nunca una copia; tirar siempre pasa por «Ver qué se borraría» y luego «Borrar lo de la lista». Lo controla `tests/ramas-limpieza-acceso.test.ts`. Los textos de Conectores llaman «conector» a lo que técnicamente es un servidor MCP (no «servidor propio»: suena a otra máquina).
