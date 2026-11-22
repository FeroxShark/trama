// El contexto de Ana para un líder local: los CLAUDE.md sin lo del jefe, el índice de memoria y los hooks de arranque, con tope.
// Todo en una carpeta temporal y un hook de mentira: ni GPU, ni el `tablero` ni el `~` de verdad.
import { test } from "node:test";
import { soloPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { argvLider } from "../electron/lider-arma.ts";
import { armarContexto, carpetasDe, hooksDeArranque, memoriaDe, prefacioGemini, PROMPT_GEMINI, recortar, sinSecciones, skillOrquestar, textoDeHook, tokensDe, topeParaCtx } from "../electron/contexto-local.ts";
import { tokensAprox } from "../electron/contexto-sesion.ts";
process.env.TRAMA_DUENO = "Ana"; // los títulos del contexto nombran al dueño: aquí es siempre el mismo

const MD = `# Asistente

Intro.

## Trato
- corto

## Jefe (sesión en \`~\`)
- delegás con pa
### Sub del jefe
- más pa

## Pendientes: \`tablero\`
- tablero listar

\`\`\`
## Jefe dentro de una cerca
\`\`\`

## Modelos: se elige por situación
| a | b |

## Seguridad
- cuidado
`;

test("sinSecciones: saca Jefe y Modelos (con sus subsecciones) y deja lo demás, también lo que sigue", () => {
  const s = sinSecciones(MD);
  assert.match(s, /Intro/);
  assert.match(s, /## Trato/);
  assert.match(s, /## Pendientes/);
  assert.match(s, /## Seguridad/);
  assert.match(s, /Jefe dentro de una cerca/, "un # dentro de una cerca no es un encabezado");
  assert.doesNotMatch(s, /delegás|Sub del jefe|más pa|Modelos|\| a \| b \|/);
});

test("recortar y tokens: corta en una línea y dice dónde está el archivo entero", () => {
  assert.equal(tokensDe, tokensAprox);
  assert.equal(tokensDe("a".repeat(84_000)), 24_000);
  const largo = Array.from({ length: 200 }, (_, i) => `línea ${i}`).join("\n");
  const r = recortar(largo, 50, "/x/CLAUDE.md");
  assert.ok(tokensDe(r) <= 50);
  assert.match(r, /recortado.*\/x\/CLAUDE\.md/);
  assert.equal(recortar("corto", 50, "/x"), "corto");
  assert.equal(topeParaCtx(32768), 8192);
  assert.equal(topeParaCtx(262144), 15000);
});

test("carpetasDe y memoriaDe: de ~ hacia el cwd, y la memoria con la regla de Claude Code", { skip: soloPosix("hook y carpetas de Linux (bash, ~/.claude)") }, () => {
  assert.deepEqual(carpetasDe("/h", "/h"), ["/h"]);
  assert.deepEqual(carpetasDe("/h", "/h/a/b"), ["/h", "/h/a", "/h/a/b"]);
  assert.deepEqual(carpetasDe("/h", "/otro/lado"), ["/otro/lado"]);
  assert.equal(memoriaDe("/home/ana", "/home/ana"), "/home/ana/.claude/projects/-home-ana/memory/MEMORY.md");
  assert.equal(memoriaDe("/home/ana", "/home/ana/.local/x"), "/home/ana/.claude/projects/-home-ana--local-x/memory/MEMORY.md");
});

test("hooksDeArranque y textoDeHook: sólo SessionStart, con su matcher; JSON o texto", async () => {
  const set = JSON.stringify({
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "a" }] },
        { matcher: "startup|resume", hooks: [{ type: "command", command: "b" }, { type: "otro", command: "x" }] },
        { matcher: "compact", hooks: [{ type: "command", command: "c" }] },
      ],
      PreCompact: [{ hooks: [{ type: "command", command: "d" }] }],
    },
  });
  assert.deepEqual(await hooksDeArranque("/h", async () => set), ["a", "b"]);
  assert.deepEqual(await hooksDeArranque("/h", async () => null), []);
  assert.deepEqual(await hooksDeArranque("/h", async () => "{roto"), []);
  assert.equal(textoDeHook(" hola \n"), "hola");
  assert.equal(textoDeHook(JSON.stringify({ hookSpecificOutput: { additionalContext: "ctx" } })), "ctx");
});

async function casa() {
  const home = await mkdtemp(path.join(os.tmpdir(), "ctx-local-"));
  await mkdir(path.join(home, ".claude", "projects", "-"), { recursive: true });
  await writeFile(path.join(home, ".claude", "CLAUDE.md"), "# Globales\n- usar la skill X\n");
  await writeFile(path.join(home, "CLAUDE.md"), MD);
  await writeFile(
    path.join(home, ".claude", "settings.json"),
    JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `printf 'Tablero en %s:\\n' "$(basename "$PWD")"; cat >/dev/null; echo "PA_WORKER=[$PA_WORKER]"` }] }] } }),
  );
  return home;
}

test("armarContexto en ~: globales + CLAUDE.md sin jefe + hook + memoria; nada de workers ni de la tabla de modelos", { skip: soloPosix("hook y carpetas de Linux (bash, ~/.claude)") }, async () => {
  const home = await casa();
  try {
    const memo = memoriaDe(home, home);
    await mkdir(path.dirname(memo), { recursive: true });
    await writeFile(memo, "- [Trato](trato.md) — breve\n");
    const c = await armarContexto({ home, ctx: 32768, env: { PATH: process.env.PATH, PA_WORKER: "1" } });
    assert.match(c.texto, /usar la skill X/);
    assert.match(c.texto, /## Trato/);
    assert.match(c.texto, /tablero listar/);
    assert.match(c.texto, new RegExp(`Tablero en ${path.basename(home)}:`), "el hook corre en el cwd");
    assert.match(c.texto, /PA_WORKER=\[\]/, "al hook no le llega PA_WORKER (se saltearía el tablero)");
    assert.match(c.texto, /\[Trato\]\(trato\.md\)/);
    assert.doesNotMatch(c.texto, /delegás|Modelos: se elige|\| a \| b \|/);
    assert.deepEqual(c.partes.map((p) => p.titulo.split(" (")[0]), ["Reglas globales de Ana", "CLAUDE.md de ~", "Tablero y estado al arrancar", "Memoria sobre Ana"]);
    assert.ok(c.tokens > 0 && c.tokens < topeParaCtx(32768));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("armarContexto en un proyecto: suma su CLAUDE.md con lo que queda del tope, y lo recorta", { skip: soloPosix("hook y carpetas de Linux (bash, ~/.claude)") }, async () => {
  const home = await casa();
  try {
    const proy = path.join(home, "Proyectos", "uno");
    await mkdir(proy, { recursive: true });
    await writeFile(path.join(proy, "CLAUDE.md"), Array.from({ length: 5000 }, (_, i) => `regla número ${i} del proyecto`).join("\n"));
    const c = await armarContexto({ home, cwd: proy, ctx: 32768 });
    const p = c.partes.at(-1)!;
    assert.match(p.titulo, /CLAUDE\.md de .*uno/);
    assert.equal(p.recortado, true);
    assert.ok(c.tokens <= topeParaCtx(32768), `${c.tokens} > ${topeParaCtx(32768)}`);
    assert.match(c.texto, /Tablero en uno:/, "el hook recibe el cwd del proyecto");
    assert.match(c.texto, /recortado por el tamaño/);
    // Lo importante (trato, seguridad, tablero) está entero aunque el proyecto sea enorme.
    assert.match(c.texto, /## Seguridad/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("armarContexto: sin archivos ni hooks no hay contexto, y un hook que falla no tira nada", async () => {
  const vacio = await armarContexto({ home: "/no/existe", ctx: 32768, deps: { leer: async () => null, hook: async () => "" } });
  assert.equal(vacio.texto, "");
  const roto = await armarContexto({
    home: "/h",
    ctx: 32768,
    deps: { leer: async (r) => (r.endsWith("settings.json") ? JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "x" }] }] } }) : null), hook: async () => Promise.reject(new Error("boom")) },
  });
  assert.equal(roto.texto, "");
});

test("argv local: el contexto va en el prompt de sistema, después del prompt corto", () => {
  const base = { modelo: "modelo-local-ejemplo", effort: "low", sid: "36ac312b-6241-4230-b3b3-c3decacc39c0", nombre: "trama-0a1b", resume: false };
  const a = argvLider({ ...base, local: { url: "http://127.0.0.1:8080", ctx: 32768, contexto: "# Contexto de Ana\n- hola" } });
  const p = a[a.indexOf("--system-prompt") + 1];
  assert.match(p, /tablero listar/);
  assert.match(p, /\n\n# Contexto de Ana\n- hola$/);
  assert.ok(!argvLider({ ...base, modelo: "claude-opus-5-5", effort: "high" }).join(" ").includes("Contexto de Ana"));
});

test("prefacioGemini: las instrucciones de un líder de Gemini más los CLAUDE.md con lo del jefe (`pa`)", async () => {
  const home = await casa();
  try {
    const p = await prefacioGemini({ home, cwd: home });
    assert.ok(p.startsWith(PROMPT_GEMINI));
    assert.match(PROMPT_GEMINI, /`pa`/);
    assert.match(PROMPT_GEMINI, /trama-orquestar/);
    // A diferencia de un local: el Jefe y los Modelos se quedan (es el que delega).
    assert.match(p, /delegás con pa/);
    assert.match(p, /Modelos: se elige por situación/);
    assert.match(p, /usar la skill X/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

/** Una casa de mentira (sin disco ni shell): CLAUDE.md global, settings con un hook de arranque y el índice de memoria. */
function casaFalsa() {
  const home = path.join("fake-home");
  const env = { CLAUDE_CONFIG_DIR: undefined };
  const archivos: Record<string, string> = {
    [path.join(home, ".claude", "CLAUDE.md")]: "# Globales\n- usar la skill X\n",
    [path.join(home, ".claude", "settings.json")]: JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "tablero" }] }] } }),
    [memoriaDe(home, home, env)]: "- [Trato](trato.md) — privado\n",
  };
  return { home, env, deps: { leer: async (f: string) => archivos[f] ?? null, hook: async () => "Tablero en fake-home: 3 pendientes" } };
}

test("memoria compartida: con el interruptor prendido (o sin decirlo) Gemini, DeepSeek, OpenCode y ChatGPT reciben la memoria y la ficha del tablero", async () => {
  const { prefacioDsh } = await import("../electron/contexto-local.ts");
  const { home, env, deps } = casaFalsa();
  const gemini = [await prefacioGemini({ home, cwd: home, env, deps }), await prefacioGemini({ home, cwd: home, env, deps, compartir: true })];
  const otros = await Promise.all((["dsh", "opencode", "codex"] as const).map((motor) => prefacioDsh({ home, cwd: home, env, deps, motor })));
  for (const p of [...gemini, ...otros]) {
    assert.match(p, /## Memoria sobre/);
    assert.match(p, /\[Trato\]\(trato\.md\)/);
    assert.match(p, /## Tablero y estado al arrancar/);
    assert.match(p, /Tablero en fake-home: 3 pendientes/);
    assert.match(p, /usar la skill X/, "los CLAUDE.md siguen");
  }
});

test("memoria compartida: con el interruptor apagado el motor no recibe ni la memoria ni la ficha del tablero, pero sí lo demás", async () => {
  const { prefacioDsh } = await import("../electron/contexto-local.ts");
  const { home, env, deps } = casaFalsa();
  const sin = [
    await prefacioGemini({ home, cwd: home, env, deps, compartir: false }),
    await prefacioDsh({ home, cwd: home, env, deps, motor: "dsh", compartir: false }),
  ];
  for (const p of sin) {
    assert.doesNotMatch(p, /Memoria sobre/);
    assert.doesNotMatch(p, /\[Trato\]\(trato\.md\)/);
    assert.doesNotMatch(p, /Tablero y estado al arrancar/);
    assert.doesNotMatch(p, /3 pendientes/);
    assert.match(p, /usar la skill X/, "los CLAUDE.md siguen");
  }
});

test("armarContexto: `compartir` decide la memoria y los hooks, no el perfil", async () => {
  const { home, env, deps } = casaFalsa();
  const titulos = async (x: object) => (await armarContexto({ home, ctx: 32768, env, deps, ...x })).partes.map((p) => p.titulo.split(" (")[0]);
  assert.ok((await titulos({ perfil: "gemini" })).some((t) => t.startsWith("Memoria sobre")));
  assert.ok((await titulos({})).some((t) => t.startsWith("Tablero y estado")));
  assert.deepEqual((await titulos({ compartir: false })).filter((t) => /^(Memoria|Tablero)/.test(t)), []);
});

test("prefacioGemini: sin archivos queda el de las instrucciones solo", async () => {
  assert.equal(await prefacioGemini({ home: "/no/existe", deps: { leer: async () => null, hook: async () => "" } }), PROMPT_GEMINI);
});

test("prefacioGemini: trae la guía de delegar sin skill, y la ruta de pa sólo si se la pasan absoluta", async () => {
  const deps = { leer: async () => null, hook: async () => "" };
  const sin = await prefacioGemini({ home: "/no/existe", deps });
  assert.match(sin, /pa <proyecto> --tipo/);
  assert.match(sin, /--async/);
  assert.match(sin, /--integrar/);
  assert.doesNotMatch(sin, /command not found/, "sin ruta absoluta no se agrega nada");
  assert.doesNotMatch(await prefacioGemini({ home: "/no/existe", pa: "pa", deps }), /command not found/);
  const con = await prefacioGemini({ home: "/no/existe", pa: "/home/ana/.local/bin/pa", deps });
  assert.ok(con.startsWith(PROMPT_GEMINI));
  assert.match(con, /"pa: command not found".*`\/home\/ana\/\.local\/bin\/pa`/);
});

test("skillOrquestar: la propia de la persona manda; sin ninguna, la genérica del producto", async () => {
  const home = await casa();
  try {
    const skill = (n: string) => mkdir(path.join(home, ".claude", "skills", n), { recursive: true }).then(() => writeFile(path.join(home, ".claude", "skills", n, "SKILL.md"), "x"));
    assert.equal(await skillOrquestar(home), "trama-orquestar", "sin ninguna, la genérica");
    await skill("trama-orquestar");
    assert.equal(await skillOrquestar(home), "trama-orquestar", "sólo la genérica: máquina de producto");
    assert.match(await prefacioGemini({ home, cwd: home }), /skill `trama-orquestar`/);
    await skill("ana-orquestar");
    assert.equal(await skillOrquestar(home), "ana-orquestar", "con las dos, la de la persona");
    const p = await prefacioGemini({ home, cwd: home });
    assert.match(p, /skill `ana-orquestar`/);
    assert.doesNotMatch(p, /trama-orquestar/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("prefacioDsh: lo de Gemini con quién corre y sus herramientas cambiadas; sin archivos queda el prompt solo", async () => {
  const { prefacioDsh, PROMPT_DSH } = await import("../electron/contexto-local.ts");
  assert.match(PROMPT_DSH, /corrés dentro de DeepSeek Harness \(`dsh`\), no como Claude/);
  assert.doesNotMatch(PROMPT_DSH, /Gemini|agy|view_file/);
  assert.match(PROMPT_DSH, /pa <proyecto> --tipo/, "sigue explicando cómo delegar con pa");
  assert.equal(await prefacioDsh({ home: "/no/existe", deps: { leer: async () => null, hook: async () => "" } }), PROMPT_DSH);
  const con = await prefacioDsh({ home: "/no/existe", pa: "/opt/bin/pa", deps: { leer: async () => null, hook: async () => "" } });
  assert.ok(con.includes("`/opt/bin/pa`"));
});

test("prefacioDsh con opencode: dice opencode (no DeepSeek) y el modelo real", async () => {
  const { prefacioDsh, PROMPT_OPENCODE } = await import("../electron/contexto-local.ts");
  assert.match(PROMPT_OPENCODE, /corrés dentro de opencode/);
  assert.doesNotMatch(PROMPT_OPENCODE, /corrés dentro de DeepSeek/);
  const p = await prefacioDsh({ home: "/no/existe", motor: "opencode", modelo: "opencode/glm-5.3-flash-free", deps: { leer: async () => null, hook: async () => "" } });
  assert.match(p, /`opencode\/glm-5\.3-flash-free`/);
});

test("PUENTES-19: un proyecto fuera de ~ usa el tope de proyecto (no el de 4000 tokens de ~) y un AGENTS.md que el recorte dejó afuera va aparte", async () => {
  const archivos: Record<string, string> = {
    [path.join("proj", "CLAUDE.md")]: "intro\n" + "a\n".repeat(17500) + "reglas de agents",
    [path.join("proj", "AGENTS.md")]: "reglas de agents",
  };
  const ctx = await armarContexto({ home: "fake-home", cwd: "proj", ctx: 40000, perfil: "gemini", deps: { leer: async (f: string) => archivos[f] ?? null, hook: async () => "" } } as any);
  const claude = ctx.partes.find((p) => p.titulo === "CLAUDE.md de proj");
  assert.ok(claude && claude.tokens > 4000, JSON.stringify(ctx.partes));
  assert.ok(ctx.partes.some((p) => p.titulo.startsWith("AGENTS.md de proj")), "el AGENTS.md quedó afuera: " + JSON.stringify(ctx.partes));
});

test("CTX-51 correrHook en Windows: el comando de un hook de Trama pasa por cmd /d /s /c sin comillas simples; en Linux, por /bin/sh -c", async () => {
  const { comandoHook } = await import("../electron/cli/hooks.ts");
  const { shellDe } = await import("../electron/procesos.ts");
  const win = comandoHook("latido", "mjs", "C:\\Users\\Ana López\\AppData\\Local\\trama\\app\\hooks", { plataforma: "win32", node: "C:\\Program Files\\trama\\node.exe" });
  const sh = shellDe("sh", win, { ComSpec: "C:\\Windows\\System32\\cmd.exe" }, "win32");
  assert.deepEqual(sh.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(sh.args[3], `"${win}"`);
  assert.ok(!win.includes("'"), win);
  const lin = comandoHook("latido", "mjs", "/home/ana/.claude/hooks", { plataforma: "linux" });
  assert.deepEqual(shellDe("sh", lin, {}, "linux"), { file: "/bin/sh", args: ["-c", lin], verbatim: false });
});
