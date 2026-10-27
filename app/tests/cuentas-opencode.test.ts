// Varias cuentas de OpenCode, de punta a punta sin un login real: agregar (carpeta propia), elegir (el entorno y los argumentos con que corre un
// worker, `pa --cuenta`, y un líder) y quitar (borra sólo su carpeta; nunca el estado ni los datos de la persona). Con un `opencode` falso que anota
// con qué entorno y argumentos lo llamaron, y, si hay un opencode de verdad, que una cuenta nueva arranca aislada (sin el login de nadie).
//
// Lo que se midió con opencode 2.1.4 y por qué el aislamiento es así: el login vive en `$XDG_DATA_HOME/opencode/opencode.db` (tabla `credential`);
// cambiar sólo XDG_DATA_HOME no alcanza porque el CLI habla con un servicio de fondo (puerto 49374, registro en `$XDG_STATE_HOME/opencode/service.json`)
// que ya corre con los datos de la persona: hace falta `--standalone` (servidor propio) y, de yapa, un XDG_STATE_HOME propio (si falta el flag falla en vez
// de usar la cuenta equivocada). Ver el encabezado de motor/bin/cuentas.
import { after, describe, it } from "node:test";
import { testPosix } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { listaValida } from "../src/datos/cuentas.ts";
import { OPENCODE, SIN_OPENCODE } from "./opencode-ayuda.ts";
import { conCuentaOpencode, cuentaAgregadaDe, entornoDeSalida } from "../electron/opencode-cuenta.ts";
import { anotarPedidos, leerPedidos, marcasDeCuenta, suscripcionOpencode } from "../electron/opencode-pedidos.ts";
import { marcarModeloGoAgotado, marcarOpencodeAgotado, marcasOpencode, modelosGoAgotados, opencodeAgotadoHasta } from "../electron/opencode-agotado.ts";
import { conModeloChico } from "../electron/opencode.ts";

const MOTOR = path.join(import.meta.dirname, "..", "..", "motor");
const CUENTAS = path.join(MOTOR, "bin", "cuentas");
const tmp = mkdtempSync(path.join(os.tmpdir(), "cuentas-oc-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

// El «dueño»: un home con su estado y sus datos de opencode, que ninguna operación sobre una cuenta agregada puede tocar.
const home = path.join(tmp, "home");
const cfg = path.join(home, ".config", "trama");
const estadoDueno = path.join(home, ".local", "state", "opencode");
const datosDueno = path.join(home, ".local", "share", "opencode");
mkdirSync(estadoDueno, { recursive: true });
mkdirSync(datosDueno, { recursive: true });
writeFileSync(path.join(estadoDueno, "service.json"), '{"id":"x","pid":1}');
writeFileSync(path.join(datosDueno, "opencode.db"), "BASE-DEL-DUENO");
const huellaDueno = () => JSON.stringify([readFileSync(path.join(estadoDueno, "service.json"), "utf8"), readFileSync(path.join(datosDueno, "opencode.db"), "utf8"), readdirSync(estadoDueno), readdirSync(datosDueno)]);
const antes = huellaDueno();

// Un `opencode` falso: anota cada llamada (argumentos y carpetas) en $FALSO_LOG; `--help` dice que tiene `--standalone`; `auth list` contesta como 2.x
// (`[]` sin login, una integración con login si la carpeta de datos tiene el archivo `login`); `run` imprime los eventos con el entorno que vio.
const bin = path.join(tmp, "bin");
mkdirSync(bin, { recursive: true });
const falso = path.join(bin, "opencode");
writeFileSync(
  falso,
  `#!/bin/bash
echo "$*|DATA=$XDG_DATA_HOME|STATE=$XDG_STATE_HOME|CUENTA=$TRAMA_OPENCODE_CUENTA" >> "\${FALSO_LOG:-/dev/null}"
case "$*" in
  *--help*) printf 'FLAGS\\n  --standalone    Run with a private server\\n  --variant string  x\\n'; exit 0 ;;
  "models"*) if [[ -n "$FALSO_MODELOS" ]]; then printf '%b' "$FALSO_MODELOS"; [[ "$FALSO_MODELOS" == "-" ]] && exit 1; else printf 'opencode/beam-free\\nopencode/big-pickle\\n'; fi; exit 0 ;;
  "auth list"*)
    if [[ -f "$XDG_DATA_HOME/opencode/login" ]]; then echo '[{"id":"opencode","name":"OpenCode Console","connections":[{"type":"oauth","id":"c1","label":"Personal","method":"x"}]}]'; else echo '[]'; fi
    exit 0 ;;
esac
cat >/dev/null
echo '{"type":"step_start","sessionID":"ses_f","part":{}}'
echo '{"type":"text","sessionID":"ses_f","part":{"text":"RESULTADO: llamado '"$*"' con DATA='"$XDG_DATA_HOME"' STATE='"$XDG_STATE_HOME"' CUENTA='"$TRAMA_OPENCODE_CUENTA"' PLAN='"$TRAMA_OPENCODE_PLAN"'\\nARCHIVOS: ninguno\\nDECISION: ninguna\\nSIGUE: nada"}}'
echo '{"type":"step_finish","sessionID":"ses_f","part":{"reason":"stop","cost":0,"tokens":{"input":5,"output":2,"reasoning":0,"cache":{"read":0,"write":0}}}}'
`,
);
chmodSync(falso, 0o755);
const log = path.join(tmp, "falso.log");

function cuentas(args: string[], env: Record<string, string> = {}, opencode: string | null = falso) {
  const r = spawnSync(CUENTAS, args, {
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...process.env,
      HOME: home,
      TRAMA_CUENTAS_HOME: home,
      TRAMA_CUENTAS: path.join(cfg, "cuentas.json"),
      FALSO_LOG: log,
      PATH: `${opencode ? path.dirname(opencode) : bin}:${process.env.PATH}`,
      ...env,
    },
  });
  return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
}
const json = (args: string[], env: Record<string, string> = {}) => JSON.parse(cuentas(args, env).out);
const llamadas = () => (existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : []);

describe("agregar", () => {
  testPosix("crea la cuenta con su carpeta (datos y estado propios, marca) y la de siempre no toca nada", () => {
    const r = cuentas(["agregar", "opencode", "Trabajo"]);
    assert.equal(r.rc, 0, r.err);
    assert.equal(r.out.trim(), "trabajo");
    const dir = path.join(cfg, "cuentas", "trabajo");
    for (const d of ["data", "state"]) assert.ok(lstatSync(path.join(dir, d)).isDirectory(), d);
    assert.equal(readFileSync(path.join(dir, ".trama-cuenta"), "utf8").trim(), "trabajo");
    // Ni dentro del estado ni de los datos de la persona.
    assert.ok(!dir.startsWith(estadoDueno) && !dir.startsWith(datosDueno));
    const l = json(["--json"]).cuentas;
    assert.deepEqual(l.map((c: any) => [c.id, c.defecto, c.plan ?? null]), [["claude", true, null], ["google", true, null], ["opencode", true, null], ["trabajo", false, "gratis"]]);
    assert.equal(huellaDueno(), antes);
  });

  testPosix("el plan de la cuenta se cambia con `plan`; la de siempre no (es de modelos.json)", () => {
    assert.equal(cuentas(["plan", "trabajo", "go"]).rc, 0);
    assert.equal(json(["env", "trabajo", "--json"]).plan, "go");
    assert.equal(cuentas(["plan", "opencode", "go"]).rc, 2);
  });
});

describe("elegir: el entorno con que corre", () => {
  testPosix("`cuentas env`: la agregada trae sus carpetas y su id; la de siempre no pone nada", () => {
    const e = json(["env", "trabajo", "--json"]);
    const dir = path.join(cfg, "cuentas", "trabajo");
    assert.deepEqual(e.poner, { XDG_DATA_HOME: path.join(dir, "data"), XDG_STATE_HOME: path.join(dir, "state"), TRAMA_OPENCODE_CUENTA: "trabajo", TRAMA_OPENCODE_PLAN: "go" });
    assert.deepEqual(e.sacar, []);
    const d = json(["env", "opencode", "--json"]);
    assert.deepEqual(d.poner, {});
    assert.equal(d.defecto, true);
  });

  testPosix("el login de una agregada lleva su entorno y --standalone; el de la de siempre, nada de eso", () => {
    const a = cuentas(["login", "trabajo", "--imprimir"]).out.trim();
    assert.match(a, /^env .*XDG_DATA_HOME=\S+\/cuentas\/trabajo\/data .*XDG_STATE_HOME=\S+\/cuentas\/trabajo\/state .*\/opencode auth login --standalone$/);
    const d = cuentas(["login", "opencode", "--imprimir"]).out.trim();
    assert.match(d, /^\S*opencode auth login$/);
    assert.doesNotMatch(d, /XDG|standalone|env /);
  });

  testPosix("un opencode sin --standalone (1.x) no lo recibe: ahí alcanza con su XDG_DATA_HOME", () => {
    const viejo = path.join(tmp, "viejo");
    mkdirSync(viejo, { recursive: true });
    writeFileSync(path.join(viejo, "opencode"), "#!/bin/sh\necho 'FLAGS'\n");
    chmodSync(path.join(viejo, "opencode"), 0o755);
    const a = cuentas(["login", "trabajo", "--imprimir"], {}, path.join(viejo, "opencode")).out.trim();
    assert.doesNotMatch(a, /standalone/);
    assert.match(a, /XDG_DATA_HOME=/);
  });

  testPosix("verificar: pregunta con el entorno de ESA cuenta y --standalone; sin login es false, con login true", () => {
    rmSync(log, { force: true });
    assert.equal(json(["ver", "trabajo", "--json", "--verificar"]).logueado, false);
    const q = llamadas().filter((l) => l.startsWith("auth list") && !l.includes("--help"));
    assert.ok(q.length >= 1);
    const dir = path.join(cfg, "cuentas", "trabajo");
    for (const l of q) {
      assert.match(l, /--standalone/);
      assert.ok(l.includes(`DATA=${path.join(dir, "data")}|STATE=${path.join(dir, "state")}`), l);
    }
    mkdirSync(path.join(dir, "data", "opencode"), { recursive: true });
    writeFileSync(path.join(dir, "data", "opencode", "login"), "x");
    assert.equal(json(["ver", "trabajo", "--json", "--verificar"]).logueado, true);
    // Sin --verificar no se sabe (no se lanza nada): null, no un false inventado.
    rmSync(log, { force: true });
    assert.equal(json(["ver", "trabajo", "--json"]).logueado, null);
    assert.deepEqual(llamadas().filter((l) => l.startsWith("auth list")), []);
  });
});

describe("pa y el runner: un worker con `--cuenta`", () => {
  const proy = path.join(tmp, "proy");
  const estado = path.join(tmp, "estado");
  const shim = path.join(tmp, "shim");
  for (const d of [path.join(home, ".config", "proyectos"), proy, estado, shim]) mkdirSync(d, { recursive: true });
  const git = (...a: string[]) => spawnSync("git", ["-C", proy, "-c", "user.email=a@b", "-c", "user.name=x", ...a], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "init");
  writeFileSync(path.join(home, ".config", "proyectos", "registry.json"), JSON.stringify({ projects: [{ name: "demo", path: proy }] }));
  if (spawnSync("sh", ["-c", "command -v uuidgen"]).status !== 0) {
    writeFileSync(path.join(shim, "uuidgen"), "#!/bin/sh\ncat /proc/sys/kernel/random/uuid\n");
    chmodSync(path.join(shim, "uuidgen"), 0o755);
  }
  const pa = (args: string[], env: Record<string, string> = {}) => {
    const r = spawnSync(path.join(MOTOR, "bin", "pa"), args, {
      encoding: "utf8",
      timeout: 90_000,
      env: {
        ...process.env,
        HOME: home,
        XDG_CONFIG_HOME: path.join(home, ".config"),
        PA_STATE: estado,
        STATE: estado,
        REPARTO_STATE: path.join(estado, "reparto"),
        PROYECTOS_REGISTRY: path.join(home, ".config", "proyectos", "registry.json"),
        TRAMA_MODELOS: path.join(home, "no-hay.json"),
        TRAMA_CLAVES: path.join(home, "no-hay.env"),
        TRAMA_CUENTAS: path.join(cfg, "cuentas.json"),
        TRAMA_CUENTAS_HOME: home,
        PA_REPARTO: "0",
        HILOS_OPENCODE: falso,
        FALSO_LOG: log,
        PATH: `${MOTOR}/bin:${shim}:${bin}:${process.env.PATH}`,
        ...env,
      },
    });
    return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
  };

  testPosix("--cuenta trabajo: opencode corre con SUS carpetas, su id, su plan y --standalone; sus pedidos se anotan con su cuenta", () => {
    rmSync(log, { force: true });
    const r = pa(["demo", "-m", "opencode:opencode/beam-free", "--cuenta", "trabajo", "haceme algo"]);
    assert.equal(r.rc, 0, r.err + r.out);
    const dir = path.join(cfg, "cuentas", "trabajo");
    assert.match(r.out, new RegExp(`llamado run --format json --standalone .*-m opencode/beam-free`));
    assert.ok(r.out.includes(`DATA=${path.join(dir, "data")} STATE=${path.join(dir, "state")} CUENTA=trabajo PLAN=go`), r.out);
    const run = llamadas().find((l) => l.startsWith("run --format json"));
    assert.ok(run?.includes(`STATE=${path.join(dir, "state")}`), String(run));
    const ped = readFileSync(path.join(estado, "reparto", "opencode-pedidos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(ped.map((p) => [p.m, p.n, p.c]), [["opencode/beam-free", 1, "trabajo"]]);
    assert.equal(huellaDueno(), antes, "el estado y los datos de la persona no se tocan");
  });

  testPosix("sin --cuenta: la de siempre, sin tocar el entorno, con --standalone (servidor propio), y sus pedidos van sin cuenta", () => {
    rmSync(log, { force: true });
    rmSync(path.join(estado, "reparto", "opencode-pedidos.jsonl"), { force: true });
    const r = pa(["demo", "-m", "opencode:opencode/beam-free", "haceme algo"]);
    assert.equal(r.rc, 0, r.err + r.out);
    // Seguridad: el servicio de fondo no aplica la config de este proceso (external_directory: deny de correr.mjs). Sin --standalone,
    // con el servicio corriendo, un worker de la cuenta de siempre escribía fuera de su carpeta de trabajo. Por eso va siempre.
    assert.match(r.out, /llamado run --format json --standalone /);
    assert.match(r.out, /CUENTA= PLAN=/);
    const run = llamadas().find((l) => l.startsWith("run --format json"));
    assert.ok(run && !run.includes("/cuentas/"), `el entorno de siempre no trae carpetas de cuenta: ${run}`);
    const ped = readFileSync(path.join(estado, "reparto", "opencode-pedidos.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.ok(ped.every((p) => p.c === undefined));
  });

  testPosix("--cuenta de otra cosa o inexistente: sale 2 sin lanzar nada", () => {
    rmSync(log, { force: true });
    const r = pa(["demo", "-m", "opencode:opencode/beam-free", "--cuenta", "no-existe", "x"]);
    assert.equal(r.rc, 2, r.err);
    assert.deepEqual(llamadas().filter((l) => l.startsWith("run")), []);
  });
});

describe("el líder (opencode acp) y la cuenta", () => {
  const trabajo = { id: "trabajo", proveedor: "opencode", defecto: false, poner: { XDG_DATA_HOME: "/c/trabajo/data", XDG_STATE_HOME: "/c/trabajo/state", TRAMA_OPENCODE_CUENTA: "trabajo", TRAMA_OPENCODE_PLAN: "go", PATH: "/malo" } };

  it("sin TRAMA_OPENCODE_CUENTA, o con la de siempre, el entorno no cambia", () => {
    const env = { PATH: "/usr/bin", XDG_DATA_HOME: "/d" };
    assert.equal(conCuentaOpencode(env, { leer: () => assert.fail("no debía preguntar") }), env);
    const siempre = { ...env, TRAMA_OPENCODE_CUENTA: "opencode" };
    assert.equal(conCuentaOpencode(siempre, { leer: () => assert.fail("no debía preguntar") }), siempre);
    assert.equal(cuentaAgregadaDe(siempre), null);
    assert.equal(cuentaAgregadaDe({ TRAMA_OPENCODE_CUENTA: "trabajo" }), "trabajo");
  });

  it("con una cuenta: pone sus carpetas y su plan (y nada más de lo que diga el CLI)", () => {
    let pidio = "";
    const e = conCuentaOpencode({ PATH: "/usr/bin", TRAMA_OPENCODE_CUENTA: "trabajo" }, { home: "/h", leer: (id) => ((pidio = id), JSON.stringify(trabajo)) });
    assert.equal(pidio, "trabajo");
    assert.equal(e.XDG_DATA_HOME, "/c/trabajo/data");
    assert.equal(e.XDG_STATE_HOME, "/c/trabajo/state");
    assert.equal(e.TRAMA_OPENCODE_PLAN, "go");
    assert.equal(e.PATH, "/usr/bin", "PATH no se pisa");
  });

  it("falla cerrado: cuenta que no existe, que no es de OpenCode, sin carpetas propias, relativa o con un id raro", () => {
    const pedir = (salida: string | Error, id = "trabajo") =>
      conCuentaOpencode({ TRAMA_OPENCODE_CUENTA: id }, { leer: () => { if (salida instanceof Error) throw salida; return salida; } });
    assert.throws(() => pedir(new Error("no hay ninguna cuenta trabajo")), /no pude leer la cuenta.*trabajo/);
    assert.throws(() => pedir("no es json"), /JSON/);
    assert.throws(() => pedir(JSON.stringify({ ...trabajo, proveedor: "claude" })), /no es una cuenta agregada de OpenCode/);
    assert.throws(() => pedir(JSON.stringify({ ...trabajo, defecto: true })), /no es una cuenta agregada/);
    assert.throws(() => pedir(JSON.stringify({ ...trabajo, poner: { ...trabajo.poner, XDG_STATE_HOME: "relativa" } })), /carpetas propias/);
    assert.throws(() => pedir(JSON.stringify({ ...trabajo, poner: { ...trabajo.poner, XDG_STATE_HOME: trabajo.poner.XDG_DATA_HOME } })), /carpetas propias/);
    assert.throws(() => pedir(JSON.stringify({ ...trabajo, poner: { ...trabajo.poner, TRAMA_OPENCODE_CUENTA: "otra" } })), /no se identifica/);
    assert.throws(() => pedir("{}", "../mal"), /no es un id de cuenta válido/);
    assert.deepEqual(entornoDeSalida(JSON.stringify(trabajo), "trabajo").TRAMA_OPENCODE_PLAN, "go");
  });

  it("el modelo chico va según el plan de la cuenta (go: no se fuerza uno gratis; gratis: sí)", () => {
    const leer = () => {
      throw new Error("sin archivos");
    };
    assert.equal(conModeloChico({ TRAMA_OPENCODE_PLAN: "go" }, "/h", leer).OPENCODE_CONFIG_CONTENT, undefined);
    assert.match(conModeloChico({ TRAMA_OPENCODE_PLAN: "gratis" }, "/h", leer).OPENCODE_CONFIG_CONTENT ?? "", /small_model/);
  });

  it("los pedidos y las marcas de un líder de una cuenta van con su cuenta; los de la de siempre, sin ella", () => {
    const rep = path.join(tmp, "rep-lider");
    const env = { REPARTO_STATE: rep } as NodeJS.ProcessEnv;
    const ahora = Date.now();
    assert.ok(anotarPedidos("opencode/beam-free", 2, { ...env, TRAMA_OPENCODE_CUENTA: "trabajo" }, ahora));
    assert.ok(anotarPedidos("opencode/beam-free", 3, env, ahora));
    assert.deepEqual(leerPedidos(env, ahora).map((p) => [p.n, p.c ?? null]), [[2, "trabajo"], [3, null]]);
    // Cada cuenta cuenta lo suyo en su fila de la barra.
    const fila = (cuenta?: { id: string; nombre: string }) => suscripcionOpencode({ ...(cuenta ? { cuenta } : {}), plan: "gratis", tabla: null, pedidos: leerPedidos(env, ahora), gratisHasta: null, goAgotados: {}, ahoraMs: ahora });
    assert.equal(fila({ id: "trabajo", nombre: "Trabajo" }).grupos?.[0].ventanas[0].pedidos, 2);
    assert.equal(fila().grupos?.[0].ventanas[0].pedidos, 3);
    // Un 429 de la cuenta marca sólo a la cuenta (sufijo @cuenta); el de la de siempre, sólo a la de siempre.
    marcarOpencodeAgotado(undefined, env, ahora, "trabajo");
    assert.equal(opencodeAgotadoHasta(env, ahora), null, "la de siempre sigue sin marca");
    marcarModeloGoAgotado("opencode-go/kimi-k3.1-pro", undefined, env, ahora, "trabajo");
    assert.deepEqual(modelosGoAgotados(env, ahora), {}, "los de la de siempre no ven la marca de la otra");
    const m = marcasOpencode(env, ahora);
    assert.deepEqual(Object.keys(m).sort(), ["opencode-free@trabajo", "opencode:opencode-go/kimi-k3.1-pro@trabajo"]);
    assert.ok(marcasDeCuenta(m, "trabajo").gratisHasta! > ahora);
    assert.equal(marcasDeCuenta(m, null).gratisHasta, null);
  });
});

describe("quitar", () => {
  testPosix("sin el flag la cuenta sale de la lista y su carpeta queda; con el flag se borra sólo ella", () => {
    const dir = path.join(cfg, "cuentas", "trabajo");
    cuentas(["agregar", "opencode", "Otra"]);
    const otra = path.join(cfg, "cuentas", "otra");
    assert.ok(existsSync(otra));
    let r = cuentas(["quitar", "otra"]);
    assert.equal(r.rc, 0, r.err);
    assert.ok(existsSync(otra), "la carpeta queda");
    assert.ok(!json(["--json"]).cuentas.some((c: any) => c.id === "otra"));
    cuentas(["agregar", "opencode", "Otra"]);
    r = cuentas(["quitar", "otra", "--borrar-credenciales"]);
    assert.equal(r.rc, 0, r.err);
    assert.ok(!existsSync(otra), "se borró su carpeta");
    assert.ok(existsSync(dir), "la de otra cuenta no se toca");
    assert.equal(huellaDueno(), antes);
  });

  testPosix("la de siempre no se quita; y una carpeta que no es de trama (el estado o los datos de la persona, el home) no se borra aunque lo pidan", () => {
    assert.equal(cuentas(["quitar", "opencode", "--borrar-credenciales"]).rc, 2);
    for (const [id, dir] of [["peligro1", estadoDueno], ["peligro2", datosDueno], ["peligro3", home], ["peligro5", path.join(home, ".local", "state")]] as const) {
      mkdirSync(dir, { recursive: true });
      const actual = JSON.parse(readFileSync(path.join(cfg, "cuentas.json"), "utf8"));
      actual.cuentas.push({ id, proveedor: "opencode", nombre: id, dir });
      writeFileSync(path.join(cfg, "cuentas.json"), JSON.stringify(actual));
      const r = cuentas(["quitar", id, "--borrar-credenciales"]);
      assert.equal(r.rc, 1, `${id}: ${r.out}${r.err}`);
      assert.match(r.err, /no borro/);
      assert.ok(json(["--json"]).cuentas.some((c: any) => c.id === id), `${id} sigue en la lista`);
    }
    assert.equal(huellaDueno(), antes);
    // Una carpeta que cuelga de un symlink a otro lado tampoco se sigue.
    const afuera = path.join(tmp, "afuera");
    mkdirSync(afuera, { recursive: true });
    writeFileSync(path.join(afuera, "no-tocar"), "x");
    const enlace = path.join(cfg, "cuentas", "enlazada");
    symlinkSync(afuera, enlace);
    const actual = JSON.parse(readFileSync(path.join(cfg, "cuentas.json"), "utf8"));
    actual.cuentas.push({ id: "enlazada", proveedor: "opencode", nombre: "e", dir: enlace });
    writeFileSync(path.join(cfg, "cuentas.json"), JSON.stringify(actual));
    assert.equal(cuentas(["quitar", "enlazada", "--borrar-credenciales"]).rc, 1);
    assert.ok(existsSync(path.join(afuera, "no-tocar")));
  });

  testPosix("una carpeta propia fuera de la de cuentas, con su marca, sí se borra (cuentas viejas con `dir` propio)", () => {
    const fuera = path.join(tmp, "mi-carpeta");
    mkdirSync(fuera, { recursive: true });
    const actual = JSON.parse(readFileSync(path.join(cfg, "cuentas.json"), "utf8"));
    actual.cuentas.push({ id: "propia", proveedor: "opencode", nombre: "propia", dir: fuera });
    writeFileSync(path.join(cfg, "cuentas.json"), JSON.stringify(actual));
    assert.equal(cuentas(["quitar", "propia", "--borrar-credenciales"]).rc, 1, "sin marca no");
    cuentas(["login", "propia", "--imprimir"]); // deja la marca (asegurar_links)
    const r = cuentas(["quitar", "propia", "--borrar-credenciales"]);
    assert.equal(r.rc, 0, r.err);
    assert.ok(!existsSync(fuera));
  });
});

describe("con opencode de verdad (sin login)", { skip: SIN_OPENCODE }, () => {
  testPosix("una cuenta nueva arranca aislada: carpeta propia, `auth list --standalone` vacío y sin tocar nada de la persona", () => {
    const h = path.join(tmp, "real");
    const dueno = path.join(h, ".local", "state", "opencode");
    mkdirSync(dueno, { recursive: true });
    writeFileSync(path.join(dueno, "service.json"), "{}");
    const entorno = { HOME: h, TRAMA_CUENTAS_HOME: h, TRAMA_CUENTAS: path.join(h, ".config", "trama", "cuentas.json"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" };
    const carpetaBin = path.join(tmp, "bin-real");
    mkdirSync(carpetaBin, { recursive: true });
    symlinkSync(OPENCODE!, path.join(carpetaBin, "opencode"));
    const c = (args: string[]) => {
      const r = spawnSync(CUENTAS, args, { encoding: "utf8", timeout: 120_000, env: { ...process.env, ...entorno, PATH: `${carpetaBin}:${process.env.PATH}` } });
      return { rc: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
    };
    assert.equal(c(["agregar", "opencode", "Segunda"]).rc, 0);
    const t0 = Date.now();
    const v = JSON.parse(c(["ver", "segunda", "--json", "--verificar"]).out);
    assert.ok(Date.now() - t0 < 100_000, "no se cuelga");
    assert.equal(v.logueado, false);
    const dir = path.join(h, ".config", "trama", "cuentas", "segunda");
    assert.ok(existsSync(path.join(dir, "data", "opencode", "opencode.db")), "arrancó con su propia base");
    // Lo de la persona, igual que estaba (ni el registro del servicio de fondo ni una carpeta nueva al lado).
    assert.deepEqual(readdirSync(dueno), ["service.json"]);
    assert.equal(c(["quitar", "segunda", "--borrar-credenciales"]).rc, 0);
    assert.ok(!existsSync(dir));
    assert.ok(existsSync(path.join(dueno, "service.json")));
  });
});

describe("plan detectado (lo que lista `opencode models` de cada cuenta)", () => {
  const detectado = (modelos: string) => json(["--json", "--verificar"], { FALSO_MODELOS: modelos }).cuentas.find((c: any) => c.id === "trabajo").plan_detectado ?? null;

  testPosix("sólo modelos gratis: gratis; con algún opencode-go/*: go; sin nada o con error: no se sabe", () => {
    assert.equal(detectado("opencode/beam-free\\nopencode/big-pickle\\n"), "gratis");
    assert.equal(detectado("opencode/beam-free\\nopencode-go/kimi-k3\\nopencode-go/glm-5\\n"), "go");
    assert.equal(detectado("\\x1b[2mopencode-go/kimi-k3\\x1b[0m\\n"), "go");
    assert.equal(detectado("sin modelos todavía\\n"), null);
    assert.equal(detectado("-"), null);
  });

  testPosix("sólo se pregunta con --verificar, y con el entorno de ESA cuenta y --standalone", () => {
    rmSync(log, { force: true });
    assert.equal(json(["--json"]).cuentas.find((c: any) => c.id === "trabajo").plan_detectado, undefined);
    assert.deepEqual(llamadas().filter((l) => l.startsWith("models")), []);
    detectado("opencode/beam-free\\n");
    const dir = path.join(cfg, "cuentas", "trabajo");
    assert.ok(llamadas().some((l) => l.startsWith("models --standalone|") && l.includes(`DATA=${path.join(dir, "data")}`) && l.includes(`STATE=${path.join(dir, "state")}`)), llamadas().join("\\n"));
  });

  testPosix("`plan ID --detectar` guarda lo que vio en una agregada; Go Plus no se pisa con go; sin dato no toca nada (rc 3)", () => {
    assert.equal(cuentas(["plan", "trabajo", "gratis"]).rc, 0);
    assert.equal(cuentas(["plan", "trabajo", "--detectar"], { FALSO_MODELOS: "opencode-go/glm-5\\n" }).rc, 0);
    assert.equal(json(["env", "trabajo", "--json"]).plan, "go");
    assert.equal(cuentas(["plan", "trabajo", "go-plus"]).rc, 0);
    assert.equal(cuentas(["plan", "trabajo", "--detectar"], { FALSO_MODELOS: "opencode-go/glm-5\\n" }).rc, 0);
    assert.equal(json(["env", "trabajo", "--json"]).plan, "go-plus");
    assert.equal(cuentas(["plan", "trabajo", "--detectar"], { FALSO_MODELOS: "-" }).rc, 3);
    assert.equal(json(["env", "trabajo", "--json"]).plan, "go-plus");
  });

  it("la app lee `plan_detectado` sólo en OpenCode y sólo si es un plan conocido", () => {
    const l = listaValida({
      version: 1,
      cuentas: [
        { id: "opencode", proveedor: "opencode", plan_detectado: "gratis" },
        { id: "casa", proveedor: "opencode", plan: "go", plan_detectado: "go" },
        { id: "raro", proveedor: "opencode", plan_detectado: "platino" },
        { id: "claude", proveedor: "claude", plan_detectado: "go" },
      ],
    });
    assert.deepEqual(l?.cuentas.map((c) => [c.id, c.planDetectado ?? null]), [["opencode", "gratis"], ["casa", "go"], ["raro", null], ["claude", null]]);
  });
});
