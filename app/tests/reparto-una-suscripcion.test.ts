// P6 (CTX-9 y CTX-10): `reparto` con una sola suscripción o ninguna. Corre el `reparto` real (TS) con todo apagado salvo lo que cada caso pide.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "electron", "cli", "reparto.ts");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-1susc-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const carpeta = () => {
  const d = path.join(tmp, `d${n++}`);
  mkdirSync(d, { recursive: true });
  return d;
};
const arch = (j: object) => {
  const f = path.join(carpeta(), "a.json");
  writeFileSync(f, JSON.stringify(j));
  return f;
};
type Cand = { modelo: string; descartado_por: string | null; relajado?: boolean };
type Sal = { modelo: string | null; candidatos: Cand[]; avisos: string[]; motivo?: string };

/** Corre `reparto --tipo X --json` (el port TS) con un HOME falso; `claude` es un ejecutable vacío en `~/.local/bin` y `sesion` decide si hay credentials. */
function elegir(tipo: string, o: { mod?: object; env?: Record<string, string>; claude?: "sin-sesion" | "con-sesion" | "no-instalado"; fijos?: object[] }): Sal {
  const home = carpeta();
  if (o.claude && o.claude !== "no-instalado") {
    mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    const bin = path.join(home, ".local", "bin", "claude");
    writeFileSync(bin, "#!/bin/sh\nexit 0\n");
    chmodSync(bin, 0o755);
  }
  if (o.claude === "con-sesion") {
    mkdirSync(path.join(home, ".claude"), { recursive: true });
    writeFileSync(path.join(home, ".claude", ".credentials.json"), JSON.stringify({ claudeAiOauth: { accessToken: "token-falso", subscriptionType: "pro" } }));
  }
  const r = spawnSync(process.execPath, [REPARTO, "--tipo", tipo, "--json"], {
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin", HOME: home, TZ: "UTC", REPARTO_AHORA: "2026-11-21T12:00:00Z", REPARTO_AA: "0", REPARTO_AA_FOTO: "0", REPARTO_AA_SUPLEMENTO: "0", REPARTO_CARGA_FIJA: "{}",
      TRAMA_GO_SIN_RED: "1", REPARTO_AVISAR: "0", REPARTO_AGY: "0", REPARTO_DSH: "0", REPARTO_CODEX: "0", REPARTO_OPENCODE: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}', REPARTO_OPENCODE_FIJO: "[]",
      ...(o.fijos ? { REPARTO_CUPOS_FIJOS: arch({ version: 1, leido: "2026-11-21T12:00:00Z", suscripciones: o.fijos }) } : {}),
      TRAMA_MODELOS: arch({ version: 1, ...o.mod }), PA_STATE: carpeta(), HILOS_STATE: carpeta(), CODEX_HOME: carpeta(), REPARTO_STATE: carpeta(), REPARTO_MEDICION: path.join(tmp, "med.tsv"),
      ...o.env,
    },
  });
  assert.ok(r.status === 0 || r.status === 1, r.stderr);
  return JSON.parse(r.stdout) as Sal;
}
const claudes = (s: Sal) => s.candidatos.filter((c) => c.modelo.startsWith("claude-") && !c.descartado_por);

// CTX-9
test("con `claude` instalado pero sin sesión no se ofrece ningún modelo de Claude", () => {
  const s = elegir("codigo-acotado", { claude: "sin-sesion" });
  assert.equal(s.modelo, null, String(s.modelo));
  assert.equal(s.candidatos.filter((c) => c.modelo.startsWith("claude-")).length, 0, JSON.stringify(s.candidatos.map((c) => c.modelo)));
});
test("con `claude` no instalado tampoco", () => {
  const s = elegir("codigo-acotado", { claude: "no-instalado" });
  assert.equal(s.modelo, null, String(s.modelo));
});
test("con `claude` instalado y con sesión sí se ofrece", () => {
  const s = elegir("codigo-acotado", { claude: "con-sesion" });
  assert.ok(claudes(s).length > 0, JSON.stringify(s.candidatos));
});
test("una clave de API en el entorno cuenta como sesión", () => {
  const s = elegir("codigo-acotado", { claude: "sin-sesion", env: { ANTHROPIC_API_KEY: "clave-falsa" } });
  assert.ok(claudes(s).length > 0);
});

// CTX-10
test("con sólo un modelo local sin calidad medida y un tipo, se lanza el local", () => {
  const s = elegir("codigo-acotado", { claude: "no-instalado", mod: { locales: [{ id: "qwen-local", nombre: "Qwen local" }] } });
  assert.equal(s.modelo, "qwen-local", JSON.stringify(s));
  assert.match(s.motivo ?? "", /uso el mejor que hay/, "el motivo dice que se relajó la calidad");
});
test("un local excluido en Ajustes no se revive aunque sea el único", () => {
  const s = elegir("codigo-acotado", { claude: "no-instalado", mod: { locales: [{ id: "qwen-local", nombre: "Qwen local" }], excluir: ["qwen-local"] } });
  assert.equal(s.modelo, null, String(s.modelo));
});
test("un local no le gana a un modelo que sí pasa el mínimo", () => {
  const s = elegir("codigo-acotado", { claude: "con-sesion", mod: { locales: [{ id: "qwen-local", nombre: "Qwen local" }] } });
  assert.ok(s.modelo?.startsWith("claude-"), String(s.modelo));
});
