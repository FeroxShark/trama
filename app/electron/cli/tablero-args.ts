// Un argparse de bolsillo, sólo lo que usa motor/bin/tablero (Python 3.14): subcomandos, opciones con valor / `store_true` / `append` /
// constante, un grupo excluyente, posicionales con nargs None / ? / * / +, abreviaturas únicas de `--opciones`, `--opcion=valor`, `--`, y
// el mismo reparto de posicionales entre opciones (el de `cerrar 1 --clave K 2` deja el 2 afuera: «unrecognized arguments»).
// Los mensajes de error y la ayuda salen igual que los de Python: el uso de cada subcomando se saca del texto de ayuda copiado.
import { AYUDA_TEXTOS } from "./tablero-ayuda.ts";

export class ErrorTipo extends Error {}

type Valor = unknown;
export type Accion = {
  /** `["--columna"]`; vacío = posicional. */
  flags: string[];
  dest: string;
  /** Cómo se llama en los mensajes: el metavar de un posicional, o las flags unidas con «/». */
  nombre: string;
  tipo: "valor" | "const" | "anexar" | "pos";
  nargs?: "?" | "*" | "+";
  /** `"int"` o una función que convierte (puede tirar `ErrorTipo`, que es el `ArgumentTypeError` de Python). */
  conv?: "int" | ((s: string) => Valor);
  choices?: string[];
  const?: Valor;
  defecto?: Valor;
  grupo?: number;
};

export type Parser = { prog: string; acciones: Accion[] };
export class Salida extends Error {
  codigo: number;
  constructor(codigo: number) {
    super(`salida ${codigo}`);
    this.codigo = codigo;
  }
}
export type Io = { out: (s: string) => void; err: (s: string) => void };

const ayudaDe = (cmd: string, nombreDueno: (t: string) => string) => nombreDueno(AYUDA_TEXTOS[cmd] ?? "");
/** El bloque `usage:` de la ayuda: hasta la primera línea en blanco. */
const usoDe = (cmd: string, nombreDueno: (t: string) => string) => ayudaDe(cmd, nombreDueno).split("\n\n")[0]!.replace(/\n+$/, "");

/** `repr()` de un str de Python. */
export function reprPy(s: string): string {
  const comilla = s.includes("'") && !s.includes('"') ? '"' : "'";
  let r = "";
  for (const c of s) {
    const n = c.codePointAt(0)!;
    if (c === "\\") r += "\\\\";
    else if (c === comilla) r += "\\" + c;
    else if (c === "\n") r += "\\n";
    else if (c === "\r") r += "\\r";
    else if (c === "\t") r += "\\t";
    else if (n < 0x20 || n === 0x7f) r += "\\x" + n.toString(16).padStart(2, "0");
    else r += c;
  }
  return comilla + r + comilla;
}

/** `int(s)` de Python para un texto (espacios, signo y guiones bajos entre dígitos); null si no es un entero. */
export function enteroPy(s: string): number | null {
  const m = /^[\s\x1c-\x1f\x85]*([+-]?\d+(?:_\d+)*)[\s\x1c-\x1f\x85]*$/.exec(s);
  return m ? Number(m[1]!.replace(/_/g, "")) : null;
}

const parecenNegativo = (s: string) => /^-\d+$|^-\d*\.\d+$/.test(s);

export type Resultado = { cmd: string; ns: Record<string, Valor> };

/** Parsea `argv` completo (la línea de comandos de `tablero`). Tira `Salida` con el código si hay que terminar (ayuda, error). */
export function parsear(argv: string[], parsers: Record<string, Parser>, io: Io, nombreDueno: (t: string) => string): Resultado {
  const error = (uso: string, prog: string, msg: string): never => {
    io.err(`${uso}\n${prog}: error: ${msg}\n`);
    throw new Salida(2);
  };
  const ayuda = (cmd: string): never => {
    io.out(ayudaDe(cmd, nombreDueno));
    throw new Salida(0);
  };
  const nombres = Object.keys(parsers);
  const usoMain = usoDe("", nombreDueno);
  // ---- el parser principal: opciones antes del comando (-h, o desconocidas que quedan para el error final)
  const extras: string[] = [];
  let i = 0;
  let cmd: string | null = null;
  while (i < argv.length) {
    const a = argv[i]!;
    if (a === "--") {
      i++;
      if (i < argv.length) cmd = argv[i++]!;
      break;
    }
    if (a.startsWith("-") && a.length > 1 && !(parecenNegativo(a)) && !a.includes(" ")) {
      const nom = a.split("=")[0]!;
      if (a === "-h" || (nom.length >= 3 && "--help".startsWith(nom) && !a.includes("="))) return ayuda("");
      extras.push(a);
      i++;
      continue;
    }
    cmd = a;
    i++;
    break;
  }
  if (cmd === null) {
    if (extras.length) return error(usoMain, "tablero", `unrecognized arguments: ${extras.join(" ")}`);
    io.err(ayudaDe("", nombreDueno));
    throw new Salida(2);
  }
  const p = parsers[cmd];
  if (!p) return error(usoMain, "tablero", `argument <comando>: invalid choice: ${reprPy(cmd)} (choose from ${nombres.map(reprPy).join(", ")})`);
  const resto = argv.slice(i);
  const uso = usoDe(cmd, nombreDueno);
  const ns: Record<string, Valor> = {};
  const extrasSub: string[] = [];
  parsearSub(p, resto, ns, extrasSub, (m) => error(uso, p.prog, m), () => ayuda(cmd));
  const todos = [...extras, ...extrasSub];
  if (todos.length) return error(usoMain, "tablero", `unrecognized arguments: ${todos.join(" ")}`);
  return { cmd, ns };
}

type Opcion = { accion: Accion; flag: string; explicito: string | null } | "desconocida";

function parsearSub(p: Parser, args: string[], ns: Record<string, Valor>, extras: string[], falla: (m: string) => never, ayuda: () => never): void {
  // flags -> acción, en el orden en que se agregaron (-h/--help primero); las posicionales aparte
  const porFlag = new Map<string, Accion>();
  const posicionales: Accion[] = [];
  for (const a of p.acciones) {
    if (a.tipo === "pos") posicionales.push(a);
    else for (const f of a.flags) porFlag.set(f, a);
  }
  for (const a of p.acciones) {
    if (a.dest in ns) continue;
    ns[a.dest] = a.tipo === "pos" ? (a.nargs === "*" ? [] : a.nargs === "+" ? undefined : null) : a.defecto !== undefined ? a.defecto : a.tipo === "const" ? false : null;
  }
  const flagsTodas = ["-h", "--help", ...porFlag.keys()];

  // ---- clasificar: A = posicional, O = opción, - = "--"
  const clases: string[] = [];
  const opciones = new Map<number, Opcion>();
  let tras = false;
  args.forEach((s, idx) => {
    if (tras) return void clases.push("A");
    if (s === "--") {
      tras = true;
      return void clases.push("-");
    }
    const o = clasificar(s, porFlag, flagsTodas, falla);
    if (o === null) clases.push("A");
    else {
      clases.push("O");
      opciones.set(idx, o);
    }
  });
  const patron = clases.join("");

  const ejecutadas = new Set<Accion>();
  const grupoVisto = new Map<number, Accion>();
  const convertir = (a: Accion, s: string): Valor => {
    let v: Valor = s;
    try {
      if (a.conv === "int") {
        const n = enteroPy(s);
        if (n === null) falla(`argument ${a.nombre}: invalid int value: ${reprPy(s)}`);
        v = n;
      } else if (a.conv) v = a.conv(s);
    } catch (e) {
      if (e instanceof ErrorTipo) falla(`argument ${a.nombre}: ${e.message}`);
      throw e;
    }
    if (a.choices && !a.choices.includes(v as string)) falla(`argument ${a.nombre}: invalid choice: ${reprPy(String(v))} (choose from ${a.choices.map(reprPy).join(", ")})`);
    return v;
  };
  const tomarAccion = (a: Accion, valores: string[]) => {
    if (a.grupo !== undefined) {
      const previa = grupoVisto.get(a.grupo);
      if (previa && previa !== a) falla(`argument ${a.nombre}: not allowed with argument ${previa.nombre}`);
      grupoVisto.set(a.grupo, a);
    }
    ejecutadas.add(a);
    if (a.tipo === "const") ns[a.dest] = a.const;
    else if (a.tipo === "valor") ns[a.dest] = convertir(a, valores[0]!);
    else if (a.tipo === "anexar") ns[a.dest] = [...((ns[a.dest] as Valor[] | null) ?? []), convertir(a, valores[0]!)];
    else if (a.nargs === undefined || a.nargs === "?") ns[a.dest] = valores.length ? convertir(a, valores[0]!) : null;
    else ns[a.dest] = valores.map((v) => convertir(a, v));
  };

  const consumirPosicionales = (desde: number): number => {
    const pendientes = posicionales.filter((a) => !ejecutadas.has(a));
    const resto = patron.slice(desde);
    let cuentas: number[] = [];
    for (let n = pendientes.length; n > 0; n--) {
      const re = new RegExp("^" + pendientes.slice(0, n).map((a) => (a.nargs === undefined ? "(-*A-*)" : a.nargs === "?" ? "(-*A?-*)" : a.nargs === "*" ? "(-*[A-]*)" : "(-*A[A-]*)")).join(""));
      const m = re.exec(resto);
      if (m) {
        cuentas = m.slice(1).map((g) => g.length);
        break;
      }
    }
    let idx = desde;
    cuentas.forEach((c, k) => {
      let trozo = args.slice(idx, idx + c);
      const guion = clases.slice(idx, idx + c).indexOf("-");
      if (guion >= 0) trozo = trozo.filter((_, j) => j !== guion);
      idx += c;
      tomarAccion(pendientes[k]!, trozo);
    });
    return idx;
  };

  const consumirOpcion = (idx: number): number => {
    const o = opciones.get(idx)!;
    if (o === "desconocida") {
      extras.push(args[idx]!);
      return idx + 1;
    }
    const { accion, flag, explicito } = o;
    if (flag === "-h" || flag === "--help") return ayuda();
    if (accion.tipo === "const") {
      if (explicito !== null) falla(`argument ${accion.nombre}: ignored explicit argument ${reprPy(explicito)}`);
      tomarAccion(accion, []);
      return idx + 1;
    }
    if (explicito !== null) {
      tomarAccion(accion, [explicito]);
      return idx + 1;
    }
    if (clases[idx + 1] !== "A") falla(`argument ${accion.nombre}: expected one argument`);
    tomarAccion(accion, [args[idx + 1]!]);
    return idx + 2;
  };

  const indicesOpcion = [...opciones.keys()];
  const maxOpcion = indicesOpcion.length ? Math.max(...indicesOpcion) : -1;
  let inicio = 0;
  while (inicio <= maxOpcion) {
    let sigOpcion = inicio;
    while (sigOpcion <= maxOpcion && !opciones.has(sigOpcion)) sigOpcion++;
    if (inicio !== sigOpcion) {
      const fin = consumirPosicionales(inicio);
      if (fin > inicio) {
        inicio = fin;
        continue;
      }
      inicio = fin;
    }
    if (!opciones.has(inicio)) {
      extras.push(...args.slice(inicio, sigOpcion));
      inicio = sigOpcion;
    }
    inicio = consumirOpcion(inicio);
  }
  const fin = consumirPosicionales(inicio);
  extras.push(...args.slice(fin));
  const faltan = posicionales.filter((a) => !ejecutadas.has(a) && (a.nargs === undefined || a.nargs === "+"));
  if (faltan.length) falla(`the following arguments are required: ${faltan.map((a) => a.nombre).join(", ")}`);
}

/** Cómo mira argparse un texto: null = posicional; una opción (con su acción si es conocida) o `desconocida`. */
function clasificar(s: string, porFlag: Map<string, Accion>, flagsTodas: string[], falla: (m: string) => never): Opcion | null {
  if (!s.startsWith("-") || s.length === 1) return null;
  const esAyuda = (f: string) => f === "-h" || f === "--help";
  const buscar = (f: string): Accion | undefined => porFlag.get(f);
  const ayudaAccion: Accion = { flags: ["-h", "--help"], dest: "help", nombre: "-h/--help", tipo: "const" };
  if (esAyuda(s)) return { accion: ayudaAccion, flag: s, explicito: null };
  const exacta = buscar(s);
  if (exacta) return { accion: exacta, flag: s, explicito: null };
  if (s.includes("=")) {
    const i = s.indexOf("=");
    const f = s.slice(0, i);
    const v = s.slice(i + 1);
    if (esAyuda(f)) return { accion: ayudaAccion, flag: f, explicito: v };
    const a = buscar(f);
    if (a) return { accion: a, flag: f, explicito: v };
  }
  // abreviaturas de `--opciones` (único prefijo)
  if (s.startsWith("--")) {
    const [pref, ...rest] = s.split("=");
    const explicito = rest.length ? rest.join("=") : null;
    const cand = flagsTodas.filter((f) => f.startsWith("--") && f.startsWith(pref!));
    if (cand.length > 1) falla(`ambiguous option: ${s.includes("=") ? pref : s} could match ${cand.join(", ")}`);
    if (cand.length === 1) {
      const f = cand[0]!;
      return { accion: esAyuda(f) ? ayudaAccion : buscar(f)!, flag: f, explicito };
    }
  }
  if (parecenNegativo(s)) return null;
  if (s.includes(" ")) return null;
  return "desconocida";
}
