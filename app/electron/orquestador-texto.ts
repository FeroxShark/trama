// Lo puro del Orquestador de fondo (sin imports de Node ni Electron: lo pueden importar la interfaz React y modelos-tipos.ts).
// Define los presets de contexto por rol (orquestador y workers), los tipos de un encargo y los prompts / parser de la
// revisión previa y la ejecución con decisión.

export const PRESETS_CONTEXTO_ORQ = ["ahorro", "equilibrado", "profundo", "manual"] as const;
export type PresetContextoOrq = (typeof PRESETS_CONTEXTO_ORQ)[number];

/** Topes de contexto por preset (en tokens): `null` significa respetar la configuración manual de `modelos.json`. */
export const TOPES_CONTEXTO_ORQ: Readonly<
  Record<
    Exclude<PresetContextoOrq, "manual">,
    { orquestador: number; liviano: number; estandar: number; pesado: number }
  >
> = {
  ahorro: { orquestador: 200_000, liviano: 150_000, estandar: 200_000, pesado: 200_000 },
  equilibrado: { orquestador: 300_000, liviano: 200_000, estandar: 300_000, pesado: 400_000 },
  profundo: { orquestador: 500_000, liviano: 300_000, estandar: 500_000, pesado: 500_000 },
};

const TIPOS_LIVIANOS = new Set(["mecanico", "lectura"]);
const TIPOS_PESADOS = new Set(["codigo-multi", "diseno", "debug"]);

export function esPresetContextoOrq(x: unknown): x is PresetContextoOrq {
  return typeof x === "string" && (PRESETS_CONTEXTO_ORQ as readonly string[]).includes(x);
}

/** Tope de compactación (en tokens) para el orquestador según el preset elegido; `null` en `manual`. */
export function topeOrquestadorDePreset(preset: PresetContextoOrq): number | null {
  if (preset === "manual") return null;
  return TOPES_CONTEXTO_ORQ[preset].orquestador;
}

/** Tope de compactación (en tokens) para un worker según el preset del orquestador y el `--tipo` del worker; `null` en `manual`. */
export function topeWorkerDePreset(preset: PresetContextoOrq, tipo?: string | null): number | null {
  if (preset === "manual") return null;
  const tabla = TOPES_CONTEXTO_ORQ[preset];
  const norm = (tipo ?? "").trim().toLowerCase().replace("diseño", "diseno");
  if (TIPOS_LIVIANOS.has(norm)) return tabla.liviano;
  if (TIPOS_PESADOS.has(norm)) return tabla.pesado;
  return tabla.estandar;
}

// --- Tipos de encargo --------------------------------------------------------

export type EstadoOrquestador = "revisando" | "consulta" | "ejecutando" | "listo" | "error";

export type PropuestaOrquestador = {
  resumen: string;
  opciones: string[];
  recomendacion: string;
};

export type PlanWorkerOrq = {
  tarea: string;
  tipo: string;
  preset?: string;
  titulo?: string;
  advisor?: string;
  leer?: boolean;
};

export type EncargoOrquestador = {
  id: string;
  lider_sid: string | null;
  proyecto: string;
  modelo: string;
  effort: string;
  preset_contexto: PresetContextoOrq;
  objetivo: string;
  restricciones: string[];
  verificacion: string;
  estado: EstadoOrquestador;
  propuesta?: PropuestaOrquestador;
  workers: string[];
  resumen?: string;
  error?: string;
  creado: number;
  actualizado: number;
  cache_vence?: number;
};

export type RespuestaOrquestador = {
  veredicto: "consulta" | "ejecutar";
  resumen: string;
  propuesta?: PropuestaOrquestador;
  workers: PlanWorkerOrq[];
};

export const MAX_WORKERS_ORQ = 6;
const RESUMEN_MAX = 2_000;
const RECOMENDACION_MAX = 1_500;
const OPCION_MAX = 600;
const OPCIONES_MAX = 10;
const TAREA_MAX = 12_000;
const TITULO_MAX = 120;
const TOKEN_MAX = 48;

// --- Prompts -----------------------------------------------------------------

function bloqueEncargo(e: { proyecto: string; objetivo: string; restricciones: string[]; verificacion: string }): string[] {
  const restricciones = e.restricciones.map((r) => r.trim()).filter(Boolean);
  const verificacion = e.verificacion.trim();
  return [
    "## Encargo",
    `- Proyecto: ${e.proyecto.trim()}`,
    `- Objetivo: ${e.objetivo.trim()}`,
    "- Restricciones explícitas:",
    ...(restricciones.length ? restricciones.map((r) => `  - ${r}`) : ["  - (ninguna)"]),
    `- Verificación esperada: ${verificacion || "(no especificada)"}`,
  ];
}

const BLOQUE_FORMATO_WORKERS = [
  "Reglas para los workers:",
  `- Como máximo ${MAX_WORKERS_ORQ} workers.`,
  "- Cada worker debe tocar archivos disjuntos para evitar conflictos al integrar.",
  '- Campos de cada worker: `tarea` (obligatoria, autocontenida con rutas y verificación), `tipo` (`mecanico`, `lectura`, `codigo-acotado`, `codigo-multi`, `frontend`, `diseno`, `debug`), `preset` opcional (`minimo`, `codigo`, `diseno`, `todo`), `titulo` opcional, `leer` opcional (true sólo si no modifica nada), `advisor` opcional (sólo si la subtarea es muy difícil y necesita segunda opinión en Claude; no lo pongas por defecto).',
];

/**
 * Prompt de revisión previa en sólo lectura: el orquestador inspecciona el proyecto y decide si frenar con
 * `VEREDICTO: CONSULTA` (conflicto, ambigüedad o alternativa claramente mejor) o avanzar con `VEREDICTO: EJECUTAR`.
 */
export function promptRevisionPrevia(e: { proyecto: string; objetivo: string; restricciones: string[]; verificacion: string }): string {
  return [
    "Sos el orquestador de fondo de Trama. Trabajás en SÓLO LECTURA: no edites archivos ni ejecutes comandos que modifiquen el proyecto.",
    "Evaluá el encargo frente al estado real del proyecto antes de abrir worktrees o delegar código.",
    "",
    ...bloqueEncargo(e),
    "",
    "## Formato obligatorio de respuesta",
    "Respondé SIEMPRE con uno de estos dos formatos exactos:",
    "",
    "### Caso A — Si detectás un conflicto, ambigüedad, falta de información de la persona o un camino claramente mejor:",
    "VEREDICTO: CONSULTA",
    "RESUMEN: <qué viste en el proyecto y por qué conviene decidir antes de lanzar workers>",
    "OPCIONES:",
    "- <opción 1 concreta>",
    "- <opción 2 concreta>",
    "RECOMENDACION: <cuál recomendás y por qué>",
    "",
    "### Caso B — Si está todo claro para ejecutar sin repreguntar:",
    "VEREDICTO: EJECUTAR",
    "RESUMEN: <resumen corto del plan de delegación>",
    "```json",
    '{"workers": [{"tarea": "...", "tipo": "codigo-acotado", "preset": "codigo", "titulo": "..."}]}',
    "```",
    "",
    ...BLOQUE_FORMATO_WORKERS,
  ].join("\n");
}

/**
 * Prompt para ejecutar tras la decisión de la persona ante una `consulta` (o ejecución directa sin revisión previa).
 * Pide siempre `VEREDICTO: EJECUTAR`, `RESUMEN` y el bloque JSON de `workers`.
 */
export function promptConDecision(e: {
  proyecto: string;
  objetivo: string;
  restricciones: string[];
  verificacion: string;
  propuesta?: PropuestaOrquestador;
  decision: string;
  cacheVencida?: boolean;
}): string {
  const partes: string[] = [
    "Sos el orquestador de fondo de Trama. Trabajás en SÓLO LECTURA: planificá los workers sin editar archivos.",
    e.cacheVencida
      ? "La sesión anterior venció: arrancás limpio a partir del resumen corto previo y la decisión de la persona."
      : "Retomás el encargo con la decisión confirmada por la persona.",
    "",
    ...bloqueEncargo(e),
  ];

  if (e.propuesta) {
    partes.push("", "## Consulta previa");
    if (e.propuesta.resumen.trim()) partes.push(`- Resumen: ${e.propuesta.resumen.trim()}`);
    if (!e.cacheVencida && e.propuesta.opciones.length) {
      partes.push("- Opciones planteadas:");
      for (const op of e.propuesta.opciones) partes.push(`  - ${op}`);
    }
    if (e.propuesta.recomendacion.trim()) partes.push(`- Recomendación previa: ${e.propuesta.recomendacion.trim()}`);
  }

  partes.push(
    "",
    "## Decisión de la persona",
    e.decision.trim(),
    "",
    "## Formato obligatorio de respuesta",
    "Respondé directamente con:",
    "VEREDICTO: EJECUTAR",
    "RESUMEN: <resumen corto de lo que va a hacer cada worker>",
    "```json",
    '{"workers": [{"tarea": "...", "tipo": "codigo-acotado", "preset": "codigo", "titulo": "..."}]}',
    "```",
    "",
    ...BLOQUE_FORMATO_WORKERS,
  );
  return partes.join("\n");
}

// --- Parser ------------------------------------------------------------------

const recortar = (s: string, max: number): string => {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
};

const tokenSeguro = (v: unknown, max = TOKEN_MAX): string | undefined => {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (!t || t.startsWith("-") || /[\s\0\r\n]/.test(t)) return undefined;
  return t.slice(0, max);
};

const ADVISOR_VACIO = new Set(["none", "ninguno", "null", "false", "no", "off", "-"]);

function normalizarWorker(raw: unknown): PlanWorkerOrq | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const tarea = typeof o.tarea === "string" ? recortar(o.tarea, TAREA_MAX) : "";
  if (!tarea) return null;
  const tipoRaw = tokenSeguro(o.tipo);
  const tipo = tipoRaw ? tipoRaw.toLowerCase().replace("diseño", "diseno") : "codigo-acotado";
  const preset = tokenSeguro(o.preset);
  const tituloRaw = typeof o.titulo === "string" ? o.titulo.replace(/\s+/g, " ").trim() : "";
  const titulo = tituloRaw ? tituloRaw.slice(0, TITULO_MAX).trimEnd() : undefined;
  const advisorRaw = tokenSeguro(o.advisor);
  const advisor = advisorRaw && !ADVISOR_VACIO.has(advisorRaw.toLowerCase()) ? advisorRaw.toLowerCase() : undefined;
  const leer = o.leer === true ? true : undefined;
  return {
    tarea,
    tipo,
    ...(preset ? { preset } : {}),
    ...(titulo ? { titulo } : {}),
    ...(advisor ? { advisor } : {}),
    ...(leer ? { leer } : {}),
  };
}

function extraerWorkersDeJson(valor: unknown): PlanWorkerOrq[] | null {
  const lista = Array.isArray(valor)
    ? valor
    : valor && typeof valor === "object" && Array.isArray((valor as Record<string, unknown>).workers)
      ? ((valor as Record<string, unknown>).workers as unknown[])
      : null;
  if (!lista) return null;
  const validos: PlanWorkerOrq[] = [];
  for (const item of lista) {
    const w = normalizarWorker(item);
    if (w) validos.push(w);
    if (validos.length >= MAX_WORKERS_ORQ) break;
  }
  return validos;
}

/** Busca el primer objeto JSON `{ ... "workers" ... }` balanceado en texto libre si no hubo bloque cercado. */
function extraerJsonBalanceado(texto: string): PlanWorkerOrq[] {
  const idx = texto.indexOf('"workers"');
  if (idx < 0) return [];
  let inicio = texto.lastIndexOf("{", idx);
  while (inicio >= 0) {
    let prof = 0;
    let enCadena = false;
    let escape = false;
    for (let i = inicio; i < texto.length; i++) {
      const ch = texto[i]!;
      if (enCadena) {
        if (escape) escape = false;
        else if (ch === "\\") escape = true;
        else if (ch === '"') enCadena = false;
        continue;
      }
      if (ch === '"') enCadena = true;
      else if (ch === "{") prof++;
      else if (ch === "}") {
        prof--;
        if (prof === 0) {
          try {
            const parsed = JSON.parse(texto.slice(inicio, i + 1));
            const ws = extraerWorkersDeJson(parsed);
            if (ws) return ws;
          } catch {
            /* seguimos probando otro `{` anterior */
          }
          break;
        }
      }
    }
    inicio = texto.lastIndexOf("{", inicio - 1);
  }
  return [];
}

function extraerOpciones(texto: string): string[] {
  const out: string[] = [];
  for (const linea of texto.split("\n")) {
    const limpia = linea
      .trim()
      .replace(/^(?:[-*•]+|\d+[.)])\s+/, "")
      .trim();
    if (!limpia) continue;
    out.push(recortar(limpia, OPCION_MAX));
    if (out.length >= OPCIONES_MAX) break;
  }
  return out;
}

type Seccion = "resumen" | "opciones" | "recomendacion" | null;

/** Quita prefijos de markdown (`#`, `>`, `*`, `_`) alrededor de una etiqueta de encabezado. */
const ETIQUETA = /^(?:[#>*\s_-]*)(?:\*{1,2}|_{1,2})?(VEREDICTO|RESUMEN|OPCIONES|RECOMENDACI[OÓ]N|WORKERS)(?:\*{1,2}|_{1,2})?\s*:\s*(.*)$/i;

/**
 * Parsea la respuesta del orquestador (tolerante a markdown, espacios y tildes; nunca tira excepción).
 * En `consulta`, devuelve `propuesta` y `workers: []`. En `ejecutar`, devuelve los `workers` validados (máx. 6).
 */
export function parsearRespuestaOrquestador(texto: string): RespuestaOrquestador {
  const limpio = typeof texto === "string" ? texto.replace(/\r\n/g, "\n").trim() : "";
  if (!limpio) {
    return {
      veredicto: "consulta",
      resumen: "",
      propuesta: { resumen: "", opciones: [], recomendacion: "" },
      workers: [],
    };
  }

  let veredictoExplicito: "consulta" | "ejecutar" | null = null;
  const secciones: Record<Exclude<Seccion, null>, string[]> = {
    resumen: [],
    opciones: [],
    recomendacion: [],
  };
  let actual: Seccion = null;

  const bloques: { lang: string; cuerpo: string }[] = [];
  let enBloque = false;
  let langBloque = "";
  let lineasBloque: string[] = [];

  for (const linea of limpio.split("\n")) {
    const t = linea.trim();
    if (/^```/.test(t)) {
      if (!enBloque) {
        enBloque = true;
        langBloque = t.slice(3).trim().toLowerCase();
        lineasBloque = [];
      } else {
        bloques.push({ lang: langBloque, cuerpo: lineasBloque.join("\n").trim() });
        enBloque = false;
        langBloque = "";
        lineasBloque = [];
      }
      continue;
    }
    if (enBloque) {
      lineasBloque.push(linea);
      continue;
    }

    const m = ETIQUETA.exec(linea);
    if (m) {
      const clave = m[1]!.toUpperCase().replace("Ó", "O");
      const valor = (m[2] ?? "").replace(/^(?:\*{1,2}|_{1,2})\s*/, "").replace(/\s*(?:\*{1,2}|_{1,2})$/, "").trim();
      if (clave === "VEREDICTO") {
        actual = null;
        if (/\bCONSULTA\b/i.test(valor)) veredictoExplicito = "consulta";
        else if (/\bEJECUTAR\b/i.test(valor)) veredictoExplicito = "ejecutar";
      } else if (clave === "RESUMEN") {
        actual = "resumen";
        if (valor) secciones.resumen.push(valor);
      } else if (clave === "OPCIONES") {
        actual = "opciones";
        if (valor) secciones.opciones.push(valor);
      } else if (clave === "RECOMENDACION") {
        actual = "recomendacion";
        if (valor) secciones.recomendacion.push(valor);
      } else {
        actual = null;
      }
      continue;
    }

    if (actual) secciones[actual].push(linea);
  }

  // Bloques JSON: primero los etiquetados como `json`, luego cualquier bloque cercado, y al final búsqueda balanceada.
  const ordenados = [...bloques.filter((b) => b.lang === "json"), ...bloques.filter((b) => b.lang !== "json")];
  let workers: PlanWorkerOrq[] = [];
  for (const b of ordenados) {
    if (!b.cuerpo) continue;
    try {
      const parsed = JSON.parse(b.cuerpo);
      const ws = extraerWorkersDeJson(parsed);
      if (ws) {
        workers = ws;
        break;
      }
    } catch {
      /* bloque no JSON o mal formado */
    }
  }
  if (!workers.length) workers = extraerJsonBalanceado(limpio);

  const resumen = recortar(secciones.resumen.join("\n"), RESUMEN_MAX);
  const opciones = extraerOpciones(secciones.opciones.join("\n"));
  const recomendacion = recortar(secciones.recomendacion.join("\n"), RECOMENDACION_MAX);

  const veredicto: "consulta" | "ejecutar" =
    veredictoExplicito ?? (workers.length > 0 ? "ejecutar" : "consulta");

  if (veredicto === "consulta") {
    const resumenConsulta = resumen || recortar(limpio, RESUMEN_MAX);
    const propuesta: PropuestaOrquestador = {
      resumen: resumenConsulta,
      opciones,
      recomendacion,
    };
    return {
      veredicto: "consulta",
      resumen: resumenConsulta,
      propuesta,
      workers: [],
    };
  }

  return {
    veredicto: "ejecutar",
    resumen,
    workers,
  };
}
