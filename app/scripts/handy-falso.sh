#!/usr/bin/env bash
# Un `handy` de mentira para las pruebas del dictado (HILOS_HANDY): nunca el de verdad (usa la GPU).
# `--transcribe-file <wav>`: dice cuántos bytes tenía. HANDY_FALSO_FALLA=<código>: sale con ese código y un motivo en stderr.
# HANDY_FALSO_ANOTA=<archivo>: anota los argumentos que recibió. `--list-models --json`: Turbo bajado y Large v3 no
# (HANDY_FALSO_SIN_TURBO=1: Turbo tampoco).
[ -n "${HANDY_FALSO_ANOTA:-}" ] && printf '%s\n' "$*" >> "$HANDY_FALSO_ANOTA"
if [ "$1" = "--list-models" ]; then
  turbo=true; [ -n "${HANDY_FALSO_SIN_TURBO:-}" ] && turbo=false
  printf '[{"id":"handy-computer/whisper-large-v3-turbo-gguf/whisper-large-v3-turbo-Q8_0.gguf","name":"Whisper Large v3 Turbo","is_downloaded":%s},' "$turbo"
  printf '{"id":"handy-computer/whisper-large-v3-gguf/whisper-large-v3-Q5_K_M.gguf","name":"Whisper Large v3","is_downloaded":false},'
  printf '{"id":"parakeet-tdt-0.6b-v3","name":"Parakeet V3","is_downloaded":true}]\n'
  exit 0
fi
if [ "$1" != "--transcribe-file" ] || [ ! -f "$2" ]; then echo "uso: handy --transcribe-file <wav>" >&2; exit 2; fi
if [ -n "${HANDY_FALSO_FALLA:-}" ]; then echo "handy falso: modelo no cargado" >&2; exit "$HANDY_FALSO_FALLA"; fi
echo "dictado de prueba de $(stat -c %s "$2") bytes"
