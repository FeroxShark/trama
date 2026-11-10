// cupo.ts: un worker de Claude que agota el cupo y al que reparto le ofrece un modelo de otro motor (gemini-*, codex:*, dsh:*) sigue en la
// MISMA corrida con ese motor (antes el pa de TypeScript se rendía). Reparto es un script de mentira y el chequeo del motor se inyecta:
// no se lanza ningún motor de verdad (el `ejecutar` de orquesta.ts decide por c.motor).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import { relanzarPorCupo } from "../electron/cli/pa/cupo.ts";
import type { Pa } from "../electron/cli/pa/entorno.ts";
import { armarLanzamiento, type Corrida } from "../electron/cli/pa/lanzar.ts";
import { llamadaDe, type Llamada, type Motores } from "../electron/cli/pa/politica.ts";

const raiz = mkdtempSync(path.join(os.tmpdir(), "cupo-otro-motor-"));
after(() => rmSync(raiz, { recursive: true, force: true }));

/** Un reparto de mentira: `--tipo` contesta `oferta`; lo demás (`--agotar`, `--tabla`) no dice nada. */
function repartoFalso(nombre: string, oferta: object): string {
  const f = path.join(raiz, `reparto-${nombre}`);
  writeFileSync(f, `#!/bin/sh\ncase "$1" in --tipo) cat <<'FIN'\n${JSON.stringify(oferta)}\nFIN\n;; esac\nexit 0\n`);
  chmodSync(f, 0o755);
  return f;
}

function armar(nombre: string, oferta: object, chequeo: Partial<Motores>, usaWorktree = false) {
  const dir = path.join(raiz, nombre);
  const proy = path.join(dir, "proy");
  mkdirSync(proy, { recursive: true });
  for (const a of [["init", "-q", "-b", "main"], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"]]) spawnSync("git", ["-C", proy, ...a]);
  let avisos = "";
  const pa: Pa = {
    env: { PATH: process.env.PATH, PA_REPARTO: repartoFalso(nombre, oferta), TRAMA_MODELOS: path.join(dir, "no-hay.json") },
    io: { out: () => {}, err: (t: string) => void (avisos += t) },
    plat: "linux",
    home: path.join(dir, "home"),
    state: path.join(dir, "estado"),
    lockdir: path.join(dir, "estado", "lock"),
    bin: path.join(dir, "motor", "bin"),
    plan: "pro",
    autocompact: null,
    puestos: 3,
    tope: 10,
    ramWorkerMb: 2048,
    ramReservaMb: 6144,
    ramRecienMin: 3,
  };
  mkdirSync(path.join(pa.state, "demo"), { recursive: true });
  const c: Corrida = {
    proyecto: "demo", slug: "demo", ts: "20261110-000000-1", ruta: proy, rutaTrabajo: proy, rama: "", base: "HEAD", origen: "", puesto: "aca", leer: false,
    usaWorktree, tengoLock: true, modelo: "claude-opus-5-5", esfuerzo: "high", cuenta: "claude", tarea: "x", tareaJefe: "x", lanzo: "jefe",
    sid: "00000000-0000-4000-8000-000000000001", resume: false, conMcp: false, maxTurns: "100", maxBudget: "", autocompact: "", baseDelta: [], jefe: "",
    jefeId: "", async: false, motor: "claude",
  };
  const lz = armarLanzamiento(pa, c);
  writeFileSync(lz.out, JSON.stringify({ type: "result", is_error: true, result: "You've hit your session limit" }));
  const l: Llamada = { ...llamadaDe({} as never), repartoTipoRelanzable: "codigo-acotado", modelo: "claude-opus-5-5" } as Llamada;
  return { pa, c, lz, l, hook: relanzarPorCupo(pa, l, chequeo), avisos: () => avisos };
}

const oferta = (modelo: string) => ({ modelo, effort: "", motivo: "con cupo" });
const SIN_RENDIRSE = /sólo corre Claude|este pa de TypeScript/;

test("Claude sin cupo y reparto ofrece gemini: la corrida pasa a agy (cuenta de google, sin effort) y se vuelve a correr", async () => {
  const chequeado: string[] = [];
  const t = armar("gemini", oferta("gemini-3.8-flash-high"), { chequearGemini: async (m) => (chequeado.push(m), "") });
  assert.equal(await t.hook(t.lz, 1), true);
  assert.equal(t.c.motor, "agy");
  assert.equal(t.c.modelo, "gemini-3.8-flash-high");
  assert.equal(t.c.esfuerzo, "");
  assert.equal(t.c.efVacio, "-");
  assert.equal(t.c.cuenta, "google");
  assert.deepEqual(chequeado, ["gemini-3.8-flash-high"]);
  assert.match(t.avisos(), /relanzo con gemini-3\.8-flash-high: con cupo/);
  assert.doesNotMatch(t.avisos(), SIN_RENDIRSE);
});

test("codex y dsh también: motor nuevo, y dsh sin cuenta", async () => {
  const cx = armar("codex", oferta("codex:gpt-5.5"), { chequearCodex: async () => "" });
  assert.equal(await cx.hook(cx.lz, 1), true);
  assert.equal(cx.c.motor, "codex");
  assert.equal(cx.c.modelo, "codex:gpt-5.5");
  const ds = armar("dsh", oferta("dsh:ollama/qwen3"), { chequearDsh: async () => "" });
  assert.equal(await ds.hook(ds.lz, 1), true);
  assert.equal(ds.c.motor, "dsh");
  assert.equal(ds.c.cuenta, "");
  assert.doesNotMatch(ds.avisos(), SIN_RENDIRSE);
});

test("si el motor ofrecido no puede correr (el chequeo da un motivo), no cambia nada y lo dice", async () => {
  const t = armar("sin-agy", oferta("gemini-3.8-flash-high"), { chequearGemini: async () => "agy no está instalado" });
  assert.equal(await t.hook(t.lz, 1), false);
  assert.equal(t.c.motor, "claude");
  assert.equal(t.c.modelo, "claude-opus-5-5");
  assert.match(t.avisos(), /reparto ofrece gemini-3\.8-flash-high pero no puede correr \(agy no está instalado\); sigo como falló/);
});

test("si el intento dejó cambios sin commitear, no se relanza (misma condición que con Claude)", async () => {
  const t = armar("con-trabajo", oferta("gemini-3.8-flash-high"), { chequearGemini: async () => "" });
  writeFileSync(path.join(t.c.rutaTrabajo, "a.txt"), "hecho");
  assert.equal(await t.hook(t.lz, 1), false);
  assert.equal(t.c.motor, "claude");
});

test("al pasar a otro motor se sueltan los enlaces de secretos del worktree", async () => {
  const t = armar("enlaces", oferta("gemini-3.8-flash-high"), { chequearGemini: async () => "" }, true);
  const destino = path.join(raiz, "secreto.env");
  writeFileSync(destino, "K=v");
  symlinkSync(destino, path.join(t.c.rutaTrabajo, ".env"));
  // el enlace se ignora en el repo, como en un worktree de verdad
  writeFileSync(path.join(t.c.rutaTrabajo, ".git", "info", "exclude"), ".env\n");
  assert.equal(await t.hook(t.lz, 1), true);
  assert.throws(() => lstatSync(path.join(t.c.rutaTrabajo, ".env")), /ENOENT/);
});
