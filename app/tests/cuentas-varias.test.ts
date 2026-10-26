// Varias cuentas por proveedor (electron/cuentas-varias.ts y sus canales): contra un `cuentas` de mentira (`correr` falso), nunca el real.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const v = await import("../electron/cuentas-varias.ts");
const { cuentasVarias } = await import("../electron/cuentas-varias-canales.ts");
const { esCuentaDeSiempre } = await import("../electron/uso.ts");
type Deps = import("../electron/cuentas-varias.ts").DepsVarias;
type Salida = Awaited<ReturnType<Deps["correr"]>>;

const LISTA = {
  version: 1,
  cuentas: [
    { id: "claude", proveedor: "claude", motor: "claude", nombre: "Claude", dir: "~/.claude", defecto: true, logueado: true },
    { id: "trabajo", proveedor: "claude", motor: "claude", nombre: "Trabajo", dir: "x", defecto: false, logueado: false },
    { id: "raro", proveedor: "otro", nombre: "x" },
    { id: "../mal", proveedor: "claude", nombre: "mal" },
  ],
};

const ok = (stdout = ""): Salida => ({ code: 0, stdout, stderr: "", tiempo: false, noExiste: false });

/** Un `correr` que anota cada llamada y contesta lo que se le pida por el primer argumento. */
function falso(respuestas: Record<string, Salida> = {}) {
  const llamadas: { bin: string; args: string[] }[] = [];
  const deps: Deps = {
    env: { HILOS_CUENTAS: "/falso/cuentas", PATH: "/usr/bin" },
    home: "/casa",
    esEjecutable: () => true,
    correr: async (bin, args) => {
      llamadas.push({ bin, args });
      return respuestas[args[0]] ?? ok(JSON.stringify(LISTA));
    },
    terminal: async (argv) => {
      llamadas.push({ bin: "terminal", args: argv });
      return { err: null };
    },
  };
  return { deps, llamadas };
}

describe("lista de cuentas", () => {
  it("sólo deja las que tienen id y proveedor conocidos; el login sin dato es null", () => {
    const l = v.parsearCuentas(JSON.stringify({ ...LISTA, cuentas: [...LISTA.cuentas, { id: "g2", proveedor: "google", nombre: "Otra", logueado: "sí" }] }));
    assert.deepEqual(l?.cuentas.map((c) => [c.id, c.defecto, c.logueado]), [["claude", true, true], ["trabajo", false, false], ["g2", false, null]]);
  });

  it("una salida que no es el contrato es null (la app queda como siempre)", () => {
    assert.equal(v.parsearCuentas("no es json"), null);
    assert.equal(v.parsearCuentas(JSON.stringify({ version: 2, cuentas: [] })), null);
    assert.equal(v.parsearCuentas(JSON.stringify({ version: 1, cuentas: [] })), null);
  });

  it("pide `--json`, y con --verificar el login de cada una", async () => {
    const { deps, llamadas } = falso();
    assert.equal((await v.listarCuentas(deps))?.cuentas.length, 2);
    await v.listarCuentas(deps, true);
    assert.deepEqual(llamadas.map((l) => l.args), [["--json"], ["--json", "--verificar"]]);
    assert.equal(llamadas[0].bin, "/falso/cuentas");
  });

  it("sin el comando `cuentas`, la lista es null y hayCuentas es false", async () => {
    const { deps } = falso({ "--json": { code: null, stdout: "", stderr: "", tiempo: false, noExiste: true } });
    assert.equal(await v.listarCuentas(deps), null);
    assert.equal(await v.hayCuentas(deps), false);
  });
});

describe("alta, renombre, baja y login", () => {
  it("agregar corre `agregar proveedor nombre` y devuelve el id de la última línea", async () => {
    const { deps, llamadas } = falso({ agregar: { ...ok("aviso suelto\ntrabajo-2\n"), stderr: "falta el login" } });
    assert.equal(await v.agregarCuenta(deps, "claude", "  Trabajo   2 "), "trabajo-2");
    assert.deepEqual(llamadas[0].args, ["agregar", "claude", "Trabajo 2"]);
  });

  it("un proveedor o un nombre que no valen no llegan al comando", async () => {
    const { deps, llamadas } = falso();
    await assert.rejects(v.agregarCuenta(deps, "otro", "x"));
    await assert.rejects(v.agregarCuenta(deps, "claude", "   "));
    await assert.rejects(v.agregarCuenta(deps, "claude", "x".repeat(61)));
    await assert.rejects(v.renombrarCuenta(deps, "../mal", "x"));
    assert.equal(llamadas.length, 0);
  });

  it("un id raro de vuelta es un fallo, no una cuenta", async () => {
    const { deps } = falso({ agregar: ok("../mal\n") });
    await assert.rejects(v.agregarCuenta(deps, "claude", "x"));
  });

  it("renombrar y quitar (con o sin borrar credenciales); la de siempre no se quita", async () => {
    const { deps, llamadas } = falso();
    await v.renombrarCuenta(deps, "trabajo", "Casa");
    await v.quitarCuenta(deps, "trabajo", false);
    await v.quitarCuenta(deps, "trabajo", true);
    assert.deepEqual(llamadas.map((l) => l.args), [["renombrar", "trabajo", "Casa"], ["quitar", "trabajo"], ["quitar", "trabajo", "--borrar-credenciales"]]);
    await assert.rejects(v.quitarCuenta(deps, "claude", true));
    assert.equal(llamadas.length, 3);
  });

  it("un código de salida distinto de 0 vuelve con lo que dijo el comando", async () => {
    const { deps } = falso({ renombrar: { code: 2, stdout: "", stderr: "no existe esa cuenta\n", tiempo: false, noExiste: false } });
    await assert.rejects(v.renombrarCuenta(deps, "trabajo", "x"), /no existe esa cuenta/);
  });

  it("login abre `cuentas login <id>` en una terminal; sin terminal lo dice", async () => {
    const { deps, llamadas } = falso();
    await v.loginCuenta(deps, "trabajo");
    assert.deepEqual(llamadas[0], { bin: "terminal", args: ["/falso/cuentas", "login", "trabajo"] });
    await assert.rejects(v.loginCuenta({ ...deps, terminal: undefined }, "trabajo"));
    await assert.rejects(v.loginCuenta(deps, "../mal"));
  });
});

describe("canales cuentas:*", () => {
  function registrar(deps: Deps) {
    const canales = new Map<string, (e: unknown, ...a: unknown[]) => unknown>();
    let cambios = 0;
    cuentasVarias((c, fn) => canales.set(c, fn), deps, () => cambios++);
    const llamar = (c: string, ...a: unknown[]) => canales.get(c)!(null, ...a) as Promise<any>;
    return { llamar, cambios: () => cambios, canales };
  }

  it("registra los cinco canales", () => {
    const { canales } = registrar(falso().deps);
    assert.deepEqual([...canales.keys()].sort(), ["cuentas:agregar", "cuentas:lista", "cuentas:login", "cuentas:quitar", "cuentas:renombrar"]);
  });

  it("devuelven { ok } y nunca tiran: un fallo vuelve como { ok: false, error }", async () => {
    const { llamar, cambios } = registrar(falso({ agregar: ok("trabajo-2\n") }).deps);
    assert.deepEqual(await llamar("cuentas:agregar", "claude", "Trabajo 2"), { ok: true, id: "trabajo-2" });
    assert.deepEqual(await llamar("cuentas:renombrar", "trabajo", "Casa"), { ok: true });
    const mal = await llamar("cuentas:agregar", "otro", "x");
    assert.equal(mal.ok, false);
    assert.match(mal.error, /main\.cuentasDato/);
    assert.equal(cambios(), 3);
  });

  it("lista da null sin el comando", async () => {
    const sin = falso({ "--json": { code: null, stdout: "", stderr: "", tiempo: false, noExiste: true } });
    assert.equal(await registrar(sin.deps).llamar("cuentas:lista", false), null);
  });
});

describe("el statusline de otra cuenta no es el cupo de siempre", () => {
  it("config_dir vacío o ~/.claude es la de siempre; otra carpeta no", () => {
    assert.equal(esCuentaDeSiempre({}, "/casa"), true);
    assert.equal(esCuentaDeSiempre({ config_dir: null }, "/casa"), true);
    assert.equal(esCuentaDeSiempre({ config_dir: "" }, "/casa"), true);
    assert.equal(esCuentaDeSiempre({ config_dir: "/casa/.claude/" }, "/casa"), true);
    assert.equal(esCuentaDeSiempre({ config_dir: "~/.claude" }, "/casa"), true);
    assert.equal(esCuentaDeSiempre({ config_dir: "/casa/.config/trama/cuentas/trabajo" }, "/casa"), false);
  });
});
