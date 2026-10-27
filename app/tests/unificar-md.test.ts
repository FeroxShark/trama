// "Unificar instrucciones": AGENTS.md como fuente única de lo que cualquier modelo sabe del proyecto.
//   - electron/unificar-md.ts (el plan, aplicar con backup y confirmación por huella, editar AGENTS.md) y `pa <proy> --unificar-md [--aplicar]`
//     hacen lo MISMO: los dos corren sobre los mismos proyectos de mentira (sólo CLAUDE.md, CLAUDE+GEMINI distintos, ya unificado, con AGENTS.md…)
//     y dejan los mismos archivos, byte por byte.
//   - `pa` resuelve los `@archivo` al inyectar AGENTS.md/CLAUDE.md a un motor que no es Claude (un nivel, dentro del repo), con tope de 20000
//     caracteres y una nota cuando corta; el líder que no es Claude recibe lo mismo en su prefacio (electron/contexto-local.ts).
//   - Los canales de la app: el slug sale del registry (nada de rutas), y escribir es sólo de la PC (no por la tailnet).
// Todo en un tmp (HOME, estado y registry propios): no toca nada de verdad.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const tmp = mkdtempSync(path.join(os.tmpdir(), "unificar-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const home = path.join(tmp, "home");
const estado = path.join(tmp, "pa");
const shim = path.join(tmp, "shim");
const reg = path.join(home, ".config", "proyectos", "registry.json");
for (const d of [path.dirname(reg), estado, shim, path.join(tmp, "estado-app")]) mkdirSync(d, { recursive: true });
process.env.HILOS_STATE = path.join(tmp, "estado-app");
process.env.HILOS_TAILSCALE ||= "/usr/bin/tailscale";
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.PA_STATE = estado;
process.env.HILOS_PA = path.join(import.meta.dirname, "..", "scripts", "pa-falso.sh");
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_HISTORIAL = "0";
process.env.HILOS_CLAUDE_SETTINGS = path.join(tmp, "claude-settings.json");
process.env.PROYECTOS_REGISTRY = reg;

const um = await import("../electron/unificar-md.ts");
const imp = await import("../electron/instrucciones-md.ts");
const nucleo = await import("../electron/nucleo.ts");
const ctx = await import("../electron/contexto-local.ts");
const { lineasDeCambio } = await import("../src/paneles/unificar-vista.ts");
const { es } = await import("../src/i18n/es.ts");
const { en } = await import("../src/i18n/en.ts");

// --- Proyectos de mentira ------------------------------------------------------------------------------------------------
const C1 = "# Shark\n\nUsar pnpm.\n\n## No tocar\n- vendor/\n";
const G1 = "# Shark (Gemini)\n\n- El micrófono se prueba con pnpm mic:check.\n";
const STUB = imp.MD_STUB + "\n";
type Archivos = Record<string, string | { enlace: string }>;
const ESCENARIOS: Record<string, Archivos> = {
  "solo-claude": { "CLAUDE.md": C1 },
  "claude-gemini-distintos": { "CLAUDE.md": C1, "GEMINI.md": G1 },
  "claude-gemini-iguales": { "CLAUDE.md": C1, "GEMINI.md": C1.replace(/\n/g, "\r\n") },
  "solo-gemini": { "GEMINI.md": G1 },
  "ya-unificado": { "AGENTS.md": "# Reglas\n- tabs\n", "CLAUDE.md": STUB },
  "ya-unificado-gemini": { "AGENTS.md": "# Reglas\n- tabs\n", "CLAUDE.md": "<!-- nota -->\n\n@AGENTS.md\n", "GEMINI.md": "@AGENTS.md" },
  "agents-y-claude-distintos": { "AGENTS.md": "# Reglas\n- tabs\n", "CLAUDE.md": C1 },
  "agents-ya-tiene-claude": { "AGENTS.md": `# Reglas\n\n${C1}\n- tabs\n`, "CLAUDE.md": C1 },
  "agents-sin-claude": { "AGENTS.md": "# Reglas\n- tabs\n" },
  "enlace-a-agents": { "AGENTS.md": "# Reglas\n- tabs\n", "CLAUDE.md": { enlace: "AGENTS.md" } },
  "claude-vacio-con-agents": { "AGENTS.md": "# Reglas\n- tabs\n", "CLAUDE.md": "  \n\n" },
  "nada-de-nada": {},
  "agents-en-blanco": { "AGENTS.md": "\n \n", "CLAUDE.md": C1 },
};

function crear(base: string, nombre: string, archivos: Archivos): string {
  const d = path.join(base, nombre);
  mkdirSync(d, { recursive: true });
  for (const [f, c] of Object.entries(archivos)) {
    if (typeof c === "string") writeFileSync(path.join(d, f), c);
    else symlinkSync(c.enlace, path.join(d, f));
  }
  return d;
}
/** Los tres archivos como están: texto, o null si faltan, o "→ destino" si es un enlace. */
function foto(d: string): Record<string, string | null> {
  return Object.fromEntries(
    ["AGENTS.md", "CLAUDE.md", "GEMINI.md"].map((f) => {
      const p = path.join(d, f);
      if (!existsSync(p) && !(() => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } })()) return [f, null];
      return [f, lstatSync(p).isSymbolicLink() ? `→ ${readlinkSync(p)}` : readFileSync(p, "utf8")];
    }),
  );
}
const slugs = Object.keys(ESCENARIOS);
// Dos copias de cada una: una la unifica la app, otra `pa`; se registran con el mismo nombre cada una en su carpeta.
const dirApp = path.join(tmp, "app");
const dirPa = path.join(tmp, "pa-proyectos");
const registroDe = (base: string) => ({ projects: slugs.map((s) => ({ name: s, path: path.join(base, s) })) });
for (const s of slugs) {
  crear(dirApp, s, ESCENARIOS[s]);
  crear(dirPa, s, ESCENARIOS[s]);
}
writeFileSync(reg, JSON.stringify(registroDe(dirApp)));
const regPa = path.join(tmp, "registry-pa.json");
writeFileSync(regPa, JSON.stringify(registroDe(dirPa)));

function pa(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, {
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: path.join(home, ".config"), PA_STATE: estado, STATE: estado, PROYECTOS_REGISTRY: regPa, PATH: `${MOTOR}/bin:${shim}:${process.env.PATH}`, ...env },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}

test("el plan de la app: qué hace en cada caso, sin escribir nada", async () => {
  const quePasa = async (s: string) => {
    const antes = foto(path.join(dirApp, s));
    const p = await um.planUnificar(path.join(dirApp, s));
    assert.deepEqual(foto(path.join(dirApp, s)), antes, `${s}: el plan no escribe`);
    return p;
  };
  const resumen = (p: Awaited<ReturnType<typeof quePasa>>) => p.acciones.map((a) => `${a.archivo}:${a.que}${a.de ? `:${a.de}` : ""}`);

  assert.deepEqual(resumen(await quePasa("solo-claude")), ["AGENTS.md:crea:CLAUDE.md", "CLAUDE.md:stub"]);
  assert.deepEqual(resumen(await quePasa("claude-gemini-distintos")), ["AGENTS.md:crea:ambos", "CLAUDE.md:stub", "GEMINI.md:stub"]);
  assert.deepEqual(resumen(await quePasa("claude-gemini-iguales")), ["AGENTS.md:crea:iguales", "CLAUDE.md:stub", "GEMINI.md:stub"]);
  assert.deepEqual(resumen(await quePasa("solo-gemini")), ["AGENTS.md:crea:GEMINI.md", "GEMINI.md:stub", "CLAUDE.md:crea-stub"].sort((a, b) => (a.startsWith("AGENTS") ? -1 : b.startsWith("AGENTS") ? 1 : a.localeCompare(b))));
  assert.deepEqual(resumen(await quePasa("agents-y-claude-distintos")), ["AGENTS.md:anexa:CLAUDE.md", "CLAUDE.md:stub"]);
  assert.deepEqual(resumen(await quePasa("agents-ya-tiene-claude")), ["CLAUDE.md:ya-dentro", "CLAUDE.md:stub"]);
  assert.deepEqual(resumen(await quePasa("agents-sin-claude")), ["CLAUDE.md:crea-stub"]);
  assert.deepEqual(resumen(await quePasa("claude-vacio-con-agents")), ["CLAUDE.md:stub"]);
  assert.deepEqual(resumen(await quePasa("agents-en-blanco")), ["AGENTS.md:crea:CLAUDE.md", "CLAUDE.md:stub"]);
  // nada que hacer
  for (const s of ["ya-unificado", "ya-unificado-gemini", "enlace-a-agents"]) {
    const p = await quePasa(s);
    assert.equal(p.nada, "unificado", s);
    assert.deepEqual(p.despues, {}, s);
  }
  assert.equal((await quePasa("nada-de-nada")).nada, "sin-contenido");

  // "distintos": AGENTS.md lleva las dos secciones, con todo el contenido de cada uno
  const d = (await quePasa("claude-gemini-distintos")).despues;
  assert.ok(d["AGENTS.md"]!.includes("## Desde CLAUDE.md") && d["AGENTS.md"]!.includes("## Desde GEMINI.md"));
  assert.ok(d["AGENTS.md"]!.includes(C1.trim()) && d["AGENTS.md"]!.includes(G1.trim()));
  assert.equal(d["CLAUDE.md"], STUB);
  assert.equal(d["GEMINI.md"], STUB);
  // la vista previa trae el antes de cada archivo
  assert.equal((await quePasa("claude-gemini-distintos")).antes["CLAUDE.md"], C1);
  assert.equal((await quePasa("claude-gemini-distintos")).antes["AGENTS.md"], null);
});

test("la app y `pa --unificar-md --aplicar` dejan los mismos archivos, y los dos guardan lo anterior en el backup", async () => {
  for (const s of slugs) {
    const dApp = path.join(dirApp, s);
    const dPa = path.join(dirPa, s);
    const originales = foto(dApp);
    const plan = await um.planUnificar(dApp);
    const r = await um.aplicarUnificar(dApp, path.join(estado, `app-${s}`), plan.huella);
    // pa: primero el plan (no escribe), después aplicar
    const seco = pa([s, "--unificar-md"]);
    assert.equal(seco.rc, 0, `${s}: ${seco.err}`);
    if (plan.nada !== "sin-contenido") assert.match(seco.out, /vista previa, no se escribió nada/, s);
    assert.deepEqual(foto(dPa), originales, `${s}: sin --aplicar no escribe`);
    const ap = pa([s, "--unificar-md", "--aplicar"]);
    assert.equal(ap.rc, 0, `${s}: ${ap.err}`);
    // el mismo resultado, byte por byte
    assert.deepEqual(foto(dPa), foto(dApp), `${s}: pa y la app no coinciden`);
    // el plan de la app dice lo que quedó
    for (const [f, t] of Object.entries(plan.despues)) assert.equal(readFileSync(path.join(dApp, f), "utf8"), t, `${s}/${f}`);
    // nada se pierde: lo que existía y cambió está en el backup, tal cual
    for (const [f, c] of Object.entries(originales)) {
      if (c === null || c.startsWith("→ ") || foto(dApp)[f] === c) continue;
      assert.equal(readFileSync(path.join(r.backup!, f), "utf8"), c, `${s}: backup de la app de ${f}`);
      const dirs = readdirSync(path.join(estado, s, "md-backup"));
      assert.equal(dirs.length, 1, s);
      assert.equal(readFileSync(path.join(estado, s, "md-backup", dirs[0]!, f), "utf8"), c, `${s}: backup de pa de ${f}`);
    }
    // segunda vuelta: ya está unificado, no hay nada que hacer en ninguno de los dos
    assert.equal((await um.planUnificar(dApp)).nada === "unificado" || s === "nada-de-nada", true, s);
    assert.match(pa([s, "--unificar-md"]).out, /Ya está unificado|nada que unificar/, s);
  }
  // spot checks de lo que pasó, con los textos
  const f = (s: string) => foto(path.join(dirApp, s));
  assert.equal(f("solo-claude")["AGENTS.md"], C1);
  assert.equal(f("solo-claude")["CLAUDE.md"], STUB);
  assert.equal(f("claude-gemini-iguales")["AGENTS.md"], C1, "CRLF -> LF y un solo salto final");
  assert.equal(f("agents-ya-tiene-claude")["AGENTS.md"], `# Reglas\n\n${C1}\n- tabs\n`, "no repite lo que ya estaba");
  assert.ok(f("agents-y-claude-distintos")["AGENTS.md"]!.startsWith("# Reglas\n- tabs\n\n\n## Desde CLAUDE.md") || f("agents-y-claude-distintos")["AGENTS.md"]!.startsWith("# Reglas\n- tabs\n\n## Desde CLAUDE.md"));
  assert.ok(f("agents-y-claude-distintos")["AGENTS.md"]!.includes(C1.trim()));
  assert.equal(f("solo-gemini")["CLAUDE.md"], STUB, "Claude Code no lee AGENTS.md solo: se crea el import");
  assert.equal(f("enlace-a-agents")["CLAUDE.md"]?.startsWith("→"), true, "el enlace a AGENTS.md no se toca");
  assert.equal(f("nada-de-nada")["AGENTS.md"], null);
});

test("aplicar pide la huella del plan que se vio: si los archivos cambiaron en el medio, no escribe", async () => {
  const d = crear(path.join(tmp, "huella"), "p", { "CLAUDE.md": C1 });
  const plan = await um.planUnificar(d);
  writeFileSync(path.join(d, "CLAUDE.md"), C1 + "- algo nuevo\n");
  await assert.rejects(um.aplicarUnificar(d, path.join(estado, "huella"), plan.huella), /main\.mdCambio/);
  await assert.rejects(um.aplicarUnificar(d, path.join(estado, "huella"), undefined), /main\.mdCambio/);
  assert.equal(existsSync(path.join(d, "AGENTS.md")), false);
  assert.equal(existsSync(path.join(estado, "huella")), false, "ni siquiera el backup");
  const plan2 = await um.planUnificar(d);
  assert.notEqual(plan2.huella, plan.huella);
  await um.aplicarUnificar(d, path.join(estado, "huella"), plan2.huella);
  assert.equal(readFileSync(path.join(d, "AGENTS.md"), "utf8"), C1 + "- algo nuevo\n");
});

test("un enlace a otra cosa, un archivo enorme o un AGENTS.md que es un enlace no se tocan, y se avisa", async () => {
  const base = path.join(tmp, "raros");
  const d = crear(base, "p", { "AGENTS.md": "# a\n", "CLAUDE.md": { enlace: "../otro.md" }, "GEMINI.md": "x".repeat(1024 * 1024 + 1) });
  writeFileSync(path.join(base, "otro.md"), "otro\n");
  const p = await um.planUnificar(d);
  assert.deepEqual(p.avisos.map((a) => `${a.archivo}:${a.motivo}`).sort(), ["CLAUDE.md:enlace", "GEMINI.md:enorme"]);
  assert.equal(p.nada, "unificado");
  const d2 = crear(base, "q", { "CLAUDE.md": C1 });
  symlinkSync("../otro.md", path.join(d2, "AGENTS.md"));
  const p2 = await um.planUnificar(d2);
  assert.equal(p2.nada, "sin-contenido");
  assert.equal(p2.avisos[0]?.archivo, "AGENTS.md");
  // pa se niega igual
  const regRaros = path.join(tmp, "registry-raros.json");
  writeFileSync(regRaros, JSON.stringify({ projects: [{ name: "p", path: d }, { name: "q", path: d2 }] }));
  const r = pa(["q", "--unificar-md", "--aplicar"], { PROYECTOS_REGISTRY: regRaros });
  assert.notEqual(r.rc, 0, "pa se niega: AGENTS.md es un enlace");
  assert.match(r.err, /AGENTS\.md es un enlace simbólico/);
  assert.equal(foto(d2)["CLAUDE.md"], C1, "no se escribió nada");
  const rp = pa(["p", "--unificar-md", "--aplicar"], { PROYECTOS_REGISTRY: regRaros });
  assert.equal(rp.rc, 0, rp.err);
  assert.match(rp.out, /Ya está unificado/);
});

test("estadoMd: qué hay en cada archivo, cuánto, y si AGENTS.md pasa el tope de los modelos que no son Claude", async () => {
  const largo = crear(path.join(tmp, "estado"), "largo", { "AGENTS.md": "L".repeat(25_000), "CLAUDE.md": STUB });
  const e = await um.estadoMd(largo, {});
  assert.deepEqual(e.archivos.map((a) => `${a.archivo}:${a.tipo}`), ["AGENTS.md:real", "CLAUDE.md:stub", "GEMINI.md:falta"]);
  assert.equal(e.caracteres, 25_000);
  assert.equal(e.tope, 20_000);
  assert.equal(e.truncado, true);
  assert.equal(e.unificado, true);
  assert.equal((await um.estadoMd(largo, { PA_AGENTS_MAX: "30000" })).truncado, false);
  assert.equal((await um.estadoMd(largo, { PA_AGENTS_MAX: "basura" })).tope, 20_000);
  // un CLAUDE.md que es un stub no cuenta como contenido; con imports, se cuenta lo resuelto
  const imp1 = crear(path.join(tmp, "estado"), "imp", { "CLAUDE.md": "# Hola\n@docs/g.md\n" });
  mkdirSync(path.join(imp1, "docs"));
  writeFileSync(path.join(imp1, "docs", "g.md"), "G".repeat(100));
  const e2 = await um.estadoMd(imp1, {});
  assert.equal(e2.archivos[1]!.tipo, "real");
  assert.equal(e2.caracteres, "# Hola\n".length + 100);
  assert.equal(e2.porUnificar, true);
  const sinNada = await um.estadoMd(crear(path.join(tmp, "estado"), "vacio", {}), {});
  assert.deepEqual([sinNada.porUnificar, sinNada.unificado, sinNada.caracteres], [false, false, 0]);
});

test("editar AGENTS.md: guarda con LF y un salto final, deja el backup de la versión anterior y mide contra el tope", async () => {
  const d = crear(path.join(tmp, "editar"), "p", { "AGENTS.md": "uno\n" });
  const est = path.join(estado, "editar-p");
  assert.equal(await um.leerAgents(d), "uno\n");
  const r = await um.guardarAgents(d, est, "dos\r\ntres   \n\n\n");
  assert.deepEqual(r, { caracteres: 8, tope: 20000, truncado: false });
  assert.equal(readFileSync(path.join(d, "AGENTS.md"), "utf8"), "dos\ntres\n");
  const bk = readdirSync(path.join(est, "md-backup"));
  assert.equal(readFileSync(path.join(est, "md-backup", bk[0]!, "AGENTS.md"), "utf8"), "uno\n");
  assert.equal((await um.guardarAgents(d, est, "x".repeat(21_000))).truncado, true);
  // lo igual a lo que hay no hace otro backup; un archivo que no existe se crea; lo que no es texto se rechaza
  await um.guardarAgents(d, est, "x".repeat(21_000));
  assert.ok(readdirSync(path.join(est, "md-backup")).length >= 1);
  const nuevo = crear(path.join(tmp, "editar"), "n", {});
  assert.equal(await um.leerAgents(nuevo), "");
  await um.guardarAgents(nuevo, path.join(estado, "editar-n"), "# nuevo");
  assert.equal(readFileSync(path.join(nuevo, "AGENTS.md"), "utf8"), "# nuevo\n");
  await assert.rejects(um.guardarAgents(d, est, 5), /main\.mdTexto/);
  await assert.rejects(um.guardarAgents(d, est, "y".repeat(400_001)), /main\.mdTexto/);
  assert.equal(existsSync(path.join(d, ".AGENTS.md.trama-" + process.pid + ".tmp")), false);
});

// --- Los imports ---------------------------------------------------------------------------------------------------------

test("esStub y resolverImports: un nivel, dentro de la carpeta, fuera de los bloques de código", async () => {
  assert.equal(imp.esStub(imp.MD_STUB), true);
  assert.equal(imp.esStub("<!-- x -->\n\n  @AGENTS.md  \n"), true);
  assert.equal(imp.esStub("@AGENTS.md\n@AGENTS.md"), true);
  assert.equal(imp.esStub("@AGENTS.md\nusar tabs"), false);
  assert.equal(imp.esStub("@OTRO.md"), false);
  assert.equal(imp.esStub(""), false);
  assert.equal(imp.esStub("<!-- sólo un comentario -->"), false);

  const base = path.join(tmp, "imports");
  const d = crear(base, "p", { "AGENTS.md": "# Reglas\n- tabs\n\n@nivel2.md\n", "nivel2.md": "NIVEL-DOS\n", "g.md": "G1\n@AGENTS.md\n" });
  mkdirSync(path.join(d, "docs"));
  writeFileSync(path.join(d, "docs", "x.md"), "EN-DOCS");
  writeFileSync(path.join(base, "secreto.md"), "SECRETO");
  symlinkSync(path.join(base, "secreto.md"), path.join(d, "enlace-afuera.md"));
  const r = (t: string) => imp.resolverImports(t, d);
  assert.equal(await r("@AGENTS.md"), "# Reglas\n- tabs\n\n@nivel2.md", "un nivel: lo importado no se resuelve de nuevo");
  assert.equal(await r("antes\n  @docs/x.md  \ndespués\n"), "antes\nEN-DOCS\ndespués");
  assert.equal(await r("@g.md"), "G1\n@AGENTS.md", "tampoco hay ciclos");
  assert.equal(await r("@../secreto.md"), "@../secreto.md", "no sale de la carpeta");
  assert.equal(await r("@docs/../../secreto.md"), "@docs/../../secreto.md");
  assert.equal(await r(`@${path.join(base, "secreto.md")}`), `@${path.join(base, "secreto.md")}`, "ni rutas absolutas");
  assert.equal(await r("@~/.ssh/id_rsa"), "@~/.ssh/id_rsa");
  assert.equal(await r("@enlace-afuera.md"), "@enlace-afuera.md", "ni un symlink que sale");
  assert.equal(await r("@no-existe.md"), "@no-existe.md", "lo que no existe queda como estaba");
  assert.equal(await r("@docs"), "@docs", "una carpeta no es un archivo");
  assert.equal(await r("```\n@docs/x.md\n```\n@docs/x.md"), "```\n@docs/x.md\n```\nEN-DOCS", "en un bloque de código es texto");
  assert.equal(await r("mirá @docs/x.md ahora"), "mirá @docs/x.md ahora", "sólo una línea que es un import solo");
  assert.equal(await r("@usuario"), "@usuario");
  // instruccionesDe: AGENTS.md primero (en cualquier carpeta), después CLAUDE.md, y nunca un stub vacío
  const w = crear(base, "wt", { "CLAUDE.md": imp.MD_STUB });
  const i1 = await imp.instruccionesDe([w, d]);
  assert.equal(i1?.archivo, path.join(d, "AGENTS.md"), "el AGENTS.md del tree principal gana al CLAUDE.md-stub del worktree");
  const i2 = await imp.instruccionesDe([w]);
  assert.equal(i2, null, "un stub sin su AGENTS.md no da una instrucción vacía");
  assert.equal(imp.topeAgents({}), 20000);
  assert.equal(imp.topeAgents({ PA_AGENTS_MAX: "500" }), 500);
  assert.equal(imp.topeAgents({ PA_AGENTS_MAX: "0" }), 20000);
});

// --- `pa`: lo que reciben los motores que no son Claude ----------------------------------------------------------------------

const proy = path.join(tmp, "demo");
const stdinFile = path.join(tmp, "stdin");
const argvFile = path.join(tmp, "argv");
mkdirSync(proy, { recursive: true });
const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
git("init", "-q", "-b", "main");
git("commit", "-q", "--allow-empty", "-m", "init");
writeFileSync(
  path.join(shim, "claude"),
  `#!/bin/bash
if [[ "$1" == --version ]]; then echo "9.9.9 (Claude Code)"; exit 0; fi
printf '%s\\0' "$@" > "${argvFile}"
printf '{"type":"result","is_error":false,"result":"RESULTADO: hecho\\\\nARCHIVOS: ninguno\\\\nDECISION: nada\\\\nSIGUE: nada","session_id":"%s","num_turns":2,"duration_ms":1000,"total_cost_usd":0.01}' "$(cat /proc/sys/kernel/random/uuid)"
`,
);
const ocFalso = path.join(tmp, "opencode-falso.sh");
writeFileSync(
  ocFalso,
  `#!/bin/bash
if [[ "$1" == models ]]; then printf 'opencode/beam-free\\nopencode/big-pickle\\n'; exit 0; fi
cat > "${stdinFile}"
echo '{"type":"step_start","sessionID":"ses_falso","part":{}}'
echo '{"type":"text","sessionID":"ses_falso","part":{"text":"RESULTADO: listo\\nARCHIVOS: ninguno\\nDECISION: nada\\nSIGUE: nada"}}'
echo '{"type":"step_finish","sessionID":"ses_falso","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(ocFalso, 0o755);
chmodSync(path.join(shim, "claude"), 0o755);
if (spawnSync("sh", ["-c", "command -v uuidgen"]).status !== 0) {
  writeFileSync(path.join(shim, "uuidgen"), "#!/bin/sh\ncat /proc/sys/kernel/random/uuid\n");
  chmodSync(path.join(shim, "uuidgen"), 0o755);
}
const regDemo = path.join(tmp, "registry-demo.json");
writeFileSync(regDemo, JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
/** Una tarea a un worker de OpenCode (no lee CLAUDE.md): lo que le llegó por stdin. */
function inyeccion(env: Record<string, string> = {}): { prompt: string; err: string } {
  rmSync(stdinFile, { force: true });
  const r = pa(["demo", "--sin-jefe", "-m", "opencode:opencode/big-pickle", "una tarea"], {
    PROYECTOS_REGISTRY: regDemo, TRAMA_MODELOS: path.join(home, "no-hay.json"), TRAMA_CLAVES: path.join(home, "no-hay.env"), REPARTO_STATE: path.join(tmp, "rep"), REPARTO_CLAUDE: "0", PA_REPARTO: "0", HILOS_OPENCODE: ocFalso, ...env,
  });
  assert.equal(r.rc, 0, r.err);
  return { prompt: readFileSync(stdinFile, "utf8"), err: r.err };
}
const limpiarProy = () => {
  for (const f of ["AGENTS.md", "CLAUDE.md", "GEMINI.md", "docs", "secreto.md", "enlace.md"]) rmSync(path.join(proy, f), { recursive: true, force: true });
};
/** El bloque INSTRUCCIONES del prompt: de su encabezado hasta la TAREA. */
const bloque = (prompt: string) => /\n\nINSTRUCCIONES \(([^)]*\/(?:AGENTS|CLAUDE)\.md)[^)]*\):\n([\s\S]*?)\n\nTAREA:/.exec(prompt);

test("pa: un CLAUDE.md que es un stub (`@AGENTS.md`) nunca da una inyección vacía; AGENTS.md sin commitear del tree principal alcanza", () => {
  limpiarProy();
  writeFileSync(path.join(proy, "CLAUDE.md"), imp.MD_STUB + "\n");
  writeFileSync(path.join(proy, "AGENTS.md"), "AGENTS-REGLAS: corré pnpm test\n");
  const a = inyeccion();
  const b = bloque(a.prompt);
  assert.ok(b, a.prompt);
  assert.equal(b![2], "AGENTS-REGLAS: corré pnpm test");
  assert.match(b![1]!, /AGENTS\.md$/);
  // sin AGENTS.md pero con un CLAUDE.md que lo importa de otro lado (un nivel, dentro del repo)
  rmSync(path.join(proy, "AGENTS.md"));
  mkdirSync(path.join(proy, "docs"));
  writeFileSync(path.join(proy, "docs", "guia.md"), "GUIA-EN-DOCS: usar tabs\n@nivel-tres.md\n");
  writeFileSync(path.join(proy, "CLAUDE.md"), "# Proyecto\n@docs/guia.md\n\n```\n@docs/guia.md\n```\n");
  const c = bloque(inyeccion().prompt)!;
  assert.equal(c[2], "# Proyecto\nGUIA-EN-DOCS: usar tabs\n@nivel-tres.md\n\n```\n@docs/guia.md\n```", "un nivel, y no dentro de un bloque de código");
  // lo mismo que arma la app para el líder: byte por byte
  return imp.leerResuelto(path.join(proy, "CLAUDE.md")).then((t) => assert.equal(t, c[2]));
});

test("pa: no resuelve imports que salen del repo (`..`, absolutos, `~`, symlinks)", () => {
  limpiarProy();
  writeFileSync(path.join(tmp, "secreto-fuera.md"), "SECRETO-FUERA");
  symlinkSync(path.join(tmp, "secreto-fuera.md"), path.join(proy, "enlace.md"));
  writeFileSync(path.join(proy, "CLAUDE.md"), `# Hola\n@../secreto-fuera.md\n@${path.join(tmp, "secreto-fuera.md")}\n@~/.bashrc\n@enlace.md\n@no-existe.md\n`);
  const p = inyeccion().prompt;
  assert.doesNotMatch(p, /SECRETO-FUERA\b(?!\.md)/);
  assert.ok(!p.includes("SECRETO-FUERA\n") && !p.includes("SECRETO-FUERA\\n"));
  assert.match(p, /@\.\.\/secreto-fuera\.md/);
  assert.match(p, /@enlace\.md/);
  assert.match(p, /@no-existe\.md/);
});

test("pa: sin PA_AGENTS_MAX el tope es de 20000 caracteres, y cuando corta lo dice en el bloque, en el encabezado y por stderr", () => {
  limpiarProy();
  writeFileSync(path.join(proy, "AGENTS.md"), "A".repeat(19_990) + "B".repeat(10) + "FIN-QUE-NO-ENTRA".repeat(100));
  const r = inyeccion();
  const b = bloque(r.prompt)!;
  assert.ok(b[2]!.includes("A".repeat(19_990) + "B".repeat(10)), "los primeros 20000 entran");
  assert.ok(!b[2]!.includes("FIN-QUE-NO-ENTRA"), "lo demás no");
  assert.match(b[2]!, /\[… truncado: .*AGENTS\.md tiene 21600 caracteres y acá van sólo los primeros 20000 \(tope PA_AGENTS_MAX\); leé el resto con Read/);
  assert.match(r.prompt, /INSTRUCCIONES \(.*AGENTS\.md; OJO: truncado a los primeros 20000 de 21600 caracteres\)/);
  assert.match(r.err, /AGENTS\.md tiene 21600 caracteres y los modelos que no son Claude reciben sólo los primeros 20000/);
  // si cabe, ni nota ni aviso; con PA_AGENTS_MAX más alto tampoco corta
  writeFileSync(path.join(proy, "AGENTS.md"), "C".repeat(15_000));
  const cabe = inyeccion();
  assert.doesNotMatch(cabe.prompt, /truncado/);
  assert.doesNotMatch(cabe.err, /truncado|reciben sólo/);
  writeFileSync(path.join(proy, "AGENTS.md"), "D".repeat(21_000));
  assert.doesNotMatch(inyeccion({ PA_AGENTS_MAX: "30000" }).prompt, /truncado/);
  // el tope cuenta el texto ya con los imports resueltos
  writeFileSync(path.join(proy, "docs.md"), "E".repeat(30_000));
  writeFileSync(path.join(proy, "AGENTS.md"), "@docs.md\n");
  assert.match(inyeccion().prompt, /truncado a los primeros 20000 de 30000 caracteres/);
  rmSync(path.join(proy, "docs.md"));
  limpiarProy();
});

test("pa: después de unificar, el motor que no es Claude recibe lo mismo que tenía el CLAUDE.md original", () => {
  limpiarProy();
  writeFileSync(path.join(proy, "CLAUDE.md"), C1);
  const antes = bloque(inyeccion().prompt)![2];
  const u = pa(["demo", "--unificar-md", "--aplicar"], { PROYECTOS_REGISTRY: regDemo });
  assert.equal(u.rc, 0, u.err);
  assert.equal(readFileSync(path.join(proy, "CLAUDE.md"), "utf8"), STUB);
  const despues = bloque(inyeccion().prompt)!;
  assert.equal(despues[2], antes);
  assert.match(despues[1]!, /AGENTS\.md$/);
  // Claude, en cambio, sigue leyendo CLAUDE.md (con su import): el contrato no lleva AGENTS.md aparte
  limpiarProy();
});

// --- El líder que no es Claude ---------------------------------------------------------------------------------------------

test("el prefacio de un líder de Gemini / dsh / opencode lleva el AGENTS.md del proyecto (con los imports resueltos), sin repetirlo", async () => {
  const casa = path.join(tmp, "casa-lider");
  const p = crear(casa, "mi-proyecto", { "AGENTS.md": "AGENTS-DEL-LIDER: usar pnpm\n", "CLAUDE.md": imp.MD_STUB + "\n" });
  mkdirSync(path.join(casa, ".claude"), { recursive: true });
  const g = await ctx.prefacioGemini({ home: casa, cwd: p });
  assert.ok(g.startsWith(ctx.PROMPT_GEMINI.split("\n")[0]!));
  assert.equal(g.split("AGENTS-DEL-LIDER: usar pnpm").length - 1, 1, "una sola vez (el CLAUDE.md lo trae por el import)");
  for (const motor of ["dsh", "opencode"] as const) {
    const d = await ctx.prefacioDsh({ home: casa, cwd: p, motor, modelo: "x/y" });
    assert.match(d, /AGENTS-DEL-LIDER: usar pnpm/, motor);
  }
  // sin unificar: el CLAUDE.md y el AGENTS.md aparte, los dos
  const p2 = crear(casa, "otro", { "AGENTS.md": "AGENTS-APARTE\n", "CLAUDE.md": "CLAUDE-PROPIO\n" });
  const g2 = await ctx.prefacioGemini({ home: casa, cwd: p2 });
  assert.match(g2, /CLAUDE-PROPIO/);
  assert.match(g2, /AGENTS\.md de .*otro.*\n.*AGENTS-APARTE|AGENTS-APARTE/);
  // un stub sin su AGENTS.md no rompe ni inventa nada
  const p3 = crear(casa, "huerfano", { "CLAUDE.md": imp.MD_STUB + "\n" });
  assert.doesNotMatch(await ctx.prefacioGemini({ home: casa, cwd: p3 }), /AGENTS-DEL-LIDER/);
  // un import desde el CLAUDE.md del proyecto (otro archivo en su carpeta)
  const p4 = crear(casa, "con-import", { "CLAUDE.md": "# C\n@reglas.md\n", "reglas.md": "REGLAS-IMPORTADAS\n" });
  assert.match(await ctx.prefacioDsh({ home: casa, cwd: p4, motor: "dsh" }), /REGLAS-IMPORTADAS/);
  // cwd fuera de ~: su CLAUDE.md es el único, y también lleva su AGENTS.md
  const fuera = crear(path.join(tmp, "fuera-de-casa"), "p", { "AGENTS.md": "AGENTS-FUERA\n" });
  assert.match(await ctx.prefacioGemini({ home: casa, cwd: fuera }), /AGENTS-FUERA/);
});

// --- Los canales de la app ---------------------------------------------------------------------------------------------------

test("canales: el slug sale del registry (nada de rutas), escribir es sólo de la PC y leer sí se puede por la tailnet", async () => {
  nucleo.armarNucleo();
  const fn = (c: string) => new Map(nucleo.manejadoresAnotados()).get(c)!;
  for (const c of ["orq:mdAplicar", "orq:mdFusionar", "orq:agentsGuardar", "proyectos:renombrar"]) assert.ok(nucleo.SOLO_PC_TAILNET.has(c), c);
  for (const c of ["orq:mdEstado", "orq:mdPlan", "orq:agentsLeer", "proyectos:lista"]) assert.ok(!nucleo.SOLO_PC_TAILNET.has(c), c);
  const contrato = readFileSync(path.join(import.meta.dirname, "..", "electron", "maquinas-contrato.ts"), "utf8");
  for (const c of ["orq:mdEstado", "orq:mdPlan", "orq:mdAplicar", "orq:mdFusionar", "orq:agentsLeer", "orq:agentsGuardar", "proyectos:lista", "proyectos:renombrar"]) {
    assert.match(contrato, new RegExp(`"${c}": "local"`), c);
    assert.ok(new Map(nucleo.manejadoresAnotados()).has(c), c);
  }
  const s = "solo-claude"; // registrado en el registry de la app (dirApp)
  const huella = ((await nucleo.llamarRemoto("orq:mdPlan", [s], "cel")) as { huella: string }).huella;
  await assert.rejects(nucleo.llamarRemoto("orq:mdAplicar", [s, huella], "cel"), /main\.soloPc/);
  await assert.rejects(nucleo.llamarRemoto("orq:agentsGuardar", [s, "x"], "cel"), /main\.soloPc/);
  await assert.rejects(nucleo.llamarRemoto("orq:mdFusionar", [s], "cel"), /main\.soloPc/);
  await assert.rejects(nucleo.llamarRemoto("proyectos:renombrar", [s, "Otro"], "cel"), /main\.soloPc/);
  assert.equal(existsSync(path.join(dirApp, s, "AGENTS.md")), true, "este escenario ya se unificó arriba; nada nuevo se escribió por la red");
  // lo que no es un slug del registry se rechaza, sea ruta, salida de la carpeta o desconocido
  for (const malo of ["../x", "/etc", path.join(dirApp, s), "no-existe", "", null, 3, "a/b"]) {
    for (const canal of ["orq:mdEstado", "orq:mdPlan", "orq:agentsLeer"]) await assert.rejects(fn(canal)({ sender: {} }, malo), /main\.proyectoRaro/, `${canal}(${String(malo)})`);
    await assert.rejects(fn("orq:agentsGuardar")({ sender: {} }, malo, "x"), /main\.proyectoRaro/);
    await assert.rejects(fn("orq:mdAplicar")({ sender: {} }, malo, "h"), /main\.proyectoRaro/);
    await assert.rejects(fn("orq:mdFusionar")({ sender: {} }, malo), /main\.proyectoRaro/);
  }
  // la ventana sí: aplicar sobre otro escenario, con backup en la carpeta de estado de pa
  const ventana = { sender: {} };
  rmSync(path.join(dirApp, "agents-sin-claude", "CLAUDE.md"), { force: true });
  const plan = (await fn("orq:mdPlan")(ventana, "agents-sin-claude")) as { huella: string; nada: string | null };
  assert.equal(plan.nada, null);
  const ap = (await fn("orq:mdAplicar")(ventana, "agents-sin-claude", plan.huella)) as { backup: string; escritos: string[] };
  assert.deepEqual(ap.escritos, ["CLAUDE.md"]);
  assert.ok(ap.backup.startsWith(path.join(estado, "agents-sin-claude", "md-backup")));
  assert.equal(readFileSync(path.join(dirApp, "agents-sin-claude", "CLAUDE.md"), "utf8"), STUB);
  const g = (await fn("orq:agentsGuardar")(ventana, "agents-sin-claude", "nuevo texto")) as { caracteres: number };
  assert.equal(g.caracteres, "nuevo texto\n".length - 1);
  assert.equal(await fn("orq:agentsLeer")(ventana, "agents-sin-claude"), "nuevo texto\n");
  // renombrar desde la ventana: escribe `titulo` en el registry y listarlo lo trae
  const l = (await fn("proyectos:renombrar")(ventana, "agents-sin-claude", "Sin Claude")) as { titulo: string; slug: string };
  assert.deepEqual([l.titulo, l.slug], ["Sin Claude", "agents-sin-claude"]);
  const lista = (await nucleo.llamarRemoto("proyectos:lista", [], "cel")) as { slug: string; titulo: string | null }[];
  assert.equal(lista.find((p) => p.slug === "agents-sin-claude")?.titulo, "Sin Claude");
});

// --- La vista previa y los textos ------------------------------------------------------------------------------------------

test("lineasDeCambio: un archivo nuevo es todo +, un reemplazo trae − y +, y lo largo se resume", () => {
  const nuevo = lineasDeCambio(null, "a\nb\nc\n");
  assert.deepEqual(nuevo.lineas.map((l) => (l.signo === "…" ? "…" : `${l.signo}${l.texto}`)), ["+a", "+b", "+c"]);
  assert.deepEqual([nuevo.quita, nuevo.pone], [0, 3]);
  const stub = lineasDeCambio(C1, STUB);
  assert.ok(stub.quita >= 5 && stub.pone === 2);
  assert.equal(stub.lineas[0]!.signo, "−");
  assert.equal(stub.lineas.at(-1)!.signo, "+");
  // anexar: sólo lo que se agrega, con una línea de contexto
  const anexa = lineasDeCambio("uno\ndos\n", "uno\ndos\n\n## Desde CLAUDE.md\n\nx\n");
  assert.deepEqual(anexa.lineas.map((l) => (l.signo === "…" ? "…" : `${l.signo}${l.texto}`)), [" dos", "+", "+## Desde CLAUDE.md", "+", "+x"]);
  const largo = lineasDeCambio(null, Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n"), 10);
  assert.equal(largo.lineas.length, 11);
  assert.deepEqual(largo.lineas.at(-1), { signo: "…", n: 30 });
  assert.deepEqual(lineasDeCambio("igual\n", "igual\n").lineas, []);
});

test("i18n: cada acción del plan y cada aviso tienen texto en los dos idiomas", () => {
  const claves = [
    "pry.um.crea.CLAUDE.md", "pry.um.crea.GEMINI.md", "pry.um.crea.iguales", "pry.um.crea.ambos", "pry.um.anexa.CLAUDE.md", "pry.um.anexa.GEMINI.md",
    "pry.um.stub", "pry.um.crea-stub", "pry.um.ya-dentro", "pry.um.aviso.enlace", "pry.um.aviso.enorme", "pry.um.aviso.no-archivo",
    "pry.um.nada.unificado", "pry.um.nada.sin-contenido", "pry.md.falta", "pry.md.vacio", "pry.md.stub", "pry.md.real", "pry.md.otro", "pry.md.larga", "ag.unificar", "ag.unificarQue",
  ];
  for (const k of claves) {
    assert.ok(k in es && k in en, k);
  }
  assert.match(es["pry.md.larga"], /Claude/);
  assert.match(en["pry.md.larga"], /non-Claude/);
});
