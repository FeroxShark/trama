import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { aDueno, deDueno, dueno, nombreDueno } from "../electron/dueno.ts";

const GUARDAR = ["TRAMA_DUENO", "TRAMA_PERFIL", "USER"] as const;

/** Corre `f` con el entorno dado (lo que no se nombra se borra) y lo deja como estaba. */
function con<T>(env: Partial<Record<(typeof GUARDAR)[number], string>>, f: () => T): T {
  const antes = Object.fromEntries(GUARDAR.map((k) => [k, process.env[k]]));
  for (const k of GUARDAR) delete process.env[k];
  Object.assign(process.env, env);
  try {
    return f();
  } finally {
    for (const k of GUARDAR) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}

function perfil(texto: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dueno-"));
  const p = path.join(d, "perfil.json");
  fs.writeFileSync(p, texto);
  return p;
}

test("sin env ni perfil: $USER con la primera en mayúscula", () => {
  const sinPerfil = path.join(os.tmpdir(), "no-existe-perfil.json");
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: sinPerfil }, nombreDueno), "Ana");
  assert.equal(con({ USER: "gonza", TRAMA_PERFIL: sinPerfil }, dueno), "Gonza");
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: sinPerfil }, aDueno), "a Ana");
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: sinPerfil }, deDueno), "de Ana");
});

test("el perfil gana a $USER y TRAMA_DUENO gana al perfil", () => {
  const p = perfil('{"version":1,"dueno":"Beto"}');
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: p }, dueno), "Beto");
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: p, TRAMA_DUENO: "Cora" }, dueno), "Cora");
});

test("un perfil roto o de otra versión se ignora", () => {
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: perfil("{no es json") }, dueno), "Ana");
  assert.equal(con({ USER: "ana", TRAMA_PERFIL: perfil('{"version":2,"dueno":"Beto"}') }, dueno), "Ana");
});

test("el nombre no puede traer saltos de línea ni comillas de código", () => {
  assert.equal(con({ TRAMA_DUENO: "Ana\n`rm`" }, dueno), "Ana rm");
});
