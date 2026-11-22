// hook-compactando.mjs y resumen-modelos.mjs (motor/hooks): los ports a Node de hook-compactando.sh y resumen-modelos.sh (CTX-50). Sin
// bash ni jq: corren también en Windows. Los casos de hook-compactando.mjs son los de tests/compactando.test.ts (el .sh).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buscarReparto } from "../../motor/hooks/resumen-modelos.mjs";

const HOOKS = path.join(import.meta.dirname, "..", "..", "motor", "hooks");
const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-compactacion-"));
const conTemporal = (f: (dir: string) => void) => {
  const dir = temporal();
  try {
    f(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

/** El entorno de un líder: sin lo de Trama, con la casa y el estado en `dir`. */
function entorno(dir: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(PA_|TRAMA_|HILOS_|CLAUDE)/.test(k)) base[k] = v;
  return { ...base, HOME: dir, USERPROFILE: dir, HILOS_STATE: path.join(dir, "estado"), ...extra };
}
const correr = (nombre: string, args: string[], entrada: unknown, env: NodeJS.ProcessEnv, cwd?: string) =>
  spawnSync(process.execPath, [path.join(HOOKS, `${nombre}.mjs`), ...args], { input: JSON.stringify(entrada), encoding: "utf8", env, cwd });

test("hook-compactando.mjs: PreCompact deja la marca del líder (su session_id) y PostCompact la saca", () => {
  conTemporal((dir) => {
    const env = entorno(dir);
    const marcas = path.join(dir, "estado", "compactando");
    const r = correr("hook-compactando", [], { session_id: "s-falso-lider", hook_event_name: "PreCompact", trigger: "auto" }, env);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, "", ""], "no imprime nada");
    assert.deepEqual(readdirSync(marcas), ["s-falso-lider"]);
    correr("hook-compactando", [], { session_id: "s-falso-lider", hook_event_name: "PostCompact" }, env);
    assert.deepEqual(readdirSync(marcas), []);
  });
});

test("hook-compactando.mjs: en un worker de pa la marca lleva el id de su run; a mano manda la acción; un id raro no escribe", () => {
  conTemporal((dir) => {
    const marcas = path.join(dir, "estado", "compactando");
    const worker = entorno(dir, { PA_WORKER: "1", PA_TS: "20261003-100300-44444" });
    correr("hook-compactando", [], { session_id: "s-de-un-worker", hook_event_name: "PreCompact" }, worker);
    assert.deepEqual(readdirSync(marcas), ["20261003-100300-44444"]);
    correr("hook-compactando", [], { session_id: "s-de-un-worker", hook_event_name: "PostCompact" }, worker);
    assert.deepEqual(readdirSync(marcas), []);
    const env = entorno(dir);
    correr("hook-compactando", ["empieza"], { session_id: "s-a-mano" }, env);
    assert.deepEqual(readdirSync(marcas), ["s-a-mano"]);
    correr("hook-compactando", ["termina"], { session_id: "s-a-mano" }, env);
    assert.deepEqual(readdirSync(marcas), []);
    correr("hook-compactando", [], { session_id: "../afuera", hook_event_name: "PreCompact" }, env);
    correr("hook-compactando", [], { hook_event_name: "PreCompact" }, env);
    correr("hook-compactando", [], { session_id: "s-x", hook_event_name: "PreCompact" }, entorno(dir, { PA_WORKER: "1", PA_TS: "../../afuera" }));
    assert.deepEqual(readdirSync(marcas), []);
    assert.ok(!existsSync(path.join(dir, "afuera")));
  });
});

/** Un `reparto` falso en `bin`: imprime `texto` y sale con `rc` (un script de sh en POSIX, un .cmd en Windows). */
function repartoFalso(bin: string, texto: string, rc = 0): void {
  mkdirSync(bin, { recursive: true });
  if (process.platform === "win32") writeFileSync(path.join(bin, "reparto.cmd"), `@echo off\r\necho ${texto}\r\nexit /b ${rc}\r\n`);
  else {
    writeFileSync(path.join(bin, "reparto"), `#!/bin/sh\n[ "$1" = "--resumen" ] && echo '${texto}'\nexit ${rc}\n`);
    chmodSync(path.join(bin, "reparto"), 0o755);
  }
}
const conPath = (env: NodeJS.ProcessEnv, bin: string) => ({ ...env, PATH: bin, Path: bin });

test("resumen-modelos.mjs: en el home del líder (startup o compact) imprime el resumen de reparto; en cualquier otro caso, nada", () => {
  conTemporal((dir) => {
    const bin = path.join(dir, "bin");
    repartoFalso(bin, "RESUMEN-FALSO");
    const env = conPath(entorno(dir), bin);
    const proy = path.join(dir, "proyecto");
    mkdirSync(proy);
    const salida = (entrada: unknown, e = env) => {
      const r = correr("resumen-modelos", [], entrada, e);
      assert.equal(r.status, 0);
      assert.equal(r.stderr, "");
      return r.stdout.trim();
    };
    assert.equal(salida({ cwd: dir, source: "startup" }), "RESUMEN-FALSO");
    assert.equal(salida({ cwd: dir, source: "compact" }), "RESUMEN-FALSO");
    assert.equal(salida({ cwd: dir }), "RESUMEN-FALSO", "un evento sin source (o un settings viejo sin matcher) corre");
    assert.equal(salida({ cwd: dir, source: "resume" }), "");
    assert.equal(salida({ cwd: dir, source: "clear" }), "");
    assert.equal(salida({ cwd: proy, source: "startup" }), "", "una sesión dentro de un proyecto no lo ve");
    assert.equal(salida({ cwd: dir, source: "startup" }, { ...env, PA_WORKER: "1" }), "", "un worker tampoco");
    // Sin cwd en el JSON usa el cwd del proceso
    const sinCwd = spawnSync(process.execPath, [path.join(HOOKS, "resumen-modelos.mjs")], { input: "{}", encoding: "utf8", env, cwd: dir });
    assert.equal(sinCwd.stdout.trim(), "RESUMEN-FALSO");
  });
});

test("resumen-modelos.mjs: sin reparto, con reparto roto o con un JSON roto no imprime nada y sale 0", () => {
  conTemporal((dir) => {
    const vacio = path.join(dir, "vacio");
    mkdirSync(vacio);
    const sin = correr("resumen-modelos", [], { cwd: dir, source: "startup" }, conPath(entorno(dir), vacio));
    assert.deepEqual([sin.status, sin.stdout, sin.stderr], [0, "", ""]);
    const bin = path.join(dir, "bin");
    repartoFalso(bin, "NO-SALE", 3);
    const roto = correr("resumen-modelos", [], { cwd: dir, source: "startup" }, conPath(entorno(dir), bin));
    assert.deepEqual([roto.status, roto.stdout], [0, ""]);
    const json = spawnSync(process.execPath, [path.join(HOOKS, "resumen-modelos.mjs")], { input: "{no", encoding: "utf8", env: conPath(entorno(dir), bin), cwd: dir });
    assert.equal(json.status, 0);
  });
});

test("resumen-modelos.mjs buscarReparto: en Windows el bin\\reparto.cmd de la instalación manda; en Linux, el PATH", () => {
  conTemporal((dir) => {
    const bin = path.join(dir, "bin");
    repartoFalso(bin, "x");
    const real = path.join(bin, process.platform === "win32" ? "reparto.cmd" : "reparto");
    assert.equal(buscarReparto({ PATH: bin, PATHEXT: ".CMD" }, process.platform, path.join(dir, "app", "hooks")), real);
    // sin reparto en el PATH ni una instalación al lado de los hooks (en Windows mira …\app\hooks\..\..\bin)
    assert.equal(buscarReparto({ PATH: path.join(dir, "no") }, process.platform, path.join(dir, "sin-instalacion", "app", "hooks")), null);
    if (process.platform === "win32") assert.equal(buscarReparto({ PATH: path.join(dir, "no") }, "win32", path.join(dir, "app", "hooks")), real, "la de la instalación (…\\app\\hooks\\..\\..\\bin)");
    else assert.equal(buscarReparto({ PATH: path.join(dir, "no") }, "linux", path.join(dir, "app", "hooks")), null, "en Linux sólo el PATH");
  });
});
