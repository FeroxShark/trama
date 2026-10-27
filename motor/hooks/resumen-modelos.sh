#!/usr/bin/env bash
# resumen-modelos.sh — hook SessionStart del LÍDER: deja en su contexto el resumen de modelos de `reparto --resumen`
# (id para `-m`, inteligencia por effort, costo, gratis/pago, cupo libre y para qué sirve cada uno), para que elija modelo y
# effort de cada worker según el tamaño real de la tarea. SessionStart también corre tras compactar y al retomar: ahí se refresca
# (los cupos cambian); a mitad de sesión el líder lo vuelve a pedir con `reparto --resumen`.
# Sólo en la sesión del home (el líder): un worker (PA_WORKER) o una sesión dentro de un proyecto no lo ven.
# Nunca falla ni demora el arranque: cualquier error termina en silencio con rc 0.

[[ -n "${PA_WORKER:-}" ]] && exit 0
command -v reparto >/dev/null 2>&1 || exit 0

entrada=$(cat 2>/dev/null)
cwd=$(jq -r '.cwd // empty' <<<"$entrada" 2>/dev/null)
[[ -n "$cwd" ]] || cwd="$PWD"
[[ "$(realpath "$cwd" 2>/dev/null)" == "$(realpath "$HOME" 2>/dev/null)" ]] || exit 0

salida=$(timeout 8 reparto --resumen 2>/dev/null) || exit 0
[[ -n "$salida" ]] && printf '%s\n' "$salida"
exit 0
