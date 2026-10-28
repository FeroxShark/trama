"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_WIN = path.dirname(__dirname);
const { crearAsistente, aRutaWsl } = require(path.join(REPO_WIN, "src/pasos"));
const { crearLimpieza } = require(path.join(REPO_WIN, "src/limpieza"));
const { esDeRelleno } = require(path.join(REPO_WIN, "src/actualizar"));

const DISTRO = "Ubuntu-24.04";
// El camino viejo con WSL se prueba con un «wsl» falso hecho de scripts bash; en Windows nativo no hay bash (regla fija del port).
const SIN_BASH = process.platform === "win32" ? "camino WSL: necesita bash, que Windows nativo no tiene" : false;

const ARCHIVOS_USUARIO = [
  [".claude/.credentials.json", JSON.stringify({ claudeAiOauth: { accessToken: "tok-secreto-claude", refreshToken: "ref-1", expiresAt: 1999999999000 } })],
  [".claude.json", JSON.stringify({ oauthAccount: { emailAddress: "gonza@example.com", accountUuid: "uuid-1" }, numStartups: 14 })],
  [".claude/settings.json", JSON.stringify({ model: "opus", hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "echo mio" }] }] } }, null, 2)],
  [".claude/projects/-home-gonza/sid-011.jsonl", JSON.stringify({ type: "user", message: { content: "hola" } }) + "\n"],
  [".gemini/oauth_creds.json", JSON.stringify({ access_token: "tok-gemini", refresh_token: "ref-gemini" })],
  [".config/Antigravity/User/globalStorage/state.vscdb", "SQLITE-KEYRING-TOKEN-AGY-011"],
  [".local/share/keyrings/login.keyring", "KEYRING-BINARIO-INTACTO-011"],
  [".config/trama/modelos.json", JSON.stringify({ version: 1, lider: "claude-opus-4-6", reserva: { "5h": 0.15, "7d": 0.1 }, locales: [{ id: "qwen2.5:7b", nombre: "Qwen 7B" }] }, null, 2)],
  [".config/trama/cuentas.json", JSON.stringify({ version: 1, cuentas: [{ id: "principal", proveedor: "claude" }, { id: "trabajo", proveedor: "google" }] })],
  [".local/state/hilos/lideres.json", JSON.stringify([{ id: "sid-011", nombre: "Mi tarea", dormido: true, proyecto: "miapp" }])],
  [".local/state/hilos/cola.json", JSON.stringify({ version: 1, items: [{ lider: "sid-011", texto: "pendiente" }] })],
  [".local/state/hilos/borradores.json", JSON.stringify({ version: 1, borradores: { "sid-011": { texto: "a mitad de escribir" } } })],
  [".local/state/hilos/volver.json", JSON.stringify({ version: 1, abierto: { tipo: "lider", id: "sid-011" } })],
  [".local/state/hilos/nombres.json", JSON.stringify({ version: 1, nombres: { "sid-011": "Lider principal" }, orden: ["sid-011"] })],
  [".local/state/hilos/preferencias.json", JSON.stringify({ version: 1, idioma: "es", effort: { "claude-opus-4-6": "high" }, bienvenida: true })],
  [".local/state/hilos/gemini/conv-011.jsonl", JSON.stringify({ role: "model", text: "respuesta previa" }) + "\n"],
  [".local/state/hilos/historial/indice.json", JSON.stringify({ version: 3, sesiones: { "sid-011": { tokens: 42000 } } })],
  [".local/state/pa/miapp/20261024-01.sid", "sid-worker-01\n"],
  [".local/state/pa/eventos.jsonl", JSON.stringify({ version: 1, tipo: "fin", id: "20261024-01" }) + "\n"],
  [".config/proyectos/registry.json", JSON.stringify({ projects: [{ name: "miapp", path: "proyectos/miapp" }] })],
  [".local/share/tablero/pendientes.json", JSON.stringify({ version: 1, items: [{ id: "p1", titulo: "Revisar copia" }] })],
  [".local/share/tablero/vista.json", JSON.stringify({ version: 1, filtro: "abiertos" })],
  ["CLAUDE.md", "# Reglas propias de Gonza\nNo tocar.\n"],
  ["GEMINI.md", "# Instrucciones Gemini de Gonza\n"],
  ["proyectos/miapp/index.js", "console.log(\"hola mundo\");\n"],
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function hashesDe(home, lista = ARCHIVOS_USUARIO) {
  const out = {};
  for (const [rel] of lista) {
    out[rel] = sha256(fs.readFileSync(path.join(home, rel)));
  }
  return out;
}

function escribirEjecutable(ruta, lineas) {
  const conShebang = lineas[0]?.startsWith("#!") ? lineas : ["#!/usr/bin/env bash", ...lineas];
  fs.writeFileSync(ruta, conShebang.join("\n") + "\n", { mode: 0o755 });
}

function crearEntorno011() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-act-011-"));
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  const estadoSvc = path.join(dir, "svc");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(estadoSvc, { recursive: true });

  for (const [rel, contenido] of ARCHIVOS_USUARIO) {
    const abs = path.join(home, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contenido);
  }

  fs.mkdirSync(path.join(home, ".local/bin"), { recursive: true });
  fs.mkdirSync(path.join(home, ".local/share/trama/app/dist"), { recursive: true });
  fs.mkdirSync(path.join(home, ".local/share/trama/app/dist-electron"), { recursive: true });
  fs.mkdirSync(path.join(home, ".local/share/trama/app/node_modules"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local/share/trama/app/dist/index.html"), "<html>ui-0.1.1</html>\n");
  fs.writeFileSync(path.join(home, ".local/share/trama/app/dist-electron/motor.js"), "console.log(\"motor-0.1.1\");\n");
  fs.writeFileSync(path.join(home, ".local/share/trama/app/node_modules/marcador.txt"), "cache-node-modules-intacto\n");
  fs.writeFileSync(path.join(home, ".local/share/trama/carcasa-payload"), "huella-011");
  fs.writeFileSync(path.join(home, ".config/trama/app"), path.join(home, ".local/share/trama/app") + "\n");

  fs.writeFileSync(path.join(estadoSvc, "pid"), "4111\n");
  fs.writeFileSync(path.join(estadoSvc, "motor-cargado"), "console.log(\"motor-0.1.1\");\n");
  fs.writeFileSync(path.join(estadoSvc, "log"), "");
  fs.writeFileSync(path.join(estadoSvc, "nextpid"), "5200\n");

  escribirEjecutable(path.join(bin, "systemctl"), [
    "set -e",
    "SVC=" + JSON.stringify(estadoSvc),
    "CASA=" + JSON.stringify(home),
    "ARGS=\"$*\"",
    "(cd \"$SVC\" && printf \"%s\\n\" \"$ARGS\" >> log)",
    "case \"$ARGS\" in *\"show -p ExecMainPID\"*) (cd \"$SVC\" && cat pid); exit 0 ;; esac",
    "case \"$ARGS\" in *\"is-active\"*)",
    "  p=\"$(cd \"$SVC\" && cat pid)\"",
    "  [ \"$p\" != \"0\" ] && [ -n \"$p\" ] && exit 0 || exit 3 ;;",
    "esac",
    "case \"$ARGS\" in *\"restart trama-motor\"*|*\"start trama-motor\"*)",
    "  case \" $ARGS\" in *\" start trama-motor\"*) [ \"$(cd \"$SVC\" && cat pid)\" != \"0\" ] && exit 0 ;; esac",
    "  n=\"$(cd \"$SVC\" && cat nextpid)\"",
    "  (cd \"$SVC\" && echo $((n + 1)) > nextpid && echo \"$n\" > pid)",
    "  MotorTxt=\"$(cd \"$CASA\" && cat .local/share/trama/app/dist-electron/motor.js)\"",
    "  (cd \"$SVC\" && printf \"%s\\n\" \"$MotorTxt\" > motor-cargado)",
    "  exit 0 ;;",
    "esac",
    "exit 0",
  ]);
  escribirEjecutable(path.join(bin, "ps"), ["echo systemd"]);
  escribirEjecutable(path.join(bin, "id"), ["echo 1000"]);
  escribirEjecutable(path.join(bin, "sudo"), ["exit 0"]);

  escribirEjecutable(path.join(home, ".local/bin/trama-estado"), [
    "SVC=" + JSON.stringify(estadoSvc),
    "CASA=" + JSON.stringify(home),
    "vivo=false",
    "[ \"$(cd \"$SVC\" && cat pid)\" != \"0\" ] && vivo=true",
    "claude_ok=false",
    "(cd \"$CASA\" && [ -f .claude/.credentials.json ]) && claude_ok=true",
    "printf '{\"version\":1,\"claude\":{\"instalado\":true,\"logueado\":%s},\"agy\":{\"instalado\":true,\"logueado\":false},\"ollama\":{\"url\":\"http://localhost:11434\",\"responde\":false,\"modelos\":[]},\"motor\":{\"vivo\":%s,\"url\":\"http://localhost:8791\"}}\\n' \"$claude_ok\" \"$vivo\"",
  ]);
  escribirEjecutable(path.join(home, ".local/bin/agy"), [
    "if [ \"${1:-}\" = \"models\" ]; then printf \"gemini-4-argon\\tGemini 4 Argon\\n\"; fi",
  ]);

  let winEstado = {
    distroCreada: DISTRO,
    loginHecho: true,
    ollamaResuelto: true,
    instalado: { version: "0.1.1", payload: "huella-011", fecha: "2026-10-23T22:00:00.000Z" },
  };
  const store = {
    cargar: () => JSON.parse(JSON.stringify(winEstado)),
    guardar: (o) => { winEstado = JSON.parse(JSON.stringify(o)); },
  };

  const wsl = (args, { input = "", onLinea } = {}) => {
    if (args[0] === "-l") return Promise.resolve({ code: 0, stdout: DISTRO + "\r\n", stderr: "" });
    if (args[0] === "--terminate" || args[0] === "--shutdown") return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    return new Promise((res) => {
      const p = spawn("bash", ["-s"], {
        cwd: home,
        env: { PATH: bin + ":" + process.env.PATH, HOME: home, USER: "gonza" },
      });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => {
        const t = d.toString("utf8");
        stdout += t;
        for (const l of t.split(/\r?\n/)) if (l.trim()) onLinea?.(l);
      });
      p.stderr.on("data", (d) => (stderr += d.toString("utf8")));
      p.on("close", (code) => res({ code, stdout, stderr }));
      p.stdin.end(input);
    });
  };

  return {
    dir,
    home,
    estadoSvc,
    store,
    wsl,
    limpiar: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function armarPayloadExportado(dirBase, { versionUi = "0.1.2", instalarLineas }) {
  const exportado = path.join(dirBase, "exportado");
  const destPayload = path.join(dirBase, "win-res");
  fs.mkdirSync(path.join(exportado, "motor/scripts"), { recursive: true });
  fs.mkdirSync(path.join(exportado, "app/src"), { recursive: true });
  fs.writeFileSync(path.join(exportado, "app/package.json"), JSON.stringify({ name: "hilos", version: "0.1.0" }));
  fs.writeFileSync(path.join(exportado, "app/src/version.txt"), versionUi + "\n");
  escribirEjecutable(path.join(exportado, "motor/scripts/instalar-producto.sh"), instalarLineas);
  execFileSync("bash", [path.join(REPO_WIN, "scripts/preparar-payload.sh"), exportado], {
    env: { ...process.env, TRAMA_PAYLOAD_DEST: destPayload },
  });
  const payloadDir = path.join(destPayload, "payload");
  const version = fs.readFileSync(path.join(payloadDir, ".version"), "utf8").trim();
  return { payloadDir, version };
}

test("actualizar 0.1.1 -> 0.1.2: recompila y reinicia el motor en WSL y deja idénticos (SHA-256) logins, config, sesiones, proyectos y tablero", { skip: SIN_BASH }, async () => {
  const env = crearEntorno011();
  try {
    const hashesAntes = hashesDe(env.home);
    assert.equal(Object.keys(hashesAntes).length, ARCHIVOS_USUARIO.length);

    const scriptConBugViejo = [
      "set -euo pipefail",
      "if [[ \"${1:-}\" == \"--solo-apt\" ]]; then echo \"apt al dia\"; exit 0; fi",
      "[[ \"${1:-}\" == \"--fuente\" ]] || exit 1",
      "FUENTE=\"$2\"",
      "ORIGEN_APP=\"$(cd \"$FUENTE\" && cd app && pwd)\"",
      "cd",
      "mkdir -p .local/share/trama/app",
      "DEST_APP=\"$(cd .local/share/trama/app && pwd)\"",
      "(cd \"$ORIGEN_APP\" && cp -a . \"$DEST_APP\")",
      "if [[ -f .local/share/trama/app/dist-electron/motor.js ]]; then",
      "  echo \"bug viejo: dist-electron/motor.js ya existe, no recompilo\"",
      "  exit 0",
      "fi",
      "V=\"$(cat .local/share/trama/app/src/version.txt)\"",
      "mkdir -p .local/share/trama/app/dist .local/share/trama/app/dist-electron",
      "printf \"<html>ui-%s</html>\\n\" \"$V\" > .local/share/trama/app/dist/index.html",
      "printf \"console.log(\\\"motor-%s\\\");\\n\" \"$V\" > .local/share/trama/app/dist-electron/motor.js",
    ];

    const { payloadDir, version: huellaNueva } = armarPayloadExportado(env.dir, {
      versionUi: "0.1.2",
      instalarLineas: scriptConBugViejo,
    });
    assert.match(huellaNueva, /^[0-9a-f]{16}$/);
    assert.notEqual(huellaNueva, "huella-011");

    const winFalso = "C:\\TramaPayload";
    const mntFalso = aRutaWsl(winFalso);
    const eventos = [];
    const asisWin = crearAsistente({
      wsl: (args, opts = {}) => {
        const input = String(opts.input || "").split(mntFalso).join(payloadDir);
        return env.wsl(args, { ...opts, input });
      },
      elevarWsl: async () => { throw new Error("no debe pedir UAC al actualizar"); },
      abrirConsola: async () => { throw new Error("no debe abrir consola de login al actualizar"); },
      fetch: async () => { throw new Error("ollama ya resuelto"); },
      estado: env.store,
      payload: { dir: winFalso, version: huellaNueva },
      wslconfig: { leer: () => null, escribir: () => { throw new Error("no tocar .wslconfig"); } },
      espera: async () => {},
      version: "0.1.2",
      env: { USERNAME: "Gonza" },
    });

    const r = await asisWin.avanzar((e) => eventos.push(e));
    assert.deepEqual(r, { listo: true, url: "http://localhost:8791" });

    const inicios = eventos.filter((e) => e.tipo === "inicia");
    assert.equal(inicios.length, 1);
    assert.deepEqual({ paso: inicios[0].paso, actualizacion: inicios[0].actualizacion }, { paso: "instalar", actualizacion: true });

    assert.equal(
      fs.readFileSync(path.join(env.home, ".local/share/trama/app/dist-electron/motor.js"), "utf8").trim(),
      "console.log(\"motor-0.1.2\");",
      "recompiló el motor nuevo aunque construir_app tuviera el chequeo viejo"
    );
    assert.equal(
      fs.readFileSync(path.join(env.home, ".local/share/trama/app/dist/index.html"), "utf8").trim(),
      "<html>ui-0.1.2</html>"
    );
    assert.equal(
      fs.readFileSync(path.join(env.home, ".local/share/trama/app/node_modules/marcador.txt"), "utf8").trim(),
      "cache-node-modules-intacto",
      "conservó node_modules para no reinstalar todo de cero"
    );

    const pidNuevo = fs.readFileSync(path.join(env.estadoSvc, "pid"), "utf8").trim();
    assert.notEqual(pidNuevo, "4111", "reinició trama-motor para levantar el código nuevo");
    assert.equal(
      fs.readFileSync(path.join(env.estadoSvc, "motor-cargado"), "utf8").trim(),
      "console.log(\"motor-0.1.2\");",
      "el servicio vivo quedó corriendo motor 0.1.2 y no 0.1.1"
    );
    assert.equal(fs.readFileSync(path.join(env.home, ".local/share/trama/carcasa-payload"), "utf8"), huellaNueva);

    const cuentas = await asisWin.cuentas();
    assert.deepEqual(cuentas, {
      claude: { instalado: true, logueado: true },
      agy: { instalado: true, logueado: true },
    });

    const limp = crearLimpieza({
      wsl: env.wsl,
      win: { expandir: (x) => x, tipo: async () => null, borrar: async () => {}, registro: { hay: async () => false, quitar: async () => {} } },
      estado: env.store,
      version: "0.1.2",
      distro: DISTRO,
    });
    const resLimp = await limp.despuesDeActualizar();
    assert.equal(resLimp.hecho, true);
    assert.deepEqual(resLimp.resultados, []);

    const hashesDespues = hashesDe(env.home);
    assert.deepEqual(hashesDespues, hashesAntes, "todos los archivos de credenciales, config, sesiones, registry y tablero siguen bit a bit idénticos");

    const eventos2 = [];
    const r2 = await asisWin.avanzar((e) => eventos2.push(e));
    assert.deepEqual(r2, { listo: true, url: "http://localhost:8791" });
    assert.equal(eventos2.filter((e) => e.tipo === "inicia").length, 0, "el siguiente arranque entra directo sin reinstalar");
    assert.equal(fs.readFileSync(path.join(env.estadoSvc, "pid"), "utf8").trim(), pidNuevo);
    assert.deepEqual(hashesDe(env.home), hashesAntes);
  } finally {
    env.limpiar();
  }
});

test("actualizar 0.1.1 -> 0.1.2: si instalar-producto.sh falla a mitad, restaura el motor 0.1.1 y no toca credenciales", { skip: SIN_BASH }, async () => {
  const env = crearEntorno011();
  try {
    const hashesAntes = hashesDe(env.home);
    const { payloadDir, version: huellaNueva } = armarPayloadExportado(env.dir, {
      versionUi: "0.1.2",
      instalarLineas: [
        "if [[ \"${1:-}\" == \"--solo-apt\" ]]; then exit 0; fi",
        "echo \"fallo simulado de compilacion\" >&2",
        "exit 1",
      ],
    });

    const winFalso = "C:\\TramaPayload";
    const mntFalso = aRutaWsl(winFalso);
    const asisWin = crearAsistente({
      wsl: (args, opts = {}) => {
        const input = String(opts.input || "").split(mntFalso).join(payloadDir);
        return env.wsl(args, { ...opts, input });
      },
      elevarWsl: async () => ({ code: 0, stderr: "" }),
      abrirConsola: async () => {},
      fetch: async () => ({ ok: false }),
      estado: env.store,
      payload: { dir: winFalso, version: huellaNueva },
      wslconfig: { leer: () => null, escribir: () => {} },
      espera: async () => {},
      version: "0.1.2",
      env: { USERNAME: "Gonza" },
    });

    await assert.rejects(asisWin.avanzar(), /Falló la instalación del motor/);
    assert.equal(
      fs.readFileSync(path.join(env.home, ".local/share/trama/app/dist-electron/motor.js"), "utf8").trim(),
      "console.log(\"motor-0.1.1\");",
      "restauró el build previo 0.1.1"
    );
    assert.equal(fs.readFileSync(path.join(env.home, ".local/share/trama/carcasa-payload"), "utf8"), "huella-011");
    assert.deepEqual(hashesDe(env.home), hashesAntes);
  } finally {
    env.limpiar();
  }
});

test("construir_app con huella: recompila al cambiar versión aunque exista dist-electron/motor.js, es idempotente y preserva credenciales", () => {
  const env = crearEntorno011();
  try {
    const hashesAntes = hashesDe(env.home);
    const scriptParcheado = path.join(env.dir, "instalar-parcheado.sh");
    escribirEjecutable(scriptParcheado, [
      "set -euo pipefail",
      "FUENTE=\"$1\"",
      "cd",
      "mkdir -p .local/share/trama/app",
      "DEST_APP=\"$(cd .local/share/trama/app && pwd)\"",
      "(cd \"$FUENTE\" && cp -a . \"$DEST_APP\")",
      "huella_app() {",
      "  (",
      "    cd && cd .local/share/trama/app",
      "    [[ -n \"${TRAMA_PAYLOAD_VERSION:-}\" ]] && printf \"payload:%s\\n\" \"$TRAMA_PAYLOAD_VERSION\"",
      "    find package.json src -type f 2>/dev/null | LC_ALL=C sort | xargs -r sha256sum",
      "  ) | sha256sum | cut -c1-16",
      "}",
      "construir_app() {",
      "  cd",
      "  cd .local/share/trama/app",
      "  local h actual",
      "  h=\"$(huella_app)\"",
      "  actual=\"$(cat .build-huella 2>/dev/null || true)\"",
      "  if [[ -f dist-electron/motor.js && -f dist/index.html && \"$actual\" == \"$h\" ]]; then",
      "    return 0",
      "  fi",
      "  local v",
      "  v=\"$(cat src/version.txt)\"",
      "  [[ \"$v\" != \"romper\" ]] || { echo \"error de build\" >&2; return 1; }",
      "  [ -e .build-nuevo ] && rm -r .build-nuevo",
      "  mkdir -p .build-nuevo/dist .build-nuevo/dist-electron",
      "  printf \"<html>ui-%s</html>\\n\" \"$v\" > .build-nuevo/dist/index.html",
      "  printf \"console.log(\\\"motor-%s\\\");\\n\" \"$v\" > .build-nuevo/dist-electron/motor.js",
      "  [ -e .build-viejo ] && rm -r .build-viejo",
      "  mkdir -p .build-viejo",
      "  [ -e dist ] && mv dist .build-viejo/dist",
      "  [ -e dist-electron ] && mv dist-electron .build-viejo/dist-electron",
      "  mv .build-nuevo/dist dist",
      "  mv .build-nuevo/dist-electron dist-electron",
      "  rm -r .build-viejo .build-nuevo",
      "  printf \"%s\\n\" \"$h\" > .build-huella",
      "  echo compilado >> compilaciones.log",
      "}",
      "construir_app",
    ]);

    const f1 = path.join(env.dir, "f-012");
    fs.mkdirSync(path.join(f1, "src"), { recursive: true });
    fs.writeFileSync(path.join(f1, "package.json"), "{\"name\":\"hilos\"}");
    fs.writeFileSync(path.join(f1, "src/version.txt"), "0.1.2\n");

    execFileSync("bash", [scriptParcheado, f1], { env: { ...process.env, HOME: env.home } });
    assert.equal(fs.readFileSync(path.join(env.home, ".local/share/trama/app/dist-electron/motor.js"), "utf8").trim(), "console.log(\"motor-0.1.2\");");

    execFileSync("bash", [scriptParcheado, f1], { env: { ...process.env, HOME: env.home } });
    const comps = fs.readFileSync(path.join(env.home, ".local/share/trama/app/compilaciones.log"), "utf8").trim().split("\n");
    assert.equal(comps.length, 1, "misma huella no vuelve a compilar");

    const fRoto = path.join(env.dir, "f-roto");
    fs.mkdirSync(path.join(fRoto, "src"), { recursive: true });
    fs.writeFileSync(path.join(fRoto, "package.json"), "{\"name\":\"hilos\"}");
    fs.writeFileSync(path.join(fRoto, "src/version.txt"), "romper\n");
    assert.throws(() => execFileSync("bash", [scriptParcheado, fRoto], { env: { ...process.env, HOME: env.home }, stdio: "pipe" }));
    assert.equal(fs.readFileSync(path.join(env.home, ".local/share/trama/app/dist-electron/motor.js"), "utf8").trim(), "console.log(\"motor-0.1.2\");", "un fallo deja el motor 0.1.2 sano");

    assert.deepEqual(hashesDe(env.home), hashesAntes);
  } finally {
    env.limpiar();
  }
});

// La versión no se fija acá: se comprueba la FORMA. Un número exacto obliga a tocar el test en cada
// release y, si alguien se olvida, el rojo no dice nada útil (pasó al publicar la 0.1.3).
test("configuración de release: FeroxShark/trama activa electron-updater y construir.sh la trae por defecto", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_WIN, "package.json"), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "la versión de la carcasa es x.y.z");

  const construir = fs.readFileSync(path.join(REPO_WIN, "scripts/construir.sh"), "utf8");
  assert.match(construir, /TRAMA_GH_OWNER:-FeroxShark/);
  assert.match(construir, /TRAMA_GH_REPO:-trama/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-upd-yml-"));
  try {
    fs.writeFileSync(path.join(dir, "app-update.yml"), "provider: github\nowner: FeroxShark\nrepo: trama\n");
    assert.equal(esDeRelleno(dir), false, "con FeroxShark/trama el actualizador queda activo");

    fs.writeFileSync(path.join(dir, "app-update.yml"), "provider: github\nowner: TRAMA_GH_OWNER\nrepo: TRAMA_GH_REPO\n");
    assert.equal(esDeRelleno(dir), true, "con los valores de relleno queda inactivo");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
