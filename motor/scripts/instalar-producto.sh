#!/usr/bin/env bash
# instalar-producto.sh — deja Trama + pa/tablero andando en una máquina limpia (Ubuntu/WSL2, Debian, otra
# distro con systemd de usuario). Es el instalador del PRODUCTO; el de desarrollo (app/scripts/instalar.sh) sólo instala el lanzador y las unidades de un checkout.
#
#   instalar-producto.sh [--fuente DIR] [--app DIR]     instalación de usuario (sin sudo)
#   instalar-producto.sh --solo-apt [--usuario U]       sólo los paquetes del sistema (root); lo llama la carcasa con `wsl -u root`
#
# Idempotente (correrlo dos veces no rompe ni duplica) y sale 0 aunque algo de red falle: lo que no pudo hacer
# sale como AVISO y `trama-estado --json` dice qué quedó. Sale 2 sólo por uso o por una fuente rota.
#
#   --fuente DIR   árbol de `trama-exportar` (motor/ + app/), o el repo del motor suelto (bin/, hooks/, skills/…)
#                  (default: el árbol del propio script)
#   --app DIR      la app hilos con dist-electron/ (default: DIR/app de la fuente, o $TRAMA_APP)
#
# Qué hace (usuario normal): node LTS en ~/.local si falta · `claude` y `agy` por sus instaladores oficiales si
# faltan · `dsh` (npm i -g --prefix ~/.local @deepseek-ai/dsh, para workers con modelos gratis) si falta y hay npm · symlinks en ~/.local/bin (pa, tablero, trama-estado, trama-motor, proyecto-ruta, reparto, workers,
# cuentas) · hooks en
# ~/.claude/hooks y la skill trama-orquestar · destructive-guard (PreToolUse) y statusline-espejo registrados en
# ~/.claude/settings.json SIN pisar lo que hay · ~/CLAUDE.md y ~/GEMINI.md si no existen · ~/.config/trama/app ·
# registry.json vacío si falta · unit de usuario trama-motor.service (node <app>/dist-electron/motor.js, TRAMA_LOCAL=1).
# Si corre como root también hace el paso apt (y entonces instala TODO para root: sirve para contenedores).
# Nada de timers ni de repos remotos.
# Entorno (pruebas): TRAMA_INSTALAR_CLI=0 no baja claude/agy/dsh · TRAMA_INSTALAR_DSH=0 no instala dsh · TRAMA_NODE_MAJOR (mínimo, default 22).
set -uo pipefail

FUENTE="" APP="" SOLO_APT=0 USUARIO=""
while (( $# )); do
  case "$1" in
    --fuente)   FUENTE="${2:-}"; shift 2 || { echo "uso: --fuente DIR" >&2; exit 2; } ;;
    --app)      APP="${2:-}"; shift 2 || { echo "uso: --app DIR" >&2; exit 2; } ;;
    --solo-apt) SOLO_APT=1; shift ;;
    --usuario)  USUARIO="${2:-}"; shift 2 || { echo "uso: --usuario U" >&2; exit 2; } ;;
    -h|--help)  sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
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
# El árbol exportado es <fuente>/{motor,app}; el repo del motor suelto es la fuente misma. Desde motor/scripts/ el
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

# --- dependencias de runtime de pa ------------------------------------------------------------------------
# Sin alguna, pa falla a mitad de camino con un "command not found" poco claro: se avisa acá, con cómo instalarla.
# No corta la instalación (sale 0 igual): quien instala sin sudo puede pedirle los paquetes a quien administra la máquina.
revisar_deps() {
  local falta=() v
  command -v uuidgen >/dev/null 2>&1 || falta+=("uuidgen (uuid-runtime)")
  command -v flock   >/dev/null 2>&1 || falta+=("flock (util-linux)")
  command -v git     >/dev/null 2>&1 || falta+=("git")
  command -v curl    >/dev/null 2>&1 || falta+=("curl")
  command -v gawk    >/dev/null 2>&1 || { awk --version 2>&1 | grep -qi 'GNU Awk' || falta+=("gawk"); }
  if command -v jq >/dev/null 2>&1; then
    v="$(jq --version 2>/dev/null | sed -E 's/^jq-?//')"
    [[ "$v" =~ ^([0-9]+)\.([0-9]+) ]] && (( BASH_REMATCH[1] > 1 || ( BASH_REMATCH[1] == 1 && BASH_REMATCH[2] >= 6 ) )) \
      || falta+=("jq >= 1.6 (tengo '${v:-?}')")
  else falta+=("jq >= 1.6"); fi
  if (( ${#falta[@]} )); then
    aviso "faltan programas que pa necesita: ${falta[*]}. En Debian/Ubuntu: sudo apt-get install git jq curl gawk util-linux uuid-runtime (o instalar-producto.sh --solo-apt como root)."
    mal=1
  else ok "dependencias de pa (uuidgen, flock, git, gawk, jq, curl)"; fi
}
revisar_deps

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

# --- dsh (DeepSeek Harness): el motor para modelos gratis (OpenCode, Ollama) o DeepSeek --------------------------
# `npm i -g --prefix ~/.local @deepseek-ai/dsh`: con el prefijo propio no hace falta sudo (el npm global de un node del
# sistema escribe en /usr/lib) y deja `dsh` en ~/.local/bin. No es fatal: sin npm o sin red queda el AVISO y `pa -m dsh:…`
# explica qué falta. TRAMA_INSTALAR_DSH=0 (o TRAMA_INSTALAR_CLI=0) no lo instala. Las keys no se piden acá:
# Ajustes > Modelos de la app, o ~/.config/trama/claves.env (ver «Usar Trama gratis» en el README).
DSH_RESUMEN=""
instalar_dsh() {
  local d
  d="$(command -v dsh 2>/dev/null || true)"; [[ -n "$d" ]] || { [[ -x "$BIN/dsh" ]] && d="$BIN/dsh"; }
  if [[ -n "$d" ]]; then ok "dsh ya está instalado ($d)"; DSH_RESUMEN="dsh: instalado ($d)"; return; fi
  if [[ "${TRAMA_INSTALAR_CLI:-1}" == 0 || "${TRAMA_INSTALAR_DSH:-1}" == 0 ]]; then
    aviso "dsh: no instalado (TRAMA_INSTALAR_CLI=0 o TRAMA_INSTALAR_DSH=0)"; DSH_RESUMEN="dsh: sin instalar (para correr workers con modelos gratis: npm i -g --prefix ~/.local @deepseek-ai/dsh)"; return
  fi
  if ! command -v npm >/dev/null 2>&1; then
    aviso "dsh: falta npm (viene con node): después, npm i -g --prefix ~/.local @deepseek-ai/dsh"; DSH_RESUMEN="dsh: sin instalar (falta npm)"; return
  fi
  echo "dsh: instalando @deepseek-ai/dsh en ~/.local (puede tardar un par de minutos)…"
  if timeout 900 npm i -g --prefix "$HOME/.local" --no-fund --no-audit @deepseek-ai/dsh >/dev/null 2>&1 && [[ -x "$BIN/dsh" ]]; then
    hecho "dsh instalado ($BIN/dsh)"; DSH_RESUMEN="dsh: instalado ahora ($BIN/dsh)"
  else
    aviso "dsh: npm i -g --prefix ~/.local @deepseek-ai/dsh falló (¿sin red?); instalalo a mano para usar workers con modelos gratis"
    DSH_RESUMEN="dsh: no se pudo instalar (npm i -g --prefix ~/.local @deepseek-ai/dsh)"
  fi
}
instalar_dsh

# --- piezas del motor ------------------------------------------------------------------------------------
for b in pa tablero trama-estado trama-motor; do enlazar "$MOTOR/bin/$b" "$BIN"; done
# Los que un payload viejo puede no traer (se enlazan sólo si están). reparto es el que más duele:
# sin él `pa` no puede elegir modelo por cupo, cae a los defaults y manda todo a Claude, así que un
# líder Gemini no logra lanzar workers (lo encontró un tercero con la 0.1.2).
for b in proyecto-ruta workers reparto cuentas; do [[ -e "$MOTOR/bin/$b" ]] && enlazar "$MOTOR/bin/$b" "$BIN"; done
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
  nuevo="$(jq --arg guard "$guard" --arg espejo "$espejo" '
      (if ([.hooks.PreToolUse[]?.hooks[]?.command // empty] | any(test("destructive-guard\\.sh")))
       then . else .hooks.PreToolUse = ((.hooks.PreToolUse // []) + [{matcher: "Bash", hooks: [{type: "command", command: ("bash " + ($guard | @sh))}]}]) end)
      | (if ((.statusLine.command // "") | test("statusline-espejo\\.sh")) then .
         elif (.statusLine.type // "command") == "command" and ((.statusLine.command // "") != "")
           then .statusLine.command = ("bash " + ($espejo | @sh) + " bash -c " + (.statusLine.command | @sh))
         elif (.statusLine // null) == null then .statusLine = {type: "command", command: ("bash " + ($espejo | @sh))}
         else . end)' "$CFG")" || { aviso "jq falló sobre $CFG: no lo toqué"; return; }
  if [[ "$(jq -S . <<<"$nuevo")" == "$(jq -S . "$CFG")" ]]; then ok "$CFG ya engancha los hooks"; return; fi
  [[ "$(jq -S . "$CFG")" == "{}" ]] || cp -n "$CFG" "$CFG.trama-bak-$(date +%Y%m%d)" 2>/dev/null || true
  # Si settings.json es un symlink (dotfiles, stow), se escribe el ARCHIVO al que apunta: un mv sobre el enlace lo
  # reemplazaba por un archivo común y lo dejaba afuera del repo de dotfiles.
  local destino; destino="$(readlink -f "$CFG" 2>/dev/null || echo "$CFG")"
  printf '%s\n' "$nuevo" >"$destino.tmp.$$" && mv -f "$destino.tmp.$$" "$destino" && hecho "$CFG: destructive-guard y statusline-espejo registrados (copia: $CFG.trama-bak-$(date +%Y%m%d))"
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
# Guarda la huella de las fuentes (+ TRAMA_PAYLOAD_VERSION) en .build-huella y la del lock en node_modules/.lock-huella:
# si la huella cambió, recompila en .build-nuevo y cambia dist/ y dist-electron/ atómicamente (con rollback a .build-viejo
# si falla, dejando la app vieja andando).
huella_app() {
  (
    cd "$1" 2>/dev/null || exit 1
    [[ -n "${TRAMA_PAYLOAD_VERSION:-}" ]] && printf 'payload:%s\n' "$TRAMA_PAYLOAD_VERSION"
    find package.json package-lock.json tsconfig.json tsconfig.node.json tsconfig.electron.json vite.config.ts index.html public src electron scripts \
      -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum
  ) | sha256sum | cut -c1-16
}
# Borra de $2 los archivos que $1 ya no trae (tar copia encima pero no borra). Sin esto, un archivo
# de la versión anterior sobrevive para siempre y rompe la compilación: `tsc` compila todo src/.
# Incidente 2026-10-26: una instalación 0.1.1 -> 0.1.2 quedó sin motor por tres .ts huérfanos.
borrar_huerfanos_app() {
  local src="$1" dst="$2" rel
  [[ -d "$src" && -d "$dst" ]] || return 0
  local -a podar=( -name node_modules -o -name .git -o -name dist -o -name dist-electron
                   -o -name '.build-nuevo' -o -name '.build-viejo' )
  while IFS= read -r rel; do
    [[ -n "$rel" ]] || continue
    [[ -e "$src/$rel" ]] && continue
    rm -f -- "$dst/$rel" 2>/dev/null && aviso "app: saqué $rel (ya no está en esta versión)"
  done < <(find "$dst" \( "${podar[@]}" \) -prune -o -type f \
             ! -name '.build-huella' ! -name '.build.log' -printf '%P\n' 2>/dev/null)
  # dirs que quedaron vacíos al sacar los huérfanos (nunca el propio $dst)
  find "$dst" \( "${podar[@]}" \) -prune -o -mindepth 1 -type d -empty -exec rmdir {} + 2>/dev/null || true
}

construir_app() {
  local src="$1" dst="$HOME/.local/share/trama/app" nueva actual lock_nueva lock_actual
  [[ -f "$dst/dist-electron/motor.js" ]] && APP="$dst"
  [[ -f "$src/package.json" ]] || { aviso "app: $src no tiene package.json, no puedo compilar"; return 1; }
  [[ -n "$NODE" ]] || { aviso "app: sin node no puedo compilar"; return 1; }
  command -v npm >/dev/null 2>&1 || { aviso "app: falta npm"; return 1; }
  nueva="$(huella_app "$src")"
  actual="$(cat "$dst/.build-huella" 2>/dev/null || true)"
  if [[ -f "$dst/dist-electron/motor.js" && -f "$dst/dist/index.html" && -n "$nueva" && "$nueva" == "$actual" ]]; then
    ok "app compilada en $dst"
    APP="$dst"
    return 0
  fi
  if [[ "$src" != "$dst" ]]; then
    mkdir -p "$dst"
    tar -C "$src" --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./dist-electron \
      --exclude=./.build-huella --exclude=./.build-nuevo --exclude=./.build-viejo --exclude=./.build.log -cf - . \
      | tar -C "$dst" -xf - || { aviso "app: no pude copiar $src a $dst"; return 1; }
    # Un archivo que la versión anterior traía y la nueva ya no tiene queda huérfano en $dst y rompe
    # la compilación (tsc compila todo src/). tar no borra: hay que sacarlos a mano.
    borrar_huerfanos_app "$src" "$dst"
  fi
  hecho "app: instalando dependencias y compilando en $dst (unos minutos)"
  : >"$dst/.build.log"
  lock_nueva="$(sha256sum "$dst/package-lock.json" 2>/dev/null | cut -c1-16 || true)"
  lock_actual="$(cat "$dst/node_modules/.lock-huella" 2>/dev/null || true)"
  if [[ ! -d "$dst/node_modules" || "${lock_nueva:-sin-lock}" != "$lock_actual" ]] \
     || { [[ -d "$dst/node_modules/.bin" ]] && [[ ! -x "$dst/node_modules/.bin/tsc" || ! -x "$dst/node_modules/.bin/vite" ]]; }; then
    # sin el binario de Electron: el motor corre con node puro; Electron lo trae sólo la carcasa de escritorio.
    ( cd "$dst" && ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm "c""i" --no-audit --no-fund --ignore-scripts >>"$dst/.build.log" 2>&1 ) \
      || { aviso "app: la compilación falló en npm ci (ver $dst/.build.log)"; return 1; }
    mkdir -p "$dst/node_modules"
    printf '%s\n' "${lock_nueva:-sin-lock}" >"$dst/node_modules/.lock-huella"
  fi
  rm -f "$dst/.build-nuevo/node_modules" 2>/dev/null || true
  [[ -e "$dst/.build-nuevo" ]] && rm -r "$dst/.build-nuevo"
  mkdir -p "$dst/.build-nuevo"
  tar -C "$dst" --exclude=./node_modules --exclude=./.git --exclude=./dist --exclude=./dist-electron \
    --exclude=./.build-huella --exclude=./.build-nuevo --exclude=./.build-viejo --exclude=./.build.log -cf - . \
    | tar -C "$dst/.build-nuevo" -xf - \
    || { rm -r "$dst/.build-nuevo" 2>/dev/null || true; aviso "app: no pude preparar .build-nuevo"; return 1; }
  ln -s "$dst/node_modules" "$dst/.build-nuevo/node_modules"
  if ! ( cd "$dst/.build-nuevo" && npm run build >>"$dst/.build.log" 2>&1 ) \
     || [[ ! -f "$dst/.build-nuevo/dist-electron/motor.js" || ! -f "$dst/.build-nuevo/dist/index.html" ]]; then
    rm -f "$dst/.build-nuevo/node_modules" 2>/dev/null || true
    [[ -e "$dst/.build-nuevo" ]] && rm -r "$dst/.build-nuevo"
    aviso "app: la compilación falló (ver $dst/.build.log)"
    return 1
  fi
  [[ -e "$dst/.build-viejo" ]] && rm -r "$dst/.build-viejo"
  mkdir -p "$dst/.build-viejo"
  [[ -e "$dst/dist" ]] && mv "$dst/dist" "$dst/.build-viejo/dist"
  [[ -e "$dst/dist-electron" ]] && mv "$dst/dist-electron" "$dst/.build-viejo/dist-electron"
  if mv "$dst/.build-nuevo/dist" "$dst/dist" && mv "$dst/.build-nuevo/dist-electron" "$dst/dist-electron" \
     && { [[ ! -f "$dst/scripts/build-listo.mjs" ]] || ( cd "$dst" && "$NODE" scripts/build-listo.mjs >>"$dst/.build.log" 2>&1 ); }; then
    printf '%s\n' "$nueva" >"$dst/.build-huella"
    rm -f "$dst/.build-nuevo/node_modules" 2>/dev/null || true
    rm -r "$dst/.build-viejo" "$dst/.build-nuevo"
  else
    [[ -e "$dst/dist" ]] && rm -r "$dst/dist"
    [[ -e "$dst/dist-electron" ]] && rm -r "$dst/dist-electron"
    [[ -e "$dst/.build-viejo/dist" ]] && mv "$dst/.build-viejo/dist" "$dst/dist"
    [[ -e "$dst/.build-viejo/dist-electron" ]] && mv "$dst/.build-viejo/dist-electron" "$dst/dist-electron"
    rm -f "$dst/.build-nuevo/node_modules" 2>/dev/null || true
    [[ -e "$dst/.build-viejo" ]] && rm -r "$dst/.build-viejo"
    [[ -e "$dst/.build-nuevo" ]] && rm -r "$dst/.build-nuevo"
    aviso "app: la compilación falló (ver $dst/.build.log)"
    return 1
  fi
  if systemctl --user is-active --quiet trama-motor.service 2>/dev/null; then
    systemctl --user try-restart trama-motor.service >/dev/null 2>&1 || aviso "systemctl --user try-restart trama-motor falló"
  fi
  ok "app compilada en $dst"
  APP="$dst"
}
if [[ -n "$APP" && -f "$APP/package.json" ]]; then construir_app "$APP" || true; fi

# --- el motor --------------------------------------------------------------------------------------------
# Barato: un GET (o un connect) al puerto del motor, no el trama-estado entero (que además pregunta a claude, agy y ollama) 20 veces.
# Cualquier respuesta HTTP, aun un 4xx, cuenta como vivo (igual que trama-estado).
motor_arriba() {
  local puerto="${TRAMA_PUERTO:-8791}"
  if command -v curl >/dev/null 2>&1; then
    [[ "$(curl -s -o /dev/null --max-time 2 -w '%{http_code}' "http://127.0.0.1:$puerto/" 2>/dev/null)" != 000 ]]
  else
    ( exec 3<>"/dev/tcp/127.0.0.1/$puerto" ) 2>/dev/null
  fi
}
if [[ -z "$APP" || ! -f "$APP/dist-electron/motor.js" ]]; then
  aviso "no encontré la app (dist-electron/motor.js) en '${APP:-?}': pasala con --app DIR; sin ella no se instala la unit del motor"
else
  echo "$APP" >"$CONF/app"
  if [[ -n "$NODE" ]]; then
    unit="$UNITS/trama-motor.service"
    # La interfaz exige un token por instalación (~/.config/trama/token; 'trama-motor abrir' lo pone en la URL). Excepción en WSL:
    # la carcasa de Windows (windows/src/main.js) todavía abre http://localhost:8791 sin token. Quien porte Windows tiene que
    # abrir /?t=<token> (lo lee con `wsl cat ~/.config/trama/token`) y entonces se borra este TRAMA_TOKEN=0.
    SIN_TOKEN=""
    if grep -qi microsoft /proc/version 2>/dev/null; then SIN_TOKEN=$'# WSL: la carcasa de Windows aún no manda el token (ver instalar-producto.sh).\nEnvironment=TRAMA_TOKEN=0\n'; fi
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
${SIN_TOKEN}Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
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
[[ -n "$DSH_RESUMEN" ]] && echo "$DSH_RESUMEN · keys y modelos gratis: «Usar Trama gratis» en el README, o Ajustes > Modelos en la app"
(( mal )) && aviso "quedó algo sin hacer (ver arriba)"
echo "listo. Para abrir la interfaz: trama-motor abrir"
exit 0
