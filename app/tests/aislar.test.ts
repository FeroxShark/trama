// El aislamiento de las corridas de prueba (electron/aislar.ts): qué cuenta como dato de Ana.
import assert from "node:assert/strict";
import test from "node:test";

const { crearAislamiento, codigoSalida } = await import("../electron/aislar.ts");

const armar = () => {
  const anotadas: string[] = [];
  const a = crearAislamiento({ home: ["/home/ana"], permitidas: ["/home/ana/proy/hilos"], temporales: ["/tmp"], anotar: (l: string) => anotadas.push(l) });
  return { a, anotadas };
};

test("lo de Ana: bajo el home y fuera del checkout", () => {
  const { a } = armar();
  assert.equal(a.ajeno("/home/ana/.claude/projects/x.jsonl"), true);
  assert.equal(a.ajeno("/home/ana/.local/state/hilos/nombres.json"), true);
  assert.equal(a.ajeno("/home/ana/CLAUDE.md"), true);
  assert.equal(a.ajeno("/home/ana/.claude/../.config/proyectos/registry.json"), true);
});

test("no es de Ana: el checkout, /tmp, el home mismo y lo de otro lado", () => {
  const { a } = armar();
  assert.equal(a.ajeno("/home/ana/proy/hilos/dist/index.html"), false);
  assert.equal(a.ajeno("/home/ana/proy/hilos"), false);
  assert.equal(a.ajeno("/tmp/trama-captura-1/estado"), false);
  assert.equal(a.ajeno("/home/ana"), false);
  assert.equal(a.ajeno("/home/ana.bak/x"), false);
  assert.equal(a.ajeno("/usr/lib/x"), false);
});

test("un binario: el nombre suelto cuenta, /tmp y el checkout no", () => {
  const { a } = armar();
  assert.equal(a.binarioAjeno("claude"), true);
  assert.equal(a.binarioAjeno("/home/ana/.local/bin/pa"), true);
  assert.equal(a.binarioAjeno("/tmp/falso/pa"), false);
  assert.equal(a.binarioAjeno("/home/ana/proy/hilos/scripts/pa-falso.sh"), false);
  assert.equal(a.binarioAjeno("/usr/bin/env"), false);
});

test("un nombre suelto cuenta sólo si el PATH tiene carpetas del home", () => {
  const limpio = crearAislamiento({ home: ["/home/ana"], permitidas: [], temporales: ["/tmp"], camino: () => "/usr/bin:/bin", anotar: () => {} });
  assert.equal(limpio.binarioAjeno("git"), false);
  const sucio = crearAislamiento({ home: ["/home/ana"], permitidas: [], temporales: ["/tmp"], camino: () => "/usr/bin:/home/ana/.local/bin", anotar: () => {} });
  assert.equal(sucio.binarioAjeno("git"), true);
});

test("sin violaciones el código de salida no cambia", () => {
  assert.equal(codigoSalida(0), 0);
  assert.equal(codigoSalida(3), 3);
});
