// Novedades de cada versión: el parser del CHANGELOG, qué versiones se muestran tras arrancar (`versionesAMostrar`), la última vista
// en preferencias.json (primera instalación, «Listo», corridas de prueba) y que el CHANGELOG viaje con el build.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    if (spec.startsWith(".") && !/\.\w+$/.test(spec) && ctx.parentURL?.startsWith("file:")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec + ".ts");
      if (existsSync(ts)) return next(spec + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-novedades-"));
process.env.HILOS_STATE = path.join(tmp, "estado");
for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION", "HILOS_FIXTURES"]) delete process.env[k];
after(() => rmSync(tmp, { recursive: true, force: true }));

const nov = await import("../electron/novedades-cambios.ts");
const prefs = await import("../electron/preferencias.ts");
const lector = await import("../electron/novedades.ts");

const MUESTRA = `# Cambios

## 0.2.57

- Conectores como tienda: \`Tuyos | Descubrir\` y **buscador**.
- Barra: logo de cada carpeta.

## 0.2.56 — 2026-11-05

- Preguntas de un líder: el panel ya no tapa la conversación
  y se pliega a «N preguntas pendientes».

Un párrafo suelto que no es una viñeta.

## 0.2.10

- Una vieja.

## sin versión

- No cuenta.

## 0.2.9

## v0.2.8

* Con asterisco.
`;

test("parsearCambios: versión → viñetas, en el orden del archivo", () => {
  const e = nov.parsearCambios(MUESTRA);
  assert.deepEqual(e.map((x) => x.version), ["0.2.57", "0.2.56", "0.2.10", "0.2.8"]);
  assert.equal(e[0].items.length, 2);
  assert.equal(e[0].items[0], "Conectores como tienda: `Tuyos | Descubrir` y **buscador**.");
});

test("parsearCambios: una viñeta con sangría sigue en la misma; sin viñetas o sin versión no figura; tolera CRLF", () => {
  const e = nov.parsearCambios(MUESTRA);
  assert.equal(e[1].items.length, 1);
  assert.equal(e[1].items[0], "Preguntas de un líder: el panel ya no tapa la conversación y se pliega a «N preguntas pendientes».");
  assert.ok(!e.some((x) => x.version === "0.2.9"), "una versión sin viñetas no figura");
  assert.equal(nov.parsearCambios(MUESTRA.replace(/\n/g, "\r\n")).length, 4);
  assert.deepEqual(nov.parsearCambios(""), []);
  assert.deepEqual(nov.parsearCambios("- viñeta suelta\n## 1.0.0\n"), []);
  assert.deepEqual(nov.parsearCambios("## 1.0.0\n- a\n## 1.0.0\n- b\n").map((x) => x.items), [["a"]], "una versión repetida cuenta una vez");
});

test("el CHANGELOG de verdad se lee: versiones de la más nueva a la más vieja y viñetas no vacías", () => {
  const real = readFileSync(new URL("../../CHANGELOG.md", import.meta.url), "utf8");
  const e = nov.parsearCambios(real);
  assert.ok(e.length >= 10, `se leyeron ${e.length} versiones`);
  for (let i = 1; i < e.length; i++) assert.ok(nov.compararVersiones(e[i - 1].version, e[i].version) > 0, `${e[i - 1].version} antes de ${e[i].version}`);
  assert.ok(e.every((x) => x.items.every((it) => it.trim().length > 0)));
});

test("compararVersiones: numérico, no de texto (0.2.10 > 0.2.9)", () => {
  assert.ok(nov.compararVersiones("0.2.10", "0.2.9") > 0);
  assert.ok(nov.compararVersiones("0.2.9", "0.2.10") < 0);
  assert.equal(nov.compararVersiones("v0.2.9", "0.2.9"), 0);
  assert.ok(nov.compararVersiones("1.0.0", "0.99.99") > 0);
  assert.equal(nov.versionNormal(" v0.2.57 "), "0.2.57");
  assert.equal(nov.versionNormal("0.2"), null);
  assert.equal(nov.versionNormal(5), null);
});

test("versionesAMostrar: sólo lo posterior a la última vista, hasta la actual; si saltó varias, las intermedias también", () => {
  const e = nov.parsearCambios(MUESTRA);
  const v = (vista: string | null, actual: string) => nov.versionesAMostrar(e, vista, actual).map((x) => x.version);
  assert.deepEqual(v("0.2.56", "0.2.57"), ["0.2.57"]);
  assert.deepEqual(v("0.2.10", "0.2.57"), ["0.2.57", "0.2.56"], "salto: las dos, la más nueva arriba");
  assert.deepEqual(v("0.2.8", "0.2.56"), ["0.2.56", "0.2.10"], "no pasa de la actual");
  assert.deepEqual(v("0.2.57", "0.2.57"), [], "ya vista");
  assert.deepEqual(v("0.2.57", "0.2.56"), [], "se volvió a una versión anterior");
});

test("versionesAMostrar: sin versión vista (ya usaba Trama) sólo la de ahora; datos malos no muestran nada", () => {
  const e = nov.parsearCambios(MUESTRA);
  assert.deepEqual(nov.versionesAMostrar(e, null, "0.2.57").map((x) => x.version), ["0.2.57"]);
  assert.deepEqual(nov.versionesAMostrar(e, null, "0.2.55"), [], "la actual no figura en el archivo");
  assert.deepEqual(nov.versionesAMostrar(e, "x", "0.2.57"), []);
  assert.deepEqual(nov.versionesAMostrar(e, "0.2.56", "dev"), []);
  assert.deepEqual(nov.versionesAMostrar([], null, "0.2.57"), []);
});

test("trozos: `código` y **negrita**; lo que no cierra queda como texto", () => {
  assert.deepEqual(nov.trozos("Usá `pa --leer` y **mirá** esto"), [
    { tipo: "texto", texto: "Usá " },
    { tipo: "codigo", texto: "pa --leer" },
    { tipo: "texto", texto: " y " },
    { tipo: "negrita", texto: "mirá" },
    { tipo: "texto", texto: " esto" },
  ]);
  assert.deepEqual(nov.trozos("sin formato"), [{ tipo: "texto", texto: "sin formato" }]);
  assert.deepEqual(nov.trozos("`abierto y **sin cerrar"), [{ tipo: "texto", texto: "`abierto y **sin cerrar" }]);
  assert.deepEqual(nov.trozos(""), []);
});

test("la última vista: primera instalación la anota, quien ya usaba Trama recibe null, «Listo» no retrocede", async () => {
  const archivo = path.join(process.env.HILOS_STATE!, "preferencias.json");
  // Primera instalación (bienvenida sin ver, nada guardado): no hay nada que contar, y se anota la versión.
  assert.equal(await prefs.novedadesVista("0.2.57"), "0.2.57");
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).novedades, "0.2.57");
  // Una versión nueva: lo guardado manda.
  assert.equal(await prefs.novedadesVista("0.2.58"), "0.2.57");
  await prefs.guardarNovedadesVista("0.2.58");
  assert.equal(await prefs.novedadesVista("0.2.58"), "0.2.58");
  await prefs.guardarNovedadesVista("0.2.57");
  assert.equal(await prefs.novedadesVista("0.2.58"), "0.2.58", "no retrocede");
  await prefs.guardarNovedadesVista("basura");
  await prefs.guardarNovedadesVista(7);
  assert.equal(await prefs.novedadesVista("0.2.58"), "0.2.58");
  assert.equal(await prefs.novedadesVista(null), null, "sin versión que comparar no hay nada");
});

test("quien ya usaba Trama antes de las novedades (bienvenida vista, nada guardado) recibe null", async () => {
  const archivo = path.join(process.env.HILOS_STATE!, "preferencias.json");
  writeFileSync(archivo, JSON.stringify({ version: 1, effort: {}, bienvenida: true }));
  // La caché de preferencias es del proceso: se vuelve a leer con otra instancia del módulo.
  const otro = await import(`../electron/preferencias.ts?viejo=${Date.now()}`);
  assert.equal(await otro.novedadesVista("0.2.57"), null);
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).novedades, undefined, "no anota nada: aún no las vio");
});

test("una corrida de prueba dice que las novedades ya están vistas y no escribe nada", async () => {
  const archivo = path.join(process.env.HILOS_STATE!, "preferencias.json");
  writeFileSync(archivo, JSON.stringify({ version: 1, effort: {} }));
  const otro = await import(`../electron/preferencias.ts?prueba=${Date.now()}`);
  for (const k of ["HILOS_BENCH", "HILOS_CAPTURA", "HILOS_CAPTURA_PNG", "HILOS_PRUEBA", "HILOS_GUION"]) {
    process.env[k] = "1";
    assert.equal(await otro.novedadesVista("0.2.57"), "0.2.57", k);
    delete process.env[k];
  }
  process.env.HILOS_FIXTURES = "1";
  assert.equal(await otro.novedadesVista("0.2.57"), "0.2.57");
  delete process.env.HILOS_FIXTURES;
  assert.equal(JSON.parse(readFileSync(archivo, "utf8")).novedades, undefined);
});

test("leerCambios: el primero que exista; ninguno, vacío", async () => {
  const a = path.join(tmp, "a.md");
  const b = path.join(tmp, "b.md");
  writeFileSync(b, "## 1.0.0\n- uno\n");
  assert.equal(await lector.leerCambios([pathToFileURL(a), pathToFileURL(b)]), "## 1.0.0\n- uno\n");
  writeFileSync(a, "## 2.0.0\n- dos\n");
  assert.equal(await lector.leerCambios([pathToFileURL(a), pathToFileURL(b)]), "## 2.0.0\n- dos\n");
  assert.equal(await lector.leerCambios([pathToFileURL(path.join(tmp, "no.md"))]), "");
  // En un checkout sin build, el de la raíz del repo.
  assert.ok((await lector.leerCambios()).includes("## "), "RUTAS_CAMBIOS encuentra el CHANGELOG del repo");
});

test("el CHANGELOG viaja con el build: vite lo emite en dist/ y dist/ va entero al AppImage, al .exe nativo y a la instalación", () => {
  const aqui = (...p: string[]) => path.join(import.meta.dirname, "..", ...p);
  const vite = readFileSync(aqui("vite.config.ts"), "utf8");
  assert.ok(/fileName:\s*"CHANGELOG\.md"/.test(vite) && vite.includes("../CHANGELOG.md"), "vite.config.ts emite CHANGELOG.md");
  assert.ok(/plugins:\s*\[[^\]]*cambios\(\)/.test(vite), "el plugin está puesto");
  assert.ok(/-\s*dist\/\*\*\/\*/.test(readFileSync(aqui("electron-builder.yml"), "utf8")), "el AppImage lleva dist/**/*");
  assert.ok(readFileSync(aqui("..", "windows", "src", "payload-nativo.js"), "utf8").includes('["app/dist", "app/dist"'), "el .exe nativo copia app/dist entero");
  const instalador = readFileSync(aqui("..", "motor", "scripts", "instalar-producto.sh"), "utf8");
  assert.ok(/\$src\/\.\.\/CHANGELOG\.md.*\$dst\/CHANGELOG\.md/.test(instalador), "el instalador de Linux deja el CHANGELOG donde vite lo busca");
  assert.ok(readFileSync(aqui("electron", "novedades.ts"), "utf8").includes('"../dist/CHANGELOG.md"'), "el motor lo lee de dist/");
});
