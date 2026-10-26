// De qué trata un líder (B20): el título que sale de su transcript y el
// proyecto que nombra su primer mensaje (electron/tema.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { avanzarTema, creadoEn, nombreInterno, proyectoEnTexto, TEMA0, temaDe, tituloDeTexto, tituloLider } from "../electron/tema.ts";
import { PREFIJOS_ADJUNTO } from "../electron/adjunto.ts";

const HOME = "/home/ana";
const REG = [
  { nombre: "omc", slug: "omc", ruta: "/home/ana/omc" },
  { nombre: "Atlas Web", slug: "atlas", ruta: "/home/ana/Proyectos/atlas" },
  { nombre: "hilos", slug: "hilos", ruta: "/home/ana/Proyectos/hilos" },
  { nombre: "brote", slug: "brote", ruta: "/srv/brote" },
];
const usuario = (content: unknown, extra = {}) => JSON.stringify({ type: "user", message: { role: "user", content }, ...extra });

test("proyectoEnTexto: el primero que nombra, por nombre, slug o ruta", () => {
  const omc = "Retomá omc v2. Leé ~/.claude/plans/omc-v2-HANDOFF.md y ~/omc/PLAN-v2.md y seguí";
  assert.equal(proyectoEnTexto(omc, REG, HOME), "omc");
  assert.equal(proyectoEnTexto("mirá ~/Proyectos/hilos/src y después atlas", REG, HOME), "hilos");
  assert.equal(proyectoEnTexto("en /home/ana/Proyectos/atlas/web hay un bug", REG, HOME), "atlas");
  assert.equal(proyectoEnTexto("Arreglá el login de Atlas Web", REG, HOME), "atlas");
  assert.equal(proyectoEnTexto("revisá /srv/brote", REG, HOME), "brote");
  // Gana el que aparece primero, aunque el otro esté antes en el registry.
  assert.equal(proyectoEnTexto("brote y omc", REG, HOME), "brote");
});

test("proyectoEnTexto: palabra entera o nada", () => {
  assert.equal(proyectoEnTexto("busca bugs en la app", REG, HOME), null);
  assert.equal(proyectoEnTexto("nomcito y omc-v2-HANDOFF.md", REG, HOME), null);
  assert.equal(proyectoEnTexto("leé ~/.claude/plans/omc-v2.md", REG, HOME), null);
  assert.equal(proyectoEnTexto("", REG, HOME), null);
});

test("proyectoEnTexto: alias de proyecto y palabras comunes en minúscula pesan menos", () => {
  const reg = [
    ...REG,
    { nombre: "asistente-voz", slug: "asistente-voz", ruta: path.join(HOME, "Proyectos", "asistente-voz"), alias: ["shark"] },
    { nombre: "ventanita", slug: "ventanita", ruta: path.join(HOME, "Proyectos", "ventanita") },
  ];
  assert.equal(proyectoEnTexto("que pueda mover su ventanita... shark", reg, HOME), "asistente-voz");
  assert.equal(proyectoEnTexto("mover su ventanita... shark", reg, HOME), "asistente-voz");
  assert.equal(proyectoEnTexto("que pueda mover su ventanita", reg, HOME), "ventanita");
  assert.equal(proyectoEnTexto("en ventanita y shark", reg, HOME), "ventanita");
  assert.equal(proyectoEnTexto("el proyecto ventanita y shark", reg, HOME), "ventanita");
  const regSinAlias = [
    ...REG,
    { nombre: "asistente-voz", slug: "asistente-voz", ruta: path.join(HOME, "Proyectos", "asistente-voz") },
    { nombre: "ventanita", slug: "ventanita", ruta: path.join(HOME, "Proyectos", "ventanita") },
  ];
  assert.equal(proyectoEnTexto("mover su ventanita... shark", regSinAlias, HOME), "asistente-voz");
});

test("avanzarTema: título de Claude Code y primer mensaje de Ana", () => {
  const lineas = [
    JSON.stringify({ type: "custom-title", customTitle: "trama-dce1", sessionId: "s" }),
    usuario("<command-name>/model</command-name>"),
    usuario("Caveat: lo de abajo lo generó un comando local"),
    usuario("lo que inyecta", { isMeta: true }),
    usuario([{ type: "tool_result", tool_use_id: "t", content: "x" }]),
    usuario([{ type: "text", text: "Retomá omc v2.\nLeé el plan" }]),
    usuario("segundo mensaje"),
    JSON.stringify({ type: "ai-title", aiTitle: "Retomar omc v2", sessionId: "s" }),
  ].join("\n");
  const t = avanzarTema(TEMA0, lineas + "\n");
  assert.equal(t.primero, "Retomá omc v2.\nLeé el plan");
  assert.equal(t.custom, "trama-dce1");
  assert.equal(t.ai, "Retomar omc v2");
  assert.equal(t.resto, "");
});

test("avanzarTema: cuándo se creó la conversación, de su primera línea fechada (no cambia con lo que sigue)", () => {
  const fechada = (timestamp: string, texto: string) => JSON.stringify({ type: "user", timestamp, message: { role: "user", content: texto } });
  const sinFecha = JSON.stringify({ type: "custom-title", customTitle: "algo", sessionId: "s" });
  assert.equal(avanzarTema(TEMA0, sinFecha + "\n").creado, null);
  const a = avanzarTema(TEMA0, [sinFecha, fechada("2026-10-03T10:00:00.000Z", "hola"), fechada("2026-10-03T11:00:00.000Z", "sigo")].join("\n") + "\n");
  assert.equal(a.creado, Date.parse("2026-10-03T10:00:00.000Z") / 1000);
  // Un mensaje nuevo, horas después: la fecha de creación es la misma.
  const b = avanzarTema(a, JSON.stringify({ type: "assistant", timestamp: "2026-10-04T09:00:00.000Z", message: { content: [] } }) + "\n");
  assert.equal(b.creado, a.creado);
  assert.equal(avanzarTema(TEMA0, JSON.stringify({ type: "user", timestamp: "ayer", message: { content: "x" } }) + "\n").creado, null);
});

test("creadoEn: el transcript manda; uno de la app, desde que se lo creó; sin nada de eso, el arranque de la sesión", () => {
  // De terminal: lo primero del transcript, aunque el proceso sea nuevo (un --resume) o ya no esté.
  assert.equal(creadoEn(1000, undefined, 5000, 9000), 1000);
  assert.equal(creadoEn(1000, undefined), 1000);
  // Todavía sin transcript: el arranque de la sesión; si no lo dice, su última actividad.
  assert.equal(creadoEn(null, undefined, 5000, 9000), 5000);
  assert.equal(creadoEn(null, undefined, 0, 9000), 9000);
  // De la app: creado acá antes de su primer mensaje (no se mueve cuando llega el transcript)…
  assert.equal(creadoEn(null, 2000), 2000);
  assert.equal(creadoEn(2003, 2000), 2000);
  // …o traído / retomado después: vale la conversación, no cuándo se lo trajo.
  assert.equal(creadoEn(1000, 7000, 7000), 1000);
  assert.equal(creadoEn(null, undefined), 0);
});

test("avanzarTema: una línea partida entre dos pedazos", () => {
  const l = usuario("hola omc") + "\n";
  const a = avanzarTema(TEMA0, l.slice(0, 20));
  assert.equal(a.primero, null);
  const b = avanzarTema(a, l.slice(20));
  assert.equal(b.primero, "hola omc");
  assert.equal(b.bytes, Buffer.byteLength(l));
});

test("tituloLider: nunca el nombre interno; /rename > sesión > ai-title > primer mensaje", () => {
  assert.ok(nombreInterno("trama-dce1"));
  assert.ok(!nombreInterno("ana-e4"));
  const primero = "  Retomá omc v2.   Leé ~/omc/PLAN.md\nsegunda línea";
  assert.equal(tituloLider({ custom: "trama-dce1", ai: null, primero }, "trama-dce1"), "Retomá omc v2. Leé ~/omc/PLAN.md");
  assert.equal(tituloLider({ custom: "trama-dce1", ai: "Retomar omc", primero }, "trama-dce1"), "Retomar omc");
  assert.equal(tituloLider({ custom: null, ai: "Retomar omc", primero }, "ana-e4"), "ana-e4");
  assert.equal(tituloLider({ custom: "omc v2", ai: "Retomar omc", primero }, "ana-e4"), "omc v2");
  assert.equal(tituloLider({ custom: null, ai: null, primero: null }, "trama-0a0b"), "");
});

test("temaDe: lee el transcript y después sólo lo que creció", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-tema-"));
  const f = path.join(dir, "s.jsonl");
  writeFileSync(f, usuario("primer mensaje sobre brote") + "\n");
  const a = await temaDe("s-tema", f);
  assert.equal(a.primero, "primer mensaje sobre brote");
  appendFileSync(f, JSON.stringify({ type: "ai-title", aiTitle: "Brote" }) + "\n" + usuario("otro"));
  const b = await temaDe("s-tema", f);
  assert.equal(b.ai, "Brote");
  assert.equal(b.primero, "primer mensaje sobre brote");
  // Sin archivo: nada, sin romper.
  assert.equal((await temaDe("s-otro", path.join(dir, "no.jsonl"))).primero, null);
});

test("tituloLider: sin las líneas de archivo adjunto; si no hay texto, el nombre del archivo", () => {
  const [en0, es0] = PREFIJOS_ADJUNTO;
  const ruta = "/home/ana/.local/state/hilos/adjuntos/1a2b/diagnostico-sistema.md";
  const solo = `${es0}${ruta}`;
  assert.equal(tituloLider({ custom: null, ai: null, primero: solo }, "trama-dce1"), "diagnostico-sistema.md");
  assert.equal(tituloDeTexto(`${en0}${ruta}`), "diagnostico-sistema.md");
  assert.equal(tituloDeTexto(`revisá esto\n\n${solo}`), "revisá esto");
  assert.equal(tituloDeTexto(`${solo}\n${en0}/tmp/b.pdf`), "diagnostico-sistema.md, b.pdf");
  // La ruta del adjunto pasa por `hilos`, pero no habla de ese proyecto.
  assert.equal(proyectoEnTexto(solo, REG, HOME), null);
  assert.equal(proyectoEnTexto(`mirá omc\n\n${solo}`, REG, HOME), "omc");
});
