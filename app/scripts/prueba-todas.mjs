#!/usr/bin/env node
// Corre las pruebas de pantalla (scripts/prueba-*.mjs) de a una, nunca dos Electron a la vez, y
// termina con un resumen por script. Sale con 1 si alguna falla (una "falla conocida" se anota
// pero no cuenta). Con nombres corre sólo esas: `npm run prueba -- acciones vigia` (el prefijo
// "prueba-" y el ".mjs" sobran). Hace falta el build (`npm run build`).
//   PRUEBA_TOPE_S=<s>  tope por script (default 300): pasado eso se lo corta y cuenta como falla.
//   PRUEBA_VERBOSO=1   cada script muestra todo lo que imprime (si no, sólo el final de los que fallan).
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");
/** Scripts que hoy fallan por algo conocido: nombre → por qué. Se corren igual y se anotan. */
const CONOCIDAS = {};
const tope = Number(process.env.PRUEBA_TOPE_S ?? 300) * 1000;
const verboso = !!process.env.PRUEBA_VERBOSO;

const todos = readdirSync(import.meta.dirname)
  .filter((f) => /^prueba-.+\.mjs$/.test(f) && f !== "prueba-todas.mjs")
  .map((f) => f.slice("prueba-".length, -".mjs".length))
  .sort();
const pedidos = process.argv.slice(2).map((a) => a.replace(/^(scripts\/)?prueba-/, "").replace(/\.mjs$/, ""));
const malos = pedidos.filter((p) => !todos.includes(p));
if (malos.length) {
  console.error(`no existe: ${malos.join(", ")}. Hay: ${todos.join(", ")}`);
  process.exit(2);
}
const lista = pedidos.length ? pedidos : todos;

/** Corre un script y devuelve { codigo, salida, seg }; `codigo` es null si pasó el tope. */
function correr(nombre) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    // electron/aislar.ts anota ahí todo acceso al HOME de verdad (los datos del usuario): la prueba no puede dar verde con eso.
    const aislar = path.join(mkdtempSync(path.join(tmpdir(), "prueba-aislar-")), "log");
    mkdirSync(path.join(path.dirname(aislar), "casa"));
    // Cada script con su HOME y XDG vacíos (en /tmp) y sin carpetas del home en el PATH: `os.homedir()` vale lo mismo para la prueba y para la app.
    const casa = path.join(path.dirname(aislar), "casa");
    const real = homedir();
    const camino = (process.env.PATH ?? "").split(":").filter((d) => d && d !== real && !d.startsWith(`${real}/`)).join(":");
    // El CLI `tablero` es una herramienta, no un dato: se busca antes de limpiar el PATH y se declara permitido (la prueba usa un tablero temporal).
    const candidatos = [...(process.env.PATH ?? "").split(":"), path.join(real, ".local/bin")].map((d) => path.join(d, "tablero"));
    const tablero = process.env.HILOS_TABLERO ?? [...candidatos, path.join(raiz, "..", "motor", "bin", "tablero")].find((f) => existsSync(f));
    const p = spawn(process.execPath, [path.join(import.meta.dirname, `prueba-${nombre}.mjs`)], {
      cwd: raiz,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        HOME: casa,
        XDG_CONFIG_HOME: `${casa}/.config`,
        XDG_DATA_HOME: `${casa}/.local/share`,
        XDG_CACHE_HOME: `${casa}/.cache`,
        XDG_STATE_HOME: `${casa}/.local/state`,
        PATH: camino,
        HILOS_AISLAR_LOG: aislar,
        ...(tablero ? { HILOS_TABLERO: tablero, HILOS_AISLAR_PERMITE: [process.env.HILOS_AISLAR_PERMITE, tablero].filter(Boolean).join(":") } : {}),
      },
    });
    let salida = "";
    const junta = (d) => {
      salida += d;
      if (verboso) process.stdout.write(d);
    };
    p.stdout.on("data", junta);
    p.stderr.on("data", junta);
    let cortado = false;
    const reloj = setTimeout(() => {
      cortado = true;
      // El grupo entero: el script y el Electron que abrió.
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {}
    }, tope);
    p.on("close", (codigo) => {
      clearTimeout(reloj);
      // Nada queda vivo del script (si salió por un error pudo dejar su Electron).
      try {
        process.kill(-p.pid, "SIGKILL");
      } catch {}
      const tocado = existsSync(aislar) ? readFileSync(aislar, "utf8").trim() : "";
      rmSync(path.dirname(aislar), { recursive: true, force: true });
      if (tocado) salida += `\nTOCÓ LO DE ANA (electron/aislar.ts):\n${tocado}\n`;
      resolve({ codigo: cortado ? null : tocado && !codigo ? 97 : codigo, salida, seg: Math.round((Date.now() - t0) / 100) / 10 });
    });
  });
}

const resumen = [];
for (const nombre of lista) {
  console.log(`\n=== prueba-${nombre}`);
  const r = await correr(nombre);
  const bien = r.codigo === 0;
  const conocida = CONOCIDAS[nombre];
  const estado = bien ? "ok" : conocida ? "falla conocida" : "falló";
  if (!bien && !verboso) console.log(r.salida.split("\n").slice(-25).join("\n"));
  console.log(`--- ${nombre}: ${estado}${bien ? "" : r.codigo === null ? ` (pasó el tope de ${tope / 1000} s)` : ` (código ${r.codigo})`} en ${r.seg} s`);
  resumen.push({ nombre, estado, seg: r.seg, conocida });
}

console.log("\n=== Resumen");
for (const r of resumen) console.log(`${r.estado === "ok" ? "ok   " : r.estado === "falló" ? "FALLÓ" : "conoc"}  ${r.nombre.padEnd(12)} ${String(r.seg).padStart(6)} s${r.conocida && r.estado !== "ok" ? `  (${r.conocida})` : ""}`);
const fallaron = resumen.filter((r) => r.estado === "falló").length;
const conocidas = resumen.filter((r) => r.estado === "falla conocida").length;
console.log(`${resumen.length - fallaron - conocidas} ok, ${fallaron} fallaron${conocidas ? `, ${conocidas} fallas conocidas` : ""}`);
process.exit(fallaron ? 1 : 0);
