#!/usr/bin/env bash
# Instala las skills de diseño de trama (`skills/`: ui-ux-pro-max, taste-skill y diseno) como enlaces a este checkout:
# siempre en ~/.claude/skills y, sólo si `agy` (Antigravity) está instalado, en ~/.gemini/config/skills. No baja nada
# (las dos de terceros van en el repo, con su LICENSE MIT) y nunca pisa lo que ya hay: una skill con ese nombre que no sea
# nuestro enlace se deja como está (y se dice si es idéntica o distinta). Idempotente. Lo llama scripts/instalar.sh.
# `HILOS_AGY` (como en electron/capacidades.ts) fuerza dónde está agy; `HILOS_SKILLS_AGY` cambia la carpeta de agy.
#
# uso: scripts/instalar-skills.sh
set -euo pipefail

raiz="$(cd "$(dirname "$0")/.." && pwd)"
skills=(ui-ux-pro-max taste-skill diseno)

hay_agy() {
  if [ -n "${HILOS_AGY:-}" ]; then [ -x "$HILOS_AGY" ]; return; fi
  command -v agy >/dev/null 2>&1 || [ -x "$HOME/.local/bin/agy" ]
}

# enlazar <carpeta de skills> <nombre>
enlazar() {
  local dir="$1" nombre="$2" origen="$raiz/skills/$2" destino="$1/$2"
  if [ -L "$destino" ] && [ "$(readlink "$destino")" = "$origen" ]; then
    echo "skills: $destino ya enlaza a este checkout"
  elif [ -L "$destino" ] && [ ! -e "$destino" ]; then
    ln -sfn "$origen" "$destino"
    echo "skills: $destino (enlace roto) ahora enlaza a $origen"
  elif [ -e "$destino" ]; then
    if diff -rq -x __pycache__ "$destino" "$origen" >/dev/null 2>&1; then
      echo "skills: $destino ya existe y es idéntica; no se toca"
    else
      echo "skills: $destino ya existe y es distinta; no se pisa (la de trama queda en $origen)" >&2
    fi
  else
    mkdir -p "$dir"
    ln -s "$origen" "$destino"
    echo "skills: $destino -> $origen"
  fi
}

for s in "${skills[@]}"; do enlazar "$HOME/.claude/skills" "$s"; done

if hay_agy; then
  agy_dir="${HILOS_SKILLS_AGY:-$HOME/.gemini/config/skills}"
  for s in "${skills[@]}"; do
    # Un plugin de agy cuyo `skills` apunta a ~/.claude/skills (un pa-worker propio) ya las ve: no se duplican.
    visto=""
    for p in "$HOME"/.gemini/config/plugins/*/skills/"$s"; do [ -e "$p" ] && visto="$p" && break; done
    if [ -n "$visto" ]; then
      echo "skills: agy ya ve $s por $visto; no se enlaza de nuevo"
    else
      enlazar "$agy_dir" "$s"
    fi
  done
else
  echo "skills: sin agy; sólo ~/.claude/skills"
fi
