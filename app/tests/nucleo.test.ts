// electron/nucleo.ts: el núcleo sin Electron (los canales, lo que se difunde a quienes escuchan y los
// ganchos de salida). Importa a sus vecinos con `.js` (lo compila tsc): un hook de resolución los lleva
// al `.ts`. El entorno va antes del import: todo el estado en un tmp y los fakes de `pa` y `claude`.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-nucleo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = path.join(tmp, "pa");
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";
process.env.HILOS_CLAUDE_SETTINGS = path.join(tmp, "claude-settings.json");

const nucleo = await import("../electron/nucleo.ts");

test("no importa Electron", () => {
  const fuente = readFileSync(path.join(import.meta.dirname, "..", "electron", "nucleo.ts"), "utf8");
  assert.doesNotMatch(fuente, /electron/);
});

test("armado: los canales del núcleo, sin los de la pantalla de la PC", () => {
  nucleo.armarNucleo();
  const canales = new Set(nucleo.manejadoresAnotados().map(([c]) => c));
  for (const c of ["statusline:leer", "hilos:leer", "lider:mandar", "lider:encolar", "tablero:leer", "proyectos:iconos", "borradores:guardar", "consumo:mirar", "reinicio:pedir"])
    assert.ok(canales.has(c), c);
  for (const c of ["app:salir", "app:recargar", "volver:leer", "volver:guardar", "volver:anotar", "lider:ir", "lider:ubicable", "claude:changelog"]) assert.ok(!canales.has(c), c);
});

test("manejadores: por red llega con quién pide; lo de la ventana y lo desconocido, no", async () => {
  nucleo.manejar("prueba:eco", (e, a: unknown, b: unknown) => ({ quien: nucleo.quien(e), a, b }));
  assert.deepEqual(await nucleo.llamarRemoto("prueba:eco", [1, "dos"], "cel"), { quien: "cel", a: 1, b: "dos" });
  // La ventana llama con el evento del IPC (cualquier objeto): es "ventana".
  const fn = new Map(nucleo.manejadoresAnotados()).get("prueba:eco")!;
  assert.deepEqual(fn({ sender: {} }, 3), { quien: "ventana", a: 3, b: undefined });
  await assert.rejects(nucleo.llamarRemoto("borradores:leer", [], "cel"), /canal desconocido/);
  await assert.rejects(nucleo.llamarRemoto("no:existe", [], "cel"), /canal desconocido/);
  // Reemplazar un canal (ipc.ts pone el de los íconos achicados) deja uno solo.
  nucleo.manejar("prueba:eco", () => "otro");
  assert.equal(nucleo.manejadoresAnotados().filter(([c]) => c === "prueba:eco").length, 1);
  assert.equal(await nucleo.llamarRemoto("prueba:eco", [], "cel"), "otro");
});

test("difundir: a cada oyente en orden; uno que falla no corta a los demás; quitar", () => {
  const vistos: string[] = [];
  const quitarA = nucleo.escuchar((c, d) => vistos.push(`a ${c} ${d}`));
  const quitarMalo = nucleo.escuchar(() => {
    throw new Error("se cayó");
  });
  const quitarB = nucleo.escuchar((c, d) => vistos.push(`b ${c} ${d}`));
  nucleo.difundir("x:cambio", 1);
  assert.deepEqual(vistos, ["a x:cambio 1", "b x:cambio 1"]);
  quitarA();
  quitarMalo();
  nucleo.difundir("x:cambio", 2);
  assert.deepEqual(vistos.slice(2), ["b x:cambio 2"]);
  quitarB();
  nucleo.difundir("x:cambio", 3);
  assert.equal(vistos.length, 3);
});

test("ganchos de salida: en el orden en que se anotaron, aunque uno falle", () => {
  const orden: number[] = [];
  nucleo.alSalir(() => orden.push(1));
  nucleo.alSalir(() => {
    throw new Error("no pude");
  });
  nucleo.alSalir(() => orden.push(3));
  nucleo.correrSalida();
  assert.deepEqual(orden, [1, 3]);
});

test("salir sin líderes: no hay a quién esperar; avisa antes de irse", async () => {
  assert.equal(nucleo.esperarSalida(), null);
  let ido = false;
  assert.equal(await nucleo.salir(false, () => (ido = true)), 0);
  assert.ok(ido);
  // Ya saliendo, el `before-quit` que sigue no espera a nadie.
  assert.equal(nucleo.esperarSalida(), null);
});

test("ajustes y acceso del celular: se guardan desde la PC; por la tailnet el celular no cambia quién entra", async () => {
  nucleo.armarNucleo();
  const fn = (c: string) => new Map(nucleo.manejadoresAnotados()).get(c)!;
  const ventana = { sender: {} };
  // Ajustes: el plan va a `pa --plan` (el falso) y la red al settings de prueba.
  const a = (await fn("ajustes:guardar")(ventana, { plan: "pro", red_seguridad: 250_000 })) as { plan: string; red_seguridad: number };
  assert.equal(a.plan, "pro");
  assert.equal(a.red_seguridad, 250_000);
  assert.equal(JSON.parse(readFileSync(process.env.HILOS_CLAUDE_SETTINGS!, "utf8")).autoCompactWindow, 250_000);
  await assert.rejects(nucleo.llamarRemoto("ajustes:guardar", [{ plan: "oro" }], "cel"), /main\.ajustesPlan/);
  // El acceso: de la PC se lee y se guarda (y queda en remoto.json).
  const antes = (await fn("remoto:leer")(ventana)) as { editable: boolean; activo: boolean; puerto: number };
  assert.deepEqual([antes.editable, antes.activo, antes.puerto], [true, false, 8791]);
  const g = (await fn("remoto:guardar")(ventana, { activo: true, puerto: 8791, dispositivos: ["celu"] })) as { dispositivos: string[]; escuchando: string[] };
  assert.deepEqual(g.dispositivos, ["celu"]);
  assert.deepEqual(g.escuchando, [], "sin el armado de la tailnet no hay nada escuchando");
  const archivo = path.join(process.env.HILOS_STATE!, "remoto.json");
  assert.deepEqual(JSON.parse(readFileSync(archivo, "utf8")), { version: 1, puerto: 8791, dispositivos: ["celu"] });
  // Por la tailnet: se ve que no es editable y no se cambia nada (ni agregar un dispositivo, ni 0.0.0.0).
  assert.deepEqual(await nucleo.llamarRemoto("remoto:leer", [], "celu"), { version: 1, editable: false });
  const contenido = readFileSync(archivo, "utf8");
  await assert.rejects(nucleo.llamarRemoto("remoto:guardar", [{ activo: true, puerto: 8791, dispositivos: ["celu", "otro"] }], "celu"), /main\.remotoSoloPc/);
  assert.equal(readFileSync(archivo, "utf8"), contenido);
  // Y de la PC tampoco se acepta 0.0.0.0 ni un `host`.
  await assert.rejects(fn("remoto:guardar")(ventana, { activo: true, puerto: 8791, dispositivos: ["0.0.0.0"] }));
  await assert.rejects(fn("remoto:guardar")(ventana, { activo: true, puerto: 8791, dispositivos: ["celu"], host: "0.0.0.0" }));
  assert.equal(readFileSync(archivo, "utf8"), contenido);
});

// Trama en dos máquinas (docs/estado/maquinas.md): cada canal sabe si se junta, va a la máquina de la fila o es local.
test("rutas: la tabla cubre todos los canales (núcleo, ventana, preload) y nada más", async () => {
  // armarNucleo ya corrió en "armado".
  const raiz = path.join(import.meta.dirname, "..");
  const nucleoCanales = (await nucleo.llamarLocal(nucleo.CANALES, [], "prueba")) as string[];
  const fuente = (f: string) => readFileSync(path.join(raiz, "electron", f), "utf8");
  const deIpc = ["ventana-canales.ts", "ventana-cliente.ts", "bench.ts"].flatMap((f) => [...fuente(f).matchAll(/ipcMain\.handle\("([^"]+)"/g)].map((m) => m[1]));
  const dePreload = [...fuente("preload.cts").matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map((m) => m[1]);
  const todos = new Set([...nucleoCanales, ...nucleo.SOLO_VENTANA, ...deIpc, ...dePreload].filter((c) => !c.startsWith("prueba:")));
  for (const c of todos) assert.ok(c in nucleo.RUTAS, `falta en RUTAS: ${c}`);
  for (const c of Object.keys(nucleo.RUTAS)) assert.ok(todos.has(c), `sobra en RUTAS: ${c}`);
  for (const r of Object.values(nucleo.RUTAS)) assert.match(r, /^(juntar|maquina|local)$/);
  // Lo que es de la pantalla de la PC nunca va a otra máquina.
  for (const c of nucleo.SOLO_VENTANA) assert.ok(c.startsWith("consumo:") || c.startsWith("borradores:") || nucleo.RUTAS[c] === "local", c);
});

test("eventos: la tabla cubre todo lo que se difunde", () => {
  const raiz = path.join(import.meta.dirname, "..", "electron");
  const nombres = new Set<string>();
  for (const f of readdirSync(raiz).filter((f) => f.endsWith(".ts")))
    for (const m of readFileSync(path.join(raiz, f), "utf8").matchAll(/\b(?:enviar|difundir)\("([a-z]+:[a-zA-Z]+)"/g)) nombres.add(m[1]);
  assert.ok(nombres.has("hilos:cambio"));
  for (const c of nombres) assert.ok(c in nucleo.EVENTOS, `falta en EVENTOS: ${c}`);
  for (const c of Object.keys(nucleo.EVENTOS)) assert.ok(nombres.has(c), `sobra en EVENTOS: ${c}`);
});

test("saludo: versión, protocolo y huella; sin maquinas.json esta máquina es «pc»", async () => {
  const fn = new Map(nucleo.manejadoresAnotados()).get("maquina:saludo")!;
  const s = (await fn({})) as ReturnType<typeof nucleo.saludo>;
  assert.equal(s.version, 1);
  assert.equal(s.protocolo, nucleo.PROTOCOLO);
  assert.match(s.huella, /^[0-9a-f]{12}$/);
  assert.equal(s.maquina, "pc");
  // Por red también se puede preguntar (la PC le pregunta al Dell por /rpc).
  assert.deepEqual(await nucleo.llamarRemoto("maquina:saludo", [], "pc"), s);
  assert.equal(nucleo.compatible(s), "si");
  assert.equal(nucleo.compatible({ ...s, protocolo: s.protocolo + 1 }), "leer");
  assert.equal(nucleo.compatible({ ...s, huella: "000000000000" }), "leer");
  assert.equal(nucleo.compatible({ ...s, version: 2 }), "no");
  assert.equal(nucleo.compatible(null), "no");
  assert.equal(nucleo.compatible("hola"), "no");
  // Con maquinas.json, el nombre que eligió Ana para esta.
  mkdirSync(path.dirname(nucleo.ARCHIVO_MAQUINAS), { recursive: true });
  writeFileSync(nucleo.ARCHIVO_MAQUINAS, JSON.stringify({ version: 1, esta: "dell", maquinas: [] }));
  try {
    assert.equal(nucleo.saludo().maquina, "dell");
  } finally {
    rmSync(nucleo.ARCHIVO_MAQUINAS);
  }
});

test("dictado:transcribir: por el RPC (con los bytes en base64 de la tailnet) pasa por el handy falso y no deja el archivo", async () => {
  const handy = path.join(import.meta.dirname, "..", "scripts", "handy-falso.sh");
  const { codificarWav } = await import("../src/hilo/dictado.ts");
  const wav = codificarWav(new Float32Array(800).fill(0.1));
  const antes = process.env.HILOS_HANDY;
  const local = process.env.HILOS_LOCAL;
  process.env.HILOS_HANDY = handy;
  process.env.HILOS_LOCAL = path.join(tmp, "local");
  try {
    assert.equal(await nucleo.llamarRemoto("dictado:transcribir", [{ datos: Buffer.from(wav) }], "cel"), `dictado de prueba de ${wav.length} bytes`);
    assert.deepEqual(readdirSync(process.env.HILOS_LOCAL), []);
    process.env.HANDY_FALSO_FALLA = "1";
    await assert.rejects(nucleo.llamarRemoto("dictado:transcribir", [{ datos: Buffer.from(wav) }], "cel"), /main\.dictadoFalla.*modelo no cargado/);
    assert.deepEqual(readdirSync(process.env.HILOS_LOCAL), []);
    await assert.rejects(nucleo.llamarRemoto("dictado:transcribir", [{ datos: "no son bytes" }], "cel"), /main\.dictadoRaro/);
  } finally {
    delete process.env.HANDY_FALSO_FALLA;
    if (antes === undefined) delete process.env.HILOS_HANDY;
    else process.env.HILOS_HANDY = antes;
    if (local === undefined) delete process.env.HILOS_LOCAL;
    else process.env.HILOS_LOCAL = local;
  }
});
