// plugin-agy: el plugin pa-worker de agy para el Trama nativo de Windows (copias, sin symlinks ni bash).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { carpetaPluginAgy, instalarPluginAgy, MARCA_PLUGIN } from "../electron/cli/plugin-agy.ts";
import { instalar } from "../electron/cli/instalar-nativo.ts";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");

function conSandbox(f: (hooks: string, home: string, dir: string) => void) {
  const dir = mkdtempSync(path.join(tmpdir(), "trama-plugin-agy-"));
  try {
    const hooks = path.join(dir, "app", "hooks");
    mkdirSync(hooks, { recursive: true });
    for (const h of ["agy-pa.mjs", "destructive-guard.mjs", "latido.mjs", "docker-guard.mjs"]) writeFileSync(path.join(hooks, h), readFileSync(path.join(MOTOR, "hooks", h)));
    const home = path.join(dir, "home");
    mkdirSync(home);
    f(hooks, home, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("instala el plugin con copias y hooks de node, sin .sh ni bash; la segunda vez no cambia nada", () => {
  conSandbox((hooks, home) => {
    const l = instalarPluginAgy({ hooks, home });
    assert.deepEqual(l.map((x) => x.tipo), ["hecho"], JSON.stringify(l));
    const plug = carpetaPluginAgy(home);
    assert.deepEqual(JSON.parse(readFileSync(path.join(plug, "plugin.json"), "utf8")), { name: "pa-worker" });
    const h = readFileSync(path.join(plug, "hooks.json"), "utf8");
    assert.match(h, /node \.\/agy-pa\.mjs pre/);
    assert.doesNotMatch(h, /bash|\.sh/);
    for (const a of ["agy-pa.mjs", "destructive-guard.mjs", "latido.mjs", "docker-guard.mjs", MARCA_PLUGIN]) assert.ok(existsSync(path.join(plug, a)), a);
    assert.deepEqual(instalarPluginAgy({ hooks, home }).map((x) => x.tipo), ["ok"]);
  });
});

test("repara un agy-pa.mjs viejo; no toca una carpeta de otro plugin; avisa si falta agy-pa.mjs", () => {
  conSandbox((hooks, home, dir) => {
    instalarPluginAgy({ hooks, home });
    const plug = carpetaPluginAgy(home);
    writeFileSync(path.join(plug, "agy-pa.mjs"), "viejo\n");
    assert.deepEqual(instalarPluginAgy({ hooks, home }).map((x) => x.tipo), ["hecho"]);
    assert.equal(readFileSync(path.join(plug, "agy-pa.mjs"), "utf8"), readFileSync(path.join(hooks, "agy-pa.mjs"), "utf8"));

    const home2 = path.join(dir, "home2");
    const ajeno = carpetaPluginAgy(home2);
    mkdirSync(ajeno, { recursive: true });
    writeFileSync(path.join(ajeno, "plugin.json"), '{"name":"otro"}\n');
    const l = instalarPluginAgy({ hooks, home: home2 });
    assert.equal(l[0]!.tipo, "aviso");
    assert.equal(readFileSync(path.join(ajeno, "plugin.json"), "utf8"), '{"name":"otro"}\n');

    rmSync(path.join(hooks, "agy-pa.mjs"));
    assert.equal(instalarPluginAgy({ hooks, home: path.join(dir, "home3") })[0]!.tipo, "aviso");
  });
});

test("instalar-nativo deja el plugin sólo si hay agy", () => {
  conSandbox((hooks, home, dir) => {
    const base = { app: path.dirname(hooks), home, node: "C:\\n\\node.exe", registro: path.join(dir, "reg", "registry.json"), plataforma: "win32" as const };
    instalar(base);
    assert.ok(!existsSync(carpetaPluginAgy(home)));
    const r = instalar({ ...base, agy: true });
    assert.ok(existsSync(path.join(carpetaPluginAgy(home), "agy-pa.mjs")), JSON.stringify(r.lineas));
    assert.ok(r.lineas.some((x) => /pa-worker/.test(x.texto)));
  });
});
