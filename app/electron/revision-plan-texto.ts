// «Revisar con otro modelo», la parte sin Node (la comparte la ventana): el prompt del revisor, cómo se lee lo que contesta y el
// mensaje que recibe el líder, con una marca para que la ventana lo dibuje como tarjeta del revisor y no como un mensaje de la persona.
// Sin imports: lo prueba tests/revision-plan.test.ts. La orquestación y el corredor: revision-plan.ts.

/** El revisor por defecto (cupo de Google: no gasta el de Claude, que es el del líder). */
export const REVISOR_DEFECTO = "gemini-4-neon";

/** Los niveles de esfuerzo que conoce Ajustes > Modelos, de menor a mayor (los de `efforts_permitidos`). */
const NIVELES = ["low", "medium", "high", "xhigh", "max"] as const;
const FAMILIAS_EFFORT = ["fable", "opus", "sonnet", "haiku", "neon", "argon", "hydrogen", "gpt-oss", "astra", "sol", "luna"];

/**
 * Los esfuerzos que el dueño dejó prendidos en Ajustes > Modelos para ese modelo (`efforts_permitidos`, con la misma cuenta que `pa` y
 * `reparto`: id exacto, id sin el sufijo de esfuerzo o familia). `null`: no hay regla, valen todos; `[]`: los apagó todos.
 */
export function effortsPermitidosDe(modelo: string, permitidos: Readonly<Record<string, readonly string[]>> | null | undefined): string[] | null {
  if (!permitidos) return null;
  const m = modelo.toLowerCase();
  const base = m.replace(/-(?:low|medium|high|xhigh|max)$/, "");
  const f = FAMILIAS_EFFORT.find((x) => m.includes(x));
  const k = [m, base, f].find((x): x is string => x !== undefined && x in permitidos);
  return k === undefined ? null : NIVELES.filter((e) => permitidos[k]!.includes(e));
}

/** ¿Ese esfuerzo está apagado en Ajustes > Modelos para ese modelo? Un esfuerzo vacío (el del modelo) nunca. */
export const effortApagado = (modelo: string, effort: string, permitidos: Readonly<Record<string, readonly string[]>> | null | undefined): boolean => {
  if (!effort) return false;
  const ok = effortsPermitidosDe(modelo, permitidos);
  return ok !== null && !ok.includes(effort.toLowerCase());
};

/**
 * Los esfuerzos que se ofrecen para un revisor y cuál queda de entrada. `admitidos`: los que el modelo corre (su tabla, sin `off`);
 * `permitidos`: lo prendido en Ajustes (los apagados no se ofrecen). `defecto`: el de fábrica del modelo si se ofrece, si no `high`, si
 * no el más alto que no sea `max`: el máximo nunca es el de entrada salvo que sea el único. Sin ninguno que ofrecer: `niveles` vacío y
 * `defecto` vacío (se corre con el esfuerzo propio del modelo).
 */
export function esfuerzosRevisor(
  modelo: string,
  admitidos: readonly string[],
  fabrica: string | null | undefined,
  permitidos: Readonly<Record<string, readonly string[]>> | null | undefined,
): { niveles: string[]; defecto: string } {
  const ok = effortsPermitidosDe(modelo, permitidos);
  const niveles = admitidos.filter((e) => e !== "off" && (ok === null || ok.includes(e)));
  const sinMax = niveles.filter((e) => e !== "max");
  const defecto = [fabrica ?? "", "high"].find((e) => e && sinMax.includes(e)) ?? sinMax.at(-1) ?? niveles[0] ?? "";
  return { niveles, defecto };
}

export type Revision = {
  bien: string;
  riesgos: string;
  mejoras: string;
  /** El plan mejorado entero. */
  plan: string;
  /** El revisor no respetó el formato: lo que dijo, tal cual (las cuatro secciones quedan vacías). */
  libre?: string;
};
export type RevisionVista = Revision & { modelo: string; nombre: string };

/** Un paso del revisor (lo que va leyendo o buscando): `v` es la ruta o el patrón; el texto lo arma la ventana (`revision.paso.<k>`). */
export type PasoRevision = { k: "leer" | "buscar" | "listar" | "otro"; v: string };
/** En qué está una revisión: el revisor trabajando, entregándosela al líder, entregada, con un fallo o cancelada. */
export type FaseRevision = "corriendo" | "entregando" | "hecha" | "fallo" | "cancelada";
/**
 * Una revisión en curso (o la última de ese líder), tal cual la ve la ventana: viaja en el evento `revision` del líder.
 * `error` es un texto del main (clave de i18n codificada, `textoMain` lo traduce); `reintentable`: la revisión ya salió y está
 * guardada en disco, sólo falta entregarla (el botón «Reintentar entregar»).
 */
export type RevisionEstado = {
  id: string;
  sid: string;
  /** El pedido de permiso (ExitPlanMode) que se está revisando. */
  planId: string;
  modelo: string;
  nombre: string;
  fase: FaseRevision;
  /** Cuándo empezó (epoch ms) y cuándo terminó (`null`: sigue). */
  inicio: number;
  fin: number | null;
  /** Los últimos pasos del revisor, el más nuevo al final. */
  pasos: PasoRevision[];
  /** El texto que va saliendo (el del mensaje en curso), recortado. */
  texto: string;
  error: string | null;
  reintentable: boolean;
};
export const PASOS_MAX = 8;
export const TEXTO_VIVO_MAX = 12_000;

/** Las secciones que se le piden al revisor, en orden: `clave` en `Revision`, título y los nombres con que se las reconoce al leer. */
const SECCIONES: { clave: Exclude<keyof Revision, "libre">; titulo: string; alias: RegExp }[] = [
  { clave: "bien", titulo: "Qué está bien", alias: /^(?:qu[eé] est[aá] bien|lo que est[aá] bien|aciertos|what(?:'s| is) good)\b/i },
  { clave: "riesgos", titulo: "Riesgos y huecos", alias: /^(?:riesgos|huecos|problemas|risks|gaps)\b/i },
  { clave: "mejoras", titulo: "Mejoras concretas", alias: /^(?:mejoras|cambios|improvements)\b/i },
  { clave: "plan", titulo: "Plan mejorado", alias: /^(?:plan (?:mejorado|revisado|remasterizado)|improved plan|revised plan)\b/i },
];

/** El prompt del revisor: el plan, el pedido original y las rutas, con el formato exacto de la respuesta. */
export type ArchivoAdjunto = { ruta: string; texto: string; cortado: boolean };

export function promptRevisor(x: { plan: string; pedido: string | null; cwd?: string | null; rutas?: readonly string[]; archivos?: readonly ArchivoAdjunto[] }): string {
  const rutas = [...new Set([...(x.cwd ? [x.cwd] : []), ...(x.rutas ?? [])])];
  return [
    "Sos el revisor de un plan que armó otro modelo (el líder) antes de tocar nada. Tu trabajo es una segunda opinión: encontrar lo que se le escapó, no repetirlo.",
    "No ejecutes comandos ni edites archivos: sólo leés, si hace falta, lo que el plan nombra (si ves sus archivos más abajo, ya están a la vista).",
    "",
    "## Pedido original de la persona",
    x.pedido?.trim() || "(no se pudo recuperar el pedido original: juzgá el plan por lo que dice)",
    ...(rutas.length ? ["", "## Rutas del proyecto", ...rutas.map((r) => `- ${r}`)] : []),
    "",
    "## Plan del líder",
    x.plan.trim(),
    ...(x.archivos?.length
      ? ["", "## Archivos que nombra el plan (leídos por Trama, sólo lectura)", ...x.archivos.flatMap((a) => ["", `### ${a.ruta}${a.cortado ? " (cortado)" : ""}`, "```", a.texto, "```"])]
      : []),
    "",
    "## Cómo contestar",
    "Contestá en español, corto y concreto, con EXACTAMENTE estos cuatro encabezados (nivel 2) y en este orden, sin nada antes ni después:",
    ...SECCIONES.map((s) => `## ${s.titulo}`),
    "",
    "- «Qué está bien»: lo que conviene conservar (1 a 4 viñetas).",
    "- «Riesgos y huecos»: lo que puede salir mal, lo que falta o lo que el plan da por hecho sin comprobarlo. Si no encontrás ninguno, decilo.",
    "- «Mejoras concretas»: cambios puntuales al plan, cada uno accionable.",
    "- «Plan mejorado»: el plan completo ya corregido, en el mismo formato del original, listo para reemplazarlo.",
  ].join("\n");
}

/** Lo que contestó el revisor, partido en sus cuatro secciones. Sin ningún encabezado reconocible: queda todo en `libre`. */
export function parsearRevision(texto: string): Revision {
  const limpio = texto.replace(/\r\n/g, "\n").trim();
  const partes: Partial<Record<(typeof SECCIONES)[number]["clave"], string[]>> = {};
  let actual: (typeof SECCIONES)[number]["clave"] | null = null;
  let hallo = false;
  let dentroDeCodigo = false;
  for (const linea of limpio.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(linea)) dentroDeCodigo = !dentroDeCodigo;
    const h = dentroDeCodigo ? null : /^\s{0,3}#{1,3}\s*(?:\d+[.)]\s*)?(?:\*\*)?(.+?)(?:\*\*)?\s*:?\s*$/.exec(linea);
    const s = h ? SECCIONES.find((x) => x.alias.test(h[1].trim())) : undefined;
    if (s) {
      actual = s.clave;
      hallo = true;
      partes[actual] = [];
    } else if (actual) partes[actual]!.push(linea);
  }
  if (!hallo) return { bien: "", riesgos: "", mejoras: "", plan: "", libre: limpio };
  const g = (k: (typeof SECCIONES)[number]["clave"]) => (partes[k] ?? []).join("\n").trim();
  return { bien: g("bien"), riesgos: g("riesgos"), mejoras: g("mejoras"), plan: g("plan") };
}

const MARCA = /^\[\[revision-de-plan modelo="([^"\n]*)" nombre="([^"\n]*)"\]\]\n/;
const LIBRE = "## Lo que dijo el revisor";
export const sinComillas = (s: string) => s.replace(/["\n\r]/g, " ").trim();

/** El mensaje que recibe el líder: la marca (la ventana lo dibuja como tarjeta), la revisión y lo que se espera de él. */
export function mensajeParaLider(modelo: string, nombre: string, r: Revision): string {
  const cuerpo = r.libre
    ? [LIBRE, r.libre]
    : SECCIONES.flatMap((s) => [`## ${s.titulo}`, r[s.clave] || "(sin nada que decir)", ""]);
  return [
    `[[revision-de-plan modelo="${sinComillas(modelo)}" nombre="${sinComillas(nombre)}"]]`,
    ...cuerpo,
    "## Para vos (líder)",
    `La persona pidió una segunda opinión sobre tu plan a ${sinComillas(nombre)}. Integrá lo que valga, descartá lo que no (decí por qué en una línea) y presentá el plan remasterizado con ExitPlanMode antes de ejecutar nada.`,
  ]
    .join("\n")
    .trim();
}

/** Lo contrario de `mensajeParaLider`: la revisión de un mensaje de usuario que la lleva, o `null` si es un mensaje cualquiera. */
export function leerMensajeRevision(texto: string): RevisionVista | null {
  const t = texto.trimStart();
  const m = MARCA.exec(t);
  if (!m) return null;
  let resto = t.slice(m[0].length).replace(/\n## Para vos \(l[ií]der\)[\s\S]*$/, "");
  const libre = resto.startsWith(LIBRE);
  if (libre) resto = resto.slice(LIBRE.length).replace(/^\n/, "");
  return { modelo: m[1], nombre: m[2], ...(libre ? { bien: "", riesgos: "", mejoras: "", plan: "", libre: resto.trim() } : parsearRevision(resto)) };
}
