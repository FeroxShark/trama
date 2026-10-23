#!/usr/bin/env bash
# instalar-producto.sh — deja Trama + pa/tablero andando en una máquina limpia (Ubuntu/WSL2, Debian, otra
# distro con systemd de usuario). Es el instalador del PRODUCTO; el de desarrollo (scripts/instalar.sh) no entra en el árbol público.
#
#   instalar-producto.sh [--fuente DIR] [--app DIR]     instalación de usuario (sin sudo)
#   instalar-producto.sh --solo-apt [--usuario U]       sólo los paquetes del sistema (root); lo llama la carcasa con `wsl -u root`
#
# Idempotente (correrlo dos veces no rompe ni duplica) y sale 0 aunque algo de red falle: lo que no pudo hacer
# sale como AVISO y `trama-estado --json` dice qué quedó. Sale 2 sólo por uso o por una fuente rota.
#
#   --fuente DIR   árbol de `trama-exportar` (motor/ + app/), o el repo del orquestador (bin/, hooks/, skills/…)
#                  (default: el árbol del propio script)
#   --app DIR      la app hilos con dist-electron/ (default: DIR/app de la fuente, o $TRAMA_APP)
#
# Qué hace (usuario normal): node LTS en ~/.local si falta · `claude` y `agy` por sus instaladores oficiales si
# faltan · symlinks en ~/.local/bin (pa, tablero, trama-estado, trama-motor, proyecto-ruta, workers) · hooks en
# ~/.claude/hooks y la skill trama-orquestar · destructive-guard (PreToolUse) y statusline-espejo registrados en
# ~/.claude/settings.json SIN pisar lo que hay · ~/CLAUDE.md y ~/GEMINI.md si no existen · ~/.config/trama/app ·
# registry.json vacío si falta · unit de usuario trama-motor.service (node <app>/dist-electron/motor.js, TRAMA_LOCAL=1).
# Si corre como root también hace el paso apt (y entonces instala TODO para root: sirve para contenedores).
# Nada de timers ni de repos remotos.
# Entorno (pruebas): TRAMA_INSTALAR_CLI=0 no baja claude/agy · TRAMA_NODE_MAJOR (mínimo, default 22).
set -uo pipefail

FUENTE="" APP="" SOLO_APT=0 USUARIO=""
while (( $# )); do
  case "$1" in
    --fuente)   FUENTE="${2:-}"; shift 2 || { echo "uso: --fuente DIR" >&2; exit 2; } ;;
    --app)      APP="${2:-}"; shift 2 || { echo "uso: --app DIR" >&2; exit 2; } ;;
    --solo-apt) SOLO_APT=1; shift ;;
    --usuario)  USUARIO="${2:-}"; shift 2 || { echo "uso: --usuario U" >&2; exit 2; } ;;
    -h|--help)  sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "uso: instalar-producto.sh [--fuente DIR] [--app DIR] | --solo-apt [--usuario U]" >&2; exit 2 ;;
  esac
done

aviso() { echo "AVISO  $*" >&2; }
ok()    { echo "ok     $*"; }
hecho() { echo "hecho  $*"; }

# --- paso apt (root) -------------------------------------------------------------------------------------
paquetes_apt() {
  command -v apt-get >/dev/null 2>&1 || { aviso "no hay apt-get: instalá a mano git, jq, curl, python3, gawk, flock (util-linux) y xz"; return; }
  export DEBIAN_FRONTEND=noninteractive
  local falta=() p
  for p in git jq curl ca-certificates python3 gawk util-linux xz-utils procps uuid-runtime; do
    dpkg -s "$p" >/dev/null 2>&1 || falta+=("$p")
  done
  if (( ${#falta[@]} )); then
    apt-get update -qq >/dev/null 2>&1 || aviso "apt-get update falló (¿sin red?)"
    apt-get install -y -qq --no-install-recommends "${falta[@]}" >/dev/null 2>&1 \
      && hecho "apt: ${falta[*]}" || aviso "apt-get install ${falta[*]} falló"
  else
    ok "apt: paquetes ya instalados"
  fi
  # WSL2: systemd de usuario es lo que mantiene vivo al motor. Sin él, trama-motor start lo lanza suelto.
  if grep -qi microsoft /proc/version 2>/dev/null; then
    if ! grep -Eqi '^\s*systemd\s*=\s*true' /etc/wsl.conf 2>/dev/null; then
      printf '\n[boot]\nsystemd=true\n' >>/etc/wsl.conf
      hecho "/etc/wsl.conf: systemd=true (hay que reiniciar WSL: 'wsl --shutdown' desde Windows)"
    else
      ok "/etc/wsl.conf: systemd=true"
    fi
  fi
  if [[ -n "$USUARIO" ]] && command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$USUARIO" >/dev/null 2>&1 && ok "linger de $USUARIO" || aviso "loginctl enable-linger $USUARIO falló (sin systemd todavía)"
  fi
}

if (( SOLO_APT )); then
  (( EUID == 0 )) || { echo "instalar-producto.sh: --solo-apt hay que correrlo como root (wsl -u root …)" >&2; exit 2; }
  paquetes_apt
  exit 0
fi
(( EUID == 0 )) && paquetes_apt

# --- fuente ----------------------------------------------------------------------------------------------
AQUI="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd -P)"
[[ -n "$FUENTE" ]] || FUENTE="$AQUI"
FUENTE="$(cd "$FUENTE" 2>/dev/null && pwd -P)" || { echo "instalar-producto.sh: no existe la fuente '$FUENTE'" >&2; exit 2; }
# El árbol exportado es <fuente>/{motor,app}; el repo del orquestador es la fuente misma. Desde motor/scripts/ el
# script se encuentra a sí mismo en <fuente>/motor.
if   [[ -x "$FUENTE/motor/bin/pa" ]]; then MOTOR="$FUENTE/motor"; [[ -n "$APP" ]] || APP="$FUENTE/app"
elif [[ -x "$FUENTE/bin/pa" ]];       then MOTOR="$FUENTE"
  [[ -n "$APP" ]] || { [[ -f "$(dirname "$FUENTE")/app/dist-electron/motor.js" ]] && APP="$(dirname "$FUENTE")/app"; }
else echo "instalar-producto.sh: '$FUENTE' no tiene bin/pa ni motor/bin/pa" >&2; exit 2; fi
[[ -n "$APP" ]] || APP="${TRAMA_APP:-}"
[[ -z "$APP" ]] || APP="$(cd "$APP" 2>/dev/null && pwd -P || echo "$APP")"
# Dentro de un worktree de pa los enlaces se romperían cuando se lo borre: sólo pasa por error.
if [[ "$MOTOR" == */pa/worktrees/* ]]; then aviso "la fuente $MOTOR es un worktree de pa: los enlaces quedan ahí"; fi

BIN="$HOME/.local/bin"
HOOKS="$HOME/.claude/hooks"
SKILLS="$HOME/.claude/skills"
CONF="${XDG_CONFIG_HOME:-$HOME/.config}/trama"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
mal=0
mkdir -p "$BIN" "$HOOKS" "$SKILLS" "$CONF" "$UNITS"
export PATH="$BIN:$PATH"

# enlazar <origen absoluto> <carpeta destino> [nombre]
enlazar() {
  local origen="$1" ruta="$2/${3:-$(basename "$1")}"
  if [[ ! -e "$origen" ]]; then aviso "falta $origen"; mal=1; return; fi
  if [[ -e "$ruta" && ! -L "$ruta" ]]; then aviso "no toco $ruta (no es un symlink; movelo a mano)"; mal=1; return; fi
  if [[ -L "$ruta" && "$(readlink -f "$ruta")" == "$(readlink -f "$origen")" ]]; then ok "$ruta"; return; fi
  ln -sfn "$origen" "$ruta" && hecho "enlace $ruta -> $origen"
}

# --- node LTS --------------------------------------------------------------------------------------------
MIN_NODE="${TRAMA_NODE_MAJOR:-22}"
major_node() { command -v node >/dev/null 2>&1 && node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
instalar_node() {
  local arq ver base tmp
  case "$(uname -m)" in x86_64|amd64) arq=x64 ;; aarch64|arm64) arq=arm64 ;; *) aviso "node: arquitectura $(uname -m) sin build oficial"; return ;; esac
  command -v curl >/dev/null 2>&1 && command -v xz >/dev/null 2>&1 || { aviso "node: faltan curl o xz (corré el paso apt: instalar-producto.sh --solo-apt)"; return; }
  ver="$(curl -fsSL --max-time 30 https://nodejs.org/dist/index.json 2>/dev/null \
        | python3 -c 'import json,sys; print(next(r["version"] for r in json.load(sys.stdin) if r["lts"]))' 2>/dev/null)"
  [[ "$ver" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { aviso "node: no pude averiguar la versión LTS (¿sin red?)"; return; }
  base="$HOME/.local/lib/node-$ver-linux-$arq"
  if [[ ! -x "$base/bin/node" ]]; then
    tmp="$(mktemp -d)"
    if curl -fsSL --max-time 300 "https://nodejs.org/dist/$ver/node-$ver-linux-$arq.tar.xz" | tar -xJ -C "$tmp" 2>/dev/null; then
      mkdir -p "$HOME/.local/lib"; rm -rf "$base"; mv "$tmp/node-$ver-linux-$arq" "$base"
    else aviso "node: la descarga de $ver falló"; rm -rf "$tmp"; return; fi
    rm -rf "$tmp"
  fi
  local b; for b in node npm npx; do ln -sfn "$base/bin/$b" "$BIN/$b"; done
  hecho "node $ver en $base (enlazado en $BIN)"
}
if (( "$(major_node)" >= MIN_NODE )); then ok "node $(node -v)"
else instalar_node; fi
NODE="$(command -v node 2>/dev/null || true)"
if [[ -z "$NODE" ]] || (( "$(major_node)" < MIN_NODE )); then aviso "node >= $MIN_NODE no disponible: el motor no va a arrancar"; NODE=""; fi

# --- claude y agy (instaladores oficiales, sin sudo) -----------------------------------------------------
bajar_cli() {   # <binario> <url> <nombre>
  command -v "$1" >/dev/null 2>&1 && { ok "$1 ya está instalado ($(command -v "$1"))"; return; }
  [[ "${TRAMA_INSTALAR_CLI:-1}" == 0 ]] && { aviso "$3: no instalado (TRAMA_INSTALAR_CLI=0)"; return; }
  command -v curl >/dev/null 2>&1 || { aviso "$3: falta curl"; return; }
  if curl -fsSL --max-time 60 "$2" | bash >/dev/null 2>&1 && command -v "$1" >/dev/null 2>&1; then hecho "$3 instalado"
  else aviso "$3: el instalador oficial falló ($2); instalalo a mano"; fi
}
bajar_cli claude https://claude.ai/install.sh "claude (Claude Code)"
bajar_cli agy https://antigravity.google/cli/install.sh "agy (Antigravity CLI)"

# --- piezas del motor ------------------------------------------------------------------------------------
for b in pa tablero trama-estado trama-motor; do enlazar "$MOTOR/bin/$b" "$BIN"; done
for b in proyecto-ruta workers; do [[ -e "$MOTOR/bin/$b" ]] && enlazar "$MOTOR/bin/$b" "$BIN"; done
for h in latido.sh destructive-guard.sh statusline-espejo.sh; do enlazar "$MOTOR/hooks/$h" "$HOOKS"; done
enlazar "$MOTOR/skills/trama-orquestar" "$SKILLS"

# Plugin de agy para los workers Gemini (misma receta que instalar.sh): carpeta real con symlinks adentro.
if command -v agy >/dev/null 2>&1 && [[ -d "$MOTOR/agy/pa-worker" && -e "$MOTOR/hooks/agy-pa.sh" ]]; then
  PLUG="$HOME/.gemini/config/plugins/pa-worker"
  mkdir -p "$PLUG"
  enlazar "$MOTOR/agy/pa-worker/plugin.json" "$PLUG"
  enlazar "$MOTOR/agy/pa-worker/hooks.json" "$PLUG"
  enlazar "$MOTOR/hooks/agy-pa.sh" "$PLUG"
  if [[ -L "$PLUG/skills" && "$(readlink "$PLUG/skills")" == "$SKILLS" ]]; then ok "$PLUG/skills"
  elif [[ -e "$PLUG/skills" && ! -L "$PLUG/skills" ]]; then aviso "no toco $PLUG/skills (no es un symlink)"; mal=1
  else ln -sfn "$SKILLS" "$PLUG/skills" && hecho "enlace $PLUG/skills -> $SKILLS"; fi
fi

# --- ~/.claude/settings.json: se agrega, nunca se pisa ---------------------------------------------------
CFG="$HOME/.claude/settings.json"
registrar_hooks() {
  command -v jq >/dev/null 2>&1 || { aviso "jq no está: no registré los hooks en $CFG"; return; }
  [[ -s "$CFG" ]] || echo '{}' >"$CFG"
  jq -e 'type == "object"' "$CFG" >/dev/null 2>&1 || { aviso "$CFG no es un JSON válido: no lo toqué (registrá a mano destructive-guard.sh y statusline-espejo.sh)"; return; }
  local guard="$HOOKS/destructive-guard.sh" espejo="$HOOKS/statusline-espejo.sh" nuevo
  nuevo="$(jq --arg guard "bash $guard" --arg espejo "$espejo" '
      (if ([.hooks.PreToolUse[]?.hooks[]?.command // empty] | any(test("destructive-guard\\.sh")))
       then . else .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{matcher: "Bash", hooks: [{type: "command", command: $guard}]}]) end)
      | (if ((.statusLine.command // "") | test("statusline-espejo\\.sh")) then .
         elif (.statusLine.type // "command") == "command" and ((.statusLine.command // "") != "")
           then .statusLine.command = ("bash \"" + $espejo + "\" bash -c " + (.statusLine.command | @sh))
         elif (.statusLine // null) == null then .statusLine = {type: "command", command: ("bash \"" + $espejo + "\"")}
         else . end)' "$CFG")" || { aviso "jq falló sobre $CFG: no lo toqué"; return; }
  if [[ "$(jq -S . <<<"$nuevo")" == "$(jq -S . "$CFG")" ]]; then ok "$CFG ya engancha los hooks"; return; fi
  [[ "$(jq -S . "$CFG")" == "{}" ]] || cp -n "$CFG" "$CFG.trama-bak-$(date +%Y%m%d)" 2>/dev/null || true
  printf '%s\n' "$nuevo" >"$CFG.tmp.$$" && mv -f "$CFG.tmp.$$" "$CFG" && hecho "$CFG: destructive-guard y statusline-espejo registrados (copia: $CFG.trama-bak-$(date +%Y%m%d))"
}
registrar_hooks

# --- home: líder genérico (sólo si no existen) -----------------------------------------------------------
for p in CLAUDE.md GEMINI.md; do
  if [[ -e "$HOME/$p" ]]; then ok "$HOME/$p ya existe (no lo toco)"
  elif [[ -f "$MOTOR/plantillas/home/$p" ]]; then cp "$MOTOR/plantillas/home/$p" "$HOME/$p" && hecho "$HOME/$p (plantilla)"
  else aviso "falta la plantilla $MOTOR/plantillas/home/$p"; fi
done

# --- estado mínimo ---------------------------------------------------------------------------------------
REG="${PROYECTOS_REGISTRY:-$HOME/.config/proyectos/registry.json}"
if [[ ! -e "$REG" ]]; then mkdir -p "$(dirname "$REG")"; echo '{"projects":[]}' >"$REG"; hecho "$REG (vacío: agregá tus proyectos)"; else ok "$REG"; fi

if ! grep -qs 'trama:path' "$HOME/.bashrc" 2>/dev/null; then
  printf '\n# trama:path\ncase ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac\n' >>"$HOME/.bashrc" \
    && hecho "$HOME/.bashrc: ~/.local/bin en el PATH"
fi

# --- build de la app -------------------------------------------------------------------------------------
# El árbol exportado no trae dist/ ni dist-electron/ (el export los excluye): se compilan acá. La fuente puede ser de
# sólo lectura o de otro usuario, así que se compila en una copia en ~/.local/share/trama/app. Deja APP apuntando ahí.
construir_app() {
  local src="$1" dst="$HOME/.local/share/trama/app"
  [[ -f "$src/package.json" ]] || { aviso "app: $src no tiene package.json, no puedo compilar"; return 1; }
  [[ -n "$NODE" ]] || { aviso "app: sin node no puedo compilar"; return 1; }
  command -v npm >/dev/null 2>&1 || { aviso "app: falta npm"; return 1; }
  if [[ "$src" != "$dst" ]]; then
    mkdir -p "$dst"
    tar -C "$src" --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./dist-electron -cf - . | tar -C "$dst" -xf - \
      || { aviso "app: no pude copiar $src a $dst"; return 1; }
  fi
  if [[ ! -f "$dst/dist-electron/motor.js" || ! -f "$dst/dist/index.html" ]]; then
    hecho "app: instalando dependencias y compilando en $dst (unos minutos)"
    # sin el binario de Electron: el motor corre con node puro; Electron lo trae sólo la carcasa de escritorio.
    ( cd "$dst" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm "c""i" --no-audit --no-fund >"$dst/.build.log" 2>&1 \
        && npm run build >>"$dst/.build.log" 2>&1 ) \
      || { aviso "app: la compilación falló (ver $dst/.build.log)"; return 1; }
    # el motor sólo importa módulos de node: las dependencias de compilación (~400 MB) sobran una vez compilado
    [[ -f "$dst/dist-electron/motor.js" ]] && rm -rf "$dst/node_modules"
  fi
  [[ -f "$dst/dist-electron/motor.js" ]] || { aviso "app: la compilación no dejó dist-electron/motor.js"; return 1; }
  ok "app compilada en $dst"
  APP="$dst"
}
if [[ -n "$APP" && ! -f "$APP/dist-electron/motor.js" && -f "$APP/package.json" ]]; then construir_app "$APP" || true; fi

# --- el motor --------------------------------------------------------------------------------------------
motor_arriba() { trama-estado --json 2>/dev/null | jq -e '.motor.vivo' >/dev/null 2>&1; }
if [[ -z "$APP" || ! -f "$APP/dist-electron/motor.js" ]]; then
  aviso "no encontré la app (dist-electron/motor.js) en '${APP:-?}': pasala con --app DIR; sin ella no se instala la unit del motor"
else
  echo "$APP" >"$CONF/app"
  if [[ -n "$NODE" ]]; then
    unit="$UNITS/trama-motor.service"
    cat >"$unit.tmp.$$" <<EOF
[Unit]
Description=Trama: el motor (líderes, workers y la interfaz en http://localhost:8791)
# Generada por instalar-producto.sh; se pisa en cada corrida.
StartLimitIntervalSec=20
StartLimitBurst=15

[Service]
Environment=HILOS_MOTOR=1
# El motor no se relanza solo fuera de la unidad.
Environment=TRAMA_UNIDAD=1
# La interfaz en 127.0.0.1:8791 (la abre la carcasa de Windows, o el navegador).
Environment=TRAMA_LOCAL=1
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$NODE $APP/dist-electron/motor.js
Restart=always
RestartSec=2
# 3 = ya había un motor escuchando: no se insiste.
RestartPreventExitStatus=3
SuccessExitStatus=3
# Sólo el proceso del motor: los workers que lanza (pa, con setsid) quedan en este cgroup y sobreviven al relanzo.
KillMode=process
OOMPolicy=continue
TimeoutStopSec=30

[Install]
WantedBy=default.target
EOF
    if cmp -s "$unit.tmp.$$" "$unit"; then rm -f "$unit.tmp.$$"; ok "$unit"; cambio=0
    else mv -f "$unit.tmp.$$" "$unit"; hecho "unit $unit"; cambio=1; fi
    if systemctl --user show-environment >/dev/null 2>&1; then
      (( cambio )) && systemctl --user daemon-reload
      systemctl --user enable trama-motor.service >/dev/null 2>&1 || aviso "systemctl --user enable trama-motor falló"
      if (( cambio )); then systemctl --user restart trama-motor.service >/dev/null 2>&1 || aviso "no arrancó trama-motor.service (journalctl --user -u trama-motor)"
      else systemctl --user start trama-motor.service >/dev/null 2>&1 || aviso "no arrancó trama-motor.service (journalctl --user -u trama-motor)"; fi
    else
      aviso "no hay systemd de usuario en esta sesión: lanzo el motor suelto con 'trama-motor start' (en WSL2 activá systemd: --solo-apt lo deja en /etc/wsl.conf)"
      trama-motor start >/dev/null 2>&1 || aviso "trama-motor start falló"
    fi
    for _ in $(seq 1 20); do motor_arriba && break; sleep 1; done
    motor_arriba && ok "motor vivo en http://127.0.0.1:${TRAMA_PUERTO:-8791}" || aviso "el motor no responde todavía en http://127.0.0.1:${TRAMA_PUERTO:-8791}"
  fi
fi

echo "--- trama-estado"
trama-estado 2>/dev/null || true
(( mal )) && aviso "quedó algo sin hacer (ver arriba)"
echo "listo."
exit 0
