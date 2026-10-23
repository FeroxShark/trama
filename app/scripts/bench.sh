#!/usr/bin/env bash
# Bench: abre la app en una ventana flotante chica, en la esquina del
# workspace ACTIVO del monitor pedido, sin robar foco; la app corre su guion
# (~13 s), escribe el JSON y se cierra sola. Imprime un resumen de una línea
# (y, con el guion de la barra, una por fase: hover, cerrar, colapso).
#
# uso: scripts/bench.sh <monitor> <etiqueta> [VAR=valor ...]
#   HILOS_FLAGS="disable-gpu use-angle=gl"  switches de Chromium extra
#   HILOS_GUION=b0  la pantalla de prueba de B0 en vez de la barra
#   HILOS_GPU=1     con GPU (el default es sin)
#   TAM="1200 800" tamaño de la ventana (default 640 480)
#   MOV="100%-1220 100%-820" posición (acompañar a TAM)
#   ej: scripts/bench.sh HDMI-A-2 base
#       scripts/bench.sh HDMI-A-2 con-gpu HILOS_GPU=1
#
# Por qué visible y no en un workspace libre "silent": sin estar en pantalla
# Hyprland no manda frame callbacks y el rAF se frena; los fps saldrían basura.
# Requiere el build: `npm run build`.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
mon="${1:?monitor}"; etiqueta="${2:?etiqueta}"; shift 2
# El binario real, no node_modules/.bin/electron (cli.js lo lanzaría como hijo
# y las reglas de Hyprland y el pid de la ventana quedarían en otro proceso).
bin="$raiz/node_modules/electron/dist/electron"; args=" $raiz"
dir="$raiz/bench-resultados"
out="$dir/$etiqueta.json"
mkdir -p "$dir"; rm -f "$out"

[[ -x "$bin" ]] || { echo "falta $bin (npm install)"; exit 1; }
[[ -f "$raiz/dist-electron/main.js" && -f "$raiz/dist/index.html" ]] || { echo "falta el build (npm run build)"; exit 1; }
if pgrep -f "^$bin$args" >/dev/null; then echo "ya hay un hilos corriendo"; exit 1; fi

reglas="float on; no_initial_focus on; size ${TAM:-640 480}; move ${MOV:-100%-660 100%-500}; monitor $mon"
hyprctl dispatch exec "[$reglas] env HILOS_BENCH=$out $* bash -c 'exec $bin$args 2>$dir/$etiqueta.log'" >/dev/null

# Esperar el JSON (la app tiene corte duro a los 18 s).
limite=$((SECONDS + 25))
while [[ ! -f "$out" && $SECONDS -lt $limite ]]; do
  inotifywait -qq -t 2 -e moved_to -e close_write "$dir" 2>/dev/null || true
done

# Que no quede nada abierto.
pid="$(pgrep -f "^$bin$args\$" || true)"
if [[ -n "$pid" ]]; then
  timeout 5 tail --pid="$pid" -f /dev/null 2>/dev/null || pkill -f "^$bin$args\$" || true
fi
# Electron deja hijos (zygote, gpu) un instante; esperarlos.
for _ in 1 2 3 4 5; do pgrep -f "^$bin" >/dev/null || break; sleep 0.2; done

[[ -f "$out" ]] || { echo "$etiqueta: sin resultado"; exit 1; }

jq -r --arg e "$etiqueta" '
  if .error then "\($e): ERROR \(.error)" else
  ([.reposo.cpu1.procesos[].ticks] | add) as $t1 |
  ([.reposo.cpu0.procesos[].ticks] | add) as $t0 |
  ((.reposo.cpu1.ms - .reposo.cpu0.ms) / 1000) as $s |
  ([.cpu_animacion.cpu1.procesos[].ticks] | add) as $a1 |
  ([.cpu_animacion.cpu0.procesos[].ticks] | add) as $a0 |
  ((.cpu_animacion.cpu1.ms - .cpu_animacion.cpu0.ms) / 1000) as $sa |
  "\($e): mon=\(.hyprland.monitor)@\(.hyprland.refresh_hz | floor)Hz xwayland=\(.hyprland.xwayland) " +
  "arranque=\(.arranque_ms | floor)ms fps=\(.animacion.fps_medio) med=\(.animacion.dt_mediana_ms)ms " +
  "p99=\(.animacion.dt_p99_ms)ms peor=\(.animacion.peor_ms)ms peor2s=\(.animacion.peor_ms_ult_2s)ms " +
  "tirones=\(.animacion.tirones)/\(.animacion.frames) " +
  "cpu_anim=\((($a1 - $a0) / .reposo.cpu1.clk_tck / $sa * 100) | round)% " +
  "cpu_reposo=\((($t1 - $t0) / .reposo.cpu1.clk_tck / $s * 100) * 100 | round / 100)% " +
  (if .reposo.cpu_mitad then
    ([.reposo.cpu_mitad.procesos[].ticks] | add) as $tm |
    "reposo_2a_mitad=\((($t1 - $tm) / .reposo.cpu1.clk_tck / ((.reposo.cpu1.ms - .reposo.cpu_mitad.ms) / 1000) * 100) * 100 | round / 100)% "
  else "" end) +
  "pss_reposo=\(([.reposo.cpu1.procesos[].pss_kb // 0] | add) / 1024 | round)MB " +
  "rss_reposo=\(([.reposo.cpu1.procesos[].rss_kb // 0] | add) / 1024 | round)MB " +
  "gpu=\(.gpu_estado.gpu_compositing // "-") " +
  "procs=\([.reposo.cpu1.procesos[] | .tipo // .comm] | join(","))" +
  (if .fases then
    ([.fases | to_entries[] | select(.value) |
      "\n  \(.key): fps=\(.value.fps_medio) med=\(.value.dt_mediana_ms)ms p99=\(.value.dt_p99_ms)ms peor=\(.value.peor_ms)ms tirones=\(.value.tirones)/\(.value.frames)"] | add) +
    "\n  reloj: \(.reloj.tics) tics, \(.reloj.textos_escritos) textos escritos de \(.reloj.anotados), \(.reloj.renders_de_fila) renders de fila" +
    (if .reposo_vivo then "\n  reposo: \(.reposo_vivo.rafs) rAF pedidos, animaciones vivas: \(.reposo_vivo.animaciones | if length == 0 then "ninguna" else join(", ") end)" else "" end)
  else "" end)
  end' "$out"
