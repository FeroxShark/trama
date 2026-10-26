#!/usr/bin/env bash
# Arma windows/dist/Trama-Setup-<versión>.exe en Linux (NSIS + wine). Hace falta, una vez:
#   las dependencias de windows/ instaladas (package.json: electron-builder, electron-updater)
#   scripts/preparar-payload.sh <árbol de trama-exportar>
# TRAMA_GH_OWNER / TRAMA_GH_REPO: de dónde se actualiza (GitHub Releases); con los de relleno
# el .exe se arma igual pero no busca actualizaciones.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -d node_modules/electron-builder ]] || { echo "faltan las dependencias de windows/ (node_modules)"; exit 1; }
if [[ ! -s payload/.version ]] && command -v trama-exportar >/dev/null 2>&1; then
  bash scripts/preparar-payload.sh
fi
[[ -s payload/.version && -f payload/motor/scripts/instalar-producto.sh && -f payload/app/package.json ]] || {
  echo "falta payload completo (scripts/preparar-payload.sh <árbol>)" >&2
  exit 1
}
export TRAMA_GH_OWNER="${TRAMA_GH_OWNER:-FeroxShark}" TRAMA_GH_REPO="${TRAMA_GH_REPO:-trama}"
export WINEDEBUG="${WINEDEBUG:--all}" WINEPREFIX="${WINEPREFIX:-$HOME/.cache/trama-windows-wine}"
npx --no-install electron-builder --win nsis --x64 --publish never "$@"
ver="$(node -p 'require("./package.json").version')"
[[ -f "dist/Trama-Setup-${ver}.exe" && -f "dist/latest.yml" && -s "dist/win-unpacked/resources/payload/.version" ]] || {
  echo "el armado quedó incompleto (faltan el .exe, latest.yml o payload/.version)" >&2
  exit 1
}
echo "listo: dist/Trama-Setup-${ver}.exe (payload $(cat payload/.version), github ${TRAMA_GH_OWNER}:${TRAMA_GH_REPO})"
echo "subir juntos a la release de GitHub: dist/Trama-Setup-${ver}.exe dist/Trama-Setup-${ver}.exe.blockmap dist/latest.yml"
