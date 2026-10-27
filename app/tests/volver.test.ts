// Volver como estaba tras el reinicio que pide Ana (electron/volver.ts): el archivo que se deja al salir
// y se gasta al arrancar, y los `dispatch` de Hyprland que devuelven la ventana a su escritorio, con un
// `hyprctl` de mentira (nunca el de verdad: movería ventanas de Ana).
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import { acomodar, crearGuardadoVolver, guardarVolver, leerVolver, lugarDeVentana, pasos, type Lugar } from "../electron/volver.ts";

const tmp = mkdtempSync(path.join(tmpdir(), "trama-volver-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const lugar = (x: Partial<Lugar> = {}): Lugar => ({ direccion: "0xabc", escritorio: 3, flota: false, en: [10, 20], mide: [900, 640], ...x });

test("lo que se guarda vuelve igual, en cada arranque (no se gasta al leerlo)", () => {
  const f = path.join(tmp, "a", "volver.json");
  const ventana = { ancho: 1000, alto: 700, visible: true, foco: true, lugar: lugar() };
  const vistas = { ventana: { activa: "lider:s1", panel: null, scrolls: { "lider:s1": 340 } } };
  guardarVolver(f, { ventana, vistas });
  for (const vuelta of [1, 2, 3]) {
    const v = leerVolver(f);
    assert.deepEqual({ ventana: v?.ventana, vistas: v?.vistas }, { ventana, vistas }, `lectura ${vuelta}`);
    assert.equal(existsSync(f), true, "leerlo no lo borra");
  }
});

test("sin límite de edad: uno de hace un mes también vuelve", () => {
  const f = path.join(tmp, "viejo.json");
  const hace_un_mes = Date.now() - 30 * 24 * 3600_000;
  guardarVolver(f, { ventana: { ancho: 800, alto: 600, visible: false, foco: false, lugar: null }, vistas: { ventana: { activa: "x" } } }, hace_un_mes);
  const v = leerVolver(f);
  assert.equal(v?.cuando, hace_un_mes);
  assert.deepEqual(v?.vistas, { ventana: { activa: "x" } });
  assert.equal(v?.ventana?.ancho, 800);
});

test("uno roto, de otra versión o sin ventana válida no se aplica", () => {
  const f = path.join(tmp, "b.json");
  assert.equal(leerVolver(f), null, "ausente");
  writeFileSync(f, "{no es json");
  assert.equal(leerVolver(f), null);
  writeFileSync(f, JSON.stringify({ version: 2, cuando: Date.now(), ventana: null, vistas: {} }));
  assert.equal(leerVolver(f), null);
  writeFileSync(f, JSON.stringify({ version: 1, cuando: Date.now(), ventana: { ancho: 5, alto: "x" }, vistas: [] }));
  const v = leerVolver(f);
  assert.equal(v?.ventana, null, "un tamaño imposible no se usa");
  assert.deepEqual(v?.vistas, {});
  writeFileSync(f, JSON.stringify({ version: 1, cuando: Date.now(), ventana: { ancho: 800, alto: 600, lugar: { direccion: 3 } }, vistas: {} }));
  assert.deepEqual(leerVolver(f)?.ventana, { ancho: 800, alto: 600, visible: false, foco: false, lugar: null });
});

test("el guardado: varios avisos seguidos hacen una sola escritura, y 'ahora' escribe ya", async () => {
  const f = path.join(tmp, "g", "volver.json");
  const v = { ancho: 900, alto: 600, visible: true, foco: false, lugar: null };
  const g = crearGuardadoVolver({ archivo: f, ventana: () => v, demoraMs: 30 });
  g.vista({ activa: "a" });
  g.vista({ activa: "b" });
  g.tocar();
  assert.equal(existsSync(f), false, "no escribe antes de la demora");
  await new Promise((r) => setTimeout(r, 90));
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "b" } }, "lo último");
  assert.equal(leerVolver(f)?.ventana?.ancho, 900);
  g.vista({ activa: "c" });
  g.ahora();
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "c" } }, "ahora no espera");
  g.congelar();
  g.vista({ activa: "d" });
  g.ahora();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "c" } }, "congelado no pisa lo escrito");
});

test("el guardado arranca con la vista de la vez anterior si la ventana todavía no dijo nada", () => {
  const f = path.join(tmp, "h", "volver.json");
  const g = crearGuardadoVolver({ archivo: f, ventana: () => null, vistaInicial: { activa: "antes" }, demoraMs: 10 });
  g.ahora();
  assert.deepEqual(leerVolver(f)?.vistas, { ventana: { activa: "antes" } }, "cerrar sin abrir nada no pierde lo de antes");
  assert.equal(leerVolver(f)?.ventana, null);
});

test("pasos: al escritorio de antes sin llevarse el foco, siempre nombrando la ventana", () => {
  assert.deepEqual(pasos(lugar(), lugar({ direccion: "0xdef" })), [], "mismo escritorio, en mosaico: nada");
  const p = pasos(lugar({ escritorio: 15 }), lugar({ direccion: "0xdef", escritorio: 2 }));
  assert.deepEqual(p, [
    [
      ["dispatch", 'hl.dsp.window.move({ workspace = 15, follow = false, window = "address:0xdef" })'],
      ["dispatch", "movetoworkspacesilent", "15,address:0xdef"],
    ],
  ]);
  assert.deepEqual(pasos(lugar({ escritorio: -98 }), lugar({ escritorio: 2 })), [], "un escritorio especial no se toca");
  assert.deepEqual(pasos(lugar({ escritorio: 15 }), lugar({ direccion: "0xdef; rm", escritorio: 2 })), [], "una dirección rara no llega a hyprctl");
  // Flotaba y flota: también el lugar y el tamaño. En mosaico los decide Hyprland.
  const q = pasos(lugar({ flota: true, en: [100, 50], mide: [1000, 700] }), lugar({ direccion: "0xdef", flota: true, en: [0, 0], mide: [900, 640] }));
  assert.deepEqual(q.map((f) => f[0][1]), [
    'hl.dsp.window.move({ x = 100, y = 50, window = "address:0xdef" })',
    'hl.dsp.window.resize({ x = 1000, y = 700, window = "address:0xdef" })',
  ]);
  assert.deepEqual(pasos(lugar({ flota: true, en: [100, 50] }), lugar({ direccion: "0xdef", en: [0, 0] })), [], "ahora está en mosaico");
  for (const formas of [...p, ...q]) for (const args of formas) assert.match(args.join(" "), /address:0xdef/, "ningún dispatch sin ventana");
});

test("acomodar: busca la ventana por pid y prueba la sintaxis de Lua y después la vieja", async () => {
  const dir = mkdtempSync(path.join(tmp, "hypr-"));
  const log = path.join(dir, "log");
  const falso = path.join(dir, "hyprctl");
  const clientes = [
    { address: "0x111", pid: 4242, mapped: true, floating: false, at: [0, 0], size: [900, 640], workspace: { id: 2 } },
    { address: "0x222", pid: 7, mapped: true, floating: false, at: [0, 0], size: [900, 640], workspace: { id: 15 } },
  ];
  // Un Hyprland sin Lua: la sintaxis nueva no la entiende, la vieja sí.
  writeFileSync(falso, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\ncase "$1 $2" in\n  "clients -j") cat "${dir}/clientes.json";;\n  "dispatch hl."*) echo "Invalid dispatcher";;\n  *) echo ok;;\nesac\n`);
  chmodSync(falso, 0o755);
  writeFileSync(path.join(dir, "clientes.json"), JSON.stringify(clientes));
  process.env.HILOS_HYPRCTL = falso;
  try {
    assert.deepEqual(await lugarDeVentana(4242), { direccion: "0x111", escritorio: 2, flota: false, en: [0, 0], mide: [900, 640] });
    assert.equal(await lugarDeVentana(1), null);
    assert.equal(await acomodar(4242, lugar({ escritorio: 15 }), 2, 10), true);
    const corrido = readFileSync(log, "utf8").trim().split("\n").filter((l) => l.startsWith("dispatch"));
    assert.deepEqual(corrido, [
      'dispatch hl.dsp.window.move({ workspace = 15, follow = false, window = "address:0x111" })',
      "dispatch movetoworkspacesilent 15,address:0x111",
    ]);
    assert.equal(await acomodar(999, lugar(), 2, 10), false, "sin ventana no se despacha nada");
    assert.equal(readFileSync(log, "utf8").trim().split("\n").filter((l) => l.startsWith("dispatch")).length, 2);
  } finally {
    delete process.env.HILOS_HYPRCTL;
  }
});
