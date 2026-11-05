// La carpeta "Auto" de un líder nuevo (electron/carpeta-auto.ts): el proyecto vivo que nombra el mensaje, nunca un retirado ni una
// carpeta que ya no está; sin ninguno, la personal. Sin modelo ni red: sólo el registry de la máquina.
import assert from "node:assert/strict";
import test from "node:test";
import { carpetaAutoDe } from "../electron/carpeta-auto.ts";
import type { Proyecto } from "../electron/registro.ts";

const HOME = "/home/ana";
const proy = (nombre: string, extra: Partial<Proyecto> = {}): Proyecto => ({
  nombre,
  slug: nombre,
  ruta: `${HOME}/Proyectos/${nombre}`,
  desc: "",
  icono: null,
  logo: null,
  titulo: null,
  tests: null,
  estado: "activo",
  alias: [],
  reemplazadoPor: null,
  ...extra,
});
const REG = [
  proy("trama", { titulo: "Trama Escritorio", alias: ["panel"] }),
  proy("hilos", { estado: "retirado", reemplazadoPor: "trama" }),
  proy("atlas"),
  proy("borrada"),
];
const existe = async (r: string) => !r.endsWith("/borrada");
const auto = (t: string, regs = REG) => carpetaAutoDe(t, regs, HOME, existe);

test("Auto: el proyecto que nombra el mensaje, por nombre, título, alias o ruta", async () => {
  assert.equal(await auto("Arreglá el login de atlas"), `${HOME}/Proyectos/atlas`);
  assert.equal(await auto("mirá la barra de trama"), `${HOME}/Proyectos/trama`);
  assert.equal(await auto("en Trama Escritorio falta el tema"), `${HOME}/Proyectos/trama`);
  assert.equal(await auto("el panel no abre"), `${HOME}/Proyectos/trama`);
  assert.equal(await auto("revisá ~/Proyectos/atlas/src"), `${HOME}/Proyectos/atlas`);
});

test("Auto: un proyecto retirado nunca se infiere, aunque el mensaje lo nombre", async () => {
  assert.equal(await auto("el repo hilos tiene un bug"), undefined);
  assert.equal(await auto(`mirá ${HOME}/Proyectos/hilos/src`), undefined);
  // Nombra los dos: queda el vivo.
  assert.equal(await auto("pasá lo de hilos a trama"), `${HOME}/Proyectos/trama`);
});

test("Auto: sin proyecto que nombre el mensaje, o con la carpeta borrada, va a la personal", async () => {
  assert.equal(await auto("contame un chiste"), undefined);
  assert.equal(await auto(""), undefined);
  assert.equal(await auto("arreglá borrada"), undefined);
  assert.equal(await auto("lo que sea", []), undefined);
});

test("Auto: dos carpetas con el mismo slug, vale la primera que existe", async () => {
  const dos = [proy("shell", { ruta: `${HOME}/a/shell` }), proy("shell", { ruta: `${HOME}/b/shell` })];
  assert.equal(await carpetaAutoDe("tocá shell", dos, HOME, async (r) => r.includes("/b/")), `${HOME}/b/shell`);
});
