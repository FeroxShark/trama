#!/usr/bin/env bash
# statusline-espejo.sh — envuelve el statusline que ya haya y deja una copia de los datos
# que Claude Code sólo le pasa al statusline (uso del plan, caché de la sesión) para la app
# `hilos`. Uso en settings.json:  "command": "bash ~/orquestador/hooks/statusline-espejo.sh <statusline original…>"
#
# Escribe $PA_STATE/statusline/<session_id>.json (atómico, formato versionado de este repo):
#   {version, ts, session_id, cwd, modelo, prompt_cache, config_dir, rate_limits:{five_hour,seven_day}}
# y suma a $PA_STATE/statusline/historial.jsonl {ts, h5, h5_reset, sem, sem_reset[, config_dir]} cuando cambian.
# config_dir = $CLAUDE_CONFIG_DIR de la sesión (null = la cuenta de siempre): con varias cuentas de Claude
# (bin/cuentas) es lo que le dice a reparto de qué cuenta es ese cupo.
# Nunca rompe el statusline: si algo falla, sigue y muestra lo del original.

entrada=$(cat)
STATE="${PA_STATE:-$HOME/.local/state/pa}"
dir="$STATE/statusline"

{
  sid=$(jq -r '.session_id // empty' <<<"$entrada" 2>/dev/null)
  if [[ -n "$sid" && "$sid" =~ ^[A-Za-z0-9_-]+$ ]]; then
    mkdir -p "$dir"
    tmp="$dir/.$sid.$$"
    if jq -c --argjson ts "$(date +%s)" --arg cd "${CLAUDE_CONFIG_DIR:-}" '{
          version: 1,
          ts: $ts,
          session_id: .session_id,
          cwd: (.workspace.current_dir // .cwd // null),
          modelo: (.model.id // null),
          prompt_cache: (.prompt_cache // null),
          config_dir: (if $cd == "" then null else $cd end),
          rate_limits: {
            five_hour: (.rate_limits.five_hour // null),
            seven_day: (.rate_limits.seven_day // null)
          }
        }' <<<"$entrada" >"$tmp" 2>/dev/null; then
      mv -f "$tmp" "$dir/$sid.json"
      # Historial de la cuota (para "cuánto de la semana fue cada cosa" en la app): una línea
      # sólo cuando cambia algún % o el reset; todas las sesiones escriben el mismo archivo.
      fila=$(jq -c '{ts, h5: .rate_limits.five_hour.used_percentage, h5_reset: .rate_limits.five_hour.resets_at,
                     sem: .rate_limits.seven_day.used_percentage, sem_reset: .rate_limits.seven_day.resets_at}
                    + (if .config_dir then {config_dir} else {} end)
                    | select(.h5 != null or .sem != null)' "$dir/$sid.json" 2>/dev/null)
      if [[ -n "$fila" ]]; then
        (
          flock -w 2 8 || exit 0
          ultima=$(tail -n 1 "$dir/historial.jsonl" 2>/dev/null)
          [[ "$(jq -c 'del(.ts)' <<<"$fila")" == "$(jq -c 'del(.ts)' <<<"${ultima:-null}" 2>/dev/null)" ]] \
            || printf '%s\n' "$fila" >>"$dir/historial.jsonl"
        ) 8>"$dir/.historial.lock"
      fi
    else
      rm -f "$tmp"
    fi
  fi
} 2>/dev/null

(( $# )) || exit 0
printf '%s' "$entrada" | "$@"
