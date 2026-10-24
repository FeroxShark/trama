"use strict";
// La limpieza contra un HOME de mentira: el wsl.exe falso corre el bash de verdad (con un systemctl de mentira),
// así lo que se prueba es el script que correría en Ubuntu. Nada toca el HOME ni el /etc de verdad.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { crearLimpieza } = require("../src/limpieza");
const { ENTRADAS } = require("../src/manifiesto");

const DISTRO = "Ubuntu-24.04";

// Las entradas de verdad, con el motor de WSL dado por muerto desde la 0.2.0 y las rutas absolutas llevadas al HOME de prueba.
function entradasMuertas(raiz = "/nada") {
  return ENTRADAS.map((e) => {
    const r = { ...e };
    if (e.ambito === "wsl" && e.grupo === "motor-wsl") r.hasta = "0.2.0";
    if (e.ambito === "wsl" && typeof e.ruta === "string" && e.ruta.startsWith("/etc/")) r.ruta = `${raiz}${e.ruta}`;
    return r;
  });
}

function entorno(sobre = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trama-limpieza-"));
  const home = path.join(dir, "home");
  const bin = path.join(dir, "bin");
  fs.mkdirSync(home);
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "systemctl"), "#!/bin/sh\necho \"$@\" >> \"$HOME/../systemctl.log\"\n", { mode: 0o755 });
  const e = {
    dir,
    home,
    distros: [DISTRO],
    estado: {},
    llamadas: [],
    wslLlamadas: [],
    win: { carpetas: new Set(), registro: new Set(), borrados: [], regQuitados: [] },
    ...sobre,
  };
  e.store = { cargar: () => ({ ...e.estado }), guardar: (o) => (e.estado = { ...o }) };
  e.wsl = (args, { input = "" } = {}) => {
    e.llamadas.push(args.join(" "));
    if (args[0] === "-l") return Promise.resolve({ code: 0, stdout: e.distros.join("\r\n") + "\r\n", stderr: "" });
    if (args[0] === "--terminate") return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    if (args[0] === "--unregister") {
      e.distros = e.distros.filter((d) => d !== args[1]);
      e.unregistered = (e.unregistered || 0) + 1;
      return Promise.resolve({ code: 0, stdout: "", stderr: "" });
    }
    return new Promise((res) => {
      const p = spawn("bash", ["-s"], { env: { PATH: `${bin}:${process.env.PATH}`, HOME: home } });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d) => (stdout += d));
      p.stderr.on("data", (d) => (stderr += d));
      p.on("close", (code) => res({ code, stdout, stderr }));
      // /home/* del bash de prueba es el de esta máquina: se lo cambia por una carpeta de la prueba.
      p.stdin.end(input.replace("for d in /home/*;", `for d in ${e.dir}/otros/*;`));
    });
  };
  e.win_ = {
    expandir: (r) => r.replace(/%([A-Z]+)%/g, (_m, v) => ({ LOCALAPPDATA: "C:\\Users\\Gonza\\AppData\\Local", APPDATA: "C:\\Users\\Gonza\\AppData\\Roaming", USERPROFILE: "C:\\Users\\Gonza" })[v] || `%${v}%`),
    tipo: async (r) => (e.win.carpetas.has(r) ? "carpeta" : null),
    borrar: async (r) => {
      e.win.borrados.push(r);
      e.win.carpetas.delete(r);
    },
    registro: {
      hay: async (c, v) => e.win.registro.has(`${c}|${v}`),
      quitar: async (c, v) => {
        e.win.regQuitados.push(`${c}|${v}`);
        e.win.registro.delete(`${c}|${v}`);
      },
    },
  };
  e.entradas = () => entradasMuertas(path.join(dir, "raiz"));
  e.limpieza = (v = "0.2.0", entradas = e.entradas()) =>
    crearLimpieza({ wsl: e.wsl, win: e.win_, estado: e.store, version: v, distro: DISTRO, entradas, ahora: () => "2026-10-23T00:00:00Z" });
  e.p = (...a) => path.join(home, ...a);
  e.hay = (r) => { try { fs.lstatSync(e.p(r)); return true; } catch { return false; } };
  e.escribir = (r, txt = "x") => {
    fs.mkdirSync(path.dirname(e.p(r)), { recursive: true });
    fs.writeFileSync(e.p(r), txt);
  };
  e.enlace = (r, destino = "/home/ana/.local/share/trama/app/bin/x") => {
    fs.mkdirSync(path.dirname(e.p(r)), { recursive: true });
    fs.symlinkSync(destino, e.p(r));
  };
  // Lo que deja instalar-producto.sh, más lo de la persona.
  e.instalar = () => {
    for (const b of ["pa", "tablero", "trama-estado", "trama-motor", "proyecto-ruta", "workers"]) e.enlace(`.local/bin/${b}`);
    for (const h of ["latido.sh", "destructive-guard.sh", "statusline-espejo.sh"]) e.enlace(`.claude/hooks/${h}`);
    e.enlace(".claude/skills/trama-orquestar");
    e.enlace(".gemini/config/plugins/pa-worker/pa.json");
    e.escribir(".config/systemd/user/trama-motor.service", "[Service]\n# lo escribió instalar-producto.sh\n");
    e.escribir(".local/share/trama/app/dist/index.js");
    e.escribir(".cache/trama/payload/motor/x");
    e.escribir(".local/share/trama/carcasa-payload", "abc");
    e.escribir(".config/trama/app", "/x");
    e.escribir(".bashrc", "alias ll='ls -l'\n# trama:path\nexport PATH=\"$HOME/.local/bin:$PATH\"\necho hola\n");
    fs.mkdirSync(path.join(dir, "raiz/etc/sudoers.d"), { recursive: true });
    fs.writeFileSync(path.join(dir, "raiz/etc/sudoers.d/90-trama"), "gonza ALL=(ALL) NOPASSWD: ALL\n");
    e.escribir(".claude/settings.json", JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "bash ~/.claude/hooks/destructive-guard.sh" }] }] } }));
  };
  // Lo de la persona: nada de esto puede cambiar.
  e.usuario = () => {
    e.escribir("proyectos/miapp/leeme.md", "mío");
    e.escribir(".config/proyectos/registry.json", '{"projects":[]}');
    e.escribir(".config/trama/modelos.json", "{}");
    e.escribir(".local/state/hilos/lideres.json", "[]");
    e.escribir(".local/state/pa/x/1.sid", "sid");
    e.escribir(".claude/.credentials.json", "secreto");
    e.escribir(".claude.json", "{}");
    e.escribir(".gemini/oauth_creds.json", "secreto");
    e.escribir(".local/bin/claude", "binario");
    e.escribir("CLAUDE.md", "reglas");
  };
  e.limpiar = () => fs.rmSync(dir, { recursive: true, force: true });
  return e;
}

const DE_USUARIO = [
  "proyectos/miapp/leeme.md",
  ".config/proyectos/registry.json",
  ".config/trama/modelos.json",
  ".local/state/hilos/lideres.json",
  ".local/state/pa/x/1.sid",
  ".claude/.credentials.json",
  ".claude.json",
  ".gemini/oauth_creds.json",
  ".local/bin/claude",
  "CLAUDE.md",
];

async function conEntorno(fn, sobre) {
  const e = entorno(sobre);
  try {
    await fn(e);
  } finally {
    e.limpiar();
  }
}

test("con la versión 0.1.0 nada está muerto: el plan viene vacío y no se toca nada", () =>
  conEntorno(async (e) => {
    e.instalar();
    e.usuario();
    const plan = await e.limpieza("0.1.0", ENTRADAS).planificar({ modo: "restos" });
    assert.deepEqual(plan.items, []);
    assert.equal(plan.distro, null);
    assert.ok(e.hay(".local/bin/pa"));
  }));

test("restos: lista lo que la versión nueva dejó de usar, con su ruta y su frase, y no toca nada", () =>
  conEntorno(async (e) => {
    e.instalar();
    e.usuario();
    const plan = await e.limpieza().planificar({ modo: "restos" });
    const ids = plan.items.map((i) => i.id);
    for (const id of ["wsl-bin-pa", "wsl-hook-latido", "wsl-skill-orquestar", "wsl-plugin-gemini", "wsl-hooks-claude", "wsl-unit-motor", "wsl-app-compilada", "wsl-bashrc-path", "wsl-sudoers"]) {
      assert.ok(ids.includes(id), id);
    }
    assert.ok(plan.items.every((i) => i.accion === "quitar" && i.que));
    assert.ok(!ids.some((id) => id.startsWith("wsl-datos") || id === "wsl-logins" || id === "wsl-sistema"));
    assert.ok(e.hay(".local/bin/pa"));
  }));

test("quitar restos borra lo de Trama y deja intacto todo lo de la persona", () =>
  conEntorno(async (e) => {
    e.instalar();
    e.usuario();
    const l = e.limpieza();
    const plan = await l.planificar({ modo: "restos" });
    const { resultados } = await l.ejecutar({ modo: "restos", ids: plan.items.map((i) => i.id) });
    assert.ok(resultados.every((r) => r.estado === "quitado"), JSON.stringify(resultados));
    for (const r of [".local/bin/pa", ".claude/hooks/latido.sh", ".claude/skills/trama-orquestar", ".gemini/config/plugins/pa-worker", ".config/systemd/user/trama-motor.service", ".local/share/trama/app", ".cache/trama/payload", ".config/trama/app", "../raiz/etc/sudoers.d/90-trama"]) {
      assert.ok(!e.hay(r), r);
    }
    for (const r of DE_USUARIO) assert.ok(fs.existsSync(e.p(r)), `se tocó ${r}`);
    assert.equal(fs.readFileSync(e.p(".claude/.credentials.json"), "utf8"), "secreto");
    // el .bashrc de la persona queda con lo suyo y sin el bloque de Trama
    assert.equal(fs.readFileSync(e.p(".bashrc"), "utf8"), "alias ll='ls -l'\necho hola\n");
    assert.match(fs.readFileSync(path.join(e.dir, "systemctl.log"), "utf8"), /disable --now trama-motor/);
    assert.equal(e.estado.limpieza.version, "0.2.0");
    assert.ok(e.estado.limpieza.quitados.includes("wsl-bin-pa"));
    // una segunda pasada ya no encuentra nada
    assert.deepEqual((await l.planificar({ modo: "restos" })).items, []);
  }));

test("un archivo de la persona donde Trama tenía un enlace queda «ajeno» y no se borra", () =>
  conEntorno(async (e) => {
    e.instalar();
    fs.rmSync(e.p(".local/bin/pa"));
    e.escribir(".local/bin/pa", "#!/bin/sh\nmi script\n"); // un archivo, no el enlace nuestro
    fs.rmSync(e.p(".local/bin/tablero"));
    e.enlace(".local/bin/tablero", "/usr/bin/otra-cosa"); // un enlace, pero a otra parte
    e.escribir(".gemini/config/plugins/pa-worker/mio.json", "mío"); // la carpeta del plugin ya tiene algo suyo
    e.escribir(".config/systemd/user/trama-motor.service", "[Service]\nExecStart=/usr/bin/lo-mio\n");
    const l = e.limpieza();
    const plan = await l.planificar({ modo: "restos" });
    const acc = Object.fromEntries(plan.items.map((i) => [i.id, i.accion]));
    assert.equal(acc["wsl-bin-pa"], "ajeno");
    assert.equal(acc["wsl-bin-tablero"], "ajeno");
    assert.equal(acc["wsl-plugin-gemini"], "ajeno");
    assert.equal(acc["wsl-unit-motor"], "ajeno");
    const { resultados } = await l.ejecutar({ modo: "restos", ids: plan.items.map((i) => i.id) });
    const est = Object.fromEntries(resultados.map((r) => [r.id, r.estado]));
    assert.equal(est["wsl-bin-pa"], "ajeno");
    assert.equal(est["wsl-unit-motor"], "ajeno");
    assert.equal(fs.readFileSync(e.p(".local/bin/pa"), "utf8"), "#!/bin/sh\nmi script\n");
    assert.ok(fs.lstatSync(e.p(".local/bin/tablero")).isSymbolicLink());
    assert.ok(fs.existsSync(e.p(".gemini/config/plugins/pa-worker/mio.json")));
    assert.match(fs.readFileSync(e.p(".config/systemd/user/trama-motor.service"), "utf8"), /lo-mio/);
    assert.equal(est["wsl-bin-workers"], "quitado"); // lo que sí era nuestro, se fue
  }));

test("sólo se quita lo que se pidió", () =>
  conEntorno(async (e) => {
    e.instalar();
    const l = e.limpieza();
    const { resultados } = await l.ejecutar({ modo: "restos", ids: ["wsl-bin-pa", "wsl-no-existe"] });
    assert.equal(resultados.find((r) => r.id === "wsl-bin-pa").estado, "quitado");
    assert.equal(resultados.find((r) => r.id === "wsl-no-existe").estado, "omitido");
    assert.ok(e.hay(".local/bin/tablero"));
  }));

test("los ganchos de Claude: se saca el de Trama, se conservan los de la persona y la statusline envuelta vuelve a su comando", () =>
  conEntorno(async (e) => {
    e.instalar();
    const settings = {
      model: "opus",
      hooks: {
        PreToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "bash ~/.claude/hooks/destructive-guard.sh" }, { type: "command", command: "echo mio" }] },
          { matcher: "Edit", hooks: [{ type: "command", command: "bash ~/.claude/hooks/destructive-guard.sh" }] },
        ],
        Stop: [{ hooks: [{ type: "command", command: "echo fin" }] }],
      },
      statusLine: { type: "command", command: 'bash "/home/ana/.claude/hooks/statusline-espejo.sh" bash -c \'mi-statusline --x\'' },
    };
    e.escribir(".claude/settings.json", JSON.stringify(settings));
    const l = e.limpieza();
    const { resultados } = await l.ejecutar({ modo: "restos", ids: ["wsl-hooks-claude"] });
    assert.equal(resultados[0].estado, "quitado");
    const d = JSON.parse(fs.readFileSync(e.p(".claude/settings.json"), "utf8"));
    assert.equal(d.model, "opus");
    assert.equal(d.hooks.PreToolUse.length, 1);
    assert.deepEqual(d.hooks.PreToolUse[0].hooks, [{ type: "command", command: "echo mio" }]);
    assert.equal(d.hooks.Stop[0].hooks[0].command, "echo fin");
    assert.equal(d.statusLine.command, "mi-statusline --x");
    assert.ok(fs.existsSync(e.p(".claude/settings.json.trama-bak-quitar")));
  }));

test("sin ganchos de Trama en settings.json no hay nada que quitar", () =>
  conEntorno(async (e) => {
    e.escribir(".claude/settings.json", '{"model":"opus"}');
    const plan = await e.limpieza().planificar({ modo: "restos" });
    assert.ok(!plan.items.some((i) => i.id === "wsl-hooks-claude"));
  }));

test("sin la distro instalada no hay nada de WSL que mirar y no se corre bash", () =>
  conEntorno(async (e) => {
    const plan = await e.limpieza().planificar({ modo: "restos" });
    assert.deepEqual(plan.items, []);
    assert.equal(plan.distro, null);
    assert.ok(e.llamadas.every((c) => c.startsWith("-l")));
  }, { distros: [] }));

// ---------- la distro ----------

test("la distro que creó Trama y está limpia puede desregistrarse, pero sólo con el nombre escrito", () =>
  conEntorno(async (e) => {
    e.estado = { distroCreada: DISTRO };
    e.instalar();
    const l = e.limpieza();
    const plan = await l.planificar({ modo: "restos" });
    assert.equal(plan.distro.puede, true, JSON.stringify(plan.distro));
    assert.match(plan.distro.pierde, /./);
    const sin = await l.ejecutar({ modo: "restos", ids: ["wsl-distro"] });
    assert.equal(sin.resultados[0].estado, "omitido");
    const mal = await l.ejecutar({ modo: "restos", ids: ["wsl-distro"], confirmarDistro: "ubuntu" });
    assert.equal(mal.resultados[0].estado, "omitido");
    assert.equal(e.unregistered, undefined);
    const bien = await l.ejecutar({ modo: "restos", ids: ["wsl-distro"], confirmarDistro: DISTRO });
    assert.equal(bien.resultados[0].estado, "quitado");
    assert.equal(e.unregistered, 1);
    assert.ok(e.llamadas.some((c) => c.startsWith("--terminate")));
    assert.equal(e.estado.distroCreada, null);
  }));

test("una distro que ya estaba antes de Trama no se desregistra ni con confirmación", () =>
  conEntorno(async (e) => {
    e.instalar(); // distroCreada no está en el estado: no hay prueba de que la haya creado Trama
    const l = e.limpieza();
    const plan = await l.planificar({ modo: "restos" });
    assert.equal(plan.distro.puede, false);
    assert.equal(plan.distro.creada, false);
    assert.match(plan.distro.motivo, /antes de Trama/);
    const r = await l.ejecutar({ modo: "restos", ids: ["wsl-distro"], confirmarDistro: DISTRO });
    assert.equal(r.resultados[0].estado, "ajeno");
    assert.equal(e.unregistered, undefined);
  }));

for (const [nombre, preparar] of [
  ["archivos suyos en el HOME", (e) => e.escribir("tesis.docx", "mi tesis")],
  ["un archivo suyo en ~/.local/bin", (e) => e.escribir(".local/bin/mi-herramienta", "x")],
  ["proyectos registrados", (e) => e.escribir(".config/proyectos/registry.json", '{"projects":[{"name":"a"}]}')],
  ["otro usuario en /home", null],
]) {
  test(`aunque la haya creado Trama, la distro con ${nombre} no se desregistra`, () =>
    conEntorno(async (e) => {
      e.estado = { distroCreada: DISTRO };
      e.instalar();
      if (preparar) preparar(e);
      else {
        fs.mkdirSync(path.join(e.dir, "otros", "marta"), { recursive: true });
      }
      const l = e.limpieza();
      const plan = await l.planificar({ modo: "restos" });
      assert.equal(plan.distro.puede, false);
      assert.ok(plan.distro.ajenos.length > 0);
      const r = await l.ejecutar({ modo: "restos", ids: ["wsl-distro"], confirmarDistro: DISTRO });
      assert.equal(r.resultados[0].estado, "ajeno");
      assert.equal(e.unregistered, undefined);
    }));
}

// ---------- Windows ----------

test("desinstalar: el RunOnce y la caché del actualizador se quitan; los datos de la app sólo si se aceptan", () =>
  conEntorno(async (e) => {
    const cache = "C:\\Users\\Gonza\\AppData\\Local\\trama-windows-updater";
    const datos = "C:\\Users\\Gonza\\AppData\\Roaming\\Trama";
    e.win.carpetas.add(cache);
    e.win.carpetas.add(datos);
    e.win.registro.add("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce|Trama");
    const l = e.limpieza("0.1.0", ENTRADAS);
    const plan = await l.planificar({ modo: "desinstalar" });
    const acc = Object.fromEntries(plan.items.map((i) => [i.id, i.accion]));
    assert.equal(acc["win-runonce"], "quitar");
    assert.equal(acc["win-cache-actualizador"], "quitar");
    assert.equal(acc["win-datos-carcasa"], "datos");
    assert.equal(acc["win-wslconfig"], "queda");
    assert.equal(acc["win-instalacion"], undefined); // la carpeta de instalación la borra NSIS, no nosotros
    // ids pedidos pero sin aceptar los datos: se quedan
    const r1 = await l.ejecutar({ modo: "desinstalar", ids: plan.items.map((i) => i.id) });
    assert.equal(r1.resultados.find((r) => r.id === "win-datos-carcasa").estado, "omitido");
    assert.ok(e.win.carpetas.has(datos));
    assert.ok(!e.win.carpetas.has(cache));
    assert.deepEqual(e.win.regQuitados, ["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce|Trama"]);
    // aceptados explícitamente
    const r2 = await l.ejecutar({ modo: "desinstalar", ids: [], datos: ["win-datos-carcasa"] });
    assert.equal(r2.resultados.find((r) => r.id === "win-datos-carcasa").estado, "quitado");
    assert.ok(!e.win.carpetas.has(datos));
  }));

test("en el modo restos los datos de Windows ni se ofrecen ni se borran, aunque se los pida", () =>
  conEntorno(async (e) => {
    const datos = "C:\\Users\\Gonza\\AppData\\Roaming\\Trama";
    e.win.carpetas.add(datos);
    const entradas = ENTRADAS.map((x) => (x.id === "win-datos-carcasa" ? { ...x, hasta: "0.2.0" } : x));
    const l = e.limpieza("0.2.0", entradas);
    const r = await l.ejecutar({ modo: "restos", ids: ["win-datos-carcasa"], datos: ["win-datos-carcasa"] });
    assert.notEqual(r.resultados.find((x) => x.id === "win-datos-carcasa").estado, "quitado");
    assert.ok(e.win.carpetas.has(datos));
  }));

test("una ruta de Windows con una variable sin expandir no se borra", () =>
  conEntorno(async (e) => {
    e.win_.expandir = (r) => r; // %LOCALAPPDATA% queda tal cual
    e.win.carpetas.add("%LOCALAPPDATA%\\trama-windows-updater");
    const plan = await e.limpieza("0.1.0", ENTRADAS).planificar({ modo: "desinstalar" });
    assert.equal(plan.items.find((i) => i.id === "win-cache-actualizador").accion, "ajeno");
  }));

test("desinstalar con la distro limpia que creó Trama la ofrece; con motor de WSL vivo y todo, lo de la persona queda", () =>
  conEntorno(async (e) => {
    e.estado = { distroCreada: DISTRO };
    e.instalar();
    e.usuario();
    const l = e.limpieza("0.1.0", ENTRADAS);
    const plan = await l.planificar({ modo: "desinstalar" });
    assert.ok(plan.items.some((i) => i.id === "wsl-bin-pa" && i.accion === "quitar"));
    assert.equal(plan.items.filter((i) => i.accion === "queda").some((i) => /claude|gemini/i.test(i.ruta)), true);
    await l.ejecutar({ modo: "desinstalar", ids: plan.items.filter((i) => i.accion === "quitar").map((i) => i.id) });
    for (const r of DE_USUARIO) assert.ok(fs.existsSync(e.p(r)), `se tocó ${r}`);
    assert.equal(e.unregistered, undefined); // sin pedir la distro, queda
  }));

// ---------- después de actualizar ----------

test("después de actualizar: corre una vez por versión y sólo quita lo `auto`", () =>
  conEntorno(async (e) => {
    e.instalar();
    e.usuario();
    const cache = "C:\\Users\\Gonza\\AppData\\Local\\trama-windows-updater";
    e.win.carpetas.add(cache);
    e.win.registro.add("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce|Trama");
    const entradas = e.entradas().map((x) => (x.id === "win-cache-actualizador" || x.id === "win-runonce" ? { ...x, hasta: "0.2.0" } : x));
    const l = e.limpieza("0.2.0", entradas);
    const r = await l.despuesDeActualizar();
    assert.equal(r.hecho, true);
    assert.deepEqual(r.resultados.map((x) => x.id).sort(), ["win-cache-actualizador", "win-runonce"]);
    assert.ok(r.pendientes > 5); // lo del motor de WSL espera al botón
    assert.ok(e.hay(".local/bin/pa"), "lo que pide confirmar no se quita solo");
    assert.equal(e.estado.limpiezaAuto, "0.2.0");
    const otra = await l.despuesDeActualizar();
    assert.equal(otra.hecho, false);
    // una versión nueva vuelve a mirar
    const l3 = e.limpieza("0.3.0", entradas);
    assert.equal((await l3.despuesDeActualizar()).hecho, true);
  }));

test("después de actualizar nunca toca la distro ni los datos, aunque estén marcados como muertos", () =>
  conEntorno(async (e) => {
    e.estado = { distroCreada: DISTRO };
    e.instalar();
    e.win.carpetas.add("C:\\Users\\Gonza\\AppData\\Roaming\\Trama");
    const entradas = e.entradas().map((x) => (x.id === "win-datos-carcasa" ? { ...x, hasta: "0.2.0" } : x));
    await e.limpieza("0.2.0", entradas).despuesDeActualizar();
    assert.equal(e.unregistered, undefined);
    assert.ok(e.win.carpetas.has("C:\\Users\\Gonza\\AppData\\Roaming\\Trama"));
  }));
