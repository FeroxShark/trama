// El uso de las cuentas agregadas de Claude: qué cuentas hay, dónde se guarda y con qué forma (plataforma simulada, archivos falsos).
import test from "node:test";
import assert from "node:assert/strict";
import { archivoCuentas, archivoUsoCuenta, cuentasClaude, entornoCuenta, usoParaReparto } from "../electron/uso-cuentas.ts";

const HOME = "C:\\Users\\Ana";
const json = (o: unknown) => () => JSON.stringify(o);

test("cuentas.json va en ~/.config/trama también en Windows", () => {
  assert.equal(archivoCuentas({}, HOME, "win32"), "C:\\Users\\Ana\\.config\\trama\\cuentas.json");
  assert.equal(archivoCuentas({ TRAMA_CUENTAS: "X:\\c.json" }, HOME, "win32"), "X:\\c.json");
  assert.equal(archivoCuentas({}, "/h", "linux"), "/h/.config/trama/cuentas.json");
});

test("sólo las agregadas de Claude, con su carpeta por defecto junto a cuentas.json", () => {
  const leer = json({
    version: 1,
    cuentas: [
      { id: "max-curat", proveedor: "claude", nombre: "Max Curat" },
      { id: "otra", proveedor: "claude", dir: "~\\mias\\otra" },
      { id: "g2", proveedor: "google" },
      { id: "claude", proveedor: "claude" },
      { id: "MAL ID", proveedor: "claude" },
      { id: "max-curat", proveedor: "claude" },
    ],
  });
  assert.deepEqual(cuentasClaude({}, HOME, "win32", leer), [
    { id: "max-curat", dir: "C:\\Users\\Ana\\.config\\trama\\cuentas\\max-curat" },
    { id: "otra", dir: "C:\\Users\\Ana\\mias\\otra" },
  ]);
});

test("sin cuentas.json o roto: ninguna", () => {
  assert.deepEqual(cuentasClaude({}, HOME, "win32", () => { throw new Error("ENOENT"); }), []);
  assert.deepEqual(cuentasClaude({}, HOME, "win32", () => "{no"), []);
});

test("usoParaReparto y archivoUsoCuenta tienen la forma que lee reparto", () => {
  const u = usoParaReparto({ five_hour: { pct: 12, resets_at: 100, ts: 50, oficial: true }, seven_day: null });
  assert.deepEqual(u, { version: 1, five_hour: { pct: 12, resets_at: 100, ts: 50 } });
  assert.equal(archivoUsoCuenta("C:\\p\\estado\\pa", "max-curat", "win32"), "C:\\p\\estado\\pa\\cuentas\\max-curat\\uso.json");
});

test("el claude de una cuenta lleva su CLAUDE_CONFIG_DIR y no la clave de API", () => {
  const e = entornoCuenta({ ANTHROPIC_API_KEY: "x", PATH: "p" }, "D:\\c");
  assert.equal(e.CLAUDE_CONFIG_DIR, "D:\\c");
  assert.equal(e.ANTHROPIC_API_KEY, undefined);
  assert.equal(e.PATH, "p");
});
