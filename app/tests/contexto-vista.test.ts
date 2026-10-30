// La lógica del panel de contexto (src/paneles/contexto-vista.ts): categorías, ítems con sus usos, mapa de bloques y filtro del catálogo.
// Fixtures inventados (src/datos/fixtures-contexto.ts).
import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGO_FALSO, desgloseFalso } from "../src/datos/fixtures-contexto.ts";
import { bloques, categorias, claveSkill, estaApagado, filtrarSkills, fraccionUsada, itemsDe, ORDEN, pluginsDe, porcentaje, sabeUsos, treemap, usadas } from "../src/paneles/contexto-vista.ts";

const lider = desgloseFalso({ lider: "s-1" });
const worker = desgloseFalso({ worker: "20261003-103620-49377" });

test("categorías: en orden, sin lo libre ni lo diferido, con su parte de la ventana", () => {
  const d = structuredClone(lider);
  d.categorias.push({ id: "herramientas", nombre: null, tokens: 99_999, estimado: false, diferido: true });
  const c = categorias(d);
  assert.deepEqual(c.map((x) => x.id), ["mensajes", "herramientas", "mcp", "skills", "memoria", "agentes", "sistema", "reserva"]);
  assert.equal(c.find((x) => x.id === "herramientas")!.tokens, 15_500);
  assert.equal(c.find((x) => x.id === "mensajes")!.pct, 76_500 / 200_000);
  assert.equal(fraccionUsada(d), d.usado! / 200_000);
  assert.equal(fraccionUsada({ ...d, usado: null }), null);
});

test("ítems de herramientas: las protegidas no se apagan y lo que pesa y no se usó es 'nunca'", () => {
  const it = itemsDe(lider, "herramientas", ["Bash", "Read", "Edit", "Write"]);
  const bash = it.find((x) => x.nombre === "Bash")!;
  assert.equal(bash.protegida, true);
  assert.equal(bash.apaga, null);
  const web = it.find((x) => x.nombre === "WebFetch")!;
  assert.equal(web.nunca, true);
  assert.deepEqual(web.apaga, { tipo: "herramientas", nombre: "WebFetch" });
  // De más pesada a más liviana.
  assert.deepEqual(it.map((x) => x.tokens), [...it.map((x) => x.tokens)].sort((a, b) => (b ?? 0) - (a ?? 0)));
});

test("ítems de MCP: el servidor y sus herramientas, con el nombre que entiende el apagado", () => {
  const it = itemsDe(lider, "mcp");
  const gmail = it.find((x) => x.nombre === "claude_ai_Gmail")!;
  assert.equal(gmail.nunca, true);
  assert.deepEqual(gmail.apaga, { tipo: "mcp", nombre: "claude_ai_Gmail" });
  assert.equal(gmail.hijos.length, 2);
  assert.deepEqual(gmail.hijos[0].apaga, { tipo: "herramientas", nombre: "mcp__claude_ai_Gmail__search_threads" });
  // Sus herramientas diferidas se ven, pero su peso no es de la ventana.
  assert.ok(gmail.hijos.every((h) => h.diferida));
  assert.equal(gmail.diferidos, 35_587);
  const repo = it.find((x) => x.nombre === "repo-remoto")!;
  assert.equal(repo.nunca, false);
  assert.equal(repo.usos, 9);
});

test("ítems de skills y memoria: la clave de las de plugin y la ruta de la memoria", () => {
  const sk = itemsDe(lider, "skills");
  assert.equal(sk.find((x) => x.nombre === "informe-pdf")!.apaga?.nombre, "oficina:informe-pdf");
  assert.equal(sk.find((x) => x.nombre === "workers")!.apaga?.nombre, "workers");
  assert.equal(claveSkill({ nombre: "a:b", plugin: "x@y" }), "a:b");
  const mem = itemsDe(lider, "memoria");
  assert.equal(mem[0].nombre, "CLAUDE.md");
  assert.equal(mem[0].apaga?.tipo, "memoria");
  assert.equal(mem[0].usos, null);
});

test("sin desglose o sin respuesta todavía no se afirma que algo no se usó", () => {
  const vacio = { ...lider, fuente: "sin-desglose" as const, motivo: "motor-sin-desglose" as const };
  assert.equal(sabeUsos(vacio), false);
  assert.ok(itemsDe(vacio, "skills").every((x) => !x.nunca && x.usos === null));
  assert.equal(sabeUsos({ ...lider, motivo: "sin-uso" }), false);
  assert.equal(sabeUsos(lider), true);
});

test("estaApagado: el MCP se compara normalizado", () => {
  const a = { skills: ["x"], mcp: ["claude.ai Notion"], herramientas: [], memoria: [] };
  assert.equal(estaApagado(a, { tipo: "skills", nombre: "x" }), true);
  assert.equal(estaApagado(a, { tipo: "skills", nombre: "y" }), false);
  assert.equal(estaApagado(a, { tipo: "mcp", nombre: "claude_ai_Notion" }), true);
});

test("mapa de bloques: suma lo mismo que los bloques, no se pisan y entran en el rectángulo", () => {
  const bl = bloques(lider);
  assert.ok(bl.length > 0 && bl.length <= 14);
  const col = treemap(bl, 100, 40);
  assert.equal(col.length, bl.length);
  const area = col.reduce((n, b) => n + b.w * b.h, 0);
  assert.ok(Math.abs(area - 100 * 40) < 1e-6, `área ${area}`);
  for (const b of col) {
    assert.ok(b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 100 + 1e-9 && b.y + b.h <= 40 + 1e-9, b.id);
    // El área es proporcional a los tokens.
    const total = bl.reduce((n, x) => n + x.tokens, 0);
    assert.ok(Math.abs((b.w * b.h) / (100 * 40) - b.tokens / total) < 1e-9, b.id);
  }
  for (let i = 0; i < col.length; i++)
    for (let j = i + 1; j < col.length; j++) {
      const [a, b] = [col[i], col[j]];
      const solapa = a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;
      assert.ok(!solapa, `${a.id} pisa a ${b.id}`);
    }
  assert.deepEqual(treemap([], 100, 46), []);
});

test("mapa de bloques: lo chico se junta en un solo bloque 'resto'", () => {
  const bl = bloques(lider, 4);
  assert.equal(bl.length, 4);
  const resto = bl.at(-1)!;
  assert.equal(resto.resto, true);
  assert.equal(resto.clave, null);
});

test("un worker estimado: la memoria y las skills se listan, el mapa se arma sin herramientas medidas", () => {
  assert.equal(worker.estimado, true);
  assert.ok(itemsDe(worker, "memoria").length === 3);
  assert.ok(bloques(worker).length >= 3);
});

test("catálogo: busca sin tildes en nombre y descripción, filtra apagadas, nunca usadas y plugin", () => {
  const usos = { sabe: true, usadas: usadas([lider, worker]) };
  const f = (x: Partial<{ q: string; solo: "todas" | "apagadas" | "nunca"; plugin: string }>) => filtrarSkills(CATALOGO_FALSO, { q: "", solo: "todas", plugin: "", ...x }, usos).map((s) => s.nombre);
  assert.equal(f({}).length, CATALOGO_FALSO.length);
  assert.deepEqual(f({ q: "DISEÑO" }), ["revisar-diseno", "ui-ux-pro-max"]);
  assert.deepEqual(f({ q: "diseno interfaz estandar" }), ["revisar-diseno"]);
  assert.ok(f({ q: "hojas calculo" }).includes("planilla"));
  assert.deepEqual(f({ solo: "apagadas" }).sort(), ["diagramas", "migrar-esquema", "presentacion"]);
  // Usadas en el líder o en el worker: ui-ux-pro-max, workers y capturas.
  const nunca = f({ solo: "nunca" });
  assert.ok(!nunca.includes("workers") && !nunca.includes("capturas") && !nunca.includes("ui-ux-pro-max"));
  assert.ok(nunca.includes("informe-pdf") && nunca.includes("revisar-diseno"));
  // Una apagada no es "nunca usada": ya está apagada.
  assert.ok(!nunca.includes("presentacion"));
  assert.deepEqual(pluginsDe(CATALOGO_FALSO), ["caveman", "Investigación", "nube", "oficina"]);
  assert.deepEqual(f({ plugin: "nube" }).sort(), ["diagramas", "nube-base-datos", "nube-despliegue"]);
  assert.deepEqual(f({ plugin: "nube", q: "base" }), ["nube-base-datos"]);
  // Sin sesiones medidas no se inventa qué nunca se usó.
  assert.deepEqual(filtrarSkills(CATALOGO_FALSO, { q: "", solo: "nunca", plugin: "" }, { sabe: false, usadas: new Set() }), []);
});

test("porcentaje: entero y nunca 0 si hay algo", () => {
  assert.equal(porcentaje(50, 200), 25);
  assert.equal(porcentaje(1, 100_000), 1);
  assert.equal(porcentaje(0, 100), 0);
  assert.equal(porcentaje(5, 0), 0);
});

test("MCP: lo que suma nunca pasa de la categoría y el mapa no tiene un bloque gordo por lo diferido", () => {
  const mcp = categorias(lider).find((x) => x.id === "mcp")!;
  const servidores = itemsDe(lider, "mcp");
  assert.ok(servidores.reduce((n, i) => n + (i.tokens ?? 0), 0) <= mcp.tokens);
  const grande = Math.max(...bloques(lider).filter((b) => b.cat === "mcp").map((b) => b.tokens));
  assert.ok(grande < 1_000, `el bloque más grande de MCP pesa ${grande}`);
  // Los diferidos se dicen aparte en el servidor.
  assert.equal(servidores.find((i) => i.nombre === "claude_ai_Notion")!.diferidos, 124_566);
  assert.equal(servidores.find((i) => i.nombre === "claude_ai_Notion")!.resultados, 6_200);
});

test("sistema: sus piezas, y lo que no se pudo separar queda como 'sin separar'", () => {
  const cat = categorias(lider).find((x) => x.id === "sistema")!;
  const it = itemsDe(lider, "sistema", [], { tokensCat: cat.tokens });
  // El prompt viene partido en sus secciones (cada una con su texto), más hook, entorno, diferidas y lo que no se separó.
  assert.deepEqual([...new Set(it.map((i) => i.sis))].sort(), ["diferidas", "entorno", "hook", "prompt", "resto"]);
  const secciones = it.filter((i) => i.sis === "prompt");
  assert.deepEqual(secciones.map((i) => i.seccion).sort(), ["arnes", "contexto", "entorno", "intro", "memoria", "sesion", "suelta"]);
  assert.ok(secciones.every((i) => i.texto && i.tokens));
  assert.equal(secciones.find((i) => i.seccion === "arnes")!.nombre, "Harness");
  assert.equal(it.reduce((n, i) => n + (i.tokens ?? 0), 0), cat.tokens);
  assert.ok(it.find((i) => i.sis === "hook")!.texto?.startsWith("CAVEMAN"));
  // Sin la categoría no hay resto que calcular.
  assert.ok(!itemsDe(lider, "sistema").some((i) => i.sis === "resto"));
  assert.ok(bloques(lider).some((b) => b.cat === "sistema" && b.sis === "prompt"));
});

test("skills: la de un hook no es 'nunca usada', y 'nunca' mira todas las sesiones recientes, no sólo la abierta", () => {
  const recientes = { dias: 30, sesiones: 5, skills: { "informe-pdf": 3, "oficina:informe-pdf": 1 }, porHook: ["caveman:caveman"] };
  const sin = itemsDe(lider, "skills");
  const con = itemsDe(lider, "skills", [], { recientes });
  const por = (xs: typeof sin, n: string) => xs.find((i) => i.nombre === n)!;
  assert.equal(por(sin, "caveman:caveman").porHook, true);
  assert.equal(por(sin, "caveman:caveman").nunca, false);
  // En esta sesión no se usó, pero en otras sí.
  assert.equal(por(sin, "informe-pdf").nunca, true);
  assert.equal(por(con, "informe-pdf").nunca, false);
  assert.equal(por(con, "informe-pdf").recientes, 4);
  assert.equal(por(con, "planilla").nunca, true);
  // Si se pidió el dato de las otras sesiones y no llegó, no se afirma nada.
  assert.ok(itemsDe(lider, "skills", [], { recientes: null }).every((i) => !i.nunca));
  assert.ok(usadas([lider], recientes).has("informe-pdf") && usadas([lider], recientes).has("caveman:caveman"));
});

test("apagados: salen de la cuenta y del mapa, siguen en la lista, y lo que la medición ya no trae se puede prender", () => {
  const apagados = { skills: ["revisar-diseno", "ya-no-esta"], mcp: ["claude_ai_Notion"], herramientas: ["WebFetch"], memoria: [] };
  const antes = categorias(lider);
  const despues = categorias(lider, apagados);
  const t = (cs: typeof antes, id: string) => cs.find((c) => c.id === id)!.tokens;
  assert.equal(t(despues, "skills"), t(antes, "skills") - 600);
  assert.equal(t(despues, "mcp"), t(antes, "mcp") - 482);
  assert.equal(t(despues, "herramientas"), t(antes, "herramientas") - 1_300);
  assert.equal(fraccionUsada(lider, apagados)! < fraccionUsada(lider)!, true);
  assert.ok(!bloques(lider, 60, apagados).some((b) => ["revisar-diseno", "claude_ai_Notion", "WebFetch"].includes(b.nombre)));
  assert.ok(bloques(lider, 60).some((b) => b.nombre === "revisar-diseno"));
  const sk = itemsDe(lider, "skills", [], { apagados });
  assert.ok(sk.some((i) => i.nombre === "revisar-diseno" && !i.fantasma));
  const fantasma = sk.find((i) => i.fantasma)!;
  assert.deepEqual([fantasma.nombre, fantasma.apaga, fantasma.tokens], ["ya-no-esta", { tipo: "skills", nombre: "ya-no-esta" }, null]);
  // Sin apagados todo queda como estaba.
  assert.deepEqual(categorias(lider, { skills: [], mcp: [], herramientas: [], memoria: [] }), antes);
});

test("ayuda: cada categoría y cada pieza del sistema tiene su explicación en español y en inglés", async () => {
  const { es } = await import("../src/i18n/es.ts");
  const { en } = await import("../src/i18n/en.ts");
  const claves = [...ORDEN, "prompt", "hook", "diferidas", "entorno", "resto", "nunca", "diferida"].map((k) => `ctxp.ayuda.${k}`);
  for (const k of claves) {
    for (const [idioma, tabla] of [["es", es], ["en", en]] as const) {
      const v = (tabla as Record<string, string>)[k];
      assert.ok(v && v.length > 20, `${idioma}: falta ${k}`);
    }
  }
  // Dos líneas como mucho: nada de párrafos.
  for (const k of claves) assert.ok((es as Record<string, string>)[k].length <= 190, `${k} es larga`);
  assert.match((es as Record<string, string>)["ctxp.ayuda.reserva"], /compactar/);
  assert.match((en as Record<string, string>)["ctxp.ayuda.reserva"], /compact/);
});
