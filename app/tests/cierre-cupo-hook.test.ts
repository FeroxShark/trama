// Cierre por cupo, el aviso a los trabajos vivos: el hook (motor/hooks/cierre-cupo.mjs), sus textos, el aviso por la cola a los líderes
// de otro motor y la lectura de la señal que comparten `pa` y `reparto`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CIERRE_PASOS } from "../electron/cli/pa/contrato.ts";
import { cierreDe, cierreDeModelo, cierresVigentes, grupoDeModelo, suscripcionDeProveedor, textoSinCupo } from "../electron/cli/cierre-cupo-lectura.ts";
import { avisarLideres, lideresParaAvisar, settingsCierreCupo, type LiderVivo } from "../electron/cierre-cupo-texto.ts";
import type { EntradaCierre } from "../electron/cierre-cupo.ts";

const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "motor", "hooks");
const HOOK = path.join(HOOKS, "cierre-cupo.mjs");
const AHORA = Math.floor(Date.now() / 1000);
const ent = (o: Partial<EntradaCierre> = {}): EntradaCierre => ({ proveedor: "claude", cuenta: "claude", ventana: "5h", restante: 4, umbral: 5, vuelve: AHORA + 3600, desde: AHORA - 60, ...o });

function estado(entradas: EntradaCierre[] | null) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cierre-hook-"));
  if (entradas) writeFileSync(path.join(dir, "cierre-cupo.json"), JSON.stringify({ version: 1, ts: AHORA, retomar_solo: false, entradas }));
  return dir;
}
function correr(dir: string, sesion: string, env: Record<string, string> = {}, evento = "PostToolUse") {
  const limpio: Record<string, string> = { PATH: process.env.PATH ?? "", HOME: dir, PA_STATE: dir, HILOS_STATE: dir, LANG: "es_AR.UTF-8" };
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: sesion, hook_event_name: evento }), env: { ...limpio, ...env }, encoding: "utf8" });
  assert.equal(r.status, 0);
  return r.stdout ? (JSON.parse(r.stdout).hookSpecificOutput as { hookEventName: string; additionalContext: string }) : null;
}

test("el hook inyecta una sola vez por sesión y ventana", () => {
  const d = estado([ent()]);
  const a = correr(d, "s1");
  assert.ok(a);
  assert.equal(a.hookEventName, "PostToolUse");
  assert.equal(correr(d, "s1"), null);
  assert.equal(correr(d, "s1", {}, "UserPromptSubmit"), null);
  assert.ok(correr(d, "s2"), "otra sesión sí recibe el aviso");
});

test("el texto de líder y el de worker son distintos; el idioma sale de la app", () => {
  const d = estado([ent()]);
  const lider = correr(d, "l1")!.additionalContext;
  const worker = correr(d, "w1", { PA_WORKER: "1" })!.additionalContext;
  assert.match(lider, /relevos[\\/]l1\.md/);
  assert.match(lider, /Tenés la cuota muy baja/);
  assert.match(lider, /quedan|Quedan 4 %/i);
  assert.match(worker, /no arranques nada nuevo/);
  assert.ok(worker.includes(CIERRE_PASOS), "el worker reusa los pasos de CIERRE_TAREA");
  assert.doesNotMatch(worker, /relevos/);
  writeFileSync(path.join(d, "preferencias.json"), JSON.stringify({ idioma: "en" }));
  assert.match(correr(d, "l2")!.additionalContext, /Your quota is very low/);
});

test("el hook no inyecta sin archivo, con otra suscripción, con otra cuenta ni con un endpoint ajeno", () => {
  assert.equal(correr(estado(null), "s1"), null);
  assert.equal(correr(estado([ent({ proveedor: "google", cuenta: "google" })]), "s1"), null);
  assert.equal(correr(estado([ent({ cuenta: "trabajo" })]), "s1"), null);
  assert.equal(correr(estado([ent({ vuelve: AHORA - 5 })]), "s1"), null);
  assert.equal(correr(estado([ent()]), "s1", { ANTHROPIC_BASE_URL: "http://localhost:11434" }), null);
  assert.equal(correr(estado([ent()]), "../raro"), null);
});

test("el hook respeta la cuenta de CLAUDE_CONFIG_DIR", () => {
  const d = estado([ent({ cuenta: "trabajo" })]);
  const cuentas = path.join(d, "cuentas.json");
  writeFileSync(cuentas, JSON.stringify({ cuentas: [{ id: "trabajo", proveedor: "claude", dir: path.join(d, "c-trabajo") }] }));
  assert.ok(correr(d, "s1", { CLAUDE_CONFIG_DIR: path.join(d, "c-trabajo"), TRAMA_CUENTAS: cuentas }));
  assert.equal(correr(d, "s2"), null, "la cuenta de siempre no está cerrada");
});

test("sin archivo de señal el hook es barato (un stat y sale)", () => {
  const d = estado(null);
  const t = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) correr(d, "s1");
  const ms = Number(process.hrtime.bigint() - t) / 1e6 / 5;
  assert.ok(ms < 400, `${ms} ms por llamada`);
  assert.equal(existsSync(path.join(d, "cierre-cupo")), false, "no escribe nada");
});

test("los pasos del worker del texto son los de CIERRE_TAREA", async () => {
  const { textoCierre } = (await import(pathToFileURL(path.join(HOOKS, "cierre-cupo-textos.mjs")).href)) as { textoCierre: (o: unknown) => string };
  assert.ok(textoCierre({ rol: "worker", idioma: "es", entrada: ent() }).includes(CIERRE_PASOS));
  assert.match(textoCierre({ rol: "worker", idioma: "es", entrada: ent({ vuelve: null }) }), /cuando se reinicie la ventana/);
});

const vivo = (o: Partial<LiderVivo>): LiderVivo => ({ sid: "x", modelo: "gemini-4-hydrogen-xhigh", effort: "high", clase: "gemini", ocupado: true, ...o });

test("el aviso por la cola va sólo a líderes de otro motor, de esa suscripción y respondiendo", async () => {
  const e = ent({ proveedor: "google", cuenta: "google" });
  const vivos = [
    vivo({ sid: "a" }),
    vivo({ sid: "b", ocupado: false }),
    vivo({ sid: "c", modelo: "claude-opus-5-5", clase: "claude" }),
    vivo({ sid: "d", modelo: "dsh:ollama/x", clase: "dsh" }),
    vivo({ sid: "e", modelo: "opencode:opencode/x", clase: "opencode" }),
  ];
  assert.deepEqual(lideresParaAvisar(vivos, e).map((l) => l.sid), ["a"]);
  const cola: { sid: string; texto: string }[] = [];
  const sids = await avisarLideres({ entrada: e, vivos, idioma: "es", hooks: HOOKS, archivoRelevo: (s) => `/r/${s}.md`, encolar: (sid, texto) => void cola.push({ sid, texto }) });
  assert.deepEqual(sids, ["a"]);
  assert.match(cola[0]!.texto, /\/r\/a\.md/);
});

test("el --settings del líder registra el hook en los dos eventos y suma nota-compactar en un solo JSON si se pide", () => {
  const s = JSON.parse(settingsCierreCupo("/m/hooks", { plataforma: "linux" })) as { hooks: Record<string, { hooks: { command: string }[] }[]> };
  assert.deepEqual(Object.keys(s.hooks).sort(), ["PostToolUse", "UserPromptSubmit"]);
  assert.equal(s.hooks.PostToolUse![0]!.hooks[0]!.command, "node '/m/hooks/cierre-cupo.mjs'");

  const ambos = JSON.parse(settingsCierreCupo("/m/hooks", { plataforma: "linux", umbralNota: 255000 })) as {
    hooks: Record<string, { matcher?: string; hooks: { command: string }[] }[]>;
  };
  assert.deepEqual(Object.keys(ambos.hooks).sort(), ["PostToolUse", "PreCompact", "SessionStart", "UserPromptSubmit"]);
  assert.equal(ambos.hooks.PostToolUse!.length, 2);
  assert.equal(ambos.hooks.PostToolUse![0]!.hooks[0]!.command, "node '/m/hooks/cierre-cupo.mjs'");
  assert.equal(ambos.hooks.PostToolUse![1]!.hooks[0]!.command, "node '/m/hooks/nota-compactar.mjs' --umbral 255000");
  assert.equal(ambos.hooks.UserPromptSubmit!.length, 2);
  assert.equal(ambos.hooks.PreCompact![0]!.hooks[0]!.command, "node '/m/hooks/nota-compactar.mjs' --umbral 255000");
  assert.equal(ambos.hooks.SessionStart![0]!.matcher, "compact");
  assert.equal(ambos.hooks.SessionStart![0]!.hooks[0]!.command, "node '/m/hooks/nota-compactar.mjs' --umbral 255000");
});

test("pa y reparto: lectura de la señal, suscripción de un modelo y mensaje", () => {
  const d = estado([ent(), ent({ proveedor: "google", cuenta: "google", ventana: "7d", vuelve: AHORA + 7200 }), ent({ vuelve: AHORA - 10, ventana: "7d" })]);
  const vigentes = cierresVigentes(d, AHORA);
  assert.equal(vigentes.length, 2, "la que ya volvió no cuenta");
  assert.deepEqual(cierresVigentes(estado(null), AHORA), []);
  assert.ok(cierreDeModelo(vigentes, "claude-sonnet-5-5"));
  assert.ok(cierreDeModelo(vigentes, "gemini-4-hydrogen-xhigh"));
  assert.equal(cierreDeModelo(vigentes, "codex:gpt-5"), null);
  assert.equal(cierreDeModelo(vigentes, "opencode:opencode/x"), null);
  assert.equal(cierreDe(vigentes, suscripcionDeProveedor("claude"), "otra"), null);
  assert.equal(suscripcionDeProveedor("openai"), "chatgpt");

  // Google tiene tres ventanas: una entrada con grupo sólo cierra a los modelos de ese grupo.
  const soloGemini = [ent({ proveedor: "google", cuenta: "google", grupo: "gemini", vuelve: AHORA + 600 })];
  assert.ok(cierreDeModelo(soloGemini, "gemini-4-hydrogen-xhigh"));
  assert.equal(cierreDeModelo(soloGemini, "agy:claude-sonnet-5-5-high"), null, "Claude por agy tiene su propia ventana");
  assert.equal(cierreDeModelo(soloGemini, "agy:gpt-oss-120b-medium"), null);
  assert.equal(cierreDeModelo(soloGemini, "gemini-4-argon-high"), null, "Argon tiene su propia ventana");
  assert.ok(cierreDeModelo([ent({ proveedor: "google", cuenta: "google", grupo: "claude-gpt" })], "agy:claude-opus-5-5-high"));
  assert.ok(cierreDeModelo([ent({ proveedor: "google", cuenta: "google" })], "gemini-4-argon-high"), "sin grupo cierra a toda la suscripción");
  assert.ok(cierreDe(soloGemini, "google", "google"), "sin saber el grupo del modelo, cierra");
  assert.equal(cierreDe(soloGemini, "google", "google", "gemini-4-argon"), null);
  assert.equal(grupoDeModelo("claude-sonnet-5-5"), null);
  assert.equal(grupoDeModelo("gemini-4-neon-low"), "gemini");
  assert.match(textoSinCupo(ent(), AHORA), /^sin cupo: vuelve a las (\d\d\/\d\d )?\d\d:\d\d$/);
});

test("el registro en el settings del usuario agrega el hook una vez por evento y no pisa nada", async () => {
  const { registrarCierreEnAjustes } = await import("../electron/cli/hooks.ts");
  const aj: Record<string, unknown> = { hooks: { PostToolUse: [{ hooks: [{ type: "command", command: "x" }] }] } };
  const o = { carpeta: "/h", variante: "sh" as const, plataforma: "linux" as const };
  assert.equal(registrarCierreEnAjustes(aj, o), true);
  assert.equal(registrarCierreEnAjustes(aj, o), false);
  const h = aj.hooks as Record<string, unknown[]>;
  assert.equal(h.PostToolUse!.length, 2);
  assert.equal(h.UserPromptSubmit!.length, 1);
});

test("cuentaDeSesion en Windows: USERPROFILE manda y las rutas no distinguen mayúsculas ni barras (CTX-52)", async () => {
  const { cuentaDeSesion } = (await import(pathToFileURL(HOOK).href)) as { cuentaDeSesion: (e: Record<string, string>, plat: string) => string | null };
  const base = { USERPROFILE: "C:\\Users\\Ana", HOME: "/c/Users/otra" };
  // la de siempre: la carpeta llega con otra capitalización de la unidad y barras mezcladas
  assert.equal(cuentaDeSesion({ ...base, CLAUDE_CONFIG_DIR: "c:/users/ana/.claude" }, "win32"), "claude");
  // una agregada sin `dir`: su carpeta cuelga de la de cuentas.json
  const dir = mkdtempSync(path.join(os.tmpdir(), "cuentas-win-"));
  const json = path.join(dir, "cuentas.json");
  writeFileSync(json, JSON.stringify({ cuentas: [{ id: "c2", proveedor: "claude" }, { id: "c3", proveedor: "claude", dir: "~\\cuentas-x" }] }));
  assert.equal(cuentaDeSesion({ ...base, TRAMA_CUENTAS: json, CLAUDE_CONFIG_DIR: "C:\\Users\\ANA\\cuentas-x" }, "win32"), "c3");
  // sin coincidencia: null (no se avisa), no un error
  assert.equal(cuentaDeSesion({ ...base, TRAMA_CUENTAS: json, CLAUDE_CONFIG_DIR: "D:\\otra" }, "win32"), null);
  // Linux sigue distinguiendo mayúsculas
  assert.equal(cuentaDeSesion({ HOME: "/home/ana", CLAUDE_CONFIG_DIR: "/home/Ana/.claude", TRAMA_CUENTAS: json }, "linux"), null);
  assert.equal(cuentaDeSesion({ HOME: "/home/ana", CLAUDE_CONFIG_DIR: "/home/ana/.claude" }, "linux"), "claude");
});

test("una entrada con grupo (el límite propio de Fable) no la aplica el hook: no ve el modelo de la sesión", () => {
  assert.equal(correr(estado([ent({ ventana: "7d", grupo: "fable" })]), "s1"), null);
  assert.ok(correr(estado([ent({ ventana: "7d", grupo: "fable" }), ent()]), "s1"), "la de toda la suscripción sí");
});

test("cierreDeModelo: la entrada de Fable cierra a un id de Fable y no a Sonnet; sin modelo no cierra a nadie", () => {
  const f = ent({ ventana: "7d", grupo: "fable" });
  assert.equal(cierreDeModelo([f], "claude-fable-5-2"), f);
  assert.equal(cierreDeModelo([f], "claude-sonnet-5-5"), null);
  assert.equal(cierreDe([f], "claude", "claude", null), null);
  assert.equal(cierreDe([f], "claude", "claude", null, "claude-fable-5-2"), f);
});

test("el aviso por la cola no llega a un líder de otro modelo que el del límite propio", () => {
  const vivo = (modelo: string): LiderVivo => ({ sid: modelo, modelo, effort: "high", clase: "agy", ocupado: true });
  const vivos = [vivo("claude-fable-5-2"), vivo("claude-sonnet-5-5")];
  assert.deepEqual(lideresParaAvisar(vivos, { proveedor: "claude", grupo: "fable" }).map((l) => l.sid), ["claude-fable-5-2"]);
  assert.equal(lideresParaAvisar(vivos, { proveedor: "claude" }).length, 2);
});
