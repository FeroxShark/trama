#!/usr/bin/env bash
# Una pantalla del asistente a PNG, offscreen (sin Windows): scripts/captura.sh <pantalla> [salida.png]
# pantallas: instalar | login | login-uno | ollama | error
set -euo pipefail
aqui="$(cd "$(dirname "$0")/.." && pwd)"
demo="${1:-instalar}"
salida="${2:-$aqui/docs/$demo.png}"
bin="$aqui/node_modules/electron/dist/electron"
[[ -x "$bin" ]] || bin="$aqui/../node_modules/electron/dist/electron"
[[ -x "$bin" ]] || { echo "no encuentro electron"; exit 1; }
mkdir -p "$(dirname "$salida")"
TRAMA_DEMO="$demo" TRAMA_PNG="$salida" timeout 20 "$bin" --no-sandbox --ozone-platform=headless --user-data-dir="$(mktemp -d)" "$aqui/scripts/captura-main.cjs" >/dev/null 2>&1
echo "$demo: $salida"
