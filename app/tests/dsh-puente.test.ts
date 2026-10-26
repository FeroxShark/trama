// Un líder de dsh de punta a punta: el puente (electron/dsh-puente.ts) con un `dsh --profile acp` de verdad y el servidor OpenAI falso
// (scripts/openai-falso.mjs). Habla como `claude -p` por stdin/stdout: lo que sale lo entiende parsearLinea (lider-arma.ts). Sin `dsh`
// (TRAMA_DSH_BIN, app/node_modules/.bin, PATH…) se saltea. HOME, DSH_HOME y HILOS_STATE en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { parsearLinea } from "../electron/lider-arma.ts";
import { DSH, SIN_DSH, arrancarFalso, entornoTmp, espera, hasta, pngValido, usuarios } from "./dsh-ayuda.ts";

const { tmp, home, trabajo, dshHome } = entornoTmp("dsh-puente");
const estado = path.join(tmp, "estado");
const sesiones = path.join(tmp, "sesiones");
const puentes: Puente[] = [];
after(() => {
  for (const p of puentes) p.matar();
  rmSync(tmp, { recursive: true, force: true });
});

/** El puente como lo lanza lider.ts: stdin/stdout de stream-json. */
class Puente {
  lineas: any[] = [];
  salio: number | null = null;
  stderr = "";
  private hijo: ChildProcess;
  readonly sid: string;
  constructor(sid: string, baseURL: string, extra: Record<string, string> = {}) {
    this.sid = sid;
    this.hijo = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "dsh-puente.ts"), "--sid", sid, "--nombre", "trama-test", "--modelo", "dsh:ollama/fake-model", "--cwd", trabajo], {
      env: { ...process.env, HOME: home, DSH_HOME: dshHome, HILOS_DSH: DSH!, HILOS_STATE: estado, HILOS_SESIONES: sesiones, TRAMA_DUENO: "Ana", TRAMA_DSH_URL: baseURL, TRAMA_DSH_PREFACIO: "PREFACIO-DE-PRUEBA", ...extra },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.hijo.stdout! }).on("line", (l) => {
      try {
        this.lineas.push(JSON.parse(l));
      } catch {
        /* ruido */
      }
    });
    this.hijo.stderr!.on("data", (t) => (this.stderr += t));
    this.hijo.on("exit", (c) => (this.salio = c ?? -1));
    puentes.push(this);
  }
  enviar(o: object) {
    this.hijo.stdin!.write(JSON.stringify(o) + "\n");
  }
  mandar(texto: string, o: { directo?: boolean; imagenes?: { media_type: string; data: string }[] } = {}) {
    const content = o.imagenes?.length ? [{ type: "text", text: texto }, ...o.imagenes.map((i) => ({ type: "image", source: { type: "base64", ...i } }))] : texto;
    this.enviar({ type: "user", ...(o.directo ? { trama_directo: true } : {}), message: { role: "user", content } });
  }
  get resultados() {
    return this.lineas.filter((l) => l.type === "result");
  }
  /** Lo que pinta la app: parsearLinea de cada línea. */
  get eventos() {
    return this.lineas.flatMap((l) => parsearLinea(JSON.stringify(l)));
  }
  async turnos(n: number, ms = 60_000) {
    await hasta(() => this.resultados.length >= n, ms, `el turno ${n} no terminó; stderr: ${this.stderr.slice(-800)}`);
  }
  cerrar() {
    this.hijo.stdin!.end();
    return hasta(() => this.salio !== null, 15_000, "el puente no salió");
  }
  matar() {
    this.hijo.kill("SIGKILL");
  }
}

const base = async (extra: Record<string, string> = {}) => {
  const falso = await arrancarFalso(tmp, extra);
  after(() => falso.cerrar());
  return falso;
};
const texto = (l: any) => (l.message.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");

test("un turno con razonamiento + herramienta + texto: los mensajes de Claude, el result, el transcript y el archivo de sesión", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000001", falso.baseURL);
  p.mandar("RAZONA HERRAMIENTA hacelo");
  // Mientras trabaja, el puente anota su sesión (la barra y `pa` la buscan ahí).
  await hasta(() => existsSync(sesiones) && readdirSync(sesiones).length > 0, 20_000);
  const ses = JSON.parse(readFileSync(path.join(sesiones, readdirSync(sesiones)[0]!), "utf8"));
  assert.equal(ses.sessionId, p.sid);
  await p.turnos(1);

  const asist = p.lineas.filter((l) => l.type === "assistant");
  const pens = asist.find((l) => l.message.content.some((b: any) => b.type === "thinking"));
  assert.equal(pens.message.content.find((b: any) => b.type === "thinking").thinking, "Pienso en la respuesta.");
  const uso = asist.find((l) => l.message.content.some((b: any) => b.type === "tool_use"));
  const tool = uso.message.content[0];
  assert.equal(tool.name, "Bash");
  assert.equal(tool.input.command, "echo hola-desde-bash");
  assert.equal(tool.input.description, "una herramienta de prueba");
  const res = p.lineas.find((l) => l.type === "user" && l.message.content?.[0]?.type === "tool_result");
  assert.equal(res.message.content[0].tool_use_id, tool.id);
  assert.match(res.message.content[0].content, /hola-desde-bash/);
  assert.ok(!res.message.content[0].is_error);
  assert.equal(texto(asist.at(-1)), "listo: hola-desde-bash");
  assert.ok(asist.every((l) => l.message.model === "dsh:ollama/fake-model"));
  // El orden: razonamiento, herramienta, resultado, texto.
  const orden = p.lineas.filter((l) => l.type === "assistant" || l.type === "user" || l.type === "result").map((l) => (l.type === "assistant" ? l.message.content[0].type : l.type === "user" ? "tool_result" : "result"));
  assert.deepEqual(orden, ["thinking", "tool_use", "tool_result", "text", "result"]);

  const r = p.resultados[0];
  assert.equal(r.is_error, false);
  assert.equal(r.subtype, "success");
  assert.ok(r.usage.input_tokens > 0, "el contexto sale de usage_update");
  assert.ok(r.modelUsage["dsh:ollama/fake-model"].contextWindow > 0);

  // Lo que pinta la app: pensamiento, herramienta, resultado, texto, fin.
  const ev = p.eventos;
  assert.ok(ev.some((e: any) => e.tipo === "mensaje" && e.pensado === "Pienso en la respuesta."));
  assert.ok(ev.some((e: any) => e.tipo === "mensaje" && e.herramientas.length === 1));
  assert.ok(ev.some((e: any) => e.tipo === "resultado"));
  assert.ok(ev.some((e: any) => e.tipo === "mensaje" && e.texto === "listo: hola-desde-bash"));
  assert.deepEqual(ev.filter((e: any) => e.tipo === "fin").map((e: any) => e.error), [null]);
  assert.ok(ev.some((e: any) => e.tipo === "pensamiento"), "el pensamiento también sale como delta, para verlo en vivo");

  // El transcript es aparte y con el mismo formato que el de agy-puente.
  const t = readFileSync(path.join(estado, "dsh", `${p.sid}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(t.map((x) => x.type), ["user", "assistant", "assistant", "user", "assistant"]);
  assert.equal(t[0].message.content, "RAZONA HERRAMIENTA hacelo");
  assert.equal(t[0].sessionId, p.sid);
  // El primer mensaje lleva el prefacio (dsh no lee CLAUDE.md).
  assert.match(usuarios(falso.pedidos()[0]!)[0]!, /^PREFACIO-DE-PRUEBA\n\n---\n\nMensaje de Ana:\nRAZONA HERRAMIENTA hacelo$/);
  // La sesión de ACP quedó anotada para retomarla.
  const lado = JSON.parse(readFileSync(path.join(estado, "dsh", `${p.sid}.json`), "utf8"));
  assert.ok(lado.acp_session);

  // Al salir ya no queda su archivo de sesión.
  await p.cerrar();
  assert.equal(p.salio, 0);
  assert.deepEqual(readdirSync(sesiones), []);
});

test("el segundo turno sigue la misma sesión de ACP; otro puente la retoma con session/resume y, si se perdió, empieza una con lo hablado", { skip: SIN_DSH, timeout: 180_000 }, async () => {
  const falso = await base();
  const sid = "11111111-aaaa-4aaa-8aaa-000000000002";
  const ladoArchivo = path.join(estado, "dsh", `${sid}.json`);
  const p = new Puente(sid, falso.baseURL);
  p.mandar("uno");
  await p.turnos(1);
  const acp = JSON.parse(readFileSync(ladoArchivo, "utf8")).acp_session as string;
  p.mandar("dos");
  await p.turnos(2);
  assert.equal(JSON.parse(readFileSync(ladoArchivo, "utf8")).acp_session, acp);
  assert.deepEqual(usuarios(falso.pedidos().at(-1)!).map((t) => t.replace(/^PREFACIO[^]*Mensaje de Ana:\n/, "")), ["uno", "dos"]);
  assert.match(texto(p.lineas.filter((l) => l.type === "assistant").at(-1)), /eco: dos$/);
  await p.cerrar();

  // Cerrar del todo y volver: otro puente, otro dsh, la misma sesión (session/resume): el modelo ve lo de antes y no se repite el prefacio.
  const q = new Puente(sid, falso.baseURL);
  q.mandar("tres");
  await q.turnos(1);
  const us = usuarios(falso.pedidos().at(-1)!);
  assert.equal(us.length, 3);
  assert.equal(us[2], "tres", "sin prefacio: la sesión ya lo tiene");
  assert.equal(JSON.parse(readFileSync(ladoArchivo, "utf8")).acp_session, acp);
  await q.cerrar();

  // Si dsh ya no tiene la sesión: una nueva, con lo hablado (del transcript del puente) por delante.
  writeFileSync(ladoArchivo, JSON.stringify({ version: 1, sid, acp_session: "sesion-que-no-existe" }) + "\n");
  const r = new Puente(sid, falso.baseURL);
  r.mandar("cuatro");
  await r.turnos(1);
  assert.deepEqual(r.eventos.filter((e: any) => e.tipo === "fin").map((e: any) => e.error), [null]);
  const nuevo = JSON.parse(readFileSync(ladoArchivo, "utf8")).acp_session as string;
  assert.notEqual(nuevo, acp);
  assert.notEqual(nuevo, "sesion-que-no-existe");
  const ultimo = usuarios(falso.pedidos().at(-1)!);
  assert.equal(ultimo.length, 1, "la historia de dsh empezó de cero");
  assert.match(ultimo[0]!, /^PREFACIO-DE-PRUEBA/);
  assert.match(ultimo[0]!, /Lo que ya hablaron[^]*Ana: uno[^]*Vos: eco: [^]*Ana: dos[^]*Vos: eco: dos[^]*Ana: tres[^]*Vos: eco: tres[^]*Mensaje de Ana:\ncuatro$/);
  await r.cerrar();
});

test("«Mandar ya»: corta el turno con session/cancel y sigue con el mensaje en la misma sesión; un solo result y el eco que lider.ts espera", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await base({ OPENAI_FALSO_MS_LENTO: "350" });
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000003", falso.baseURL);
  p.mandar("DESPACIO");
  await hasta(() => falso.pedidos().length === 1, 60_000, "el primer pedido al modelo no llegó");
  await espera(1200); // a mitad del stream lento: dsh ya cerró un paso con lo que llevaba dicho
  p.mandar("YA-QUIERO-ESTO", { directo: true });
  await p.turnos(1);
  await espera(500);
  assert.equal(p.resultados.length, 1, "para el chat sigue siendo un solo turno");
  assert.equal(p.resultados[0].is_error, false);
  const ecos = p.lineas.filter((l) => l.type === "user" && l.isReplay);
  assert.deepEqual(ecos.map((e) => e.message.content[0].text), ["YA-QUIERO-ESTO"]);
  assert.deepEqual(p.eventos.filter((e: any) => e.tipo === "replay").map((e: any) => e.texto), ["YA-QUIERO-ESTO"]);
  // La misma sesión: el pedido que contesta tiene el original (dsh lo guardó) y, aparte, la nota con el mensaje.
  const ped = falso.pedidos();
  assert.equal(ped.length, 2);
  const us = usuarios(ped.at(-1)!);
  assert.equal(us.length, 2);
  assert.match(us[0]!, /Mensaje de Ana:\nDESPACIO$/);
  assert.match(us[1]!, /a mitad del turno[^\n]*\nYA-QUIERO-ESTO$/);
  assert.match(texto(p.lineas.filter((l) => l.type === "assistant").at(-1)), /^eco: .*YA-QUIERO-ESTO$/s);
  // En el transcript: el mensaje de la persona, en el medio.
  const t = readFileSync(path.join(estado, "dsh", `${p.sid}.jsonl`), "utf8");
  assert.match(t, /YA-QUIERO-ESTO/);

  // Sin turno en curso, un «Mandar ya» es un mensaje normal (y su eco igual llega).
  p.mandar("normal", { directo: true });
  await p.turnos(2);
  assert.deepEqual(p.lineas.filter((l) => l.type === "user" && l.isReplay).map((e) => e.message.content[0].text), ["YA-QUIERO-ESTO", "normal"]);
  await p.cerrar();
});

test("«Mandar ya» que llega mientras arranca dsh (todavía no hay qué cortar) va en el mismo prompt que el mensaje", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-aaaa-4aaa-8aaa-00000000000a", falso.baseURL);
  p.mandar("primero");
  p.mandar("YA-TAMBIEN", { directo: true });
  await p.turnos(1);
  assert.equal(p.resultados.length, 1);
  assert.equal(p.resultados[0].is_error, false);
  assert.equal(falso.pedidos().length, 1, "un solo pedido al modelo");
  const us = usuarios(falso.pedidos().at(-1)!);
  assert.equal(us.length, 1, "un solo mensaje: el original más el nuevo");
  assert.match(us[0]!, /Mensaje de Ana:\nprimero\n\n\[Mensaje de Ana a mitad del turno[^\n]*\nYA-TAMBIEN$/);
  assert.deepEqual(p.lineas.filter((l) => l.type === "user" && l.isReplay).map((e) => e.message.content[0].text), ["YA-TAMBIEN"]);
  await p.cerrar();
});

test("interrumpir (parar) corta el turno sin error y el puente sigue atendiendo en la misma sesión; un mensaje común queda en la cola", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await base({ OPENAI_FALSO_MS_LENTO: "350" });
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000004", falso.baseURL);
  p.mandar("HERRAMIENTA_LENTA");
  await hasta(() => p.lineas.some((l) => l.type === "assistant" && l.message.content?.[0]?.type === "tool_use"), 60_000, "no llegó la herramienta");
  p.mandar("después");
  p.enviar({ type: "control_request", request_id: "req-1", request: { subtype: "interrupt" } });
  await p.turnos(1);
  assert.ok(p.lineas.some((l) => l.type === "control_response" && l.response.request_id === "req-1" && l.response.subtype === "success"));
  assert.equal(p.resultados[0].is_error, false, "cortarlo no es un error");
  // La herramienta cortada queda cerrada (el chat no la muestra corriendo).
  const res = p.lineas.find((l) => l.type === "user" && l.message.content?.[0]?.type === "tool_result");
  assert.equal(res.message.content[0].is_error, true);
  // Y el mensaje que estaba en la cola sale como el turno siguiente.
  await p.turnos(2);
  assert.match(texto(p.lineas.filter((l) => l.type === "assistant").at(-1)), /eco: [^]*después$/);
  await p.cerrar();
});

test("una imagen adjunta viaja como bloque image de ACP hasta el modelo; sin soporte en el modelo, un aviso en su lugar", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await base();
  const png = pngValido().toString("base64");
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000005", falso.baseURL, { TRAMA_DSH_IMAGENES: "1" });
  p.mandar("mirá esto", { imagenes: [{ media_type: "image/png", data: png }] });
  await p.turnos(1);
  assert.equal(p.resultados[0].is_error, false);
  const m = falso.pedidos().at(-1)!.body.messages.find((x: any) => x.role === "user");
  assert.ok(Array.isArray(m.content) && m.content.some((c: any) => c.type === "image_url" && /^data:image\/png;base64,/.test(c.image_url.url)));
  assert.match(texto(p.lineas.filter((l) => l.type === "assistant").at(-1)), /eco: .*mirá esto.*\[imagen\]/s);
  await p.cerrar();

  const sin = new Puente("11111111-aaaa-4aaa-8aaa-000000000006", falso.baseURL);
  sin.mandar("mirá esto", { imagenes: [{ media_type: "image/png", data: png }] });
  await sin.turnos(1);
  assert.equal(sin.resultados[0].is_error, false);
  const u = usuarios(falso.pedidos().at(-1)!)[0]!;
  assert.match(u, /adjuntó 1 imagen\(es\), pero dsh:ollama\/fake-model no acepta imágenes/);
  await sin.cerrar();
});

test("si el modelo falla (500) el turno termina con un error que lo dice, y el puente sigue vivo", { skip: SIN_DSH, timeout: 180_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000007", falso.baseURL);
  p.mandar("ERROR500");
  await p.turnos(1, 150_000);
  const r = p.resultados[0];
  assert.equal(r.is_error, true);
  assert.match(r.result, /500.*boom falso/);
  p.mandar("sigo vivo");
  await p.turnos(2);
  assert.match(texto(p.lineas.filter((l) => l.type === "assistant").at(-1)), /eco: .*sigo vivo/s);
  await p.cerrar();
});

test("sin DEEPSEEK_API_KEY un modelo de deepseek falla de entrada con el motivo (sin lanzar dsh)", { timeout: 30_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-aaaa-4aaa-8aaa-000000000008", falso.baseURL, { HILOS_DSH: "/no/existe/dsh" });
  // El puente se lanzó con ollama; uno de deepseek necesita otra línea de comandos.
  await p.cerrar();
  const q = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "dsh-puente.ts"), "--sid", "11111111-aaaa-4aaa-8aaa-000000000009", "--modelo", "dsh:deepseek/deepseek-v4-flash", "--cwd", trabajo], {
    env: { ...process.env, HOME: home, DSH_HOME: dshHome, HILOS_DSH: "/no/existe/dsh", HILOS_STATE: estado, HILOS_SESIONES: sesiones, DEEPSEEK_API_KEY: "" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lineas: any[] = [];
  createInterface({ input: q.stdout! }).on("line", (l) => lineas.push(JSON.parse(l)));
  q.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: "hola" } }) + "\n");
  await hasta(() => lineas.some((l) => l.type === "result"), 20_000);
  const r = lineas.find((l) => l.type === "result");
  assert.equal(r.is_error, true);
  assert.match(r.result, /falta DEEPSEEK_API_KEY/);
  q.kill();
});
