// Bajar un modelo de Ollama por su nombre (`POST <url>/api/pull`) con el progreso a la vista. Es lo que hace `ollama pull`:
// no carga el modelo ni usa la GPU, sólo lo descarga a disco. Una bajada por (dirección, modelo); el estado vive acá, así
// que si la página se recarga, `lista()` devuelve lo que sigue bajando. Node puro: los tests lo usan contra un servidor HTTP falso en 127.0.0.1.
import { errorT, textoT } from "./errores.ts";
import { urlOllama } from "./modelos-tipos.ts";

export type Bajada = {
  url: string;
  modelo: string;
  estado: "bajando" | "listo" | "error";
  /** Lo que dice Ollama ("pulling manifest", "verifying sha256 digest"…), sin traducir: es de Ollama. */
  texto: string;
  /** Bytes de la capa que baja ahora; sin total todavía, `null`. */
  completado: number | null;
  total: number | null;
  /** Por qué falló (clave `main.*` ya resuelta por `textoT`). */
  motivo: string | null;
};

/** Un nombre de modelo de Ollama: `llama3.2:3b`, `hf.co/usuario/repo:Q4_K_M`. Sin espacios ni comillas ni guion al principio. */
export const NOMBRE_MODELO = /^[A-Za-z0-9][\w.:/-]{0,120}$/;

const clave = (url: string, modelo: string) => `${url}\n${modelo}`;

export function crearBajadas(alCambiar: (b: Bajada) => void) {
  const todas = new Map<string, Bajada>();
  const cortes = new Map<string, AbortController>();

  /** Lo que termina (bien o mal) se avisa y se olvida: `lista()` es sólo lo que baja ahora. */
  const poner = (b: Bajada) => {
    if (b.estado === "bajando") todas.set(clave(b.url, b.modelo), b);
    else todas.delete(clave(b.url, b.modelo));
    alCambiar({ ...b });
  };

  async function correr(b: Bajada, corte: AbortController) {
    try {
      // Sin tope de tiempo total (un modelo grande tarda): sólo se corta si Ollama deja de decir nada.
      const r = await fetch(`${b.url}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: b.modelo, stream: true }),
        signal: corte.signal,
        redirect: "error",
      });
      if (!r.ok || !r.body) {
        // Ollama contesta 404/500 con `{ "error": "…" }` (p. ej. un nombre que no existe).
        const j = (await r.json().catch(() => null)) as { error?: unknown } | null;
        return poner({ ...b, estado: "error", motivo: typeof j?.error === "string" ? j.error.slice(0, 200) : textoT("main.ollamaHttp", { n: r.status }) });
      }
      const lector = r.body.pipeThrough(new TextDecoderStream()).getReader();
      let resto = "";
      let ultimo = b;
      let visto = 0;
      let conTotal = false;
      for (;;) {
        const { done, value } = await lector.read();
        if (done) break;
        resto += value;
        const lineas = resto.split("\n");
        resto = lineas.pop() ?? "";
        for (const l of lineas) {
          if (!l.trim()) continue;
          let j: { status?: unknown; error?: unknown; total?: unknown; completed?: unknown };
          try {
            j = JSON.parse(l);
          } catch {
            continue;
          }
          if (typeof j.error === "string") return poner({ ...ultimo, estado: "error", motivo: j.error.slice(0, 200) });
          const total = typeof j.total === "number" ? j.total : null;
          const completado = typeof j.completed === "number" ? j.completed : total === null ? null : 0;
          ultimo = { ...ultimo, texto: typeof j.status === "string" ? j.status.slice(0, 80) : ultimo.texto, total, completado };
          // Ollama manda un renglón por bloque de unos MB: se avisa a lo sumo cada 250 ms (nunca un evento por renglón),
          // salvo el primero con total tras uno sin total (así la barra no se queda sin su primer número).
          const ahora = Date.now();
          if (ahora - visto >= 250 || total === null || !conTotal) {
            visto = ahora;
            conTotal = total !== null;
            poner(ultimo);
          } else todas.set(clave(b.url, b.modelo), ultimo);
        }
      }
      poner({ ...ultimo, estado: "listo", texto: "success", completado: ultimo.total, motivo: null });
    } catch (e) {
      if (corte.signal.aborted) return poner({ ...b, estado: "error", motivo: textoT("main.ollamaCancelada") });
      poner({ ...b, estado: "error", motivo: textoT("main.ollamaNoContesta") + (e instanceof Error && e.name !== "TypeError" ? ` (${e.message.slice(0, 80)})` : "") });
    } finally {
      cortes.delete(clave(b.url, b.modelo));
    }
  }

  return {
    /** Empieza a bajar `modelo` de `url`; si ya se está bajando eso, no hace nada. Rechaza si el nombre o la dirección no valen. */
    bajar(url: unknown, modelo: unknown): Bajada {
      const base = urlOllama(url);
      if (!base) throw errorT("main.modelosUrl", { v: String(url).slice(0, 60) });
      const nombre = typeof modelo === "string" ? modelo.trim() : "";
      if (!NOMBRE_MODELO.test(nombre)) throw errorT("main.ollamaNombre");
      const k = clave(base, nombre);
      const hay = todas.get(k);
      if (hay && cortes.has(k)) return { ...hay };
      const b: Bajada = { url: base, modelo: nombre, estado: "bajando", texto: "", completado: null, total: null, motivo: null };
      const corte = new AbortController();
      cortes.set(k, corte);
      poner(b);
      void correr(b, corte);
      return { ...b };
    },
    cancelar(url: unknown, modelo: unknown) {
      const base = urlOllama(url);
      if (base && typeof modelo === "string") cortes.get(clave(base, modelo.trim()))?.abort();
    },
    /** Lo que se está bajando ahora (la página recién cargada lo pide). */
    lista(): Bajada[] {
      return [...todas.values()].map((b) => ({ ...b }));
    },
  };
}
