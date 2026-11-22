// «Revisar con IA» del panel Contexto: los tipos que comparten el main (auditoria-contexto.ts) y la ventana (PanelContexto). Puro, sin
// imports de Node. Un hallazgo es un reemplazo exacto en un archivo que se carga siempre (CLAUDE.md, AGENTS.md, GEMINI.md, MEMORY.md y su
// memoria): `buscar` aparece una sola vez en el archivo tal como se leyó al revisar, y se cambia por `reemplazo` (vacío: se borra).

import { tokensAprox } from "./contexto-sesion.ts";

export type TipoHallazgo = "duplicado" | "contradiccion" | "viejo" | "largo";

export type Hallazgo = {
  /** Único dentro de una auditoría (`h1`, `h2`…). */
  id: string;
  tipo: TipoHallazgo;
  /** Ruta absoluta del archivo (la real, nunca la de un enlace). */
  archivo: string;
  /** Texto exacto del archivo, presente una sola vez. */
  buscar: string;
  /** Texto nuevo; `""` borra el fragmento. */
  reemplazo: string;
  /** Una línea: por qué (con dónde está la otra copia si es un duplicado). */
  razon: string;
  /** Tokens que se ahorran por mensaje (`tokensAprox(buscar) - tokensAprox(reemplazo)`, mínimo 0). */
  ahorro: number;
  /** `pendiente` hasta que se aplica; `aplicado`; `invalido` si el archivo cambió y `buscar` ya no está una sola vez. */
  estado: "pendiente" | "aplicado" | "invalido";
};

/** Un archivo que entró en la revisión, con la huella (sha256 del contenido) que tenía al leerlo. */
export type ArchivoAuditado = { ruta: string; tokens: number; huella: string };

export type Auditoria = {
  /** Id de la auditoría (una por proyecto a la vez). */
  id: string;
  /** Carpeta del proyecto que se revisó. */
  cwd: string;
  modelo: string;
  estado: "corriendo" | "lista" | "error";
  /** Lo que va haciendo el revisor (una línea), mientras corre. */
  avance: string | null;
  /** Texto traducido si `estado` es `error`. */
  error: string | null;
  archivos: ArchivoAuditado[];
  hallazgos: Hallazgo[];
  /** Carpeta del último respaldo (`<estado>/md-backup/<fecha>/`), si ya se aplicó algo. */
  respaldo: string | null;
};

// --- El prompt y el parser (puros) -------------------------------------------------------------------------------------------

export const TIPOS_HALLAZGO: readonly TipoHallazgo[] = ["duplicado", "contradiccion", "viejo", "largo"];
/** Lo más que se acepta de una respuesta del revisor. */
export const HALLAZGOS_MAX = 12;
const RAZON_MAX = 300;

/**
 * El texto con saltos `\n`, que es en lo que el revisor copia `buscar`, y si el archivo usa CRLF en todas sus líneas (entonces al escribir se
 * vuelve a CRLF). Un archivo con saltos mezclados se deja tal cual (`crlf: false`): `buscar` tiene que coincidir con lo que hay.
 */
export function textoLF(texto: string): { texto: string; crlf: boolean } {
  const crlf = texto.includes("\r\n") && !/(^|[^\r])\n/.test(texto);
  return { texto: crlf ? texto.replace(/\r\n/g, "\n") : texto, crlf };
}

/** Cuántas veces aparece `buscar` en `texto` (superpuestas cuentan: si se pisa consigo mismo, no es único). */
export function apariciones(texto: string, buscar: string): number {
  if (!buscar) return 0;
  let n = 0;
  for (let i = texto.indexOf(buscar); i >= 0 && n < 2; i = texto.indexOf(buscar, i + 1)) n++;
  return n;
}

/** La consigna al revisor: cada archivo entre `<archivo ruta="…">` y `</archivo>`, y la respuesta en un bloque ```json. */
export function promptAuditor(archivos: readonly { ruta: string; texto: string }[]): string {
  const cuerpo = archivos.map((a) => `<archivo ruta="${a.ruta.replace(/"/g, "'")}">\n${textoLF(a.texto).texto}\n</archivo>`).join("\n\n");
  return [
    "Revisá estos archivos de instrucciones y memoria: todo lo que dicen se manda completo a un modelo de IA en cada mensaje de una conversación, así que cada línea de sobra cuesta.",
    "Buscá cuatro cosas:",
    "- duplicado: lo mismo dicho dos veces (en el mismo archivo o en dos). Se borra una de las copias.",
    "- contradiccion: dos reglas que se pisan. Se arregla dejando una sola.",
    "- viejo: algo que ya no vale (una versión, un pendiente resuelto, una trampa corregida). Se borra o se actualiza.",
    "- largo: un párrafo que se puede decir con la mitad de palabras sin perder nada. Se reemplaza por la versión corta.",
    "",
    "No cambies el sentido de nada: ante la duda, no lo marques. No toques lo que no sobra.",
    "",
    "Respondé SOLO con un bloque ```json con este formato, sin nada más:",
    '{"hallazgos":[{"tipo":"duplicado|contradiccion|viejo|largo","archivo":"<la ruta tal cual aparece en <archivo ruta=…>>","buscar":"<texto copiado TEXTUAL del archivo>","reemplazo":"<texto nuevo; \"\" para borrar>","razon":"<una línea; si es duplicado, dónde está la otra copia>"}]}',
    "",
    `Reglas de cada hallazgo: máximo ${HALLAZGOS_MAX} en total, los que más ahorran primero. \`buscar\` va copiado letra por letra (espacios, mayúsculas y signos incluidos), de 1 a 5 líneas, y tiene que aparecer UNA sola vez en ese archivo: si se repite, sumale líneas de alrededor hasta que sea único. \`archivo\` es una de las rutas de abajo. Si no hay nada que valga la pena, devolvé {"hallazgos":[]}.`,
    "",
    cuerpo,
  ].join("\n");
}

const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/** El JSON de la respuesta: el último bloque ```json (o ``` a secas) que se entienda; si no hay bloque, el primer objeto `{…}` balanceado. */
function jsonDe(salida: string): unknown {
  const bloques = [...salida.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)].map((m) => m[1]);
  for (const b of bloques.reverse()) {
    try {
      return JSON.parse(b);
    } catch {}
  }
  const ini = salida.indexOf("{");
  for (let fin = salida.lastIndexOf("}"); ini >= 0 && fin > ini; fin = salida.lastIndexOf("}", fin - 1)) {
    try {
      return JSON.parse(salida.slice(ini, fin + 1));
    } catch {}
  }
  return null;
}

/**
 * Los hallazgos de la respuesta del revisor, ya validados contra los archivos ORIGINALES: se descartan los que nombran un archivo que no
 * está en la lista, los de un tipo raro y los cuyo `buscar` no aparece exactamente una vez. `ahorro` y los ids (`h1`…) los pone el main.
 */
export function parsearHallazgos(salida: string, archivos: readonly { ruta: string; texto: string }[]): Hallazgo[] {
  const j = jsonDe(salida);
  const lista = obj(j) && Array.isArray(j.hallazgos) ? j.hallazgos : Array.isArray(j) ? j : [];
  const textos = new Map(archivos.map((a) => [a.ruta, textoLF(a.texto).texto]));
  const r: Hallazgo[] = [];
  for (const h of lista) {
    if (r.length >= HALLAZGOS_MAX) break;
    if (!obj(h) || typeof h.archivo !== "string" || typeof h.buscar !== "string") continue;
    const tipo = TIPOS_HALLAZGO.find((t) => t === h.tipo);
    const texto = textos.get(h.archivo);
    if (!tipo || texto === undefined) continue;
    const buscar = h.buscar.replace(/\r\n/g, "\n");
    const reemplazo = typeof h.reemplazo === "string" ? h.reemplazo.replace(/\r\n/g, "\n") : "";
    if (!buscar.trim() || apariciones(texto, buscar) !== 1 || buscar === reemplazo) continue;
    const razon = typeof h.razon === "string" ? h.razon.replace(/\s+/g, " ").trim().slice(0, RAZON_MAX) : "";
    r.push({ id: `h${r.length + 1}`, tipo, archivo: h.archivo, buscar, reemplazo, razon, ahorro: Math.max(0, tokensAprox(buscar) - tokensAprox(reemplazo)), estado: "pendiente" });
  }
  return r;
}
