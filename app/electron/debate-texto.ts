// Modo debate entre modelos (etapa 2), la parte sin Node (la comparte la ventana): los tipos del estado y del evento `debate:turno`, el
// prompt de un turno y el de la conclusión, cómo se lee lo que contesta cada modelo (Postura / Argumento / Plan propuesto / Pregunta
// para el dueño), la cuenta de si coinciden del todo y el mensaje que recibe el líder (con una marca, como la revisión de la etapa 1).
// Sin imports de Node: lo prueba tests/debate.test.ts. El moderador (rondas, turnos, cortes): debate.ts. Diseño: docs/modo-debate-diseno.md.
import { PLAN_MAX, SIN_NADA, sinComillas, type ArchivoAdjunto, type PasoRevision } from "./revision-plan-texto.ts";

/** Rondas: de 1 a 3 (default 2). En cada una habla cada participante una vez. */
export const RONDAS_MIN = 1;
export const RONDAS_MAX = 3;
export const RONDAS_DEFECTO = 2;
/** Participantes: 2 o 3 (con uno solo es una revisión simple). */
export const PARTICIPANTES_MIN = 2;
export const PARTICIPANTES_MAX = 3;
/** Tope duro de turnos por modelo, también con preguntas de por medio. */
export const TURNOS_MAX_POR_MODELO = 3;
/** Cuánto de lo dicho por cada participante se le pasa a los demás (caracteres). */
export const TRANSCRIPCION_MAX = 6000;
/** El argumento de un turno que leen los demás se recorta a esto: lo que importa del turno es su plan, que no se corta salvo que pase `PLAN_MAX`. */
export const ARGUMENTO_MAX = 1500;
/** Lo más que entra de un solo turno en lo que leen los demás: el argumento recortado más un plan de tamaño máximo. */
const TURNO_MAX = ARGUMENTO_MAX + PLAN_MAX + 1000;
/** Cuánto se espera la respuesta del dueño a una pregunta antes de seguir sin ella. */
export const PREGUNTA_ESPERA_MS = 10 * 60_000;
/** Cuántas opciones puede traer una pregunta (más de eso se recorta; menos de 2 no es una pregunta con botones). */
export const OPCIONES_MIN = 2;
export const OPCIONES_MAX = 4;

/** Lo que piensa el modelo tras su turno. */
export type Postura = "acuerdo" | "cambio" | "pregunta";
export type PreguntaDebate = { texto: string; opciones: string[] };
/** Lo que dijo un turno, ya partido en sus secciones. `libre`: no respetó el formato y es lo que dijo, tal cual. */
export type TurnoLeido = { postura: Postura; argumento: string; plan: string | null; pregunta: PreguntaDebate | null; libre?: string };

/** Un modelo del debate con su esfuerzo (el que eligió el dueño, o el de entrada; `""` = el propio del modelo). */
export type Participante = { modelo: string; effort: string };

/**
 * Una línea de lo que se ve del debate, en orden:
 * - `turno`: lo que dijo un modelo (postura, argumento, plan propuesto, pregunta);
 * - `dueno`: la respuesta del dueño a una pregunta (`argumento` lleva lo que contestó);
 * - `fallo`: un modelo falló y salió del debate (`error`: texto del main con clave de i18n, `textoMain` lo traduce);
 * - `nota`: algo que se dice sin que nadie lo diga (se siguió sin respuesta, se ignoró una segunda pregunta…): `clave` + `vars` de i18n;
 * - `conclusion`: la conclusión conjunta (`argumento` lleva los acuerdos y `plan` el plan consensuado).
 */
export type LineaDebate = {
  n: number;
  tipo: "turno" | "dueno" | "fallo" | "nota" | "conclusion";
  modelo: string;
  nombre: string;
  ronda: number;
  postura: Postura | null;
  argumento: string;
  plan: string | null;
  pregunta: PreguntaDebate | null;
  error: string | null;
  /** Sólo en la conclusión: lo que quedó sin acuerdo (el texto crudo de la sección). */
  desacuerdos?: string;
  /** Lo que el modelo leyó y usó para decir esto (sus pasos). */
  pasos?: PasoRevision[];
  clave?: string;
  vars?: Record<string, string | number>;
};

/** En qué está el debate. */
export type FaseDebate = "corriendo" | "esperando" | "concluyendo" | "entregando" | "hecho" | "cancelado" | "fallo";
/** Por qué terminó: todos coincidieron, se llegó al tope de rondas, el dueño cortó, o quedó un solo modelo y fue una revisión simple. */
export type MotivoDebate = "acuerdo" | "tope" | "cortado" | "simple";

/** Lo que un modelo hace en su turno en curso: los pasos que dio (lo que leyó) y el texto que va saliendo. */
export type VivoDebate = { texto: string; pasos: PasoRevision[] };
export type ParticipanteVisto = { modelo: string; nombre: string; effort: string; turnos: number; activo: boolean; /** Su turno en curso (`undefined`: no está hablando). */ vivo?: VivoDebate };
/** La pregunta que tiene el debate en pausa, para que la ventana la dibuje con un botón por opción (más «Elegí vos»). */
export type PreguntaPendiente = { modelo: string; nombre: string; ronda: number; texto: string; opciones: string[]; hasta: number };

/** El estado del debate tal cual lo ve la ventana. `error`: texto del main (clave de i18n codificada). */
export type EstadoDebate = {
  id: string;
  sid: string;
  rondas: number;
  /** La ronda en curso (0 antes de empezar). */
  ronda: number;
  fase: FaseDebate;
  participantes: ParticipanteVisto[];
  lineas: LineaDebate[];
  pregunta: PreguntaPendiente | null;
  motivo: MotivoDebate | null;
  error: string | null;
  inicio: number;
  fin: number | null;
};
/** Lo que viaja en el evento `debate:turno`: el estado completo y la línea que se acaba de sumar (`null`: sólo cambió el estado). */
export type EventoDebate = { estado: EstadoDebate; linea: LineaDebate | null };

/** Lo que el dueño contestó a una pregunta: una de las opciones, «Elegí vos» (`null`) o nada a tiempo (`"sin-respuesta"`). */
export type RespuestaDebate = string | null | "sin-respuesta";

/** La conclusión conjunta, partida en sus secciones. `libre`: no respetó el formato. */
export type ConclusionDebate = { acuerdos: string; desacuerdos: string; plan: string; libre?: string };
/** Lo que se le entrega al líder y la ventana dibuja como tarjeta del debate. */
export type DebateVista = ConclusionDebate & { modelos: string[]; nombres: string[]; motivo: Exclude<MotivoDebate, "simple">; rondas: number };

// ───────────────────────── Leer lo que contesta un turno ─────────────────────────

type Seccion = "postura" | "argumento" | "plan" | "pregunta";
const SECCIONES_TURNO: { clave: Seccion; alias: RegExp }[] = [
  { clave: "postura", alias: /^postura\b/i },
  { clave: "argumento", alias: /^argumento\b/i },
  { clave: "plan", alias: /^plan(?:\s+(?:propuesto|mejorado))?\b/i },
  { clave: "pregunta", alias: /^pregunta(?:\s+(?:para|a)\s+(?:el\s+due(?:ñ|n)o|la persona))?\b/i },
];

/** Parte un texto en secciones por sus encabezados (nivel 1 a 3, fuera de los bloques de código). `hallo`: se reconoció alguno. */
function partir<K extends string>(texto: string, defs: readonly { clave: K; alias: RegExp }[]): { partes: Partial<Record<K, string>>; hallo: boolean } {
  const lineas = texto.replace(/\r\n/g, "\n").trim().split("\n");
  const acum: Partial<Record<K, string[]>> = {};
  let actual: K | null = null;
  let hallo = false;
  let codigo = false;
  for (const linea of lineas) {
    if (/^\s*(?:```|~~~)/.test(linea)) codigo = !codigo;
    const h = codigo ? null : /^\s{0,3}#{1,3}\s*(?:\d+[.)]\s*)?(?:\*\*)?(.+?)(?:\*\*)?\s*:?\s*$/.exec(linea);
    // Cada sección se abre una sola vez y en el orden de `defs`: un «## Plan de pruebas» dentro del plan es parte del plan.
    const s = h ? defs.find((x) => x.alias.test(h[1]!.trim())) : undefined;
    if (s && defs.indexOf(s) > (actual ? defs.findIndex((x) => x.clave === actual) : -1)) {
      actual = s.clave;
      hallo = true;
      acum[actual] = [];
    } else if (actual) acum[actual]!.push(linea);
  }
  const partes: Partial<Record<K, string>> = {};
  for (const d of defs) if (acum[d.clave]) partes[d.clave] = acum[d.clave]!.join("\n").trim();
  return { partes, hallo };
}

/** La postura que dice una sección (`acuerdo`, «de acuerdo», «propone cambio», «pregunta»…); `null` si no se entiende. */
export function leerPostura(texto: string | undefined): Postura | null {
  const t = (texto ?? "").split("\n").find((l) => l.trim())?.toLowerCase().replace(/[*_`:.]/g, " ") ?? "";
  if (/\b(?:desacuerdo|cambio|cambios|propone|propongo|modific)/.test(t)) return "cambio";
  if (/\bacuerdo\b/.test(t)) return "acuerdo";
  if (/\bpregunt/.test(t)) return "pregunta";
  return null;
}

/** La pregunta de una sección: el enunciado y 2 a 4 opciones (`- opción`). Sin al menos 2 opciones no es una pregunta con botones: `null`. */
export function leerPregunta(texto: string | undefined): PreguntaDebate | null {
  if (!texto?.trim()) return null;
  const enunciado: string[] = [];
  const opciones: string[] = [];
  for (const l of texto.split("\n")) {
    const o = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/.exec(l);
    if (o) opciones.push(o[1]!.replace(/^\*\*(.+)\*\*$/, "$1"));
    else if (l.trim()) enunciado.push(l.trim());
  }
  const unicas = [...new Set(opciones)].slice(0, OPCIONES_MAX);
  if (unicas.length < OPCIONES_MIN || !enunciado.length) return null;
  return { texto: enunciado.join(" "), opciones: unicas };
}

const SIN_PLAN = /^\(?\s*(?:ninguno|sin cambios?|no hay|n\/a|—|-)\s*\)?\.?$/i;

/**
 * Lo que contestó un participante en su turno. La postura sale de `## Postura`; si falta o no se entiende se deduce con prudencia:
 * con una pregunta válida es `pregunta`, con un plan propuesto es `cambio` y, sin nada, `cambio` también (nunca se da un «acuerdo» que
 * el modelo no dijo, porque corta el debate). Una pregunta sin 2 opciones se ignora. Sin ningún encabezado: todo queda en `libre`.
 */
export function parsearTurno(texto: string): TurnoLeido {
  const limpio = texto.replace(/\r\n/g, "\n").trim();
  const { partes, hallo } = partir(limpio, SECCIONES_TURNO);
  if (!hallo) return { postura: "cambio", argumento: limpio, plan: null, pregunta: null, libre: limpio };
  const pregunta = leerPregunta(partes.pregunta);
  const plan = partes.plan && !SIN_PLAN.test(partes.plan.trim()) ? partes.plan.trim() : null;
  const dicha = leerPostura(partes.postura);
  const postura: Postura = pregunta ? "pregunta" : dicha === "acuerdo" ? "acuerdo" : "cambio";
  return { postura, argumento: (partes.argumento ?? "").trim(), plan, pregunta };
}

const normal = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** ¿Dos planes son el mismo (sin mirar mayúsculas ni espacios)? */
export const mismoPlan = (a: string | null, b: string | null): boolean => normal(a ?? "") === normal(b ?? "");

/**
 * ¿Una ronda completa termina en acuerdo total? Hacen falta al menos 2 turnos, ninguno con pregunta, y que todos coincidan: todos
 * dicen `acuerdo` y, si traen un plan, es el mismo; o todos proponen exactamente el mismo plan. Devuelve el plan en que coinciden
 * (`""`: ninguno propuso cambios, queda el del líder) o `null` si no hay acuerdo.
 */
export function acuerdoTotal(ronda: readonly Pick<TurnoLeido, "postura" | "plan">[]): { plan: string } | null {
  if (ronda.length < 2 || ronda.some((t) => t.postura === "pregunta")) return null;
  const planes = ronda.flatMap((t) => (t.plan ? [t.plan] : []));
  if (planes.some((p) => !mismoPlan(p, planes[0]!))) return null;
  const todosAcuerdo = ronda.every((t) => t.postura === "acuerdo");
  const todosCambio = planes.length === ronda.length && ronda.every((t) => t.postura === "cambio");
  return todosAcuerdo || todosCambio ? { plan: planes[0] ?? "" } : null;
}

// ───────────────────────── Prompts ─────────────────────────

/** Lo que se le cuenta a un modelo de lo dicho hasta ahora: quién, en qué ronda y el texto de cada turno. */
export type DichoDebate = { quien: string; ronda: number; texto: string };

/** El texto de un turno tal como lo leen los demás. */
export function textoDeTurno(t: Pick<TurnoLeido, "postura" | "argumento" | "plan" | "pregunta" | "libre">): string {
  if (t.libre) return t.libre;
  return [
    `Postura: ${t.postura}`,
    t.argumento ? `Argumento: ${t.argumento.length > ARGUMENTO_MAX ? `${t.argumento.slice(0, ARGUMENTO_MAX)}… (recortado)` : t.argumento}` : "",
    t.plan ? `Plan propuesto:\n${t.plan}` : "",
    t.pregunta ? `Pregunta para el dueño: ${t.pregunta.texto} (${t.pregunta.opciones.join(" / ")})` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Lo dicho hasta ahora, listo para pegar en un prompt: de cada participante entra lo más reciente hasta ~`max` caracteres (lo más viejo se
 * omite y se avisa), y todo sale en el orden en que se dijo.
 */
export function transcripcionParaPrompt(dicho: readonly DichoDebate[], max = TRANSCRIPCION_MAX): string {
  const gastado = new Map<string, number>();
  const entran = new Set<number>();
  for (let i = dicho.length - 1; i >= 0; i--) {
    const d = dicho[i]!;
    const g = gastado.get(d.quien) ?? 0;
    if (g + d.texto.length > max && g > 0) continue;
    gastado.set(d.quien, g + d.texto.length);
    entran.add(i);
  }
  const sal: string[] = [];
  let omitido = false;
  dicho.forEach((d, i) => {
    if (!entran.has(i)) {
      omitido = true;
      return;
    }
    const tope = Math.max(max, TURNO_MAX);
    const cuerpo = d.texto.length > tope ? `${d.texto.slice(0, tope)}\n(recortado)` : d.texto;
    sal.push(`### ${d.quien} · ronda ${d.ronda}`, cuerpo, "");
  });
  return [...(omitido ? ["(se omiten turnos anteriores muy largos)", ""] : []), ...sal].join("\n").trim();
}

type ContextoPrompt = { plan: string; pedido: string | null; cwd?: string | null; archivos?: readonly ArchivoAdjunto[]; dicho: readonly DichoDebate[] };

function bloqueContexto(x: ContextoPrompt): string[] {
  return [
    "## Pedido original de la persona",
    x.pedido?.trim() || "(no se pudo recuperar el pedido original: juzgá el plan por lo que dice)",
    ...(x.cwd ? ["", "## Rutas del proyecto", `- ${x.cwd}`] : []),
    "",
    "## Plan del líder",
    x.plan.trim(),
    ...(x.archivos?.length
      ? ["", "## Archivos que nombra el plan (leídos por Trama, sólo lectura)", ...x.archivos.flatMap((a) => ["", `### ${a.ruta}${a.cortado ? " (cortado)" : ""}`, "```", a.texto, "```"])]
      : []),
    ...(x.dicho.length ? ["", "## Lo que se dijo hasta ahora en el debate", "", transcripcionParaPrompt(x.dicho)] : []),
  ];
}

/** El prompt del turno de un participante. */
export function promptTurno(x: ContextoPrompt & { nombre: string; otros: readonly string[]; ronda: number; rondas: number; puedePreguntar: boolean }): string {
  return [
    `Sos ${x.nombre}, uno de los modelos que debaten un plan que armó otro modelo (el líder) antes de tocar nada. Debaten ${[x.nombre, ...x.otros].join(", ")}, de a uno por vez. Esta es la ronda ${x.ronda} de ${x.rondas}.`,
    "Tu trabajo: decir con honestidad si el plan está bien o qué cambiarías, leyendo lo que dijeron los demás (si ya hablaron). No repitas lo que ya se dijo: coincidí en una línea o discutilo con un motivo. No hace falta ser amable ni llegar a un acuerdo a la fuerza.",
    "No ejecutes comandos ni edites archivos: sólo leés, si hace falta, lo que el plan nombra (si ves sus archivos más abajo, ya están a la vista).",
    "",
    ...bloqueContexto(x),
    "",
    "## Cómo contestar",
    "Contestá en español con estos encabezados (nivel 2), en este orden y sin nada antes ni después:",
    "## Postura",
    "una sola palabra: `acuerdo` (el plan o la propuesta vigente está bien así), `cambio` (proponés cambios) o `pregunta` (necesitás que el dueño decida algo para seguir).",
    "## Argumento",
    "tu razón, en 150 palabras o menos.",
    "## Plan propuesto",
    "sólo si la postura es `cambio`: el plan completo ya corregido, en el mismo formato del original. Si no, omití esta sección.",
    ...(x.puedePreguntar
      ? [
          "## Pregunta para el dueño",
          "sólo si de verdad hace falta que decida la persona: la pregunta en una línea y después 2 a 4 opciones, una por línea, con `- opción`. Si no, omití esta sección.",
        ]
      : ["(En esta ronda no podés preguntarle al dueño: ya se le preguntó algo.)"]),
  ].join("\n");
}

/** El prompt de la conclusión: quien tiene más cupo junta lo dicho en acuerdos, desacuerdos que quedan y el plan consensuado. */
export function promptConclusion(x: ContextoPrompt & { nombre: string; participantes: readonly string[] }): string {
  return [
    `Sos ${x.nombre}. ${x.participantes.join(", ")} debatieron un plan que armó otro modelo (el líder). Te toca cerrar el debate con una conclusión conjunta, fiel a lo que se dijo (incluidas las respuestas del dueño): no agregues ideas nuevas.`,
    "No ejecutes comandos ni edites archivos.",
    "",
    ...bloqueContexto(x),
    "",
    "## Cómo contestar",
    "Contestá en español, corto y concreto, con EXACTAMENTE estos tres encabezados (nivel 2) y en este orden, sin nada antes ni después:",
    "## Acuerdos",
    "## Desacuerdos que quedan",
    "## Plan consensuado",
    "",
    "- «Acuerdos»: en lo que coincidieron (viñetas).",
    "- «Desacuerdos que quedan»: lo que no se resolvió y por qué (si no queda ninguno, decilo).",
    "- «Plan consensuado»: el plan completo, listo para reemplazar al del líder, en el mismo formato del original. Donde no se resolvió algo, elegí lo más prudente y decilo en una línea.",
  ].join("\n");
}

const SECCIONES_CONCLUSION: { clave: "acuerdos" | "desacuerdos" | "plan"; alias: RegExp }[] = [
  { clave: "acuerdos", alias: /^acuerdos?\b/i },
  { clave: "desacuerdos", alias: /^desacuerdos?\b/i },
  { clave: "plan", alias: /^plan\b/i },
];

/** La conclusión que contestó el moderador, en sus tres secciones. Sin ningún encabezado reconocible: queda todo en `libre`. */
export function parsearConclusion(texto: string): ConclusionDebate {
  const limpio = texto.replace(/\r\n/g, "\n").trim();
  const { partes, hallo } = partir(limpio, SECCIONES_CONCLUSION);
  if (!hallo) return { acuerdos: "", desacuerdos: "", plan: "", libre: limpio };
  const g = (t: string | undefined) => (t === SIN_NADA ? "" : (t ?? ""));
  return { acuerdos: g(partes.acuerdos), desacuerdos: g(partes.desacuerdos), plan: g(partes.plan) };
}

// ───────────────────────── El mensaje para el líder ─────────────────────────

const MARCA = /^\[\[debate-de-plan modelos="([^"\n]*)" rondas="(\d+)" motivo="(acuerdo|tope|cortado)"\]\]\n/;
const LIBRE = "## Lo que concluyeron";

/** El mensaje que recibe el líder: la marca (la ventana lo dibuja como tarjeta del debate), la conclusión y lo que se espera de él. */
export function mensajeDebateParaLider(v: DebateVista): string {
  const cuerpo = v.libre
    ? [LIBRE, v.libre]
    : [
        "## Acuerdos",
        v.acuerdos || SIN_NADA,
        "",
        "## Desacuerdos que quedan",
        v.desacuerdos || SIN_NADA,
        "",
        "## Plan consensuado",
        v.plan || SIN_NADA,
        "",
      ];
  const quienes = v.nombres.map(sinComillas).join(", ");
  return [
    `[[debate-de-plan modelos="${v.nombres.map(sinComillas).join("|")}" rondas="${v.rondas}" motivo="${v.motivo}"]]`,
    ...cuerpo,
    "## Para vos (líder)",
    `La persona pidió que ${quienes} debatieran tu plan. Integrá el plan consensuado, descartá lo que no (decí por qué en una línea) y presentá el plan remasterizado con ExitPlanMode antes de ejecutar nada.`,
  ]
    .join("\n")
    .trim();
}

/** Lo contrario de `mensajeDebateParaLider`: lo que se ve del debate en un mensaje de usuario que lo lleva, o `null` si es un mensaje cualquiera. */
export function leerMensajeDebate(texto: string): Pick<DebateVista, "nombres" | "rondas" | "motivo" | "acuerdos" | "desacuerdos" | "plan" | "libre"> | null {
  const t = texto.trimStart();
  const m = MARCA.exec(t);
  if (!m) return null;
  let resto = t.slice(m[0].length).replace(/\n## Para vos \(l[ií]der\)[\s\S]*$/, "");
  const libre = resto.startsWith(LIBRE);
  if (libre) resto = resto.slice(LIBRE.length).replace(/^\n/, "");
  return {
    nombres: m[1]!.split("|"),
    rondas: Number(m[2]),
    motivo: m[3] as DebateVista["motivo"],
    ...(libre ? { acuerdos: "", desacuerdos: "", plan: "", libre: resto.trim() } : parsearConclusion(resto)),
  };
}
