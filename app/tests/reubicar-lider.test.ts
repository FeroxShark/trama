// Un líder que arrancó en el home pasa solo a la carpeta del proyecto donde trabaja (lanzó `pa <proy>` o editó casi todo ahí),
// sin pisar lo movido a mano y sin saltar de nuevo una vez reubicado. Lo puro: electron/tema.ts (`proyectoPorUso`) + `armarArbol`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { armarArbol } from "../src/barra/arbol.ts";
import { avanzarTema, proyectoDeComandoPa, proyectoPorUso, TEMA0 } from "../electron/tema.ts";
import type { Lider } from "../src/datos/contrato.ts";

const HOME = "/home/ana";
const REG = [
  { nombre: "puente-usb", slug: "puente-usb", ruta: "/home/ana/Proyectos/puente-usb" },
  { nombre: "trama", slug: "trama", ruta: "/home/ana/Proyectos/trama" },
  { nombre: "omc", slug: "omc", ruta: "/home/ana/omc" },
];
const AHORA = 2_000_000_000;

const usuario = (t: string) => JSON.stringify({ type: "user", message: { role: "user", content: t } });
const herr = (name: string, input: unknown) => JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input }] } });
const bash = (command: string) => herr("Bash", { command });
const editar = (file_path: string) => herr("Edit", { file_path, old_string: "a", new_string: "b" });
const transcript = (...ls: string[]) => avanzarTema(TEMA0, ls.join("\n") + "\n");

const lider = (id: string, inferido: string | null): Lider => ({
  id, nombre: id, proyecto: "general", titulo: "Opus", actividad: AHORA - 60, creado: AHORA - 3600, cache_ttl_s: 3600, cache_vence: AHORA + 600,
  origen: "app", pid: 1, vivo: true, ocupado: false, modelo: "claude-opus-5-5", effort: "high", inferido,
}) as Lider;

test("un líder de inicio con `pa puente-usb` en su transcript queda en puente-usb", () => {
  const t = transcript(usuario("Quiero un dispositivo USB que opere una compu"), bash('mkdir -p ~/Proyectos/puente-usb'), bash('pa puente-usb --tipo codigo "armá el esqueleto"'));
  assert.equal(proyectoPorUso(t.usos, REG, HOME), "puente-usb");
  const inferido = proyectoPorUso(t.usos, REG, HOME);
  assert.equal(armarArbol([], { lideres: [lider("a", inferido)], ahora: AHORA }).lideres.get("a")!.proyecto, "puente-usb");
  // Sin evidencia, sigue en general.
  assert.equal(armarArbol([], { lideres: [lider("a", null)], ahora: AHORA }).lideres.get("a")!.proyecto, "general");
});

test("la forma de lanzar `pa`: flags antes del proyecto, valores de flag y texto de la tarea no cuentan", () => {
  assert.equal(proyectoDeComandoPa('pa --leer --tipo lectura trama "mirá omc"', REG), "trama");
  assert.equal(proyectoDeComandoPa("cd ~/x && pa omc --async --tipo codigo -m opus tarea", REG), "omc");
  assert.equal(proyectoDeComandoPa('pa --estado', REG), null);
  assert.equal(proyectoDeComandoPa('pa "arreglá omc"', REG), null);
  assert.equal(proyectoDeComandoPa("echo para omc", REG), null);
  assert.equal(proyectoDeComandoPa("ls ~/.local/state/pa/trama", REG), null);
});

test("la mayoría de sus Edit/Write bajo un proyecto lo reubica; con pocas o repartidas, no", () => {
  const a = (f: string) => editar(f);
  const mayoria = transcript(usuario("hola"), a("/home/ana/Proyectos/puente-usb/README.md"), a("~/Proyectos/puente-usb/src/main.py"), a("/home/ana/.claude/plans/x.md"));
  assert.equal(proyectoPorUso(mayoria.usos, REG, HOME), "puente-usb");
  assert.equal(proyectoPorUso(transcript(usuario("hola"), a("/home/ana/Proyectos/puente-usb/README.md")).usos, REG, HOME), null, "una sola edición no alcanza");
  const repartidas = transcript(usuario("hola"), a("/home/ana/Proyectos/puente-usb/a"), a("/home/ana/Proyectos/trama/b"), a("/home/ana/omc/c"));
  assert.equal(proyectoPorUso(repartidas.usos, REG, HOME), null);
  assert.equal(proyectoPorUso(TEMA0.usos, REG, HOME), null);
});

test("lo movido a mano no se mueve, y reubicado no salta a otro proyecto solo", () => {
  const fijadas = new Map<string, string>();
  const mover = new Map<string, string>([["a", "omc"]]);
  const paso = (inferido: string | null, mv: ReadonlyMap<string, string>) => {
    const r = armarArbol([], { lideres: [lider("a", inferido)], mover: mv, fijadas, ahora: AHORA });
    for (const [id, p] of r.decididas) fijadas.set(id, p);
    return r;
  };
  // A mano manda y no se decide nada.
  const manual = paso("puente-usb", mover);
  assert.equal(manual.lideres.get("a")!.proyecto, "omc");
  assert.equal(manual.decididas.size, 0);
  // Sin mover a mano: se reubica, se fija, y una evidencia posterior de otro proyecto no lo mueve.
  const sinMover = new Map<string, string>();
  assert.equal(paso("puente-usb", sinMover).lideres.get("a")!.proyecto, "puente-usb");
  assert.equal(paso("trama", sinMover).lideres.get("a")!.proyecto, "puente-usb");
  assert.equal(paso(null, sinMover).lideres.get("a")!.proyecto, "puente-usb");
});
