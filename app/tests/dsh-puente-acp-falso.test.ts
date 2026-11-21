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
