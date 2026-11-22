// cli/base/archivo.ts: escritura atómica con reintento (EPERM simulado), append bajo lock, JSON tolerante, siempre "\n".
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { linkSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { agregarLinea, conLF, escribirAtomico, escribirAtomicoSync, escribirJson, leerJson, leerJsonSync } from "../electron/cli/base/archivo.ts";

const creadas: string[] = [];
const dir = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "base-archivo-"));
  creadas.push(d);
  return d;
};
after(() => {
  for (const d of creadas) rmSync(d, { recursive: true, force: true });
});
const err = (code: string) => Object.assign(new Error(code), { code });

test("escribirAtomico: crea carpetas, normaliza a \\n y no deja .tmp", async () => {
  const d = dir();
  const f = path.join(d, "a", "b", "x.txt");
  await escribirAtomico(f, "uno\r\ndos\r\n");
  assert.equal(readFileSync(f, "utf8"), "uno\ndos\n");
  await escribirAtomico(f, "tres\n");
  assert.equal(readFileSync(f, "utf8"), "tres\n");
  assert.deepEqual(readdirSync(path.dirname(f)), ["x.txt"]);
  assert.equal(conLF("a\rb").toString(), "a\nb");
  const bin = Buffer.from([13, 10, 1]);
  assert.equal(conLF(bin), bin, "los Buffer pasan sin tocar");
});

test("escribirAtomico: reintenta ante EPERM/EBUSY/EACCES y termina", async () => {
  const d = dir();
  const f = path.join(d, "x.json");
  const fallos = ["EPERM", "EBUSY", "EACCES"];
  let intentos = 0;
  await escribirAtomico(f, "ok\n", {
    renombrar: async (a, b) => {
      intentos++;
      const c = fallos.shift();
      if (c) throw err(c);
      await rename(a, b);
    },
  });
  assert.equal(intentos, 4);
  assert.equal(readFileSync(f, "utf8"), "ok\n");
});

test("escribirAtomico: si EPERM no cede en maxMs tira y limpia el .tmp; otros errores no se reintentan", async () => {
  const d = dir();
  const f = path.join(d, "x");
  let n = 0;
  await assert.rejects(escribirAtomico(f, "x", { maxMs: 120, renombrar: async () => (n++, Promise.reject(err("EPERM"))) }), { code: "EPERM" });
  assert.ok(n >= 2);
  assert.deepEqual(readdirSync(d), []);
  let m = 0;
  await assert.rejects(escribirAtomico(f, "x", { renombrar: async () => (m++, Promise.reject(err("ENOSPC"))) }), { code: "ENOSPC" });
  assert.equal(m, 1);
  let s = 0;
  escribirAtomicoSync(f, "sync\n", { renombrar: (a, b) => { if (s++ < 2) throw err("EPERM"); writeFileSync(b, readFileSync(a)); } });
  assert.equal(readFileSync(f, "utf8"), "sync\n");
});

test("agregarLinea: una línea por llamada, con un solo \\n, aunque escriban muchas a la vez", async () => {
  const d = dir();
  const f = path.join(d, "eventos.jsonl");
  await Promise.all(Array.from({ length: 40 }, (_, i) => agregarLinea(f, i % 2 ? `{"i":${i}}\r\n` : `{"i":${i}}`)));
  const t = readFileSync(f, "utf8");
  assert.ok(!t.includes("\r"));
  const ls = t.split("\n");
  assert.equal(ls.pop(), "");
  assert.equal(ls.length, 40);
  assert.deepEqual(ls.map((l) => (JSON.parse(l) as { i: number }).i).sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i));
});

test("leerJson: BOM y \\r\\n bien; falta, vacío o roto da el defecto sin tirar", async () => {
  const d = dir();
  const f = path.join(d, "j.json");
  await escribirJson(f, { a: [1, 2] });
  assert.equal(readFileSync(f, "utf8").endsWith("}\n"), true);
  assert.deepEqual(await leerJson(f), { a: [1, 2] });
  writeFileSync(f, "\uFEFF{\r\n \"b\": 1\r\n}\r\n");
  assert.deepEqual(await leerJson(f), { b: 1 });
  assert.deepEqual(leerJsonSync(f), { b: 1 });
  writeFileSync(f, "{roto");
  assert.deepEqual(await leerJson(f, { v: 0 }), { v: 0 });
  writeFileSync(f, "  \n");
  assert.equal(await leerJson(f), undefined);
  assert.deepEqual(await leerJson(path.join(d, "no"), []), []);
});

test("un archivo con enlace duro se escribe en el lugar: el otro nombre ve el cambio (CTX-57, cuentas agregadas de Windows)", async () => {
  const d = dir();
  const real = path.join(d, "settings.json");
  const cuenta = path.join(d, "cuenta-settings.json");
  writeFileSync(real, "viejo\n");
  linkSync(real, cuenta);
  escribirAtomicoSync(real, "uno\r\n");
  assert.equal(readFileSync(cuenta, "utf8"), "uno\n");
  await escribirAtomico(real, "dos\n");
  assert.equal(readFileSync(cuenta, "utf8"), "dos\n");
  assert.deepEqual(readdirSync(d).sort(), ["cuenta-settings.json", "settings.json"], "sin .tmp sobrante");
  // sin otros nombres sigue siendo el rename de siempre (un EPERM simulado se reintenta)
  const solo = path.join(d, "solo.json");
  writeFileSync(solo, "a");
  let n = 0;
  escribirAtomicoSync(solo, "b", { renombrar: (de, a) => { if (n++ === 0) throw err("EPERM"); renameSync(de, a); } });
  assert.equal(readFileSync(solo, "utf8"), "b");
  assert.equal(n, 2);
});
