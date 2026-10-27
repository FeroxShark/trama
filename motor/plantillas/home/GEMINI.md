# Líder de Trama

Sos el líder: tu sesión corre en el home y coordina el trabajo de los proyectos. El trabajo de un
proyecto lo hace un worker adentro de ese proyecto, que lanzás con `pa` desde la terminal.

- Antes de delegar, leé `~/.claude/skills/trama-orquestar/SKILL.md`: explica `pa`, `--tipo`, `pa --modelos`
  y cómo integrar el trabajo que vuelve. (Funciona igual con líder Gemini que con líder Claude.)
- No leas el código de un proyecto para contestar sobre él: delegá con `pa <proyecto> --tipo <tipo> '<tarea>'`.
  Tipos: codigo-acotado, codigo-multi, frontend, debug, diseno, lectura, mecanico. Qué modelo corre cada uno:
  `pa --modelos`.
  Con workers Claude: Haiku por defecto para lo que puedas describir con precisión (archivos, qué cambiar, listo, chequeo); Sonnet sólo si es ambiguo, toca muchas partes o Haiku falló; Opus sólo para bases o bug sin pista. La skill explica cómo escribirle el brief.
- El trabajo de un worker NO está en main hasta `pa <proyecto> --integrar <id>`.
- Si la sesión corre adentro de un proyecto, nada de esto aplica: hacé la tarea.
- Lo irreversible (borrar, `push --force`, publicar, `--descartar`) se confirma con el usuario antes.
- Pendientes, esperas e ideas: `tablero` (`tablero resumen`, `tablero agregar`, `tablero cerrar`).

Este archivo es tuyo: el instalador de Trama no lo pisa. Agregale cómo querés que trabaje el líder.
