// «Empezar con resumen» tras vencer la caché (electron/lider.ts → mandar con `empezar: "resumen"`): el mensaje abre una sesión fresca con el
// relevo compacto. agy sigue en el mismo líder (sesión apartada); Claude, en un líder nuevo con relevo (el origen no se toca). Con el claude y el
// agy falsos. HOME y HILOS_STATE en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entornoTmp, hasta } from "./dsh-ayuda.ts";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const { tmp, home } = entornoTmp("lider-rebob");
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_CLAVES = path.join(tmp, "config", "claves.env");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
process.env.TRAMA_FALSO_LOG = path.join(tmp, "falso.log");
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
process.env.TRAMA_FALSO_MS = "20";

const lider = await import("../electron/lider.ts");
const { dirProyecto } = await import("../electron/lider-arma.ts");
const eventos: { sid: string; e: any }[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  await lider.cerrarTodos(true);
  rmSync(tmp, { recursive: true, force: true });
});

const de = (sid: string, tipo: string) => eventos.filter((x) => x.sid === sid && x.e.tipo === tipo).map((x) => x.e);
const log = () => (existsSync(process.env.TRAMA_FALSO_LOG!) ? readFileSync(process.env.TRAMA_FALSO_LOG!, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
const llamadasAgy = () => log().filter((l) => "prompt" in l);
const llamadasClaude = () => log().filter((l) => !("prompt" in l) && l.args?.includes("--output-format"));
const estado = (...r: string[]) => path.join(process.env.HILOS_STATE!, ...r);
/** La vista: una fila por mensaje ("rol: texto"), con la raya de cambio de motor como "---". */
const vista = async (sid: string) => (await lider.conversacionLider({ sid, n: 200 })).mensajes.map((m: any) => (m.cambio ? "---" : `${m.rol}: ${m.texto}`));
const mensaje = async (sid: string, texto: string) => (await lider.conversacionLider({ sid, n: 200 })).mensajes.find((m: any) => m.texto === texto || (m.rol === "assistant" && m.texto.startsWith(`${texto} (turno`)));

const U = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
/** Un transcript de Claude escrito a mano (el claude falso no escribe ninguno): uuid `U(k+1)` para el turno k. */
function escribirTranscriptClaude(sid: string, turnos: { rol: "user" | "assistant"; texto: string }[], t0 = Date.now() - 3_600_000) {
  const dir = path.join(process.env.CLAUDE_CONFIG_DIR!, "projects", dirProyecto(home));
  mkdirSync(dir, { recursive: true });
  const lineas = turnos.map((t, k) => {
    const base = { uuid: U(k + 1), parentUuid: k ? U(k) : null, sessionId: sid, cwd: home, isSidechain: false, timestamp: new Date(t0 + k * 1000).toISOString() };
    return JSON.stringify(
      t.rol === "user"
        ? { ...base, type: "user", message: { role: "user", content: [{ type: "text", text: t.texto }] } }
        : { ...base, type: "assistant", message: { id: `m${k}`, role: "assistant", model: "claude-opus-5-5", content: [{ type: "text", text: t.texto }], usage: { input_tokens: 10, output_tokens: 5 } } },
    );
  });
  writeFileSync(path.join(dir, `${sid}.jsonl`), lineas.join("\n") + "\n");
}


test("agy: «resumen» sigue en el mismo líder con una sesión fresca de agy y el relevo; sin «empezar» retoma la conversación de siempre", { timeout: 90_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "alfa" });
  await hasta(() => de(sid, "fin").length === 1);
  await lider.mandar({ sid, texto: "beta", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  // Sin elegir resumen: la misma sesión de agy (`--conversation`), sin relevo.
  const n = llamadasAgy().length;
  assert.equal(await lider.mandar({ sid, texto: "gamma", modelo: "gemini-4-argon", effort: "high" }), null);
  await hasta(() => de(sid, "fin").length === 3);
  assert.ok(!/Historial de esta conversación/.test(llamadasAgy()[n]!.prompt));
  // Elegir resumen: el mismo líder (devuelve null), sesión vieja apartada y el relevo con lo hablado, más el mensaje nuevo.
  const m = llamadasAgy().length;
  assert.equal(await lider.mandar({ sid, texto: "delta", modelo: "gemini-4-argon", effort: "high", empezar: "resumen" }), null);
  await hasta(() => de(sid, "fin").length === 4);
  assert.equal(de(sid, "fin")[3].error, null);
  const l = llamadasAgy()[m]!;
  assert.ok(!l.args.includes("--conversation"), "sesión fresca de agy");
  assert.match(l.prompt, /Historial de esta conversación/);
  assert.match(l.prompt, /Ana: alfa/);
  assert.match(l.prompt, /Ana: gamma/);
  assert.match(l.prompt, /Mensaje de [^\n]+:\ndelta/);
  assert.ok(existsSync(estado("gemini", `${sid}.json.previa`)));
  // La vista sigue entera: nada se descarta.
  const v = await vista(sid);
  assert.deepEqual(v.filter((f: string) => f.startsWith("user:")), ["user: alfa", "user: beta", "user: gamma", "user: delta"]);
});

test("Claude: «resumen» abre un líder nuevo con el relevo (sesión fresca, sin --resume) y deja el de origen como estaba", { timeout: 90_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "solo claude" });
  await hasta(() => de(sid, "fin").length === 1);
  escribirTranscriptClaude(sid, [
    { rol: "user", texto: "primeroQX" },
    { rol: "assistant", texto: "respuestaQX" },
    { rol: "user", texto: "segundoQX" },
    { rol: "assistant", texto: "otraQX" },
  ]);
  const k = llamadasClaude().length;
  const nuevo = await lider.mandar({ sid, texto: "seguimos", modelo: "claude-opus-5-5", effort: "high", empezar: "resumen" });
  assert.ok(nuevo && nuevo !== sid, "devuelve el líder nuevo");
  await hasta(() => de(nuevo!, "fin").length === 1);
  const c = llamadasClaude().slice(k).find((x) => x.args.includes("--session-id"))!;
  assert.equal(c.args[c.args.indexOf("--session-id") + 1], nuevo);
  assert.ok(!c.args.includes("--resume") && !c.args.includes("--fork-session"));
  const relevo = readFileSync(c.args[c.args.indexOf("--append-system-prompt-file") + 1], "utf8");
  assert.match(relevo, /Ana: primeroQX/);
  assert.match(relevo, /otraQX/);
  const o = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(o.cortes, undefined);
  assert.equal((await lider.lideresApp()).find((x) => x.sid === nuevo)!.heredado?.de, sid);
  // Un valor raro de `empezar` es un mandar normal.
  assert.equal(await lider.mandar({ sid, texto: "normal", modelo: "claude-opus-5-5", effort: "high", empezar: "ruido" }), null);
});
