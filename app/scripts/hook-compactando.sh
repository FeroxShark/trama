#!/usr/bin/env bash
# Hook de Claude Code para que trama sepa quién está compactando su contexto
# (electron/compactando.ts): Claude Code no lo deja escrito en ningún lado.
# Se registra en los dos eventos, con el mismo comando:
#   PreCompact:  scripts/hook-compactando.sh    deja la marca
#   PostCompact: scripts/hook-compactando.sh    la saca
# Qué evento es lo dice el `hook_event_name` que Claude Code manda por stdin;
# también se puede decir a mano: `hook-compactando.sh empieza|termina`.
# La marca es un archivo vacío, $HILOS_STATE/compactando/<id> (default
# ~/.local/state/hilos). <id>: en un worker de `pa`, el id de su run (PA_TS,
# que es el de su fila); si no, el session_id (el de la fila de un líder).
# Nunca falla ni imprime nada: un hook que sale mal no puede frenar un compactado.
set -u

accion="${1:-}"
entrada=""
# Hasta el EOF, sin colgarse si nadie manda nada (a mano, desde una terminal).
[[ -t 0 ]] || IFS= read -r -d '' -t 2 entrada || true

if [[ -z "$accion" ]]; then
  if [[ "$entrada" =~ \"hook_event_name\"[[:space:]]*:[[:space:]]*\"PreCompact\" ]]; then accion=empieza; else accion=termina; fi
fi

id=""
if [[ "${PA_WORKER:-}" == 1 && -n "${PA_TS:-}" ]]; then
  id="$PA_TS"
elif [[ "$entrada" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([A-Za-z0-9._-]+)\" ]]; then
  id="${BASH_REMATCH[1]}"
fi
# Sólo un nombre de archivo: nada que pueda salirse de la carpeta.
[[ "$id" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ && ${#id} -le 128 ]] || exit 0

dir="${HILOS_STATE:-$HOME/.local/state/hilos}/compactando"
case "$accion" in
  empieza) mkdir -p "$dir" 2>/dev/null && : >"$dir/$id" ;;
  termina) rm -f "$dir/$id" ;;
esac 2>/dev/null
exit 0
