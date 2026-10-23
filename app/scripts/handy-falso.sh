#!/usr/bin/env bash
# Un `handy` de mentira para las pruebas del dictado (HILOS_HANDY): nunca el de verdad (usa la GPU).
# `--transcribe-file <wav>`: dice cuántos bytes tenía. HANDY_FALSO_FALLA=<código>: sale con ese código y un motivo en stderr.
# HANDY_FALSO_ANOTA=<archivo>: anota los argumentos que recibió.
[ -n "${HANDY_FALSO_ANOTA:-}" ] && printf '%s\n' "$*" >> "$HANDY_FALSO_ANOTA"
if [ "$1" != "--transcribe-file" ] || [ ! -f "$2" ]; then echo "uso: handy --transcribe-file <wav>" >&2; exit 2; fi
if [ -n "${HANDY_FALSO_FALLA:-}" ]; then echo "handy falso: modelo no cargado" >&2; exit "$HANDY_FALSO_FALLA"; fi
echo "dictado de prueba de $(stat -c %s "$2") bytes"
