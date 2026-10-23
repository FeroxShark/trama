#!/usr/bin/env bash
# Instala o actualiza el motor de trama en el servidor (el Dell), como el usuario de los agentes, sin sudo
# y sin Electron: el motor es Node puro (dist-electron/motor.js) y corre con el `node` oficial de ~/.local.
# Qué hace (se puede repetir):
#   1. Comprueba lo que hace falta (node >= 22, git, linger) y avisa de lo que falta; sólo frena si falta node/npm.
#   2. Con --pull, trae lo nuevo del repo (`git pull --ff-only`: nunca mergea ni reescribe).
#   3. Instala las dependencias de compilación SIN bajar Electron (`npm ci --ignore-scripts`), sólo si cambiaron.
#   4. Compila APARTE, en `.build-nuevo/` (vite → dist, tsc → dist-electron), con tope de memoria y prioridad baja.
#      Si algo falla, `dist/` y `dist-electron/` que usa el motor ni se tocan.
#   5. Cambia las dos carpetas de una vez (cuatro `mv` seguidos, milisegundos): trama mira esas carpetas y da por
#      terminado un build tras 10 s quieto (electron/relanzar.ts), así que nunca ve `dist/` a medio escribir.
#   6. Enlaza y habilita `trama-motor-servidor.service`; si no estaba corriendo la arranca. Si ya corría NO la
#      reinicia: el motor avisa (cartel "Hay una actualización disponible") y se reinicia cuando se lo pide, sin
#      cortar un turno.
# No compila en la PC ni toca nada fuera de este checkout y de ~/.config/systemd/user.
#
# uso: scripts/instalar-servidor.sh [--mirar] [--pull]
#   --mirar   sólo muestra lo que haría
#   --pull    git pull --ff-only antes de compilar
# Para probarlo: TRAMA_SERVIDOR_PRUEBA=1 (acepta un worktree o una copia, no toca systemd) y XDG_CONFIG_HOME en un tmp.
set -euo pipefail

mirar=0
pull=0
for a in "$@"; do
  case "$a" in
    --mirar) mirar=1 ;;
    --pull) pull=1 ;;
    *) echo "uso: $0 [--mirar] [--pull]" >&2; exit 2 ;;
  esac
done

raiz="$(cd "$(dirname "$0")/.." && pwd)"
prueba="${TRAMA_SERVIDOR_PRUEBA:-0}"
unidades="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
unidad=trama-motor-servidor.service
nuevo="$raiz/.build-nuevo"
viejo="$raiz/.build-viejo"

say() { echo "instalar-servidor: $*"; }
aviso() { echo "instalar-servidor: AVISO: $*" >&2; }
corre() { if [ "$mirar" = 1 ]; then echo "  (haría) $*"; else "$@"; fi; }

[ "$(id -u)" != 0 ] || { echo "instalar-servidor: no se corre como root; es del usuario de los agentes" >&2; exit 1; }

# La unidad apunta a ~/Proyectos/hilos: desde un worktree quedaría apuntando a una carpeta que se borra.
if [ "$prueba" != 1 ] && [ "$(git -C "$raiz" rev-parse --git-dir 2>/dev/null)" != "$(git -C "$raiz" rev-parse --git-common-dir 2>/dev/null)" ]; then
  echo "instalar-servidor: $raiz es un worktree; corrélo desde el checkout principal (~/Proyectos/hilos)" >&2
  exit 1
fi

# --- 1. Lo que hace falta -------------------------------------------------------------------------------
command -v node >/dev/null || { echo "instalar-servidor: falta node (>= 22); ver docs/estado/dell.md, paso 'Node'" >&2; exit 1; }
command -v npm >/dev/null || { echo "instalar-servidor: falta npm (viene con el tarball de node)" >&2; exit 1; }
mayor="$(node -p 'process.versions.node.split(".")[0]')"
[ "$mayor" -ge 22 ] || { echo "instalar-servidor: node $mayor es viejo; hace falta >= 22 (el de Debian no sirve)" >&2; exit 1; }
[ "$prueba" = 1 ] || [ "$(command -v node)" = "$HOME/.local/bin/node" ] ||
  aviso "node sale de $(command -v node), no de ~/.local/bin/node: la unidad usa ~/.local/bin/node"
[ -x "$HOME/.local/bin/node" ] || [ "$prueba" = 1 ] || aviso "falta ~/.local/bin/node (la unidad lo pide ahí)"
command -v git >/dev/null || aviso "falta git"
command -v claude >/dev/null || aviso "falta claude (los líderes son procesos 'claude -p')"
command -v pa >/dev/null || aviso "falta pa (instalador de orquestador, perfil servidor)"
command -v gawk >/dev/null || aviso "falta gawk (lo usa pa; lo instala Ana con sudo)"
if [ "$prueba" != 1 ] && command -v loginctl >/dev/null; then
  [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ] ||
    aviso "sin linger: el motor sólo vive con una sesión abierta (sudo loginctl enable-linger $USER)"
fi
[ -f "$raiz/package-lock.json" ] && [ -f "$raiz/tsconfig.electron.json" ] || { echo "instalar-servidor: $raiz no parece el checkout de hilos" >&2; exit 1; }

# --- 2. Traer lo nuevo ----------------------------------------------------------------------------------
if [ "$pull" = 1 ]; then
  say "git pull --ff-only"
  corre git -C "$raiz" pull --ff-only
fi

# --- 3. Dependencias de compilación (sin el binario de Electron: el motor no lo usa) -------------------
# `npm ci` borra node_modules antes de instalar: si fuera un enlace, borraría lo que hay del otro lado.
[ ! -L "$raiz/node_modules" ] || { echo "instalar-servidor: $raiz/node_modules es un enlace; acá tiene que ser una carpeta propia" >&2; exit 1; }
export NODE_OPTIONS="--max-old-space-size=${TRAMA_SERVIDOR_MEM:-768}"
if [ ! -x "$raiz/node_modules/.bin/tsc" ] || [ ! -x "$raiz/node_modules/.bin/vite" ] ||
  [ "$raiz/package-lock.json" -nt "$raiz/node_modules/.package-lock.json" ]; then
  say "npm ci --ignore-scripts"
  corre bash -c 'cd "$1" && nice -n 10 npm ci --ignore-scripts --no-audit --no-fund' _ "$raiz"
else
  say "dependencias al día"
fi

# --- 4. Compilar aparte ---------------------------------------------------------------------------------
say "compilando en $nuevo (el motor sigue con lo anterior)"
if [ "$mirar" = 1 ]; then
  echo "  (haría) vite build --outDir .build-nuevo/dist; tsc -p tsconfig.electron.json --outDir .build-nuevo/dist-electron"
else
  rm -rf "$nuevo" "$viejo"
  mkdir -p "$nuevo"
  trap 'rm -rf "$nuevo"' EXIT
  (
    cd "$raiz"
    nice -n 10 node node_modules/vite/bin/vite.js build --outDir "$nuevo/dist" --emptyOutDir
    nice -n 10 node node_modules/typescript/bin/tsc -p tsconfig.electron.json --outDir "$nuevo/dist-electron"
  )
  [ -f "$nuevo/dist/index.html" ] && [ -f "$nuevo/dist-electron/motor.js" ] && [ -f "$nuevo/dist-electron/preload.cjs" ] ||
    { echo "instalar-servidor: el build quedó incompleto; no se cambia nada" >&2; exit 1; }
  # Sintaxis del punto de entrada con el node de acá (no ejecuta nada).
  node --check "$nuevo/dist-electron/motor.js"
fi

# --- 5. El cambio, de una vez ---------------------------------------------------------------------------
if [ "$mirar" = 1 ]; then
  echo "  (haría) cambiar dist/ y dist-electron/ por los nuevos, de una vez"
else
  mkdir -p "$viejo"
  hechos=()
  deshacer() {
    # Si un mv falla a la mitad: lo ya cambiado vuelve a su lugar.
    for d in "${hechos[@]}"; do
      rm -rf "$raiz/$d"
      [ -e "$viejo/$d" ] && mv "$viejo/$d" "$raiz/$d"
    done
  }
  for d in dist dist-electron; do
    if [ -e "$raiz/$d" ]; then mv "$raiz/$d" "$viejo/$d" || { deshacer; exit 1; }; fi
    hechos+=("$d")
    mv "$nuevo/$d" "$raiz/$d" || { deshacer; exit 1; }
  done
  rm -rf "$viejo" "$nuevo"
  trap - EXIT
  say "build cambiado: dist/ y dist-electron/ nuevos"
fi

# --- 6. La unidad ---------------------------------------------------------------------------------------
if [ "$mirar" = 1 ]; then
  echo "  (haría) enlazar $unidad en $unidades, habilitarla y arrancarla si no corre"
else
  mkdir -p "$unidades"
  ln -sfn "$raiz/systemd/$unidad" "$unidades/$unidad"
  say "unidad enlazada: $unidades/$unidad"
  if [ "$prueba" != 1 ] && command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
    systemctl --user daemon-reload
    if systemctl --user is-active -q "$unidad"; then
      systemctl --user enable "$unidad" 2>/dev/null
      say "el motor ya corre: sigue con el build anterior hasta que se lo reinicie (cartel de trama; sin nadie mirando y sin turnos: systemctl --user restart ${unidad%.service})"
    else
      systemctl --user enable --now "$unidad"
      say "motor arrancado: journalctl --user -u ${unidad%.service} -n 20"
    fi
  elif [ "$prueba" != 1 ]; then
    aviso "sin systemd de usuario en esta sesión (por ssh: loginctl enable-linger $USER y volver a entrar); la unidad quedó enlazada, falta habilitarla"
  fi
fi

remoto="${HILOS_STATE:-$HOME/.local/state/hilos}/remoto.json"
[ -f "$remoto" ] || aviso "falta $remoto: sin él el motor sólo atiende por el socket local y nadie lo ve por la tailnet (docs/estado/dell.md, paso 'remoto.json')"
exit 0
