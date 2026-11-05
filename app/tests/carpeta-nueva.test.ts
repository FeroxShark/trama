// La carpeta con que arranca un líder nuevo: "Auto" siempre (también con un proyecto filtrado en la barra), lo elegido a mano manda y un
// proyecto retirado no se ofrece (rutas inventadas de Linux y Windows). La inferencia en sí: tests/carpeta-auto.test.ts.
import assert from "node:assert/strict";
import test from "node:test";
import { AUTO, carpetaDeEnvio, ofrecidos, opcionDe, OTRA, PERSONAL, rutaPedida, type ProyectoCarpeta } from "../src/hilo/carpeta-nueva.ts";

const linux: ProyectoCarpeta[] = [
  { slug: "atlas", ruta: "/home/ana/proyectos/atlas", existe: true },
  { slug: "duna", ruta: "/home/ana/proyectos/duna", existe: true, estado: "activo" },
  { slug: "vieja", ruta: "/home/ana/proyectos/vieja", existe: false },
  { slug: "hilos", ruta: "/home/ana/proyectos/hilos", existe: true, estado: "retirado" },
];
const windows: ProyectoCarpeta[] = [
  { slug: "atlas", ruta: "C:\\Users\\ana\\proyectos\\atlas", existe: true },
  { slug: "duna", ruta: "C:\\Users\\ana\\proyectos\\Duna", existe: true },
];

test("sin elegir nada a mano la opción es Auto, tenga o no la caja algo escrito en la carpeta", () => {
  assert.equal(opcionDe("", false, linux), AUTO);
  assert.equal(opcionDe("/home/ana/proyectos/atlas", false, linux), AUTO);
  assert.equal(opcionDe("", false, []), AUTO);
});

test("a mano: la personal, un proyecto (en Windows sin distinguir mayúsculas, / ni \\) u otra carpeta", () => {
  assert.equal(opcionDe("", true, linux), PERSONAL);
  assert.equal(opcionDe("  ", true, windows), PERSONAL);
  assert.equal(opcionDe("/home/ana/proyectos/atlas/", true, linux), "/home/ana/proyectos/atlas");
  assert.equal(opcionDe("c:\\users\\ana\\PROYECTOS\\atlas", true, windows), "C:\\Users\\ana\\proyectos\\atlas");
  assert.equal(opcionDe("c:/users/ANA/proyectos/duna/", true, windows), "C:\\Users\\ana\\proyectos\\Duna");
  assert.equal(opcionDe("/home/ana/proyectos/vieja", true, linux), OTRA);
  assert.equal(opcionDe("/tmp/otra", true, linux), OTRA);
});

test("un proyecto retirado no se ofrece, ni se reconoce como proyecto aunque la ruta sea la suya", () => {
  assert.deepEqual(ofrecidos(linux).map((p) => p.slug), ["atlas", "duna"]);
  assert.equal(opcionDe("/home/ana/proyectos/hilos", true, linux), OTRA);
});

test("lo que se manda: Auto pide inferir; a mano va tal cual; la personal elegida a mano no manda carpeta ni Auto", () => {
  assert.deepEqual(carpetaDeEnvio("", false), { auto: true });
  // Aunque haya una ruta escrita, sin elegirla a mano sigue siendo Auto.
  assert.deepEqual(carpetaDeEnvio("/home/ana/proyectos/atlas", false), { auto: true });
  assert.deepEqual(carpetaDeEnvio(" /home/ana/proyectos/atlas ", true), { carpeta: "/home/ana/proyectos/atlas" });
  assert.deepEqual(carpetaDeEnvio("", true), {});
});

test("la carpeta pedida desde la barra o el tablero: sólo si el proyecto se ofrece", () => {
  assert.equal(rutaPedida("duna", linux), "/home/ana/proyectos/duna");
  assert.equal(rutaPedida("vieja", linux), null);
  assert.equal(rutaPedida("hilos", linux), null);
  assert.equal(rutaPedida("nada", linux), null);
});
