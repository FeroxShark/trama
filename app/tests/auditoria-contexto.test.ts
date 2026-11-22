// «Revisar con IA» del panel Contexto (main): el prompt y el parser de hallazgos, juntar los archivos que se cargan, auditar (sin escribir
// nada y respetando «Memoria compartida») y aplicar con huella, respaldo, CRLF y superposiciones. El revisor es siempre un `correr` simulado.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { aplicarHallazgos, auditar, huellaDe, juntarArchivos, nombreRespaldo, reemplazar, sinDatosPrivados, TOPE_CARACTERES, type CorrerRevisor, type DepsAuditoria } from "../electron/auditoria-contexto.ts";
import { parsearHallazgos, promptAuditor, textoLF } from "../electron/auditoria-contexto-texto.ts";
import { soloPosix } from "./plataforma.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "auditoria-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;

/** Un mundo de mentira: home, carpeta de Claude, proyecto y estado propios. */
function mundo() {
  const raiz = path.join(tmp, `m${++n}`);
  const home = path.join(raiz, "home");
  const claude = path.join(raiz, "claude");
  const proy = path.join(raiz, "proy");
  const estado = path.join(raiz, "estado");
  const mem = path.join(claude, "projects", proy.replace(/[^a-zA-Z0-9]/g, "-"), "memory");
  for (const d of [home, claude, proy, estado, mem]) mkdirSync(d, { recursive: true });
  const env = { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: claude };
  const deps: DepsAuditoria = { env, permitidos: async (ids) => ids, memoriaCompartida: () => true, estadoDe: async () => estado, ahora: () => new Date(2026, 10, 22, 12, 0, 0) };
  return { raiz, home, claude, proy, estado, mem, env, deps };
}
const escribir = (ruta: string, t: string) => writeFileSync(ruta, t);
const respuesta = (hs: object[]) => "Acá va:\n```json\n" + JSON.stringify({ hallazgos: hs }) + "\n```\n";
const correrCon = (salida: string, visto?: { prompt?: string; modelo?: string; cwd?: string; llamadas: number }): CorrerRevisor =>
  (async (modelo: string, _effort: string, prompt: string, cwd?: string) => {
    if (visto) Object.assign(visto, { prompt, modelo, cwd, llamadas: visto.llamadas + 1 });
    return salida;
  }) as CorrerRevisor;
const arbol = (d: string): string[] => readdirSync(d, { recursive: true, withFileTypes: false }).map(String).sort();

// --- Prompt y parser ---------------------------------------------------------------------------------------------------------

test("promptAuditor: cada archivo entre <archivo ruta> y </archivo>, el formato json y los tipos", () => {
  const p = promptAuditor([{ ruta: "/a/CLAUDE.md", texto: "hola\r\nchau" }, { ruta: "/b/MEMORY.md", texto: "x" }]);
  assert.ok(p.includes('<archivo ruta="/a/CLAUDE.md">\nhola\nchau\n</archivo>'));
  assert.ok(p.includes('<archivo ruta="/b/MEMORY.md">\nx\n</archivo>'));
  for (const s of ["```json", '{"hallazgos":[', "duplicado", "contradiccion", "viejo", "largo", "12", "UNA sola vez"]) assert.ok(p.includes(s), s);
});

test("parsearHallazgos: descarta archivo ajeno, buscar no textual, no único, tipo raro; calcula ahorro e ids", () => {
  const archivos = [{ ruta: "/a.md", texto: "uno uno\nregla larga que sobra bastante\nfin\n" }];
  const h = (x: object) => ({ tipo: "largo", archivo: "/a.md", reemplazo: "", razon: "r", ...x });
  const r = parsearHallazgos(
    respuesta([
      h({ buscar: "regla larga que sobra bastante", reemplazo: "regla" }),
      h({ buscar: "esto no está" }),
      h({ buscar: "uno" }),
      h({ buscar: "fin", archivo: "/otro.md" }),
      h({ buscar: "fin", tipo: "inventado" }),
      h({ buscar: "fin" }),
    ]),
    archivos,
  );
  assert.deepEqual(r.map((x) => [x.id, x.buscar, x.estado]), [["h1", "regla larga que sobra bastante", "pendiente"], ["h2", "fin", "pendiente"]]);
  assert.equal(r[0].ahorro, Math.ceil(30 / 3.5) - Math.ceil(5 / 3.5));
  assert.equal(r[0].razon, "r");
});

test("parsearHallazgos: máximo 12, respuesta sin json es []; un buscar con CRLF se normaliza", () => {
  const texto = Array.from({ length: 20 }, (_, i) => `línea única ${i}`).join("\n");
  const hs = Array.from({ length: 20 }, (_, i) => ({ tipo: "viejo", archivo: "/a.md", buscar: `línea única ${i}`, reemplazo: "", razon: "" }));
  assert.equal(parsearHallazgos(respuesta(hs), [{ ruta: "/a.md", texto }]).length, 12);
  assert.deepEqual(parsearHallazgos("no sé qué decir", [{ ruta: "/a.md", texto }]), []);
  const crlf = parsearHallazgos(respuesta([{ tipo: "viejo", archivo: "/a.md", buscar: "uno\r\ndos", reemplazo: "", razon: "" }]), [{ ruta: "/a.md", texto: "uno\r\ndos\r\ntres\r\n" }]);
  assert.equal(crlf.length, 1);
  assert.equal(crlf[0].buscar, "uno\ndos");
});

test("textoLF: CRLF completo se normaliza; un archivo con saltos mezclados se deja", () => {
  assert.deepEqual(textoLF("a\r\nb\r\n"), { texto: "a\nb\n", crlf: true });
  assert.deepEqual(textoLF("a\nb\n"), { texto: "a\nb\n", crlf: false });
  assert.deepEqual(textoLF("a\r\nb\n"), { texto: "a\r\nb\n", crlf: false });
});

test("reemplazar: varios sobre el original de una vez; dos que se pisan, el segundo no entra", () => {
  const lf = "aaa\nbbb\nccc\nddd\n";
  const h = (id: string, buscar: string, reemplazo: string) => ({ id, tipo: "viejo" as const, archivo: "/x", buscar, reemplazo, razon: "", ahorro: 0, estado: "pendiente" as const });
  const r = reemplazar(lf, [h("h1", "bbb", "B"), h("h2", "aaa\nbbb", "otro"), h("h3", "ddd\n", ""), h("h4", "no está", "")]);
  assert.equal(r.texto, "aaa\nB\nccc\n");
  assert.deepEqual([...r.hechos].sort(), ["h1", "h3"]);
});

test("nombreRespaldo: rutas de Linux y de Windows sin separadores ni dos puntos", () => {
  assert.equal(nombreRespaldo("/home/f/.claude/CLAUDE.md"), "home_f_.claude_CLAUDE.md");
  assert.equal(nombreRespaldo("C:\\Users\\f\\.claude\\CLAUDE.md"), "C_Users_f_.claude_CLAUDE.md");
});

test("sinDatosPrivados: claves, mails y teléfonos; deja fechas y números cortos", () => {
  const t = sinDatosPrivados("mail yo@ejemplo.com, tel +54 9 11 5555-1234, ANTHROPIC_API_KEY=sk-ant-abcdefghijkl1234, ghp_abcdefghijklmnop, el 2026-11-22 y v0.3.28, puerto 3000");
  assert.ok(!t.includes("yo@ejemplo.com") && !t.includes("5555-1234") && !t.includes("sk-ant") && !t.includes("ghp_abc"), t);
  assert.ok(t.includes("2026-11-22") && t.includes("v0.3.28") && t.includes("3000"), t);
});

// --- Juntar archivos ---------------------------------------------------------------------------------------------------------

test("juntarArchivos: CLAUDE.md del usuario, los reales del proyecto, MEMORY.md y la carpeta de memoria; el stub no entra", async () => {
  const m = mundo();
  escribir(path.join(m.claude, "CLAUDE.md"), "global\n");
  escribir(path.join(m.proy, "AGENTS.md"), "reglas del proyecto\n");
  escribir(path.join(m.proy, "CLAUDE.md"), "@AGENTS.md\n");
  escribir(path.join(m.mem, "MEMORY.md"), "- [a](a.md)\n");
  escribir(path.join(m.mem, "a.md"), "dato a\n");
  escribir(path.join(m.mem, "nota.txt"), "no es md\n");
  const r = await juntarArchivos(m.proy, { env: m.env });
  assert.deepEqual(r.map((f) => [path.basename(f.ruta), f.memoria]), [["CLAUDE.md", false], ["AGENTS.md", false], ["MEMORY.md", true], ["a.md", true]]);
  assert.equal(r[1].huella, huellaDe("reglas del proyecto\n"));
});

test("juntarArchivos: sin repetidos y con tope total de caracteres", async () => {
  const m = mundo();
  escribir(path.join(m.proy, "CLAUDE.md"), "x".repeat(TOPE_CARACTERES - 10));
  escribir(path.join(m.mem, "MEMORY.md"), "y".repeat(50));
  escribir(path.join(m.mem, "chico.md"), "ok\n");
  const r = await juntarArchivos(m.proy, { env: m.env });
  assert.deepEqual(r.map((f) => path.basename(f.ruta)), ["CLAUDE.md", "chico.md"]);
});

test("juntarArchivos: un enlace simbólico nunca entra, ni su destino por el enlace", { skip: soloPosix("symlinks") }, async () => {
  const m = mundo();
  const real = path.join(m.raiz, "fuera.md");
  escribir(real, "contenido afuera\n");
  symlinkSync(real, path.join(m.proy, "CLAUDE.md"));
  symlinkSync(real, path.join(m.mem, "MEMORY.md"));
  escribir(path.join(m.proy, "AGENTS.md"), "propio\n");
  const r = await juntarArchivos(m.proy, { env: m.env });
  assert.deepEqual(r.map((f) => path.basename(f.ruta)), ["AGENTS.md"]);
});

// --- Auditar -----------------------------------------------------------------------------------------------------------------

test("auditar: devuelve hallazgos validados, guarda la auditoría y no escribe nada en el disco de la persona", async () => {
  const m = mundo();
  escribir(path.join(m.proy, "AGENTS.md"), "regla vieja que ya no vale\nregla buena\n");
  escribir(path.join(m.mem, "MEMORY.md"), "- nota\n");
  const antes = [arbol(m.raiz), readFileSync(path.join(m.proy, "AGENTS.md"), "utf8")];
  const ruta = (await juntarArchivos(m.proy, { env: m.env })).find((f) => f.ruta.endsWith("AGENTS.md"))!.ruta;
  const visto = { llamadas: 0 } as { prompt?: string; modelo?: string; cwd?: string; llamadas: number };
  const a = await auditar({ cwd: m.proy }, correrCon(respuesta([{ tipo: "viejo", archivo: ruta, buscar: "regla vieja que ya no vale", reemplazo: "", razon: "viejo" }, { tipo: "viejo", archivo: ruta, buscar: "inventada", reemplazo: "", razon: "" }]), visto), m.deps);
  assert.equal(a.estado, "lista");
  assert.equal(a.modelo, "claude-haiku-5-5");
  assert.equal(a.hallazgos.length, 1);
  assert.equal(a.hallazgos[0].estado, "pendiente");
  assert.equal(a.archivos.length, 2);
  assert.equal(a.archivos[0].huella, huellaDe("regla vieja que ya no vale\nregla buena\n"));
  assert.ok(visto.prompt?.includes("<archivo ruta=") && visto.cwd === undefined);
  assert.deepEqual([arbol(m.raiz), readFileSync(path.join(m.proy, "AGENTS.md"), "utf8")], antes);
  const { auditoriaDe } = await import("../electron/auditoria-contexto.ts");
  assert.equal(auditoriaDe(m.proy)?.id, a.id);
});

test("auditar: un modelo no permitido se rechaza; sin pedir modelo usa el primero permitido", async () => {
  const m = mundo();
  escribir(path.join(m.proy, "AGENTS.md"), "algo\n");
  const visto = { llamadas: 0 } as { prompt?: string; modelo?: string; cwd?: string; llamadas: number };
  const deps = { ...m.deps, permitidos: async (ids: string[]) => ids.filter((i) => i !== "claude-haiku-5-5") };
  await assert.rejects(auditar({ cwd: m.proy, modelo: "claude-haiku-5-5" }, correrCon("", visto), deps));
  assert.equal(visto.llamadas, 0);
  const a = await auditar({ cwd: m.proy }, correrCon(respuesta([]), visto), deps);
  assert.equal(a.modelo, "claude-sonnet-5-5");
});

test("auditar: con Gemini y «Memoria compartida» apagada la memoria no se manda; encendida va filtrada y el revisor corre en una carpeta vacía", async () => {
  const m = mundo();
  escribir(path.join(m.proy, "AGENTS.md"), "contacto: yo@ejemplo.com\n");
  escribir(path.join(m.mem, "MEMORY.md"), "- secreto de memoria\n");
  const visto = { llamadas: 0 } as { prompt?: string; modelo?: string; cwd?: string; llamadas: number };
  const apagada = await auditar({ cwd: m.proy, modelo: "gemini-3.8-flash" }, correrCon(respuesta([]), visto), { ...m.deps, memoriaCompartida: () => false });
  assert.ok(!visto.prompt?.includes("secreto de memoria") && !visto.prompt?.includes("MEMORY.md"));
  assert.deepEqual(apagada.archivos.map((f) => path.basename(f.ruta)), ["AGENTS.md"]);
  const carpeta = visto.cwd!;
  assert.ok(carpeta && !existsSync(carpeta), "la carpeta vacía se borra al terminar");
  assert.ok(!visto.prompt?.includes("yo@ejemplo.com") && visto.prompt?.includes("[correo]"));
  const prendida = await auditar({ cwd: m.proy, modelo: "gemini-3.8-flash" }, correrCon(respuesta([]), visto), m.deps);
  assert.ok(visto.prompt?.includes("secreto de memoria"));
  assert.equal(prendida.archivos.length, 2);
});

test("auditar con Claude manda la memoria aunque el interruptor de otros motores esté apagado", async () => {
  const m = mundo();
  escribir(path.join(m.mem, "MEMORY.md"), "- dato de memoria\n");
  const visto = { llamadas: 0 } as { prompt?: string; modelo?: string; cwd?: string; llamadas: number };
  await auditar({ cwd: m.proy }, correrCon(respuesta([]), visto), { ...m.deps, memoriaCompartida: () => false });
  assert.ok(visto.prompt?.includes("dato de memoria"));
});

test("auditar: si el revisor falla queda estado error con el texto; sin archivos se rechaza", async () => {
  const m = mundo();
  escribir(path.join(m.proy, "AGENTS.md"), "algo\n");
  const a = await auditar({ cwd: m.proy }, (async () => { throw new Error("boom"); }) as CorrerRevisor, m.deps);
  assert.deepEqual([a.estado, a.error], ["error", "boom"]);
  const vacio = mundo();
  await assert.rejects(auditar({ cwd: vacio.proy }, correrCon(respuesta([])), vacio.deps));
});

// --- Aplicar -----------------------------------------------------------------------------------------------------------------

async function conAuditoria(texto: string, hs: (ruta: string) => object[], crlf = false) {
  const m = mundo();
  const f = path.join(m.proy, "AGENTS.md");
  escribir(f, crlf ? texto.replace(/\n/g, "\r\n") : texto);
  const ruta = (await juntarArchivos(m.proy, { env: m.env }))[0].ruta;
  const a = await auditar({ cwd: m.proy }, correrCon(respuesta(hs(ruta))), m.deps);
  return { m, f, ruta, a };
}
const hall = (ruta: string, buscar: string, reemplazo = "", tipo = "viejo") => ({ tipo, archivo: ruta, buscar, reemplazo, razon: "r" });

test("aplicarHallazgos: uno solo, con respaldo del original en <estado>/md-backup/<marca>/", async () => {
  const { m, f, a } = await conAuditoria("uno\ndos\ntres\n", (r) => [hall(r, "dos\n")]);
  const r = await aplicarHallazgos(a.id, ["h1"], m.deps);
  assert.equal(readFileSync(f, "utf8"), "uno\ntres\n");
  assert.equal(r.hallazgos[0].estado, "aplicado");
  assert.equal(r.respaldo, path.join(m.estado, "md-backup", "20261122-120000"));
  assert.equal(readFileSync(path.join(r.respaldo!, nombreRespaldo(a.archivos[0].ruta)), "utf8"), "uno\ndos\ntres\n");
  assert.equal(r.archivos[0].huella, huellaDe("uno\ntres\n"));
});

test("aplicarHallazgos: varios del mismo archivo de una vez; los no elegidos siguen pendientes y se revalidan", async () => {
  const { m, f, a } = await conAuditoria("aaa\nbbb\nccc\nddd\n", (r) => [hall(r, "aaa\n"), hall(r, "ccc", "C"), hall(r, "bbb\nccc\n", "x\n"), hall(r, "ddd")]);
  assert.equal(a.hallazgos.length, 4);
  const r = await aplicarHallazgos(a.id, ["h1", "h2", "h3"], m.deps);
  assert.equal(readFileSync(f, "utf8"), "bbb\nC\nddd\n");
  assert.deepEqual(r.hallazgos.map((h) => h.estado), ["aplicado", "aplicado", "invalido", "pendiente"]);
  assert.equal(readdirSync(r.respaldo!).length, 1);
});

test("aplicarHallazgos: si el archivo cambió (otra huella) no se escribe nada y sus hallazgos quedan invalido", async () => {
  const { m, f, a } = await conAuditoria("uno\ndos\n", (r) => [hall(r, "dos\n")]);
  escribir(f, "uno\ndos\nagregado a mano\n");
  const r = await aplicarHallazgos(a.id, ["h1"], m.deps);
  assert.equal(readFileSync(f, "utf8"), "uno\ndos\nagregado a mano\n");
  assert.equal(r.hallazgos[0].estado, "invalido");
  assert.equal(r.respaldo, null);
  assert.ok(!existsSync(path.join(m.estado, "md-backup")));
});

test("aplicarHallazgos: conserva CRLF y el respaldo es el original con CRLF", async () => {
  const { m, f, a } = await conAuditoria("uno\ndos\ntres\n", (r) => [hall(r, "uno\ndos", "UNO")], true);
  const r = await aplicarHallazgos(a.id, ["h1"], m.deps);
  assert.equal(readFileSync(f, "utf8"), "UNO\r\ntres\r\n");
  assert.equal(readFileSync(path.join(r.respaldo!, nombreRespaldo(a.archivos[0].ruta)), "utf8"), "uno\r\ndos\r\ntres\r\n");
});

test("aplicarHallazgos: dos aplicaciones en el mismo segundo no pisan el respaldo del original", async () => {
  const { m, f, a } = await conAuditoria("a1\nb2\nc3\n", (r) => [hall(r, "a1\n"), hall(r, "b2\n")]);
  await aplicarHallazgos(a.id, ["h1"], m.deps);
  const r = await aplicarHallazgos(a.id, ["h2"], m.deps);
  assert.equal(readFileSync(f, "utf8"), "c3\n");
  const copias = readdirSync(r.respaldo!).sort().map((n) => readFileSync(path.join(r.respaldo!, n), "utf8"));
  assert.deepEqual(copias, ["a1\nb2\nc3\n", "b2\nc3\n"]);
});

test("aplicarHallazgos: un archivo que ahora es un enlace simbólico no se toca", { skip: soloPosix("symlinks") }, async () => {
  const { m, f, a } = await conAuditoria("uno\ndos\n", (r) => [hall(r, "dos\n")]);
  const destino = path.join(m.raiz, "destino.md");
  escribir(destino, "uno\ndos\n");
  rmSync(f);
  symlinkSync(destino, f);
  const r = await aplicarHallazgos(a.id, ["h1"], m.deps);
  assert.equal(r.hallazgos[0].estado, "invalido");
  assert.equal(readFileSync(destino, "utf8"), "uno\ndos\n");
  assert.ok(lstatSync(f).isSymbolicLink());
});

test("aplicarHallazgos: una auditoría que no existe se rechaza", async () => {
  await assert.rejects(aplicarHallazgos("no-existe", ["h1"], mundo().deps));
});
