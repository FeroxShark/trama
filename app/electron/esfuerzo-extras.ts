// Lo puro del selector de esfuerzo con deslizador, de Ultracode y del modo Fast. Sin imports de Node: lo comparte la ventana
// (`src/hilo/Esfuerzo.tsx`) y el main (`lider.ts`, `lider-arma.ts`). Lo cubre `tests/esfuerzo-extras.test.ts`.

/** Un modelo oficial de Anthropic (los locales y los de otros motores no llevan Ultracode ni Fast). */
export const esClaudeOficial = (modelo: string | null | undefined): boolean => /^claude-/.test(modelo ?? "");

/** Fast (`--fast-mode`, `fastMode`): sólo lo sirven Opus y Fable (el `initialize` de Claude Code dice `supportsFastMode` por modelo). */
export const soportaFast = (modelo: string | null | undefined): boolean => /^claude-(?:opus|fable)-/.test(modelo ?? "");

// --- El deslizador: nivel ↔ posición -------------------------------------------------------------------------------

/** El lugar de un nivel en la lista de su modelo (0 si no está: cada modelo tiene sus niveles y los de antes se reajustan arriba). */
export const indiceDe = (niveles: readonly string[], actual: string): number => Math.max(0, niveles.indexOf(actual));

/** El nivel de un lugar, sujeto al largo de la lista (vacío: `""`). */
export const nivelEn = (niveles: readonly string[], i: number): string => niveles[Math.max(0, Math.min(niveles.length - 1, Math.round(i)))] ?? "";

/** Dónde cae el lugar `i` de `n` a lo largo del carril: de 0 a 1 (con un solo nivel, 0). */
export const fraccion = (n: number, i: number): number => (n <= 1 ? 0 : Math.max(0, Math.min(1, i / (n - 1))));

/** El lugar más cercano a una posición `x` (px desde el borde izquierdo del carril) en un carril de `ancho` px con `n` niveles. */
export function indiceDesdeX(n: number, x: number, ancho: number): number {
  if (n <= 1 || !(ancho > 0)) return 0;
  return Math.max(0, Math.min(n - 1, Math.round((x / ancho) * (n - 1))));
}

/** Las teclas del deslizador. */
export type TeclaNivel = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End" | "PageUp" | "PageDown";

/** El nivel al que lleva una tecla (←/↓ bajan, →/↑ suben, Inicio y Fin los extremos); `null` si no cambia (o la tecla no es del deslizador). */
export function moverNivel(niveles: readonly string[], actual: string, tecla: string): string | null {
  const i = indiceDe(niveles, actual);
  const ultimo = niveles.length - 1;
  const destino =
    tecla === "ArrowLeft" || tecla === "ArrowDown" || tecla === "PageDown"
      ? i - 1
      : tecla === "ArrowRight" || tecla === "ArrowUp" || tecla === "PageUp"
        ? i + 1
        : tecla === "Home"
          ? 0
          : tecla === "End"
            ? ultimo
            : null;
  if (destino === null) return null;
  const nuevo = nivelEn(niveles, destino);
  return nuevo && nuevo !== actual ? nuevo : null;
}

/** Lo que mueve la rueda de a un nivel (una muesca de ratón son ~100; un trackpad llega en pedacitos que se acumulan). */
export const UMBRAL_RUEDA = 60;

/**
 * Suma un pedacito de rueda a lo acumulado: cada `UMBRAL_RUEDA` es un nivel (rueda hacia arriba, `delta` negativo, sube) y el resto queda para
 * el próximo. Un trackpad no dispara un pedido por píxel.
 */
export function acumularRueda(acumulado: number, delta: number, umbral = UMBRAL_RUEDA): { pasos: number; resto: number } {
  const total = acumulado + delta;
  const k = Math.trunc(Math.abs(total) / umbral);
  if (k === 0) return { pasos: 0, resto: total };
  return { pasos: total < 0 ? k : -k, resto: total - Math.sign(total) * k * umbral };
}

/** El nivel que sale de `pasos` niveles desde el actual (positivo sube), sin pasarse de los extremos; `null` si no cambia. */
export function nivelPorPasos(niveles: readonly string[], actual: string, pasos: number): string | null {
  if (!pasos) return null;
  const nuevo = nivelEn(niveles, indiceDe(niveles, actual) + pasos);
  return nuevo && nuevo !== actual ? nuevo : null;
}

// --- El color por nivel ---------------------------------------------------------------------------------------------

/** De frío a caliente, con los tokens que ya existen (`tokens.css`): celeste, turquesa, ámbar, naranja de carpeta y coral. */
export const RAMPA = ["--acento", "--ok", "--aviso", "--carpeta", "--critico"] as const;

/** El lugar en la rampa de los niveles que Claude conoce (mismo color en todos los modelos); `off` va apagado, aparte. */
const PUESTO: Record<string, number> = { minimal: 0, low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

/** El token de color (`var(--…)`) de un nivel: por su nombre si es de los conocidos; si no, por su lugar en la lista del modelo. Nunca va solo: el nombre se dice con texto. */
export function colorNivel(niveles: readonly string[], nivel: string): string {
  if (nivel === "off") return "var(--inactivo)";
  const p = PUESTO[nivel] ?? Math.round(fraccion(niveles.length, indiceDe(niveles, nivel)) * (RAMPA.length - 1));
  return `var(${RAMPA[Math.max(0, Math.min(RAMPA.length - 1, p))]})`;
}

/** «high» → «High»: el nivel como se dice en la cabecera del popover. */
export const nivelBonito = (nivel: string): string => (nivel ? nivel[0]!.toUpperCase() + nivel.slice(1) : "");

/** La cabecera del popover: «Opus 5.5 · High», y con Ultracode o Fast prendidos, «· Ultracode» y «· Fast» (el estado va también con palabras). */
export function cabeceraEsfuerzo(o: { modelo: string; nivel: string; ultracode?: boolean; fast?: boolean; palabras: { ultracode: string; fast: string } }): string {
  return [o.modelo, nivelBonito(o.nivel), ...(o.ultracode ? [o.palabras.ultracode] : []), ...(o.fast ? [o.palabras.fast] : [])].filter(Boolean).join(" · ");
}

// --- Lo que se le dice a `claude` ---------------------------------------------------------------------------------------

/** Los ajustes de la sesión que se cambian con `apply_flag_settings`: Ultracode (`ultracode`) y Fast (`fastMode`). Sin lo que no se pidió. */
export function ajustesExtras(x: { ultracode?: boolean; fast?: boolean }): Record<string, boolean> {
  return { ...(x.ultracode === undefined ? {} : { ultracode: x.ultracode }), ...(x.fast === undefined ? {} : { fastMode: x.fast }) };
}

/** Los argumentos de arranque de Fast: `--fast-mode on`, sólo con un modelo que lo sirva (con otro, Claude Code lo ignora igual). Ultracode va por `apply_flag_settings` tras el arranque. */
export const argvFast = (modelo: string, fast: boolean | undefined): string[] => (fast && soportaFast(modelo) ? ["--fast-mode", "on"] : []);

/**
 * ¿Hay que relanzar para apagar Fast? El `--fast-mode on` del arranque queda en el argv y Claude Code lo vuelve a aplicar cada vez que
 * relee sus ajustes: apagarlo en vivo (`apply_flag_settings`) no dura, y el chat sigue pidiendo en modo rápido (y avisando «Fast mode
 * disabled · Out of usage credits» sin créditos). Prenderlo en vivo sí dura: sin la opción en el argv no hay nada que lo pise.
 */
export const fastDesfasado = (x: { fastArgv?: boolean; fast?: boolean }): boolean => x.fastArgv === true && !x.fast;

/** ¿El `get_settings` de `claude` dice que Ultracode quedó en vigor? (`applied.ultracode`); `null` si la respuesta no lo dice (una versión vieja). */
export function ultracodeEnVigor(respuesta: unknown): boolean | null {
  const a = (respuesta as { applied?: { ultracode?: unknown } } | null | undefined)?.applied;
  return typeof a?.ultracode === "boolean" ? a.ultracode : null;
}
