// La carpeta con que arranca un líder nuevo: el proyecto seleccionado, el último usado, y la personal sólo si se la elige (rutas inventadas de Linux y Windows).
import assert from "node:assert/strict";
import test from "node:test";
import { carpetaPorDefecto, opcionDe, OTRA, PERSONAL, type ProyectoCarpeta } from "../src/hilo/carpeta-nueva.ts";

const linux: ProyectoCarpeta[] = [
  { slug: "atlas", ruta: "/home/ana/proyectos/atlas", existe: true },
  { slug: "duna", ruta: "/home/ana/proyectos/duna", existe: true },
  { slug: "vieja", ruta: "/home/ana/proyectos/vieja", existe: false },
];
const windows: ProyectoCarpeta[] = [
  { slug: "atlas", ruta: "C:\\Users\\ana\\proyectos\\atlas", existe: true },
  { slug: "duna", ruta: "C:\\Users\\ana\\proyectos\\Duna", existe: true },
];

test("el proyecto seleccionado en la barra manda sobre el último usado", () => {
  assert.equal(carpetaPorDefecto({ seleccion: "duna", ultima: "/home/ana/proyectos/atlas", proyectos: linux }), "/home/ana/proyectos/duna");
  assert.equal(carpetaPorDefecto({ seleccion: "atlas", ultima: null, proyectos: windows }), "C:\\Users\\ana\\proyectos\\atlas");
});

test("sin selección, el último usado (en Windows sin distinguir mayúsculas, / ni \\)", () => {
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: "/home/ana/proyectos/atlas", proyectos: linux }), "/home/ana/proyectos/atlas");
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: "c:/users/ANA/proyectos/duna/", proyectos: windows }), "C:\\Users\\ana\\proyectos\\Duna");
});

test("lo que no sirve (general, un slug que no está, una carpeta borrada, el último ya no es proyecto) cae al siguiente", () => {
  assert.equal(carpetaPorDefecto({ seleccion: "general", ultima: "/home/ana/proyectos/duna", proyectos: linux }), "/home/ana/proyectos/duna");
  assert.equal(carpetaPorDefecto({ seleccion: "vieja", ultima: "/home/ana/proyectos/atlas", proyectos: linux }), "/home/ana/proyectos/atlas");
  assert.equal(carpetaPorDefecto({ seleccion: "nada", ultima: "/home/ana/proyectos/vieja", proyectos: linux }), "");
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: "/home/ana/suelta", proyectos: linux }), "");
});

test("la carpeta personal sólo si no hay ninguna pista, o si se la eligió a mano la última vez", () => {
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: null, proyectos: linux }), "");
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: PERSONAL, proyectos: linux }), "");
  assert.equal(carpetaPorDefecto({ seleccion: null, ultima: null, proyectos: [] }), "");
});

test("opcionDe: personal, un proyecto o otra carpeta", () => {
  assert.equal(opcionDe("", linux), PERSONAL);
  assert.equal(opcionDe("  ", windows), PERSONAL);
  assert.equal(opcionDe("/home/ana/proyectos/atlas/", linux), "/home/ana/proyectos/atlas");
  assert.equal(opcionDe("c:\\users\\ana\\PROYECTOS\\atlas", windows), "C:\\Users\\ana\\proyectos\\atlas");
  assert.equal(opcionDe("/home/ana/proyectos/vieja", linux), OTRA);
  assert.equal(opcionDe("/tmp/otra", linux), OTRA);
});
