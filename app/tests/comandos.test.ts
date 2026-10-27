// Los comandos con "/" de la caja del líder (src/hilo/comandos.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { completar, directo, menuEn, moverSel, parsearComando, reemplazar, sugerencias } from "../src/hilo/comandos.ts";

const MODELOS = [
  { id: "claude-opus-5-5", clave: "opus" },
  { id: "claude-sonnet-5-5", clave: "sonnet" },
  { id: "claude-haiku-5-5", clave: "haiku" },
];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const p = (t: string) => parsearComando(t, MODELOS, EFFORTS);

test("los modos los resuelve la app; /plan con texto lo manda después", () => {
  assert.deepEqual(p("/plan"), { tipo: "modo", modo: "plan", resto: "" });
  assert.deepEqual(p("  /PLAN  armá el settle en lote\ncon tests "), { tipo: "modo", modo: "plan", resto: "armá el settle en lote\ncon tests" });
  assert.deepEqual(p("/default"), { tipo: "modo", modo: "default", resto: "" });
  assert.equal((p("/accept-edits") as { modo: string }).modo, "acceptEdits");
  assert.equal((p("/acceptEdits") as { modo: string }).modo, "acceptEdits");
  assert.equal((p("/bypass") as { modo: string }).modo, "bypassPermissions");
  assert.equal((p("/bypassPermissions") as { modo: string }).modo, "bypassPermissions");
});

test("/clear, /model y /effort; con un argumento raro, el error con su uso", () => {
  assert.deepEqual(p("/clear"), { tipo: "limpiar" });
  assert.deepEqual(p("/model sonnet"), { tipo: "modelo", modelo: "claude-sonnet-5-5" });
  assert.deepEqual(p("/model claude-opus-5-5"), { tipo: "modelo", modelo: "claude-opus-5-5" });
  assert.deepEqual(p("/model Haiku"), { tipo: "modelo", modelo: "claude-haiku-5-5" });
  assert.deepEqual(p("/model gpt"), { tipo: "error", clave: "comando.usoModelo", v: "gpt" });
  assert.deepEqual(p("/model"), { tipo: "error", clave: "comando.usoModelo", v: "" });
  assert.deepEqual(p("/effort max"), { tipo: "effort", effort: "max" });
  assert.deepEqual(p("/effort turbo"), { tipo: "error", clave: "comando.usoEffort", v: "turbo" });
});

test("lo demás va al líder tal cual: texto, /compact, skills, una ruta", () => {
  for (const t of ["hola", "/compact", "/compact dejá sólo lo de B13", "/review 123", "/mi-skill", "mirá /plan esto", "/"]) assert.deepEqual(p(t), { tipo: "texto" });
});

test("menú: sólo con '/' y un nombre; los de la app primero, sin repetir; prefijo antes que contiene", () => {
  const claude = [
    { nombre: "compact", descripcion: "Clear conversation history", args: "<instructions>" },
    { nombre: "review", descripcion: "Review a pull request", args: null },
    { nombre: "plan", descripcion: "de Claude Code", args: null },
    { nombre: "explain-plan", descripcion: "Una skill", args: "" },
  ];
  const todos = sugerencias("/", claude).map((s) => s.nombre);
  assert.deepEqual(todos, ["plan", "default", "accept-edits", "bypass", "clear", "model", "effort", "compact", "output-style", "review", "explain-plan"]);
  assert.deepEqual(sugerencias("/pla", claude).map((s) => s.nombre), ["plan", "explain-plan"]);
  assert.deepEqual(sugerencias("/rev", claude).map((s) => s.nombre), ["review"]);
  assert.equal(sugerencias("/review ", claude).length, 0);
  assert.equal(sugerencias("hola /", claude).length, 0);
  assert.equal(sugerencias("", claude).length, 0);
  const rev = sugerencias("/review", claude)[0];
  assert.equal(rev.descripcion, "Review a pull request");
  assert.equal(rev.clave, null);
});

test("elegir una fila: sin argumentos la ejecuta; con, deja '/model ' para seguir", () => {
  const [model] = sugerencias("/mod", []);
  assert.equal(completar(model), "/model ");
  assert.equal(directo(model), false);
  const [plan] = sugerencias("/plan", []);
  assert.equal(completar(plan), "/plan");
  assert.equal(directo(plan), true);
});

test("/output-style: el nombre exacto, si no sin mayúsculas; sin lista del CLI, los de fábrica", () => {
  const estilos = ["default", "Explanatory", "Learning", "Concise"];
  assert.deepEqual(parsearComando("/output-style Concise", MODELOS, EFFORTS, estilos), { tipo: "estilo", estilo: "Concise" });
  assert.deepEqual(parsearComando("/output-style concise", MODELOS, EFFORTS, estilos), { tipo: "estilo", estilo: "Concise" });
  assert.deepEqual(parsearComando("/output-style Raro", MODELOS, EFFORTS, estilos), { tipo: "error", clave: "comando.usoEstilo", v: "Raro" });
  assert.deepEqual(p("/output-style learning"), { tipo: "estilo", estilo: "Learning" });
  assert.deepEqual(p("/output-style"), { tipo: "error", clave: "comando.usoEstilo", v: "" });
});

test("segundo nivel: '/model ' lista sus valores con el actual marcado; filtra; elegir uno lo ejecuta", () => {
  const valores = {
    model: { lista: [{ valor: "opus", desc: "Opus 5.5" }, { valor: "sonnet", desc: null }, { valor: "haiku", desc: null }], actual: "sonnet" },
    "output-style": { lista: [{ valor: "default", desc: null }, { valor: "Concise", desc: null }, { valor: "Explanatory", desc: null }], actual: "Concise" },
  };
  const filas = sugerencias("/model ", [], valores);
  assert.deepEqual(filas.map((s) => s.valor), ["opus", "sonnet", "haiku"]);
  assert.deepEqual(filas.map((s) => s.actual), [false, true, false]);
  assert.equal(filas[0].descripcion, "Opus 5.5");
  assert.deepEqual(sugerencias("/MODEL so", [], valores).map((s) => s.valor), ["sonnet"]);
  assert.deepEqual(sugerencias("/output-style e", [], valores).map((s) => s.valor), ["Explanatory", "default", "Concise"]);
  assert.equal(sugerencias("/model opus ", [], valores).length, 0);
  assert.equal(sugerencias("/compact ", [], valores).length, 0);
  const [son] = sugerencias("/model son", [], valores);
  assert.equal(completar(son), "/model sonnet");
  assert.equal(directo(son), true);
  assert.deepEqual(p(completar(son)), { tipo: "modelo", modelo: "claude-sonnet-5-5" });
});

test("teclas del menú: flechas con vuelta, Home y End a las puntas; lo demás no mueve", () => {
  assert.equal(moverSel(0, 5, "ArrowDown"), 1);
  assert.equal(moverSel(4, 5, "ArrowDown"), 0);
  assert.equal(moverSel(0, 5, "ArrowUp"), 4);
  assert.equal(moverSel(3, 5, "Home"), 0);
  assert.equal(moverSel(1, 5, "End"), 4);
  assert.equal(moverSel(1, 5, "Enter"), null);
  assert.equal(moverSel(0, 0, "ArrowDown"), null);
});

test("menuEn: el token '/xxx' donde está el cursor, tras inicio, espacio o salto; no en medio de una palabra", () => {
  const claude = [{ nombre: "review", descripcion: "Review a pull request", args: null }];
  const en = (t: string, c = t.length) => menuEn(t, c, claude);
  const m = en("hola /");
  assert.ok(m && m.filas.length > 0);
  assert.equal(m.ini, 5);
  assert.equal(m.fin, 6);
  assert.equal(en("hola /pla")!.filas[0].nombre, "plan");
  assert.equal(en("hola\n/re")!.filas[0].nombre, "review");
  assert.equal(en("a/b"), null);
  assert.equal(en("ver http://x/pla"), null);
  assert.equal(en("mira /home/ana"), null);
  assert.equal(en("hola /model "), null);
  assert.equal(en("hola /pla que sigue", 5), null);
});

test("menuEn y reemplazar: elegir cambia sólo el token, lo que sigue queda igual", () => {
  const claude: never[] = [];
  const texto = "hola /pla que sigue";
  const m = menuEn(texto, 9, claude)!;
  assert.deepEqual(reemplazar(texto, m, m.filas[0]), { texto: "hola /plan que sigue", caret: 10 });
  // El cursor en medio del token: filtra con lo de antes del cursor y reemplaza el token entero.
  const medio = "hola /pl arma";
  const m2 = menuEn(medio, 8, claude)!;
  assert.deepEqual(reemplazar(medio, m2, m2.filas[0]), { texto: "hola /plan arma", caret: 10 });
  // Un comando con argumentos deja "/model " sin duplicar el espacio que ya seguía.
  const mo = "hola /mo armá";
  const m3 = menuEn(mo, 8, claude)!;
  assert.deepEqual(reemplazar(mo, m3, m3.filas[0]), { texto: "hola /model armá", caret: 12 });
});

test("menuEn al inicio: '/model op' ofrece sus valores y el valor elegido reemplaza el tramo", () => {
  const valores = { model: { lista: [{ valor: "opus", desc: null }, { valor: "sonnet", desc: null }], actual: null } };
  const m = menuEn("/model op", 9, [], valores)!;
  assert.equal(m.filas[0].valor, "opus");
  assert.deepEqual(reemplazar("/model op", m, m.filas[0]), { texto: "/model opus", caret: 11 });
});

test("líder de agy (gemini-* o agy:*): el menú ofrece sólo /clear, /model, /effort, /compact y las skills de agy; Ollama sigue con el de Claude", () => {
  const mixtos = [
    { nombre: "review", descripcion: "Review a PR", args: null, agy: false },
    { nombre: "pa-worker:ana-orquestar", descripcion: "Skill (pa-worker)", args: null, agy: true },
    { nombre: "pa-worker:gemini", descripcion: "Skill (pa-worker)", args: null, agy: true },
  ];
  const valores = {
    model: {
      lista: [
        { valor: "opus", desc: "Opus 5.5" },
        { valor: "ollama:qwen3.5:9b", desc: "Qwen 3.5" },
        { valor: "gemini-4-argon", desc: "Gemini 4 Argon" },
        { valor: "gemini-3.8-flash", desc: "Gemini 3.8 Flash" },
        { valor: "agy:claude-opus-5-5", desc: "Claude Opus 5.5 · por Google" },
      ],
      actual: "gemini-4-argon",
    },
    "output-style": { lista: [{ valor: "default", desc: null }], actual: "default" },
  };
  for (const mod of ["gemini-4-argon", "agy:claude-opus-5-5"]) {
    assert.deepEqual(sugerencias("/", mixtos, valores, mod).map((s) => s.nombre), [
      "clear",
      "model",
      "effort",
      "compact",
      "pa-worker:ana-orquestar",
      "pa-worker:gemini",
    ]);
    // El segundo nivel de /model ofrece todos: uno de otro motor sigue la conversación en una sesión nueva (la caja pide confirmación).
    assert.deepEqual(sugerencias("/model ", mixtos, valores, mod).map((s) => s.valor), [
      "opus",
      "ollama:qwen3.5:9b",
      "gemini-4-argon",
      "gemini-3.8-flash",
      "agy:claude-opus-5-5",
    ]);
    assert.equal(sugerencias("/output-style ", mixtos, valores, mod).length, 0);
    assert.equal(menuEn("/output-style ", 14, mixtos, valores, mod), null);
  }
  const ollama = sugerencias("/", mixtos, valores, "ollama:qwen3.5:9b").map((s) => s.nombre);
  assert.deepEqual(ollama, ["plan", "default", "accept-edits", "bypass", "clear", "model", "effort", "compact", "output-style", "review"]);
  // /compact va como texto a agy (no lo resuelve la app) y, con un mensaje, compacta y contesta.
  assert.deepEqual(parsearComando("/compact", [], [], [], "gemini-4-argon"), { tipo: "texto" });
  assert.deepEqual(parsearComando("/compact ahora seguí con X", [], [], [], "gemini-4-argon"), { tipo: "texto" });
  assert.deepEqual(sugerencias("/comp", mixtos, valores, "gemini-3.8-flash").map((s) => s.nombre), ["compact"]);
  assert.deepEqual(sugerencias("/model ", mixtos, valores, "ollama:qwen3.5:9b").map((s) => s.valor), ["opus", "ollama:qwen3.5:9b", "gemini-4-argon", "gemini-3.8-flash", "agy:claude-opus-5-5"]);
});

test("parsearComando: /model cruza entre agy y claude sin error (la caja pide la confirmación); en agy los modos y output-style van como texto", () => {
  const todos = [
    ...MODELOS,
    { id: "ollama:qwen3.5:9b", clave: "ollama:qwen3.5:9b" },
    { id: "gemini-4-argon", clave: "gemini-4-argon" },
    { id: "gemini-3.8-flash", clave: "gemini-3.8-flash" },
    { id: "agy:claude-opus-5-5", clave: "agy:claude-opus-5-5" },
  ];
  const effAgy = ["low", "medium", "high"];
  assert.deepEqual(parsearComando("/model gemini-3.8-flash", todos, effAgy, [], "gemini-4-argon"), { tipo: "modelo", modelo: "gemini-3.8-flash" });
  assert.deepEqual(parsearComando("/model agy:claude-opus-5-5", todos, effAgy, [], "gemini-4-argon"), { tipo: "modelo", modelo: "agy:claude-opus-5-5" });
  assert.deepEqual(parsearComando("/model opus", todos, effAgy, [], "gemini-4-argon"), { tipo: "modelo", modelo: "claude-opus-5-5" });
  assert.deepEqual(parsearComando("/model gemini-4-argon", todos, EFFORTS, [], "claude-opus-5-5"), { tipo: "modelo", modelo: "gemini-4-argon" });
  assert.deepEqual(parsearComando("/model agy:claude-opus-5-5", todos, EFFORTS, [], "ollama:qwen3.5:9b"), { tipo: "modelo", modelo: "agy:claude-opus-5-5" });
  assert.deepEqual(parsearComando("/plan", todos, effAgy, [], "gemini-4-argon"), { tipo: "texto" });
  assert.deepEqual(parsearComando("/output-style Concise", todos, effAgy, ["Concise"], "gemini-4-argon"), { tipo: "texto" });
});

test("otra empresa: con '/' solo nada ajeno; buscando, sus coincidencias van al final, marcadas, sin duplicar y sin ejecutarse", () => {
  const claude = [
    { nombre: "design", descripcion: null, args: null },
    { nombre: "security-review", descripcion: null, args: null },
  ];
  const agy = [
    { nombre: "security-review", descripcion: null, args: null, agy: true },
    { nombre: "brainstorm", descripcion: null, args: null, agy: true },
  ];
  // "/" solo: sólo lo que corre con el modelo puesto.
  assert.ok(sugerencias("/", claude, {}, false, agy).every((s) => !s.ajeno));
  assert.ok(sugerencias("/", agy, {}, true, claude).every((s) => !s.ajeno));
  assert.equal(sugerencias("/", agy, {}, true, claude).some((s) => s.nombre === "design"), false);
  // Buscando desde Claude: lo de Google, después de lo propio y marcado.
  const f = sugerencias("/brain", claude, {}, false, agy);
  assert.deepEqual(f.map((s) => [s.nombre, s.ajeno]), [["brainstorm", "google"]]);
  const r = sugerencias("/r", claude, {}, false, agy);
  assert.equal(r.filter((s) => s.nombre === "security-review").length, 1);
  assert.equal(r.find((s) => s.nombre === "security-review")!.ajeno, undefined);
  // Desde agy: lo de Anthropic (skills y builtin propios de la app), marcado.
  const g = sugerencias("/des", agy, {}, true, claude);
  assert.deepEqual(g.map((s) => [s.nombre, s.ajeno]), [["design", "anthropic"]]);
  assert.equal(sugerencias("/plan", agy, {}, true, claude).find((s) => s.nombre === "plan")!.ajeno, "anthropic");
  // No duplicados: /compact y /clear existen en los dos.
  assert.equal(sugerencias("/c", claude, {}, false, agy).filter((s) => s.nombre === "compact").length, 1);
  // La fila ajena ni es directa ni se ofrece en OpenCode/dsh.
  assert.equal(directo(g[0]), false);
  assert.ok(sugerencias("/des", claude, {}, "opencode:opencode/big-pickle", agy).every((s) => !s.ajeno));
  // Llega por menuEn (token en medio de la caja).
  assert.equal(menuEn("hola /brain", 11, claude, {}, false, agy)!.filas[0].ajeno, "google");
});

test("parsearComando: un líder de dsh puede seguir con Claude, Gemini u otro dsh con /model; un nombre que la tabla no conoce sigue siendo un error de uso", () => {
  const todos = [...MODELOS, { id: "gemini-4-argon", clave: "gemini-4-argon" }, { id: "dsh:opencode/big-pickle", clave: "dsh:opencode/big-pickle" }, { id: "dsh:deepseek/deepseek-v4-flash", clave: "dsh:deepseek/deepseek-v4-flash" }];
  const actual = "dsh:opencode/big-pickle";
  assert.deepEqual(parsearComando("/model dsh:deepseek/deepseek-v4-flash", todos, [], [], actual), { tipo: "modelo", modelo: "dsh:deepseek/deepseek-v4-flash" });
  assert.deepEqual(parsearComando("/model opus", todos, [], [], actual), { tipo: "modelo", modelo: "claude-opus-5-5" });
  assert.deepEqual(parsearComando("/model gemini-4-argon", todos, [], [], actual), { tipo: "modelo", modelo: "gemini-4-argon" });
  // Y al revés: Claude y Gemini pasan a dsh.
  assert.deepEqual(parsearComando("/model dsh:opencode/big-pickle", todos, EFFORTS, [], "claude-opus-5-5"), { tipo: "modelo", modelo: "dsh:opencode/big-pickle" });
  assert.deepEqual(parsearComando("/model dsh:opencode/big-pickle", todos, EFFORTS, [], "gemini-4-argon"), { tipo: "modelo", modelo: "dsh:opencode/big-pickle" });
  // Lo que la tabla no conoce no es un cambio de motor: es un uso incorrecto del comando.
  assert.deepEqual(parsearComando("/model dsh:nube/x", MODELOS, EFFORTS, [], "claude-opus-5-5"), { tipo: "error", clave: "comando.usoModelo", v: "dsh:nube/x" });
  assert.deepEqual(parsearComando("/model opus", [], [], [], actual), { tipo: "error", clave: "comando.usoModelo", v: "opus" });
});

test("/effort en OpenCode: el menú ofrece los niveles del modelo puesto; sin niveles no se ofrece", () => {
  const con = { effort: { lista: [{ valor: "low", desc: null }, { valor: "high", desc: null }], actual: "low" } };
  const sin = { effort: { lista: [], actual: null } };
  const args = (v: Parameters<typeof sugerencias>[2], m: string) => sugerencias("/eff", [], v, m).find((s) => s.nombre === "effort")?.args;
  assert.equal(args(con, "opencode:opencode/beam-free"), "<low|high>");
  assert.equal(args(con, "dsh:nube/x"), "<low|high>");
  assert.equal(args(sin, "opencode:opencode/big-pickle"), undefined);
  assert.equal(args(sin, "dsh:nube/x"), undefined);
  // Claude no cambia.
  assert.equal(args(con, "claude-opus-5-5"), "<low|medium|high|xhigh|max>");
  assert.equal(menuEn("/eff", 4, [], sin, "opencode:opencode/big-pickle")?.filas.some((s) => s.nombre === "effort"), false);
});

test("/effort sin niveles dice que no hay; sin argumento muestra el uso; con niveles, igual que antes", () => {
  const oc = "opencode:opencode/big-pickle";
  assert.deepEqual(parsearComando("/effort high", MODELOS, [], [], oc), { tipo: "error", clave: "comando.sinEffortOpencode", v: "high" });
  assert.deepEqual(parsearComando("/effort", MODELOS, [], [], oc), { tipo: "error", clave: "comando.sinEffortOpencode", v: "" });
  assert.deepEqual(parsearComando("/effort", MODELOS, [], [], "dsh:nube/x"), { tipo: "error", clave: "comando.sinEffort", v: "" });
  assert.deepEqual(parsearComando("/effort", MODELOS, ["low", "high"], [], "opencode:opencode/beam-free"), { tipo: "error", clave: "comando.usoEffortVacio", v: "" });
  assert.deepEqual(parsearComando("/effort max", MODELOS, ["low", "high"], [], "opencode:opencode/beam-free"), { tipo: "error", clave: "comando.usoEffort", v: "max" });
  assert.deepEqual(parsearComando("/effort HIGH", MODELOS, ["low", "high"], [], "opencode:opencode/beam-free"), { tipo: "effort", effort: "high" });
});
