#!/usr/bin/env bash
# Deja en windows/payload/ el árbol que el instalador lleva a Ubuntu: motor/ y app/ de un
# `trama-exportar <destino>` (o de cualquier árbol con esa forma), más .version con su huella.
# La huella cambia con el contenido: es lo que hace que un .exe nuevo reinstale el motor.
#
# uso: scripts/preparar-payload.sh <árbol-exportado>
set -euo pipefail
aqui="$(cd "$(dirname "$0")/.." && pwd)"
fuente="${1:?uso: preparar-payload.sh <árbol-exportado (con motor/ y app/)>}"
[[ -d "$fuente/motor" && -d "$fuente/app" ]] || { echo "$fuente no tiene motor/ y app/"; exit 1; }
[[ -f "$fuente/motor/scripts/instalar-producto.sh" ]] || { echo "falta motor/scripts/instalar-producto.sh"; exit 1; }
[[ -e "$aqui/payload" ]] && rm -r "$aqui/payload"
mkdir -p "$aqui/payload"
cp -a "$fuente/motor" "$fuente/app" "$aqui/payload/"
(cd "$aqui/payload" && find . -type f ! -name .version -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-16) > "$aqui/payload/.version"
echo "payload: $(cat "$aqui/payload/.version")"
