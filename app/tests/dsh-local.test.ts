// El parche de un modelo LOCAL (ollama) para dsh: `maxTokens` 8192 en el modelo, `compaction-basic` con headroom chico y el
// `-c` real (LLAMA_CTX del env file de la unit, ~/.config/trama/locales). motor/dsh/config.mjs y electron/dsh.ts lo duplican a
// propósito: las dos copias tienen que decir lo mismo. El chequeo con `dsh --dump-config` de verdad se saltea si no hay dsh.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { DSH, SIN_DSH } from "./dsh-ayuda.ts";
import * as ts from "../electron/dsh.ts";
import * as mjs from "../../motor/dsh/config.mjs";

const tmps: string[] = [];
after(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

/** Un `locales.json` y su carpeta de env files de mentira. `env` apunta las dos rutas (HILOS_LOCALES_JSON / HILOS_LOCALES_DIR). */
function locales(json: unknown, envs: Record<string, string> = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-dsh-local-"));
  tmps.push(tmp);
  const carpeta = path.join(tmp, "locales");
  mkdirSync(carpeta);
  for (const [clave, texto] of Object.entries(envs)) writeFileSync(path.join(carpeta, `${clave}.env`), texto);
  const archivo = path.join(tmp, "locales.json");
  writeFileSync(archivo, typeof json === "string" ? json : JSON.stringify(json));
  return { HILOS_LOCALES_JSON: archivo, HILOS_LOCALES_DIR: carpeta };
}

const DECL = {
  version: 1,
  modelos: [{ id: "qwen-local", clave: "hauhaucs", alias: "qwen38-uncensored", unit: "u.service", archivos: ["a.gguf"], pesosMiB: 1, capasKv: 1, ctxDefecto: 32768 }],
};

test("el parche de un modelo local lleva maxTokens, compaction-basic y el contexto; los remotos no", () => {
  const local = ts.escribirParche({ proveedor: "ollama", modelo: "qwen38-uncensored", contexto: 32768 });
  for (const linea of [
    "            contextWindow: 32768",
    "            maxTokens: 8192",
    "- id: compaction-basic",
    "    thresholdRatio: 0.75",
    "    headroomTokens: 1024",
    "    maxTokens: 4096",
  ]) assert.ok(local.split("\n").includes(linea), `falta «${linea}»:\n${local}`);
  // El ajuste va antes de los que eligen el modelo, y el llm-pi-ai sigue siendo una sola entrada.
  assert.ok(local.indexOf("- id: compaction-basic") < local.indexOf("- id: agent-default-model"));
  assert.equal(local.split("- id: llm-pi-ai").length - 1, 1);
  for (const c of [
    { proveedor: "opencode", modelo: "big-pickle" },
    { proveedor: "opencode", modelo: "big-pickle", baseURL: "http://gw/v1" },
    { proveedor: "deepseek", modelo: "deepseek-v4-flash" },
  ] as const) {
    const remoto = ts.escribirParche(c);
    assert.ok(!remoto.includes("compaction-basic") && !remoto.includes("maxTokens"), JSON.stringify(c));
  }
  // Sin `contexto` (no hay LLAMA_CTX) el modelo local sigue con tope de salida y autocompact, pero sin `contextWindow`.
  const sinCtx = ts.escribirParche({ proveedor: "ollama", modelo: "llava:7b" });
  assert.ok(!sinCtx.includes("contextWindow") && sinCtx.includes("maxTokens: 8192") && sinCtx.includes("compaction-basic"));
});

test("motor/dsh/config.mjs y electron/dsh.ts dicen lo mismo para los modelos locales", () => {
  const casos = [
    { proveedor: "ollama", modelo: "qwen38-uncensored", contexto: 32768 },
    { proveedor: "ollama", modelo: "llava:7b", baseURL: "http://otra:11434/v1", imagenes: true },
    { proveedor: "ollama", modelo: "bonsai2-27b", contexto: 262144 },
  ] as const;
  for (const c of casos) assert.equal(mjs.escribirParche(c), ts.escribirParche(c as any), JSON.stringify(c));
  assert.deepEqual(mjs.LOCAL, ts.LOCAL);
});

test("contextoLocal: el LLAMA_CTX del env file de la clave que declara locales.json; si no hay entrada, el del nombre del modelo", () => {
  const env = locales(DECL, { hauhaucs: "# lo escribe trama\nLLAMA_CTX=40960\n", "mi-modelo": "LLAMA_CTX=8192\n" });
  // El alias de locales.json es el id de dsh; el archivo es el de su `clave`, no el del alias.
  assert.equal(ts.contextoLocal("qwen38-uncensored", env, "linux"), 40960);
  assert.equal(mjs.contextoLocal("qwen38-uncensored", env, "linux"), 40960);
  // Sin entrada: el archivo lleva el nombre del modelo (el caso literal de `<modelo>.env`).
  assert.equal(ts.contextoLocal("mi-modelo", env, "linux"), 8192);
  assert.equal(mjs.contextoLocal("mi-modelo", env, "linux"), 8192);
  // Sin archivo, sin dato, o con una clave que se sale de la carpeta: null (nunca se lee fuera).
  assert.equal(ts.contextoLocal("otro", env, "linux"), null);
  assert.equal(mjs.contextoLocal("otro", env, "linux"), null);
  const trampa = locales({ version: 1, modelos: [{ id: "x", clave: "../../etc/passwd", unit: "u", archivos: ["a"], pesosMiB: 1, capasKv: 1, ctxDefecto: 1 }] });
  assert.equal(ts.contextoLocal("x", trampa, "linux"), null);
  assert.equal(mjs.contextoLocal("x", trampa, "linux"), null);
  // Un locales.json que no es de esta versión no declara nada: vale el nombre del modelo.
  const v2 = locales({ version: 2, modelos: DECL.modelos }, { "qwen38-uncensored": "LLAMA_CTX=4096\n", hauhaucs: "LLAMA_CTX=40960\n" });
  assert.equal(ts.contextoLocal("qwen38-uncensored", v2, "linux"), 4096);
  assert.equal(mjs.contextoLocal("qwen38-uncensored", v2, "linux"), 4096);
  // Un locales.json roto tampoco tira: vale el nombre del modelo.
  const roto = locales("{no es json", { "qwen38-uncensored": "LLAMA_CTX=2048\n" });
  assert.equal(ts.contextoLocal("qwen38-uncensored", roto, "linux"), 2048);
  assert.equal(mjs.contextoLocal("qwen38-uncensored", roto, "linux"), 2048);
});

test("dsh --profile headless (y acp) con el parche local muestra el autocompact y el tope por modelo", { skip: SIN_DSH }, () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "trama-dsh-dump-"));
  tmps.push(tmp);
  const parche = path.join(tmp, "cordis.patch.yml");
  writeFileSync(parche, ts.escribirParche({ proveedor: "ollama", modelo: "qwen38-uncensored", contexto: 32768 }));
  for (const perfil of ["headless", "acp"]) {
    const salida = execFileSync(DSH!, ["--profile", perfil, "--patch", parche, "--dump-config"], {
      env: { ...process.env, DSH_HOME: path.join(tmp, `home-${perfil}`) },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    assert.match(salida, /thresholdRatio: 0\.75\s+headroomTokens: 1024\s+maxTokens: 4096/, perfil);
    assert.match(salida, /contextWindow: 32768\s+maxTokens: 8192/, perfil);
  }
});
