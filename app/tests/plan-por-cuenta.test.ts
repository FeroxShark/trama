// El plan (Pro / Max) de cada cuenta de Claude: la de siempre lo guarda `pa --plan`, una agregada lo suyo (`cuentas plan ID pro|max`, en cuentas.json),
// y `pa` usa el de la cuenta en uso (`cuentas preferir`). Lo mismo en el CLI de python (motor/bin/cuentas) y en su port (electron/cli/cuentas.ts).
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../electron/cli/cuentas.ts";
import { planDe } from "../electron/cli/pa/entorno.ts";
import { listaValida } from "../src/datos/cuentas.ts";
import { planDeCuenta } from "../src/paneles/plan-claude.ts";
import { soloPosix } from "./plataforma.ts";

const tmp = mkdtempSync(path.join(os.tmpdir(), "plan-cuenta-"));
after(() => rmSync(tmp, { recursive: true, force: true }));
const CUENTAS_PY = path.join(import.meta.dirname, "..", "..", "motor", "bin", "cuentas");
let n = 0;
/** Un cuentas.json nuevo con una cuenta agregada de Claude («gonza») y otra de OpenCode. */
function nuevo(): { env: Record<string, string>; json: string } {
  const dir = path.join(tmp, `c${n++}`);
  mkdirSync(dir, { recursive: true });
  const json = path.join(dir, "cuentas.json");
  writeFileSync(json, JSON.stringify({ version: 1, cuentas: [{ id: "gonza", proveedor: "claude", nombre: "Gonza" }, { id: "oc", proveedor: "opencode", nombre: "OC" }] }));
  return { env: { HOME: dir, TRAMA_CUENTAS_HOME: dir, TRAMA_CUENTAS: json, PATH: "/usr/bin:/bin" }, json };
}
const entradas = (json: string) => (JSON.parse(readFileSync(json, "utf8")) as { cuentas: Array<Record<string, unknown>> }).cuentas;

async function ts(env: Record<string, string>, args: string[]) {
  let out = "";
  let err = "";
  const rc = await main(args, env, { out: (s) => (out += s), err: (s) => (err += s) });
  return { rc, out, err };
}
const py = (env: Record<string, string>, args: string[]) => {
  const r = spawnSync("python3", ["-I", CUENTAS_PY, ...args], { env, encoding: "utf8" });
  return { rc: r.status, out: r.stdout, err: r.stderr };
};

describe("cuentas plan ID pro|max", () => {
  for (const [nombre, correr] of [["port TS", ts], ["python", py]] as const) {
    test(`${nombre}: guarda el plan de una cuenta de Claude agregada y sale en --json`, { skip: soloPosix("el candado usa un socket abstracto de Linux") }, async () => {
      const { env, json } = nuevo();
      const r = await correr(env, ["plan", "gonza", "max"]);
      assert.equal(r.rc, 0, r.err);
      assert.equal(entradas(json).find((e) => e.id === "gonza")?.plan, "max");
      const l = JSON.parse((await correr(env, ["--json"])).out) as { cuentas: Array<{ id: string; plan?: string }> };
      assert.deepEqual(l.cuentas.filter((c) => c.plan).map((c) => [c.id, c.plan]), [["gonza", "max"], ["oc", "gratis"]]);
      // Cambiarlo de nuevo.
      assert.equal((await correr(env, ["plan", "gonza", "pro"])).rc, 0);
      assert.equal(entradas(json).find((e) => e.id === "gonza")?.plan, "pro");
    });
    test(`${nombre}: la cuenta de siempre y una que no es de Claude no aceptan pro|max`, { skip: soloPosix("el candado usa un socket abstracto de Linux") }, async () => {
      const { env, json } = nuevo();
      assert.equal((await correr(env, ["plan", "claude", "max"])).rc, 2);
      assert.equal((await correr(env, ["plan", "oc", "max"])).rc, 1);
      assert.equal((await correr(env, ["plan", "nadie", "max"])).rc, 1);
      assert.equal(entradas(json).some((e) => "plan" in e), false);
      // El plan de OpenCode sigue siendo el de siempre.
      assert.equal((await correr(env, ["plan", "oc", "go"])).rc, 0);
      assert.equal(entradas(json).find((e) => e.id === "oc")?.plan, "go");
    });
  }
});

describe("pa usa el plan de la cuenta en uso", () => {
  const io = { out: () => undefined, err: () => undefined };
  const estado = () => {
    const d = path.join(tmp, `estado${n++}`);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const con = (preferidas: unknown, cuentas: unknown[]) => {
    const { env, json } = nuevo();
    writeFileSync(json, JSON.stringify({ version: 1, cuentas, ...(preferidas ? { preferidas } : {}) }));
    return env;
  };
  const home = (env: Record<string, string>) => env.HOME!;

  test("la cuenta agregada en uso con plan propio manda sobre el archivo de la de siempre", () => {
    const e = con({ claude: "gonza" }, [{ id: "gonza", proveedor: "claude", plan: "max" }]);
    const st = estado();
    writeFileSync(path.join(st, "plan"), "pro\n");
    assert.equal(planDe(e, st, io, home(e)), "max");
  });
  test("sin elegir (la de siempre en uso) o sin plan propio: el archivo; sin nada, pro", () => {
    const st = estado();
    writeFileSync(path.join(st, "plan"), "max\n");
    const sinPref = con(null, [{ id: "gonza", proveedor: "claude", plan: "pro" }]);
    assert.equal(planDe(sinPref, st, io, home(sinPref)), "max");
    const sinPlan = con({ claude: "gonza" }, [{ id: "gonza", proveedor: "claude" }]);
    assert.equal(planDe(sinPlan, st, io, home(sinPlan)), "max");
    assert.equal(planDe(sinPlan, estado(), io, home(sinPlan)), "pro");
  });
  test("PA_PLAN del entorno le gana a todo; un plan raro en cuentas.json se ignora", () => {
    const e = con({ claude: "gonza" }, [{ id: "gonza", proveedor: "claude", plan: "max" }]);
    assert.equal(planDe({ ...e, PA_PLAN: "pro" }, estado(), io, home(e)), "pro");
    const raro = con({ claude: "gonza" }, [{ id: "gonza", proveedor: "claude", plan: "ultra" }]);
    assert.equal(planDe(raro, estado(), io, home(raro)), "pro");
  });
  test("una cuenta de otro proveedor con ese id no cuenta", () => {
    const e = con({ claude: "gonza" }, [{ id: "gonza", proveedor: "opencode", plan: "max" }]);
    assert.equal(planDe(e, estado(), io, home(e)), "pro");
  });
});

describe("la interfaz", () => {
  test("listaValida: el plan de una cuenta de Claude agregada sale como planClaude; el de la de siempre no", () => {
    const l = listaValida({ version: 1, cuentas: [{ id: "claude", proveedor: "claude", nombre: "C", plan: "max" }, { id: "gonza", proveedor: "claude", nombre: "G", plan: "max" }, { id: "otra", proveedor: "claude", nombre: "O", plan: "ultra" }] });
    assert.deepEqual(l?.cuentas.map((c) => c.planClaude ?? null), [null, "max", null]);
  });
  test("planDeCuenta: el propio, o el de la de siempre si no eligió", () => {
    const base = { proveedor: "claude" as const, nombre: "x", preferida: false, logueado: true };
    assert.deepEqual(planDeCuenta({ ...base, id: "claude", defecto: true }, "pro"), { plan: "pro", propio: true });
    assert.deepEqual(planDeCuenta({ ...base, id: "g", defecto: false, planClaude: "max" }, "pro"), { plan: "max", propio: true });
    assert.deepEqual(planDeCuenta({ ...base, id: "g", defecto: false }, "pro"), { plan: "pro", propio: false });
    assert.deepEqual(planDeCuenta({ ...base, id: "g", defecto: false }, null), { plan: null, propio: false });
  });
});
