#!/usr/bin/env bash
# `prender-pc` falso (el verdadero manda un paquete Wake-on-LAN a la LAN: ~/sistema/bin/prender-pc). No toca la red.
# Anota el argv de cada llamada en $PRENDER_FALSO_LOG y "manda el paquete" tocando $PC_FALSA_PAQUETE: la PC falsa de
# tests/pc-estado.test.ts abre su puerto al verlo. PRENDER_FALSO_FALLA=<texto>: sale 1 con ese texto por stderr.
{ printf 'prender-pc'; (($#)) && printf ' %q' "$@"; echo; } >> "${PRENDER_FALSO_LOG:-/dev/null}"
if [[ -n "${PRENDER_FALSO_FALLA:-}" ]]; then
  echo "prender-pc: $PRENDER_FALSO_FALLA" >&2
  exit 1
fi
[[ -n "${PC_FALSA_PAQUETE:-}" ]] && touch "$PC_FALSA_PAQUETE"
exit 0
