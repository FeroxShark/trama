// El markdown de los mensajes (src/hilo/markdown.ts): tablas GFM (alineación,
// celdas con formato, `\|`, la tabla a medio llegar), listas anidadas, citas, bloques
// con su lenguaje, lo pegado de una terminal, lo de adentro de un renglón y lo que
// todavía está llegando (`vivo`).
import { test } from "node:test";
import assert from "node:assert/strict";
import { bloques, esRuta, sueltas, trozos, type Bloque } from "../src/hilo/markdown.ts";

type Tabla = Extract<Bloque, { tipo: "tabla" }>;
const tabla = (texto: string): Tabla => {
  const t = bloques(texto).find((b) => b.tipo === "tabla");
  assert.ok(t, "no hay tabla");
  return t as Tabla;
};
const tipos = (texto: string) => bloques(texto).map((b) => b.tipo);

const REPORTE = "| | Antes | Sin extras |\n|---|---|---|\n| CPU de Hyprland en reposo | 13,4 % | **5,3 %** |\n| RAM | 1,2 GB | 0,9 GB |";

test("tabla: encabezado, separador y filas", () => {
  assert.deepEqual(bloques(REPORTE), [
    {
      tipo: "tabla",
      cabeza: ["", "Antes", "Sin extras"],
      alinea: [null, null, null],
      filas: [
        ["CPU de Hyprland en reposo", "13,4 %", "**5,3 %**"],
        ["RAM", "1,2 GB", "0,9 GB"],
      ],
    },
  ]);
});

test("tabla: la alineación sale del separador", () => {
  const t = tabla("| a | b | c | d |\n|:---|:---:|---:|---|\n| 1 | 2 | 3 | 4 |");
  assert.deepEqual(t.alinea, ["l", "c", "r", null]);
  assert.deepEqual(tabla("a | b\n:-: | -:\n1 | 2").alinea, ["c", "r"]);
});

test("tabla: sin barras en las puntas y con espacios de más", () => {
  const t = tabla("  Modelo | Costo  \n --- | --- \n opus | alto ");
  assert.deepEqual(t.cabeza, ["Modelo", "Costo"]);
  assert.deepEqual(t.filas, [["opus", "alto"]]);
});

test("tabla: las celdas llevan negrita, código y enlaces", () => {
  const t = tabla("| Qué | Dónde |\n|---|---|\n| **fuerte** y `npm test` | [docs](https://example.com/a) |");
  assert.deepEqual(trozos(t.filas[0][0]), [
    { tipo: "b", texto: "fuerte" },
    { tipo: "texto", texto: " y " },
    { tipo: "code", texto: "npm test" },
  ]);
  assert.deepEqual(trozos(t.filas[0][1]), [{ tipo: "link", texto: "docs", url: "https://example.com/a" }]);
});

test("tabla: la barra escapada es texto de la celda, también adentro de código", () => {
  const t = tabla("| Operador | Qué hace |\n|---|---|\n| `a \\| b` | o lógico \\| unión |\n| fin\\| | x |");
  assert.deepEqual(t.filas, [
    ["`a | b`", "o lógico | unión"],
    ["fin|", "x"],
  ]);
  assert.deepEqual(trozos(t.filas[0][0]), [{ tipo: "code", texto: "a | b" }]);
});

test("tabla a medio llegar: sin separador entero sigue siendo texto", () => {
  assert.deepEqual(tipos("| a | b |"), ["p"]);
  assert.deepEqual(tipos("| a | b |\n"), ["p"]);
  assert.deepEqual(tipos("| a | b |\n|"), ["p"]);
  assert.deepEqual(tipos("| a | b |\n|--"), ["p"]);
  assert.deepEqual(tipos("| a | b |\n|---|"), ["p"]);
  assert.deepEqual(bloques("| a | b |\n|---|"), [{ tipo: "p", texto: "| a | b |\n|---|" }]);
  // Apenas el separador tiene todas sus columnas, ya es tabla (todavía sin filas).
  assert.deepEqual(bloques("| a | b |\n|---|--"), [{ tipo: "tabla", cabeza: ["a", "b"], alinea: [null, null], filas: [] }]);
});

test("tabla a medio llegar: la última fila se completa con celdas vacías", () => {
  assert.deepEqual(tabla("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| CPU de Hy").filas, [
    ["1", "2", "3"],
    ["CPU de Hy", "", ""],
  ]);
  assert.deepEqual(tabla("| a | b |\n|---|---|\n|").filas, [["", ""]]);
});

test("tabla: a una fila le sobran celdas → se recorta", () => {
  assert.deepEqual(tabla("| a | b |\n|---|---|\n| 1 | 2 | 3 | 4 |").filas, [["1", "2"]]);
});

test("tabla: el separador con otra cantidad de columnas no es tabla", () => {
  assert.deepEqual(tipos("| a | b | c |\n|---|---|\n| 1 | 2 | 3 |"), ["p"]);
  // Una raya sola debajo de un texto con barras tampoco: es una regla.
  assert.deepEqual(tipos("a | b\n---"), ["p", "hr"]);
});

test("tabla: corta el párrafo de arriba y termina en el renglón vacío o sin barras", () => {
  const b = bloques("Así quedó:\n| a | b |\n|---|---|\n| 1 | 2 |\nNota al pie.\n\n| x |\n|---|\n| y |\n\n- item\n```\n| no | tabla |\n|---|---|\n```");
  assert.deepEqual(
    b.map((x) => x.tipo),
    ["p", "tabla", "p", "tabla", "ul", "pre"],
  );
  assert.deepEqual(b[0], { tipo: "p", texto: "Así quedó:" });
  assert.deepEqual(b[2], { tipo: "p", texto: "Nota al pie." });
  assert.deepEqual(b[3], { tipo: "tabla", cabeza: ["x"], alinea: [null], filas: [["y"]] });
});

test("tabla: un título o una lista pegados la terminan", () => {
  assert.deepEqual(tipos("| a | b |\n|---|---|\n| 1 | 2 |\n## Otro | tema\n- uno | dos"), ["tabla", "h", "ul"]);
});

test("tabla: <br> en una celda es un salto de línea", () => {
  assert.deepEqual(tabla("| a |\n|---|\n| uno<br>dos<br/>tres |").filas, [["uno\ndos\ntres"]]);
});

test("tabla: con \\r\\n llega igual", () => {
  assert.deepEqual(tabla("| a | b |\r\n|---|:--|\r\n| 1 | 2 |\r\n").filas, [["1", "2"]]);
});

test("lo de siempre no cambia: párrafos, listas, títulos y bloques de código", () => {
  assert.deepEqual(bloques("Hola\nmundo\n\n1. uno\n2. dos\n\n- a\n- b\n# Título\n```\nx | y\n```"), [
    { tipo: "p", texto: "Hola\nmundo" },
    { tipo: "ol", items: [{ texto: "uno" }, { texto: "dos" }] },
    { tipo: "ul", items: [{ texto: "a" }, { texto: "b" }] },
    { tipo: "h", texto: "Título", nivel: 1 },
    { tipo: "pre", texto: "x | y", lang: "" },
  ]);
});

test("trozos: código, negrita y enlaces; lo que no cierra va tal cual", () => {
  assert.deepEqual(trozos("corré `npm test` y **listo**."), [
    { tipo: "texto", texto: "corré " },
    { tipo: "code", texto: "npm test" },
    { tipo: "texto", texto: " y " },
    { tipo: "b", texto: "listo" },
    { tipo: "texto", texto: "." },
  ]);
  assert.deepEqual(trozos("mirá [el changelog](https://example.com/x?y=1) y [escribime](mailto:a@example.com)"), [
    { tipo: "texto", texto: "mirá " },
    { tipo: "link", texto: "el changelog", url: "https://example.com/x?y=1" },
    { tipo: "texto", texto: " y " },
    { tipo: "link", texto: "escribime", url: "mailto:a@example.com" },
  ]);
  // Sin esquema no es un enlace: `a[i](x)` en la prosa queda como está.
  assert.deepEqual(trozos("usa a[i](x) y **sin cerrar"), [{ tipo: "texto", texto: "usa a[i](x) y **sin cerrar" }]);
  assert.deepEqual(trozos(""), []);
});

test("títulos: el nivel sale de los #", () => {
  assert.deepEqual(bloques("# Uno\n## Dos\n#### Cuatro"), [
    { tipo: "h", texto: "Uno", nivel: 1 },
    { tipo: "h", texto: "Dos", nivel: 2 },
    { tipo: "h", texto: "Cuatro", nivel: 4 },
  ]);
  // Sin espacio no es un título (un #hashtag, un `#include`).
  assert.deepEqual(tipos("#nada"), ["p"]);
});

test("bloques de código: el lenguaje de la cerca, ~~~ y la sangría de la cerca", () => {
  assert.deepEqual(bloques("```ts\nconst a = 1;\n```"), [{ tipo: "pre", texto: "const a = 1;", lang: "ts" }]);
  assert.deepEqual(bloques("~~~bash\nnpm test\n~~~"), [{ tipo: "pre", texto: "npm test", lang: "bash" }]);
  // Adentro de un ítem de lista la cerca viene sangrada: el código pierde esa sangría, no la suya.
  assert.deepEqual(bloques("   ```py\n   def f():\n       return 1\n   ```"), [{ tipo: "pre", texto: "def f():\n    return 1", lang: "py" }]);
  // Sin cerrar (está llegando) ya es un bloque.
  assert.deepEqual(bloques("```sh\nls -la"), [{ tipo: "pre", texto: "ls -la", lang: "sh" }]);
  // Adentro no se parsea nada.
  assert.deepEqual(bloques("```\n# no título\n- no lista\n> no cita\n```"), [{ tipo: "pre", texto: "# no título\n- no lista\n> no cita", lang: "" }]);
});

test("listas: anidadas, que no arrancan en 1, con renglones de continuación y tareas", () => {
  assert.deepEqual(bloques("1. uno\n   - a\n   - b\n2. dos"), [
    {
      tipo: "ol",
      items: [{ texto: "uno", sub: { tipo: "ul", items: [{ texto: "a" }, { texto: "b" }] } }, { texto: "dos" }],
    },
  ]);
  assert.deepEqual(bloques("3. tres\n4. cuatro"), [{ tipo: "ol", desde: 3, items: [{ texto: "tres" }, { texto: "cuatro" }] }]);
  assert.deepEqual(bloques("- uno\n  sigue\n- dos"), [{ tipo: "ul", items: [{ texto: "uno\nsigue" }, { texto: "dos" }] }]);
  assert.deepEqual(bloques("- [x] hecho\n- [ ] falta"), [
    { tipo: "ul", items: [{ texto: "hecho", hecho: true }, { texto: "falta", hecho: false }] },
  ]);
  // Un renglón vacío entre ítems no parte la lista.
  assert.deepEqual(tipos("1. uno\n\n2. dos\n\n3. tres"), ["ol"]);
  assert.deepEqual(tipos("* a\n+ b"), ["ul"]);
});

test("citas y reglas", () => {
  assert.deepEqual(bloques("> Ojo con esto.\n> - uno\n> - dos\n\nsigue"), [
    {
      tipo: "cita",
      bloques: [
        { tipo: "p", texto: "Ojo con esto." },
        { tipo: "ul", items: [{ texto: "uno" }, { texto: "dos" }] },
      ],
    },
    { tipo: "p", texto: "sigue" },
  ]);
  assert.deepEqual(tipos("arriba\n\n---\n\nabajo\n\n***\n___"), ["p", "hr", "p", "hr", "hr"]);
});

test("lo pegado de una terminal: sólo en un mensaje propio, del primer prompt al fin de lo que sigue al último", () => {
  const pegado = "Mirá:\n\n❯ ssh casa 'atlas login'\n\nAbrí el enlace:\nhttps://example.com/x\n\n❯ atlas estado\n\nsin sesión\n\n❯";
  assert.deepEqual(bloques(pegado, { terminal: true }), [
    { tipo: "p", texto: "Mirá:" },
    {
      tipo: "term",
      lineas: [
        { prompt: "❯", texto: "ssh casa 'atlas login'" },
        { prompt: "", texto: "" },
        { prompt: "", texto: "Abrí el enlace:" },
        { prompt: "", texto: "https://example.com/x" },
        { prompt: "", texto: "" },
        { prompt: "❯", texto: "atlas estado" },
        { prompt: "", texto: "" },
        { prompt: "", texto: "sin sesión" },
        { prompt: "", texto: "" },
        { prompt: "❯", texto: "" },
      ],
    },
  ]);
  // En la respuesta de un líder no: ahí "$ x" es prosa.
  assert.ok(!tipos(pegado).includes("term"));
  // Y un mensaje propio sin prompt es un mensaje de siempre.
  assert.deepEqual(tipos("hola\n\n- uno\n- dos", { terminal: true } as never), ["p", "ul"]);
  assert.deepEqual(bloques("$ npm test\nok 12", { terminal: true }), [
    {
      tipo: "term",
      lineas: [
        { prompt: "$", texto: "npm test" },
        { prompt: "", texto: "ok 12" },
      ],
    },
  ]);
});

test("trozos: cursiva, tachado y lo que no es énfasis", () => {
  assert.deepEqual(trozos("es *muy* raro, _casi_ ~~nunca~~ ***pasa***"), [
    { tipo: "texto", texto: "es " },
    { tipo: "i", texto: "muy" },
    { tipo: "texto", texto: " raro, " },
    { tipo: "i", texto: "casi" },
    { tipo: "texto", texto: " " },
    { tipo: "s", texto: "nunca" },
    { tipo: "texto", texto: " " },
    { tipo: "b", texto: "pasa" },
  ]);
  // Una cuenta, un nombre con guiones bajos y un asterisco suelto quedan como están.
  assert.deepEqual(trozos("es *así*."), [
    { tipo: "texto", texto: "es " },
    { tipo: "i", texto: "así" },
    { tipo: "texto", texto: "." },
  ]);
  for (const t of ["2*3*4 = 24", "mi_var_x y otra_cosa_mas", "a * b * c", "docs/estado/*.md y src/*.ts", "borrá *.log y *.tmp"]) assert.deepEqual(trozos(t), [{ tipo: "texto", texto: t }], t);
});

test("trozos: una URL suelta es un enlace, sin la puntuación del final", () => {
  assert.deepEqual(trozos("mirá https://example.com/a?b=1&c=2. Y (https://example.com/x)"), [
    { tipo: "texto", texto: "mirá " },
    { tipo: "link", texto: "https://example.com/a?b=1&c=2", url: "https://example.com/a?b=1&c=2" },
    { tipo: "texto", texto: ". Y (" },
    { tipo: "link", texto: "https://example.com/x", url: "https://example.com/x" },
    { tipo: "texto", texto: ")" },
  ]);
  assert.deepEqual(trozos("<https://example.com/y>"), [{ tipo: "link", texto: "https://example.com/y", url: "https://example.com/y" }]);
  // Adentro de código no.
  assert.deepEqual(trozos("`curl https://example.com`"), [{ tipo: "code", texto: "curl https://example.com" }]);
  // Y adentro del texto de un enlace tampoco (`enlaces: false`).
  assert.deepEqual(trozos("ver https://example.com", { enlaces: false }), [{ tipo: "texto", texto: "ver https://example.com" }]);
});

test("sueltas: en un renglón de terminal sólo las URLs son enlaces", () => {
  assert.deepEqual(sueltas("abrí **esto**: https://example.com/a_b_c*d"), [
    { tipo: "texto", texto: "abrí **esto**: " },
    { tipo: "link", texto: "https://example.com/a_b_c*d", url: "https://example.com/a_b_c*d" },
  ]);
  assert.deepEqual(sueltas("sin nada"), [{ tipo: "texto", texto: "sin nada" }]);
});

test("vivo: lo que está a medias ya tiene la forma que va a tener", () => {
  const v = { vivo: true };
  assert.deepEqual(trozos("esto es **impor", v), [
    { tipo: "texto", texto: "esto es " },
    { tipo: "b", texto: "impor" },
  ]);
  assert.deepEqual(trozos("corré `npm te", v), [
    { tipo: "texto", texto: "corré " },
    { tipo: "code", texto: "npm te" },
  ]);
  // El enlace: primero su texto, después (ya con el paréntesis) sin destino hasta que cierra.
  assert.deepEqual(trozos("mirá [la guía](https://exam", v), [
    { tipo: "texto", texto: "mirá " },
    { tipo: "link", texto: "la guía", url: "" },
  ]);
  // Terminado, sale igual con o sin `vivo`.
  for (const t of ["listo **ya** y `x`", "un [doc](https://example.com/a) y nada más", "2 * 3 y a_b"]) assert.deepEqual(trozos(t, v), trozos(t), t);
  // Sin `vivo`, lo que no cierra va tal cual.
  assert.deepEqual(trozos("esto es **impor"), [{ tipo: "texto", texto: "esto es **impor" }]);
});

test("vivo: la marca de un bloque que recién empieza no se ve como texto", () => {
  const v = { vivo: true };
  for (const cola of ["#", "##", "-", "1.", ">", "``", "```"]) {
    const b = bloques(`Hola.\n\n${cola}`, v);
    assert.ok(!b.some((x) => x.tipo === "p" && x.texto.includes(cola)), `"${cola}" quedó como texto: ${JSON.stringify(b)}`);
  }
  // La cabeza de una tabla ya es tabla antes de que llegue el separador.
  assert.deepEqual(bloques("Así:\n\n| a | b |", v)[1], { tipo: "tabla", cabeza: ["a", "b"], alinea: [null, null], filas: [] });
  assert.deepEqual(bloques("Así:\n\n| a | b |\n|--", v)[1], { tipo: "tabla", cabeza: ["a", "b"], alinea: [null, null], filas: [] });
});

test("vivo: letra por letra, un bloque ya cerrado no cambia de forma", () => {
  const texto = "## Título\n\nUn **párrafo** con `código` y [enlace](https://example.com/a).\n\n1. uno\n   - a\n2. dos\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst a = 1;\n```\n\n> cita\n\nFin.";
  const final = bloques(texto);
  let antes: Bloque[] = [];
  for (let n = 1; n <= texto.length; n++) {
    const ahora = bloques(texto.slice(0, n), { vivo: true });
    // Todo menos el último bloque de la pasada anterior tiene que seguir igual: lo que ya se leyó no salta.
    for (let k = 0; k < antes.length - 1; k++) assert.deepEqual(ahora[k], antes[k], `cambió el bloque ${k} al llegar la letra ${n}: ${JSON.stringify(texto.slice(0, n))}`);
    antes = ahora;
  }
  assert.deepEqual(bloques(texto, { vivo: true }), final);
});

test("esRuta: el código en línea que es un archivo", () => {
  for (const si of ["src/a.ts:12", "~/x", "package.json", "a/b/", "../x", "docs/estado/*.md", "electron/main.ts"]) assert.ok(esRuta(si), si);
  for (const no of ["window.hilos", "npm test", "/orquestar", "https://example.com/a", "1/2", "ordenar()", "a.b.c()", "v1.2.3"]) assert.ok(!esRuta(no), no);
});

// --- Tablas y código adentro de un ítem de lista ---

type ListaB = Extract<Bloque, { tipo: "ol" | "ul" }>;
const lista = (texto: string): ListaB => {
  const b = bloques(texto);
  assert.equal(b.length, 1, `una sola lista, vino ${b.map((x) => x.tipo)}`);
  return b[0] as ListaB;
};

test("lista: una tabla con sangría cuelga de su ítem, con renglón vacío o sin él", () => {
  const con = lista("1. Primero:\n\n   | a | b |\n   |---|---|\n   | 1 | 2 |\n\n2. Segundo");
  assert.equal(con.items.length, 2);
  assert.deepEqual(con.items[0].bloques, [{ tipo: "tabla", cabeza: ["a", "b"], alinea: [null, null], filas: [["1", "2"]] }]);
  assert.equal(con.items[1].bloques, undefined);
  const sin = lista("- item\n  | a | b |\n  |:--|--:|\n  | 1 | 2 |\n- otro");
  assert.equal(sin.items[0].texto, "item");
  assert.deepEqual((sin.items[0].bloques![0] as Tabla).alinea, ["l", "r"]);
  assert.equal(sin.items[1].texto, "otro");
});

test("lista: un bloque de código con sangría cuelga de su ítem y la numeración sigue", () => {
  const l = lista("1. Corré:\n\n   ```bash\n   npm test\n   ```\n\n2. Después\n   ```ts\n   const x = 1;\n   ```\n3. Fin");
  assert.equal(l.tipo, "ol");
  assert.deepEqual(
    l.items.map((i) => i.texto),
    ["Corré:", "Después", "Fin"],
  );
  assert.deepEqual(l.items[0].bloques, [{ tipo: "pre", texto: "npm test", lang: "bash" }]);
  assert.deepEqual(l.items[1].bloques, [{ tipo: "pre", texto: "const x = 1;", lang: "ts" }]);
  assert.equal(l.desde, undefined);
});

test("lista: el código de un ítem anidado es del anidado; lo que sigue a su código es un párrafo suyo", () => {
  const l = lista("- a\n  - b\n    ```js\n    x()\n    ```\n    y sigue\n  - c");
  const sub = l.items[0].sub!;
  assert.deepEqual(sub.items[0].bloques, [
    { tipo: "pre", texto: "x()", lang: "js" },
    { tipo: "p", texto: "y sigue" },
  ]);
  assert.equal(sub.items[1].texto, "c");
});

test("lista: el código conserva su sangría interna y lo que parece lista adentro no corta nada", () => {
  const l = lista("- paso\n  ```yaml\n  a:\n    - uno\n    - dos\n  ```\n- otro");
  assert.deepEqual(l.items[0].bloques, [{ tipo: "pre", texto: "a:\n  - uno\n  - dos", lang: "yaml" }]);
  assert.equal(l.items.length, 2);
});

test("lista: el código sin sangría sigue cortando la lista, y un renglón con barras no es tabla sin separador", () => {
  assert.deepEqual(tipos("1. a\n```\nx\n```\n2. b"), ["ol", "pre", "ol"]);
  const l = lista("- a | b\n  c | d");
  assert.equal(l.items[0].bloques, undefined);
});

test("lista: mientras llega, un código sin cerrar dentro de un ítem ya es código", () => {
  const b = bloques("1. Corré:\n   ```bash\n   npm te", { vivo: true });
  assert.equal(b.length, 1);
  assert.deepEqual((b[0] as ListaB).items[0].bloques, [{ tipo: "pre", texto: "npm te", lang: "bash" }]);
});
