// Actualizar seguro en Linux (electron/version-anterior.ts): guardar la versión que corre, volver a ella sola o con el botón,
// con carpetas temporales de verdad (una "app" y un "AppImage" de mentira) y un reinicio falso. Nunca toca la instalación real.
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { crearAlmacen } from "../electron/arranque-seguro.ts";
import { carpetaCopias, copiaExiste, crearVersionAnterior, guardarCopia, instalacionDe, podar, restaurar, type Instalacion } from "../electron/version-anterior.ts";

const nuevaCasa = () => mkdtempSync(path.join(os.tmpdir(), "trama-va-"));
/** Una app instalada en `<casa>/.local/share/trama/app` con la versión `v` escrita en cada parte. */
function appEn(casa: string, v: string) {
  const app = path.join(casa, ".local", "share", "trama", "app");
  mkdirSync(path.join(app, "dist"), { recursive: true });
  mkdirSync(path.join(app, "dist-electron"), { recursive: true });
  writeFileSync(path.join(app, "dist", "index.html"), `web ${v}`);
  writeFileSync(path.join(app, "dist-electron", "main.js"), `main ${v}`);
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: v }));
  writeFileSync(path.join(app, ".build-huella"), `huella ${v}`);
  return app;
}
const leer = (...p: string[]) => readFileSync(path.join(...p), "utf8");

test("instalacionDe: AppImage por $APPIMAGE, carpeta sólo si es la estable, el resto no es una instalación", () => {
  const casa = nuevaCasa();
  const app = appEn(casa, "0.2.25");
  assert.deepEqual(instalacionDe({}, app, casa), { tipo: "carpeta", app });
  assert.equal(instalacionDe({}, path.join(casa, "Proyectos", "trama", "app"), casa), null);
  const ai = path.join(casa, "Trama.AppImage");
  writeFileSync(ai, "x");
  assert.deepEqual(instalacionDe({ APPIMAGE: ai }, "/otra", casa), { tipo: "appimage", ruta: ai });
  assert.equal(instalacionDe({ APPIMAGE: path.join(casa, "no-existe.AppImage") }, "/otra", casa), null);
  assert.equal(instalacionDe({ APPIMAGE: "relativo.AppImage" }, "/otra", casa), null);
});

test("guardarCopia y restaurar de una carpeta: guarda lo que cambia, vuelve y borra la huella del build", async () => {
  const casa = nuevaCasa();
  const app = appEn(casa, "0.2.25");
  const inst: Instalacion = { tipo: "carpeta", app };
  const c = await guardarCopia(inst, "0.2.25", carpetaCopias(casa), 7);
  assert.equal(c.tipo, "carpeta");
  assert.ok(await copiaExiste(c));
  assert.equal(existsSync(path.join(c.ruta, "node_modules")), false);
  // La app pasa a la 0.2.26 (lo que hace el instalador) y se vuelve.
  writeFileSync(path.join(app, "dist-electron", "main.js"), "main 0.2.26");
  writeFileSync(path.join(app, "dist-electron", "solo-nuevo.js"), "x");
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.2.26" }));
  await restaurar(inst, c);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.25");
  assert.equal(existsSync(path.join(app, "dist-electron", "solo-nuevo.js")), false, "no queda nada de la versión mala");
  assert.equal(JSON.parse(leer(app, "package.json")).version, "0.2.25");
  assert.equal(existsSync(path.join(app, ".build-huella")), false);
  assert.equal(existsSync(path.join(app, "dist.malo")), false);
});

test("restaurar sin copia entera falla sin tocar lo instalado", async () => {
  const casa = nuevaCasa();
  const app = appEn(casa, "0.2.26");
  const falsa = { version: "0.2.25", tipo: "carpeta" as const, ruta: path.join(casa, "no-hay"), cuando: 1 };
  await assert.rejects(restaurar({ tipo: "carpeta", app }, falsa), /ya no está/);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.26");
});

test("restaurar a la mitad deja lo instalado como estaba", async () => {
  const casa = nuevaCasa();
  const app = appEn(casa, "0.2.26");
  const inst: Instalacion = { tipo: "carpeta", app };
  const c = await guardarCopia({ tipo: "carpeta", app: appEn(nuevaCasa(), "0.2.25") }, "0.2.25", carpetaCopias(casa), 1);
  // A la copia le falta una parte (dist/): copiaExiste sigue dando que sí (mira main.js y package.json), cp de dist falla.
  const { rmSync } = await import("node:fs");
  rmSync(path.join(c.ruta, "dist"), { recursive: true });
  await assert.rejects(restaurar(inst, c));
  assert.equal(leer(app, "dist", "index.html"), "web 0.2.26");
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.26");
  assert.equal(existsSync(path.join(app, "dist.malo")), false);
});

test("guardarCopia y restaurar de un AppImage: pisa el archivo y lo deja ejecutable", async () => {
  const casa = nuevaCasa();
  const ai = path.join(casa, "Trama.AppImage");
  writeFileSync(ai, "imagen 0.2.25");
  const inst: Instalacion = { tipo: "appimage", ruta: ai };
  const c = await guardarCopia(inst, "0.2.25", carpetaCopias(casa), 1);
  assert.match(path.basename(c.ruta), /^Trama-0\.2\.25\.AppImage$/);
  writeFileSync(ai, "imagen 0.2.26");
  await restaurar(inst, c);
  assert.equal(readFileSync(ai, "utf8"), "imagen 0.2.25");
  assert.ok(statSync(ai).mode & 0o100, "ejecutable");
  await assert.rejects(guardarCopia(inst, "../0.2", carpetaCopias(casa), 1), /inválida/);
});

test("podar deja sólo las copias vivas", async () => {
  const casa = nuevaCasa();
  const base = carpetaCopias(casa);
  const a = await guardarCopia({ tipo: "carpeta", app: appEn(casa, "0.2.24") }, "0.2.24", base, 1);
  const b = await guardarCopia({ tipo: "carpeta", app: appEn(casa, "0.2.25") }, "0.2.25", base, 2);
  await podar(base, [b, null]);
  assert.equal(existsSync(a.ruta), false);
  assert.equal(existsSync(b.ruta), true);
});

/** Un servicio armado sobre una app 0.2.25 que se actualiza a 0.2.26; `reinicios` cuenta los reinicios que pidió. */
async function escenario(topeMs = 1000) {
  const casa = nuevaCasa();
  const app = appEn(casa, "0.2.25");
  const inst: Instalacion = { tipo: "carpeta", app };
  const almacen = crearAlmacen(path.join(casa, "estado", "arranque.json"));
  const reinicios: string[] = [];
  const pendientes: (() => void)[] = [];
  const armar = (version: string) =>
    crearVersionAnterior({
      almacen,
      version,
      inst,
      base: carpetaCopias(casa),
      reiniciar: () => void reinicios.push(version),
      despues: (f) => (pendientes.push(f), { cancelar: () => void pendientes.splice(pendientes.indexOf(f), 1) }),
      topeMs,
    });
  // La 0.2.25 arranca, anda, y antes de instalar la 0.2.26 se guarda.
  const v1 = armar("0.2.25");
  assert.equal(await v1.alArrancar(), false);
  await v1.alVentanaLista();
  await v1.guardarAntes();
  // El instalador deja la 0.2.26.
  writeFileSync(path.join(app, "dist-electron", "main.js"), "main 0.2.26");
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.2.26" }));
  return { casa, app, almacen, reinicios, pendientes, armar };
}

test("la nueva no llega a ventana lista a tiempo: vuelve sola, reinicia y deja el aviso", async () => {
  const { app, almacen, reinicios, pendientes, armar } = await escenario();
  const v2 = armar("0.2.26");
  assert.equal(await v2.alArrancar(), false);
  assert.equal(await v2.disponible(), "0.2.25");
  assert.equal(pendientes.length, 1, "arma el tope de arranque");
  pendientes[0]();
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(reinicios, ["0.2.26"]);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.25");
  assert.equal(almacen.leer().actual, "0.2.25");
  const nueva = armar("0.2.25");
  assert.equal(await nueva.alArrancar(), false, "la que volvió arranca normal");
  assert.deepEqual(nueva.leerAviso(), { de: "0.2.26", a: "0.2.25", motivo: "lento" });
  assert.equal(nueva.leerAviso(), null, "el aviso se gasta al leerlo");
  assert.equal(nueva.rechazada(), "0.2.26");
});

test("la nueva llega a ventana lista: el tope se cancela y no vuelve", async () => {
  const { app, reinicios, pendientes, armar } = await escenario();
  const v2 = armar("0.2.26");
  await v2.alArrancar();
  await v2.alVentanaLista();
  assert.equal(pendientes.length, 0);
  assert.deepEqual(reinicios, []);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.26");
});

test("la nueva se cierra sola dos veces: al tercer arranque vuelve antes de abrir nada", async () => {
  const { app, reinicios, armar } = await escenario();
  assert.equal(await armar("0.2.26").alArrancar(), false); // se cae
  assert.equal(await armar("0.2.26").alArrancar(), false); // se cae otra vez
  assert.equal(await armar("0.2.26").alArrancar(), true); // la tercera ya no abre: vuelve
  assert.deepEqual(reinicios, ["0.2.26"]);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.25");
});

test("el botón vuelve a la anterior aunque la nueva ande; sin anterior dice que no hay", async () => {
  const { app, reinicios, armar } = await escenario();
  const v2 = armar("0.2.26");
  await v2.alArrancar();
  await v2.alVentanaLista();
  assert.equal(await v2.disponible(), "0.2.25");
  assert.deepEqual(await v2.volverManual(), { ok: true });
  assert.deepEqual(reinicios, ["0.2.26"]);
  assert.equal(leer(app, "dist-electron", "main.js"), "main 0.2.25");
  const v1 = armar("0.2.25");
  await v1.alArrancar();
  assert.equal(await v1.disponible(), null);
  assert.deepEqual(await v1.volverManual(), { ok: false, error: "no hay una versión anterior guardada" });
  assert.equal(v1.leerAviso()?.motivo, "manual");
});

test("una copia anterior que se borró del disco no se ofrece", async () => {
  const { casa, armar } = await escenario();
  const v2 = armar("0.2.26");
  await v2.alArrancar();
  const { rmSync } = await import("node:fs");
  rmSync(carpetaCopias(casa), { recursive: true });
  assert.equal(await v2.disponible(), null);
  assert.equal((await v2.volverManual()).ok, false);
});

test("sin instalación (desarrollo, pruebas) no hace nada: ni cuenta, ni vuelve, ni ofrece", async () => {
  const casa = nuevaCasa();
  const almacen = crearAlmacen(path.join(casa, "arranque.json"));
  const v = crearVersionAnterior({ almacen, version: "0.2.26", inst: null, base: carpetaCopias(casa), reiniciar: () => assert.fail("no reinicia") });
  assert.equal(await v.alArrancar(), false);
  await v.alVentanaLista();
  await v.guardarAntes();
  assert.equal(await v.disponible(), null);
  assert.equal((await v.volverManual()).ok, false);
  assert.equal(existsSync(path.join(casa, "arranque.json")), false);
});

test("un AppImage reemplazado por uno más nuevo mientras corría no se copia como si fuera éste", async () => {
  const casa = nuevaCasa();
  const ai = path.join(casa, "Trama.AppImage");
  writeFileSync(ai, "imagen");
  chmodSync(ai, 0o755);
  const almacen = crearAlmacen(path.join(casa, "arranque.json"));
  const v = crearVersionAnterior({ almacen, version: "0.2.25", inst: { tipo: "appimage", ruta: ai }, base: carpetaCopias(casa), reiniciar: () => {}, inicio: Date.now() - 60_000 });
  await v.alArrancar();
  await v.alVentanaLista();
  assert.equal(almacen.leer().respaldo, null, "el archivo es más nuevo que el proceso: no se copia");
  const w = crearVersionAnterior({ almacen, version: "0.2.25", inst: { tipo: "appimage", ruta: ai }, base: carpetaCopias(casa), reiniciar: () => {}, inicio: Date.now() + 60_000 });
  await w.alVentanaLista();
  assert.equal(almacen.leer().respaldo?.version, "0.2.25");
});
