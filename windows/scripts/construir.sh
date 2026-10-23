#!/usr/bin/env bash
# Arma windows/dist/Trama-Setup-<versión>.exe en Linux (NSIS + wine). Hace falta, una vez:
#   las dependencias de windows/ instaladas (package.json: electron-builder, electron-updater)
#   scripts/preparar-payload.sh <árbol de trama-exportar>
# TRAMA_GH_OWNER / TRAMA_GH_REPO: de dónde se actualiza (GitHub Releases); con los de relleno
# el .exe se arma igual pero no busca actualizaciones.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d node_modules/electron-builder ]] || { echo "faltan las dependencias de windows/ (node_modules)"; exit 1; }
[[ -f payload/.version ]] || { echo "falta payload/ (scripts/preparar-payload.sh <árbol>)"; exit 1; }
export TRAMA_GH_OWNER="${TRAMA_GH_OWNER:-TRAMA_GH_OWNER}" TRAMA_GH_REPO="${TRAMA_GH_REPO:-TRAMA_GH_REPO}"
export WINEDEBUG="${WINEDEBUG:--all}" WINEPREFIX="${WINEPREFIX:-$HOME/.cache/trama-windows-wine}"
exec npx --no-install electron-builder --win nsis --x64 --publish never "$@"
