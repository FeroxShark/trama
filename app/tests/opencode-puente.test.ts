// Un líder de opencode de punta a punta: el puente (electron/dsh-puente.ts, con un modelo `opencode:`) con un `opencode acp` de verdad
// y el servidor OpenAI falso (scripts/openai-falso.mjs) como proveedor `falso`. Habla como `claude -p` por stdin/stdout. Sin `opencode`
// (TRAMA_OPENCODE_BIN, app/node_modules/.bin, PATH) se saltea. HOME, XDG_* y HILOS_STATE en un tmp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { parsearLinea } from "../electron/lider-arma.ts";
import { arrancarFalso, entornoTmp, hasta } from "./dsh-ayuda.ts";
import { MODELO_FALSO, OPENCODE, SIN_OPENCODE, entornoOpencodeTmp } from "./opencode-ayuda.ts";

const { tmp, home, trabajo } = entornoTmp("opencode-puente");
const estado = path.join(tmp, "estado");
const sesiones = path.join(tmp, "sesiones");
const puentes: Puente[] = [];
after(() => {
  for (const p of puentes) p.matar();
  rmSync(tmp, { recursive: true, force: true });
});

class Puente {
  lineas: any[] = [];
  salio: number | null = null;
  stderr = "";
  private hijo: ChildProcess;
  readonly sid: string;
  constructor(sid: string, baseURL: string, extra: Record<string, string> = {}, modelo = MODELO_FALSO) {
    this.sid = sid;
    this.hijo = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "dsh-puente.ts"), "--sid", sid, "--nombre", "trama-test", "--modelo", modelo, "--cwd", trabajo], {
      env: { ...process.env, ...entornoOpencodeTmp(home, baseURL), HILOS_OPENCODE: OPENCODE!, HILOS_STATE: estado, HILOS_SESIONES: sesiones, TRAMA_DUENO: "Ana", TRAMA_DSH_PREFACIO: "PREFACIO-DE-PRUEBA", ...extra },
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
  mandar(texto: string) {
    this.hijo.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: texto } }) + "\n");
  }
  enviar(o: object) {
    this.hijo.stdin!.write(JSON.stringify(o) + "\n");
  }
  get resultados() {
    return this.lineas.filter((l) => l.type === "result");
  }
  get eventos() {
    return this.lineas.flatMap((l) => parsearLinea(JSON.stringify(l)));
  }
  async turnos(n: number, ms = 90_000) {
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

const base = async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  return falso;
};
const texto = (l: any) => (l.message.content as any[]).filter((b) => b.type === "text").map((b) => b.text).join("");

test("un turno con razonamiento + herramienta + texto: mensajes de Claude, result, transcript en opencode/ y archivo de sesión", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-0000-4000-8000-000000000001", falso.baseURL);
  p.mandar("RAZONA HERRAMIENTA");
  await p.turnos(1);
  const r = p.resultados[0];
  assert.equal(r.is_error, false, p.stderr);
  const asistente = p.lineas.filter((l) => l.type === "assistant");
  assert.ok(asistente.some((l) => l.message.content.some((b: any) => b.type === "thinking" && /Pienso en la respuesta/.test(b.thinking))), "el razonamiento");
  const uso = asistente.flatMap((l) => l.message.content).find((b: any) => b.type === "tool_use");
  assert.equal(uso.name, "Bash", "bash → Bash");
  assert.equal(uso.input.command, "echo hola-desde-bash", "la entrada completa (llegó en un tool_call_update)");
  const res = p.lineas.filter((l) => l.type === "user" && l.message.content?.[0]?.type === "tool_result");
  assert.equal(res.length, 1);
  assert.match(String(res[0].message.content[0].content), /hola-desde-bash/);
  assert.ok(asistente.some((l) => /listo: hola-desde-bash/.test(texto(l))), "el texto final");
  assert.ok(p.eventos.length > 0);
  const t = path.join(estado, "opencode", `${p.sid}.jsonl`);
  assert.ok(existsSync(t), "transcript en $HILOS_STATE/opencode/");
  assert.match(readFileSync(t, "utf8"), /hola-desde-bash/);
  assert.ok(existsSync(path.join(estado, "opencode", `${p.sid}.json`)), "la sesión ACP queda anotada");
  assert.ok(!existsSync(path.join(estado, "dsh", `${p.sid}.jsonl`)));
  await p.cerrar();
});

test("un segundo puente retoma la sesión de opencode (session/resume) y la conversación sigue", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const falso = await base();
  const sid = "11111111-0000-4000-8000-000000000002";
  const a = new Puente(sid, falso.baseURL);
  a.mandar("primero");
  await a.turnos(1);
  await a.cerrar();
  const b = new Puente(sid, falso.baseURL);
  b.mandar("segundo");
  await b.turnos(1);
  assert.equal(b.resultados[0].is_error, false, b.stderr);
  assert.doesNotMatch(b.stderr, /no se pudo retomar/);
  const ultimo = falso.pedidos().at(-1)!;
  const dichos = (ultimo.body.messages as any[]).filter((m) => m.role === "user").map((m) => JSON.stringify(m.content));
  assert.ok(dichos.some((d) => d.includes("primero")), "opencode conserva el primer mensaje");
  await b.cerrar();
});

test("escribir fuera de la carpeta de trabajo se rechaza; dentro se permite", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const falso = await base();
  const fuera = path.join(tmp, "fuera-del-workspace.txt");
  const p = new Puente("11111111-0000-4000-8000-000000000003", falso.baseURL);
  p.mandar(`OC_ESCRIBE ${fuera}`);
  await p.turnos(1);
  assert.ok(!existsSync(fuera), "no se escribió fuera del workspace");
  p.mandar("OC_ESCRIBE adentro.txt");
  await p.turnos(2);
  assert.ok(existsSync(path.join(trabajo, "adentro.txt")), "sí dentro");
  const w = p.lineas.filter((l) => l.type === "assistant").flatMap((l) => l.message.content).filter((b: any) => b.type === "tool_use" && b.name === "Write");
  assert.equal(w.length, 2);
  assert.equal(w[1].input.file_path, "adentro.txt");
  await p.cerrar();
});

test("un modelo mal armado falla claro", { skip: SIN_OPENCODE, timeout: 60_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-0000-4000-8000-000000000005", falso.baseURL, {}, "opencode:falso/no-existe");
  p.mandar("hola");
  await p.turnos(1, 50_000);
  assert.equal(p.resultados[0].is_error, true);
  await p.cerrar();
});

test("interrumpir a mitad de una herramienta lenta corta el turno (sin error) y el líder sigue andando", { skip: SIN_OPENCODE, timeout: 150_000 }, async () => {
  const falso = await base();
  const p = new Puente("11111111-0000-4000-8000-000000000006", falso.baseURL);
  p.mandar("HERRAMIENTA_LENTA");
  await hasta(() => p.lineas.some((l) => l.type === "assistant" && l.message.content.some((b: any) => b.type === "tool_use")), 90_000, `no llegó la herramienta; stderr: ${p.stderr.slice(-500)}`);
  p.enviar({ type: "control_request", request_id: "i1", request: { subtype: "interrupt" } });
  await p.turnos(1, 40_000);
  assert.equal(p.resultados[0].is_error, false, p.resultados[0].result);
  // Sigue vivo: el siguiente mensaje se contesta (opencode retoma su sesión).
  p.mandar("otra cosa");
  await p.turnos(2, 90_000);
  assert.equal(p.resultados[1].is_error, false, p.stderr.slice(-500));
  await p.cerrar();
});
