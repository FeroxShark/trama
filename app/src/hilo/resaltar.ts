// El resaltado de un bloque de código, sin librería (puro: lo pinta Texto.tsx). No
// es un parser de cada lenguaje: reconoce comentarios, cadenas, números, palabras
// clave y lo que se llama (`f(`), que es lo que ayuda a seguir un bloque de un
// vistazo. Cinco colores, no un arcoíris. Lo que no conoce va tal cual.

/**
 * Qué es cada pedazo: `com`entario, `str` cadena, `num`ero, `kw` palabra clave, `fn` lo que
 * se llama (o el comando de un renglón de shell, o la clave de un JSON), `var` una variable
 * de shell, `mas` / `menos` / `meta` los renglones de un diff. `""`: sin color.
 */
export type Clase = "" | "com" | "str" | "num" | "kw" | "fn" | "var" | "mas" | "menos" | "meta";
export type Tok = { c: Clase; t: string };

type Lenguaje = {
  /** Lo que abre un comentario hasta el fin del renglón. */
  linea?: string[];
  /** Comentarios de bloque: abre y cierra. */
  bloque?: [string, string][];
  /** Las comillas que encierran una cadena (`"""` antes que `"`). */
  cadenas?: string[];
  kw?: string;
  /** Las palabras clave no distinguen mayúsculas (SQL). */
  sinCaja?: boolean;
  /** Shell: el comando de cada renglón, `$variables` y `--opciones`. */
  shell?: boolean;
  /** `clave:` o `clave =` al principio del renglón (YAML, TOML, CSS) y `"clave":` (JSON). */
  claves?: boolean;
};

const C = { linea: ["//"], bloque: [["/*", "*/"]] as [string, string][], cadenas: ['"', "'"] };
const JS: Lenguaje = {
  ...C,
  cadenas: ['"', "'", "`"],
  kw: "abstract as async await break case catch class const continue debugger declare default delete do else enum export extends false finally for from function get if implements import in instanceof interface is keyof let new null of private protected public readonly return satisfies set static super switch this throw true try type typeof undefined var void while with yield",
};
const SHELL: Lenguaje = {
  linea: ["#"],
  cadenas: ['"', "'"],
  kw: "if then else elif fi for while until do done case esac in function return local export readonly declare unset set source alias exit break continue",
  shell: true,
};
const CONF: Lenguaje = { linea: ["#"], cadenas: ['"""', "'''", '"', "'"], kw: "true false null yes no on off", claves: true };

const LENGUAJES: Record<string, Lenguaje> = {
  js: JS,
  py: {
    linea: ["#"],
    cadenas: ['"""', "'''", '"', "'"],
    kw: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield match case",
  },
  sh: SHELL,
  rs: {
    ...C,
    cadenas: ['"'],
    kw: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  },
  go: {
    ...C,
    cadenas: ['"', "'", "`"],
    kw: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  },
  c: {
    ...C,
    kw: "auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false final float for friend goto if import inline int interface long namespace new null nullptr operator override package private protected public return short signed sizeof static struct switch template this throw throws true try typedef typename union unsigned using virtual void volatile while fun val var when",
  },
  json: { cadenas: ['"'], kw: "true false null", claves: true },
  conf: CONF,
  css: { bloque: [["/*", "*/"]], linea: [], cadenas: ['"', "'"], kw: "important", claves: true },
  sql: {
    linea: ["--"],
    bloque: [["/*", "*/"]],
    cadenas: ["'"],
    sinCaja: true,
    kw: "select from where and or not null is in like between join left right inner outer full on as group by order having limit offset insert into values update set delete create table index view drop alter add column primary key foreign references unique default distinct union all case when then else end exists count sum avg min max asc desc with begin commit rollback",
  },
  lua: {
    linea: ["--"],
    bloque: [["--[[", "]]"]],
    cadenas: ['"', "'"],
    kw: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
  },
};

const ALIAS: Record<string, string> = {
  javascript: "js",
  jsx: "js",
  mjs: "js",
  cjs: "js",
  ts: "js",
  tsx: "js",
  typescript: "js",
  qml: "js",
  python: "py",
  python3: "py",
  bash: "sh",
  zsh: "sh",
  shell: "sh",
  fish: "sh",
  console: "sh",
  shellsession: "sh",
  rust: "rs",
  golang: "go",
  cpp: "c",
  "c++": "c",
  h: "c",
  hpp: "c",
  java: "c",
  kotlin: "c",
  kt: "c",
  swift: "c",
  cs: "c",
  csharp: "c",
  jsonc: "json",
  json5: "json",
  jsonl: "json",
  yaml: "conf",
  yml: "conf",
  toml: "conf",
  ini: "conf",
  env: "conf",
  dockerfile: "conf",
  service: "conf",
  systemd: "conf",
  scss: "css",
  xml: "html",
  svg: "html",
  patch: "diff",
};

/** Más que esto no se resalta: un volcado largo va tal cual. */
const TOPE = 40_000;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Armado = { re: RegExp; kw: Set<string>; l: Lenguaje };
const armados = new Map<string, Armado>();

/** Una sola expresión por lenguaje: comentario | cadena | número | palabra, en ese orden. */
function armar(l: Lenguaje): Armado {
  const com = [
    ...(l.bloque ?? []).map(([a, b]) => `${esc(a)}[\\s\\S]*?(?:${esc(b)}|$)`),
    // En shell y en los de configuración "#" abre comentario sólo al principio o después de un blanco.
    ...(l.linea ?? []).map((a) => (a === "#" ? "(?<![^\\s;(])#.*" : `${esc(a)}.*`)),
  ];
  const str = (l.cadenas ?? []).map((q) =>
    q.length === 3 ? `${esc(q)}[\\s\\S]*?(?:${esc(q)}|$)` : q === "`" ? "`(?:\\\\[\\s\\S]|[^`\\\\])*(?:`|$)" : `${q}(?:\\\\.|[^${q}\\\\\\n])*(?:${q}|$)`,
  );
  const partes = [
    `(?<com>${com.join("|") || "(?!)"})`,
    `(?<str>${str.join("|") || "(?!)"})`,
    "(?<var>" + (l.shell ? "\\$\\{[^}\\n]*\\}|\\$[\\w@#?*!$]+" : "(?!)") + ")",
    // En shell no hay números que valga la pena marcar (ids, puertos, `2>&1`).
    "(?<num>" + (l.shell ? "(?!)" : "\\b(?:0[xX][\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:[eE][+-]?\\d+)?[a-zA-Z%]*)") + ")",
    // Una palabra; en shell y en los de configuración sigue por guiones y puntos (`apt-get`, `max-width`).
    "(?<pal>" + (l.shell || l.claves ? "[A-Za-z_][\\w.-]*" : "[A-Za-z_$][\\w$]*") + ")",
  ];
  return { re: new RegExp(partes.join("|"), "gm"), kw: new Set((l.kw ?? "").split(" ").filter(Boolean)), l };
}

/** El lenguaje de un bloque según lo que dice su cerca (```ts, ```bash…); `null`: no se resalta. */
export function lenguaje(lang: string): string | null {
  const n = lang.toLowerCase();
  const id = ALIAS[n] ?? n;
  return id === "diff" || id === "html" || id in LENGUAJES ? id : null;
}

function diff(codigo: string): Tok[] {
  return codigo.split("\n").map((r, i, todos) => {
    const t = r + (i < todos.length - 1 ? "\n" : "");
    const c: Clase = /^(\+\+\+|---|diff |index )/.test(r) ? "com" : r.startsWith("@@") ? "meta" : r.startsWith("+") ? "mas" : r.startsWith("-") ? "menos" : "";
    return { c, t };
  });
}

/** HTML y XML: comentarios, etiquetas y los valores de sus atributos. */
function html(codigo: string): Tok[] {
  const out: Tok[] = [];
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?[\w:-]+|\/?>)|("[^"\n]*"|'[^'\n]*')(?=[^<]*>)/g;
  let desde = 0;
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    if (m.index > desde) out.push({ c: "", t: codigo.slice(desde, m.index) });
    out.push({ c: m[1] ? "com" : m[2] ? "kw" : "str", t: m[0] });
    desde = m.index + m[0].length;
  }
  if (desde < codigo.length) out.push({ c: "", t: codigo.slice(desde) });
  return out;
}

/** El código partido en pedazos con su clase; pegados en orden dan el código entero. */
export function resaltar(codigo: string, lang: string): Tok[] {
  const id = lenguaje(lang);
  if (!id || codigo.length > TOPE) return [{ c: "", t: codigo }];
  if (id === "diff") return diff(codigo);
  if (id === "html") return html(codigo);
  let a = armados.get(id);
  if (!a) armados.set(id, (a = armar(LENGUAJES[id])));
  const { re, kw, l } = a;
  const out: Tok[] = [];
  const pone = (c: Clase, t: string) => {
    const ult = out[out.length - 1];
    if (!t) return;
    if (ult && ult.c === c) ult.t += t;
    else out.push({ c, t });
  };
  let desde = 0;
  re.lastIndex = 0;
  for (let m = re.exec(codigo); m; m = re.exec(codigo)) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    pone("", codigo.slice(desde, m.index));
    desde = m.index + m[0].length;
    const g = m.groups ?? {};
    const sigue = codigo.slice(desde, desde + 40);
    if (g.com !== undefined) pone("com", m[0]);
    else if (g.str !== undefined) pone(l.claves && /^\s*:/.test(sigue) ? "fn" : "str", m[0]);
    else if (g.var !== undefined) pone("var", m[0]);
    else if (g.num !== undefined) pone("num", m[0]);
    else {
      const antes = codigo.slice(Math.max(0, m.index - 200), m.index);
      const renglon = antes.slice(antes.lastIndexOf("\n") + 1);
      const palabra = l.sinCaja ? m[0].toLowerCase() : m[0];
      if (l.shell) {
        // El comando: lo primero del renglón (si el de arriba no sigue con "\"), o lo que viene
        // después de `|`, `&&`, `;`, `$(`, `sudo`, del prompt pegado ("$ npm test") o de las variables
        // que se le pasan ("X=1 npm test"). `X=1` no es un comando.
        const primero = /^[ \t]*$/.test(renglon) && !/\\\n[ \t]*$/.test(antes);
        const manda = primero || /(?:[|;&(]|\b(?:sudo|env|then|do|else|xargs|exec)|^\s*[$❯➜]|^\s*(?:[A-Za-z_]\w*=\S*\s+)+)\s*$/.test(renglon);
        if (kw.has(palabra) && !/[-/.=]$/.test(antes)) pone("kw", m[0]);
        else if (manda && sigue[0] !== "=") pone("fn", m[0]);
        else pone("", m[0]);
      } else if (kw.has(palabra)) pone("kw", m[0]);
      // La clave de un renglón de YAML o TOML ("- nombre: x") y la propiedad de una regla de CSS.
      else if (l.claves) pone(/(?:^|[{;])[ \t]*(?:-[ \t]+)?$/.test(renglon) && /^\s*[:=]/.test(sigue) ? "fn" : "", m[0]);
      else pone(sigue[0] === "(" ? "fn" : "", m[0]);
    }
  }
  pone("", codigo.slice(desde));
  return out;
}
