#!/usr/bin/env bash
# latido.sh <archivo-heartbeat> <pre|post> — hook de PreToolUse/PostToolUse para los workers de `pa`.
#
# Dos trabajos en un solo hook:
#
# 1. LATIDO. El JSON de un worker headless recién existe cuando termina, así que desde afuera no
#    se puede distinguir "está compilando hace 4 minutos" de "se colgó hace 22". Antes eso se
#    adivinaba leyendo el transcript jsonl con tail+jq; era frágil (había que ADIVINAR qué archivo
#    estaba escribiendo) y no decía la edad del último paso. Este hook escribe una línea por evento
#    en un archivo chico que `workers` lee sin abrir el transcript.
#    `envuelo=1` lo escribe PreToolUse (la herramienta arranca), `envuelo=0` PostToolUse (terminó).
#    Con eso `workers` dice "Bash 'cargo test' en curso hace 4m" o "sin eventos hace 22m, nada en
#    vuelo" — que es el caso colgado.
#
# 2. GUARDIA DE GIT. `git stash` y `git add -A` dentro de un worker se comen el trabajo sin
#    commitear de OTRA sesión que esté tocando el mismo repo: el worker stashea para aislarse, lo
#    matás en el medio, y el trabajo ajeno queda en el stash, invisible en el working tree y sin
#    que nada falle. Era un consejo en el SKILL; acá es código. exit 2 = bloquear + devolverle el
#    motivo al modelo.
#
# El archivo de heartbeat y la fase vienen por argumento (no por env): el JSON de --settings que
# arma `pa` los tiene horneados, así que el hook no depende de que el env llegue hasta el hook.
set -uo pipefail

hb="${1:-}"
fase="${2:-pre}"
modo="${3:-}"      # "leer" en los workers de `pa --leer`
entrada="$(cat)"

# Nombre del dueño: TRAMA_DUENO -> `dueno` de perfil.json -> $USER con mayúscula inicial -> "el usuario".
# Sólo se llama al armar un mensaje de bloqueo (el hook corre en cada herramienta: nada de forks antes).
nombre_dueno() {
  local n="${TRAMA_DUENO:-}" p u
  if [[ -z "$n" ]]; then
    p="${TRAMA_PERFIL:-${XDG_CONFIG_HOME:-$HOME/.config}/trama/perfil.json}"
    [[ -r "$p" ]] && n="$(jq -r '.dueno // empty' "$p" 2>/dev/null)"
  fi
  if [[ -z "$n" ]]; then u="${USER:-$(id -un 2>/dev/null)}"; [[ -n "$u" ]] && n="${u^}"; fi
  printf '%s' "${n:-el usuario}"
}

# 3. GUARDIA DE --leer. `pa --leer` le da Bash al worker SÓLO para git de lectura: sin Bash no hay
#    `git log/diff/show`, los objetos de git están comprimidos, y Read/Grep no los tocan (el
#    2026-09-14 tres auditorías de rama volvieron diciendo que no pudieron hacer nada). Es una
#    ALLOWLIST: lo que no está acá se bloquea, incluido todo lo que no se reconoce. Una denylist
#    reabría la puerta trasera de escritura que --leer existe para cerrar.
git_de_lectura() {   # $1 = comando; 0 sólo si es git de lectura, con pipes opcionales a filtros
  local c="$1" seg sub a primero=1 i
  local -a segs t resto
  [[ -n "$c" && "$c" != *$'\n'* && "$c" != *'||'* && "$c" != *'$('* ]] || return 1
  # nada de encadenar, redirigir ni sustituir. Sobre-bloquea un `;` entre comillas: aceptable.
  [[ "$c" =~ [\;\&\<\>\`] ]] && return 1
  IFS='|' read -ra segs <<<"$c"
  (( ${#segs[@]} )) || return 1
  for seg in "${segs[@]}"; do
    read -ra t <<<"$seg"
    (( ${#t[@]} )) || return 1
    if (( ! primero )); then
      # sort -o y uniq <in> <out> escriben; sed tiene `w`. Quedan los que no pueden escribir.
      case "${t[0]}" in head|tail|grep|wc|cut) continue ;; *) return 1 ;; esac
    fi
    primero=0
    [[ "${t[0]}" == git ]] || return 1
    i=1
    while [[ "${t[$i]:-}" == -C || "${t[$i]:-}" == --no-pager ]]; do
      [[ "${t[$i]}" == -C ]] && i=$((i+2)) || i=$((i+1))
    done
    sub="${t[$i]:-}"
    resto=( "${t[@]:$((i+1))}" )
    for a in "${resto[@]}"; do
      # --output escribe un archivo; -O abre un pager (ejecuta); --ext-diff corre un programa.
      [[ "$a" == --output* || "$a" == -O* || "$a" == --open-files-in-pager* || "$a" == --ext-diff ]] && return 1
    done
    case "$sub" in
      log|diff|show|status|rev-list|rev-parse|merge-base|ls-files|ls-tree|blame|shortlog|describe|cat-file|grep) ;;
      worktree) [[ "${resto[0]:-}" == list ]] || return 1 ;;
      stash)    [[ "${resto[0]:-}" == list || "${resto[0]:-}" == show ]] || return 1 ;;
      branch)
        # Sin argumentos lista. Con argumentos, sólo en modo lista (git crea una rama con un nombre
        # suelto) y sin ningún flag que borre, mueva, copie o toque el upstream.
        local lista=0
        (( ${#resto[@]} )) || lista=1
        for a in "${resto[@]}"; do
          case "$a" in
            --delete|--move|--copy|--force|--set-upstream-to*|--unset-upstream|--edit-description|--track*|--no-track|--create-reflog) return 1 ;;
            --list|--all|--remotes|--verbose|--show-current|--merged*|--no-merged*|--contains*|--no-contains*|--points-at*) lista=1 ;;
            --*) ;;
            -*) [[ "$a" =~ [dDmMcCfut] ]] && return 1
                [[ "$a" =~ [lavr] ]] && lista=1 ;;
          esac
        done
        (( lista )) || return 1 ;;
      *) return 1 ;;
    esac
  done
  return 0
}

campo() { printf '%s' "$entrada" | jq -r "$1 // empty" 2>/dev/null; }

# Otro worker que ESCRIBE vivo en el mismo proyecto (pa corre hasta PA_PUESTOS a la vez, cada uno
# en su worktree). El .running propio sale de la ruta del heartbeat; los demás son
# `<slug>.running` / `<slug>@*.running` del mismo directorio de estado. Los --leer no cuentan.
otro_writer_vivo() {
  [[ -n "$hb" ]] || return 1
  local propio="${hb%.heartbeat}.running" st slug r pid
  st="$(dirname "$hb")"
  slug="$(sed -n 's/^proyecto=//p' "$propio" 2>/dev/null | head -1)"
  [[ -n "$slug" ]] || return 1
  for r in "$st/$slug.running" "$st/$slug"@*.running; do
    [[ -f "$r" && "$r" != "$propio" ]] || continue
    [[ "$(sed -n 's/^leer=//p' "$r" | head -1)" == 1 ]] && continue
    pid="$(sed -n 's/^pid=//p' "$r" | head -1)"; [[ -n "$pid" ]] || pid="$(sed -n 's/^pa_pid=//p' "$r" | head -1)"
    [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null && return 0
  done
  return 1
}

herramienta="$(campo '.tool_name')"
cmd="$(campo '.tool_input.command')"
desc="$(campo '.tool_input.description')"
[[ -z "$desc" ]] && desc="$cmd"
[[ -z "$desc" ]] && desc="$(campo '.tool_input.file_path')"
[[ -z "$desc" ]] && desc="$(campo '.tool_input.pattern')"
bg="$(campo '.tool_input.run_in_background')"

# --- latido -------------------------------------------------------------------------------
# Va ANTES de las guardias: si una guardia bloquea, igual queremos que el .heartbeat diga qué
# intentó el worker. Antes salía con exit 2 sin escribirlo y `workers` mostraba la herramienta
# anterior, que es justo el estado que hay que poder mirar cuando algo se traba.
if [[ -n "$hb" ]]; then
  envuelo=0; [[ "$fase" == "pre" ]] && envuelo=1
  # Una línea por campo, como el .running: lo lee `sed -n 's/^campo=//p'` sin jq.
  {
    printf 'epoch=%s\n'   "$(date +%s)"
    printf 'tool=%s\n'    "${herramienta:-?}"
    printf 'envuelo=%s\n' "$envuelo"
    printf 'desc=%s\n'    "$(printf '%s' "${desc:-}" | tr '\n\r\t' '   ' | cut -c1-160)"
  } >"$hb.tmp" 2>/dev/null && mv -f "$hb.tmp" "$hb" 2>/dev/null
fi

# --- guardia de --leer (va antes que las otras: acá todo lo que no es git de lectura muere) ---
if [[ "$modo" == "leer" && "$fase" == "pre" && "$herramienta" == "Bash" ]] && ! git_de_lectura "$cmd"; then
  echo "BLOQUEADO: estás en modo LECTURA (pa --leer). Bash sólo acepta git de lectura: log, diff, show, status, rev-list, rev-parse, merge-base, ls-files, ls-tree, blame, shortlog, describe, cat-file, grep, branch --list, worktree list, stash list/show. Usá 'git -C <ruta>' en vez de cd, y como mucho un pipe a head/tail/grep/wc/cut. Nada de ;, &&, redirecciones, \$(...) ni otros comandos. Para leer archivos usá Read/Grep/Glob." >&2
  exit 2
fi

# --- guardia de git (sólo antes de ejecutar, y sólo sobre Bash) --------------------------
if [[ "$fase" == "pre" && "$herramienta" == "Bash" && -n "$cmd" ]]; then
  # `run_in_background: true` es lo que mató dos corridas (BUGS.md bug 1: 2026-09-09 con 122
  # turnos, 2026-09-12 con 85 turnos / 22 min / US$2,93, las dos sin commitear nada). En un
  # worker `-p` NADIE re-invoca al modelo cuando el background termina, así que se pone a
  # pollear el archivo de salida y cada vuelta es un turno hasta que se le acaban. Era un
  # consejo en el CONTRATO y falló las dos veces; acá es código.
  if [[ "$bg" == "true" ]]; then
    echo "BLOQUEADO: nada de run_in_background en un worker headless. Cuando el comando termina no hay nadie que te despierte: te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear. Corrélo en FOREGROUND pasándole al tool Bash su parámetro 'timeout' en MILISEGUNDOS (máximo 600000 = 10 min). OJO: 'timeout 540 <cmd>' del SHELL no sirve, el tool corta igual a los 120s por default. Si el comando no cabe en 10 min, acotálo (un test, un paquete) o commiteá lo que tengas y decí en DECISION que no cabe en una corrida." >&2
    exit 2
  fi
  # Build de release / install: pisa el target compartido (CARGO_TARGET_DIR al tree principal) y,
  # en un proyecto Rust, target/release es el binario que usa el dueño. Va ANTES de la guardia de timeout: si no,
  # el worker se come primero "falta timeout", lo agrega y recién ahí lo bloquean (dos turnos).
  # Excepción: `--aca`/`--sucio-mio` corren en el tree principal, donde compilar ES el build del jefe
  # (heartbeat `<slug>@aca.heartbeat`). Cualquier `cargo <sub>` con `--release`/`-r`/`--profile release`
  # se bloquea (hasta `cargo test --release`: los tests de integración dejan el binario en
  # target/release); el build debug pasa. Es un AVISO TEMPRANO, no un candado: no ve lo que corre
  # adentro de un script de package.json (`npm run release` que llama a tauri build). La protección
  # real es que ese proyecto se instala como copia con su propio instalador.
  if [[ "$hb" != *@aca.heartbeat ]] \
     && { [[ "$cmd" =~ (^|[;\&\|[:space:]])tauri[[:space:]]+(--[[:space:]]+)?build([[:space:]]|$) ]] \
       || [[ "$cmd" =~ (^|[;\&\|[:space:]])cargo[[:space:]]+([^;\&\|]*[[:space:]])?(--release|-r|--profile[=[:space:]]+release)([[:space:]]|$) ]] \
       || [[ "$cmd" =~ (^|[;\&\|[:space:]])cargo[[:space:]]+([^[:space:];\&\|]+[[:space:]]+)*install([[:space:]]|$) ]]; }; then
    echo "BLOQUEADO: build de release en un worker: pisa el target compartido (y el binario que usa $(nombre_dueno)). El build lo hace el jefe después de integrar. Probá con cargo test/check o build debug; si de verdad hace falta release, decilo en DECISION." >&2
    exit 2
  fi
  # El otro camino al mismo desastre, y el que mató la corrida 110516: el modelo NO pide
  # background, pero manda `timeout 300 cargo test` SIN el parámetro `timeout` del tool, el
  # harness corta a los 120s y lo manda a background él solo ("moved to the background"). A
  # partir de ahí el modelo pollea con `sleep 1`, `echo waiting`, `jobs` — todos comandos que
  # ninguna guardia bloquea — hasta que se queda sin turnos. Así que a los comandos que
  # sabemos largos se les exige el parámetro por adelantado. Un deny cuesta un turno; el
  # background cuesta la corrida entera.
  if [[ -z "$(campo '.tool_input.timeout')" ]] \
     && [[ "$cmd" =~ (^|[;\&\|[:space:]])(cargo[[:space:]]+(test|build|clippy|check|bench)|(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?(build|test|typecheck)|npx[[:space:]]+tsc|(go|pytest|make|gradle|mvn|tsc|vitest|jest)([[:space:]]|$)) ]]; then
    echo "BLOQUEADO: a ese comando le falta el parámetro 'timeout' del tool Bash. Sin él el tool corta a los 120s y manda el comando a BACKGROUND solo; ahí te ponés a pollear la salida, cada vuelta es un turno, y te quedás sin turnos con todo sin commitear (pasó tres veces). Relanzá el MISMO comando agregando timeout: 600000 (milisegundos, 10 min, el máximo). El 'timeout 300' del shell que escribiste no cuenta: es otro reloj." >&2
    exit 2
  fi
  # `git stash list` y `git stash show` son de sólo lectura y son justo lo que hay que correr
  # para VERIFICAR que no se stasheó nada ajeno: bloquearlas sería contraproducente.
  if [[ "$cmd" =~ (^|[;\&\|[:space:]])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*stash([[:space:]]|$) ]] \
     && ! [[ "$cmd" =~ git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*stash[[:space:]]+(list|show) ]]; then
    echo "BLOQUEADO: nada de 'git stash' en un worker. Si te matan a mitad, el trabajo sin commitear de otra sesión queda en el stash y desaparece del working tree sin que nada falle. Trabajá encima de lo que haya y commiteá archivo por archivo." >&2
    exit 2
  fi
  # `add -u` y `commit -a` son la misma clase de peligro que `add -A`: barren TODO lo
  # modificado del working tree, incluido lo que estaba tocando otra sesión.
  if [[ "$cmd" =~ (^|[;\&\|[:space:]])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*add[[:space:]]+(-A|--all|-u|--update|\.)([[:space:]]|$) ]]; then
    echo "BLOQUEADO: nada de 'git add -A/-u' ni 'git add .' en un worker: te llevás cambios de otra sesión que no son tuyos. Agregá los archivos que tocaste, uno por uno." >&2
    exit 2
  fi
  if [[ "$cmd" =~ (^|[;\&\|[:space:]])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*commit[[:space:]]+(-[A-Za-z]*a[A-Za-z]*|--all)([[:space:]]|$) ]]; then
    echo "BLOQUEADO: nada de 'git commit -a' en un worker: commitea todo lo modificado, incluido lo de otra sesión. Agregá tus archivos con git add <archivo> y commiteá sin -a." >&2
    exit 2
  fi
  # `cargo clean`, SIEMPRE: el target de un worker es el del tree principal del dueño
  # (CARGO_TARGET_DIR compartido, en un proyecto grande ~90 GB). Limpiarlo cuesta minutos de recompilado a
  # todos, y si hay otro worker compilando se lo borra abajo.
  if [[ "$cmd" =~ (^|[;\&\|[:space:]])cargo[[:space:]]+([^[:space:]]+[[:space:]]+)*clean([[:space:]]|$) ]]; then
    echo "BLOQUEADO: nada de 'cargo clean' en un worker: el target es compartido con el tree principal (y con otros workers). Si sospechás de un artefacto roto, decilo en DECISION." >&2
    exit 2
  fi
  # Instalar/sacar dependencias con OTRO worker vivo en el mismo proyecto: node_modules y .venv
  # son del tree principal (symlink en cada worktree), así que un install le cambia las
  # dependencias al otro a mitad de su build o de sus tests.
  if [[ "$cmd" =~ (^|[;\&\|[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+(install|i|add|ci|remove|rm|uninstall|un)|pip[0-9.]*[[:space:]]+install|python[0-9.]*[[:space:]]+-m[[:space:]]+pip[[:space:]]+install|uv[[:space:]]+(sync|add|remove|pip[[:space:]]+install))([[:space:]]|$) ]] \
     && otro_writer_vivo; then
    echo "BLOQUEADO: hay otro worker corriendo en este mismo proyecto y comparten node_modules/.venv (son los del tree principal). Instalar o sacar dependencias ahora se las cambia a él a mitad de camino. Si de verdad necesitás esa dependencia, decilo en DECISION y seguí con lo demás." >&2
    exit 2
  fi
  # Recorte de la salida de los TESTS (plan pro, 2026-10-02): todo lo que entra al contexto se
  # relee en cada turno que queda, y una suite verbosa son miles de líneas. El contrato le pide
  # al worker que filtre, pero eso depende de que se acuerde: acá es código. Sólo comandos que
  # EMPIEZAN con un runner de tests conocido y no traen ya pipe, redirección ni encadenado (si
  # el worker filtró a mano, se respeta). Quedan las últimas N líneas, que es donde todos los
  # runners ponen el resumen y las fallas, con un aviso de cuántas se cortaron; el exit code
  # se conserva (pipefail). PA_RECORTE lo exporta `pa`: 150 en plan pro, 0 (apagado) en max.
  recorte="${PA_RECORTE:-0}"
  if [[ "$recorte" =~ ^[1-9][0-9]*$ && "$modo" != "leer" ]] \
     && [[ "$cmd" =~ ^[[:space:]]*(cargo[[:space:]]+(test|nextest)|(npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?test|npx[[:space:]]+(vitest|jest)|vitest|jest|pytest|python[0-9.]*[[:space:]]+-m[[:space:]]+pytest|go[[:space:]]+test|make[[:space:]]+test|(\./)?tests/run\.sh)([[:space:]]|$) ]] \
     && ! [[ "$cmd" == *[\|\>\<\;\&\`]* || "$cmd" == *'$('* || "$cmd" == *$'\n'* ]]; then
    nuevo="set -o pipefail; ( $cmd ) 2>&1 | awk -v n=$recorte '{a[NR%n]=\$0} END{if(NR>n) print \"[recortado por el hook: se omitieron las primeras \" NR-n \" líneas; si te falta algo, volvé a correr filtrando con grep]\"; s=(NR>n)?NR-n+1:1; for(i=s;i<=NR;i++) print a[i%n]}'"
    printf '%s' "$entrada" | jq -c --arg c "$nuevo" '{hookSpecificOutput:{hookEventName:"PreToolUse", updatedInput:(.tool_input + {command:$c})}}'
    exit 0
  fi
fi

# --- aviso de turnos ----------------------------------------------------------------------
# No hay hook que sepa cuántos turnos le quedan al worker, así que se cuentan acá: un
# PostToolUse por herramienta, que es aproximadamente un turno. Cerca del --max-turns se le
# inyecta contexto para que cierre y reporte en vez de morir a mitad de una espera con todo
# sin commitear.
#
# VERIFICADO el 2026-09-13 sobre la corrida que murió en widgets-reactivos
# (f8b2f8bc-….jsonl): el aviso LLEGA (aparece como `hook_additional_context`, línea 322) y el
# modelo lo OBEDECE (a los dos turnos empezó a commitear con `git add -p`, separando sus hunks
# de los ajenos, y alcanzó a dejar dos commits antes de morir). No hace falta una fase más
# dura que bloquee herramientas: el aviso alcanza.
#
# Lo que sí hay que tener en cuenta: esto cuenta HERRAMIENTAS, no turnos, y una respuesta con
# varias tool calls es un turno solo. En esa misma corrida el contador llegó a 70 mientras
# `num_turns` marcaba 61, o sea que corre ADELANTE del tope real. Es el lado bueno del error
# (avisa antes, no después), pero la reserva de 5 es un piso, no un número exacto.
aviso=""

# El harness puede mandar a background un comando que el modelo pidió en foreground, y ahí la
# guardia de `pre` ya no llega: el aviso tiene que salir del RESULTADO. Sin esto el modelo se
# pone a pollear la salida y se come la corrida (110516: 13 turnos en `sleep 1` y `echo
# waiting`). No se puede bloquear un post, pero sí redirigirlo antes de que empiece a pollear.
# Se mira SÓLO el principio del .tool_response de un Bash, y con la frase entera del harness.
# Buscar "moved to the background" en todo el JSON de entrada era un falso positivo garantizado:
# un worker que hace `cat BUGS.md` (donde está documentado este bug) recibía el aviso y perdía
# un turno explicando que no había corrido nada en background. Visto el 2026-09-12.
respuesta_head=""
if [[ "$fase" == "post" && "$herramienta" == "Bash" ]]; then
  respuesta_head="$(campo '.tool_response | if type == "string" then . else tojson end' | head -c 300)"
fi
if [[ "$respuesta_head" =~ did\ not\ complete\ within\ its\ .*timeout\ and\ was\ moved\ to\ the\ background ]]; then
  aviso="AVISO DEL ORQUESTADOR: el harness mandó ese comando a background porque le faltó el parámetro 'timeout' del tool. NO lo pollees (ni sleep, ni cat de la salida, ni jobs: cada vuelta es un turno y nadie te va a despertar cuando termine). Relanzá el MISMO comando en foreground agregando timeout: 600000."
fi

if [[ "$fase" == "post" && -n "$hb" && "${PA_MAX_TURNS:-}" =~ ^[0-9]+$ ]]; then
  n=$(( $(cat "$hb.turnos" 2>/dev/null || echo 0) + 1 ))
  printf '%s' "$n" >"$hb.turnos" 2>/dev/null
  quedan=$(( PA_MAX_TURNS - n ))
  if (( quedan <= 5 && quedan >= 0 )); then
    aviso="${aviso:+$aviso }AVISO DEL ORQUESTADOR: te quedan como mucho $quedan turnos. Commiteá lo que hiciste (archivo por archivo) y respondé YA con RESULTADO/ARCHIVOS/DECISION, aunque falte algo: decilo en DECISION."
  fi
fi

# Un solo JSON: dos `jq -cn` seguidos serían dos objetos y el CLI lee el primero.
if [[ -n "$aviso" ]]; then
  jq -cn --arg a "$aviso" '{hookSpecificOutput:{hookEventName:"PostToolUse", additionalContext:$a}}'
fi

exit 0
