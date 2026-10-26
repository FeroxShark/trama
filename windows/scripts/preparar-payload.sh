#!/usr/bin/env bash
# Deja en windows/payload/ el árbol que el instalador lleva a Ubuntu: motor/ y app/ de un
# `trama-exportar <destino>` (o de cualquier árbol con esa forma), más .version con su huella.
# La huella cambia con el contenido: es lo que hace que un .exe nuevo reinstale el motor.
#
# uso: scripts/preparar-payload.sh <árbol-exportado>
set -euo pipefail
aqui="${TRAMA_PAYLOAD_DEST:-$(cd "$(dirname "$0")/.." && pwd)}"
tmp=""
if [[ $# -ge 1 ]]; then
  fuente="$1"
elif command -v trama-exportar >/dev/null 2>&1; then
  tmp="$(mktemp -d)"
  trap '[[ -n "$tmp" && -d "$tmp" ]] && rm -r "$tmp"' EXIT
  trama-exportar "$tmp"
  fuente="$tmp"
else
  echo "uso: preparar-payload.sh <árbol-exportado>" >&2
  exit 1
fi
[[ -d "$fuente/motor" && -d "$fuente/app" ]] || { echo "$fuente no tiene motor/ y app/"; exit 1; }
[[ -f "$fuente/motor/scripts/instalar-producto.sh" ]] || { echo "falta motor/scripts/instalar-producto.sh"; exit 1; }
[[ -e "$aqui/payload" ]] && rm -r "$aqui/payload"
mkdir -p "$aqui/payload"
cp -a "$fuente/motor" "$fuente/app" "$aqui/payload/"
(cd "$aqui/payload" && find . -type f ! -name .version -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16) > "$aqui/payload/.version"
echo "payload: $(cat "$aqui/payload/.version")"
