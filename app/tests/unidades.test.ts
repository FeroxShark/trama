// systemd/trama.service y systemd/trama-motor.service, sin correr systemd: que el reinicio rápido (500 ms) no
// rompa lo que depende de ellas (KillMode=process, el código 3 que no se levanta de nuevo), que un bucle al
// ritmo de RestartSec pase el tope de arranques antes de que su ventana se reinicie, y que pasan el verify.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repo = path.join(import.meta.dirname, "..");
const UNIDADES = ["trama.service", "trama-motor.service"];

/** Ajustes activos de una unidad (`Seccion.Clave` → valor), sin comentarios. */
function ajustes(nombre: string): Map<string, string> {
  const out = new Map<string, string>();
  let seccion = "";
  for (const linea of readFileSync(path.join(repo, "systemd", nombre), "utf8").split("\n")) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const sec = /^\[(\w+)\]$/.exec(l);
    if (sec) {
      seccion = sec[1];
      continue;
    }
    const i = l.indexOf("=");
    if (i > 0) out.set(`${seccion}.${l.slice(0, i)}`, l.slice(i + 1));
  }
  return out;
}

/** Segundos de un valor de tiempo de systemd: "500ms", "2s" o "2". */
function segundos(v: string | undefined): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s)?$/.exec(v ?? "");
  assert.ok(m, `valor de tiempo sin entender: ${v}`);
  return Number(m[1]) / (m[2] === "ms" ? 1000 : 1);
}

for (const nombre of UNIDADES) {
  test(`${nombre}: reinicia a 500 ms y el tope de arranques salta dentro de su ventana`, () => {
    const a = ajustes(nombre);
    assert.equal(a.get("Service.Restart"), "always");
    assert.equal(a.get("Service.RestartSec"), "500ms");
    // Un bucle que arranca cada RestartSec tiene que completar StartLimitBurst arranques dentro de
    // StartLimitIntervalSec, si no el tope nunca salta y el bucle sigue sin fin.
    const ventana = segundos(a.get("Unit.StartLimitIntervalSec"));
    const burst = Number(a.get("Unit.StartLimitBurst"));
    const ritmo = segundos(a.get("Service.RestartSec"));
    assert.ok(burst * ritmo < ventana, `${burst} arranques a ${ritmo} s no caben en ${ventana} s: el tope no salta`);
  });

  test(`${nombre}: sigue sin matar a los workers y el código 3 no se relanza`, () => {
    const a = ajustes(nombre);
    assert.equal(a.get("Service.KillMode"), "process");
    assert.equal(a.get("Service.RestartPreventExitStatus"), "3");
    assert.equal(a.get("Service.SuccessExitStatus"), "3");
  });
}

test("las dos unidades pasan systemd-analyze --user verify", { skip: (process.getuid?.() === 0 && "corre como root") || (spawnSync("systemd-analyze", ["--version"]).status !== 0 && "sin systemd-analyze") }, () => {
  // El verify mira que los ejecutables existan: un HOME de mentira con cada uno en su lugar (nada de la máquina real).
  const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-unidades-"));
  try {
    const h = path.join(tmp, "home");
    const checkout = path.join(h, "checkout", "trama");
    mkdirSync(path.join(h, ".local", "bin"), { recursive: true });
    mkdirSync(path.join(checkout, "node_modules", "electron", "dist"), { recursive: true });
    mkdirSync(path.join(checkout, "dist-electron"), { recursive: true });
    for (const ejec of [path.join(h, ".local", "bin", "trama"), path.join(checkout, "node_modules", "electron", "dist", "electron")]) {
      writeFileSync(ejec, "#!/bin/sh\n");
      chmodSync(ejec, 0o755);
    }
    writeFileSync(path.join(checkout, "dist-electron", "motor.js"), "");
    const u = path.join(tmp, "unidad");
    mkdirSync(u);
    // La ruta del checkout va en lugar de `@RAIZ@`, como la pone scripts/instalar.sh.
    for (const n of UNIDADES) writeFileSync(path.join(u, n), readFileSync(path.join(repo, "systemd", n), "utf8").replaceAll("@RAIZ@", checkout));
    const env = { ...process.env, HOME: h, XDG_CONFIG_HOME: path.join(h, ".config") };
    const r = spawnSync("systemd-analyze", ["--user", "verify", ...UNIDADES.map((n) => path.join(u, n))], { encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal(r.stderr.trim() + r.stdout.trim(), "");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
