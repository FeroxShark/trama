// «Revisar con IA» del panel Contexto: los tipos que comparten el main (auditoria-contexto.ts) y la ventana (PanelContexto). Puro, sin
// imports de Node. Un hallazgo es un reemplazo exacto en un archivo que se carga siempre (CLAUDE.md, AGENTS.md, GEMINI.md, MEMORY.md y su
// memoria): `buscar` aparece una sola vez en el archivo tal como se leyó al revisar, y se cambia por `reemplazo` (vacío: se borra).

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
