// tests/salud-eventos.test.ts: el archivo de salud (electron/salud-eventos.ts): recorte, filtro por días y archivo roto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { anotar, leer, MAX_EVENTOS } from "../electron/salud-eventos.ts";

const carpeta = () => mkdtempSync(path.join(os.tmpdir(), "trama-salud-"));
const DIA = 86_400_000;

test("anotar: deja los últimos MAX_EVENTOS", () => {
  const dir = carpeta();
  const f = path.join(dir, "s.jsonl");
  try {
    for (let i = 0; i < MAX_EVENTOS + 25; i++) anotar({ tipo: "reinicio", ms: i }, f, 1000 + i);
    const todos = leer(1, f, 1000 + MAX_EVENTOS + 25);
    assert.equal(todos.length, MAX_EVENTOS);
    assert.deepEqual(todos[0], { t: 1025, tipo: "reinicio", ms: 25 });
    assert.equal((todos.at(-1) as { ms: number }).ms, MAX_EVENTOS + 24);
    assert.equal(readFileSync(f, "utf8").split("\n").filter(Boolean).length, MAX_EVENTOS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("leer: sólo los de los últimos N días", () => {
  const dir = carpeta();
  const f = path.join(dir, "s.jsonl");
  const ahora = 100 * DIA;
  try {
    anotar({ tipo: "lideres-cortados", n: 1 }, f, ahora - 10 * DIA);
    anotar({ tipo: "aviso-descartado", motivo: "quitado" }, f, ahora - 2 * DIA);
    anotar({ tipo: "vuelta-version" }, f, ahora - 1000);
    assert.deepEqual(leer(7, f, ahora).map((e) => e.tipo), ["aviso-descartado", "vuelta-version"]);
    assert.equal(leer(30, f, ahora).length, 3);
    assert.equal(leer(1, f, ahora).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("archivo roto o ausente: leer salta lo roto, anotar sigue, nada lanza", () => {
  const dir = carpeta();
  const f = path.join(dir, "s.jsonl");
  try {
    assert.deepEqual(leer(7, path.join(dir, "no-existe"), 5), []);
    writeFileSync(f, `{"t":5,"tipo":"reinicio","ms":3}\nesto no es json\n{"t":"x"}\n{"t":6,"tipo":"vuelta-version"`);
    assert.deepEqual(leer(1, f, 10), [{ t: 5, tipo: "reinicio", ms: 3 }]);
    anotar({ tipo: "lideres-cortados", n: 2 }, f, 7);
    assert.equal(leer(1, f, 10).at(-1)?.tipo, "lideres-cortados");
    assert.doesNotThrow(() => anotar({ tipo: "reinicio", ms: 1 }, path.join(dir, "no", "existe", "s.jsonl")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
