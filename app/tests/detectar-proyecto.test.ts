// El proyecto que nombra el pedido de un líder nuevo (#1877): por nombre o título, sin mayúsculas ni tildes, palabra entera, el primero que aparece.
import assert from "node:assert/strict";
import test from "node:test";
import { detectarProyecto, type ProyectoDetectable } from "../src/hilo/detectar-proyecto.ts";

const proyectos: (ProyectoDetectable & { ruta: string })[] = [
  { nombre: "atlas", titulo: null, ruta: "/home/ana/proyectos/atlas" },
  { nombre: "duna", titulo: "Duna Studio", ruta: "/home/ana/proyectos/duna" },
  { nombre: "diseno-web", titulo: "Diseño Web", ruta: "/home/ana/proyectos/diseno-web" },
  { nombre: "app", titulo: null, ruta: "/home/ana/proyectos/app" },
];

test("nombra un proyecto por su nombre exacto", () => {
  assert.equal(detectarProyecto("revisá el build de atlas", proyectos)?.ruta, "/home/ana/proyectos/atlas");
});

test("el título que muestra el selector también cuenta, sin mayúsculas ni tildes", () => {
  assert.equal(detectarProyecto("ajustar el DISENO web del menú", proyectos)?.ruta, "/home/ana/proyectos/diseno-web");
  assert.equal(detectarProyecto("pasar duna  studio a la nueva API", proyectos)?.ruta, "/home/ana/proyectos/duna");
  assert.equal(detectarProyecto("arreglar el diseño web", proyectos)?.ruta, "/home/ana/proyectos/diseno-web");
});

test("si nombra dos, manda el que aparece primero en el texto", () => {
  assert.equal(detectarProyecto("pasar duna a atlas", proyectos)?.ruta, "/home/ana/proyectos/duna");
  assert.equal(detectarProyecto("atlas y después duna", proyectos)?.ruta, "/home/ana/proyectos/atlas");
});

test("ninguno nombrado da null", () => {
  assert.equal(detectarProyecto("hacer un resumen de la semana", proyectos), null);
  assert.equal(detectarProyecto("", proyectos), null);
  assert.equal(detectarProyecto("atlas", []), null);
});

test("una palabra metida dentro de otra no cuenta", () => {
  assert.equal(detectarProyecto("revisar la application del banco", proyectos), null);
  assert.equal(detectarProyecto("las apps nuevas", proyectos), null);
  assert.equal(detectarProyecto("subir la app, ya", proyectos)?.ruta, "/home/ana/proyectos/app");
  assert.equal(detectarProyecto("ya atlasíco", proyectos), null);
});
