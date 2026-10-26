// Volver acá, Editar y Ramificar en líderes que no son de Claude (Gemini, opencode) y en conversaciones que cambiaron de motor
// (electron/lider.ts → rebobinar / ramificar): se sigue con un relevo (la conversación hasta el mensaje, de todos los motores), se aparta la
// sesión del motor, se anota un corte y la vista esconde lo que venía después. El camino de Claude (--resume-session-at / --fork-session) no cambia.
// Con el claude falso, el agy falso y (si hay `opencode`) el opencode contra scripts/openai-falso.mjs. HOME y HILOS_STATE en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { arrancarFalso, entornoTmp, hasta, usuarios } from "./dsh-ayuda.ts";
import { MODELO_FALSO, OPENCODE, SIN_OPENCODE, entornoOpencodeTmp } from "./opencode-ayuda.ts";

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
const falso = SIN_OPENCODE ? null : await arrancarFalso(tmp);
if (falso) Object.assign(process.env, entornoOpencodeTmp(home, falso.baseURL));
process.env.HOME = home;
process.env.HILOS_STATE = path.join(tmp, "estado");
process.env.HILOS_SESIONES = path.join(tmp, "sesiones");
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, "claude");
process.env.TRAMA_MODELOS = path.join(tmp, "no-existe.json");
process.env.TRAMA_CLAVES = path.join(tmp, "config", "claves.env");
process.env.TRAMA_DUENO = "Ana";
process.env.HILOS_CLAUDE = path.join(import.meta.dirname, "..", "scripts", "claude-falso.mjs");
process.env.HILOS_AGY = path.join(import.meta.dirname, "..", "scripts", "agy-falso.mjs");
if (OPENCODE) process.env.HILOS_OPENCODE = OPENCODE;
process.env.TRAMA_FALSO_LOG = path.join(tmp, "falso.log");
process.env.HILOS_PA = path.join(tmp, "fuera-del-path", "pa");
process.env.PATH = [path.dirname(process.execPath), "/usr/bin", "/bin"].join(":");
process.env.TRAMA_FALSO_MS = "20";

const lider = await import("../electron/lider.ts");
const { dirProyecto } = await import("../electron/lider-arma.ts");
const eventos: { sid: string; e: any }[] = [];
lider.alEvento((sid, e) => eventos.push({ sid, e }));
after(async () => {
  falso?.cerrar();
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

test("Gemini: Editar vuelve a antes del mensaje con un relevo, aparta la sesión de agy, corta la vista y deja el transcript; Volver acá encadena otro corte", { timeout: 90_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "uno" });
  await hasta(() => de(sid, "fin").length === 1);
  await lider.mandar({ sid, texto: "segundoXQ", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  await lider.mandar({ sid, texto: "terceroXQ", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 3);
  // Todos los mensajes se pueden señalar, también los de Gemini.
  const dos = await mensaje(sid, "segundoXQ");
  assert.ok(dos.uuid && dos.previo, JSON.stringify(dos));
  assert.ok(existsSync(estado("gemini", `${sid}.json`)));
  const n = llamadasAgy().length;

  // Editar "segundoXQ": sigue desde el mensaje de antes (`previo`) con el texto nuevo.
  assert.equal(await lider.rebobinar({ sid, uuid: dos.previo, texto: "dos-editado", modelo: "gemini-4-argon", effort: "high" }), null);
  await hasta(() => de(sid, "fin").length === 4);
  assert.equal(de(sid, "fin")[3].error, null);
  const l = llamadasAgy()[n]!;
  assert.ok(!l.args.includes("--conversation"), "sesión fresca de agy: no retoma la conversación vieja");
  assert.match(l.prompt, /se volvió atrás/);
  assert.match(l.prompt, /Ana: uno/);
  assert.match(l.prompt, /eco: uno/);
  assert.match(l.prompt, /Mensaje de [^\n]+:\ndos-editado/);
  assert.ok(!l.prompt.includes("segundoXQ") && !l.prompt.includes("terceroXQ"), "lo posterior al punto no llega al modelo");
  // La sesión vieja de agy se aparta; el transcript queda como estaba (con "terceroXQ").
  assert.ok(existsSync(estado("gemini", `${sid}.json.previa`)));
  assert.match(readFileSync(estado("gemini", `${sid}.jsonl`), "utf8"), /eco: terceroXQ/);
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.cortes?.length, 1);
  assert.equal(g.cortes![0].uuid, dos.previo);
  assert.equal(JSON.parse(readFileSync(estado("lideres.json"), "utf8")).lideres.find((x: any) => x.sid === sid).cortes.length, 1, "queda en disco");
  // La vista: lo de antes, y lo nuevo; no lo cortado.
  const v = await vista(sid);
  assert.deepEqual([v[0], v[2]], ["user: uno", "user: dos-editado"]);
  assert.match(v[1], /^assistant: eco: uno/);
  assert.match(v[3], /^assistant: eco: dos-editado/);
  assert.ok(!v.some((f: string) => /terceroXQ|segundoXQ$/.test(f)), JSON.stringify(v));

  // Volver acá, en la respuesta a "uno" (otro corte sobre la vista ya cortada), y seguir.
  const resp = (await lider.conversacionLider({ sid, n: 200 })).mensajes.find((m: any) => m.rol === "assistant" && m.texto.startsWith("eco: uno"));
  await lider.rebobinar({ sid, uuid: resp.uuid, texto: "cuatro", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 5);
  assert.match(llamadasAgy().at(-1)!.prompt, /Mensaje de [^\n]+:\ncuatro/);
  assert.ok(!llamadasAgy().at(-1)!.prompt.includes("dos-editado"));
  const v2 = await vista(sid);
  assert.ok(v2.includes("user: uno") && v2.includes("user: cuatro"));
  assert.ok(!v2.some((f: string) => f.includes("dos-editado") || f.includes("terceroXQ")), JSON.stringify(v2));
  assert.equal((await lider.lideresApp()).find((x) => x.sid === sid)!.cortes!.length, 2);
  // Tras cerrar y volver, retoma la sesión nueva de agy (no la apartada) y sin repetir el relevo.
  await lider.cerrarTodos(false);
  const m = llamadasAgy().length;
  await lider.mandar({ sid, texto: "cinco", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 6);
  assert.ok(llamadasAgy()[m]!.args.includes("--conversation"));
  assert.ok(!llamadasAgy()[m]!.prompt.includes("Historial de esta conversación"));
  assert.ok((await vista(sid)).includes("user: cinco"));
});

test("conversación mixta Claude → Gemini: editar un mensaje de Claude con el líder en Gemini, y después con Claude en un mensaje de Gemini (retoma su archivo en su último mensaje anterior)", { timeout: 120_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "arranco con claude" });
  await hasta(() => de(sid, "fin").length === 1);
  escribirTranscriptClaude(sid, [
    { rol: "user", texto: "Quiero ordenar mis fotos" },
    { rol: "assistant", texto: "Dale, miro la carpeta" },
    { rol: "user", texto: "gracias-descartable" },
  ]);
  await lider.mandar({ sid, texto: "marca-gemini-uno", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  assert.ok((await vista(sid)).includes("---"));
  const n = llamadasAgy().length;

  // Volver acá en la respuesta de Claude, con el líder en Gemini.
  await lider.rebobinar({ sid, uuid: U(2), texto: "nuevo-rumbo", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 3);
  const l = llamadasAgy()[n]!;
  assert.ok(!l.args.includes("--conversation"));
  assert.match(l.prompt, /Ana: Quiero ordenar mis fotos/);
  assert.match(l.prompt, /Dale, miro la carpeta/);
  assert.ok(!l.prompt.includes("gracias-descartable") && !l.prompt.includes("marca-gemini-uno"), "ni lo de Claude ni lo de Gemini posterior al punto");
  assert.ok(existsSync(estado("gemini", `${sid}.json.previa`)));
  const v = await vista(sid);
  assert.equal(v[0], "user: Quiero ordenar mis fotos");
  assert.equal(v[1], "assistant: Dale, miro la carpeta");
  assert.equal(v[2], "user: nuevo-rumbo");
  assert.ok(!v.some((f: string) => f.includes("gracias-descartable") || f.includes("marca-gemini-uno")), JSON.stringify(v));

  // Vuelve a Claude: lo descartado sigue en su archivo, pero retoma en su último mensaje visible.
  const k = llamadasClaude().length;
  await lider.mandar({ sid, texto: "volvé claude", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 4);
  const c = llamadasClaude().slice(k).at(-1)!;
  assert.equal(c.args[c.args.indexOf("--resume-session-at") + 1], U(2));
  assert.match(readFileSync(c.args[c.args.indexOf("--append-system-prompt-file") + 1], "utf8"), /Ana: nuevo-rumbo/);

  // Con Claude: volver al mensaje "nuevo-rumbo" (de Gemini): resume en el último mensaje de Claude anterior y el relevo trae lo de Gemini hasta ahí.
  const nuevoRumbo = await mensaje(sid, "nuevo-rumbo");
  assert.ok(nuevoRumbo.uuid);
  await lider.rebobinar({ sid, uuid: nuevoRumbo.uuid, texto: "otra-vez", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 5);
  const c2 = llamadasClaude().at(-1)!;
  assert.equal(c2.args[c2.args.indexOf("--resume-session-at") + 1], U(2), "el último mensaje de Claude antes del punto");
  const relevo = readFileSync(c2.args[c2.args.indexOf("--append-system-prompt-file") + 1], "utf8");
  assert.match(relevo, /se volvió atrás/);
  assert.match(relevo, /Ana: nuevo-rumbo/, "lo de Gemini hasta el punto");
  assert.ok(!relevo.includes("Quiero ordenar mis fotos"), "lo que Claude ya tiene en su archivo no se repite");
  assert.ok(!relevo.includes("volvé claude"));
  const v2 = await vista(sid);
  // (El claude falso no escribe transcript: lo que Claude conteste no se ve; sí que se cortó lo de Gemini posterior al punto.)
  assert.ok(v2.includes("user: nuevo-rumbo"));
  assert.ok(!v2.some((f: string) => f.includes("eco: nuevo-rumbo") || f.includes("volvé claude")), JSON.stringify(v2));
});

test("Claude sin cambios de motor: el camino de siempre (--resume-session-at y --fork-session), sin relevo ni cortes; los locales no", { timeout: 60_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "claude-opus-5-5", effort: "high", texto: "solo claude" });
  await hasta(() => de(sid, "fin").length === 1);
  escribirTranscriptClaude(sid, [
    { rol: "user", texto: "primero" },
    { rol: "assistant", texto: "respuesta" },
    { rol: "user", texto: "segundo" },
  ]);
  await lider.rebobinar({ sid, uuid: U(2), texto: "otro", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  const c = llamadasClaude().at(-1)!;
  assert.equal(c.args[c.args.indexOf("--resume-session-at") + 1], U(2));
  assert.ok(!c.args.includes("--append-system-prompt-file"));
  const g = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(g.cortes, undefined);
  assert.ok(!existsSync(lider.archivoRelevo(sid)));
  const nuevo = await lider.ramificar({ sid, uuid: U(2), modelo: "claude-opus-5-5", effort: "high" });
  const r = (await lider.lideresApp()).find((x) => x.sid === nuevo)!;
  assert.deepEqual(r.rama, { de: sid, hasta: U(2) });
  assert.equal(r.heredado, undefined);
  await hasta(() => llamadasClaude().some((l) => l.args.includes("--fork-session")));
  // Un modelo local o de Ollama no vuelve atrás ni ramifica.
  await assert.rejects(lider.rebobinar({ sid, uuid: U(2), texto: "x", modelo: "ollama:qwen", effort: "high" }));
  await assert.rejects(lider.ramificar({ sid, uuid: U(2), modelo: "ollama:qwen", effort: "high" }));
});

test("Ramificar desde Gemini: un líder nuevo en otro motor (Claude) arranca con el relevo hasta el mensaje; el origen no se toca", { timeout: 90_000 }, async () => {
  const sid = await lider.nuevo({ modelo: "gemini-4-argon", effort: "high", texto: "alfa" });
  await hasta(() => de(sid, "fin").length === 1);
  await lider.mandar({ sid, texto: "beta", modelo: "gemini-4-argon", effort: "high" });
  await hasta(() => de(sid, "fin").length === 2);
  const alfa = await mensaje(sid, "eco: alfa");
  const antes = readFileSync(estado("gemini", `${sid}.jsonl`), "utf8");
  const nuevo = await lider.ramificar({ sid, uuid: alfa.uuid, modelo: "claude-opus-5-5", effort: "high" });
  assert.notEqual(nuevo, sid);
  const r = (await lider.lideresApp()).find((x) => x.sid === nuevo)!;
  assert.equal(r.modelo, "claude-opus-5-5");
  assert.deepEqual(r.heredado, { de: sid, hasta: alfa.uuid });
  assert.equal(r.origen?.sid, sid);
  assert.equal(r.rama, undefined, "no es un --fork-session");
  // Antes de su primer mensaje ya muestra la conversación heredada, sólo hasta el punto.
  const v0 = await vista(nuevo);
  assert.equal(v0.length, 2);
  assert.ok(v0[0] === "user: alfa" && v0[1].startsWith("assistant: eco: alfa"));
  // El origen, intacto.
  assert.equal(readFileSync(estado("gemini", `${sid}.jsonl`), "utf8"), antes);
  const o = (await lider.lideresApp()).find((x) => x.sid === sid)!;
  assert.equal(o.cortes, undefined);
  assert.deepEqual((await vista(sid)).filter((f: string) => f.startsWith("user:")), ["user: alfa", "user: beta"]);
  // El primer mensaje abre la sesión de Claude (nueva) con el relevo en el prompt de sistema.
  const k = llamadasClaude().length;
  await lider.mandar({ sid: nuevo, texto: "gamma", modelo: "claude-opus-5-5", effort: "high" });
  await hasta(() => de(nuevo, "fin").length === 1);
  const c = llamadasClaude().slice(k).find((l) => l.args.includes("--session-id"))!;
  assert.ok(c, "sesión nueva de Claude");
  assert.equal(c.args[c.args.indexOf("--session-id") + 1], nuevo);
  assert.ok(!c.args.includes("--resume") && !c.args.includes("--fork-session"));
  const relevo = readFileSync(c.args[c.args.indexOf("--append-system-prompt-file") + 1], "utf8");
  assert.match(relevo, /rama/);
  assert.match(relevo, /Ana: alfa/);
  assert.ok(!relevo.includes("beta"));
  const v = await vista(nuevo);
  assert.ok(v[0] === "user: alfa" && v[1].startsWith("assistant: eco: alfa"));
  // (El claude falso no escribe transcript: lo propio de la rama no se ve; sí lo heredado, y nada de lo posterior del origen.)
  assert.ok(!v.some((f: string) => f.includes("beta")));
});

test("opencode: Volver acá (relevo, sesión apartada, vista cortada) y Ramificar (líder nuevo con el relevo en su primer pedido)", { skip: SIN_OPENCODE, timeout: 240_000 }, async () => {
  const sid = await lider.nuevo({ modelo: MODELO_FALSO, effort: "high", texto: "primero-oc" });
  await hasta(() => de(sid, "fin").length === 1, 120_000);
  await lider.mandar({ sid, texto: "segundo-oc", modelo: MODELO_FALSO, effort: "high" });
  await hasta(() => de(sid, "fin").length === 2, 120_000);
  const pag = await lider.conversacionLider({ sid, n: 200 });
  const primeroU = pag.mensajes.find((m: any) => m.rol === "user" && m.texto === "primero-oc");
  const respuesta1 = pag.mensajes[pag.mensajes.findIndex((m: any) => m === primeroU || m.uuid === primeroU.uuid) + 1];
  assert.ok(respuesta1?.uuid && respuesta1.rol === "assistant", JSON.stringify(pag.mensajes.map((m: any) => m.rol)));

  // Ramificar en la respuesta del primer mensaje: líder nuevo con el relevo en su primer pedido.
  const nuevo = await lider.ramificar({ sid, uuid: respuesta1.uuid, modelo: MODELO_FALSO, effort: "high" });
  assert.deepEqual((await lider.lideresApp()).find((x) => x.sid === nuevo)!.heredado, { de: sid, hasta: respuesta1.uuid });
  assert.ok((await vista(nuevo)).includes("user: primero-oc"));
  assert.ok(!(await vista(nuevo)).some((f: string) => f.includes("segundo-oc")));
  await lider.mandar({ sid: nuevo, texto: "tercero-oc", modelo: MODELO_FALSO, effort: "high" });
  await hasta(() => de(nuevo, "fin").length === 1, 120_000);
  const pedido = usuarios(falso!.pedidos().at(-1)!).join("\n");
  assert.match(pedido, /Ana: primero-oc/);
  assert.match(pedido, /tercero-oc/);
  assert.ok(!pedido.includes("segundo-oc"));
  const vn = await vista(nuevo);
  assert.ok(vn.includes("user: primero-oc") && vn.includes("user: tercero-oc"));
  assert.ok((await vista(sid)).includes("user: segundo-oc"), "el origen sigue entero");

  // Volver acá en el origen: sesión de opencode apartada y relevo hasta ese mensaje.
  assert.ok(existsSync(estado("opencode", `${sid}.json`)));
  await lider.rebobinar({ sid, uuid: respuesta1.uuid, texto: "cuarto-oc", modelo: MODELO_FALSO, effort: "high" });
  await hasta(() => de(sid, "fin").length === 3, 120_000);
  assert.ok(existsSync(estado("opencode", `${sid}.json.previa`)));
  const pedido2 = usuarios(falso!.pedidos().at(-1)!).join("\n");
  assert.match(pedido2, /Ana: primero-oc/);
  assert.match(pedido2, /cuarto-oc/);
  assert.ok(!pedido2.includes("segundo-oc"), "lo posterior al punto no llega al modelo");
  const v = await vista(sid);
  assert.ok(v.includes("user: primero-oc") && v.includes("user: cuarto-oc"));
  assert.ok(!v.some((f: string) => f.includes("segundo-oc")), JSON.stringify(v));
  assert.match(readFileSync(estado("opencode", `${sid}.jsonl`), "utf8"), /segundo-oc/, "el transcript queda entero");
});
