// Elegir modelo (`reparto --tipo`) no espera a un agy colgado (sin sesión de Google): `pa` lo corta a los 15 s, así que agy tiene
// REPARTO_ELEGIR_S (5) s y, si no contesta, deja la pausa y reparto sigue con lo que tiene.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { testPosix } from "./plataforma.ts";

testPosix("reparto --tipo con agy colgado termina en pocos segundos y deja la pausa", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "elegir-agy-"));
  try {
    const bin = path.join(tmp, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "agy"), "#!/bin/sh\nsleep 30\n");
    chmodSync(path.join(bin, "agy"), 0o755);
    const estado = path.join(tmp, "estado");
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
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
