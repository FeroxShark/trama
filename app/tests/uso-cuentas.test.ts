// El uso de las cuentas agregadas de Claude: qué cuentas hay, dónde se guarda y con qué forma (plataforma simulada, archivos falsos).
import test from "node:test";
import assert from "node:assert/strict";
import { archivoCuentas, archivoUsoCuenta, cuentasClaude, entornoCuenta, preferidaClaude, usoParaReparto } from "../electron/uso-cuentas.ts";

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

test("preferidaClaude: la agregada que se dejó como la que se usa primero; sin elegir o que ya no existe, la de siempre (undefined)", () => {
  const cuentas = [{ id: "trabajo", proveedor: "claude" }, { id: "g2", proveedor: "google" }];
  assert.equal(preferidaClaude({}, HOME, "win32", json({ version: 1, cuentas, preferidas: { claude: "trabajo" } })), "trabajo");
  assert.equal(preferidaClaude({}, HOME, "win32", json({ version: 1, cuentas })), undefined);
  assert.equal(preferidaClaude({}, HOME, "win32", json({ version: 1, cuentas, preferidas: { claude: "borrada" } })), undefined);
  assert.equal(preferidaClaude({}, HOME, "win32", json({ version: 1, cuentas, preferidas: { claude: "claude" } })), undefined);
  assert.equal(preferidaClaude({}, HOME, "win32", json({ version: 1, cuentas, preferidas: { google: "g2" } })), undefined);
  assert.equal(preferidaClaude({}, HOME, "win32", () => "{no"), undefined);
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

test("cuentaConConversacion: encuentra la cuenta que tiene el transcript, sin contar la actual", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { cuentaConConversacion } = await import("../electron/uso-cuentas.ts");
  const raiz = mkdtempSync(path.join(os.tmpdir(), "trama-conv-"));
  try {
    const sid = "11111111-2222-3333-4444-555555555555";
    const agregada = path.join(raiz, "cuentas", "b");
    mkdirSync(path.join(agregada, "projects", "-proy"), { recursive: true });
    mkdirSync(path.join(raiz, ".claude", "projects"), { recursive: true });
    writeFileSync(path.join(agregada, "projects", "-proy", `${sid}.jsonl`), "{}\n");
    const cuentas = [{ id: "b", dir: agregada }];
    assert.equal(cuentaConConversacion(sid, cuentas, raiz, "claude", "linux"), "b");
    assert.equal(cuentaConConversacion(sid, cuentas, raiz, "b", "linux"), null);
    writeFileSync(path.join(raiz, ".claude", "projects", `x.jsonl`), "{}\n");
    mkdirSync(path.join(raiz, ".claude", "projects", "-otro"));
    writeFileSync(path.join(raiz, ".claude", "projects", "-otro", `${sid}.jsonl`), "{}\n");
    assert.equal(cuentaConConversacion(sid, cuentas, raiz, "b", "linux"), "claude");
    assert.equal(cuentaConConversacion("no-esta", cuentas, raiz, "b", "linux"), null);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
