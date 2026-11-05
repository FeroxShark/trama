// El título de un chat (líder) que ya se mostró no cambia solo. `tituloLider` (tema.ts) lo recalcula en cada lectura del
// transcript, y su entrada cambia sola: Claude Code reescribe su `ai-title`, llega el generado por Haiku, un transcript
// ilegible un instante o releído tras un reinicio da otra cosa, y la barra se ve distinta ("los nombres se movieron").
// Acá se guarda, por sesión, lo que se mostró (`titulos-fijos.json`, estado de la app):
//   - `manual`: lo puesto a mano en Claude Code (`/rename`, el `name` de la sesión). Manda sobre todo lo inferido, se vuelve a
//     leer en cada vuelta (un /rename nuevo lo reemplaza) y, si por un instante no se lo ve (la sesión murió, el transcript no
//     se pudo leer), se sigue mostrando: lo puesto a mano no se pierde ni cae al título automático.
//   - `provisorio`: el recorte del primer mensaje (`tituloCorto`). Lo único que lo reemplaza es el primer título "bueno".
//   - `final`: el de Claude Code (`ai-title`) o el generado. Ya no se recalcula nunca más.
// El rename hecho desde Trama vive aparte (`nombres.json`, `titulos`) y gana en la barra sobre todo esto.
// Sin imports locales salvo tema.ts (el archivo y su escritura atómica llegan por parámetro): lo prueba
// `tests/titulo-estable.test.ts`.
import { readFile } from "node:fs/promises";
import { nombreInterno, type Tema, tituloLider } from "./tema.ts";

export type Fase = "manual" | "provisorio" | "final";
export type Fijo = { titulo: string; fase: Fase };
export type Fijos = Record<string, Fijo>;

const util = (s: string | null | undefined) => (s && !nombreInterno(s) ? s : null);

/** Lo puesto a mano en Claude Code: el `/rename` o el nombre de la sesión (si no es el interno de la app). */
export const manualDe = (t: Pick<Tema, "custom">, sesion: string): string | null => util(t.custom) ?? util(sesion);

/**
 * Qué título mostrar y qué hay que guardar (`fijar`, o `null` si ya está guardado). Puro.
 * `fijo`: lo que se mostró antes. `generado`: el de Haiku, si ya llegó.
 */
export function decidirTitulo(fijo: Fijo | undefined, t: Pick<Tema, "custom" | "ai" | "primero">, sesion: string, generado?: string | null): { titulo: string; fijar: Fijo | null } {
  const manual = manualDe(t, sesion);
  if (manual) return { titulo: manual, fijar: fijo?.fase === "manual" && fijo.titulo === manual ? null : { titulo: manual, fase: "manual" } };
  // Lo puesto a mano que dejó de verse no vuelve a lo automático.
  if (fijo && (fijo.fase === "manual" || fijo.fase === "final")) return { titulo: fijo.titulo, fijar: null };
  const calculado = tituloLider(t, sesion, generado);
  const bueno = !!(t.ai || generado);
  if (!calculado) return { titulo: fijo?.titulo ?? "", fijar: null };
  if (fijo && !bueno) return { titulo: fijo.titulo, fijar: null };
  return { titulo: calculado, fijar: { titulo: calculado, fase: bueno ? "final" : "provisorio" } };
}

const VERSION = 1;

const deTexto = (crudo: string): Fijos | null => {
  try {
    const j = JSON.parse(crudo);
    if (j?.version !== VERSION || !j.fijos || typeof j.fijos !== "object" || Array.isArray(j.fijos)) return null;
    const r: Fijos = {};
    for (const [sid, f] of Object.entries<any>(j.fijos))
      if (typeof f?.titulo === "string" && f.titulo !== "" && (f.fase === "manual" || f.fase === "provisorio" || f.fase === "final")) r[sid] = { titulo: f.titulo, fase: f.fase };
    return r;
  } catch {
    return null;
  }
};

/**
 * El almacén de lo mostrado. Un archivo que falta es "todavía nada"; uno que no se pudo leer (roto a medias, bloqueado) se
 * prueba con el `.bak` y, si tampoco, NO se escribe nada encima (se sigue sin recordar, pero no se pisa lo guardado).
 */
export function almacenTitulos(archivo: string, escribir: (archivo: string, texto: string) => Promise<void>) {
  let fijos: Fijos | null = null;
  let seguro = true;
  let cola: Promise<void> = Promise.resolve();

  async function cargar(): Promise<Fijos> {
    if (fijos) return fijos;
    let crudo: string | null = null;
    let codigo: string | undefined;
    try {
      crudo = await readFile(archivo, "utf8");
    } catch (e) {
      codigo = (e as NodeJS.ErrnoException)?.code;
    }
    let leido = crudo !== null ? deTexto(crudo) : null;
    if (!leido) leido = await readFile(`${archivo}.bak`, "utf8").then(deTexto, () => null);
    if (!leido && !(crudo === null && codigo === "ENOENT")) {
      // Ilegible y sin respaldo: no se recuerda (la próxima vuelta reintenta) y no se escribe encima.
      seguro = false;
      return {};
    }
    seguro = true;
    return (fijos = leido ?? {});
  }

  function guardar(f: Fijos): void {
    const texto = JSON.stringify({ version: VERSION, fijos: f });
    cola = cola
      .then(() => escribir(archivo, texto))
      .then(() => escribir(`${archivo}.bak`, texto).catch(() => {}))
      .catch(() => {});
  }

  return {
    /** El título a mostrar para `sid`, guardando lo que haga falta. */
    async titulo(sid: string, t: Pick<Tema, "custom" | "ai" | "primero">, sesion: string, generado?: string | null): Promise<string> {
      const f = await cargar();
      const r = decidirTitulo(f[sid], t, sesion, generado);
      if (r.fijar && seguro) {
        f[sid] = r.fijar;
        if (fijos) guardar(f);
      }
      return r.titulo;
    },
    /** Lo que se mostró de `sid` (si el archivo ya se leyó), sin calcular nada. */
    visto: (sid: string): string | undefined => fijos?.[sid]?.titulo,
    cargar,
    /** Espera a que lo pendiente esté en disco (para los tests). */
    vaciar: () => cola,
  };
}
