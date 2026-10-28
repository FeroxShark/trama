// La rúbrica (protocolo v2, motor/docs/protocolo-orquestacion-v2.md, sección 6): las respuestas de una subtarea dan modelo y
// effort antes de lanzar. Port de rubrica_resolver y cmd_rubrica de motor/bin/pa; gana la primera fila que aplique, en el mismo
// orden que el bash.
import type { Io } from "./entorno.ts";
import type { Modelos } from "./modelos.ts";

export interface Rubrica {
  /** 0 = se lanza, 3 = la fila dice «no se lanza», 2 = texto mal armado, 98 = la fila da algo que el dueño apagó. */
  rc: number;
  norm: string;
  fila: string;
  modelo: string;
  effort: string;
  tipo: string;
  nota: string;
}

const FORMA =
  "Va así: 'A=chico B=ejecutar C=completo D=bajo E=si' (A: chico|mediano|grande, B: ejecutar|decidir, C: completo|parcial|ninguno, D: bajo|alto, E: si|no; opcionales I, K, M: si|no).";
const sinTilde = (v: string) => v.replace(/á/g, "a").replace(/é/g, "e").replace(/í/g, "i").replace(/ó/g, "o").replace(/ú/g, "u");

function tamano(v: string): string | null {
  if (["chico", "1", "uno"].includes(v)) return "chico";
  if (["mediano", "2", "3", "2-3", "2–3", "2a3"].includes(v)) return "mediano";
  if (["grande", ">3", ">=4", "4+", "3+", "mas", "mas3", "mas-de-3", "masde3", "+3"].includes(v) || /^[4-9]$/.test(v) || /^[1-9][0-9]/.test(v)) return "grande";
  return null;
}

/** `rubrica_resolver`: los mensajes de error salen por `io.err`. */
export function resolverRubrica(texto: string, modelos: Modelos, io: Io): Rubrica {
  const r: Rubrica = { rc: 0, norm: "", fila: "", modelo: "", effort: "", tipo: "", nota: "" };
  const mal = (msg: string): Rubrica => {
    io.err(`pa: --rubrica: ${msg}\n`);
    return { ...r, rc: 2 };
  };
  const v: Record<string, string> = { A: "", B: "", C: "", D: "", E: "", I: "no", K: "no", M: "no" };
  const opciones: Record<string, [string[], string]> = {
    B: [["ejecutar", "decidir"], "ejecutar o decidir"],
    C: [["completo", "parcial", "ninguno"], "completo, parcial o ninguno"],
    D: [["bajo", "alto"], "bajo o alto"],
    E: [["si", "no"], "si o no"],
    I: [["si", "no"], "si o no"],
    K: [["si", "no"], "si o no"],
    M: [["si", "no"], "si o no"],
  };
  for (const t of texto.replace(/,/g, " ").split(/[ \t\n]+/).filter(Boolean)) {
    if (!t.includes("=")) return mal(`'${t}' no es CLAVE=valor. ${FORMA}`);
    const k = t.slice(0, t.indexOf("=")).toUpperCase();
    const x = sinTilde(t.slice(t.indexOf("=") + 1).toLowerCase());
    if (k === "A") {
      const a = tamano(x);
      if (!a) return mal(`A='${x}' no va (A = chico, mediano o grande; o 1, 2-3 o >3).`);
      v.A = a;
    } else if (opciones[k]) {
      const [validas, texto] = opciones[k];
      if (!validas.includes(x)) return mal(`${k}='${x}' no va (${texto}).`);
      v[k] = x;
    } else return mal(`la clave '${k}' no existe (A, B, C, D, E; opcionales I, K, M).`);
  }
  const { A, B, C, D, E, I, K, M } = v as Record<string, string>;
  if (!A || !B || !C || !D || !E) return mal("faltan respuestas. Van las cinco: 'A=chico B=ejecutar C=completo D=bajo E=si'.");
  r.norm = `A=${A} B=${B} C=${C} D=${D} E=${E}${I === "si" ? " I=si" : ""}${K === "si" ? " K=si" : ""}${M === "si" ? " M=si" : ""}`;
  const fila = (f: string, modelo = "", effort = "", nota = "", rc = 0) => Object.assign(r, { fila: f, modelo, effort, nota, rc });
  const SONNET = "claude-sonnet-5-5";
  const OPUS = "claude-opus-5-5";
  const HAIKU = "claude-haiku-5-5";
  // Sin chequeo no se lanza, sea cual sea el tamaño: va primero.
  if (C === "ninguno") fila("2", "", "", "Escribir el chequeo (F4). Si es imposible (puro visual), tratar como C=parcial.", 3);
  else if (A === "grande" && I !== "si") fila("1", "", "", "Volver a F3 y partir (o extraer T0).", 3);
  else if (A === "grande" && K === "si") fila("1c", "", "", "Pasar al dueño (tablero): la corrida de 1b ya compactó y partir otra vez no alcanza.", 3);
  else if (A === "grande") {
    fila("1b", SONNET, "high", "Indivisible: tope de lectura 80 KB. Si compacta, la próxima va a la fila 1c (al dueño).");
    if (D === "alto") Object.assign(r, { modelo: OPUS, effort: "medium", nota: `${r.nota} Con D=alto, F7 obligatoria.` });
  } else if (E === "no" && D === "alto") fila("3a", OPUS, "medium", "Antes, F2 variante hipótesis (abanico). Si una se confirma, E=si y se re-puntúa. F7 obligatoria.");
  else if (E === "no") fila("3b", SONNET, "high", "Antes, F2 variante hipótesis. Si una se confirma, E=si y se re-puntúa.");
  else if (B === "decidir" && D === "alto") fila("4", OPUS, "medium", "F7 obligatoria. Opus high sólo con OK del dueño.");
  else if (B === "decidir") fila("5", SONNET, "high");
  else if (C === "parcial" && D === "alto") fila("6", SONNET, "high", "PROBAR para el dueño.");
  else if (C === "parcial" && A === "chico") fila("7", HAIKU, "xhigh", "PROBAR para el dueño.");
  else if (C === "parcial") {
    const nota = "Partir más chico y volver a la fila 7 con cada pedazo. PROBAR para el dueño.";
    if (I === "si") fila("7b", SONNET, "high", nota);
    else fila("7b", "", "", nota, 3);
  } else if (D === "alto" && A === "chico") fila("8", HAIKU, "xhigh", "F7 obligatoria, con otra familia.");
  else if (D === "alto") {
    const nota = "Partir primero y volver a la fila 8. F7 obligatoria, con otra familia.";
    if (I === "si") fila("8b", SONNET, "high", nota);
    else fila("8b", "", "", nota, 3);
  } else if (M === "si" && A === "chico") {
    fila(
      "9",
      "opencode:opencode/glm-5.3-flash-free",
      "",
      "--tipo mecanico; plan B claude-haiku-5-5 medium (-m opencode:opencode/glm-5.3-flash-free,claude-haiku-5-5).",
    );
    r.tipo = "mecanico";
  } else fila("10", HAIKU, "xhigh");
  // Nunca devolver un modelo o effort que el dueño apagó en modelos.json: los mismos chequeos que -m (exit 98).
  if (r.modelo) {
    const excl = modelos.excluidoPor(r.modelo);
    if (excl !== null) {
      io.err(`pa: --rubrica: la fila ${r.fila} da ${r.modelo}, y modelos.json lo excluye (excluir: ${excl}). No lo devuelvo: el dueño lo prende en Ajustes > Modelos.\n`);
      return { ...r, modelo: "", effort: "", tipo: "", rc: 98 };
    }
    const ap = r.effort ? modelos.effortApagado(r.modelo, r.effort) : null;
    if (ap !== null) {
      io.err(
        `pa: --rubrica: la fila ${r.fila} da ${r.modelo} con effort ${r.effort}, y modelos.json lo tiene apagado (efforts_permitidos: ${ap.replace(/ /g, ", ")}). No lo devuelvo: el dueño lo prende en Ajustes > Modelos.\n`,
      );
      return { ...r, modelo: "", effort: "", tipo: "", rc: 98 };
    }
  }
  return r;
}

/** `pa --rubrica '<respuestas>' [--json]`: qué fila da, con qué modelo y effort (no lanza nada). Devuelve el código de salida. */
export function cmdRubrica(args: string[], modelos: Modelos, io: Io): number {
  const USO = "uso: pa --rubrica 'A=chico B=ejecutar C=completo D=bajo E=si' [--json]\n";
  let texto = "";
  let json = false;
  for (const a of args) {
    if (a === "--json") json = true;
    else if (texto) {
      io.err(USO);
      return 2;
    } else texto = a;
  }
  if (!texto) {
    io.err(USO);
    return 2;
  }
  const r = resolverRubrica(texto, modelos, io);
  if (r.rc === 2 || r.rc === 98) return r.rc;
  if (json) {
    const nulo = (s: string) => (s === "" ? null : s);
    const o = {
      version: 1,
      rubrica: r.norm,
      fila: /^[0-9]+$/.test(r.fila) ? Number(r.fila) : r.fila,
      lanza: r.modelo !== "",
      modelo: nulo(r.modelo),
      effort: nulo(r.effort),
      tipo: nulo(r.tipo),
      nota: r.nota,
    };
    io.out(`${JSON.stringify(o, null, 2)}\n`);
  } else if (r.rc === 3) io.out(`fila ${r.fila}: no se lanza. ${r.nota}\n`);
  else
    io.out(
      `fila ${r.fila}: -m ${r.modelo}${r.effort ? ` --effort ${r.effort}` : ""}${r.tipo ? ` --tipo ${r.tipo}` : ""}${r.nota ? `  (${r.nota})` : ""}\n`,
    );
  return r.rc;
}
