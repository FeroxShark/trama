// "Destrabar solo cuando se repite": el detector de un modelo (hoy Gemini 3.8 Flash) que se queda en un bucle dentro de
// un turno (relee el progreso de una descarga 20 %, 30 %, 35 %…, repite la misma llamada o el mismo error) y gasta
// tokens sin avanzar. Puro y sin Electron: lo alimenta el puente de agy (agy-puente.ts) con lo que ya tradujo al
// stream de Claude, y lo prueban `tests/destrabar.test.ts`. Qué hace al detectarlo (cortar el turno, mandar el
// aviso) es del puente; acá sólo se decide si hay bucle y de qué.
//
// Qué cuenta como "lo mismo": una llamada a una herramienta junto con lo que devolvió, o un mensaje de texto, con los
// números aplanados (`20 %` y `30 %` son iguales; las barras de progreso también). Que cambie el contenido de verdad
// (leer un archivo por pedazos, editar distinto) deshace la racha: no es un bucle. El agy de hoy no muestra su
// razonamiento (sólo `thinking_tokens`), así que el bucle se ve en lo que hace y dice, no en lo que piensa.
import { createHash } from "node:crypto";

/** Cuántas repeticiones seguidas de lo mismo son un bucle (si se alterna entre 2 o 3 cosas, dos menos). */
export const UMBRAL_DEFECTO = 6;
/** Cuántas veces por turno se intenta destrabarlo antes de parar y avisar. */
export const REINTENTOS_MAX = 2;
// Qué modelos lo traen prendido y cómo se decide (`destrabarActivo`) viven en modelos-tipos.ts: Ajustes también lo usa.
export { DESTRABAR_DE_FABRICA, claveDestrabo, destrabarActivo, destrabarPorDefecto } from "./modelos-tipos.ts";

/** Lo que vio el puente, ya con la forma del stream de Claude. */
export type Senal =
  | { tipo: "llamada"; id: string; nombre: string; entrada: unknown }
  | { tipo: "resultado"; id: string; texto: string; error: boolean }
  | { tipo: "texto"; texto: string };

export type Bucle = {
  /** Qué repetía, en una línea corta: va al aviso que se le manda y a la marca del chat. */
  que: string;
  clase: "repite" | "error" | "texto";
  veces: number;
};

/** Aplana lo que cambia de una vuelta a otra: números (con su % o sus decimales), barras de progreso y espacios. */
export function aplanar(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[=#>\-_.█▓▒░■□· ]{3,}\]/g, "[~]")
    .replace(/\d+(?:[.,:]\d+)*/g, "#")
    .replace(/[=#>\-_.█▓▒░■□·*|]{2,}/g, "~")
    .replace(/\s+/g, " ")
    .trim();
}

const hash = (s: string) => createHash("sha1").update(s).digest("base64url").slice(0, 12);

const una = (s: string, n: number) => {
  const l = s.replace(/\s+/g, " ").trim();
  return l.length > n ? l.slice(0, n - 1) + "…" : l;
};

/** La llamada en pocas palabras: "Bash: curl localhost/progreso" o "Read: /tmp/x.log". */
export function queLlamada(nombre: string, entrada: unknown): string {
  const e = (entrada && typeof entrada === "object" ? entrada : {}) as Record<string, unknown>;
  const clave = ["command", "file_path", "path", "pattern", "url", "query"].find((k) => typeof e[k] === "string" && e[k]);
  const detalle = clave ? una(String(e[clave]), 70) : "";
  return detalle ? `${nombre}: ${detalle}` : nombre;
}

type Entrada = { sig: string; que: string; texto: boolean };

/**
 * Mira lo que hace un turno y avisa cuando lo mismo se repite. `ver` recibe cada señal en orden y devuelve el bucle
 * apenas hay uno (después de eso se reinicia solo: hace falta una racha nueva para otro aviso).
 */
export class Vigilante {
  private readonly umbral: number;
  private entradas: Entrada[] = [];
  private llamadas = new Map<string, { firma: string; que: string }>();
  private errorSig: string | null = null;
  private errorRacha = 0;
  private errorQue = "";

  constructor(umbral = UMBRAL_DEFECTO) {
    this.umbral = Math.max(3, Math.floor(umbral) || UMBRAL_DEFECTO);
  }

  reiniciar(): void {
    this.entradas = [];
    this.llamadas.clear();
    this.errorSig = null;
    this.errorRacha = 0;
  }

  ver(s: Senal): Bucle | null {
    if (s.tipo === "llamada") {
      this.llamadas.set(s.id, { firma: `${s.nombre}|${aplanar(JSON.stringify(s.entrada ?? {}))}`, que: queLlamada(s.nombre, s.entrada) });
      return null;
    }
    if (s.tipo === "texto") {
      const plano = aplanar(s.texto);
      if (plano.length < 4) return null;
      this.entradas.push({ sig: `T|${hash(plano)}`, que: una(s.texto, 70), texto: true });
      return this.revisar();
    }
    const c = this.llamadas.get(s.id);
    if (!c) return null;
    this.llamadas.delete(s.id);
    const salida = aplanar(s.texto);
    this.entradas.push({ sig: `${hash(c.firma)}|${hash(salida)}|${s.error ? "e" : "o"}`, que: c.que, texto: false });
    // El mismo error de nuevo, aunque cambie el comando: sólo cuentan los resultados de herramientas.
    if (s.error) {
      const sig = hash(salida.slice(0, 300));
      this.errorRacha = sig === this.errorSig ? this.errorRacha + 1 : 1;
      this.errorSig = sig;
      this.errorQue = una(s.texto.split("\n").find((l) => l.trim()) ?? c.que, 70);
    } else {
      this.errorSig = null;
      this.errorRacha = 0;
    }
    return this.revisar();
  }

  private revisar(): Bucle | null {
    const hallado = this.revisarCiclo() ?? this.revisarError();
    if (hallado) this.reiniciar();
    if (this.entradas.length > 60) this.entradas = this.entradas.slice(-60);
    return hallado;
  }

  /** Lo mismo seguido, o dos o tres cosas que se alternan (relee, espera, relee, espera…). */
  private revisarCiclo(): Bucle | null {
    const e = this.entradas;
    for (let p = 1; p <= 3; p++) {
      const veces = p === 1 ? this.umbral : Math.max(3, this.umbral - 2);
      const largo = p * veces;
      if (e.length < largo) continue;
      const ventana = e.slice(-largo);
      if (!ventana.every((x, i) => i < p || x.sig === ventana[i - p]!.sig)) continue;
      const ciclo = ventana.slice(-p);
      // Un ciclo de varias cosas iguales ya lo habría dicho p = 1.
      const solo = ciclo.filter((x) => !x.texto);
      const que = una((solo.length ? solo : ciclo).map((x) => x.que).filter((x, i, a) => a.indexOf(x) === i).join(" ↔ "), 120);
      return { que, clase: ciclo.every((x) => x.texto) ? "texto" : "repite", veces };
    }
    return null;
  }

  private revisarError(): Bucle | null {
    return this.errorRacha >= this.umbral ? { que: this.errorQue, clase: "error", veces: this.errorRacha } : null;
  }
}

/** El mensaje corto que corta el bucle y lo reencauce; el segundo intento del turno es más firme. */
export function avisoDestrabo(que: string, intento: number): string {
  const base = `[trama] Te trabaste repitiendo ${que}. Pará, no vuelvas a consultar eso: si esperás algo, un solo comando que bloquee hasta terminar. Retomá la tarea desde donde quedó, con el siguiente paso útil.`;
  return intento > 1 ? `${base} Es la segunda vez en este turno: si no podés avanzar por eso, decime qué te frena en vez de seguir intentando.` : base;
}
