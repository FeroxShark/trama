"use strict";
// El payload del Trama nativo (src/payload-nativo.js): la lista permitida, los .cmd de bin\ y la regla fija de Windows: nada de
// bash. Se arma desde un repo de mentira (con la forma del de verdad) y además se revisan los hooks .mjs reales del motor.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const p = require("../src/payload-nativo");

const REPO = path.join(__dirname, "..", "..");

function conDir(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-payload-nativo-"));
  try {
    return f(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const escribir = (r, t = "x") => (fs.mkdirSync(path.dirname(r), { recursive: true }), fs.writeFileSync(r, t));

// Un repo con lo mínimo y, a propósito, cosas que NO tienen que entrar.
function repoFalso(dir) {
  const r = path.join(dir, "repo");
  escribir(path.join(r, "app", "package.json"), JSON.stringify({ name: "trama", version: "9.9.9", private: true, scripts: { build: "x" }, dependencies: { react: "1" }, repository: "github:a/b" }));
  escribir(path.join(r, "app", "dist", "index.html"), "<!doctype html>");
  escribir(path.join(r, "app", "dist-electron", "motor.js"), "export {};\n");
  escribir(path.join(r, "app", "dist-electron", "motor.js.map"), "{}");
  escribir(path.join(r, "app", "dist-electron", ".listo"), "1");
  escribir(path.join(r, "app", "dist-electron", "cli", "trama-estado.js"), "export {};\n");
  escribir(path.join(r, "app", "dist-electron", "cli", "workers.js"), "export {};\n");
  escribir(path.join(r, "app", "electron", "main.ts"), "fuente");
  escribir(path.join(r, "app", "scripts", "instalar.sh"), "#!/usr/bin/env bash\n");
  escribir(path.join(r, "motor", "hooks", "latido.mjs"), "// ok\n");
  escribir(path.join(r, "motor", "hooks", "latido.sh"), "#!/usr/bin/env bash\n");
  escribir(path.join(r, "motor", "hooks", "docker-guard.py"), "print()");
  escribir(path.join(r, "motor", "skills", "trama-orquestar", "SKILL.md"), "# skill");
  escribir(path.join(r, "motor", "plantillas", "home", "CLAUDE.md"), "# líder");
  escribir(path.join(r, "motor", "datos", "aa-suplemento.json"), "{}");
  escribir(path.join(r, "motor", "bin", "pa"), "#!/usr/bin/env bash\n");
  escribir(path.join(r, "motor", "scripts", "instalar-producto.sh"), "#!/usr/bin/env bash\n");
  escribir(path.join(r, "motor", "systemd", "trama-motor.service"), "[Unit]");
  const node = path.join(dir, "node.exe");
  escribir(node, "MZ falso");
  return { repo: r, node };
}

test("arma el payload por lista permitida: sólo la app compilada, hooks .mjs, skill, plantillas, datos, node.exe y bin\\*.cmd", () =>
  conDir((dir) => {
    const { repo, node } = repoFalso(dir);
    const destino = path.join(dir, "payload-nativo");
    const r = p.armarPayload({ repo, destino, nodeExe: node });
    const hay = [...p.recorrer(destino)].sort();
    assert.deepEqual(hay, [
      ".version",
      "app/datos/aa-suplemento.json",
      "app/dist-electron/cli/trama-estado.js",
      "app/dist-electron/cli/workers.js",
      "app/dist-electron/motor.js",
      "app/dist/index.html",
      "app/hooks/latido.mjs",
      "app/package.json",
      "app/plantillas/home/CLAUDE.md",
      "app/skills/trama-orquestar/SKILL.md",
      "bin/trama-estado.cmd",
      "bin/workers.cmd",
      "node/node.exe",
    ]);
    assert.deepEqual(r.herramientas, ["trama-estado", "workers"]);
    assert.ok(r.faltan.includes("pa"));
    assert.equal(fs.readFileSync(path.join(destino, ".version"), "utf8"), r.version);
    assert.match(r.version, /^[0-9a-f]{16}$/);
    const pkg = JSON.parse(fs.readFileSync(path.join(destino, "app", "package.json"), "utf8"));
    assert.deepEqual(pkg, { name: "trama", version: "9.9.9", repository: "github:a/b", type: "module" });
    assert.deepEqual(p.revisarSinBash(destino).problemas, []);
  }));

test("la huella cambia con el contenido y no con armar dos veces lo mismo", () =>
  conDir((dir) => {
    const { repo, node } = repoFalso(dir);
    const a = p.armarPayload({ repo, destino: path.join(dir, "a"), nodeExe: node }).version;
    assert.equal(p.armarPayload({ repo, destino: path.join(dir, "b"), nodeExe: node }).version, a);
    escribir(path.join(repo, "app", "dist-electron", "motor.js"), "export const x = 1;\n");
    assert.notEqual(p.armarPayload({ repo, destino: path.join(dir, "c"), nodeExe: node }).version, a);
  }));

test("sin la app compilada no arma nada", () =>
  conDir((dir) => {
    const { repo, node } = repoFalso(dir);
    fs.rmSync(path.join(repo, "app", "dist-electron", "motor.js"));
    assert.throws(() => p.armarPayload({ repo, destino: path.join(dir, "x"), nodeExe: node }), /falta app\/dist-electron\/motor\.js/);
  }));

test("los .cmd de bin\\ corren la herramienta con el node.exe propio, por rutas relativas, en CRLF y sin bash", () => {
  const c = p.shimCmd("trama-estado");
  assert.equal(c, '@echo off\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\app\\dist-electron\\cli\\trama-estado.js" %*\r\n');
  assert.ok(!/bash|wsl/i.test(c));
});

test("regla fija: un .sh, un .service, un bash.exe o algo que llame a bash hacen fallar la revisión", () =>
  conDir((dir) => {
    const casos = {
      "app/hooks/x.sh": "echo",
      "app/x.service": "[Unit]",
      "app/tools/bash.exe": "MZ",
      "app/tools/jq.exe": "MZ",
      "app/dist-electron/a.js": 'spawn("bash", ["-c", x])',
      "app/dist-electron/b.js": "const s = ['/bin/sh', '-c', cmd];",
      "app/dist-electron/c.js": 'const git = "C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe";',
      "app/dist-electron/d.js": 'spawn("wsl.exe", ["-d", "Ubuntu"])',
      "app/hooks/e.mjs": "#!/usr/bin/env bash\n",
      "bin/f.cmd": "@echo off\r\nbash %~dp0x %*\r\n",
    };
    for (const [rel, t] of Object.entries(casos)) escribir(path.join(dir, rel), t);
    // Nombrar bash (como hacen los hooks que lo vigilan) no es llamarlo.
    escribir(path.join(dir, "app/hooks/ok.mjs"), "// port sin bash de latido.sh; `bash -n x` queda exento\nconst SHELLS = new Set(['bash', 'sh']);\n");
    const { problemas } = p.revisarSinBash(dir, []);
    const malos = [...new Set(problemas.map((x) => x.archivo))].sort();
    assert.deepEqual(malos, Object.keys(casos).sort());
  }));

test("las excepciones tienen nombre y motivo, y una que ya no encuentra nada se informa para sacarla", () =>
  conDir((dir) => {
    escribir(path.join(dir, "app/dist-electron/procesos.js"), 'const b = "bash.exe";');
    const r = p.revisarSinBash(dir, [
      { archivo: "app/dist-electron/procesos.js", motivo: "etapa 14" },
      { archivo: "app/dist-electron/ya-no.js", motivo: "se arregló" },
    ]);
    assert.deepEqual(r.problemas, []);
    assert.deepEqual(r.sobran, ["app/dist-electron/ya-no.js"]);
    assert.ok(p.EXCEPCIONES.every((e) => e.archivo && e.motivo.length > 20));
  }));

test("los hooks .mjs reales del motor pasan la revisión (con sus excepciones nombradas)", () =>
  conDir((dir) => {
    for (const f of fs.readdirSync(path.join(REPO, "motor", "hooks")).filter((f) => f.endsWith(".mjs"))) {
      escribir(path.join(dir, "app", "hooks", f), fs.readFileSync(path.join(REPO, "motor", "hooks", f), "utf8"));
    }
    const exc = p.EXCEPCIONES.filter((e) => e.archivo.startsWith("app/hooks/"));
    assert.deepEqual(p.revisarSinBash(dir, exc).problemas, []);
  }));

test("node.exe fijado: versión LTS y sha256 de 64 hex, bajado de nodejs.org", () => {
  assert.match(p.NODE.version, /^v\d+\.\d+\.\d+$/);
  assert.match(p.NODE.sha256, /^[0-9a-f]{64}$/);
  assert.equal(p.NODE.url, `https://nodejs.org/dist/${p.NODE.version}/win-x64/node.exe`);
});

test("electron-builder-nativo.yml lleva el payload nativo, y el canal propio", () => {
  const nativo = fs.readFileSync(path.join(__dirname, "..", "electron-builder-nativo.yml"), "utf8");
  assert.match(nativo, /from: payload-nativo\n\s+to: payload-nativo/);
  assert.match(nativo, /channel: nativo/);
  assert.match(nativo, /output: dist-nativo/);
});
