#!/usr/bin/env bash
# Captura de la barra en un estado forzado (sin mouse ni teclado): la app se
# renderiza offscreen con fixtures, escribe el PNG y se cierra (~2 s). No abre
# ninguna ventana. Una foto de pantalla (grim) no sirve: se lleva puesto el
# puntero y los overlays de capa que haya encima (mascota, carteles, salvapantallas).
#
# uso: scripts/captura.sh <estado> [VAR=valor ...]
#   estado: normal | hover | colapsado | cerrados | modelo | esfuerzo |
#           trabajando | oculta | vacio | buscar | lider | lider-terminal | lider-nuevo | lider-nuevo-carpeta | arbol |
#           aviso | ajustes | ramas | ramas-confirmar | ramas-conflicto | ramas-lanzar | ramas-lanzar-error | estadisticas |
#           lider-trabajando | lider-mcp | lider-avisos | settle-confirmar | worker-vista | worker-vista-vivo |
#           estadisticas-30 | estadisticas-medido | estadisticas-vacia | claude | claude-abierto | solo-lideres | ocultos |
#           lider-sistema | lider-cambio-motor[menu|confirmar] | cuenta-lider | sistema | herramientas | lider-compactando |
#           trama|trama-abierto|trama-sucio|trama-ocupado|trama-instalada (el aviso de una Trama nueva, con una instalada vieja forzada) |
#           lider-relevo | lider-imagenes | lider-editar | lider-tabla | lider-formato | lider-listas | lider-pensando | lider-intermedios | lider-gemini | herramientas-resultados | lider-hover | te-espera |
#           tablero | tablero-detalle | tablero-proyectos | tablero-iniciar | tablero-pospuestos | tablero-maquinas | tablero-vacio | maquinas-selector[-caida] | tablero-nuevo[-proyecto|-chat|-avisar] | lider-muerto | lider-app-muerto |
#           compactando | consumo | orden-arrastrando | orden-menu | orden-prioridad | activas[plegada|fijo] | mover-menu | pc-apagada | pc-prendiendo | pc-prendida   (ver `Captura` en src/modo.ts)
#   DIR=prueba       subcarpeta de bench-resultados/captura/ donde va el PNG (default: la carpeta misma);
#                    con una "/" es la ruta entera (DIR=/tmp/capturas)
#   TAM="1920 1200"  tamaño del PNG en px
#   ESCALA=1.5       zoom: 1920×1200 a 1.5× son 1280×800 de CSS
#   HILOS_LETRA=16   tamaño de letra (13 a 18); HILOS_FUENTE=inter y HILOS_MONO=fira,
#                    las fuentes (ids en src/tipografia.ts); con `ajustes`,
#                    HILOS_VARIANTE=fuente|mono deja abierto ese selector
#                    con `ajustes`/`estadisticas`, HILOS_VARIANTE=error deja el panel
#                    que no cargó, con su Reintentar
#                    con `ajustes`, HILOS_VARIANTE=cuentas|celular|editando|editando-mal: las cuentas (Windows), el acceso desde el celular, lo editado sin guardar, lo que no vale
#                    con `lider-trabajando`, HILOS_VARIANTE=pendiente|pendiente-modelo: otro esfuerzo / otro modelo elegido con el turno en curso (la marca "próx.")
#                    con `herramientas-resultados`, HILOS_VARIANTE=archivo-imagen|archivo-texto|archivo-md|archivo-pdf deja abierto el visor con el primer archivo de ese tipo
#                    con `lider-formato`, HILOS_VARIANTE=larga la conversación de 3000 mensajes; con `lider-imagenes`, =visor el visor con la imagen sin llegar
#   ej: scripts/captura.sh hover
#
# Deja bench-resultados/captura/[<DIR>/]<estado>.png (esa carpeta no va al repo). Requiere el build: `npm run build`
# y ImageMagick (`magick`).
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
estado="${1:?estado}"; shift
bin="$raiz/node_modules/electron/dist/electron"
case "${DIR:-}" in
  */*) out="$DIR/$estado.png" ;;
  "") out="$raiz/bench-resultados/captura/$estado.png" ;;
  *) out="$raiz/bench-resultados/captura/$DIR/$estado.png" ;;
esac
mkdir -p "$(dirname "$out")"

[[ -x "$bin" ]] || { echo "falta $bin (npm install)"; exit 1; }
[[ -f "$raiz/dist-electron/main.js" && -f "$raiz/dist/index.html" ]] || { echo "falta el build (npm run build)"; exit 1; }

# Nunca con lo de la persona: un HOME vacío con sus XDG, un estado y un perfil temporales, y sin directorios del home en el PATH.
# `electron/aislar.ts` además hace fallar la corrida (salida 97) si algo toca el HOME de verdad.
casa="$(mktemp -d "${TMPDIR:-/tmp}/trama-captura-XXXXXX")"
trap 'rm -rf "$casa"' EXIT
camino="$(printf %s "$PATH" | tr ':' '\n' | grep -v "^$HOME\(/\|$\)" | paste -sd: || true)"
# La app lee de motor/ (fuera de app/): los topes de Go (motor/opencode/go-topes.{json,mjs}, electron/opencode-go.ts). Esa carpeta del checkout es lo que se permite además de app/.
motor="$(cd "$raiz/.." && pwd)/motor"
set +e
env -u CLAUDE_CONFIG_DIR -u PA_STATE -u PROYECTOS_REGISTRY -u TABLERO_DIR -u TABLERO_VISTA \
  HOME="$casa" XDG_CONFIG_HOME="$casa/.config" XDG_DATA_HOME="$casa/.local/share" XDG_CACHE_HOME="$casa/.cache" XDG_STATE_HOME="$casa/.local/state" \
  PATH="$camino" HILOS_STATE="$casa/estado" HILOS_PERFIL="$casa/perfil" HILOS_AISLAR_PERMITE="$motor${HILOS_AISLAR_PERMITE:+:$HILOS_AISLAR_PERMITE}" \
  HILOS_CAPTURA="$estado" HILOS_CAPTURA_PNG="$out" HILOS_TAM="${TAM:-1920 1200}" HILOS_ESCALA="${ESCALA:-1.5}" HILOS_IDIOMA="${HILOS_IDIOMA:-es}" "$@" \
  timeout 15 "$bin" "$raiz" 2>"$casa/err" >/dev/null
rc=$?
set -e
grep '^\[aislar\]' "$casa/err" || true
[[ $rc -eq 0 ]] || { echo "$estado: falló (salida $rc; 97 = tocó lo de la persona)"; exit 1; }
echo "$estado: $out ($(magick identify -format '%wx%h' "$out"))"

