// Elegir modelo (`reparto --tipo`) no espera a un agy colgado (sin sesión de Google): `pa` lo corta a los 15 s, así que agy tiene
// REPARTO_ELEGIR_S (5) s y, si no contesta, deja la pausa y reparto sigue con lo que tiene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testPosix } from "./plataforma.ts";

testPosix("reparto --tipo con agy colgado termina en pocos segundos y deja la pausa", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "elegir-agy-"));
  try {
    const bin = path.join(tmp, "bin");
    mkdirSync(bin);
    const estado = path.join(tmp, "estado");
    mkdirSync(estado, { recursive: true });
    const pidsFile = path.join(estado, "hijos.pids");
    // Un hijo real (sleep 30) como los que lanza agy: al cortar por tope no puede quedar huérfano.
    writeFileSync(path.join(bin, "agy"), `#!/bin/sh\nsleep 30 &\necho $! >> "${pidsFile}"\nwait\n`);
    chmodSync(path.join(bin, "agy"), 0o755);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts"), "--tipo", "debug", "--json"], {
      encoding: "utf8",
      timeout: 25_000,
      env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: tmp, REPARTO_STATE: estado, PA_STATE: path.join(tmp, "pa"),
        REPARTO_ELEGIR_S: "1", REPARTO_AVISAR: "0", REPARTO_OPENCODE: "0", REPARTO_DSH: "0", TRAMA_MODELOS: path.join(tmp, "no.json"),
      },
    });
    const seg = (Date.now() - t0) / 1000;
    assert.ok(seg < 12, `tardó ${seg} s`);
    assert.ok(existsSync(path.join(estado, "agy-sin-sesion.json")), `sin pausa de agy: ${r.stderr}`);
    assert.ok(JSON.parse(r.stdout).modelo, "eligió un modelo igual");
    const pids = readFileSync(pidsFile, "utf8").trim().split(/\s+/).map(Number).filter(Boolean);
    assert.ok(pids.length >= 2, `esperaba al menos 2 hijos de agy (quota + models), hubo ${pids.length}`);
    for (const pid of pids) {
      let vivo = true;
      try {
        process.kill(pid, 0);
      } catch (e: any) {
        vivo = e?.code === "EPERM";
      }
      assert.equal(vivo, false, `quedó vivo el hijo ${pid} de agy tras cortar por tope`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
