#!/usr/bin/env bash
# Instala el lanzador de trama para este usuario: `~/.local/bin/trama`, la entrada
# del menú de apps y el ícono. No copia la app: el lanzador abre el build de ESTE
# checkout, y si faltan `node_modules/` o el build los arma. Idempotente.
# También enlaza y habilita la unidad de usuario (`systemd/trama.service`): trama arranca
# sola y escondida al iniciar la sesión gráfica y se vuelve a levantar si muere. NO la
# arranca ahora (no pisa la trama que esté abierta): entra al próximo inicio de sesión, o
# la primera vez que se abra `trama` sin ninguna corriendo.
# Lo mismo con el motor sin ventana (`systemd/trama-motor.service`, WantedBy=default.target): enlazado y
# habilitado, sin arrancarlo; para que siga sin sesión gráfica hace falta `loginctl enable-linger $USER`
# (lo hace Ana a mano: pide sudo).
# Y registra el hook que dice quién compacta en `~/.claude/settings.json` (`scripts/registrar-hook.mjs`).
#
# uso: scripts/instalar.sh
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
datos="${XDG_DATA_HOME:-$HOME/.local/share}"
bin="$HOME/.local/bin/trama"
desktop="$datos/applications/trama.desktop"
iconos="$datos/icons/hicolor"
unidades="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

# Desde un worktree el lanzador quedaría apuntando a una carpeta que se borra.
if [ "$(git -C "$raiz" rev-parse --git-dir 2>/dev/null)" != "$(git -C "$raiz" rev-parse --git-common-dir 2>/dev/null)" ]; then
  echo "instalar.sh: $raiz es un worktree; corrélo desde el checkout principal" >&2
  exit 1
fi

# Lo que pide la receta (`proyecto.toml`): Electron bajado y el build armado. Sólo si falta.
[ -x "$raiz/node_modules/electron/dist/electron" ] || (cd "$raiz" && npm ci)
[ -f "$raiz/dist/index.html" ] && [ -f "$raiz/dist-electron/main.js" ] || (cd "$raiz" && npm run build)

mkdir -p "$(dirname "$bin")" "$(dirname "$desktop")" "$iconos/scalable/apps" "$iconos/256x256/apps"

# El binario real de Electron, no node_modules/.bin/electron (cli.js lo lanzaría
# como hijo y la ventana quedaría en otro proceso).
cat >"$bin" <<EOF
#!/bin/sh
# Lanzador de trama (lo escribe scripts/instalar.sh de hilos): abre el build de main.
raiz='$raiz'
electron="\$raiz/node_modules/electron/dist/electron"
[ -x "\$electron" ] || (cd "\$raiz" && npm ci) || exit 1
[ -f "\$raiz/dist/index.html" ] && [ -f "\$raiz/dist-electron/main.js" ] || (cd "\$raiz" && npm run build) || exit 1
# Con la unidad habilitada, la app la corre systemd (trama.service, que entra por acá con
# TRAMA_UNIDAD): si no está andando se la arranca ahí, con la ventana pedida a la vista, en vez de
# abrir una suelta que nadie volvería a levantar. Si ya anda (o hay una suelta), el electron de
# abajo es la segunda instancia: le muestra la ventana a la que está y sale.
if [ -z "\$TRAMA_UNIDAD" ] && [ \$# -eq 0 ] && systemctl --user is-enabled -q trama.service 2>/dev/null && ! systemctl --user is-active -q trama.service; then
  estado="\${HILOS_STATE:-\$HOME/.local/state/hilos}"
  mkdir -p "\$estado" && echo foco >"\$estado/mostrar"
  systemctl --user start trama.service && exit 0
fi
exec "\$electron" "\$raiz" "\$@"
EOF
chmod +x "$bin"

install -m 644 "$raiz/public/favicon.svg" "$iconos/scalable/apps/trama.svg"
install -m 644 "$raiz/public/icon.png" "$iconos/256x256/apps/trama.png"

# StartupWMClass: el app_id de la ventana en Wayland es el `name` de package.json.
cat >"$desktop" <<EOF
[Desktop Entry]
Type=Application
Name=trama
Comment=Workers de pa y líderes de Claude
Exec=$bin
Icon=trama
Terminal=false
Categories=Development;
Keywords=trama;hilos;pa;claude;workers;
StartupWMClass=hilos
StartupNotify=false
EOF

command -v update-desktop-database >/dev/null && update-desktop-database -q "$(dirname "$desktop")" || true

# Las unidades de usuario: enlaces a los archivos del repo (como las demás unidades de Ana). La ventana
# (trama.service) para la sesión gráfica; el motor (trama-motor.service) para default.target. Sin `--now`:
# no se le cruzan a una trama abierta a mano (ver arriba).
if command -v systemctl >/dev/null && systemctl --user show-environment >/dev/null 2>&1; then
  mkdir -p "$unidades"
  ln -sfn "$raiz/systemd/trama.service" "$unidades/trama.service"
  ln -sfn "$raiz/systemd/trama-motor.service" "$unidades/trama-motor.service"
  systemctl --user daemon-reload
  systemctl --user enable trama.service trama-motor.service
  echo "unidades: $unidades/trama.service (habilitada; arranca con la sesión gráfica o al abrir trama)"
  echo "          $unidades/trama-motor.service (habilitada, sin arrancar; sin sesión gráfica pide: loginctl enable-linger $USER)"
else
  echo "instalar.sh: sin systemd de usuario; la unidad no se instaló (trama se abre a mano)" >&2
fi

# El hook que dice quién compacta (electron/compactando.ts): Claude Code no lo deja escrito en ningún lado y el
# settings de usuario no es del repo, así que lo registra acá (PreCompact / PostCompact en ~/.claude/settings.json,
# sin pisar los otros hooks; idempotente). Si el settings no se puede tocar, avisa y la instalación sigue.
node "$raiz/scripts/registrar-hook.mjs" || echo "instalar.sh: el hook de compactando no quedó registrado (ver arriba)" >&2
echo "instalado: $bin, $desktop"
