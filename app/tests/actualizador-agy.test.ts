// El aviso de Antigravity CLI (electron/actualizador.ts + electron/actualizacion-agy.ts) con un `agy` de mentira
// en un tmp (nunca el real, nunca `agy update` de verdad): versión vieja avisa, igual no, `agy` ausente no avisa
// ni consulta, Ocultar, Actualizar, y de dónde sale la última (actualizador, y AUR si ese no contesta).
// Actualizar de agy (el módulo) abre una terminal con `paru -S antigravity-cli`: la terminal es un falso que
// anota sus argumentos y, con FALSA_MODO=instala, deja la versión nueva (lo que haría paru con la contraseña).
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
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

const tmp = mkdtempSync(path.join(os.tmpdir(), "hilos-agy-"));
process.env.HILOS_STATE = path.join(tmp, "estado");

// El agy del módulo: `--version` lee su archivo y `update` no debe correrse nunca (deja una marca si pasa).
const verAgy = path.join(tmp, "modulo.ver");
const marcaUpdate = path.join(tmp, "agy-update.marca");
const argsTerminal = path.join(tmp, "terminal.args");
const agyModulo = path.join(tmp, "agy-modulo");
writeFileSync(verAgy, "1.4.2");
writeFileSync(agyModulo, `#!/bin/sh\ncase "$1" in --version) cat '${verAgy}';; update) echo x > '${marcaUpdate}'; exit 2;; *) exit 2;; esac\n`);
chmodSync(agyModulo, 0o755);
// La terminal falsa (kitty): anota sus argumentos y corre el comando como una terminal de verdad (sh -c envoltorio ...),
// salvo con FALSA_MODO=nada: la "cierran a mano" antes de que el comando corra. Y un paru falso en el PATH:
// con FALSA_MODO=instala instala 1.4.3 y sale 0, con falla sale 3. La ventana termina sola, sin --hold.
const terminalFalsa = path.join(tmp, "terminal-falsa");
writeFileSync(terminalFalsa, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsTerminal}'\n[ "$FALSA_MODO" = nada ] && exit 0\nexec "$@" < /dev/null\n`);
chmodSync(terminalFalsa, 0o755);
mkdirSync(path.join(tmp, "bin"), { recursive: true });
writeFileSync(path.join(tmp, "bin", "paru"), `#!/bin/sh\n[ "$FALSA_MODO" = falla ] && exit 3\nprintf '%s' 1.4.3 > '${verAgy}'\nexit 0\n`);
chmodSync(path.join(tmp, "bin", "paru"), 0o755);
process.env.PATH = `${path.join(tmp, "bin")}:${process.env.PATH}`;
// El módulo de agy lee su entorno al cargarse. La última sale del estado (recién chequeada, así no se consulta): sin red.
process.env.HILOS_AGY = agyModulo;
process.env.HILOS_TERMINAL = terminalFalsa;
process.env.HILOS_PACMAN = terminalFalsa; // un ejecutable cualquiera: la prueba corre también donde no hay pacman
process.env.HILOS_AGY_ACTUALIZADOR = "http://127.0.0.1:9/";
mkdirSync(path.join(tmp, "estado"), { recursive: true });
writeFileSync(path.join(tmp, "estado", "agy-version.json"), JSON.stringify({ version: 1, chequeado: Date.now(), instalada: "1.4.2", ultima: "1.4.3", descartada: null }));

const { crearActualizador } = await import("../electron/actualizador.ts");
const { actualizarAgy, leerAvisoAgy, ultimaAgy } = await import("../electron/actualizacion-agy.ts");

/** Un `agy` falso: `--version` imprime lo que dice su archivo; `update` lo pasa a `nueva`. */
function agyFalso(nombre: string, instalada: string, nueva: string) {
  const v = path.join(tmp, `${nombre}.ver`);
  const bin = path.join(tmp, nombre);
  writeFileSync(v, instalada);
  writeFileSync(bin, `#!/bin/sh\ncase "$1" in --version) cat '${v}';; update) printf '%s' '${nueva}' > '${v}'; echo actualizado;; *) exit 2;; esac\n`);
  chmodSync(bin, 0o755);
  return bin;
}

function con(nombre: string, bin: string, ultima: string | null) {
  let consultas = 0;
  const a = crearActualizador({
    archivo: path.join(tmp, `${nombre}.json`),
    bin,
    nombre,
    ultima: async () => (consultas++, ultima),
    actualizar: { args: ["update"] },
    entornoActualizar: () => process.env,
    olvidarSiFalta: true,
  });
  return { a, consultas: () => consultas };
}

test("agy más viejo que la última: hay aviso", async () => {
  const { a } = con("vieja", agyFalso("agy-vieja", "1.4.2\n", "1.4.3"), "1.4.3");
  assert.deepEqual(await a.leerAviso(), { instalada: "1.4.2", ultima: "1.4.3" });
});

test("agy igual a la última: no hay aviso", async () => {
  const { a } = con("igual", agyFalso("agy-igual", "1.4.2\n", "1.4.2"), "1.4.2");
  assert.equal(await a.leerAviso(), null);
});

test("agy ausente: no hay aviso ni se consulta la última", async () => {
  const { a, consultas } = con("ausente", path.join(tmp, "no-existe"), "9.9.9");
  assert.equal(await a.leerAviso(), null);
  assert.equal(consultas(), 0);
});

test("agy desinstalado después de un aviso: el aviso se va", async () => {
  const bin = agyFalso("agy-se-va", "1.4.2\n", "1.4.3");
  const archivo = path.join(tmp, "se-va.json");
  const cfg = { archivo, nombre: "se-va", ultima: async () => "1.4.3", actualizar: { args: ["update"] }, entornoActualizar: () => process.env, olvidarSiFalta: true };
  assert.ok(await crearActualizador({ ...cfg, bin }).leerAviso());
  assert.equal(await crearActualizador({ ...cfg, bin: path.join(tmp, "ya-no-esta") }).leerAviso(), null);
});

test("sin red (la última no se sabe): sin aviso, y se vuelve a preguntar", async () => {
  const { a, consultas } = con("sin-red", agyFalso("agy-sin-red", "1.4.2\n", "1.4.3"), null);
  assert.equal(await a.leerAviso(), null);
  assert.equal(await a.leerAviso(), null);
  assert.equal(consultas(), 2);
});

test("a la fuente de la última no se le vuelve a preguntar antes de 6 h", async () => {
  const { a, consultas } = con("seis-horas", agyFalso("agy-seis", "1.4.2\n", "1.4.3"), "1.4.3");
  await a.leerAviso();
  await a.leerAviso();
  assert.equal(consultas(), 1);
});

test("Ocultar apaga el aviso de esa versión", async () => {
  const { a } = con("oculta", agyFalso("agy-oculta", "1.4.2\n", "1.4.3"), "1.4.3");
  const vistos: unknown[] = [];
  a.alCambiarAviso((x) => vistos.push(x));
  assert.ok(await a.leerAviso());
  await a.descartar();
  assert.equal(await a.leerAviso(), null);
  assert.deepEqual(vistos.at(-1), null);
});

test("Actualizar (genérico) corre `<bin> update` y deja la versión nueva", async () => {
  const bin = agyFalso("agy-act", "1.4.2\n", "1.4.3");
  const { a } = con("act", bin, "1.4.3");
  await a.leerAviso();
  assert.deepEqual(await a.actualizar(), { ok: true, version: "1.4.3" });
  assert.equal(readFileSync(path.join(tmp, "agy-act.ver"), "utf8"), "1.4.3");
  assert.equal(await a.leerAviso(), null);
});

test("Actualizar que no sube la versión es un error, con lo que dijo", async () => {
  const { a } = con("no-sube", agyFalso("agy-no-sube", "1.4.2\n", "1.4.2"), "1.4.3");
  await a.leerAviso();
  const r = await a.actualizar();
  assert.equal(r.ok, false);
});

test("agy (módulo): Actualizar abre una terminal con paru, nunca corre `agy update`, y deja la versión nueva", async () => {
  writeFileSync(verAgy, "1.4.2");
  process.env.FALSA_MODO = "instala";
  assert.deepEqual(await leerAvisoAgy(), { instalada: "1.4.2", ultima: "1.4.3" });
  assert.deepEqual(await actualizarAgy(), { ok: true, version: "1.4.3" });
  assert.match(readFileSync(argsTerminal, "utf8"), /\nparu\n-S\nantigravity-cli\n$/);
  assert.equal(existsSync(marcaUpdate), false, "no se corrió `agy update`");
  assert.equal(await leerAvisoAgy(), null);
});

test("agy (módulo): la terminal se cierra sin instalar: error, y la versión vieja sigue", async () => {
  writeFileSync(verAgy, "1.4.2");
  process.env.FALSA_MODO = "nada";
  const r = await actualizarAgy();
  assert.equal(r.ok, false);
  assert.match(r.error, /main\.terminalCerro/);
  assert.equal(readFileSync(verAgy, "utf8"), "1.4.2");
});

test("agy (módulo): la ventana queda abierta tras instalar OK: igual termina por el rc del comando", async () => {
  writeFileSync(verAgy, "1.4.2");
  process.env.FALSA_MODO = "queda";
  const t0 = Date.now();
  assert.deepEqual(await actualizarAgy(), { ok: true, version: "1.4.3" });
  assert.ok(Date.now() - t0 < 1500, "no esperó a que se cerrara la ventana");
});

test("agy (módulo): el comando falla (rc 3): error con el código, la versión vieja sigue", async () => {
  writeFileSync(verAgy, "1.4.2");
  process.env.FALSA_MODO = "falla";
  const r = await actualizarAgy();
  assert.equal(r.ok, false);
  assert.match(r.error, /main\.terminalFallo/);
  assert.equal(readFileSync(verAgy, "utf8"), "1.4.2");
});

test("agy (módulo): sin terminal (kitty no está): error que lo dice, sin colgarse", async () => {
  writeFileSync(verAgy, "1.4.2");
  process.env.HILOS_TERMINAL = path.join(tmp, "no-hay-terminal");
  try {
    const r = await actualizarAgy();
    assert.equal(r.ok, false);
    assert.match(r.error, /main\.terminalNo/);
  } finally {
    process.env.HILOS_TERMINAL = terminalFalsa;
  }
});

test("la última de agy: el actualizador primero, AUR si ese falla, null si ninguno", async () => {
  const pedidos: string[] = [];
  const respuestas = (mapa: Record<string, { ok: boolean; texto: string } | "cae">) => async (url: string) => {
    pedidos.push(url);
    const r = mapa[url.includes("aur.archlinux.org") ? "aur" : "act"];
    if (r === "cae") throw new Error("sin red");
    return { ok: r.ok, text: async () => r.texto };
  };
  const aur = { ok: true, texto: JSON.stringify({ results: [{ Version: "1.4.5_99-1" }] }) };
  assert.equal(await ultimaAgy(respuestas({ act: { ok: true, texto: "Stable Version: 1.4.4. Rolled out to 100%" }, aur })), "1.4.4");
  assert.equal(pedidos.length, 1, "con el actualizador no se toca AUR");
  assert.equal(await ultimaAgy(respuestas({ act: "cae", aur })), "1.4.5");
  assert.equal(await ultimaAgy(respuestas({ act: { ok: false, texto: "" }, aur })), "1.4.5");
  assert.equal(await ultimaAgy(respuestas({ act: "cae", aur: "cae" })), null);
  assert.equal(await ultimaAgy(respuestas({ act: { ok: true, texto: "<html>" }, aur: { ok: true, texto: "no es json" } })), null);
});
