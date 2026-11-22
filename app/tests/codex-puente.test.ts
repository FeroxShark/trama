// El puente de ChatGPT (electron/codex-puente.ts) solo, con el codex falso: «Mandar ya», imágenes y errores previos al primer paso.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { esperarHasta } from "./esperar.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "codex-puente-"));
const home = path.join(tmp, "home");
const trabajo = path.join(tmp, "trabajo");
mkdirSync(home, { recursive: true });
mkdirSync(trabajo, { recursive: true });
const FALSO = path.join(import.meta.dirname, "..", "scripts", "codex-falso.mjs");
const puentes: Puente[] = [];
after(() => {
  for (const p of puentes) p.matar();
  rmSync(tmp, { recursive: true, force: true });
});

class Puente {
  lineas: any[] = [];
  salio: number | null = null;
  private hijo: ChildProcess;
  readonly estado: string;
  readonly sid: string;
  constructor(sid: string, extra: Record<string, string> = {}) {
    this.sid = sid;
    this.estado = path.join(tmp, `estado-${sid}`);
    this.hijo = spawn(process.execPath, [path.join(import.meta.dirname, "..", "electron", "codex-puente.ts"), "--sid", sid, "--nombre", "t", "--modelo", "codex:gpt-6.1-sol", "--cwd", trabajo], {
      env: { ...process.env, HOME: home, HILOS_STATE: this.estado, HILOS_SESIONES: path.join(tmp, `ses-${sid}`), HILOS_CODEX: FALSO, TRAMA_DUENO: "Ana", TRAMA_FALSO_MS: "10", TRAMA_FALSO_MS_LENTO: "1500", ...extra },
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.hijo.stdout! }).on("line", (l) => {
      try {
        this.lineas.push(JSON.parse(l));
      } catch {
        /* ruido */
      }
    });
    this.hijo.on("exit", (c) => (this.salio = c ?? -1));
    puentes.push(this);
  }
  mandar(texto: string, directo = false) {
    this.hijo.stdin!.write(JSON.stringify({ type: "user", ...(directo ? { trama_directo: true } : {}), message: { role: "user", content: texto } }) + "\n");
  }
  get resultados() {
    return this.lineas.filter((l) => l.type === "result");
  }
  get ecos(): string[] {
    return this.lineas.filter((l) => l.type === "user" && l.isReplay).map((l) => l.message.content[0].text);
  }
  get respuestas(): string[] {
    return this.lineas.filter((l) => l.type === "assistant").flatMap((l) => l.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text));
  }
  enviar(o: object) {
    this.hijo.stdin!.write(JSON.stringify(o) + "\n");
  }
  matar() {
    this.hijo.kill("SIGKILL");
  }
}

test("«Mandar ya» a mitad de un turno entra antes que lo ya encolado y devuelve su eco al empezar", { timeout: 60_000 }, async () => {
  const p = new Puente("aaaaaaaa-0000-4000-8000-000000000001");
  p.mandar("despacio uno");
  await esperarHasta(() => existsSync(path.join(p.estado, "codex-falso")), { tope: 15_000 }); // el turno 1 ya arrancó
  p.mandar("normal dos");
  p.mandar("YA-TRES", true);
  await esperarHasta(() => p.resultados.length === 3, { tope: 45_000 });
  assert.deepEqual(p.ecos, ["YA-TRES"], "el eco del directo sale cuando entra al turno");
  const orden = p.respuestas.map((t) => /eco: (\S+)/.exec(t)?.[1]);
  assert.deepEqual(orden, ["despacio", "YA-TRES", "normal"], "el directo pasa delante del mensaje que esperaba en la cola");
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64").toString("base64");
const conImagen = (texto: string) => ({ type: "user", message: { role: "user", content: [...(texto ? [{ type: "text", text: texto }] : []), { type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }] } });
const usuariosDelTranscript = (p: Puente) =>
  readFileSync(path.join(p.estado, "codex", `${p.sid}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => o.type === "user").map((o) => o.message.content as string);

test("PUENTES-15: un mensaje de sólo imágenes deja constancia en el transcript (no queda vacío)", { timeout: 60_000 }, async () => {
  const p = new Puente("aaaaaaaa-0000-4000-8000-000000000002");
  p.enviar(conImagen(""));
  await esperarHasta(() => p.resultados.length === 1, { tope: 30_000 });
  assert.deepEqual(usuariosDelTranscript(p), ["[1 imagen(es) adjunta(s)]"]);
});

test("PUENTES-15: si las imágenes no se pueden guardar, codex recibe el aviso en su prompt", { timeout: 60_000, skip: process.getuid?.() === 0 ? "root escribe igual en una carpeta de sólo lectura" : false }, async () => {
  const sid = "aaaaaaaa-0000-4000-8000-000000000003";
  const log = path.join(tmp, "codex-imagenes.log");
  const carpeta = path.join(tmp, `estado-${sid}`, "codex");
  mkdirSync(carpeta, { recursive: true });
  writeFileSync(path.join(carpeta, `${sid}.jsonl`), ""); // el transcript ya existe: se puede anexar, pero no crear la carpeta de imágenes
  chmodSync(carpeta, 0o500);
  try {
    const p = new Puente(sid, { TRAMA_FALSO_LOG: log });
    p.enviar(conImagen("mirá esto"));
    await esperarHasta(() => p.resultados.length === 1, { tope: 30_000 });
    const prompt = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).at(-1).prompt as string;
    assert.match(prompt, /no se pudieron guardar/);
  } finally {
    chmodSync(carpeta, 0o700);
  }
});
