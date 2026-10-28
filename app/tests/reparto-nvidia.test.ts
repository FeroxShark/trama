// NVIDIA NIM en `reparto` (motor/bin/reparto): con NVIDIA_API_KEY (entorno o claves.env) los modelos de `nvidia_modelos` de modelos.json (default
// deepseek-ai/deepseek-v4.1-flash) son candidatos gratis `opencode:nvidia/<modelo>`, grupo `nvidia-nim`. Sin la key no aparecen. Un 429 (por minuto)
// enfría SÓLO ese modelo (`--enfriar --horas`), no agota ningún grupo. Sin red: opencode y la hora van fijos por entorno; la key es de mentira.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-nvidia-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const arch = (j: object | string) => {
  const f = path.join(tmp, `a${n++}.json`);
  writeFileSync(f, typeof j === "string" ? j : JSON.stringify(j));
  return f;
};

const AHORA = "2026-10-28T12:00:00Z";
const CUPOS = arch({ version: 1, leido: AHORA, suscripciones: [{ id: "claude", nombre: "Claude", proveedor: "claude", cuenta: "claude", ventanas: [{ id: "5h", usado: 0.2, vuelve: "2026-10-28T14:00:00Z" }, { id: "7d", usado: 0.3, vuelve: "2026-10-30T00:00:00Z" }] }] });
const NV = "opencode:nvidia/deepseek-ai/deepseek-v4.1-flash";

function reparto(args: string[], o: { key?: string; claves?: string; modelos?: object; estado?: string; env?: Record<string, string> } = {}) {
  const r = spawnSync(REPARTO, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      NVIDIA_API_KEY: o.key ?? "",
      TRAMA_CLAVES: o.claves ?? path.join(tmp, "no-existe.env"),
      REPARTO_CUPOS_FIJOS: CUPOS,
      REPARTO_AHORA: AHORA,
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      REPARTO_AGY: "0",
      REPARTO_AA: "0",
      HILOS_STATE: path.join(tmp, "hilos-estado"),
      REPARTO_STATE: o.estado ?? path.join(tmp, `estado${n++}`),
      PA_STATE: path.join(tmp, "pa-estado"),
      TRAMA_MODELOS: arch({ version: 1, ...o.modelos }),
      ...o.env,
    },
  });
  return { rc: r.status, out: r.stdout, err: r.stderr };
}
type Fila = { modelo: string; gratis: boolean; grupo: string; origen: string; descartado_por: string | null };
const tabla = (o?: Parameters<typeof reparto>[1]) => {
  const r = reparto(["--tabla", "--json"], o);
  assert.equal(r.rc, 0, r.err);
  return (JSON.parse(r.out).modelos as (Fila & { id: string })[]).map((f) => ({ ...f, modelo: f.id }));
};
/** Los candidatos que ve `--tipo` (ahí se ve por qué se descartó cada uno: enfriado, etc.). */
const candidatos = (o: Parameters<typeof reparto>[1]) => {
  const r = reparto(["--tipo", "codigo-acotado", "--json"], o);
  assert.equal(r.rc, 0, r.err);
  return JSON.parse(r.out).candidatos as Fila[];
};

test("con NVIDIA_API_KEY, deepseek-v4.1-flash de NVIDIA NIM es candidato gratis en su grupo nvidia-nim", () => {
  const f = tabla({ key: "clave-de-mentira" }).find((c) => c.modelo === NV);
  assert.ok(f, "debe estar en la tabla");
  assert.equal(f.gratis, true);
  assert.equal(f.grupo, "nvidia-nim");
  assert.equal(f.origen, "defecto", "la calidad sale de la tabla de defaults, igual que la del *-free de OpenCode");
  const txt = reparto(["--tabla"], { key: "clave-de-mentira" }).out;
  assert.match(txt, /opencode:nvidia\/deepseek-ai\/deepseek-v4\.1-flash\s.*gratis/);
  assert.doesNotMatch(txt, /clave-de-mentira/, "la key nunca se imprime");
});

test("sin la key no aparece; con la key sólo en claves.env, sí", () => {
  assert.equal(tabla().some((c) => c.modelo.startsWith("opencode:nvidia/")), false);
  const claves = path.join(tmp, "claves.env");
  writeFileSync(claves, 'OTRA=1\nexport NVIDIA_API_KEY="clave-de-mentira"\n');
  assert.ok(tabla({ claves }).some((c) => c.modelo === NV));
});

test("sin opencode instalado, o con REPARTO_NVIDIA=0, no aparece", () => {
  const sinOpencode = { key: "k", env: { REPARTO_OPENCODE_FIJO: "", HILOS_OPENCODE: path.join(tmp, "no-hay-opencode") } };
  assert.equal(tabla(sinOpencode).some((c) => c.modelo.startsWith("opencode:nvidia/")), false);
  assert.equal(tabla({ key: "k", env: { REPARTO_NVIDIA: "0" } }).some((c) => c.modelo.startsWith("opencode:nvidia/")), false);
});

test("nvidia_modelos de modelos.json manda la lista ([] la apaga)", () => {
  const ids = tabla({ key: "k", modelos: { nvidia_modelos: ["moonshotai/kimi-x", "mal id con espacios"] } }).map((c) => c.modelo).filter((m) => m.startsWith("opencode:nvidia/"));
  assert.deepEqual(ids, ["opencode:nvidia/moonshotai/kimi-x"]);
  assert.equal(tabla({ key: "k", modelos: { nvidia_modelos: [] } }).some((c) => c.modelo.startsWith("opencode:nvidia/")), false);
});

test("un 429 enfría sólo ese modelo unos minutos; --agotar no inventa un grupo; los gratis de OpenCode siguen", () => {
  const estado = path.join(tmp, "estado-429");
  const e = reparto(["--enfriar", NV, "--horas", "0.0833"], { key: "k", estado });
  assert.equal(e.rc, 0, e.err);
  const a = reparto(["--agotar", NV], { key: "k", estado });
  assert.notEqual(a.rc, 0, "NVIDIA no tiene grupo que agotar (límite por minuto, por modelo)");
  const t = candidatos({ key: "k", estado });
  const nv = t.find((c) => c.modelo === NV)!;
  assert.match(nv.descartado_por ?? "", /enfriándose hasta 2026-10-28T12:04:5\d/);
  assert.equal(t.find((c) => c.modelo === "opencode:opencode/big-pickle")!.descartado_por, null, "el grupo opencode-free no se toca");
  // Pasados los minutos vuelve solo.
  const luego = candidatos({ key: "k", estado, env: { REPARTO_AHORA: "2026-10-28T12:10:00Z" } }).find((c) => c.modelo === NV)!;
  assert.equal(luego.descartado_por, null);
});
