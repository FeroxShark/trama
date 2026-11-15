// «Revisar con otro modelo», la parte sin Node (la comparte la ventana): el prompt del revisor, cómo se lee lo que contesta y el
// mensaje que recibe el líder, con una marca para que la ventana lo dibuje como tarjeta del revisor y no como un mensaje de la persona.
// Sin imports: lo prueba tests/revision-plan.test.ts. La orquestación y el corredor: revision-plan.ts.

/** El revisor por defecto (cupo de Google: no gasta el de Claude, que es el del líder). */
export const REVISOR_DEFECTO = "gemini-4-argon";
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

/** Las secciones que se le piden al revisor, en orden: `clave` en `Revision`, título y los nombres con que se las reconoce al leer. */
const SECCIONES: { clave: Exclude<keyof Revision, "libre">; titulo: string; alias: RegExp }[] = [
  { clave: "bien", titulo: "Qué está bien", alias: /^(?:qu[eé] est[aá] bien|lo que est[aá] bien|aciertos|what(?:'s| is) good)\b/i },
  { clave: "riesgos", titulo: "Riesgos y huecos", alias: /^(?:riesgos|huecos|problemas|risks|gaps)\b/i },
  { clave: "mejoras", titulo: "Mejoras concretas", alias: /^(?:mejoras|cambios|improvements)\b/i },
  { clave: "plan", titulo: "Plan mejorado", alias: /^(?:plan (?:mejorado|revisado|remasterizado)|improved plan|revised plan)\b/i },
];

/** El prompt del revisor: el plan, el pedido original y las rutas, con el formato exacto de la respuesta. */
export function promptRevisor(x: { plan: string; pedido: string | null; cwd?: string | null; rutas?: readonly string[] }): string {
  const rutas = [...new Set([...(x.cwd ? [x.cwd] : []), ...(x.rutas ?? [])])];
  return [
    "Sos el revisor de un plan que armó otro modelo (el líder) antes de tocar nada. Tu trabajo es una segunda opinión: encontrar lo que se le escapó, no repetirlo.",
    "No ejecutes comandos ni edites archivos: sólo leés, si hace falta, lo que el plan nombra.",
    "",
    "## Pedido original de la persona",
    x.pedido?.trim() || "(no se pudo recuperar el pedido original: juzgá el plan por lo que dice)",
    ...(rutas.length ? ["", "## Rutas del proyecto", ...rutas.map((r) => `- ${r}`)] : []),
    "",
    "## Plan del líder",
    x.plan.trim(),
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
    `Ferox pidió una segunda opinión sobre tu plan a ${sinComillas(nombre)}. Integrá lo que valga, descartá lo que no (decí por qué en una línea) y presentá el plan remasterizado con ExitPlanMode antes de ejecutar nada.`,
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
