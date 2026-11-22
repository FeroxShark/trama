import { testPosix as test } from "./plataforma.ts";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REGISTRAR = path.join(import.meta.dirname, "..", "scripts", "registrar-hook.mjs");
const HOOK_JS = path.join(import.meta.dirname, "..", "..", "motor", "hooks", "hook-compactando.mjs");
const RESUMEN_JS = path.join(import.meta.dirname, "..", "..", "motor", "hooks", "resumen-modelos.mjs");
/** El comando que se registra: `<node> <hook.mjs>` (sin comillas si las rutas no tienen nada raro). */
const HOOK = `${process.execPath} ${HOOK_JS}`;

const temporal = () => mkdtempSync(path.join(tmpdir(), "trama-registrar-hook-"));
const registrar = (ruta: string, env: Record<string, string> = {}) =>
  execFileSync(process.execPath, [REGISTRAR, ruta], { encoding: "utf8", env: { ...process.env, ...env } });
const leer = (ruta: string) => JSON.parse(readFileSync(ruta, "utf8"));
/** Cuántas veces aparece el hook de compactando en un evento (cualquier grupo). */
const cuantos = (ajustes: any, evento: string) =>
  (ajustes.hooks?.[evento] ?? []).flatMap((g: any) => g.hooks ?? []).filter((h: any) => /hook-compactando\.(?:sh|mjs)/.test(h.command)).length;
const cuantosNota = (ajustes: any, evento: string) =>
  (ajustes.hooks?.[evento] ?? []).flatMap((g: any) => g.hooks ?? []).filter((h: any) => /nota-compactar\.mjs/.test(h.command)).length;

test("registrar-hook: dos corridas dejan el hook una sola vez y los otros hooks intactos", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const otrosHooks = {
    PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/bin/otro-hook.sh" }] }],
    PreCompact: [{ matcher: "manual", hooks: [{ type: "command", command: "/usr/bin/mi-otro-precompact.sh" }] }],
    PostCompact: [],
  };
  writeFileSync(settings, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls:*)"] }, hooks: otrosHooks }, null, 2));

  const primera = registrar(settings);
  assert.match(primera, /registrado/);
  const tras1 = leer(settings);
  const bytes1 = readFileSync(settings, "utf8");
  assert.equal(cuantos(tras1, "PreCompact"), 1);
  assert.equal(cuantos(tras1, "PostCompact"), 1);
  assert.deepEqual(tras1.hooks.PreToolUse, otrosHooks.PreToolUse, "PreToolUse intacto");
  assert.deepEqual(tras1.hooks.PreCompact[0], otrosHooks.PreCompact[0], "el PreCompact ajeno sigue en su grupo");
  assert.equal(tras1.model, "opus");
  assert.deepEqual(tras1.permissions, { allow: ["Bash(ls:*)"] });
  assert.equal(tras1.hooks.PreCompact[1].hooks[0].command, HOOK, "el comando es la ruta de este checkout");

  const segunda = registrar(settings);
  assert.match(segunda, /ya registrado/);
  assert.equal(readFileSync(settings, "utf8"), bytes1, "la segunda corrida no reescribe el archivo");
  assert.equal(cuantos(leer(settings), "PreCompact"), 1);
  assert.equal(cuantos(leer(settings), "PostCompact"), 1);
  rmSync(dir, { recursive: true });
});

test("registrar-hook: crea el settings si no existe, con los dos eventos", () => {
  const dir = temporal();
  const settings = path.join(dir, "sub", "settings.json");
  registrar(settings);
  const ajustes = leer(settings);
  assert.equal(cuantos(ajustes, "PreCompact"), 1);
  assert.equal(cuantos(ajustes, "PostCompact"), 1);
  assert.equal(statSync(settings).mode & 0o777, 0o600, "un settings nuevo no sale legible por todos");
  rmSync(dir, { recursive: true });
});

test("registrar-hook: un hook de este script con otra ruta (checkout viejo) o repetido queda uno, con la ruta nueva", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const viejo = { type: "command", command: "/home/ana/hilos-viejo/scripts/hook-compactando.sh" };
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreCompact: [{ hooks: [viejo, { type: "command", command: "/usr/bin/otro.sh" }] }, { hooks: [viejo] }],
        PostCompact: [{ hooks: [viejo] }],
      },
    }),
  );
  registrar(settings, { TRAMA_MODELOS: path.join(dir, "no-existe.json") });
  const ajustes = leer(settings);
  assert.equal(cuantos(ajustes, "PreCompact"), 1);
  assert.equal(cuantos(ajustes, "PostCompact"), 1);
  assert.equal(cuantosNota(ajustes, "PreCompact"), 1);
  assert.equal(cuantosNota(ajustes, "PostToolUse"), 1);
  assert.equal(cuantosNota(ajustes, "UserPromptSubmit"), 1);
  assert.equal(cuantosNota(ajustes, "SessionStart"), 1);
  assert.equal(ajustes.hooks.SessionStart.find((g: any) => g.hooks.some((h: any) => /nota-compactar\.mjs/.test(h.command))).matcher, "compact");
  // La primera aparición se actualiza en su lugar; las repetidas salen, y se suma nota-compactar sin pisar lo ajeno.
  assert.deepEqual(ajustes.hooks.PreCompact[0], {
    hooks: [{ type: "command", command: HOOK }, { type: "command", command: "/usr/bin/otro.sh" }],
  });
  assert.deepEqual(ajustes.hooks.PostCompact, [{ hooks: [{ type: "command", command: HOOK }] }]);
  rmSync(dir, { recursive: true });
});

test("CTX-50 registrar-hook: el hook-compactando.sh de antes pasa a .mjs y el resumen de modelos va sólo en startup|compact (sin jq ni bash)", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const otro = { matcher: "resume", hooks: [{ type: "command", command: "/usr/bin/otro.sh" }] };
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreCompact: [{ hooks: [{ type: "command", command: "/r/app/scripts/hook-compactando.sh" }] }],
        PostCompact: [{ hooks: [{ type: "command", command: "/r/app/scripts/hook-compactando.sh" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "bash '/h/resumen-modelos.sh'", timeout: 10 }, { type: "command", command: "/usr/bin/mio.sh" }] }, otro],
      },
    }),
  );
  registrar(settings, { TRAMA_MODELOS: path.join(dir, "no-existe.json") });
  const a = leer(settings);
  assert.equal(cuantos(a, "PreCompact"), 1);
  assert.ok(!JSON.stringify(a).includes("hook-compactando.sh"), "ya no queda el .sh");
  assert.ok(!JSON.stringify(a).includes("resumen-modelos.sh"), "ni el resumen en .sh");
  assert.deepEqual(a.hooks.PreCompact[0].hooks, [{ type: "command", command: HOOK }]);
  const res = a.hooks.SessionStart.filter((g: any) => g.hooks.some((h: any) => /resumen-modelos\.mjs/.test(h.command)));
  assert.equal(res.length, 1);
  assert.equal(res[0].matcher, "startup|compact");
  assert.deepEqual(res[0].hooks, [{ type: "command", command: `${process.execPath} ${RESUMEN_JS}`, timeout: 10 }]);
  // lo ajeno queda: el hook del usuario que compartía grupo con el resumen viejo y el grupo `resume`
  assert.ok(a.hooks.SessionStart.some((g: any) => g.hooks.some((h: any) => h.command === "/usr/bin/mio.sh")));
  assert.deepEqual(a.hooks.SessionStart.find((g: any) => g.matcher === "resume"), otro);
  const bytes = readFileSync(settings, "utf8");
  assert.match(registrar(settings, { TRAMA_MODELOS: path.join(dir, "no-existe.json") }), /ya registrado/);
  assert.equal(readFileSync(settings, "utf8"), bytes, "idempotente");
  rmSync(dir, { recursive: true });
});

test("registrar-hook: saca nota-compactar de los 4 eventos si nota_compactar es false y lo vuelve a poner al prender", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  const modelos = path.join(dir, "modelos.json");
  writeFileSync(modelos, JSON.stringify({ version: 1, nota_compactar_pct: 70, nota_compactar_tarea_pct: 55 }));
  registrar(settings, { TRAMA_MODELOS: modelos });
  const a1 = leer(settings);
  assert.equal(cuantosNota(a1, "PreCompact"), 1);
  assert.equal(cuantosNota(a1, "SessionStart"), 1);
  assert.match(a1.hooks.PreCompact.at(-1).hooks[0].command, /--umbral 700000 --umbral-tarea 550000/);

  writeFileSync(modelos, JSON.stringify({ version: 1, nota_compactar: false }));
  registrar(settings, { TRAMA_MODELOS: modelos });
  const a2 = leer(settings);
  for (const ev of ["PostToolUse", "UserPromptSubmit", "PreCompact", "SessionStart"]) assert.equal(cuantosNota(a2, ev), 0);
  assert.equal(cuantos(a2, "PreCompact"), 1, "conserva hook-compactando");
  rmSync(dir, { recursive: true });
});

test("registrar-hook: JSON roto no se toca y sale con error", () => {
  const dir = temporal();
  const settings = path.join(dir, "settings.json");
  writeFileSync(settings, '{"hooks": {');
  const r = spawnSync(process.execPath, [REGISTRAR, settings], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no es JSON válido/);
  assert.equal(readFileSync(settings, "utf8"), '{"hooks": {');
  rmSync(dir, { recursive: true });
});

test("registrar-hook: un settings con modo 0640 conserva el modo y un enlace se sigue, no se reemplaza", () => {
  const dir = temporal();
  const real = path.join(dir, "dotfiles-settings.json");
  const enlace = path.join(dir, "settings.json");
  writeFileSync(real, "{}");
  chmodSync(real, 0o640);
  symlinkSync(real, enlace);
  registrar(enlace);
  assert.equal(lstatSync(enlace).isSymbolicLink(), true, "el enlace sigue siendo enlace");
  assert.equal(statSync(real).mode & 0o777, 0o640);
  assert.equal(cuantos(leer(real), "PreCompact"), 1);
  rmSync(dir, { recursive: true });
});
