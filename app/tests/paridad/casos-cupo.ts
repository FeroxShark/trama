// Casos de paridad de la falta de cupo con reparto (electron/cli/pa/cupo.ts): relanzar cuando el Claude oficial dice límite al arrancar
// y esperar cupo con sin_cupo=esperar en el hijo de --async. El reparto es un script que lee sus respuestas (una por llamada de
// `--tipo`, la última se repite) y anota cada llamada en <estado>/reparto-llamadas.txt, que entra en la comparación. El claude es el
// de guion (casos-lanzar.ts). Todos con herramienta pa-cli: el bash contra electron/cli/pa.ts.
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Caso, Contexto, Paso } from "./arnes.ts";
import { ponerGuion, type Respuesta } from "./casos-lanzar.ts";

const BRIEF = "Objetivo: x\nArchivos: a.ts\nListo cuando: pasa el test\nCómo verificar: npm test\nNo tocar: b.ts";
const BLOQUE = "RESULTADO: hice x.\nARCHIVOS: a.ts\nVERIFICACION: npm test\n  ok 3 tests\nDECISION: nada\nSIGUE: nada";
const LIMITE = "Claude AI usage limit reached. You've hit your session limit · resets 7pm (UTC)";

const ok = (result: string): Respuesta => ({
  json: { type: "result", subtype: "success", is_error: false, result, session_id: "@SID@", num_turns: 3, duration_ms: 4200, total_cost_usd: 0.12345 },
});
const limite = (extra: Partial<Respuesta> = {}): Respuesta => ({ json: { type: "result", subtype: "success", is_error: true, result: LIMITE, session_id: "@SID@" }, rc: 1, ...extra });

const SONNET = { modelo: "claude-sonnet-5-5", effort: "high", motivo: "el que alcanza" };
const HAIKU = { modelo: "claude-haiku-5-5", effort: "xhigh", motivo: "el que queda" };
const LLENO = { ...SONNET, todo_lleno: true, motivo: "todo lleno" };

const STUB = `#!/bin/sh
case "$1" in
  --tabla) exit 1 ;;
esac
echo "$* [$REPARTO_NO_DISPONIBLE]" >> "$PA_STATE/reparto-llamadas.txt"
case "$1" in
  --agy-modelos) cat "$REPARTO_DIR/agy-modelos" 2>/dev/null || exit 1 ;;
  --enfriar) exit 0 ;;
  --tipo)
    n=$(cat "$REPARTO_DIR/n" 2>/dev/null || echo 0); n=$((n+1)); echo "$n" > "$REPARTO_DIR/n"
    l=$(sed -n "\${n}p" "$REPARTO_DIR/respuestas")
    [ -n "$l" ] || l=$(tail -n 1 "$REPARTO_DIR/respuestas")
    printf '%s\\n' "$l" ;;
  *) exit 1 ;;
esac
`;

/** Deja el reparto falso con esas respuestas, el guion del claude y (si va) un modelos.json. */
const montar = (respuestas: object[], guion: Respuesta[], modelos?: object) => (c: Contexto) => {
  const stub = path.join(c.aux, "reparto-falso.sh");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  writeFileSync(path.join(c.aux, "respuestas"), respuestas.map((r) => JSON.stringify(r)).join("\n") + "\n");
  if (modelos) writeFileSync(path.join(c.aux, "modelos.json"), JSON.stringify({ version: 1, ...modelos }));
  ponerGuion(c, guion);
};
const entorno =
  (extra: Record<string, string> = {}) =>
  (c: Contexto) => ({ PA_REPARTO: path.join(c.aux, "reparto-falso.sh"), REPARTO_DIR: c.aux, TRAMA_MODELOS: path.join(c.aux, "modelos.json"), ...extra });

const FALSO = path.join(import.meta.dirname, "otro-falso.mjs");
/** agy falso en el PATH del sandbox (otro-falso.mjs; FALSO_MODO=sin-hooks: su /hooks no trae el plugin pa-worker). */
const conAgyFalso = (c: Contexto) => {
  const shim = path.join(c.raiz, "shim", "agy");
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${FALSO}" agy "$@"\n`);
  chmodSync(shim, 0o755);
};
/** agy falso que rechaza los Claude 5.5, y lo que lista `reparto --agy-modelos` para esa cuenta. */
const conAgySinClaude55 = (c: Contexto) => {
  conAgyFalso(c);
  writeFileSync(path.join(c.aux, "agy-modelos"), "gemini-3.8-flash-high\nagy:claude-sonnet-4-6-thinking\nagy:claude-opus-4-6-thinking\nagy:gpt-oss-120b-medium\n");
};
/** El límite de sesión de la cuenta de siempre, ya conocido (hasta el año 2100). */
const conLimiteConocido = (c: Contexto) => writeFileSync(path.join(c.estado, "limite.hasta"), "4102444800");

const caso = (
  nombre: string,
  o: { respuestas: object[]; guion: Respuesta[]; modelos?: object; env?: Record<string, string>; pasos: Paso[]; antes?: (c: Contexto) => void },
): Caso => ({
  herramienta: "pa-cli",
  nombre: `pa-cli: cupo: ${nombre}`,
  preparar: (c) => {
    montar(o.respuestas, o.guion, o.modelos)(c);
    o.antes?.(c);
  },
  env: entorno(o.env),
  pasos: o.pasos,
});

const lanzar = (rc: number, ...extra: string[]): Paso => ({ args: ["demo", "--sin-jefe", "--tipo", "codigo-acotado", ...extra, BRIEF], rc });
/** Lanza con --async y le da 3 s al hijo para esperar el cupo y correr (--esperar no ve una corrida que sólo está en cola). */
const asincrono: Paso = { ...lanzar(0, "--async"), pausaMs: 3000 };
const esperar = (rc: number): Paso => ({ args: ["--esperar", "demo", "--timeout", "60"], rc });

export const casosCupo: Caso[] = [
  caso("el Claude oficial dice límite y reparto ofrece otro Claude", { respuestas: [SONNET, HAIKU], guion: [limite(), ok(BLOQUE)], pasos: [lanzar(0)] }),
  caso("dice límite y reparto no ofrece otro: sale 76", { respuestas: [SONNET, SONNET], guion: [limite()], pasos: [lanzar(76)] }),
  caso("dice límite y reparto está todo lleno: sale 76", { respuestas: [SONNET, LLENO], guion: [limite()], pasos: [lanzar(76)] }),
  caso("dice tres veces límite: relanza tres veces y sale 76", {
    respuestas: [SONNET, HAIKU, { modelo: "claude-opus-5-5", effort: "medium", motivo: "otro más" }, { modelo: "claude-sonnet-5-5", effort: "low", motivo: "y otro" }],
    guion: [limite()],
    pasos: [lanzar(76)],
  }),
  caso("con sin_cupo=fallar no relanza", { respuestas: [SONNET, HAIKU], guion: [limite(), ok(BLOQUE)], modelos: { sin_cupo: "fallar" }, pasos: [lanzar(76)] }),
  caso("si el worker ya dejó trabajo no relanza", { respuestas: [SONNET, HAIKU], guion: [limite({ crear: ["a.ts"] }), ok(BLOQUE)], pasos: [lanzar(76)] }),
  caso("un 429 en el result también cuenta", {
    respuestas: [SONNET, HAIKU],
    guion: [{ json: { type: "result", subtype: "success", is_error: true, result: "API Error: 429 rate limited", session_id: "@SID@" }, rc: 1 }, ok(BLOQUE)],
    pasos: [lanzar(0)],
  }),
  caso("un -m del jefe no se relanza (no vino de reparto)", { respuestas: [SONNET, HAIKU], guion: [limite(), ok(BLOQUE)], pasos: [lanzar(76, "-m", "claude-sonnet-5-5")] }),
  caso("sin_cupo=esperar con todo lleno: el hijo de --async hace cola y corre con lo que vuelve", {
    respuestas: [LLENO, LLENO, HAIKU],
    guion: [ok(BLOQUE)],
    modelos: { sin_cupo: "esperar" },
    env: { PA_GEMINI_ESPERA_S: "0.2" },
    pasos: [asincrono, esperar(0)],
  }),
  caso("sin_cupo=esperar: si vuelve el mismo modelo corre con ése", {
    respuestas: [LLENO, SONNET],
    guion: [ok(BLOQUE)],
    modelos: { sin_cupo: "esperar" },
    env: { PA_GEMINI_ESPERA_S: "0.2" },
    pasos: [asincrono, esperar(0)],
  }),
  caso("sin_cupo=esperar sin --async sale 75", { respuestas: [LLENO], guion: [ok(BLOQUE)], modelos: { sin_cupo: "esperar" }, pasos: [lanzar(75)] }),
  caso("sin_cupo=fallar con todo lleno sale 96", { respuestas: [LLENO], guion: [ok(BLOQUE)], modelos: { sin_cupo: "fallar" }, pasos: [lanzar(96)] }),
  caso("sin_cupo=esperar: se acaba la espera y el hijo sale 96 sin correr", {
    respuestas: [LLENO],
    guion: [ok(BLOQUE)],
    modelos: { sin_cupo: "esperar" },
    env: { PA_GEMINI_ESPERA_S: "0.2", PA_GEMINI_ESPERA_MAX_MIN: "0" },
    pasos: [lanzar(1, "--async")], // el hijo sale 96 sin tomar puesto: el padre lo ve muerto
  }),
  // Lo que reparto eligió y ahora no sirve se saltea antes de lanzar: se le pide el siguiente con REPARTO_NO_DISPONIBLE (se ve en el registro de llamadas).
  caso("agy sin el plugin pa-worker: reparto da el siguiente en vez de caer a un Claude", {
    respuestas: [{ modelo: "gemini-4-argon-low", effort: "low", motivo: "el que alcanza" }, HAIKU],
    guion: [ok(BLOQUE)],
    env: { FALSO_MODO: "sin-hooks" },
    antes: conAgyFalso,
    pasos: [lanzar(0)],
  }),
  caso("agy sin el plugin y reparto no ofrece otro: cae al equivalente Claude como antes", {
    respuestas: [{ modelo: "gemini-4-argon-low", effort: "low", motivo: "el que alcanza" }],
    guion: [ok(BLOQUE)],
    env: { FALSO_MODO: "sin-hooks" },
    antes: conAgyFalso,
    pasos: [lanzar(0)],
  }),
  // agy no conoce el modelo que eligió reparto (el catálogo cambia con la cuenta): se pide la lista de nuevo, se enfría ese modelo y se relanza con el siguiente
  caso("agy rechaza el modelo: reparto da el siguiente (uno que sólo ofrece esa cuenta) y se relanza", {
    respuestas: [
      { modelo: "agy:claude-sonnet-5-5-medium", effort: "", motivo: "el que alcanza" },
      { modelo: "agy:claude-sonnet-4-6-thinking", effort: "", motivo: "el que queda" },
    ],
    guion: [ok(BLOQUE)],
    env: { FALSO_MODO: "modelo-malo" },
    antes: conAgySinClaude55,
    pasos: [lanzar(0)],
  }),
  caso("agy rechaza el modelo y reparto no ofrece otro: sale 1 y dice qué ofrece la cuenta", {
    respuestas: [{ modelo: "agy:claude-sonnet-5-5-medium", effort: "", motivo: "el que alcanza" }],
    guion: [ok(BLOQUE)],
    env: { FALSO_MODO: "modelo-malo" },
    antes: conAgySinClaude55,
    pasos: [lanzar(1)],
  }),
  caso("agy de otra cuenta: un -m que sólo ofrece esa cuenta se acepta", {
    respuestas: [SONNET],
    guion: [ok(BLOQUE)],
    antes: conAgySinClaude55,
    pasos: [{ args: ["demo", "--sin-jefe", "-m", "agy:claude-sonnet-4-6-thinking", BRIEF], rc: 0 }],
  }),
  caso("agy de otra cuenta: un -m que esa cuenta no ofrece sale 2 con la lista", {
    respuestas: [SONNET],
    guion: [ok(BLOQUE)],
    antes: conAgySinClaude55,
    pasos: [{ args: ["demo", "--sin-jefe", "-m", "agy:claude-sonnet-9-9-thinking", BRIEF], rc: 2 }],
  }),
  caso("límite de la cuenta ya conocido: reparto da el siguiente sin Claude; si no hay, sale 76 sin lanzar", {
    respuestas: [SONNET, HAIKU],
    guion: [ok(BLOQUE)],
    antes: conLimiteConocido,
    pasos: [lanzar(76)],
  }),
];
