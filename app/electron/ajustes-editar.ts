// Lo que Ajustes escribe, cada cosa donde ya vive: el plan de la suscripción con `pa --plan <pro|max>` (pa lo guarda en
// su estado; trama no toca ese archivo) y la red de seguridad como `autoCompactWindow` de `~/.claude/settings.json`
// (`HILOS_CLAUDE_SETTINGS`), dejando todo lo demás del archivo como estaba. Se valida todo antes de escribir algo:
// si un valor no vale, no se cambia nada. Lo prueba tests/ajustes-editar.test.ts.
import { readFile, realpath, rename, writeFile } from "node:fs/promises";
import { RUTA_SETTINGS } from "./contexto.js";
import { errorT } from "./errores.ts";
import { esPlan, RED_MAX, RED_MIN } from "./valida-ajustes.ts";

/** Qué cambiar; lo que no viene queda como está. `red_seguridad: null` quita el `autoCompactWindow`. */
export type CambioAjustes = { plan?: string; red_seguridad?: number | null };

export type CorrerPa = (args: string[]) => Promise<{ rc: number; dijo: string }>;

const CAMPOS = new Set(["plan", "red_seguridad"]);

/** Tira con el motivo si el cambio no vale; si vale, lo devuelve limpio. */
export function validarCambio(x: unknown): CambioAjustes {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw errorT("main.ajustesForma");
  const o = x as Record<string, unknown>;
  const raro = Object.keys(o).find((k) => !CAMPOS.has(k));
  if (raro !== undefined) throw errorT("main.remotoCampo", { campo: raro.slice(0, 40) });
  const c: CambioAjustes = {};
  if ("plan" in o) {
    if (!esPlan(o.plan)) throw errorT("main.ajustesPlan");
    c.plan = o.plan;
  }
  if ("red_seguridad" in o) {
    const n = o.red_seguridad;
    if (n !== null && !(typeof n === "number" && Number.isInteger(n) && n >= RED_MIN && n <= RED_MAX))
      throw errorT("main.ajustesRed", { min: RED_MIN, max: RED_MAX });
    c.red_seguridad = n;
  }
  return c;
}

/** El texto de un settings.json con `autoCompactWindow` puesto (o sacado), sin tocar el resto ni su sangría. */
export function conRed(texto: string | null, red: number | null): string | null {
  let j: Record<string, unknown> = {};
  let sangria: string | number = 2;
  if (texto !== null && texto.trim()) {
    const parsed: unknown = JSON.parse(texto);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("settings.json no es un objeto");
    j = parsed as Record<string, unknown>;
    const m = /^\{\s*\n([ \t]+)"/.exec(texto);
    if (m) sangria = m[1];
    else if (!texto.includes("\n")) sangria = 0;
  }
  if (red === null) {
    if (!("autoCompactWindow" in j)) return texto;
    delete j.autoCompactWindow;
  } else j.autoCompactWindow = red;
  return JSON.stringify(j, null, sangria) + "\n";
}

/** Lee el settings y arma lo que quedaría (tira si no se puede leer o no es JSON); `escribir` lo deja en disco. */
async function prepararSettings(red: number | null, ruta: string) {
  let real = ruta;
  let antes: string | null = null;
  try {
    real = await realpath(ruta);
    antes = await readFile(real, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const despues = conRed(antes, red);
  return {
    async escribir() {
      if (despues === antes || despues === null) return;
      const tmp = `${real}.trama-${process.pid}.tmp`;
      await writeFile(tmp, despues);
      await rename(tmp, real);
    },
  };
}

/**
 * Valida y escribe. Rechaza con el motivo (un texto de `errorT`, o lo que dijo `pa`) sin haber tocado nada si el valor
 * no vale, el settings no se puede leer o `pa` no acepta el plan.
 */
export async function guardarAjustes(x: unknown, correrPa: CorrerPa, ruta = RUTA_SETTINGS): Promise<void> {
  const c = validarCambio(x);
  const settings = c.red_seguridad !== undefined ? await prepararSettings(c.red_seguridad, ruta) : null;
  if (c.plan !== undefined) {
    const r = await correrPa(["--plan", c.plan]);
    if (r.rc !== 0) throw new Error(r.dijo || `pa --plan ${c.plan}: salió ${r.rc}`);
  }
  await settings?.escribir();
}
