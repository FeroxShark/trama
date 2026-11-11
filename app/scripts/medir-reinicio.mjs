#!/usr/bin/env node
// Cuánto tarda el reinicio por un build nuevo, paso por paso (marcas de electron/reinicio-marcas.ts).
//   node scripts/medir-reinicio.mjs [archivo]       lee un archivo de marcas (por defecto el de $HILOS_STATE, que es
//                                                   el de la trama de verdad: sólo lectura) e imprime una tabla.
//   node scripts/medir-reinicio.mjs --simular [ms…] corre scripts/prueba-motor.mjs con una unidad de mentira que
//                                                   relanza el motor a los `ms` de caído (por defecto 2000 y 500) y
//                                                   imprime la tabla de cada una. Tras build; abre de a una app.
// Sólo imprime números. Nada se instala ni se toca de la trama de verdad.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const raiz = path.resolve(import.meta.dirname, "..");

/**
 * La corrida más reciente del archivo: sus marcas, las que llevan el id de su `inicio`. Cada línea es
 * `t id quien pid paso [extra]`; las de antes (`t quien pid paso [extra]`) son de la corrida que va abierta.
 */
function corrida(texto) {
  const lineas = [];
  let abierta = null;
  for (const l of texto.split("\n")) {
    const f = l.trim().split(/\s+/);
    const nueva = Number.isFinite(Number(f[1]));
    const t = Number(f[0]);
    const [quien, pid, paso, extra] = nueva ? f.slice(2) : f.slice(1);
    if (!paso || !Number.isFinite(t)) continue;
    if (!nueva && paso === "inicio") abierta = t;
    lineas.push({ t, id: nueva ? Number(f[1]) : abierta, quien, pid, paso, extra });
  }
  const ini = lineas.filter((m) => m.paso === "inicio").at(-1);
  if (!ini) return null;
  return { via: ini.extra ?? "?", marcas: lineas.filter((m) => m.id === ini.t) };
}

/** Cada paso desde el `inicio` de su corrida (no desde la marca anterior). */
function tabla(titulo, texto) {
  const c = corrida(texto);
  if (!c) return console.log(`${titulo}: sin marcas`);
  const ms = [...c.marcas].sort((a, b) => a.t - b.t);
  const t0 = ms.find((m) => m.paso === "inicio").t;
  console.log(`${titulo} (vía ${c.via})`);
  ms.forEach((m) => console.log(`  +${String(m.t - t0).padStart(5)} ms  ${m.quien.padEnd(8)} ${m.paso}`));
  const lista = ms.find((m) => m.paso === "lista");
  console.log(`  ${lista ? `reinicio completo: ${lista.t - t0} ms` : "no llegó a `lista`"}`);
}

const args = process.argv.slice(2);
if (args[0] === "--simular") {
  const restarts = args.slice(1).map(Number).filter(Boolean);
  for (const r of restarts.length ? restarts : [2000, 500]) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "hilos-medir-reinicio-"));
    const salida = path.join(dir, "marcas");
    const env = { ...process.env, RESTART_MS: String(r), MARCAS_SALIDA: salida };
    delete env.ELECTRON_RUN_AS_NODE;
    const p = spawnSync(process.execPath, [path.join(raiz, "scripts/prueba-motor.mjs")], { env, encoding: "utf8" });
    try {
      tabla(`unidad de mentira, RestartSec ${r / 1000} s`, readFileSync(salida, "utf8"));
    } catch {
      console.log(`unidad de mentira, RestartSec ${r / 1000} s: la prueba no dejó marcas (salió ${p.status})`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
} else {
  const archivo = args[0] ?? path.join(process.env.HILOS_STATE ?? path.join(os.homedir(), ".local/state/hilos"), "reinicio-marcas");
  try {
    tabla(archivo, readFileSync(archivo, "utf8"));
  } catch {
    console.log(`${archivo}: no existe (todavía no hubo un reinicio medido)`);
  }
}
