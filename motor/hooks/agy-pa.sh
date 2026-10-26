#!/usr/bin/env bash
# agy-pa.sh <pre|post|inv> — hooks de agy (Antigravity CLI) para los workers Gemini de `pa`.
#
# agy no entiende los hooks de Claude: los suyos viven en un plugin (agy/pa-worker, que
# instalar-producto.sh enlaza en ~/.gemini/config/plugins/pa-worker) y hablan otro JSON (camelCase,
# `toolCall.name`/`toolCall.args`, salida `{"decision":"deny","reason":…}`). Este adaptador
# traduce y llama a LAS MISMAS guardias que un worker Claude:
#
#   - destructive-guard.sh, SIEMPRE (también en el agy interactivo del usuario, igual que en Claude).
#   - latido.sh (latido, guardias de git/release/timeout, allowlist de --leer y recorte de tests),
#     sólo en un worker de pa: pa exporta PA_AGY_HB y agy le pasa el entorno al hook (verificado).
#   - además, sólo en un worker Gemini, lo que en Claude cuida el contrato o el harness:
#     allowlist de herramientas (nada de browser, MCP, subagentes, schedule, mensajes), escrituras
#     sólo adentro del worktree o de /tmp, y nada de push, cambio de rama, merge, rebase, reset
#     --hard ni worktrees.
#   - y la PRIVACIDAD (un Gemini manda lo que lee a Google): nada de leer, listar, buscar ni ejecutar
#     sobre rutas fuera del worktree (~/.ssh, ~/.config, /etc, otros proyectos, $HOME…), y nada de
#     red en run_command (curl, wget, nc, ssh, scp, git clone/fetch…).
#
# Un hook que falla (exit != 0, JSON roto, timeout) hace FALLAR la herramienta en agy (verificado
# 2026-10-18): cerrado por defecto. Sin nada que decir, PreToolUse no imprime NADA: `{}` (sin
# "decision") agy lo toma como deny, y "allow" en el agy interactivo se saltearía los permisos del
# usuario (las dos cosas verificadas con agy 1.4.2, 2026-10-18).
set -uo pipefail

fase="${1:-pre}"
aqui="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
GUARD="${PA_AGY_GUARD:-$aqui/destructive-guard.sh}"
LATIDO="${PA_AGY_LATIDO:-$aqui/latido.sh}"
entrada="$(cat)"

nada()  { exit 0; }   # PreToolUse sin opinión: salida vacía (ver arriba)
negar() { jq -cn --arg r "$1" '{decision:"deny", reason:$r}'; exit 0; }
campo() { printf '%s' "$entrada" | jq -r "$1 // empty" 2>/dev/null; }

worker=0; [[ -n "${PA_AGY_HB:-}" ]] && worker=1
herramienta="$(campo '.toolCall.name')"
cmd="$(campo '.toolCall.args.CommandLine')"

# --- PostInvocation: tope de turnos -----------------------------------------------------------
# Cada invocación del modelo es un turno. Cerca del tope, el mismo aviso que latido.sh le da a
# Claude; pasado el tope, se corta (agy no tiene --max-turns).
if [[ "$fase" == inv ]]; then
  (( worker )) || { echo '{}'; exit 0; }
  n="$(campo '.invocationNum')"
  [[ "${PA_MAX_TURNS:-}" =~ ^[1-9][0-9]*$ && "$n" =~ ^[0-9]+$ ]] || { echo '{}'; exit 0; }
  quedan=$(( PA_MAX_TURNS - n ))
  if (( quedan < 0 )); then
    jq -cn '{terminationBehavior:"terminate"}'
  elif (( quedan <= 5 )); then
    jq -cn --arg a "AVISO DEL ORQUESTADOR: te quedan como mucho $quedan turnos. Commiteá lo que hiciste (archivo por archivo) y respondé YA con RESULTADO/ARCHIVOS/DECISION, aunque falte algo: decilo en DECISION." \
      '{injectSteps:[{ephemeralMessage:$a}]}'
  else
    echo '{}'
  fi
  exit 0
fi

# El JSON que esperan los hooks de Claude. run_command es Bash; el timeout va puesto porque en agy
# no existe el corte a los 120 s que la guardia de timeout de latido.sh previene (un comando largo
# pasa a async y el modelo lo sigue con command_status, sin perder la corrida).
archivo="$(campo '.toolCall.args.TargetFile')"
[[ -z "$archivo" ]] && archivo="$(campo '.toolCall.args.AbsolutePath')"
case "$herramienta" in
  run_command) nombre=Bash ;;
  write_to_file) nombre=Write ;;
  replace_file_content|multi_replace_file_content|sed_file|notebook_edit) nombre=Edit ;;
  view_file) nombre=Read ;;
  grep_search) nombre=Grep ;;
  find_by_name|list_dir) nombre=Glob ;;
  *) nombre="$herramienta" ;;
esac
claude_json="$(jq -cn --arg t "$nombre" --arg c "$cmd" --arg f "$archivo" \
  '{tool_name:$t, tool_input:({} + (if $c != "" then {command:$c, timeout:600000} else {} end)
                                 + (if $f != "" then {file_path:$f} else {} end))}')"

if [[ "$fase" == post ]]; then
  (( worker )) && printf '%s' "$claude_json" | bash "$LATIDO" "$PA_AGY_HB" post >/dev/null 2>&1
  echo '{}'; exit 0
fi

# --- PreToolUse ------------------------------------------------------------------------------
if [[ "$herramienta" == run_command && -n "$cmd" ]]; then
  motivo="$(printf '%s' "$claude_json" | bash "$GUARD" 2>&1 >/dev/null)"
  [[ $? -eq 2 ]] && negar "${motivo:-BLOQUEADO por destructive-guard.}"
fi
(( worker )) || nada

leer=0; [[ "${PA_AGY_MODO:-}" == leer ]] && leer=1

# Allowlist de herramientas: lo que no está acá no corre. Afuera quedan el navegador (es el del
# usuario), call_mcp_tool (Claude corre sin MCP por default), subagentes (el worker no delega),
# schedule/run_workflow, send_message/manage_inbox, ask_* (headless: nadie contesta),
# generate_image, delete_knowledge, el marketplace y la red (read_url_content, search_web: una URL
# es una vía para sacar datos; sólo sale a la red lo que agy necesita para hablar con el modelo).
lectura='view_file|list_dir|find_by_name|grep_search|run_command|command_status|wait|wait_5_seconds|finish'
escritura='write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit|send_command_input|manage_task'
if (( leer )); then
  [[ "$herramienta" =~ ^($lectura)$ ]] \
    || negar "BLOQUEADO: estás en modo LECTURA (pa --leer): '$herramienta' no está permitida. Para leer: view_file, list_dir, find_by_name, grep_search, y run_command sólo con git de lectura."
else
  [[ "$herramienta" =~ ^($lectura|$escritura)$ ]] \
    || negar "BLOQUEADO: '$herramienta' no está permitida en un worker de pa (ni navegador, ni MCP, ni subagentes, ni mensajes, ni tareas programadas). Hacé el trabajo con los archivos y la terminal; si de verdad hace falta, decilo en DECISION."
fi

# --- Privacidad: nada de leer fuera del worktree ni de salir a la red -------------------------
# Lo que un Gemini lee viaja a Google. Todo path que salga del worktree (y de /tmp y su archivo del
# mapa) se niega, también para leer, listar, buscar y ejecutar; y no hay red en run_command. El
# chequeo es LÉXICO (ve las rutas escritas en el comando, no lo que un intérprete arme por dentro):
# es una barrera, no una jaula; los otros candados son la lista blanca de proyectos y el filtro de
# secretos de bin/pa.
raiz_n="$(realpath -ms -- "${PA_AGY_RAIZ:-/nonexistent}")"
home_n="$(realpath -ms -- "$HOME")"
raices_prohibidas=("$home_n" /home /root /etc /var /mnt /media /run /srv /boot /sys /proc /opt /dev)
dentro() { [[ "$1" == "$2" || "$1" == "$2"/* ]]; }
permitida() {   # $1 = path normalizado
  dentro "$1" "$raiz_n" && return 0
  [[ "$1" == /tmp || "$1" == /tmp/* ]] && return 0
  [[ -n "${PA_AGY_MAPA:-}" && "$1" == "$(realpath -ms -- "$PA_AGY_MAPA")" ]] && return 0
  case "$1" in /dev/null|/dev/zero|/dev/stdin|/dev/stdout|/dev/stderr|/dev/urandom|/dev/random) return 0 ;; esac
  return 1
}
prohibida() {   # $1 = path normalizado (sin glob)
  local r
  permitida "$1" && return 1
  [[ "$1" == / ]] && return 0
  for r in "${raices_prohibidas[@]}"; do dentro "$1" "$r" && return 0; done
  return 1
}
# $1 = token tal como lo escribió el modelo, $2 = cwd. Devuelve 0 si toca algo fuera del worktree.
token_sale() {
  local t="$1" cwd="$2" p r pre
  t="${t//\$\{HOME\}/\$HOME}"
  case "$t" in
    '~'|'~/'*) t="$HOME${t#\~}" ;;
    '~'*) return 0 ;;                                   # ~otro_usuario
    '$HOME'|'$HOME/'*) t="$HOME${t#\$HOME}" ;;
    '$XDG_'*|'$PA_'*|'$OLDPWD'*) return 0 ;;
    '$PWD'|'$PWD/'*) t="$cwd${t#\$PWD}" ;;
    '$TMPDIR'|'$TMPDIR/'*) return 1 ;;
    '$'[A-Za-z_]*/*) return 0 ;;                        # $LO_QUE_SEA/… : no se sabe adónde apunta
  esac
  if [[ "$t" == /* ]]; then
    # con glob: se mira el tramo fijo; si algún prohibido empieza igual, se niega
    if [[ "$t" == *[\*\?]* ]]; then
      pre="${t%%[\*\?]*}"
      dentro "${pre%/}" "$raiz_n" && return 1
      [[ "$pre" == /tmp/* ]] && return 1
      for r in "${raices_prohibidas[@]}" /; do
        [[ "$r/" == "$pre"* || "$pre" == "$r"/* || "$pre" == "$r" ]] && return 0
      done
      return 1
    fi
    p="$t"
  elif [[ "/$t/" == *"/../"* ]]; then
    p="$cwd/$t"
  else
    return 1
  fi
  p="$(realpath -ms -- "$p")"
  prohibida "$p"
}
# Todo token de un texto de comando que salga del worktree -> lo imprime (y devuelve 0).
comando_sale() {   # $1 = comando, $2 = cwd
  local c="$1" cwd="$2" tok
  # el mensaje de un commit puede nombrar rutas sin leerlas; sólo si no ejecuta nada adentro
  c="$(sed -E "s/(-m|--message)[[:space:]=]+(\"[^\"\$\`]*\"|'[^']*')/ /g" <<<"$c")"
  c="${c//\$\{HOME\}/\$HOME}"
  while IFS= read -r tok; do
    [[ -n "$tok" ]] || continue
    token_sale "$tok" "$cwd" && { printf '%s' "$tok"; return 0; }
  done < <(tr -s ' \t\n;|&<>()"'"'"'`=:,{}[]' '\n' <<<"$c")
  return 1
}
if (( worker )); then
  cwd_pedido="$(campo '.toolCall.args.Cwd')"; cwd_pedido="${cwd_pedido#\"}"; cwd_pedido="${cwd_pedido%\"}"
  cwd="$raiz_n"
  msg_fuera() { echo "BLOQUEADO (privacidad): '$1' está fuera de tu worktree (${PA_AGY_RAIZ:-?}). Un worker Gemini no lee, lista, busca ni ejecuta nada fuera de su worktree (ni ~/.ssh, ~/.config, ~/.gemini, ~/.claude, /etc, otros proyectos, \$HOME): lo que lee viaja a Google. Si hace falta, decilo en DECISION."; }
  if [[ -n "$cwd_pedido" ]]; then
    if [[ "$cwd_pedido" == /* || "$cwd_pedido" == '~'* || "$cwd_pedido" == '$'* || "/$cwd_pedido/" == *"/../"* ]]; then
      token_sale "$cwd_pedido" "$raiz_n" && negar "$(msg_fuera "$cwd_pedido")"
    fi
    [[ "$cwd_pedido" == /* ]] && cwd="$(realpath -ms -- "$cwd_pedido")"
  fi
  case "$herramienta" in
    view_file|list_dir|find_by_name|grep_search|sed_file|notebook_edit|write_to_file|replace_file_content|multi_replace_file_content)
      while IFS= read -r v; do
        v="${v#\"}"; v="${v%\"}"
        [[ -n "$v" ]] || continue
        if [[ "$v" == /* || "$v" == '~'* || "$v" == '$'* || "/$v/" == *"/../"* ]]; then
          token_sale "$v" "$cwd" && negar "$(msg_fuera "$v")"
        fi
      done < <(printf '%s' "$entrada" | jq -r '.toolCall.args | to_entries[] | select(.key | test("(Path|Dir|Directory|File)$"; "i")) | .value | strings' 2>/dev/null) ;;
    send_command_input)
      texto="$(printf '%s' "$entrada" | jq -r '.toolCall.args | [.[] | strings] | join(" ")' 2>/dev/null)"
      t="$(comando_sale "$texto" "$cwd")" && negar "$(msg_fuera "$t")" ;;
  esac
  if [[ "$herramienta" == run_command && -n "$cmd" ]]; then
    t="$(comando_sale "$cmd" "$cwd")" && negar "$(msg_fuera "$t")"
    # cd sin argumento (o a -) lleva a $HOME
    re_cd='(^|[;&|(])[[:space:]]*(cd|pushd)[[:space:]]*($|[;&|)]|[[:space:]]-([[:space:]]|$))'
    if [[ "$cmd" =~ $re_cd ]]; then
      negar "BLOQUEADO (privacidad): 'cd'/'pushd' sin ruta (o a '-') te saca del worktree (${PA_AGY_RAIZ:-?}). Quedate adentro."
    fi
    re_eval='(^|[^[:alnum:]_])eval[[:space:]]'
    if [[ "$cmd" =~ $re_eval ]]; then
      negar "BLOQUEADO (privacidad): 'eval' no va en un worker Gemini: arma comandos que el guard no puede leer."
    fi
    # red: sólo lo que agy necesita para hablar con el modelo; nada de run_command
    pre_cmd='(sudo|env|command|exec|nohup|time|xargs|timeout[[:space:]]+[0-9.]+[smhd]?)[[:space:]]+'
    red='(curl|wget|nc|ncat|netcat|socat|ssh|scp|sftp|rsync|ftp|tftp|telnet|lftp|aria2c|nmap|ssh-keyscan|gh|glab|aws|gcloud|gsutil|mail|sendmail|msmtp|mutt)'
    re_red='(^|[;&|(`]|\$\(|-c[[:space:]]+["'"'"'])[[:space:]]*('"$pre_cmd"')*([^[:space:];&|]*/)?'"$red"'([[:space:]"'"'"']|$)'
    if [[ "$cmd" =~ $re_red ]] || [[ "$cmd" == */dev/tcp/* || "$cmd" == */dev/udp/* ]]; then
      negar "BLOQUEADO (privacidad): sin red en un worker Gemini (curl, wget, nc, ssh, scp, rsync, gh…): lo que sale de la máquina sale a un tercero. Sólo habla con el modelo la propia agy."
    fi
    gr='(^|[;&|[:space:](])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*'
    re_git="${gr}(clone|fetch|pull|ls-remote|submodule|remote[[:space:]]+(add|set-url))([[:space:]]|\$)"
    re_pub='(^|[^[:alnum:]_-])(npm|pnpm|yarn|cargo|twine)[[:space:]]+(publish|upload)([[:space:]]|$)'
    if [[ "$cmd" =~ $re_git ]] || [[ "$cmd" =~ $re_pub ]]; then
      negar "BLOQUEADO (privacidad): sin red en un worker Gemini (git clone/fetch/pull/ls-remote, publish…). El repo ya está en tu worktree."
    fi
  fi
fi

# Escrituras: sólo adentro del worktree (o del tree, con --aca), /tmp y el archivo del mapa.
if [[ "$nombre" == Write || "$nombre" == Edit ]]; then
  raiz="${PA_AGY_RAIZ:-}"
  [[ -n "$archivo" ]] || negar "BLOQUEADO: no se pudo saber qué archivo escribe '$herramienta'."
  real="$(realpath -m -- "$archivo" 2>/dev/null)"
  ok=0
  [[ -n "$raiz" && ( "$real" == "$(realpath -m -- "$raiz")" || "$real" == "$(realpath -m -- "$raiz")"/* ) ]] && ok=1
  [[ "$real" == /tmp/* ]] && ok=1
  [[ -n "${PA_AGY_MAPA:-}" && "$real" == "$(realpath -m -- "$PA_AGY_MAPA")" ]] && ok=1
  (( ok )) || negar "BLOQUEADO: '$archivo' está fuera de tu worktree ($raiz). Un worker escribe sólo ahí (y en /tmp); el tree principal y el resto de la máquina los toca el jefe."
fi

if [[ "$herramienta" == run_command && -n "$cmd" ]]; then
  # Guardia de git que en Claude es sólo contrato: acá no hay forma de saber si el modelo la leyó.
  g='(^|[;&|[:space:](])git[[:space:]]+((-C[[:space:]]+[^[:space:]]+|-c[[:space:]]+[^[:space:]]+|-[^[:space:]]+)[[:space:]]+)*'
  if [[ "$cmd" =~ ${g}push([[:space:]]|$) ]]; then
    negar "BLOQUEADO: nada de 'git push' en un worker. La rama la integra el jefe y main se empuja solo al remoto."
  fi
  if [[ "$cmd" =~ ${g}(switch|merge|cherry-pick|update-ref|filter-branch|replace)([[:space:]]|$) ]] \
     || { [[ "$cmd" =~ ${g}checkout([[:space:]]|$) ]] && [[ "$cmd" != *" -- "* ]]; } \
     || [[ "$cmd" =~ ${g}reset[[:space:]]+([^;&|]*[[:space:]])?--hard ]] \
     || [[ "$cmd" =~ ${g}branch[[:space:]]+([^;&|]*[[:space:]])?(-[a-zA-Z]*[dDmMcCf][a-zA-Z]*|--delete|--move|--copy|--force)([[:space:]]|$) ]] \
     || [[ "$cmd" =~ ${g}worktree[[:space:]]+(add|remove|move|prune|repair|lock|unlock)([[:space:]]|$) ]] \
     || { [[ "$cmd" =~ ${g}rebase([[:space:]]|$) ]] && [[ "${PA_AGY_REBASE:-0}" != 1 ]]; }; then
    negar "BLOQUEADO: no cambies de rama, no mergees, no rebasees, no borres ramas, no toques worktrees ni hagas reset --hard: estás en la rama ${PA_AGY_RAMA:-de tu worktree} y la integra el jefe. Para descartar un cambio tuyo de un archivo: git checkout -- <archivo>."
  fi
  ppal="${PA_AGY_PPAL:-}"
  if [[ -n "$ppal" && "$ppal" != "${PA_AGY_RAIZ:-}" ]]; then
    for pre in "cd " "pushd " "-C "; do
      for q in "" '"' "'"; do
        [[ "$cmd" == *"$pre$q$ppal"* ]] && ppal_tocado=1
      done
    done
  fi
  if [[ -n "${ppal_tocado:-}" ]]; then
    negar "BLOQUEADO: '$ppal' es el tree principal del proyecto: no se toca desde un worker. Trabajá en tu worktree (${PA_AGY_RAIZ:-})."
  fi
fi

# latido.sh: el latido, y todas las guardias de un worker Claude (stash, add -A, commit -a,
# release, cargo clean, dependencias con otro writer, allowlist de --leer, recorte de tests).
modo=""; (( leer )) && modo=leer
# stderr de latido.sh en un temporal propio (mktemp): un /tmp/agy-pa.$$.err predecible se podía pre-crear como symlink
err_lat="$(mktemp "${TMPDIR:-/tmp}/agy-pa.XXXXXX" 2>/dev/null || true)"
salida="$(printf '%s' "$claude_json" | bash "$LATIDO" "$PA_AGY_HB" pre $modo 2>"${err_lat:-/dev/null}")"; rc=$?
motivo=""; [[ -n "$err_lat" ]] && { motivo="$(cat "$err_lat" 2>/dev/null)"; rm -f "$err_lat"; }
(( rc == 2 )) && negar "${motivo:-BLOQUEADO por latido.sh.}"
nuevo="$(printf '%s' "$salida" | jq -r '.hookSpecificOutput.updatedInput.command // empty' 2>/dev/null)"
if [[ -n "$nuevo" && "$herramienta" == run_command ]]; then
  jq -cn --arg c "$nuevo" '{decision:"allow", overwrite:{CommandLine:$c}}'
  exit 0
fi
nada
