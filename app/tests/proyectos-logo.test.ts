// El logo elegido a mano de un proyecto (`logo` del registry, electron/proyectos-alias.ts `logoProyecto`): se guarda la imagen achicada y no la
// ruta, sólo si vale, en todas las entradas de la carpeta, sin tocar lo demás del registry; "Volver al automático" lo saca; y el buscador
// (registro() + iconosDe) lo usa antes que el ícono que encuentre en la carpeta. Todo en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { es } from "../src/i18n/es.ts";
import { en } from "../src/i18n/en.ts";
import { iconosDe } from "../electron/iconos.ts";
import { listarProyectos, logoProyecto } from "../electron/proyectos-alias.ts";
import { registro } from "../electron/registro.ts";
import { textoT } from "../electron/errores.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "logo-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const reg = path.join(tmp, "registry.json");
const hilos = path.join(tmp, "hilos");
const atlas = path.join(tmp, "atlas");
mkdirSync(hilos);
mkdirSync(atlas);
writeFileSync(path.join(hilos, "favicon.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><title>auto</title></svg>');
const leer = () => JSON.parse(readFileSync(reg, "utf8")) as { projects: Record<string, unknown>[]; otro?: unknown };
writeFileSync(
  reg,
  JSON.stringify({ otro: { se: "conserva" }, projects: [{ name: "hilos", path: hilos, tests: "npm test" }, { name: "Hilos Viejo", path: hilos }, { name: "atlas", path: atlas, titulo: "Atlas Web" }] }, null, 2),
);

const png = (w: number, h: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write("IHDR", 12);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return `data:image/png;base64,${b.toString("base64")}`;
};

test("guardar el logo: queda la imagen (no una ruta) en todas las entradas de la carpeta y el resto del registry no cambia", async () => {
  const antes = await listarProyectos(reg);
  assert.deepEqual(antes.map((p) => p.logo), [false, false]);
  const r = await logoProyecto(reg, "hilos", png(64, 64));
  assert.equal(r.slug, "hilos");
  assert.equal(r.logo, true);
  const j = leer();
  assert.equal(j.projects[0].logo, png(64, 64));
  assert.equal(j.projects[1].logo, png(64, 64));
  assert.equal(j.projects[2].logo, undefined);
  assert.deepEqual(j.otro, { se: "conserva" });
  assert.equal(j.projects[0].tests, "npm test");
  assert.ok(existsSync(`${reg}.bak`), "deja el respaldo");
  assert.equal((await listarProyectos(reg)).find((p) => p.slug === "atlas")?.logo, false);
});

test("volver al automático: se saca el campo y el nombre propio queda", async () => {
  await logoProyecto(reg, "atlas", png(32, 32));
  assert.equal((await listarProyectos(reg)).find((p) => p.slug === "atlas")?.logo, true);
  const r = await logoProyecto(reg, "atlas", null);
  assert.equal(r.logo, false);
  assert.equal(r.titulo, "Atlas Web");
  assert.equal("logo" in leer().projects[2], false);
  // Sacar el que no tenía no rompe nada.
  assert.equal((await logoProyecto(reg, "atlas", null)).logo, false);
});

test("rechaza lo que no sirve y no escribe: una ruta, una imagen grande, un SVG con recursos de afuera, un slug raro o inexistente", async () => {
  const antes = readFileSync(reg, "utf8");
  for (const malo of ["/home/yo/logo.png", png(300, 300), "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://malo/x.png"/></svg>').toString("base64"), 42, undefined]) {
    await assert.rejects(logoProyecto(reg, "atlas", malo), (e: Error) => e.message === textoT("main.logo.invalido"));
  }
  await assert.rejects(logoProyecto(reg, "../x", png(8, 8)), /proyectoRaro/);
  await assert.rejects(logoProyecto(reg, "no-existe", png(8, 8)), /proyectoRaro/);
  assert.equal(readFileSync(reg, "utf8"), antes);
});

test("el buscador usa el logo elegido antes que el ícono de la carpeta, y vuelve al de la carpeta al sacarlo", async () => {
  const antes = process.env.PROYECTOS_REGISTRY;
  process.env.PROYECTOS_REGISTRY = reg;
  try {
    await logoProyecto(reg, "hilos", null);
    const sin = await iconosDe(await registro());
    assert.match(Buffer.from(sin.hilos.split(",")[1], "base64").toString(), /auto/);
    await logoProyecto(reg, "hilos", png(48, 48));
    const con = await iconosDe(await registro());
    assert.equal(con.hilos, png(48, 48));
    assert.equal(con.atlas, undefined);
    await logoProyecto(reg, "hilos", null);
    assert.match(Buffer.from((await iconosDe(await registro())).hilos.split(",")[1], "base64").toString(), /auto/);
  } finally {
    if (antes === undefined) delete process.env.PROYECTOS_REGISTRY;
    else process.env.PROYECTOS_REGISTRY = antes;
  }
});

test("los textos de Ajustes > Proyectos > Logo y el error existen en español e inglés", () => {
  for (const k of ["pry.logo", "pry.logoAuto", "pry.logoPropio", "pry.logoCambiar", "pry.logoCambiarDe", "pry.logoQuitar", "pry.logoQuitarDe", "pry.logoGuardado", "pry.logoQuitado", "main.logo.invalido"]) {
    assert.ok((es as Record<string, string>)[k], `es ${k}`);
    assert.ok((en as Record<string, string>)[k], `en ${k}`);
  }
});
