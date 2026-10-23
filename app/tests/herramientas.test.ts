// B19: una línea por herramienta (resumen, ruta relativa, grupos), el diff de
// Edit/Write, el relevo y lo que arma el transcript/stream de un líder.
import { test } from "node:test";
import assert from "node:assert/strict";
import { agrupar, cambios, contar, cuerpo, diffLineas, esRelevo, relativa, relevoHecho, resumen, usosDe, vieneDeRelevo } from "../src/hilo/herramientas.ts";
import { colaDe, conversacionDe, detDe, parsearLinea } from "../electron/lider-arma.ts";
import type { Herramienta } from "../src/datos/contrato.ts";

const T = "/home/ana/.claude/projects/-home-ana-Proyectos-mi-app/abc.jsonl";

test("relativa: la raíz sale del directorio del transcript; si no, ~", () => {
  assert.equal(relativa("/home/ana/Proyectos/mi-app/src/x.ts", T), "src/x.ts");
  assert.equal(relativa("/home/ana/Proyectos/otra/y.ts", T), "~/Proyectos/otra/y.ts");
  assert.equal(relativa("/etc/hosts", null), "/etc/hosts");
  assert.equal(relativa("src/rel.ts", T), "src/rel.ts");
});

test("resumen de cada herramienta", () => {
  assert.equal(resumen("Bash", { command: "npm test", description: "Corre los tests" }), "Corre los tests");
  assert.equal(resumen("Bash", { command: "\n  git status\ngit diff" }), "git status");
  assert.equal(resumen("Edit", { file_path: "/home/ana/Proyectos/mi-app/a.ts" }, T), "a.ts");
  assert.equal(resumen("Grep", { pattern: "foo\\(" }), "foo\\(");
  assert.equal(resumen("Agent", { description: "Busca usos", prompt: "…" }), "Busca usos");
  assert.equal(resumen("SendMessage", { to: "jefe", message: "hola" }), "jefe");
  assert.equal(resumen("ToolSearch", { query: "select:Read" }), "select:Read");
  assert.equal(resumen("WebFetch", { url: "https://x.y", prompt: "z" }), "https://x.y");
  assert.equal(resumen("Raro", {}), "");
  assert.ok(resumen("Bash", { command: "x".repeat(400) }).length <= 160);
});

test("usosDe: con det, del det; sin det, del texto viejo", () => {
  const det: Herramienta[] = [{ nombre: "Read", entrada: { file_path: "/a/b" } }];
  assert.deepEqual(usosDe(["Read"], det, null), [{ nombre: "Read", resumen: "/a/b", det: det[0] }]);
  assert.deepEqual(usosDe(["Bash: git status", "Read"], undefined, null), [
    { nombre: "Bash", resumen: "git status", det: null },
    { nombre: "Read", resumen: "", det: null },
  ]);
});

test("agrupar: sólo las iguales y seguidas", () => {
  const u = (nombre: string, r: string) => ({ nombre, resumen: r, det: null });
  const g = agrupar([u("Read", "a"), u("Read", "a"), u("Read", "b"), u("Read", "a")]);
  assert.deepEqual(
    g.map((x) => [x.uso.resumen, x.todos.length]),
    [
      ["a", 2],
      ["b", 1],
      ["a", 1],
    ],
  );
});

test("diffLineas: bordes comunes, LCS en el medio, los - antes que los +", () => {
  const d = diffLineas("a\nb\nc\nd", "a\nB\nc\nd\ne");
  assert.deepEqual(d, [
    { tipo: " ", texto: "a" },
    { tipo: "-", texto: "b" },
    { tipo: "+", texto: "B" },
    { tipo: " ", texto: "c" },
    { tipo: " ", texto: "d" },
    { tipo: "+", texto: "e" },
  ]);
  assert.deepEqual(contar(d), { mas: 2, menos: 1 });
  assert.deepEqual(diffLineas("", "x\ny"), [
    { tipo: "+", texto: "x" },
    { tipo: "+", texto: "y" },
  ]);
  assert.deepEqual(contar(diffLineas("x\ny\n", "x\ny\n")), { mas: 0, menos: 0 });
  // Un tramo con varias: primero todas las que salen.
  assert.deepEqual(
    diffLineas("1\n2\n3", "4\n5").map((l) => l.tipo),
    ["-", "-", "-", "+", "+"],
  );
});

test("cuerpo y cambios", () => {
  assert.deepEqual(cuerpo({ nombre: "Bash", entrada: { command: "ls" } }), { tipo: "comando", comando: "ls", cortado: false });
  assert.equal((cuerpo({ nombre: "Bash", entrada: { command: "x".repeat(2000) } }) as { cortado: boolean }).cortado, true);
  assert.deepEqual(cambios({ nombre: "Edit", entrada: { old_string: "a", new_string: "b\nc" } }), { mas: 2, menos: 1 });
  assert.deepEqual(cambios({ nombre: "Write", entrada: { content: "1\n2\n3\n" } }), { mas: 3, menos: 0 });
  const me = cuerpo({ nombre: "MultiEdit", entrada: { edits: [{ old_string: "a", new_string: "b" }, { old_string: "c", new_string: "d" }, { nope: 1 }] } });
  assert.ok(me.tipo === "diff" && me.tramos.length === 2);
  assert.equal(cambios({ nombre: "Read", entrada: { file_path: "/x" } }), null);
  assert.equal(cuerpo(null).tipo, "nada");
});

test("relevo: la llamada, si salió y el primer mensaje del nuevo", () => {
  const b = (command: string, resultado?: Herramienta["resultado"]): Herramienta => ({ nombre: "Bash", entrada: { command }, resultado });
  assert.ok(esRelevo(b("relevo")));
  assert.ok(esRelevo(b("pa --nota 'x' && relevo")));
  assert.ok(esRelevo(b("~/orquestador/bin/relevo --ya")));
  assert.ok(!esRelevo(b("cat relevo.md")));
  assert.ok(!esRelevo(b("grep relevo x")));
  assert.ok(!esRelevo({ nombre: "Read", entrada: { file_path: "relevo" } }));
  assert.ok(relevoHecho(b("relevo", { texto: "relevo: sesión nueva corriendo (pid 12)", error: false })));
  assert.ok(!relevoHecho(b("relevo", { texto: "relevo: sesión nueva corriendo (pid 12)", error: true })));
  assert.ok(!relevoHecho(b("relevo")));
  assert.deepEqual(vieneDeRelevo("Sos el jefe. Esto es un RELEVO automático: traspaso en ~/.claude/plans/relevo-20261003-120000.md"), {
    traspaso: "~/.claude/plans/relevo-20261003-120000.md",
  });
  assert.equal(vieneDeRelevo("hola"), null);
});

test("líder: det y resultados del stream y del transcript", () => {
  const d = detDe({ type: "tool_use", id: "tu1", name: "Bash", input: { command: "y".repeat(2500), description: "d" } });
  assert.equal(d.id, "tu1");
  assert.equal(d.cortado, true);
  assert.equal((d.entrada.command as string).length, 2000);

  const [m] = parsearLinea(JSON.stringify({ type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: "/a" } }] } }));
  assert.ok(m.tipo === "mensaje" && m.det.length === 1 && m.det[0].id === "tu1");
  assert.deepEqual(
    parsearLinea(JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok", is_error: true }] } })),
    [{ tipo: "resultado", id: "tu1", texto: "ok", error: true }],
  );

  const largo = Array.from({ length: 30 }, (_, i) => `l${i}`).join("\n");
  assert.ok(colaDe(largo).startsWith("…\nl15"));
  assert.equal(colaDe([{ type: "text", text: "a" }, { type: "image" }]), "a");

  const lineas = [
    { type: "user", message: { content: "corré" } },
    { type: "assistant", message: { id: "m1", content: [{ type: "tool_use", id: "tu1", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: [{ type: "text", text: "a\nb" }] }] } },
    { type: "assistant", message: { id: "m2", content: [{ type: "text", text: "listo" }] } },
  ];
  const r = conversacionDe("s", "/t.jsonl", lineas.map((x) => JSON.stringify(x)).join("\n"));
  assert.equal(r.mensajes.length, 3);
  assert.deepEqual(r.mensajes[1].det, [{ nombre: "Bash", entrada: { command: "ls" }, id: "tu1", resultado: { texto: "a\nb", error: false } }]);
  assert.equal(r.mensajes[2].det, undefined);
});
