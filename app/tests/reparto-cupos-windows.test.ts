// Dónde lee `reparto` el cupo de Claude en Windows (plataforma simulada, rutas inventadas): el estado de `pa` y de la app viven en
// `%LOCALAPPDATA%\trama\estado\…`, no en `~/.local/state`; las carpetas se comparan sin mayúsculas ni barras.
import test from "node:test";
import assert from "node:assert/strict";
import { deLaCuenta, fuentesUso, mismaCarpeta } from "../electron/cli/reparto.ts";

const HOME = "C:\\Users\\Ana";
const ENV = { LOCALAPPDATA: "C:\\Users\\Ana\\AppData\\Local", USERPROFILE: HOME };
const PA = "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\pa";
const HILOS = "C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\hilos";

test("la cuenta de siempre lee el uso.json de la app en %LOCALAPPDATA%\\trama\\estado\\hilos", () => {
  assert.deepEqual(fuentesUso(PA, null, ENV, HOME, "win32"), [`${PA}\\uso.json`, `${HILOS}\\uso.json`]);
});

test("una cuenta agregada lee <estado de pa>\\cuentas\\<id>\\uso.json", () => {
  assert.deepEqual(fuentesUso(PA, { id: "max-curat" }, ENV, HOME, "win32"), [`${PA}\\cuentas\\max-curat\\uso.json`]);
});

test("HILOS_STATE manda sobre el estado de la plataforma", () => {
  assert.equal(fuentesUso(PA, null, { ...ENV, HILOS_STATE: "D:\\h" }, HOME, "win32")[1], "D:\\h\\uso.json");
});

test("en Linux sigue siendo ~/.local/state/hilos", () => {
  assert.deepEqual(fuentesUso("/h/.local/state/pa", null, {}, "/h", "linux"), ["/h/.local/state/pa/uso.json", "/h/.local/state/hilos/uso.json"]);
});

test("la carpeta de una cuenta agregada se reconoce aunque cambien mayúsculas, barras o la barra final", () => {
  const cuenta = { id: "max-curat", dir: "C:\\Users\\Ana\\.config\\trama\\cuentas\\max-curat" };
  assert.ok(deLaCuenta("c:/users/ana/.config/trama/cuentas/max-curat/", cuenta, "win32", HOME));
  assert.ok(!deLaCuenta("C:\\Users\\Ana\\.claude", cuenta, "win32", HOME));
  assert.ok(!deLaCuenta(null, cuenta, "win32", HOME));
});

test("la cuenta de siempre: sin config_dir, ~/.claude o %USERPROFILE%\\.claude; otra carpeta no", () => {
  assert.ok(deLaCuenta(null, null, "win32", HOME));
  assert.ok(deLaCuenta("C:\\Users\\Ana\\.claude\\", null, "win32", HOME));
  assert.ok(deLaCuenta("~/.claude", { defecto: true }, "win32", HOME));
  assert.ok(!deLaCuenta("C:\\Users\\Ana\\.config\\trama\\cuentas\\max-curat", null, "win32", HOME));
});

test("mismaCarpeta expande ~ con el home dado", () => {
  assert.ok(mismaCarpeta("~/x", "C:\\Users\\Ana\\X", "win32", HOME));
});
