// cli/workers.ts y workers-formato.ts: qué hay corriendo, el latido, la elección del worker a seguir, `ultimo` y los cinco formatos
// de transcript. Sin bash ni jq: corre también en Windows (el pid que se anota es el del propio test, que está vivo).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AYUDA, contextoDe, elegirRunning, estadoLatido, leerCampos, listar, listarJson, main, terminalPara, transcurrido, ultimo, ultimoPaso, ver, type Io } from "../electron/cli/workers.ts";
import { CON_COLOR, SIN_COLOR, crearFormateador, formatoDe, type Formato } from "../electron/cli/workers-formato.ts";

const AHORA = 1_900_000_000;

function sandbox() {
  const raiz = realpathSync(mkdtempSync(path.join(os.tmpdir(), "wk-")));
  const home = path.join(raiz, "home");
  const estado = path.join(raiz, "estado");
  mkdirSync(home);
  mkdirSync(estado);
  const registry = path.join(raiz, "registry.json");
  const proyecto = path.join(raiz, "proy");
  mkdirSync(proyecto);
  writeFileSync(registry, JSON.stringify({ projects: [{ name: "demo", path: proyecto }] }));
  const env = { HOME: home, USERPROFILE: home, PA_STATE: estado, PROYECTOS_REGISTRY: registry, LOCALAPPDATA: path.join(raiz, "local") };
  let out = "";
  let err = "";
  const io: Io = { out: (s) => (out += s), err: (s) => (err += s), tty: false };
  const x = contextoDe(env, io, () => AHORA);
  const escribir = (r: string, t: string) => {
    mkdirSync(path.dirname(r), { recursive: true });
    writeFileSync(r, t);
  };
  return { raiz, home, estado, proyecto, env, io, x, escribir, salida: () => ({ out, err }), limpiar: () => ((out = ""), (err = "")) };
}

type Run = Record<string, string | number | undefined>;
const running = (s: ReturnType<typeof sandbox>, nombre: string, r: Run) =>
  s.escribir(path.join(s.estado, nombre), Object.entries({ pid: process.pid, inicio: AHORA - 5430, modelo: "claude-prueba", ...r }).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");

test("transcurrido: s, m y h", () => {
  assert.deepEqual([0, 42, 60, 185, 3599, 3600, 5430, 90061].map((s) => transcurrido(s, 0)), ["0s", "42s", "1m00s", "3m05s", "59m59s", "1h00m", "1h30m", "25h01m"]);
  assert.equal(transcurrido(10, 20), "0s");
});

test("leerCampos: la primera línea de cada clave, sin confundir prefijos", () => {
  const s = sandbox();
  s.escribir(path.join(s.estado, "a.running"), "pid=1\npa_pid=2\ntarea=a=b\ntarea=otra\nvacio=\n");
  const f = leerCampos(path.join(s.estado, "a.running"));
  assert.deepEqual([f("pid"), f("pa_pid"), f("tarea"), f("vacio"), f("nada")], ["1", "2", "a=b", "", ""]);
  assert.equal(leerCampos(path.join(s.estado, "no-esta"))("pid"), "");
});

test("estadoLatido: sin latido, en curso, pensando y colgado", () => {
  const s = sandbox();
  const hb = path.join(s.estado, "x.heartbeat");
  assert.equal(estadoLatido(hb, s.x), "(arrancando, sin herramientas todavía)");
  s.escribir(hb, `epoch=${AHORA - 90}\ntool=Bash\ndesc=${"d".repeat(80)}\nenvuelo=1\n`);
  assert.equal(estadoLatido(hb, s.x), `Bash ${"d".repeat(60)} en curso hace 1m30s`);
  s.escribir(hb, `epoch=${AHORA - 12}\ntool=Edit\ndesc=a.ts\nenvuelo=0\n`);
  assert.equal(estadoLatido(hb, s.x), "pensando (último: Edit a.ts, hace 12s)");
  s.escribir(hb, `epoch=${AHORA - 700}\ntool=Edit\ndesc=a.ts\nenvuelo=0\n`);
  assert.equal(estadoLatido(hb, s.x), "sin eventos hace 11m40s, nada en vuelo (¿colgado? ¿esperando la API?)");
  s.escribir(hb, `epoch=${AHORA - 700}\ntool=Bash\ndesc=x\nenvuelo=1\n`);
  assert.equal(estadoLatido(hb, { ...s.x, c: CON_COLOR }), `\x1b[36mBash\x1b[0m \x1b[2mx\x1b[0m \x1b[33men curso hace 11m40s\x1b[0m`);
});

test("listar: vivos, huérfanos, latidos y la línea de cada puesto", async () => {
  const s = sandbox();
  running(s, "demo.running", { proyecto: "demo", tarea: "t".repeat(90), id: "i1", puesto: "2", rama: "pa/demo-1" });
  s.escribir(path.join(s.estado, "demo.heartbeat"), `epoch=${AHORA - 30}\ntool=Bash\ndesc=compilando\nenvuelo=1\n`);
  running(s, "demo.leer-abc.running", { proyecto: "demo", leer: 1, id: "abc", tarea: "mirar" });
  running(s, "muerto.running", { proyecto: "muerto", pid: 2 ** 22 + 777 });
  running(s, "sinpid.running", { proyecto: "pa", pid: "", pa_pid: process.pid, puesto: "aca" });
  await listar(s.x);
  assert.equal(
    s.salida().out,
    [
      `demo                 1h30m  claude-prueba ·lectura abc  mirar`,
      `   ↳ (arrancando, sin herramientas todavía)`,
      `demo                 1h30m  claude-prueba ·puesto 2 ·pa/demo-1  ${"t".repeat(70)}`,
      `   ↳ Bash compilando en curso hace 30s`,
      `muerto             HUÉRFANO  (el claude murió; el próximo \`pa muerto\` lo limpia solo)`,
      `pa                   1h30m  claude-prueba ·tree principal  `,
      `   ↳ (arrancando, sin herramientas todavía)`,
      "",
    ].join("\n"),
  );
});

test("listar: sin nada dice que no hay workers", async () => {
  const s = sandbox();
  await listar(s.x);
  assert.equal(s.salida().out, "no hay workers corriendo.\n");
});

test("listarJson: sólo vivos, con puesto, edad del latido y null en lo vacío", () => {
  const s = sandbox();
  running(s, "demo.running", { proyecto: "demo", tarea: "t", id: "i1", jefe: "j", rama: "r", cuenta: "claude" });
  s.escribir(path.join(s.estado, "demo.heartbeat"), `epoch=${AHORA - 700}\ntool=Bash\ndesc=x\nenvuelo=1\n`);
  running(s, "l.running", { proyecto: "demo", leer: 1, id: "abc" });
  running(s, "muerto.running", { proyecto: "muerto", pid: 2 ** 22 + 777 });
  listarJson(s.x);
  const j = JSON.parse(s.salida().out) as Record<string, unknown>[];
  assert.deepEqual(j, [
    { slug: "demo", arranco_hace_s: 5430, tarea: "t", herramienta: "Bash", herramienta_hace_s: 700, colgado: true, rama: "r", leer: false, id: "i1", jefe: "j", puesto: "1", cuenta: "claude" },
    { slug: "demo", arranco_hace_s: 5430, tarea: null, herramienta: null, herramienta_hace_s: null, colgado: false, rama: null, leer: true, id: "abc", jefe: "", puesto: null, cuenta: null },
  ]);
  assert.match(s.salida().out, /^\[\n {2}\{\n {4}"slug": "demo",/);
  const v = sandbox();
  listarJson(v.x);
  assert.equal(v.salida().out, "[]\n");
});

test("elegirRunning: uno solo, por proyecto o id, varios sin decir cuál y varios writers", () => {
  const s = sandbox();
  assert.deepEqual(elegirRunning("", s.x), { ok: false, codigo: 1 });
  running(s, "a.running", { proyecto: "alfa", id: "i1" });
  assert.deepEqual(elegirRunning("", s.x), { ok: true, archivo: path.join(s.estado, "a.running") });
  running(s, "b.running", { proyecto: "beta", id: "i2", leer: 1 });
  running(s, "b2.running", { proyecto: "beta", id: "i3", puesto: "2" });
  const r = elegirRunning("", s.x);
  assert.deepEqual(r, { ok: false, codigo: 2 });
  assert.equal(s.salida().err, "hay varios workers; decí cuál:\n  alfa\n  beta   (lectura, id: i2)\n  beta\n");
  assert.deepEqual(elegirRunning("ALF", s.x), { ok: true, archivo: path.join(s.estado, "a.running") });
  assert.deepEqual(elegirRunning("i2", s.x), { ok: true, archivo: path.join(s.estado, "b.running") });
  // un proyecto con un --leer y un writer: mira al que escribe
  assert.deepEqual(elegirRunning("beta", s.x), { ok: true, archivo: path.join(s.estado, "b2.running") });
  running(s, "b3.running", { proyecto: "beta", id: "i4", puesto: "3", tarea: "otra" });
  s.limpiar();
  assert.deepEqual(elegirRunning("beta", s.x), { ok: false, codigo: 2 });
  assert.equal(s.salida().err, "hay 2 workers escribiendo en 'beta'; decí cuál por id:\n  workers ver i3   # ·puesto 2 · una tarea\n  workers ver i4   # ·puesto 3 · otra\n".replace("una tarea", ""));
});

test("ver: sigue el transcript hasta que muere el worker y cierra con «terminó»", async () => {
  const s = sandbox();
  const hijo = spawnSync(process.execPath, ["-e", ""]); // un pid que ya murió
  const tr = path.join(s.raiz, "t.jsonl");
  s.escribir(tr, [{ type: "user", timestamp: "2024-01-01T12:00:01Z", message: { content: "hola" } }, { type: "assistant", timestamp: "2024-01-01T12:00:09Z", message: { content: [{ type: "text", text: "chau" }] } }].map((e) => JSON.stringify(e)).join("\n") + "\n");
  // vivo para elegirlo, muerto enseguida: anotamos nuestro pid y lo damos por terminado con un pid_vivo falso no es posible; usamos un hijo corto
  const dormilon = (await import("node:child_process")).spawn(process.execPath, ["-e", "setTimeout(()=>{}, 600)"], { stdio: "ignore" });
  running(s, "demo.running", { proyecto: "demo", pid: dormilon.pid, tarea: "una", transcript: tr, inicio: 1704110405 });
  assert.ok(hijo.status === 0);
  const rc = await ver(["demo"], { ...s.x, ahora: () => 1704110405 + 61 }, { pollMs: 50 });
  assert.equal(rc, 0);
  assert.equal(s.salida().out, "── demo ── 1m01s\nuna\n\n12:00:09 · chau\n\n── terminó (1m01s) ──\n");
  s.limpiar();
  assert.equal(await ver(["--todo", "demo"], { ...s.x, ahora: () => 1704110405 + 61 }, { pollMs: 50 }), 1, "el worker ya murió");
  assert.equal(s.salida().err, "no hay ningún worker corriendo para 'demo'. Probá: workers ultimo demo\n");
});

test("ver: errores (sin transcript=, transcript que no aparece)", async () => {
  const s = sandbox();
  running(s, "demo.running", { proyecto: "demo" });
  assert.equal(await ver([], s.x), 1);
  assert.equal(s.salida().err, "este .running es de un pa viejo, sin transcript=. Matalo y relanzá.\n");
  s.limpiar();
  running(s, "demo.running", { proyecto: "demo", transcript: path.join(s.raiz, "no.jsonl") });
  assert.equal(await ver([], s.x, { esperaMaxSeg: 0 }), 1);
  assert.match(s.salida().err, /^el transcript de 'demo' no apareció: /);
});

test("ultimo: errores, .session de pa, el jsonl más nuevo, el stream de otro motor y el aviso sin VERIFICACION", async () => {
  const s = sandbox();
  assert.equal(await ultimo([], s.x), 2);
  assert.equal(await ultimo(["fantasma"], s.x), 1);
  assert.match(s.salida().err, /^uso: workers ultimo <proyecto>\nno encontré 'fantasma'\. Proyectos:\ndemo\n$/);
  s.limpiar();
  assert.equal(await ultimo(["demo"], s.x), 1);
  const dir = path.join(s.home, ".claude", "projects", s.proyecto.replace(/[^A-Za-z0-9]/g, "-"));
  assert.equal(s.salida().err, `no hay transcripts en ${dir}\n`);
  const user = (t: string) => JSON.stringify({ type: "user", timestamp: "2024-01-01T12:00:01Z", message: { content: t } }) + "\n";
  const poner = (f: string, t: string, mtime: number) => {
    s.escribir(f, t);
    utimesSync(f, mtime, mtime);
  };
  poner(path.join(dir, "viejo.jsonl"), user("viejo"), 1000);
  poner(path.join(dir, "pa.jsonl"), user("del worker"), 2000);
  poner(path.join(dir, "otro.jsonl"), user("otro"), 3000);
  s.limpiar();
  assert.equal(await ultimo(["demo"], s.x), 0);
  assert.match(s.salida().out, new RegExp(`^── proy ── .*otro\\.jsonl\n\n12:00:01 ▸ otro\n$`));
  s.escribir(path.join(s.estado, "proy.session"), "pa\n");
  s.limpiar();
  await ultimo(["demo"], s.x);
  assert.match(s.salida().out, /pa\.jsonl\n\n12:00:01 ▸ del worker\n$/);
  // un stream más nuevo (agy) gana
  poner(path.join(s.estado, "proy", "id1.stream.jsonl"), JSON.stringify({ event: "init", init: { model: "m" } }) + "\n", 4000);
  poner(path.join(s.estado, "proy", "id1.hilo"), "verificado=0\n", 5);
  poner(path.join(s.estado, "proy", "id2.hilo"), "leer=1\nverificado=0\n", 6);
  s.limpiar();
  await ultimo(["demo"], s.x);
  assert.match(s.salida().out, /id1\.stream\.jsonl\nsin verificar: el RESULTADO de id1 no trae VERIFICACION; no lo des por bueno sin comprobarlo\.\n\n--:--:-- · agy m\n$/);
});

test("ultimoPaso: lo último que hizo un subagente", () => {
  const s = sandbox();
  const f = path.join(s.raiz, "agent-1.jsonl");
  s.escribir(f, [{ type: "assistant", message: { content: [{ type: "text", text: "uno\ndos" }] } }, { type: "user" }, { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { description: "arreglo" } }, { type: "text", text: "x" }] } }].map((e) => JSON.stringify(e)).join("\n") + "\n");
  assert.equal(ultimoPaso(f), "Edit arreglo");
  s.escribir(f, JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `a\nb ${"z".repeat(100)}` }] } }) + "\n");
  assert.equal(ultimoPaso(f), "a b " + "z".repeat(66));
  assert.equal(ultimoPaso(path.join(s.raiz, "no-esta")), "");
});

test("terminalPara: $TERMINAL con argumentos, o la primera que haya, con sus flags", () => {
  const hay = (...ns: string[]) => (n: string) => (ns.includes(n) ? `/usr/bin/${n}` : null);
  assert.deepEqual(terminalPara({ TERMINAL: "alacritty -o x=y" }, hay("alacritty")), ["alacritty", "-o", "x=y", "-e"]);
  assert.deepEqual(terminalPara({}, hay("kitty", "xterm")), ["kitty", "--class", "workers", "--hold", "--title", "workers"]);
  assert.deepEqual(terminalPara({}, hay("gnome-terminal")), ["gnome-terminal", "--title", "workers", "--"]);
  assert.deepEqual(terminalPara({}, hay("foot")), ["foot"]);
  assert.deepEqual(terminalPara({ TERMINAL: "no-esta" }, hay("xterm")), ["xterm", "-e"]);
  assert.equal(terminalPara({}, hay()), null);
});

test("main: ayuda, subcomando desconocido y abrir sin terminal", async () => {
  const s = sandbox();
  assert.equal(await main(["--help"], s.env, s.io), 0);
  assert.equal(s.salida().out, AYUDA.map((l) => l + "\n").join(""));
  assert.match(AYUDA[0]!, /^workers — ver los Claude/);
  s.limpiar();
  assert.equal(await main(["zzz"], s.env, s.io), 2);
  assert.equal(s.salida().err, "no conozco 'zzz'. Probá: workers | workers ver | workers ultimo <p>\n");
  s.limpiar();
  assert.equal(await main(["abrir", "x"], { ...s.env, PATH: path.join(s.raiz, "vacio"), TERMINAL: "" }, s.io), 1);
  assert.match(s.salida().err, /^no encontré una terminal \(probé \$TERMINAL, .*Corré: workers ver x\n$/);
});

// ------------------------------------------------------------------------------------------------ formatos

const lineas = (formato: Formato, entradas: unknown[], o: { desde?: string; pensar?: boolean } = {}) => {
  const f = crearFormateador(formato, SIN_COLOR, o);
  return [...entradas.flatMap((e) => f.linea(typeof e === "string" ? e : JSON.stringify(e))), ...f.fin()];
};

test("formato claude: texto, pensamiento, herramientas y resultados; el filtro por fecha", () => {
  const ev = [
    { type: "user", timestamp: "2024-01-01T12:00:01Z", message: { content: "hola\ncon\ttabs   y  espacios" } },
    { type: "assistant", timestamp: "2024-01-01T12:00:02Z", message: { content: [{ type: "thinking", thinking: "pienso" }, { type: "text", text: "Miro" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } },
    { type: "user", timestamp: "2024-01-01T12:00:04Z", message: { content: [{ type: "tool_result", content: [{ type: "text", text: "uno" }, { type: "image" }] }] } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "Task", input: { foo: 1 } }, { type: "text", text: "é".repeat(450) }] } },
    { type: "system" },
  ];
  assert.deepEqual(lineas("claude", ev), [
    "12:00:01 ▸ hola ⏎ con tabs y espacios",
    "12:00:02 · Miro",
    "12:00:02 ▶ Bash ls",
    "12:00:04   ⤷ uno [image]",
    '--:--:-- ▶ Task {"foo":1}',
    "--:--:-- · " + "é".repeat(400) + "…",
  ]);
  assert.ok(lineas("claude", ev, { pensar: true }).includes("12:00:02 ~ pienso"));
  assert.deepEqual(lineas("claude", ev, { desde: "2024-01-01T12:00:03" }).slice(0, 1), ["12:00:04   ⤷ uno [image]"]);
  assert.equal(lineas("claude", ev, { desde: "2024-01-01T12:00:03" }).length, 1, "los eventos sin timestamp quedan fuera cuando hay filtro");
});

test("formato claude: una línea rota corta el flujo; un tipo inesperado sólo pierde lo que le quedaba a ese evento (como jq)", () => {
  const ok = { type: "user", message: { content: "a" } };
  assert.deepEqual(lineas("claude", [ok, "{roto", ok]), ["--:--:-- ▸ a"]);
  const malo = { type: "assistant", message: { content: [{ type: "text", text: "antes" }, { type: "text", text: 5 }, { type: "text", text: "nunca" }] } };
  assert.deepEqual(lineas("claude", [ok, malo, ok]), ["--:--:-- ▸ a", "--:--:-- · antes", "--:--:-- ▸ a"]);
  assert.deepEqual(lineas("claude", [{ type: "assistant", message: { content: [{ type: "tool_use", name: "X", input: "str" }] } }, ok]), ["--:--:-- ▸ a"], "un input que es texto falla al indexarlo");
});

test("formato agy: junta el texto de un paso y lo suelta cuando cambia", () => {
  const ev = [
    { event: "init", init: { model: "g" } },
    { event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "Hola " } },
    { event: "step_update", step_update: { step_index: 1, step_type: "agent_response", text_delta: "mundo" } },
    { event: "step_update", step_update: { step_index: 2, step_type: "tool", state: "ACTIVE", tool_name: "run", tool_info: { parameters: { CommandLine: "ls" } } } },
    { event: "step_update", step_update: { step_index: 2, step_type: "tool", state: "DONE", tool_info: { output: { k: 1 } } } },
    { event: "step_update", step_update: { step_index: 3, step_type: "agent_response", text_delta: "fin" } },
    "no es json",
    { event: "result", result: { status: "FAILED" } },
  ];
  assert.deepEqual(lineas("agy", ev), ["--:--:-- · agy g", "--:--:-- · Hola mundo", "--:--:-- ▶ run ls", '--:--:--   ⤷ {"k":1}', "--:--:-- · fin", "--:--:-- ✗ agy: FAILED"]);
  assert.deepEqual(lineas("agy", ev.slice(0, 3)), ["--:--:-- · agy g", "--:--:-- · Hola mundo"], "el texto pendiente sale al final");
});

test("formatos codex, dsh y opencode", () => {
  assert.deepEqual(
    lineas("codex", [{ type: "item.started", item: { type: "command_execution", command: "ls" } }, { type: "item.completed", item: { type: "command_execution", exit_code: 1, aggregated_output: "no\nhay" } }, { type: "item.completed", item: { type: "file_change", changes: [{ path: "a" }, { path: "b" }] } }, { type: "item.completed", item: { type: "mcp_tool_call", server: "s" } }, { type: "turn.failed", error: {} }, "x"], { pensar: true }),
    ["--:--:-- ▶ Bash ls", "--:--:--   ⤷ [rc 1] no ⏎ hay", "--:--:-- ▶ Edit a, b", "--:--:-- ▶ s/?", "--:--:-- ✗ turn.failed"],
  );
  assert.deepEqual(
    lineas("dsh", [{ type: "session", sessionId: "abc" }, { type: "text", text: "hola" }, { type: "thinking", text: "p" }, { type: "tool_call", tool: "bash", input: { command: "ls" } }, { type: "tool_result", status: "error", result: { r: 1 } }, { type: "status", phase: "turn_end", reason: { kind: "error", error: { message: "mal" } } }, { type: "final", text: "hola" }]),
    ["--:--:-- · dsh abc", "--:--:-- · hola", "--:--:-- ▶ bash ls", '--:--:--   ⤷ [error] {"r":1}', "--:--:-- ✗ mal"],
  );
  assert.deepEqual(
    lineas("opencode", [{ type: "step_start" }, { type: "text", part: { text: "hola" } }, { type: "tool_use", part: { tool: "bash", state: { status: "error", input: { command: "ls" }, error: "no" } } }, { type: "error", error: { name: "Boom" } }]),
    ["--:--:-- · hola", "--:--:-- ▶ bash ls", "--:--:--   ⤷ [error] no", "--:--:-- ✗ Boom"],
  );
});

test("formatoDe: por el modelo o por la primera línea", () => {
  const casos: [string, string, Formato][] = [
    ["codex:x", "", "codex"], ["DSH:x", "", "dsh"], ["opencode:x", "", "opencode"], ["gemini-3", "", "agy"], ["agy:x", "", "agy"], ["claude-x", "", "claude"], ["ollama:x", "", "claude"],
    ["", '{"event":"init"}', "agy"], ["otro", '{"type":"thread.started"}', "codex"], ["", '{"type":"turn.started"}', "codex"], ["", '{"type":"session"}', "dsh"], ["", '{"type":"step_start"}', "opencode"], ["", '{"type":"user"}', "claude"],
  ];
  for (const [m, l, f] of casos) assert.equal(formatoDe(m, l), f, `${m} ${l}`);
});
