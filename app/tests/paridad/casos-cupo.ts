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
echo "$*" >> "$PA_STATE/reparto-llamadas.txt"
case "$1" in
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

const caso = (nombre: string, o: { respuestas: object[]; guion: Respuesta[]; modelos?: object; env?: Record<string, string>; pasos: Paso[] }): Caso => ({
  herramienta: "pa-cli",
  nombre: `pa-cli: cupo: ${nombre}`,
  preparar: montar(o.respuestas, o.guion, o.modelos),
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
];
