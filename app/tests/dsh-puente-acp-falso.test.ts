// El puente de opencode (electron/dsh-puente.ts) contra un `opencode acp` falso con modos (scripts/opencode-acp-falso.mjs): casos que el
// opencode de verdad no reproduce a pedido (sesión que no se puede retomar, cancel que no contesta, errores partidos, configOptions vacío).
// Sin servidor de modelos ni red; HOME y HILOS_STATE en un tmp.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { entornoTmp, hasta } from "./dsh-ayuda.ts";
import { MODELO_FALSO } from "./opencode-ayuda.ts";

const { tmp, home, trabajo } = entornoTmp("dsh-puente-acp-falso");
const puentes: Puente[] = [];
let n = 0;
after(() => {
  for (const p of puentes) p.matar();
  rmSync(tmp, { recursive: true, force: true });
});

class Puente {
  lineas: any[] = [];
  stderr = "";
  readonly log: string;
  private hijo: ChildProcess;
  constructor(modo: string, extra: Record<string, string> = {}) {
    const k = ++n;
    this.log = path.join(tmp, `acp-${k}.jsonl`);
    this.hijo = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "dsh-puente.ts"), "--sid", `22222222-0000-4000-8000-${String(k).padStart(12, "0")}`, "--nombre", "trama-test", "--modelo", MODELO_FALSO, "--cwd", trabajo], {
      env: {
        ...process.env,
        HOME: home,
        HILOS_OPENCODE: path.join(import.meta.dirname, "..", "scripts", "opencode-acp-falso.mjs"),
        HILOS_STATE: path.join(tmp, `estado-${k}`),
        HILOS_SESIONES: path.join(tmp, `sesiones-${k}`),
        REPARTO_STATE: path.join(tmp, `reparto-${k}`),
        TRAMA_DUENO: "Ana",
        TRAMA_DSH_PREFACIO: "PREFACIO-DE-PRUEBA",
        FALSO_ACP_MODO: modo,
        FALSO_ACP_LOG: this.log,
        ...extra,
      },
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
    puentes.push(this);
  }
  mandar(texto: string, directo = false) {
    this.hijo.stdin!.write(JSON.stringify({ type: "user", message: { role: "user", content: texto }, ...(directo ? { trama_directo: true } : {}) }) + "\n");
  }
  matar() {
    this.hijo.kill("SIGTERM");
  }
  senal(s: NodeJS.Signals) {
    this.hijo.kill(s);
  }
  interrumpir() {
    this.hijo.stdin!.write(JSON.stringify({ type: "control_request", request_id: "req-parar", request: { subtype: "interrupt" } }) + "\n");
  }
  get resultados() {
    return this.lineas.filter((l) => l.type === "result");
  }
  /** Lo que el puente le pidió al agente falso, en orden. */
  pedidos(metodo?: string): any[] {
    if (!existsSync(this.log)) return [];
    return readFileSync(this.log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((p) => !metodo || p.method === metodo);
  }
  prompts(): string[] {
    return this.pedidos("session/prompt").map((p) => (p.params.prompt as any[]).map((b) => b.text ?? "").join(""));
  }
}

test("PUENTES-5: un «Mandar ya» que obliga a relanzar opencode con la sesión perdida lleva el prefacio y lo hablado", { timeout: 60_000 }, async () => {
  const p = new Puente("corte", { TRAMA_DSH_CANCELAR_MS: "200" });
  p.mandar("primero"); // el prompt queda colgado
  await hasta(() => p.prompts().length === 1, 20_000, `no llegó el primer prompt; stderr: ${p.stderr.slice(-600)}`);
  p.mandar("mensaje directo", true); // session/cancel se ignora: el plazo mata a opencode, que vuelve con sesión nueva (resume falla)
  await hasta(() => p.resultados.length === 1, 30_000, `el turno no terminó; stderr: ${p.stderr.slice(-600)}`);
  const segundo = p.prompts()[1];
  assert.ok(segundo, `faltó el segundo prompt: ${JSON.stringify(p.prompts())}`);
  assert.match(segundo, /mensaje directo/);
  assert.match(segundo, /PREFACIO-DE-PRUEBA/, "sin el prefacio");
  assert.match(segundo, /Ana: primero/, "sin lo hablado");
});

// PUENTES-6: el error de «uso gratis agotado» tiene que cortar el turno ya (no a los 180 s sin eventos) venga como venga.
for (const modo of ["pensando", "partido", "stderr-partido", "error-data"]) {
  test(`PUENTES-6: el error de cuota de opencode (${modo}) termina el turno con el aviso de sin cupo y marca agotado`, { timeout: 60_000 }, async () => {
    const p = new Puente(modo, { TRAMA_OPENCODE_SIN_EVENTOS_MS: "600000" });
    p.mandar("hola");
    await hasta(() => p.resultados.length === 1, 20_000, `el turno quedó colgado; stderr: ${p.stderr.slice(-400)}`);
    const r = p.resultados[0];
    assert.equal(r.is_error, true);
    assert.match(String(r.result ?? r.error ?? JSON.stringify(r)), /i18n:main\.opencodeSinCupo/);
    const agotado = path.join(tmp, `reparto-${n}`, "agotado.json");
    assert.ok(existsSync(agotado) && JSON.parse(readFileSync(agotado, "utf8"))["opencode-free"]?.hasta, "el uso gratis quedó marcado agotado");
  });
}

test("PUENTES-9: el puente avisa «requesting» al arrancar el mensaje que esperaba en la cola", { timeout: 60_000 }, async () => {
  const p = new Puente("sin-modelo");
  p.mandar("uno");
  p.mandar("dos"); // llegan juntos: el segundo queda en la cola del puente
  await hasta(() => p.resultados.length === 2, 30_000, `faltó un turno; stderr: ${p.stderr.slice(-400)}`);
  const tipos = p.lineas.map((l) => (l.type === "result" ? "result" : l.type === "system" && l.status === "requesting" ? "requesting" : "")).filter(Boolean);
  assert.deepEqual(tipos, ["result", "requesting", "result"]);
});

test("PUENTES-10: si opencode no trae la opción `model` en configOptions, el puente igual le pide el modelo", { timeout: 60_000 }, async () => {
  const p = new Puente("sin-modelo");
  p.mandar("hola");
  await hasta(() => p.resultados.length === 1, 30_000, `el turno no terminó; stderr: ${p.stderr.slice(-400)}`);
  const cambios = p.pedidos("session/set_config_option").filter((x) => x.params.configId === "model");
  assert.equal(cambios.length, 1, JSON.stringify(p.pedidos().map((x) => x.method)));
  assert.equal(cambios[0].params.value, "falso/fake-model");
});

test("PUENTES-11: los chunks sin messageId forman un solo mensaje, no un globo por pedazo", { timeout: 60_000 }, async () => {
  const p = new Puente("sin-id");
  p.mandar("hola");
  await hasta(() => p.resultados.length === 1, 30_000, `el turno no terminó; stderr: ${p.stderr.slice(-400)}`);
  const asistente = p.lineas.filter((l) => l.type === "assistant");
  assert.equal(asistente.length, 1, JSON.stringify(asistente));
  assert.equal(asistente[0].message.content[0].text, "Hola");
  assert.equal(p.lineas.filter((l) => l.type === "stream_event" && l.event?.type === "message_stop").length, 1);
});

test("PUENTES-12: parar con un opencode que no contesta session/cancel termina el turno antes del plazo de lider.ts (3 s), sin error", { timeout: 60_000 }, async () => {
  const p = new Puente("colgado", { TRAMA_DSH_CANCELAR_MS: "60000", TRAMA_DSH_PARAR_MS: "100" });
  p.mandar("hola");
  await hasta(() => p.prompts().length === 1, 20_000, `no llegó el prompt; stderr: ${p.stderr.slice(-400)}`);
  p.interrumpir();
  await hasta(() => p.resultados.length === 1, 20_000, `el turno no terminó tras parar; stderr: ${p.stderr.slice(-400)}`);
  assert.equal(p.resultados[0].is_error, false);
});

test("PUENTES-12: un SIGINT con el turno ya interrumpido mata a opencode en vez de reiniciar el plazo de cancelar", { timeout: 60_000 }, async () => {
  const p = new Puente("colgado", { TRAMA_DSH_CANCELAR_MS: "60000", TRAMA_DSH_PARAR_MS: "60000" });
  p.mandar("hola");
  await hasta(() => p.prompts().length === 1, 20_000, `no llegó el prompt; stderr: ${p.stderr.slice(-400)}`);
  p.interrumpir();
  await hasta(() => p.pedidos("session/cancel").length === 1, 20_000, "no llegó session/cancel");
  p.senal("SIGINT");
  await hasta(() => p.resultados.length === 1, 20_000, `el turno no terminó tras el SIGINT; stderr: ${p.stderr.slice(-400)}`);
  assert.equal(p.resultados[0].is_error, false);
});
