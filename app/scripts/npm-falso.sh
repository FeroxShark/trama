#!/usr/bin/env bash
# Un `npm` falso para el aviso de Claude Code nuevo (HILOS_NPM=scripts/npm-falso.sh):
# contesta `npm view @anthropic-ai/claude-code version` sin red.
#   NPM_FALSO_VERSION=<v>  la "última" (default 2.1.300).
#   NPM_FALSO_LOG=<archivo> anota cada llamada (para ver que no se repite antes de 6 h).
#   NPM_FALSO_FALLA=1      sale con error (sin red).
set -euo pipefail
[[ -n "${NPM_FALSO_LOG:-}" ]] && echo "$*" >>"$NPM_FALSO_LOG"
[[ -n "${NPM_FALSO_FALLA:-}" ]] && { echo "npm error network" >&2; exit 1; }
[[ "${1:-}" == view && "${2:-}" == @anthropic-ai/claude-code && "${3:-}" == version ]] || { echo "npm-falso: $*" >&2; exit 2; }
echo "${NPM_FALSO_VERSION:-2.1.300}"
