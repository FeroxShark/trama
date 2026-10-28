// `cuentas agregar` (electron/cli/cuentas.ts): el aviso "falta el login" va por stderr, salvo en Windows, donde PowerShell
// toma cualquier línea de stderr como un error aunque el código de salida sea 0: ahí va por stdout, antes del id.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/cuentas.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-agregar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

async function agregar(plataforma: NodeJS.Platform, nombre: string) {
  const real = process.platform;
  const env = { HOME: tmp, TRAMA_CUENTAS_HOME: tmp, TRAMA_CUENTAS: path.join(tmp, nombre, "cuentas.json"), PATH: "/usr/bin:/bin" };
  let out = "";
  let err = "";
  Object.defineProperty(process, "platform", { value: plataforma });
  try {
    const rc = await main(["agregar", "claude", "Sonda"], env, { out: (s) => (out += s), err: (s) => (err += s) });
    return { rc, out, err };
  } finally {
    Object.defineProperty(process, "platform", { value: real });
  }
}

test("agregar: en Linux el aviso va por stderr y stdout es sólo el id", async () => {
  const r = await agregar("linux", "l");
  assert.equal(r.rc, 0);
  assert.equal(r.out, "sonda\n");
  assert.match(r.err, /^cuentas: falta el login: cuentas login sonda\n$/);
});

test("agregar: en Windows el aviso va por stdout antes del id y stderr queda vacío", async () => {
  const r = await agregar("win32", "w");
  assert.equal(r.rc, 0);
  assert.equal(r.err, "");
  assert.equal(r.out, "cuentas: falta el login: cuentas login sonda\nsonda\n");
});
