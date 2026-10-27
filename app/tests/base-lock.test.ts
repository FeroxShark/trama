// cli/base/lock.ts: nombres por plataforma (inyectada), tomar/probar/esperar, canal de control y, con dos procesos reales,
// que el lock se suelta solo si el que lo tiene muere con SIGKILL.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { claveDe, consultar, nombreLock, probar, tomar } from "../electron/cli/base/lock.ts";

const unica = () => path.join(mkdtempSync(path.join(os.tmpdir(), "base-lock-")), "lock", "puesto@2");
const LOCK_URL = pathToFileURL(path.resolve("electron/cli/base/lock.ts")).href;

test("nombres: abstracto en Linux, named pipe con usuario en Windows; la misma ruta da el mismo nombre", () => {
  const l = nombreLock("/home/ana/.local/state/pa/lock/proy", { plat: "linux" });
  assert.match(l, /^\0trama-[0-9a-f]{40}$/);
  assert.equal(l, nombreLock("/home/ana/.local/state/pa/lock/proy/", { plat: "linux" }));
  assert.notEqual(l, nombreLock("/home/ana/.local/state/pa/lock/otro", { plat: "linux" }));
  const w = nombreLock("C:\\Users\\Ana\\AppData\\Local\\trama\\estado\\pa\\lock\\proy", { plat: "win32", env: { USERNAME: "Ana Pérez" } });
  assert.match(w, /^\\\\\.\\pipe\\trama-ana-p-rez-[0-9a-f]{40}$/);
  // NTFS no distingue mayúsculas ni / de \
  assert.equal(w, nombreLock("c:/users/ana/appdata/local/trama/estado/pa/lock/PROY", { plat: "win32", env: { USERNAME: "Ana Pérez" } }));
  assert.equal(claveDe("C:/A/b", "win32"), "c:\\a\\b");
});

test("tomar es exclusivo: el segundo recibe null, probar lo ve tomado, liberar lo suelta", async () => {
  const r = unica();
  assert.equal(await probar(r), false);
  const a = await tomar(r);
  assert.ok(a);
  assert.equal(await probar(r), true);
  assert.equal(await tomar(r), null);
  // dos sondeos a la vez no se estorban (el `flock -n -s` de puesto_libre) ni al que tiene el lock
  assert.deepEqual(await Promise.all([probar(r), probar(r), probar(r)]), [true, true, true]);
  assert.ok(await probar(r));
  await a.liberar();
  await a.liberar(); // idempotente
  assert.equal(await probar(r), false);
  const b = await tomar(r);
  assert.ok(b);
  await b.liberar();
});

test("tomar con esperarMs: espera a que lo suelten, y se rinde si no", async () => {
  const r = unica();
  const a = (await tomar(r))!;
  const t0 = Date.now();
  assert.equal(await tomar(r, { esperarMs: 300 }), null);
  assert.ok(Date.now() - t0 >= 280);
  setTimeout(() => void a.liberar(), 200);
  const b = await tomar(r, { esperarMs: 3000 });
  assert.ok(b);
  await b.liberar();
});

test("canal de control: el que tiene el lock contesta mensajes JSON; probar no dispara el manejador", async () => {
  const r = unica();
  const vistos: unknown[] = [];
  const a = (await tomar(r, { alMensaje: (m) => (vistos.push(m), m.cmd === "parar" ? { ok: true, rc: 130 } : { ok: false }) }))!;
  await probar(r);
  assert.deepEqual(vistos, []);
  assert.deepEqual(await consultar(r, { cmd: "parar" }), { ok: true, rc: 130 });
  assert.deepEqual(await consultar(r, { cmd: "otra" }), { ok: false });
  assert.deepEqual(vistos, [{ cmd: "parar" }, { cmd: "otra" }]);
  await a.liberar();
  assert.equal(await consultar(r, { cmd: "parar" }), null); // nadie lo tiene
});

test("dos procesos: uno lo tiene, el otro falla; muere por SIGKILL y se libera solo", async () => {
  const r = unica();
  const codigo = (accion: string) => `
    import { tomar } from ${JSON.stringify(LOCK_URL)};
    const l = await tomar(${JSON.stringify(r)}, ${accion});
    if (!l) { console.log("OCUPADO"); process.exit(3); }
    console.log("TENGO");
    ${accion.includes("esperarMs") ? "console.log('SALGO'); process.exit(0);" : "setInterval(() => {}, 1000);"}
  `;
  const lanzar = (c: string) => spawn(process.execPath, ["--input-type=module", "-e", c], { stdio: ["ignore", "pipe", "inherit"] });
  const esperarLinea = (h: ReturnType<typeof lanzar>, txt: string) =>
    new Promise<void>((ok, mal) => {
      let b = "";
      h.stdout!.on("data", (d) => ((b += d), b.includes(txt) && ok()));
      h.once("exit", () => (b.includes(txt) ? ok() : mal(new Error(`salió sin ${txt}: ${b}`))));
    });
  const salida = (h: ReturnType<typeof lanzar>) => new Promise<number | null>((ok) => h.once("exit", (c) => ok(c)));

  const dueno = lanzar(codigo("{}"));
  await esperarLinea(dueno, "TENGO");
  assert.equal(await probar(r), true);

  const intruso = lanzar(codigo("{}"));
  assert.equal(await salida(intruso), 3, "el segundo no puede tomarlo");

  // el tercero espera hasta 10 s: tiene que entrar apenas el dueño muera
  const espera = lanzar(codigo("{ esperarMs: 10000 }"));
  await new Promise((r2) => setTimeout(r2, 300));
  dueno.kill("SIGKILL");
  await salida(dueno);
  await esperarLinea(espera, "SALGO");
  assert.equal(await salida(espera), 0);
  assert.equal(await probar(r), false, "al morir el que lo tenía, el kernel lo soltó");
  const yo = await tomar(r);
  assert.ok(yo);
  await yo.liberar();
});
