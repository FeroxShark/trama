// Seguir una conversación con un modelo de OTRO motor (Claude, Gemini, dsh, opencode). El líder es el mismo (mismo `sid`, fila y
// título), pero cada motor guarda su transcript aparte y no entiende el del otro: el motor nuevo arranca una sesión suya con un
// "relevo" —lo hablado hasta acá, sólo texto— y la vista junta los transcripts con una raya en cada cambio. Puro (sin
// archivos): lo prueba `tests/relevo-motor.test.ts`; lider.ts lee los transcripts y lanza el proceso.
import { deDueno, dueno } from "./dueno.ts";
import { convNueva, type Cambio, type Corte, type Crudo, type EstadoConv } from "./lider-arma.ts";

/** Los motores que no se mezclan en una misma sesión (`familiaDeModelo`, modelos-config.ts). */
export type Familia = "claude" | "gemini" | "dsh" | "opencode";

/** Cuánto pesa, como mucho, el historial que se le pasa al motor nuevo (caracteres): lo más nuevo entra, lo viejo se omite. */
export const TOPE_RELEVO = 40_000;
/** Y cuánto de un mismo mensaje: uno enorme (un pegado, una novela) no se come el cupo de los demás. */
const TOPE_MENSAJE = 6_000;
/** Un comando o herramienta resumido en una línea. */
const TOPE_LINEA = 90;
/** Cuántas herramientas se listan por tramo de trabajo del modelo (lo que hizo entre dos mensajes de la persona): las demás, contadas. */
const TOPE_HERRAMIENTAS = 8;

/** Un modelo "genérico" de cada familia, para anotar de dónde venía una sesión cuando no se sabe el modelo exacto. */
export const MODELO_DE_FAMILIA: Record<Familia, string> = { claude: "claude", gemini: "gemini", dsh: "dsh:", opencode: "opencode:" };

/** La hora (ms) de un mensaje; `null` si no la trae. */
export const msDe = (m: Crudo): number | null => {
  const t = m.ts ? Date.parse(m.ts) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** Una raya de "siguió con otro modelo": un mensaje de sistema sin texto, con la hora del cambio. */
const rayaDe = (c: Cambio): Crudo => ({
  rol: "assistant",
  texto: "",
  herramientas: [],
  det: [],
  ts: new Date(c.ts).toISOString(),
  modelo: null,
  mid: null,
  usage: null,
  uuid: null,
  marcas: { cambio: { modelo: c.a } },
});

/**
 * Los transcripts de cada motor, juntos y en orden, con una raya en cada cambio. `porFamilia`: lo leído de cada transcript;
 * `inicial`: el motor con que empezó la conversación; `cambios`: de la más vieja a la más nueva (cada uno con el motor al que pasó).
 * Si un motor aparece en dos tramos (Claude → Gemini → Claude) cada tramo toma los mensajes de su ventana de tiempo.
 * Todos los mensajes conservan su `uuid` (los puentes de agy / dsh / opencode ponen uno propio a cada línea) y llevan `motor`, el
 * motor de cuyo transcript salen: volver atrás, editar y ramificar señalan un mensaje de cualquier tramo (`lider.ts`, `rebobinar`).
 * La `previa` (anterior a una compactación) sólo vale en el último tramo, donde el `claude` carga su propio archivo.
 */
export function unirConvs(porFamilia: Map<Familia, EstadoConv>, inicial: Familia, cambios: { cambio: Cambio; a: Familia }[]): EstadoConv {
  const tramos: { fam: Familia; desde: number; hasta: number }[] = [];
  let fam = inicial;
  let desde = -Infinity;
  for (const c of cambios) {
    tramos.push({ fam, desde, hasta: c.cambio.ts });
    fam = c.a;
    desde = c.cambio.ts;
  }
  tramos.push({ fam, desde, hasta: Infinity });
  const veces = new Map<Familia, number>();
  for (const t of tramos) veces.set(t.fam, (veces.get(t.fam) ?? 0) + 1);
  // Un mensaje sin hora (una marca) va con el anterior de su transcript.
  const horas = new Map<Crudo, number>();
  for (const [, est] of porFamilia) {
    let ultima = -Infinity;
    for (const m of est.todos) {
      ultima = msDe(m) ?? ultima;
      horas.set(m, ultima);
    }
  }
  const todos: Crudo[] = [];
  let compactaciones = 0;
  tramos.forEach((t, k) => {
    const est = porFamilia.get(t.fam) ?? convNueva();
    const esElUltimo = k === tramos.length - 1;
    const suyos = (veces.get(t.fam) ?? 0) > 1 ? est.todos.filter((m) => (horas.get(m) ?? -Infinity) >= t.desde && (horas.get(m) ?? -Infinity) < t.hasta) : est.todos;
    for (const m of suyos) {
      const { previa: _previa, ...resto } = m;
      todos.push({ ...(esElUltimo ? m : resto), motor: t.fam });
    }
    compactaciones += suyos.filter((m) => m.marcas.compacto).length;
    if (!esElUltimo) todos.push(rayaDe(cambios[k].cambio));
  });
  const ultimo = porFamilia.get(tramos[tramos.length - 1].fam);
  return { todos, porId: new Map(), compactaciones, compactada: ultimo?.compactada ?? false, cola: null, posDe: new Map() };
}

/** Los mensajes hasta el que tiene ese `uuid` (inclusive); `null` si no está. */
export function hastaMensaje(est: EstadoConv, uuid: string): EstadoConv | null {
  const k = est.todos.findIndex((m) => m.uuid === uuid);
  return k < 0 ? null : { ...est, todos: est.todos.slice(0, k + 1) };
}

/**
 * Aplica los cortes (volver atrás en un motor que no puede retroceder su sesión, ver `Guardado.cortes`): de cada uno, en orden, se
 * quita lo que viene después del mensaje `uuid` y es anterior al momento del corte. Lo posterior (lo que se habló ya de nuevo) queda.
 * Puro: devuelve una lista nueva. Un `uuid` que no está se ignora.
 */
export function aplicarCortes(todos: Crudo[], cortes: Corte[]): Crudo[] {
  let lista = todos;
  for (const c of [...cortes].sort((a, b) => a.ts - b.ts)) {
    const k = lista.findIndex((m) => m.uuid === c.uuid);
    if (k < 0) continue;
    let ultima = -Infinity;
    const horas = lista.map((m) => (ultima = msDe(m) ?? ultima));
    lista = lista.filter((_, i) => i <= k || horas[i] >= c.ts);
  }
  return lista;
}

/** Un comando, en un renglón corto. */
const unaLinea = (s: string, tope = TOPE_LINEA) => {
  const l = s.split("\n").map((x) => x.trim()).find(Boolean) ?? "";
  return l.length > tope ? `${l.slice(0, tope - 1)}…` : l;
};

/** Lo que hizo una herramienta, en una línea y sin lo que devolvió: "[corrió: git status]", "[usó Read: /x/y.ts]". */
export function lineaDeHerramienta(m: Crudo, k: number): string {
  const d = m.det[k];
  const cmd = d && d.nombre === "Bash" && typeof d.entrada.command === "string" ? d.entrada.command : null;
  if (cmd) return `[corrió: ${unaLinea(cmd)}]`;
  return `[usó ${unaLinea(m.herramientas[k] ?? d?.nombre ?? "?")}]`;
}

/** ¿Es un mensaje de la conversación (el usuario o el modelo), y no una marca o algo que inyecta Claude Code? */
function hablado(m: Crudo): boolean {
  const x = m.marcas;
  if (x.meta || x.error != null || x.compacto || x.destrabo || x.cambio) return false;
  // Una tarea de fondo que terminó, un mensaje de otra sesión, etc.: no lo escribió la persona.
  if (m.rol === "user" && x.origen && x.origen !== "human") return false;
  return true;
}

/** Lo que dijo un mensaje en limpio: el texto (recortado), las imágenes y, si es del modelo, una línea por herramienta. */
type Dicho = { rol: "user" | "assistant"; modelo: string | null; texto: string; herr: string[] };

function dichoDe(m: Crudo): Dicho {
  const imgs = (m.imagenes ?? []).map(() => "[imagen]").join(" ");
  let texto = m.texto.trim();
  if (texto.length > TOPE_MENSAJE) texto = `${texto.slice(0, TOPE_MENSAJE)}… [mensaje recortado]`;
  if (m.rol === "user") return { rol: "user", modelo: null, texto: [texto, imgs].filter(Boolean).join(" "), herr: [] };
  return { rol: "assistant", modelo: m.modelo && m.modelo !== "<synthetic>" ? m.modelo : null, texto, herr: m.herramientas.map((_, k) => lineaDeHerramienta(m, k)) };
}

/** Lo que dijo el modelo entre dos mensajes de la persona, en un solo bloque: un encabezado, sus textos y las herramientas (las repetidas seguidas, una; las que pasan el tope, contadas). */
function bloqueAsistente(partes: Dicho[]): string {
  const modelo = partes.find((d) => d.modelo)?.modelo ?? null;
  const lineas: string[] = [];
  let herr: string[] = [];
  const volcar = () => {
    const unicas = herr.filter((h, i) => h !== herr[i - 1]);
    lineas.push(...unicas.slice(0, TOPE_HERRAMIENTAS));
    if (unicas.length > TOPE_HERRAMIENTAS) lineas.push(`[… y ${unicas.length - TOPE_HERRAMIENTAS} herramientas más]`);
    herr = [];
  };
  for (const d of partes) {
    if (d.texto) {
      volcar();
      lineas.push(d.texto);
    }
    herr.push(...d.herr);
  }
  volcar();
  return lineas.length ? `${modelo ? `Asistente (${modelo})` : "Asistente"}: ${lineas.join("\n")}` : "";
}

/**
 * Los mensajes hablados como bloques para el modelo nuevo: uno por mensaje de la persona y uno por cada tramo de trabajo del modelo
 * (los mensajes seguidos del modelo —una llamada a una herramienta cada uno— se juntan: antes cada uno repetía su encabezado).
 */
function bloquesDe(hablados: Crudo[], quien: string): { t: string; n: number }[] {
  const bloques: { t: string; n: number }[] = [];
  let tramo: Dicho[] = [];
  const cerrar = () => {
    const b = bloqueAsistente(tramo);
    if (b) bloques.push({ t: b, n: tramo.length });
    tramo = [];
  };
  for (const m of hablados) {
    const d = dichoDe(m);
    if (d.rol === "assistant") {
      tramo.push(d);
      continue;
    }
    cerrar();
    if (d.texto) bloques.push({ t: `${quien}: ${d.texto}`, n: 1 });
  }
  cerrar();
  return bloques;
}

export type Relevo = {
  /** El texto completo (la nota y la conversación). `""`: no hay nada hablado todavía. */
  texto: string;
  /** Cuántos mensajes quedaron afuera por el tope (los más viejos). */
  omitidos: number;
  /** Cuántos mensajes entraron. */
  incluidos: number;
};

/**
 * Lo hablado hasta ahora en una conversación (`todos`, ya con los transcripts de todos los motores juntos), armado para el motor que
 * sigue: los textos del usuario y del modelo, lo más nuevo al final; cada herramienta, una línea; las imágenes, "[imagen]". Entra lo
 * más reciente hasta `tope` caracteres y se avisa cuántos mensajes anteriores se omitieron. `desde` (ms): sólo lo posterior a esa
 * hora, para un motor que vuelve a una sesión suya y ya tiene lo anterior. `de` y `a`: los modelos, para la nota.
 */
export function armarRelevo(todos: Crudo[], x: { de: string; a: string; tope?: number; desde?: number; motivo?: "volver" | "ramificar" }): Relevo {
  const tope = x.tope ?? TOPE_RELEVO;
  const quien = dueno();
  const horas = new Map<Crudo, number>();
  let ultima = -Infinity;
  for (const m of todos) {
    ultima = msDe(m) ?? ultima;
    horas.set(m, ultima);
  }
  const bloques = bloquesDe(
    todos.filter((m) => hablado(m) && (x.desde === undefined || (horas.get(m) ?? -Infinity) > x.desde)),
    quien,
  );
  if (!bloques.length) return { texto: "", omitidos: 0, incluidos: 0 };
  // De lo último a lo primero, hasta llenar el cupo; el más nuevo siempre entra (recortado si hace falta).
  const entran: string[] = [];
  let usado = 0;
  let incluidos = 0;
  for (let i = bloques.length - 1; i >= 0; i--) {
    const b = bloques[i];
    const costo = b.t.length + 2;
    if (usado + costo > tope && entran.length) break;
    entran.unshift(costo > tope ? `${b.t.slice(0, Math.max(0, tope - 40))}… [recortado]` : b.t);
    usado += costo;
    incluidos += b.n;
  }
  const omitidos = bloques.reduce((a, b) => a + b.n, 0) - incluidos;
  const nota = [
    x.motivo === "volver"
      ? "# Historial de esta conversación (se volvió atrás)"
      : x.motivo === "ramificar"
        ? "# Historial de esta conversación (rama)"
        : "# Historial de esta conversación (cambio de motor)",
    x.motivo === "volver"
      ? `Esta conversación ${deDueno()} se retomó desde un mensaje anterior: lo que se habló después se descartó y para vos nunca pasó. ${
          x.desde === undefined ? "Abajo está lo hablado hasta ahí." : "Lo anterior ya lo tenés en tu propia sesión; abajo está sólo lo que falta hasta ahí."
        } Seguís vos (\`${x.a}\`), en la misma carpeta y con las mismas herramientas.`
      : x.motivo === "ramificar"
        ? `Esta conversación ${deDueno()} es una rama de otra: arranca desde un mensaje de esa conversación (que venía con \`${x.de}\`) y seguís vos (\`${x.a}\`), en la misma carpeta y con las mismas herramientas.`
        : x.desde === undefined
      ? `Esta conversación ${deDueno()} empezó con \`${x.de}\` y ahora seguís vos (\`${x.a}\`), en la misma carpeta y con las mismas herramientas.`
      : `Ya habías hablado en esta conversación ${deDueno()}, pero siguió un rato con \`${x.de}\` sin vos, y ahora volvés vos (\`${x.a}\`), en la misma carpeta. Lo anterior ya lo tenés en tu propia sesión; abajo está sólo lo que pasó mientras no estabas.`,
    `Abajo está lo hablado: sólo los textos, sin lo que devolvieron las herramientas (cada una aparece resumida en un renglón, por ejemplo "[corrió: git status]"). Tomalo como contexto y seguí desde el último mensaje, sin repetir lo que ya está hecho.`,
    ...(omitidos ? [`(se omitieron ${omitidos} mensajes anteriores)`] : []),
  ].join("\n");
  return { texto: `${nota}\n\n${entran.join("\n\n")}`, omitidos, incluidos };
}
