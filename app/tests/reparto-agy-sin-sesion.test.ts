// Con la sesión de Google de agy vencida, `agy -p /quota` abre el login en el navegador en CADA llamada (2026-11-15: ~70 pestañas en una hora).
// Reparto (el TypeScript y el python) nunca tiene que abrirlo: agy corre sin pantalla ni navegador, la primera lectura que falla deja una
// pausa (no se vuelve a llamar a agy), el aviso sale una sola vez y una lectura buena la borra. Con un `agy` falso que cuenta sus llamadas.
import { after } from "node:test";
import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { envSinNavegador } from "../electron/binario.ts";

const REPARTO = path.join(import.meta.dirname, "..", "..", "motor", "bin", "reparto");
const tmp = mkdtempSync(path.join(os.tmpdir(), "reparto-sin-sesion-"));
after(() => rmSync(tmp, { recursive: true, force: true }));

const QUOTA = JSON.stringify({ command: { data: { groups: [{ name: "Gemini 4 Argon", buckets: [{ window: "weekly", remaining_fraction: 0.37, reset_time: "2099-01-01T00:00:00Z" }] }] } } });

/** Un `agy` falso: anota cada llamada (argumentos, DISPLAY y BROWSER) y no contesta nada (la sesión vencida) o devuelve el cupo. */
function agyFalso(dir: string, modo: "sin-sesion" | "con-sesion") {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "quota.json"), QUOTA);
  writeFileSync(
    path.join(dir, "agy"),
    `#!/bin/sh
echo "$* DISPLAY=[$DISPLAY] WAYLAND=[$WAYLAND_DISPLAY] BROWSER=[$BROWSER]" >> '${path.join(dir, "llamadas.log")}'
${modo === "con-sesion" ? `if [ "$1" = "models" ]; then printf 'gemini-4-argon-high\\tGemini 4 Argon\\n'; else cat '${path.join(dir, "quota.json")}'; fi` : ""}
exit 0
`,
  );
  chmodSync(path.join(dir, "agy"), 0o755);
}

const llamadas = (dir: string) => (existsSync(path.join(dir, "llamadas.log")) ? readFileSync(path.join(dir, "llamadas.log"), "utf8").trim().split("\n").filter(Boolean) : []);

function cupos(bin: string, estado: string, motor: "ts" | "py", extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(REPARTO, ["--cupos", "--json"], {
    encoding: "utf8",
    env: {
      ...process.env,
      TRAMA_REPARTO: motor,
      PATH: `${bin}:${process.env.PATH}`,
      DISPLAY: ":9",
      WAYLAND_DISPLAY: "wayland-9",
      REPARTO_STATE: estado,
      PA_STATE: path.join(tmp, "pa-estado"),
      REPARTO_CUENTAS_BIN: path.join(tmp, "no-hay-cuentas"),
      REPARTO_AVISAR: "0",
      REPARTO_CODEX: "0",
      REPARTO_DSH_FIJO: '{"ollama":[],"opencode":false,"deepseek":false}',
      REPARTO_OPENCODE_FIJO: '["opencode/big-pickle"]',
      TRAMA_MODELOS: path.join(tmp, "no-hay.json"),
      ...extra,
    },
  });
}

for (const motor of ["ts", "py"] as const) {
  test(`${motor}: sin sesión agy corre sin pantalla ni navegador, se pausa y avisa una sola vez`, () => {
    const bin = path.join(tmp, `bin-${motor}`);
    const estado = path.join(tmp, `estado-${motor}`);
    agyFalso(bin, "sin-sesion");
    const uno = cupos(bin, estado, motor);
    assert.equal(uno.status, 0, uno.stderr);
    const primeras = llamadas(bin);
    assert.ok(primeras.length >= 1, "la primera vez sí lee agy");
    for (const l of primeras) assert.match(l, /DISPLAY=\[\] WAYLAND=\[\] BROWSER=\[\/bin\/false\]/, "agy sin pantalla ni navegador");
    assert.ok(existsSync(path.join(estado, "agy-sin-sesion.json")), "queda la marca de pausa");
    assert.equal((uno.stderr.match(/agy no contestó/g) ?? []).length, 1, "el aviso sale una vez");
    // Pasan varias aperturas de panel: ni una llamada más ni un segundo aviso.
    for (let i = 0; i < 3; i++) {
      const otra = cupos(bin, estado, motor);
      assert.equal(otra.status, 0, otra.stderr);
      assert.doesNotMatch(otra.stderr, /agy no contestó/);
    }
    assert.equal(llamadas(bin).length, primeras.length, "en pausa no se vuelve a llamar a agy");
  });

  test(`${motor}: pasada la pausa vuelve a leer, y una lectura buena borra la marca`, () => {
    const bin = path.join(tmp, `bin-ok-${motor}`);
    const estado = path.join(tmp, `estado-ok-${motor}`);
    agyFalso(bin, "sin-sesion");
    cupos(bin, estado, motor);
    assert.ok(existsSync(path.join(estado, "agy-sin-sesion.json")));
    agyFalso(bin, "con-sesion"); // Ferox volvió a iniciar sesión
    const antes = llamadas(bin).length;
    const sinPausa = cupos(bin, estado, motor, { REPARTO_AGY_PAUSA_S: "0" });
    assert.equal(sinPausa.status, 0, sinPausa.stderr);
    // Con la pausa de 0 s la marca ya venció: reparto lee de nuevo.
    assert.ok(llamadas(bin).length > antes, "vencida la pausa se vuelve a probar");
    assert.equal(existsSync(path.join(estado, "agy-sin-sesion.json")), false, "una lectura buena borra la marca");
  });
}

test("envSinNavegador saca la pantalla y el escritorio, pone BROWSER y deja el llavero", () => {
  const e = envSinNavegador({ DISPLAY: ":0", WAYLAND_DISPLAY: "w", XDG_CURRENT_DESKTOP: "KDE", DBUS_SESSION_BUS_ADDRESS: "unix:path=/x", HOME: "/h" }, "linux");
  assert.equal(e.DISPLAY, undefined);
  assert.equal(e.WAYLAND_DISPLAY, undefined);
  assert.equal(e.XDG_CURRENT_DESKTOP, undefined);
  assert.equal(e.BROWSER, "/bin/false");
  assert.equal(e.DBUS_SESSION_BUS_ADDRESS, "unix:path=/x");
  assert.equal(e.HOME, "/h");
  assert.equal(envSinNavegador({ DISPLAY: ":0" }, "win32").DISPLAY, ":0", "en Windows no hay variable que lo impida");
});
