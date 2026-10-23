// "Retomar" (B22): el prompt del líder nuevo (src/datos/retomar.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { comoTermino, promptRetomar, type DatosRetomar } from "../src/datos/retomar.ts";

const base: DatosRetomar = {
  id: "20261003-100700-99999",
  proyecto: "Atlas Web",
  ruta: "/tmp/atlas",
  rama: "pa/atlas/20261003-100700-99999",
  commits: ["abc1234 paginado por cursor", "def5678 tests del cursor"],
  tope: 20,
  tarea: "Paginar el listado",
  resultado: null,
  decision: null,
  estado: "murio",
  tests: true,
};

test("lleva la tarea, el id, la rama, los commits y cómo terminó", () => {
  const p = promptRetomar(base);
  for (const x of [
    "Paginar el listado",
    "- Corrida: 20261003-100700-99999",
    "`pa --hilo 20261003-100700-99999 --json`",
    "- Rama: pa/atlas/20261003-100700-99999",
    "- Commits (2):",
    "  - abc1234 paginado por cursor",
    "Atlas Web (/tmp/atlas)",
    comoTermino("murio"),
    "(no dejó RESULTADO)",
  ])
    assert.ok(p.includes(x), x);
});

test("pide mirar la rama primero, seguir con --seguir --id o un pa nuevo, o recomendar descartar", () => {
  const p = promptRetomar(base);
  assert.ok(p.includes("git -C /tmp/atlas diff HEAD...pa/atlas/20261003-100700-99999"));
  assert.ok(p.includes('`pa "Atlas Web" --leer'));
  assert.ok(p.includes('`pa "Atlas Web" --seguir --id 20261003-100700-99999 "<lo que falta>"`'));
  assert.ok(p.includes('`pa "Atlas Web" --integrar <id> --tests`'));
  assert.ok(p.includes("`pa --descartar 20261003-100700-99999`"));
  assert.match(p, /no la descartes sin que el usuario diga que sí/);
  assert.match(p, /en español y corto/);
  assert.ok(p.indexOf("Primero mirá la rama") < p.indexOf("--seguir --id"));
});

test("RESULTADO y DECISION enteros si los dejó; sin tests, --integrar sin --tests", () => {
  const p = promptRetomar({ ...base, estado: "decision", resultado: "Hice la mitad.", decision: "¿Sigo con B?", tests: false, proyecto: "atlas" });
  assert.ok(p.includes("Su RESULTADO:\nHice la mitad."));
  assert.ok(p.includes("Su DECISION:\n¿Sigo con B?"));
  assert.ok(p.includes("`pa atlas --integrar <id>`"));
  assert.ok(p.includes("terminó pidiendo una decisión"));
});

test("con muchos commits, sólo el tope; con un número, el número; sin rama lo dice", () => {
  const muchos = Array.from({ length: 25 }, (_, i) => `c${i} cosa`);
  assert.ok(promptRetomar({ ...base, commits: muchos }).includes("- Commits (más de 20):"));
  assert.ok(!promptRetomar({ ...base, commits: muchos }).includes("c20 cosa"));
  assert.ok(promptRetomar({ ...base, commits: 3 }).includes("- Commits: 3"));
  assert.ok(promptRetomar({ ...base, rama: null }).includes("- Sin rama"));
});
