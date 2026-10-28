#!/usr/bin/env bash
# El lado A de la paridad de los otros motores (casos-motores.ts): saca de motor/bin/pa las funciones de agy, codex, dsh,
# opencode y ollama y las corre sueltas, sin lanzar nada. El lado B es motores-ts.ts, con los mismos subcomandos.
set -uo pipefail
PA_BASH="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../motor/bin" && pwd)/pa"
_BIN="$(dirname "$PA_BASH")"

# Las definiciones de esas funciones, tal cual están en el bash (una línea, o de `nombre() {` hasta la `}` de la columna 0).
extraer() {
  awk -v quiero=" $* " '
    !dentro && match($0, /^[a-z_]+\(\) *\{/) {
      n = substr($0, 1, index($0, "(") - 1)
      if (index(quiero, " " n " ")) {
        print
        if ($0 ~ /^[a-z_]+\(\) *\{ *(#.*)?$/) dentro = 1
      }
      next
    }
    dentro { print; if ($0 ~ /^}/) dentro = 0 }
  ' "$PA_BASH"
}
# Las variables globales que usan (una línea `NOMBRE=...` cada una).
variables() { local v; for v; do grep -m1 -E "^$v=" "$PA_BASH"; done; }

eval "$(variables AGENTS_MAX_DEFECTO GEMINI_MODELOS CODEX_MODELOS DSH_MODELOS OC_MODELOS CLAVES_ENV)"
eval "$(extraer es_gemini gemini_equivalente es_codex codex_equivalente codex_a_json codex_latido es_opencode es_dsh dsh_proveedor \
  dsh_modelo_de dsh_gratis dsh_clave dsh_latido opencode_gratis es_local local_de proveedor_de_modelo proveedor_cuenta_de \
  gemini_secreto_en gemini_secreto_trackeado gemini_privacidad agy_a_json md_resolver md_vacio md_stub_texto \
  agents_md_candidatos agents_md_archivo agents_md_bloque)"
# Sin modelos.json (los locales salen del Ollama de siempre): la lectura de modelos.json es de otra parte del port.
modelos_cargar() { return 1; }
# El armado de agy, codex y dsh: el final de armar_llamada (desde «armado de la llamada a agy» hasta su `}`).
eval "armar_otro() {
$(awk '/^# --- armado de la llamada a agy/ { d = 1 } d && /^}/ { exit } d' "$PA_BASH")
}"

sub="${1:-}"; shift || true
case "$sub" in
  agy-a-json) agy_a_json "$@" ;;
  codex-a-json) codex_a_json "$@" ;;
  secreto-en) gemini_secreto_en "$1" ;;
  secreto-trackeado) gemini_secreto_trackeado "$1" ;;
  privacidad) gemini_privacidad "$1" "$2" ;;
  equivalente) gemini_equivalente "$1"; codex_equivalente "$1" ;;
  clasificar)
    m="$1"
    printf 'proveedor=%s\n' "$(proveedor_de_modelo "$m")"
    printf 'proveedor_cuenta=%s\n' "$(proveedor_cuenta_de "$m")"
    for f in es_gemini es_codex es_dsh es_opencode es_local; do printf '%s=%s\n' "$f" "$("$f" "$m" && echo 1 || echo 0)"; done
    if es_dsh "$m"; then
      printf 'dsh_proveedor=%s\ndsh_modelo=%s\n' "$(dsh_proveedor "$m")" "$(dsh_modelo_de "$m")"
      printf 'dsh_gratis=%s\n' "$(dsh_gratis "$m" && echo 1 || echo 0)"
    fi
    es_opencode "$m" && printf 'opencode_gratis=%s\n' "$(opencode_gratis "$m" && echo 1 || echo 0)"
    for re in GEMINI_MODELOS CODEX_MODELOS DSH_MODELOS OC_MODELOS; do [[ "$m" =~ ^(${!re})$ ]] && printf 'calza=%s\n' "$re"; done
    true ;;
  clave) dsh_clave "$1"; echo "rc=$?" ;;
  local-de) local_de "$1" ;;
  latido)
    modelo="$2" transcript="$3" hb="$4"
    if [[ "$1" == codex ]]; then codex_latido; else dsh_latido; fi
    cat "$hb" ;;
  bloque) agents_md_bloque "$@" ;;
  armar)
    motor="$1" modelo="$2" ruta_trabajo="$3" ruta="$4" rama="$5" dir="$6" ts="$7" hb="$8" mapa_proy="$9"
    leer="${10}" actualizar="${11}" max_turns="${12}" oc_effort="${13}"
    contrato="$P_CONTRATO" prompt="$P_PROMPT" dsh_prompt="" args=() transcript=""
    unset PA_AGY_HB PA_AGY_RAIZ PA_AGY_PPAL PA_AGY_RAMA PA_AGY_MAPA PA_AGY_MODO PA_AGY_REBASE PA_MAX_TURNS
    armar_otro
    printf '%s\0' "${args[@]}" | jq -Rs --arg dp "$dsh_prompt" --arg tr "$transcript" '{args: (split("\u0000") | .[:-1]), dsh_prompt: $dp, transcript: $tr}'
    for v in PA_AGY_HB PA_AGY_RAIZ PA_AGY_PPAL PA_AGY_RAMA PA_AGY_MAPA PA_AGY_MODO PA_AGY_REBASE PA_MAX_TURNS; do
      [[ -v "$v" ]] && printf '%s=%s\n' "$v" "${!v}"
    done
    true ;;
  *) echo "uso: motores-bash.sh <subcomando> ..." >&2; exit 2 ;;
esac
