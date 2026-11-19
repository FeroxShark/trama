// Un archivo nombrado sólo por su nombre se vuelve tocable si está en una carpeta que el mismo mensaje nombra (issue #7).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { tiposDeRutas } from "../electron/archivo-existe.ts";
import { carpetasDeBusqueda, esNombreSuelto, nombresSueltosDe, partirNombres, planDeNombres, resolverNombres } from "../src/hilo/nombres-sueltos.ts";

/** Lo que contestaría el main: sólo existen las rutas de `existen` (como archivo). */
const existen = (...rutas: string[]) => Object.fromEntries(rutas.map((r) => [r, "archivo" as const]));

test("esNombreSuelto: nombres con extensión sí; rutas, `..`, separadores y sin extensión conocida, no", () => {
  for (const n of ["a.wav", "intensidad_enojado_3.wav", "Vista previa.mp3", "informe.PDF", "x.html"]) assert.equal(esNombreSuelto(n), true, n);
  for (const n of ["../x.wav", "..\\x.wav", "a/b.wav", "a\\b.wav", "C:a.wav", "a..wav", ".env", "voz", "a.zzzz", "a.", " a.wav", "*.wav"]) assert.equal(esNombreSuelto(n), false, n);
});

test("Linux: una carpeta y debajo a.wav y b.wav que existen se vuelven tocables con su ruta absoluta", () => {
  const texto = ["Dejé los audios en `/home/ana/voz/`:", "", "- a.wav", "- `b.wav`", "- c.wav"].join("\n");
  assert.deepEqual(nombresSueltosDe(texto, "linux"), ["b.wav", "a.wav", "c.wav"].sort((x, y) => texto.indexOf(x) - texto.indexOf(y)));
  const plan = planDeNombres(texto, null, "linux");
  const res = resolverNombres(plan, existen("/home/ana/voz/a.wav", "/home/ana/voz/b.wav"), "linux");
  assert.equal(res.get("a.wav"), "/home/ana/voz/a.wav");
  assert.equal(res.get("b.wav"), "/home/ana/voz/b.wav");
  assert.equal(res.has("c.wav"), false, "lo que no existe queda como texto");
});

test("si nada existe, no se vuelve tocable", () => {
  const plan = planDeNombres("En `/home/ana/voz/`:\n\n- a.wav\n- b.wav", null, "linux");
  assert.equal(resolverNombres(plan, {}, "linux").size, 0);
  assert.equal(resolverNombres(plan, { "/home/ana/voz/a.wav": null, "/home/ana/voz/b.wav": "carpeta" }, "linux").size, 0);
});

test("`../x.wav` nunca se resuelve, ni como código ni en una lista", () => {
  const texto = "En `/home/ana/voz/`:\n\n- `../x.wav`\n- ../y.wav\n- ..\\z.wav";
  assert.deepEqual(nombresSueltosDe(texto, "linux"), []);
  assert.deepEqual(planDeNombres(texto, "/home/ana", "linux").rutas, []);
});

test("sin carpeta que lo nombre ni carpeta del chat no se busca nada; con la del chat, sí (después de las del mensaje)", () => {
  assert.deepEqual(planDeNombres("- a.wav", null, "linux").rutas, []);
  const plan = planDeNombres("En `/home/ana/voz/`:\n\n- a.wav", "/home/ana/proyecto", "linux");
  assert.deepEqual(plan.rutas, ["/home/ana/voz/a.wav", "/home/ana/proyecto/a.wav"]);
  const soloChat = resolverNombres(plan, existen("/home/ana/proyecto/a.wav"), "linux");
  assert.equal(soloChat.get("a.wav"), "/home/ana/proyecto/a.wav");
  const ambas = resolverNombres(plan, existen("/home/ana/proyecto/a.wav", "/home/ana/voz/a.wav"), "linux");
  assert.equal(ambas.get("a.wav"), "/home/ana/voz/a.wav", "gana la carpeta del mensaje");
});

test("en prosa fuera de una lista un nombre suelto no se toca; en una lista, sí; una ruta absoluta no se parte", () => {
  assert.deepEqual(nombresSueltosDe("Mirá `/home/ana/voz/` y a.wav.", "linux"), []);
  assert.deepEqual(nombresSueltosDe("- /home/ana/voz/a.wav\n- ver a.wav.", "linux"), ["a.wav"]);
  assert.deepEqual(partirNombres("ver a.wav, luego b.mp3."), ["ver ", { nombre: "a.wav" }, ", luego ", { nombre: "b.mp3" }, "."]);
  assert.deepEqual(partirNombres("sin nada.aquí zzz"), ["sin nada.aquí zzz"]);
});

test("Windows (path.win32): carpeta con letra de unidad, barras mezcladas y mayúsculas distintas", () => {
  const texto = ["Los audios están en `C:\\MaxCurat\\vista_previa\\voz\\`:", "", "- intensidad_neutral.wav", "- Intensidad_Enojado_3.WAV", "- ../fuera.wav"].join("\n");
  assert.deepEqual(carpetasDeBusqueda(texto, "c:/maxcurat/vista_previa/voz", "win32"), ["C:\\MaxCurat\\vista_previa\\voz"], "la del chat repetida (otras barras y mayúsculas) no se duplica");
  const plan = planDeNombres(texto, "D:\\Trabajo", "win32");
  assert.deepEqual(plan.candidatos[0], {
    nombre: "intensidad_neutral.wav",
    rutas: [path.win32.join("C:\\MaxCurat\\vista_previa\\voz", "intensidad_neutral.wav"), "D:\\Trabajo\\intensidad_neutral.wav"],
  });
  const res = resolverNombres(plan, existen("C:\\MaxCurat\\vista_previa\\voz\\intensidad_neutral.wav", "C:\\MaxCurat\\vista_previa\\voz\\Intensidad_Enojado_3.WAV"), "win32");
  assert.equal(res.get("intensidad_neutral.wav"), "C:\\MaxCurat\\vista_previa\\voz\\intensidad_neutral.wav");
  assert.equal(res.get("intensidad_enojado_3.wav"), "C:\\MaxCurat\\vista_previa\\voz\\Intensidad_Enojado_3.WAV", "la clave no distingue mayúsculas en Windows");
  assert.equal(res.size, 2);
  assert.equal(plan.rutas.some((r) => r.includes("fuera")), false);
});

test("Windows: una carpeta de Linux del mensaje no sirve, y una de Windows no sirve en Linux", () => {
  assert.deepEqual(planDeNombres("En `/home/ana/voz/`:\n\n- a.wav", null, "win32").rutas, []);
  assert.deepEqual(planDeNombres("En `C:\\voz\\`:\n\n- a.wav", null, "linux").rutas, []);
});

test("tiposDeRutas (el main): archivo, carpeta, lo que falta, un secreto y lo no absoluto", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "trama-existen-"));
  try {
    await mkdir(path.join(dir, "voz"));
    await writeFile(path.join(dir, "voz", "a.wav"), "x");
    await writeFile(path.join(dir, ".env"), "x");
    const r = await tiposDeRutas([path.join(dir, "voz", "a.wav"), path.join(dir, "voz"), path.join(dir, "voz", "b.wav"), path.join(dir, ".env"), "a.wav", `${dir}/voz/../voz/a.wav`, 7], "linux", dir);
    assert.deepEqual(r, ["archivo", "carpeta", null, null, null, null, null]);
    assert.deepEqual(await tiposDeRutas("no es una lista"), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
