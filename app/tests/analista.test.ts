// El analista de Ramas (B22): el brief y el parser de veredictos (src/datos/analista.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { edad, promptActualizar, promptAnalista, veredictos } from "../src/datos/analista.ts";
import type { RamaBrief } from "../electron/asistente.ts";

const r = (x: Partial<RamaBrief> = {}): RamaBrief => ({
  id: "20261003-100700-99999",
  proyecto: "Atlas Web",
  ruta: "/tmp/atlas",
  rama: "pa/atlas/20261003-100700-99999",
  estado: "murio",
  tarea: "Paginar\nel listado",
  resultado: null,
  decision: null,
  commits: ["abc1234 paginado por cursor"],
  archivos: ["src/lista.ts", "tests/lista.test.ts"],
  edad_s: 7200,
  lider_vivo: false,
  ...x,
});

test("el brief lleva cada rama con proyecto, id, tarea, estado, edad, líder, RESULTADO/DECISION, commits y archivos", () => {
  const p = promptAnalista([
    r(),
    r({ id: "20261003-100800-12121", estado: "decision", resultado: "Hice A.", decision: "¿B o C?", lider_vivo: null, commits: 4, archivos: null, edad_s: 90 }),
  ]);
  for (const x of [
    "Ramas (2):",
    "- id: 20261003-100700-99999",
    "Atlas Web (/tmp/atlas) · rama pa/atlas/20261003-100700-99999",
    "Tarea: Paginar el listado",
    "Estado: murio (murió",
    "hace 2 h",
    "Líder: ya no está",
    "RESULTADO: (no dejó)",
    "    - abc1234 paginado por cursor",
    "  - Archivos (2):",
    "    - tests/lista.test.ts",
    "- id: 20261003-100800-12121",
    "Líder: no tiene",
    "RESULTADO: Hice A.",
    "DECISION: ¿B o C?",
    "  - Commits: 4",
    "hace 2 min",
    "`pa --hilo <id> --json -n 6`",
    '"veredicto": "integrar|descartar|retomar|revisar"',
    "```json",
  ])
    assert.ok(p.includes(x), x);
  assert.match(p, /No integres, descartes ni lances nada/);
  assert.ok(promptActualizar([r()]).includes("- id: 20261003-100700-99999"));
});

test("muchos archivos: el tope y cuántos más", () => {
  const p = promptAnalista([r({ archivos: Array.from({ length: 20 }, (_, i) => `f${i}.ts`) })]);
  assert.ok(p.includes("(y 5 más)"));
  assert.ok(!p.includes("f15.ts"));
  assert.equal(edad(30), "1 min");
  assert.equal(edad(200000), "2 d");
});

const ids = new Set(["a1", "b2", "c3"]);

test("veredictos: el último bloque json que sea un array; ids desconocidos y veredictos raros afuera", () => {
  const texto = [
    "Resumen viejo",
    "```json",
    '[{"id":"a1","veredicto":"descartar","motivo":"viejo"}]',
    "```",
    "Ahora:",
    "```json",
    JSON.stringify([
      { id: "a1", veredicto: "Integrar", motivo: " completa " },
      { id: "b2", veredicto: "retomar", motivo: "a medias" },
      { id: "zz", veredicto: "integrar", motivo: "no está" },
      { id: "c3", veredicto: "mergear", motivo: "raro" },
    ]),
    "```",
  ].join("\n");
  const v = veredictos(texto, ids)!;
  assert.deepEqual([...v.keys()], ["a1", "b2"]);
  assert.deepEqual(v.get("a1"), { id: "a1", veredicto: "integrar", motivo: "completa" });
  assert.equal(v.get("b2")!.veredicto, "retomar");
});

test("veredictos: un bloque roto o que no es array se saltea; sin bloque, null", () => {
  assert.equal(veredictos("nada por acá", ids), null);
  assert.equal(veredictos("```json\n{\"id\":\"a1\"}\n```", ids), null);
  const v = veredictos('```json\n[{"id":"c3","veredicto":"revisar"}]\n```\n```json\n[{roto\n```', ids)!;
  assert.deepEqual(v.get("c3"), { id: "c3", veredicto: "revisar", motivo: "" });
  assert.equal(veredictos("```\n[]\n```", ids)!.size, 0);
});
