#!/usr/bin/env bash
# `pa` falso para probar la app sin tocar nada de verdad (Cerrar integra ramas,
# Nueva tarea lanza workers, Escribirle retoma sesiones):
#   HILOS_FIXTURES=0 HILOS_PA="$PWD/scripts/pa-falso.sh" npm start
# Anota el argv de cada llamada en $PA_FALSO_LOG (default
# bench-resultados/pa-falso.log; cada argumento con `printf %q`, más PA_ORIGEN) y
# devuelve JSON fijo con hilos inventados.
#   PA_FALSO_FALLA=<código>  las acciones fallan con ese código de salida y un
#                     mensaje por stderr: 1 es un error cualquiera, 93 son los
#                     tests rojos de `--integrar --tests`.
#   PA_FALSO_N=800    suma N hilos sintéticos en tres proyectos (lista virtualizada).
# `--plan` contesta "plan: max" (o PA_FALSO_PLAN); `--plan pro|max` lo cambia (si hay PA_STATE, queda en su `plan-falso`) y otro valor sale con 2.
# 33333, 44444 y 77777 los lanzó el líder "ana-prueba" (session_id s-falso-lider, u otro
# con PA_FALSO_LIDER=<id>): la prueba lo hace vivir con un `HILOS_SESIONES` temporal. 11111, 22222, 55555 y los
# sintéticos los lanzó la app (se ven aunque no haya líder); 66666 queda huérfano. 88888
# (rama sin commits) y 99999 (con commits) murieron: Quitar, o Integrar/Quitar.
# Con un archivo `muertos` en PA_STATE, al 44444 lo mataron: sale `murio` sin que nadie escriba
# un evento (scripts/prueba-vigia.mjs).
# Ramas que se integran solas (B22), con PA_FALSO_SEGURAS=1 (o un archivo `seguras` en PA_STATE): 12121, 13131 y 14141 (atlas,
# listo con "DECISION: nada" y commits). PA_FALSO_INTEGRAR="13131:80,14141:93" hace que
# `--integrar` de esos ids salga con ese código (el 80 sólo la primera vez: después de un
# `--actualizar` entra). `--actualizar <id> --async` anota una corrida ya terminada
# sobre la misma rama (con su evento), como si hubiera rebaseado.
# Como el `pa` real, rechaza (exit 2) `-m *haiku*` y `--effort max` al lanzar, salvo con `--tipo mecanico`
# (Haiku es el modelo de lo mecánico: el paso previo de Ramas lo lanza con `-m claude-haiku-5-5 --effort xhigh`).
# `--actualizar` anota en `lanzados.tsv` el modelo y el effort con que lo lanzaron (`-m`, `--effort`).
# Si `PA_STATE` apunta a un directorio que NO es el de `pa` de verdad, lo lanzado
# se anota ahí (`lanzados.tsv`, sale en `--hilos` como trabajando) y se escribe un
# evento en su `eventos.jsonl`: la app lo relee como con el `pa` real.
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
log="${PA_FALSO_LOG:-$raiz/bench-resultados/pa-falso.log}"
mkdir -p "$(dirname "$log")"
{
  # %q escapa los acentos según el locale ($'mir\303\241' en C): con UTF-8 quedan legibles y el log es el mismo en toda máquina.
  LC_ALL=C.UTF-8
  printf '%s PA_ORIGEN=%s PA_AUTO=%s' "$(date +%T)" "${PA_ORIGEN:-}" "${PA_AUTO:-}"
  printf ' %q' "$@"
  printf '\n'
} >>"$log"

estado_falso=""
if [[ -n "${PA_STATE:-}" && "$(realpath -m "$PA_STATE")" != "$(realpath -m "$HOME/.local/state/pa")" ]]; then
  estado_falso="$PA_STATE"
  mkdir -p "$estado_falso"
fi

if [[ "${1:-}" == --hilos ]]; then
  ahora=$(date +%s)
  seguras="${PA_FALSO_SEGURAS:-0}"
  [[ -n "$estado_falso" && -f "$estado_falso/seguras" ]] && seguras=1
  integradas="[]"
  [[ -n "$estado_falso" && -f "$estado_falso/integradas" ]] && integradas="$(jq -R -s 'split("\n") | map(select(length > 0))' "$estado_falso/integradas")"
  lanzados="[]"
  if [[ -n "$estado_falso" && -f "$estado_falso/lanzados.tsv" ]]; then
    lanzados="$(jq -R -s 'split("\n") | map(select(length > 0) | split("\t") | {id: .[0], proyecto: .[1], tarea: .[2], modelo: .[3], effort: .[4], sigue_de: (.[5] | if . == "" then null else . end), inicio: (.[6] | tonumber), estado: (.[7] // "trabajando"), rama: (.[8] // null)})' "$estado_falso/lanzados.tsv")"
  fi
  # Un archivo `muertos` en el PA_STATE de mentira: al 44444 lo mataron (sin evento, como en la vida real).
  muertos=0
  [[ -n "$estado_falso" && -f "$estado_falso/muertos" ]] && muertos=1
  jq -n --argjson t "$ahora" --argjson n "${PA_FALSO_N:-0}" --argjson seguras "$seguras" --argjson integradas "$integradas" --argjson lanzados "$lanzados" --argjson muertos "$muertos" --arg lider "${PA_FALSO_LIDER:-s-falso-lider}" '
    def hilo($id; $p; $tarea; $estado; $hace; $rama; $leer):
      { id: $id, proyecto: $p, tarea: $tarea, modelo: "claude-opus-5-5", effort: "medium",
        origen: "jefe", jefe: null, jefe_id: null, sigue_de: null, estado: $estado, en_cola: false, inicio: ($t - $hace),
        duracion_s: (if $estado == "trabajando" then null else 300 end), puesto: "1",
        rama: $rama, commits: (if $rama then 2 else 0 end),
        decision: (if $estado == "decision" then "¿Corto ya o dejo un release más con las dos?" else null end),
        decision_nada: null,
        resultado: "Hecho.", archivado: null, leer: $leer, cache_ttl_s: 3600,
        cache_vence: ($t + 1800), cache_frio: null, cache_modelo: "claude-opus-5-5" };
    {origen: "app"} as $app
    | {jefe: "ana-prueba", jefe_id: $lider} as $lider
    | { version: 1, hilos: (
      [$lanzados[] | hilo(.id; .proyecto; .tarea; .estado; ($t - .inicio); (.rama // "pa/\(.proyecto)/\(.id)"); false)
        + {modelo, effort, sigue_de, origen: "app"}]
      + (if $seguras == 1 then [
      hilo("20261003-100800-12121"; "atlas"; "Segura: se integra sola"; "listo"; 1500; "pa/atlas/20261003-100800-12121"; false)
        + { decision_nada: true } + $app,
      hilo("20261003-100900-13131"; "atlas"; "Segura con conflicto (80, actualizar)"; "listo"; 1400; "pa/atlas/20261003-100900-13131"; false)
        + { decision_nada: true } + $app,
      hilo("20261003-101000-14141"; "atlas"; "Segura con tests rojos (93)"; "listo"; 1300; "pa/atlas/20261003-101000-14141"; false)
        + { decision_nada: true } + $app
      ] | map(if (.id | IN($integradas[])) then .estado = "integrado" else . end) else [] end)
      + [
      hilo("20261003-100000-11111"; "atlas"; "Cerrar con rama (integra)"; "listo"; 900; "pa/atlas/20261003-100000-11111"; false) + $app,
      hilo("20261003-100100-22222"; "atlas"; "Cerrar sin rama (archiva)"; "entregado"; 1200; null; false) + $app,
      hilo("20261003-100200-33333"; "brote"; "Consulta de sólo lectura (Settle archiva)"; "listo"; 600; null; true) + $lider,
      hilo("20261003-100300-44444"; "brote"; "Sigue trabajando"; "trabajando"; 60; "pa/brote/20261003-100300-44444"; false) + $lider,
      hilo("20261003-100500-77777"; "brote"; "De un líder con rama (Settle archiva)"; "listo"; 700; "pa/brote/20261003-100500-77777"; false) + $lider,
      hilo("20261003-100400-55555"; "atlas"; "Necesita que elijas"; "decision"; 300; "pa/atlas/20261003-100400-55555"; false) + $app,
      hilo("20261003-090000-55555"; "brote"; "Integrada hace poco (Deshacer revierte)"; "integrado"; 5400; "pa/brote/20261003-090000-55555"; false)
        + { commits: null } + $lider,
      hilo("20261003-100400-66666"; "cauce"; "Rama para descartar"; "listo"; 2400; "pa/cauce/20261003-100400-66666"; false),
      hilo("20261003-100600-88888"; "cauce"; "Murió sin commits (Quitar descarta)"; "murio"; 2000; "pa/cauce/20261003-100600-88888"; false)
        + { commits: 0 } + $app,
      hilo("20261003-100700-99999"; "cauce"; "Murió con commits (Integrar o Quitar)"; "murio"; 1900; "pa/cauce/20261003-100700-99999"; false) + $app
    ] + [range($n) as $i |
      hilo("20261002-\(1000000 + $i | tostring | .[1:])-\(10000 + $i)"; ["cosecha", "duna", "eco"][$i % 3];
           "Tarea sintética \($i)"; ["entregado", "listo", "decision", "murio"][$i % 4]; 2000 + $i * 60; null; false) + $app
    ]) }
    | if $muertos == 1 then .hilos |= map(if .id == "20261003-100300-44444" then .estado = "murio" | .duracion_s = null else . end) else . end'
  exit 0
fi

# `--hilo <id> --json [-n N] [--antes N]`: una conversación inventada de 120
# mensajes (para probar la paginación), con la misma forma que la de `pa`.
if [[ "${1:-}" == --hilo ]]; then
  id="${2:?id}"; shift 2
  n=50; antes=""
  while (( $# )); do
    case "$1" in
      --json) ;;
      -n) n="$2"; shift ;;
      --antes) antes="$2"; shift ;;
    esac
    shift
  done
  ahora=${PA_FALSO_AHORA:-$(date +%s)}   # PA_FALSO_AHORA fija el reloj de --hilo (tests que comparan dos respuestas)
  jq -n --arg id "$id" --argjson n "$n" --arg antes "$antes" --argjson t "$ahora" '
    def ts($k): ($t - 3600 + $k * 20) | todate;
    def herr($k): [["Read"], ["Bash"], ["Edit", "Bash"], ["Grep", "Read", "Read"]][$k % 4];
    [range(120) as $k |
      if $k == 0 then {rol: "user", texto: "Pedido inventado: armá la pieza \"X\" con `backticks` y comillas. Listo cuando los tests pasen."}
      elif $k == 70 then {rol: "user", texto: "Seguí con lo que faltaba."}
      elif $k == 69 or $k == 119 then {rol: "assistant", texto: "RESULTADO: Parte \($k) terminada, 2 commits en la rama.\nARCHIVOS: src/x.ts\nDECISION: nada", herramientas: []}
      elif $k % 9 == 0 then {rol: "assistant", texto: "Paso intermedio \($k): leo y edito.", herramientas: herr($k)}
      else {rol: "assistant", texto: "", herramientas: herr($k)} end
      | . + {i: $k, ts: ts($k), modelo: (if .rol == "assistant" then "claude-opus-5-5" else null end), herramientas: (.herramientas // [])}
    ] as $todos
    | ($todos | length) as $total
    | ([$total, (if $antes == "" then $total else ($antes | tonumber) end)] | min) as $hasta
    | ([0, $hasta - $n] | max) as $desde
    | {version: 1, id: $id, proyecto: "atlas", transcript: "/tmp/falso.jsonl", total: $total, desde: $desde, hasta: $hasta,
       mensajes: [$todos[] | select(.i >= $desde and .i < $hasta)],
       usage: {input_tokens: 2, cache_creation_input_tokens: 410, cache_read_input_tokens: 84210, output_tokens: 254},
       modelo: "claude-opus-5-5"}'
  exit 0
fi

if [[ "${1:-}" == --cupo-gemini ]]; then
  [[ -n "${PA_FALSO_CUPO_GEMINI:-}" ]] && printf "%s\n" "$PA_FALSO_CUPO_GEMINI"
  exit 0
fi

if [[ "${1:-}" == --plan ]]; then
  plan_f="${PA_STATE:+$PA_STATE/plan-falso}"
  if [[ -n "${2:-}" ]]; then
    case "$2" in
      pro | max) [[ -n "$plan_f" ]] && echo "$2" >"$plan_f" ;;
      *) echo "pa: plan '$2' no va (pro o max)" >&2; exit 2 ;;
    esac
  fi
  if [[ -n "$plan_f" && -f "$plan_f" ]]; then echo "plan: $(<"$plan_f")"; else echo "plan: ${PA_FALSO_PLAN:-max}"; fi
  exit 0
fi

# Lo que lanza un claude (tarea nueva o --seguir): la política de modelos, como `pa`.
lanza=1
for a in "$@"; do
  case "$a" in --integrar|--descartar|--ramas|--matar|--parar|--archivar|--revertir) lanza=0 ;; esac
done
mecanico=0
[[ " $* " == *" --tipo mecanico "* ]] && mecanico=1
if (( lanza )); then
  prev=""
  for a in "$@"; do
    [[ "$a" == -- ]] && break
    if [[ "$prev" == -m && "${a,,}" == *haiku* ]] && (( ! mecanico )); then
      echo "pa: modelo '$a' no va: nunca haiku para un agente (política 2026-09-30). Código: claude-opus-5-5; exploración: claude-sonnet-5-5; frontend visual: claude-fable-5-1." >&2
      exit 2
    fi
    if [[ "$prev" == --effort && ( "${a,,}" == max || "${a,,}" == low ) ]] && (( ! mecanico )); then
      echo "pa: effort '$a' no va (política de modelos, plan max: nunca max ni low). Usá medium, high o xhigh." >&2
      exit 2
    fi
    prev="$a"
  done
fi

# `--integrar <id>` con un código propio (PA_FALSO_INTEGRAR="id:rc,…"; el 80, sólo la primera vez).
if [[ " $* " == *" --integrar "* && -n "${PA_FALSO_INTEGRAR:-}" ]]; then
  prev=""; integra=""
  for a in "$@"; do [[ "$prev" == --integrar ]] && integra="$a"; prev="$a"; done
  IFS=, read -ra pares <<<"$PA_FALSO_INTEGRAR"
  for par in "${pares[@]}"; do
    [[ "$integra" == *"${par%%:*}" ]] || continue
    rc="${par##*:}"; veces="${estado_falso:-/tmp}/integrar-$integra.n"
    n=$(( $(cat "$veces" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$veces"
    if [[ "$rc" == 80 ]] && (( n > 1 )); then break; fi
    case "$rc" in
      80) echo "pa: conflictos al integrar $integra con main. Que lo resuelva un worker: pa atlas --actualizar $integra" >&2 ;;
      93) echo "pa-falso: tests rojos: 2 fallan en la integración" >&2 ;;
      *) echo "pa-falso: --integrar salió $rc" >&2 ;;
    esac
    exit "$rc"
  done
fi

# Una segura que entra queda integrada (como en el `pa` real, que la lista dice "integrado").
if [[ " $* " == *" --integrar "* && -n "$estado_falso" && -z "${PA_FALSO_FALLA:-}" ]]; then
  prev=""; integra=""
  for a in "$@"; do [[ "$prev" == --integrar ]] && integra="$a"; prev="$a"; done
  case "$integra" in
    *-12121|*-13131|*-14141)
      echo "$integra" >>"$estado_falso/integradas"
      printf '{"version":1,"ts":%s,"tipo":"integrado","id":"%s","proyecto":"atlas"}\n' "$(date +%s)" "$integra" >>"$estado_falso/eventos.jsonl"
      ;;
  esac
fi

# `--actualizar <id> --async`: una corrida ya terminada sobre la rama de esa corrida.
if [[ " $* " == *" --actualizar "* ]]; then
  prev=""; act=""; modelo_a="claude-opus-5-5"; effort_a="medium"
  for a in "$@"; do
    [[ "$a" == -- ]] && break
    [[ "$prev" == --actualizar ]] && act="$a"
    [[ "$prev" == -m ]] && modelo_a="$a"
    [[ "$prev" == --effort ]] && effort_a="$a"
    prev="$a"
  done
  proyecto="$1"; ts="$(date +%Y%m%d-%H%M%S)-$$"; slug="atlas"
  if [[ -n "$estado_falso" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ts" "$slug" "Actualizar $act" "$modelo_a" "$effort_a" "" "$(date +%s)" "listo" "pa/$slug/$act" >>"$estado_falso/lanzados.tsv"
    printf '{"version":1,"ts":%s,"tipo":"fin","id":"%s","proyecto":"%s"}\n' "$(date +%s)" "$ts" "$slug" >>"$estado_falso/eventos.jsonl"
  fi
  echo "pa: '$proyecto' lanzado en background en el puesto 1 (id: $ts, log: /tmp/pa-falso-$ts.log)."
  exit 0
fi

if [[ -n "${PA_FALSO_FALLA:-}" ]]; then
  echo "pa-falso: tests rojos: 2 fallan en la integración" >&2
  exit "$PA_FALSO_FALLA"
fi
sleep 0.3

if (( lanza )) && [[ "${1:-}" != -* ]]; then
  proyecto="$1"; shift
  modelo="claude-opus-5-5"; effort="medium"; sigue=""; tarea=""
  while (( $# )); do
    case "$1" in
      -m) modelo="$2"; shift ;;
      --effort) effort="$2"; shift ;;
      --id) sigue="$2"; shift ;;
      --) shift; tarea="$*"; break ;;
      -*) ;;
      *) tarea="$*"; break ;;
    esac
    shift
  done
  ts="$(date +%Y%m%d-%H%M%S)-$$"
  if [[ -n "$estado_falso" ]]; then
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$ts" "$proyecto" "${tarea//[$'\t\n']/ }" "$modelo" "$effort" "$sigue" "$(date +%s)" >>"$estado_falso/lanzados.tsv"
    printf '{"version":1,"ts":%s,"tipo":"inicio","id":"%s","proyecto":"%s"}\n' "$(date +%s)" "$ts" "$proyecto" >>"$estado_falso/eventos.jsonl"
  fi
  echo "pa: '$proyecto' lanzado en background en el puesto 1 (id: $ts, log: /tmp/pa-falso-$ts.log)."
  echo "pa: para esperarlo: pa --esperar '$proyecto' --id $ts"
fi
