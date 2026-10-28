import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { alternar, enmascarar, enmascararArgs, frontmatter, inventario, rutasClaude, type Rutas } from "../electron/conectores-claude.ts";

const escribir = (ruta: string, x: unknown) => {
  mkdirSync(path.dirname(ruta), { recursive: true });
  writeFileSync(ruta, typeof x === "string" ? x : JSON.stringify(x, null, 2));
};

/** Un home inventado con un poco de todo; todo en una carpeta temporal. */
function armar() {
  const raiz = mkdtempSync(path.join(os.tmpdir(), "conectores-"));
  const home = path.join(raiz, "ana");
  const proy = path.join(home, "tienda");
  const plug = path.join(home, ".claude", "plugins", "cache", "mercado", "estilo", "1.0.0");
  const rutas: Rutas = { home, claude: path.join(home, ".claude"), claudeJson: path.join(home, ".claude.json"), registro: path.join(raiz, "registry.json") };
  escribir(rutas.registro, { projects: [{ name: "Tienda", path: proy }] });
  escribir(path.join(rutas.claude, "settings.json"), {
    model: "x",
    enabledPlugins: { "estilo@mercado": true, "graficos@mercado": false },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "bash guardia.sh --api-key=sk-abcdefghijklmnop1234" }] }] },
  });
  escribir(path.join(rutas.claude, "skills", "diseno", "SKILL.md"), "---\nname: diseno\ndescription: >\n  Tarea de diseño\n  de ejemplo.\n---\n# x\n");
  escribir(path.join(rutas.claude, "plugins", "installed_plugins.json"), {
    version: 2,
    plugins: {
      "estilo@mercado": [{ scope: "user", installPath: plug, version: "1.0.0" }],
      "graficos@mercado": [{ scope: "user", installPath: path.join(home, "no-existe"), version: "0.1" }],
    },
  });
  escribir(path.join(plug, ".claude-plugin", "plugin.json"), { name: "estilo", description: "Textos claros", hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node a.js", statusMessage: "Cargando" }] }] } });
  escribir(path.join(plug, "skills", "tono", "SKILL.md"), "---\nname: tono\ndescription: \"Ajusta el tono\"\n---\n");
  escribir(path.join(plug, ".mcp.json"), { mcpServers: { cal: { type: "http", url: "https://mcp.ejemplo.com/x?api_key=SECRETO123", headers: { Authorization: "Bearer SECRETO" } } } });
  escribir(rutas.claudeJson, {
    mcpServers: { archivos: { command: "npx", args: ["-y", "srv", "--token", "TOKEN-REAL-1"], env: { NOTION_TOKEN: "ntn_valorsecreto123456" } } },
    projects: { [proy]: { disabledMcpServers: ["claude.ai Correo"] } },
  });
  escribir(path.join(proy, ".mcp.json"), { mcpServers: { base: { command: "node", args: ["s.js"], env: { DB_PASSWORD: "hunter2" } }, web: { type: "sse", url: "https://web.ejemplo.com/sse" } } });
  escribir(path.join(proy, ".claude", "settings.local.json"), { permissions: { allow: ["x"] }, enabledMcpjsonServers: ["web"] });
  escribir(path.join(proy, ".claude", "skills", "deploy", "SKILL.md"), "---\nname: deploy\ndescription: Publicar la tienda\n---\n");
  return { raiz, home, proy, rutas, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

test("frontmatter: comillas, bloques y continuaciones", () => {
  assert.deepEqual(frontmatter("---\nname: a\ndescription: >\n  uno\n  dos\nother: \"x y\"\n---\ncuerpo"), { name: "a", description: "uno dos", other: "x y" });
  assert.deepEqual(frontmatter("sin frontmatter"), {});
});

test("enmascarar: claves, tokens, bearer y contraseñas en URLs", () => {
  assert.equal(enmascarar("run --api-key=abc123 --x"), "run --api-key=•••• --x");
  assert.equal(enmascarar("https://h/p?token=zzz&ok=1"), "https://h/p?token=••••&ok=1");
  assert.equal(enmascarar("Authorization: Bearer abc.def"), "Authorization: ••••");
  assert.equal(enmascarar("postgres://u:clave@host/db"), "postgres://u:••••@host/db");
  assert.equal(enmascarar("x sk-abcdefghijklmnop1234 y"), "x •••• y");
  assert.deepEqual(enmascararArgs(["-y", "--token", "SECRETO", "ok"]), ["-y", "--token", "••••", "ok"]);
});

test("inventario: skills, plugins, MCP y hooks con su origen, estado y sin secretos", async () => {
  const x = armar();
  try {
    const inv = await inventario(x.rutas);
    const por = (tipo: string, nombre: string) => inv.items.find((i) => i.tipo === tipo && i.nombre === nombre);
    assert.deepEqual(inv.proyectos, [x.proy]);
    assert.equal(por("skill", "diseno")?.descripcion, "Tarea de diseño de ejemplo.");
    assert.equal(por("skill", "deploy")?.origen, "proyecto");
    assert.equal(por("skill", "tono")?.de, "estilo@mercado");
    assert.equal(por("plugin", "estilo")?.activo, true);
    assert.equal(por("plugin", "estilo")?.descripcion, "Textos claros");
    assert.equal(por("plugin", "graficos")?.activo, false);
    assert.equal(por("mcp", "base")?.activo, false);
    assert.equal(por("mcp", "base")?.nota, "sin-aprobar");
    assert.equal(por("mcp", "web")?.activo, true);
    assert.equal(por("mcp", "Correo")?.origen, "claudeai");
    assert.deepEqual(por("mcp", "archivos")?.variables, ["NOTION_TOKEN"]);
    assert.ok(inv.items.some((i) => i.tipo === "hook" && i.origen === "plugin" && i.clase === "SessionStart"));
    const volcado = JSON.stringify(inv);
    for (const s of ["SECRETO", "TOKEN-REAL", "ntn_valor", "hunter2", "sk-abcdefghijklmnop"]) assert.ok(!volcado.includes(s), s);
  } finally {
    x.limpiar();
  }
});

test("alternar: un plugin va a enabledPlugins y un MCP de .mcp.json a settings.local.json, sin tocar lo demás", async () => {
  const x = armar();
  try {
    const inv = await alternar("plugin|graficos@mercado|", true, x.rutas);
    assert.equal(inv.items.find((i) => i.tipo === "plugin" && i.nombre === "graficos")?.activo, true);
    const s = JSON.parse(readFileSync(path.join(x.rutas.claude, "settings.json"), "utf8"));
    assert.equal(s.enabledPlugins["graficos@mercado"], true);
    assert.equal(s.model, "x");
    assert.ok(s.hooks);

    const base = `mcp|proyecto|${x.proy}|base`;
    await alternar(base, true, x.rutas);
    let l = JSON.parse(readFileSync(path.join(x.proy, ".claude", "settings.local.json"), "utf8"));
    assert.deepEqual(l.enabledMcpjsonServers.sort(), ["base", "web"]);
    assert.deepEqual(l.permissions, { allow: ["x"] });
    const apagado = await alternar(`mcp|proyecto|${x.proy}|web`, false, x.rutas);
    l = JSON.parse(readFileSync(path.join(x.proy, ".claude", "settings.local.json"), "utf8"));
    assert.deepEqual(l.enabledMcpjsonServers, ["base"]);
    assert.deepEqual(l.disabledMcpjsonServers, ["web"]);
    assert.equal(apagado.items.find((i) => i.nombre === "web")?.activo, false);
  } finally {
    x.limpiar();
  }
});

test("alternar: rechaza lo que no existe o no se puede cambiar, y un archivo roto no se toca", async () => {
  const x = armar();
  try {
    await assert.rejects(alternar("skill|usuario|diseno", false, x.rutas), /main\.conectoresNoExiste/);
    await assert.rejects(alternar("plugin|nada@x|", true, x.rutas), /main\.conectoresNoExiste/);
    await assert.rejects(alternar("plugin|estilo@mercado|", "si", x.rutas), /main\.conectoresNoExiste/);
    writeFileSync(path.join(x.rutas.claude, "settings.json"), "{ roto");
    await assert.rejects(alternar("plugin|estilo@mercado|", false, x.rutas), /main\.conectoresIlegible/);
    assert.equal(readFileSync(path.join(x.rutas.claude, "settings.json"), "utf8"), "{ roto");
  } finally {
    x.limpiar();
  }
});

test("rutasClaude: en Windows sale de USERPROFILE", () => {
  const r = rutasClaude({ USERPROFILE: "C:\\Users\\ana" }, "win32");
  assert.equal(r.claude, "C:\\Users\\ana\\.claude");
  assert.equal(r.claudeJson, "C:\\Users\\ana\\.claude.json");
});
