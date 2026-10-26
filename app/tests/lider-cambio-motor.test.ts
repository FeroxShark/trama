// Seguir una conversación con un modelo de OTRO motor (Claude → Gemini → Claude) por electron/lider.ts, con el claude falso y el agy falso:
// el mismo líder (mismo sid), una sesión nueva del motor que toca con lo hablado como relevo, la vista con los dos transcripts y una raya,
// y que al volver a abrir siga la sesión del motor nuevo. HOME y HILOS_STATE en un tmp; nunca el claude ni el agy de verdad.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-cambio-"));
const home = path.join(tmp, "home");
mkdirSync(home, { recursive: true });
writeFileSync(path.join(home, "CLAUDE.md"), "# Reglas de prueba\n\n## Jefe (sesión en `~`)\n- Delegás con `pa <proyecto> \"<tarea>\"`. MARCA-CLAUDE-MD\n");
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "falso.log");
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
process.env.TRAMA_FALSO_MS = "20";

const lider = await import("../electron/lider.ts");
const { dirProyecto } = await import("../electron/lider-arma.ts");
type Ev = { sid: string; e: any };
const eventos: Ev[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(f: () => boolean, ms = 20_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("no pasó a tiempo");
    await espera(20);
  }
}
const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
const log = () => (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const llamadasAgy = () => log().filter((l) => "prompt" in l);

/** Un transcript de Claude escrito a mano (el claude falso no escribe ninguno): turnos de texto, un Bash, un resultado y una imagen. */
function escribirTranscriptClaude(sid: string, turnos: { rol: "user" | "assistant"; texto: string; cmd?: string; imagen?: boolean }[], t0 = Date.now() - 3_600_000) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dirProyecto(home));
  mkdirSync(dir, { recursive: true });
  let padre: string | null = null;
  const lineas: string[] = [];
  turnos.forEach((t, k) => {
    const uuid = `00000000-0000-4000-8000-${String(k + 1).padStart(12, "0")}`;
    const base = { uuid, parentUuid: padre, sessionId: sid, cwd: home, isSidechain: false, timestamp: new Date(t0 + k * 1000).toISOString() };
    if (t.rol === "user") {
      const content: unknown[] = [{ type: "text", text: t.texto }];
      if (t.imagen) content.push({ type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } });
      lineas.push(JSON.stringify({ ...base, type: "user", message: { role: "user", content } }));
    } else {
      const content: unknown[] = [{ type: "text", text: t.texto }];
      if (t.cmd) content.push({ type: "tool_use", id: `tu${k}`, name: "Bash", input: { command: t.cmd } });
      lineas.push(JSON.stringify({ ...base, type: "assistant", message: { id: `m${k}`, role: "assistant", model: "claude-opus-5-5", content, usage: { input_tokens: 10, output_tokens: 5 } } }));
      if (t.cmd) {
        const u2 = `00000000-0000-4000-9000-${String(k + 1).padStart(12, "0")}`;
        lineas.push(JSON.stringify({ ...base, uuid: u2, parentUuid: uuid, type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tu${k}`, content: "RESULTADO-SECRETO-DE-LA-HERRAMIENTA" }] } }));
        padre = u2;
        return;
      }
    }
    padre = uuid;
  });
  writeFileSync(path.join(dir, `${sid}.jsonl`), lineas.join("\n") + "\n");
}

test("Claude → Gemini: el mismo líder sigue con una sesión nueva de agy que recibe lo hablado (sin lo que devolvieron las herramientas), con el prefacio de líder", { timeout: 90_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "arranco con claude" });
  await hasta(() => de(sid, "fin").length === 1);
  escribirTranscriptClaude(sid, [
    { rol: "user", texto: "Quiero ordenar mis fotos", imagen: true },
    { rol: "assistant", texto: "Dale, miro la carpeta", cmd: "ls ~/fotos\nsegunda línea" },
    { rol: "assistant", texto: "Hay 120 archivos" },
    { rol: "user", texto: "gracias" },
  ]);
  const antes = (await lider.lideresApp()).find((g) => g.sid === sid)!;
  assert.equal(antes.cambios, undefined);

  await lider.mandar({ sid, texto: "seguí vos", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  assert.equal(de(sid, "fin")[1].error, null);

  const l = llamadasAgy().at(-1)!;
  assert.match(l.prompt, /líder de Trama/, "el rol de líder de Gemini se conserva");
  assert.match(l.prompt, /MARCA-CLAUDE-MD/);
  assert.match(l.prompt, /Historial de esta conversación/);
  assert.match(l.prompt, /Ana: Quiero ordenar mis fotos \[imagen\]/, "las imágenes de turnos viejos quedan como [imagen]");
  assert.match(l.prompt, /Asistente \(claude-opus-5-5\): Dale, miro la carpeta\n\[corrió: ls ~\/fotos\]/, "una herramienta es una línea con el comando corto");
  assert.match(l.prompt, /Ana: gracias/);
  assert.ok(!l.prompt.includes("RESULTADO-SECRETO"), "no se vuelcan los resultados de las herramientas");
  assert.match(l.prompt, /Mensaje de [^\n]+:\nseguí vos/);
  assert.ok(l.prompt.indexOf("Quiero ordenar") < l.prompt.indexOf("gracias"), "lo más nuevo al final");

  // El mismo líder: mismo sid, fila y modelo nuevo, con el cambio anotado.
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.modelo, "gemini-4-argon");
  assert.equal(g.cambios?.length, 1);
  assert.equal(g.cambios![0].de, "claude-opus-5-5");
  assert.equal(g.cambios![0].a, "gemini-4-argon");
  assert.equal((await lider.lideresApp()).filter((x) => x.sid === sid).length, 1);
  // Y queda en disco para el próximo arranque de trama.
  assert.equal(JSON.parse(readFileSync(path.join(process.env.HILOS_STATE!, "lideres.json"), "utf8")).lideres.find((x: any) => x.sid === sid).cambios.length, 1);
  assert.equal(await lider.transcriptDe(sid), path.join(process.env.HILOS_STATE!, "gemini", `${sid}.jsonl`));

  // La vista: lo de Claude, la raya y lo de Gemini.
  const pag = await lider.conversacionLider({ sid, n: 100 });
  const filas = pag.mensajes.map((m: any) => (m.cambio ? `--- ${m.cambio.modelo}` : `${m.rol}: ${m.texto}`));
  const k = filas.findIndex((f: string) => f.startsWith("---"));
  assert.ok(k > 0, JSON.stringify(filas));
  assert.equal(filas[k], "--- gemini-4-argon");
  assert.ok(filas.slice(0, k).some((f: string) => f.includes("Quiero ordenar mis fotos")));
  assert.ok(filas.slice(0, k).some((f: string) => f.includes("Hay 120 archivos")));
  assert.ok(filas.slice(k + 1).some((f: string) => f === "user: seguí vos"));
  assert.ok(filas.slice(k + 1).some((f: string) => f.includes("eco: ")));
  assert.ok(pag.mensajes.slice(0, k).every((m: any) => !m.uuid), "volver atrás es de la sesión de ahora: las de otro motor no llevan uuid");
  assert.ok(pag.mensajes[k].ts, "la raya lleva la hora del cambio");
});

test("al reabrir, la conversación sigue la sesión de agy nueva (--conversation) y sin repetir el relevo", { timeout: 60_000 }, async () => {
  const sid = (await lider.lideresApp()).find((g) => g.cambios?.length)!.sid;
  const n = llamadasAgy().length;
  await lider.cerrarTodos(false);
  await lider.mandar({ sid, texto: "otra cosa", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 3);
  const l = llamadasAgy()[n]!;
  assert.ok(l.args.includes("--conversation"), "retoma la conversación de agy del cambio");
  assert.ok(!l.prompt.includes("Historial de esta conversación"), "el relevo va sólo en la sesión nueva");
  assert.equal((await lider.lideresApp()).find((g) => g.sid === sid)!.cambios!.length, 1, "el mismo modelo no agrega cambios");
});

test("Gemini → Claude → vuelta: Claude retoma su propia sesión y su prompt de sistema trae sólo lo que pasó sin él; dos rayas en la vista", { timeout: 60_000 }, async () => {
  const sid = (await lider.lideresApp()).find((g) => g.cambios?.length)!.sid;
  const n = log().length;
  await lider.mandar({ sid, texto: "volvé claude", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 4);
  const c = log().slice(n).find((l) => !("prompt" in l) && l.args.includes("--output-format"))!;
  assert.ok(c.args.includes("--resume"), "Claude ya tenía una sesión en este líder: la retoma");
  const i = c.args.indexOf("--append-system-prompt-file");
  assert.ok(i > 0, "el relevo va en el prompt de sistema, no en la conversación");
  const relevo = readFileSync(c.args[i + 1], "utf8");
  assert.match(relevo, /siguió un rato con `gemini-4-argon` sin vos/);
  assert.match(relevo, /Ana: seguí vos/);
  assert.match(relevo, /Ana: otra cosa/);
  assert.ok(!relevo.includes("Quiero ordenar mis fotos"), "lo que Claude ya tiene en su sesión no se repite");
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.cambios!.length, 2);
  assert.equal(await lider.transcriptDe(sid), path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dirProyecto(home), `${sid}.jsonl`));
  const pag = await lider.conversacionLider({ sid, n: 100 });
  assert.equal(pag.mensajes.filter((m: any) => m.cambio).length, 2);
  const orden = pag.mensajes.map((m: any) => (m.cambio ? "|" : m.texto)).filter((x: string) => x === "|" || /^(Quiero ordenar mis fotos|seguí vos|otra cosa)$/.test(x));
  assert.deepEqual(orden, ["Quiero ordenar mis fotos", "|", "seguí vos", "otra cosa", "|"]);
});

test("Gemini → Claude sin sesión previa de Claude: --session-id, el relevo en un archivo que se pasa en cada arranque", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-3.8-flash", effort: "low", texto: "primero con gemini" });
  await hasta(() => de(sid, "fin").length === 1);
  const n = log().length;
  await lider.mandar({ sid, texto: "ahora claude", modelo: "claude-sonnet-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  const c = log().slice(n).find((l) => !("prompt" in l) && l.args.includes("--output-format"))!;
  assert.ok(c.args.includes("--session-id") && !c.args.includes("--resume"), "Claude abre una sesión con el sid del líder");
  assert.equal(c.args[c.args.indexOf("--session-id") + 1], sid);
  const archivo = c.args[c.args.indexOf("--append-system-prompt-file") + 1];
  assert.equal(archivo, lider.archivoRelevo(sid));
  assert.match(readFileSync(archivo, "utf8"), /Ana: primero con gemini/);
  assert.match(readFileSync(archivo, "utf8"), /Asistente \(gemini-3\.8-flash[^)]*\): eco: primero con gemini/);
  // Trama se reinicia: el próximo arranque de Claude lleva el mismo relevo (su conversación no lo tiene).
  await lider.cerrarTodos(false);
  const m = log().length;
  await lider.mandar({ sid, texto: "y otra vez", modelo: "claude-sonnet-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 3);
  const c2 = log().slice(m).find((l) => !("prompt" in l) && l.args.includes("--output-format"))!;
  assert.equal(c2.args[c2.args.indexOf("--append-system-prompt-file") + 1], archivo);
  // Un líder que nunca cambió de motor no lleva nada de esto.
  const solo = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "solo claude" });
  await hasta(() => de(solo, "fin").length === 1);
  assert.ok(!log().at(-1)!.args.includes("--append-system-prompt-file"));
});

test("el relevo se recorta al tope: entra lo más reciente y se avisa cuántos mensajes se omitieron", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "largo" });
  await hasta(() => de(sid, "fin").length === 1);
  const turnos: { rol: "user" | "assistant"; texto: string }[] = [];
  for (let k = 0; k < 120; k++) turnos.push({ rol: k % 2 ? "assistant" : "user", texto: `mensaje-${String(k).padStart(3, "0")} ${"x".repeat(900)}` });
  escribirTranscriptClaude(sid, turnos);
  await lider.mandar({ sid, texto: "resumí", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  const { prompt } = llamadasAgy().at(-1)!;
  const m = /\(se omitieron (\d+) mensajes anteriores\)/.exec(prompt);
  assert.ok(m, "avisa que se omitieron mensajes");
  assert.ok(Number(m![1]) > 0 && Number(m![1]) < 120);
  assert.ok(prompt.includes("mensaje-119"), "el más reciente entra");
  assert.ok(!prompt.includes("mensaje-000"), "el más viejo se omite");
  const cuerpo = prompt.slice(prompt.indexOf("# Historial de esta conversación"));
  assert.ok(cuerpo.length < 40_000 + 3_000, `el relevo respeta el tope (${cuerpo.length})`);
});

test("retomar un líder cerrado de Gemini eligiendo un modelo de Claude ya no falla: se anota con su motor y el primer mensaje sigue con Claude", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "empieza gemini" });
  await hasta(() => de(sid, "fin").length === 1);
  await lider.cerrar(sid);
  assert.ok(!(await lider.lideresApp()).some((g) => g.sid === sid));
  const r = await lider.retomar({ sid, modelo: "claude-opus-5-5", effort: "high" });
  assert.equal(r.ok, true);
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.match(g.modelo, /^gemini/, "hasta el primer mensaje sigue siendo de su motor");
  await lider.mandar({ sid, texto: "ahora claude", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  assert.equal((await lider.lideresApp()).find((x) => x.sid === sid)!.modelo, "claude-opus-5-5");
  assert.equal((await lider.lideresApp()).find((x) => x.sid === sid)!.cambios?.length, 1);
});
