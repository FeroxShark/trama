import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { inventario, type Rutas } from "../electron/conectores-claude.ts";
import { CATALOGOS_CONOCIDOS, agregarCatalogo, estadoCatalogos, instalarPlugin, normalizarRepo, quitarPlugin, resolverClaude, type DepsPlugins, type Salida } from "../electron/plugins-claude.ts";

const escribir = (ruta: string, x: unknown) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, typeof x === "string" ? x : JSON.stringify(x, null, 2));
};

/** Un home inventado con un catálogo agregado (`anthropic-agent-skills`) y una cuenta de claude.ai sincronizada. */
function armar() {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "plugins-"));
  const home = path.join(raiz, "ana");
  const rutas: Rutas = { home, claude: path.join(home, ".claude"), claudeJson: path.join(home, ".claude.json"), registro: path.join(raiz, "registry.json") };
  const mercado = path.join(rutas.claude, "plugins", "marketplaces", "anthropic-agent-skills");
  escribir(path.join(rutas.claude, "plugins", "known_marketplaces.json"), {
    "anthropic-agent-skills": { source: { source: "github", repo: "anthropics/skills" }, installLocation: mercado },
    "mercado-de-ana": { source: { source: "git", url: "https://git.ejemplo.com/ana/plugins.git" }, installLocation: path.join(rutas.claude, "plugins", "marketplaces", "no-esta") },
    "Mis archivos": { source: { source: "claudeai" }, installLocation: "" },
  });
  escribir(path.join(mercado, ".claude-plugin", "marketplace.json"), {
    name: "anthropic-agent-skills",
    plugins: [
      { name: "example-skills", description: "Ejemplos\n  de skills" },
      { name: "document-skills", description: "Word, Excel, PowerPoint y PDF", category: "documentos" },
      { name: "../malo", description: "no vale" },
      { name: "document-skills", description: "repetido" },
    ],
  });
  escribir(path.join(rutas.claude, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "document-skills@anthropic-agent-skills": [{ scope: "user", installPath: path.join(home, "x"), version: "1" }],
      "example-skills@anthropic-agent-skills": [{ scope: "project", projectPath: path.join(home, "p"), installPath: path.join(home, "y") }],
    },
  });
  const sync = path.join(rutas.claude, "plugins", "synced", "cuenta_1");
  escribir(path.join(sync, "manifest.json"), {
    plugins: [
      { name: "design", description: "Críticas de diseño", version: "0040", marketplaceName: "knowledge-work-plugins", installationPreference: "available" },
      { name: "data", description: "SQL y tableros", version: "0041", marketplaceName: "knowledge-work-plugins" },
      { name: "../escape", description: "no vale" },
    ],
  });
  escribir(path.join(sync, "design.meta.json"), { server_plugin_id: "plugin_x", marketplace_name: "knowledge-work-plugins" });
  escribir(path.join(sync, "design", "skills", "design-critique", "SKILL.md"), "---\nname: design-critique\ndescription: Devolución sobre un diseño\n---\n");
  escribir(path.join(sync, ".marketplaces.json"), { rows: [] });
  const llamadas: { file: string; args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const ok: Salida = { code: 0, stdout: "ok", stderr: "", tiempo: false, noExiste: false };
  let salida: Salida = ok;
  const deps: DepsPlugins = {
    env: { HILOS_CLAUDE: "/falso/claude", PATH: "/usr/bin", ANTHROPIC_API_KEY: "no", CLAUDE_CODE_X: "1" },
    home,
    plat: "linux",
    rutas,
    cuentas: () => [{ id: "segunda", dir: path.join(raiz, "cuentas", "segunda") }],
    correr: async (file, args, env) => {
      llamadas.push({ file, args, env });
      return salida;
    },
  };
  return { raiz, rutas, deps, llamadas, fallar: (s: Partial<Salida>) => (salida = { ...ok, ...s }), limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("normalizarRepo: usuario/repo, URL de GitHub y nada raro", () => {
  assert.equal(normalizarRepo("anthropics/skills"), "anthropics/skills");
  assert.equal(normalizarRepo(" https://github.com/anthropics/skills.git/ "), "anthropics/skills");
  assert.equal(normalizarRepo("github.com/ana/mis-plugins"), "ana/mis-plugins");
  for (const malo of ["", "skills", "--flag/x", "a/b/c", "a/..", "../x/y", "a b/c", "a/b;rm", "http://x.com/a/b", 5, null]) assert.equal(normalizarRepo(malo), null, String(malo));
});

test("estadoCatalogos: los dos oficiales siempre, plugins sin repetidos ni nombres raros, instalados del usuario", async () => {
  const a = armar();
  try {
    const e = await estadoCatalogos(a.deps);
    assert.deepEqual(e.cuentas, ["segunda"]);
    assert.deepEqual(e.catalogos.map((c) => [c.id, c.repo, c.agregado, c.conocido]), [
      ["anthropic-agent-skills", "anthropics/skills", true, true],
      ["claude-plugins-official", "anthropics/claude-plugins-official", false, true],
      ["mercado-de-ana", "", true, false],
    ]);
    const skills = e.catalogos[0];
    assert.deepEqual(skills.plugins.map((p) => [p.nombre, p.instalado, p.categoria]), [["document-skills", true, "documentos"], ["example-skills", false, ""]]);
    assert.equal(skills.plugins[1].descripcion, "Ejemplos de skills");
    assert.deepEqual(e.catalogos[1].plugins, []);
    assert.equal(CATALOGOS_CONOCIDOS.length, 2);
  } finally {
    a.limpiar();
  }
});

test("estadoCatalogos: sin nada de Claude Code ofrece los oficiales sin agregar", async () => {
  const a = armar();
  try {
    rmSync(path.join(a.rutas.claude, "plugins"), { recursive: true, force: true });
    const e = await estadoCatalogos(a.deps);
    assert.deepEqual(e.catalogos.map((c) => [c.repo, c.agregado]), [["anthropics/skills", false], ["anthropics/claude-plugins-official", false]]);
  } finally {
    a.limpiar();
  }
});

test("agregarCatalogo, instalar y quitar corren `claude plugin …` con los argumentos exactos y sin el entorno de facturación", async () => {
  const a = armar();
  try {
    await agregarCatalogo("https://github.com/anthropics/claude-plugins-official", "", a.deps);
    await instalarPlugin("example-skills", "anthropic-agent-skills", "", a.deps);
    await quitarPlugin("document-skills", "anthropic-agent-skills", "", a.deps);
    assert.deepEqual(a.llamadas.map((l) => [l.file, ...l.args]), [
      ["/falso/claude", "plugin", "marketplace", "add", "anthropics/claude-plugins-official"],
      ["/falso/claude", "plugin", "install", "example-skills@anthropic-agent-skills"],
      ["/falso/claude", "plugin", "uninstall", "document-skills@anthropic-agent-skills"],
    ]);
    for (const l of a.llamadas) {
      assert.equal(l.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(l.env.CLAUDE_CODE_X, undefined);
      assert.equal(l.env.CLAUDE_CONFIG_DIR, undefined);
      assert.equal(l.env.GIT_TERMINAL_PROMPT, "0");
    }
  } finally {
    a.limpiar();
  }
});

test("con una cuenta elegida corre con su CLAUDE_CONFIG_DIR; una cuenta que no existe no corre nada", async () => {
  const a = armar();
  try {
    await instalarPlugin("example-skills", "anthropic-agent-skills", "segunda", a.deps);
    assert.equal(a.llamadas[0].env.CLAUDE_CONFIG_DIR, path.join(a.raiz, "cuentas", "segunda"));
    await assert.rejects(instalarPlugin("example-skills", "anthropic-agent-skills", "otra", a.deps), /main\.pluginsCuenta/);
    await assert.rejects(instalarPlugin("example-skills", "anthropic-agent-skills", "../x", a.deps), /main\.pluginsCuenta/);
    assert.equal(a.llamadas.length, 1);
  } finally {
    a.limpiar();
  }
});

test("nada se corre si el repo, el plugin o el catálogo no valen", async () => {
  const a = armar();
  try {
    await assert.rejects(agregarCatalogo("--version", "", a.deps), /main\.pluginsRepo/);
    await assert.rejects(agregarCatalogo({}, "", a.deps), /main\.pluginsRepo/);
    await assert.rejects(instalarPlugin("no-existe", "anthropic-agent-skills", "", a.deps), /main\.pluginsNoExiste/);
    await assert.rejects(instalarPlugin("example-skills", "claude-plugins-official", "", a.deps), /main\.pluginsNoExiste/);
    await assert.rejects(instalarPlugin("--scope", "anthropic-agent-skills", "", a.deps), /main\.pluginsNoExiste/);
    await assert.rejects(quitarPlugin("example-skills", "anthropic-agent-skills", "", a.deps), /main\.pluginsNoExiste/); // sólo instalado en un proyecto
    assert.equal(a.llamadas.length, 0);
  } finally {
    a.limpiar();
  }
});

test("los fallos de claude se dicen: no está, tardó, o lo último que escribió", async () => {
  const a = armar();
  try {
    a.fallar({ noExiste: true, code: null });
    await assert.rejects(agregarCatalogo("ana/p", "", a.deps), /main\.pluginsSinClaude/);
    a.fallar({ tiempo: true, code: null });
    await assert.rejects(agregarCatalogo("ana/p", "", a.deps), /main\.pluginsTiempo/);
    a.fallar({ code: 1, stderr: "\u001b[31mError: repo not found\u001b[0m\nmás\n" });
    await assert.rejects(agregarCatalogo("ana/p", "", a.deps), (e: Error) => /main\.pluginsFallo/.test(e.message) && /repo not found/.test(e.message) && !e.message.includes("\u001b[31m"));
  } finally {
    a.limpiar();
  }
});

test("resolverClaude: HILOS_CLAUDE, claude.exe del PATH y claude.cmd de npm en Windows", () => {
  assert.equal(resolverClaude({ HILOS_CLAUDE: "/x/claude" }, "/h", () => false, "linux"), "/x/claude");
  assert.equal(resolverClaude({ PATH: "/usr/bin" }, "/h", (f) => f === "/usr/bin/claude", "linux"), "/usr/bin/claude");
  assert.equal(resolverClaude({ PATH: "/usr/bin" }, "/h", () => false, "linux"), "claude");
  const exe = "C:\\Users\\ana\\.local\\bin\\claude.exe";
  assert.equal(resolverClaude({ USERPROFILE: "C:\\Users\\ana" }, "C:\\Users\\ana", (f) => f === exe, "win32"), exe);
  const cmd = "C:\\Users\\ana\\AppData\\Roaming\\npm\\claude.cmd";
  assert.equal(resolverClaude({ APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "C:\\Users\\ana", (f) => f === cmd, "win32"), cmd);
});

test("en Windows un claude.cmd corre por cmd.exe con los argumentos verbatim", async () => {
  const a = armar();
  try {
    const cmd = "C:\\Users\\ana\\AppData\\Roaming\\npm\\claude.cmd";
    await instalarPlugin("example-skills", "anthropic-agent-skills", "", { ...a.deps, plat: "win32", env: { ...a.deps.env, HILOS_CLAUDE: cmd, ComSpec: "C:\\Windows\\System32\\cmd.exe" } });
    const l = a.llamadas[0];
    assert.equal(l.file, "C:\\Windows\\System32\\cmd.exe");
    assert.deepEqual(l.args, ["/d", "/s", "/c", `"${cmd} plugin install example-skills@anthropic-agent-skills"`]);
  } finally {
    a.limpiar();
  }
});

test("con un claude falso de verdad: agrega el catálogo, instala y quita, y lo ve el estado", { skip: process.platform === "win32" }, async () => {
  const a = armar();
  try {
    const falso = path.join(a.raiz, "claude-falso.mjs");
    const log = path.join(a.raiz, "falso.log");
    writeFileSync(
      falso,
      `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const [, , ...a] = process.argv;
appendFileSync(${JSON.stringify(log)}, JSON.stringify(a) + "\\n");
const claude = ${JSON.stringify(a.rutas.claude)};
const leer = (f) => JSON.parse(readFileSync(path.join(claude, "plugins", f), "utf8"));
const poner = (f, x) => writeFileSync(path.join(claude, "plugins", f), JSON.stringify(x));
if (a[0] !== "plugin") process.exit(2);
if (a[1] === "install") {
  const i = leer("installed_plugins.json");
  i.plugins[a[2]] = [{ scope: "user", installPath: "/x", version: "1" }];
  poner("installed_plugins.json", i);
} else if (a[1] === "uninstall") {
  const i = leer("installed_plugins.json");
  delete i.plugins[a[2]];
  poner("installed_plugins.json", i);
} else if (a[1] === "marketplace" && a[2] === "add" && a[3] === "ana/falla") {
  console.error("repositorio no encontrado");
  process.exit(1);
} else if (a[1] === "marketplace" && a[2] === "add") {
  const k = leer("known_marketplaces.json");
  k["claude-plugins-official"] = { source: { source: "github", repo: a[3] }, installLocation: path.join(claude, "plugins", "marketplaces", "oficial") };
  poner("known_marketplaces.json", k);
  mkdirSync(path.join(claude, "plugins", "marketplaces", "oficial", ".claude-plugin"), { recursive: true });
  writeFileSync(path.join(claude, "plugins", "marketplaces", "oficial", ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "claude-plugins-official", plugins: [{ name: "frontend-design", description: "Diseño" }] }));
}
`,
    );
    chmodSync(falso, 0o755);
    const deps: DepsPlugins = { env: { ...process.env, HILOS_CLAUDE: falso }, home: path.dirname(a.rutas.claude), rutas: a.rutas, cuentas: () => [] };
    let e = await agregarCatalogo("anthropics/claude-plugins-official", "", deps);
    assert.deepEqual(e.catalogos.find((c) => c.id === "claude-plugins-official")?.plugins.map((p) => [p.nombre, p.instalado]), [["frontend-design", false]]);
    e = await instalarPlugin("frontend-design", "claude-plugins-official", "", deps);
    assert.equal(e.catalogos.find((c) => c.id === "claude-plugins-official")?.plugins[0].instalado, true);
    e = await quitarPlugin("frontend-design", "claude-plugins-official", "", deps);
    assert.equal(e.catalogos.find((c) => c.id === "claude-plugins-official")?.plugins[0].instalado, false);
    await assert.rejects(agregarCatalogo("ana/falla", "", deps), /repositorio no encontrado/);
    assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).slice(0, 3)), [
      ["plugin", "marketplace", "add"],
      ["plugin", "install", "frontend-design@claude-plugins-official"],
      ["plugin", "uninstall", "frontend-design@claude-plugins-official"],
      ["plugin", "marketplace", "add"],
    ]);
  } finally {
    a.limpiar();
  }
});

test("el inventario suma los plugins sincronizados de claude.ai con su procedencia y sus skills", async () => {
  const a = armar();
  try {
    const inv = await inventario(a.rutas);
    const claudeai = inv.items.filter((x) => x.origen === "claudeai");
    assert.deepEqual(claudeai.map((x) => [x.tipo, x.nombre, x.de, x.activo, x.conmutable, x.nota ?? ""]), [
      ["plugin", "design", "knowledge-work-plugins", true, false, ""],
      ["skill", "design-critique", "design", true, false, ""],
      ["plugin", "data", "knowledge-work-plugins", false, false, "no-instalado"],
    ]);
    assert.equal(claudeai[0].descripcion, "Críticas de diseño");
    assert.ok(!inv.items.some((x) => x.nombre.includes("escape")));
  } finally {
    a.limpiar();
  }
});
