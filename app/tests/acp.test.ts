// El cliente ACP (electron/acp.ts): lo genérico contra agentes de mentira (timeouts, caída del hijo, política de permisos) y lo de
// verdad contra un `dsh --profile acp` con el servidor OpenAI falso (scripts/openai-falso.mjs): initialize, session/new, prompt con
// razonamiento + herramienta, set_config_option, resume, cancel, imágenes y session/request_permission. Sin `dsh` esas se saltean.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { ClienteAcp, ErrorAcp, describirError, redactar, politicaEnWorkspace, type PedidoPermiso } from "../electron/acp.ts";
import { escribirParche, entornoDsh, valorModeloAcp } from "../electron/dsh.ts";
import { DSH, SIN_DSH, arrancarFalso, entornoTmp, hasta, pngValido, usuarios } from "./dsh-ayuda.ts";

const { tmp, home, trabajo, dshHome } = entornoTmp("acp-test");
const abiertos: ClienteAcp[] = [];
after(async () => {
  for (const c of abiertos) c.matar();
  rmSync(tmp, { recursive: true, force: true });
});

// --- agentes de mentira (sin dsh): un script de node que habla un poco de ACP -------------------------------------------

const agente = (cuerpo: string) => {
  const f = path.join(tmp, `agente-${Math.random().toString(36).slice(2, 7)}.mjs`);
  writeFileSync(f, `import { createInterface } from "node:readline";\nconst salir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");\nconst rl = createInterface({ input: process.stdin });\nrl.on("line", (l) => { const m = JSON.parse(l); ${cuerpo} });\n`);
  return f;
};
const nuevo = (o: ConstructorParameters<typeof ClienteAcp>[0]) => {
  const c = new ClienteAcp(o);
  abiertos.push(c);
  return c;
};
const OK_INIT = `if (m.method === "initialize") return salir({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: 1, agentCapabilities: { promptCapabilities: { image: true }, sessionCapabilities: { resume: {} } } } });`;

test("initialize anota las capacidades; un pedido sin respuesta falla por tiempo; session/prompt no tiene tiempo máximo", async () => {
  const f = agente(`${OK_INIT} if (m.method === "session/new") return; if (m.method === "session/prompt") setTimeout(() => salir({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } }), 700);`);
  const c = nuevo({ comando: process.execPath, args: [f], tiempoMs: 300 });
  const r = await c.iniciar();
  assert.equal(r.protocolVersion, 1);
  assert.ok(c.aceptaImagenes && c.puedeRetomar);
  await assert.rejects(c.nuevaSesion(trabajo), /session\/new: sin respuesta en/);
  assert.deepEqual(await c.prompt("x", [{ type: "text", text: "hola" }]), { stopReason: "end_turn" }, "el prompt tarda más que tiempoMs y no se corta");
  await c.cerrar();
});

test("si el hijo se va, todo lo pendiente se rechaza con el motivo (y lo que venga después también)", async () => {
  const f = agente(`${OK_INIT} if (m.method === "session/new") { console.error("me caí por algo"); process.exit(3); }`);
  const c = nuevo({ comando: process.execPath, args: [f] });
  await c.iniciar();
  await assert.rejects(c.nuevaSesion(trabajo), /salió con el código 3: me caí por algo/);
  assert.equal(c.activo, false);
  await assert.rejects(c.nuevaSesion(trabajo), /no está corriendo/);
  const malo = nuevo({ comando: path.join(tmp, "no-existe-xyz") });
  await assert.rejects(malo.iniciar(), /no se pudo lanzar/);
});

test("un error JSON-RPC del agente es un ErrorAcp con su código; el ruido en stdout no rompe nada", async () => {
  const f = agente(`${OK_INIT} process.stdout.write("ruido que no es json\\n"); if (m.method === "session/resume") return salir({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "session is not resumable: x" } });`);
  const c = nuevo({ comando: process.execPath, args: [f] });
  await c.iniciar();
  const e = await c.retomar("x", trabajo).catch((x) => x);
  assert.ok(e instanceof ErrorAcp);
  assert.equal(e.code, -32602);
  assert.match(e.message, /session\/resume: session is not resumable/);
  await c.cerrar();
});

test("describirError: suma error.data y la cola del stderr a un Internal error, sin claves y recortado", () => {
  const e = new ErrorAcp("session/new", -32603, "Internal error", { detalle: "no adapter, key sk-abcdef123456789 y MI-CLAVE-SECRETA" });
  const stderr = "linea vieja\nl2\n\x1b[31mdsh: NO_ADAPTER: no adapter registered\x1b[0m\n\nl4\n";
  const t = describirError(e, stderr, ["MI-CLAVE-SECRETA"]);
  assert.match(t, /^session\/new: Internal error/);
  assert.match(t, /no adapter, key «clave» y «clave»/);
  assert.match(t, /NO_ADAPTER: no adapter registered · l4/);
  assert.ok(!t.includes("linea vieja") && !t.includes("\x1b") && !t.includes("sk-abc") && !t.includes("SECRETA"));
  // data como texto; sin data ni stderr queda el mensaje solo
  assert.match(describirError(new ErrorAcp("m", -32603, "Internal error", "porque sí")), /Internal error — porque sí/);
  assert.equal(describirError(new ErrorAcp("m", -32603, "Internal error")), "m: Internal error");
  // un error que no es genérico no se llena con el stderr; uno cualquiera tampoco
  assert.equal(describirError(new ErrorAcp("m", -32602, "no resumible"), "ruido\n"), "m: no resumible");
  assert.equal(describirError(new Error("acp: se cayó"), "ruido"), "acp: se cayó");
  // recorte
  const largo = describirError(new ErrorAcp("m", -32603, "Internal error", "x ".repeat(500)), "", [], 400);
  assert.equal(largo.length, 400);
  assert.ok(largo.endsWith("…"));
});

test("redactar: valores del entorno, sk-… y tokens largos; deja pasar rutas y texto normal", () => {
  assert.equal(redactar("usa abc12345 acá", ["abc12345", undefined, ""]), "usa «clave» acá");
  assert.equal(redactar("Bearer sk-proj_AbC123xyz9"), "Bearer «clave»");
  assert.equal(redactar("tok QWxhZGRpbjpvcGVuIHNlc2FtZTEyMzQ1Njc4OTBhYmM= fin"), "tok «clave» fin");
  const normal = "/home/user/.local/share/trama/dsh/sesiones/abc: no existe";
  assert.equal(redactar(normal), normal);
});

test("la política por default: permite lo del workspace y rechaza escapar de él o pedir acceso total", () => {
  const p = politicaEnWorkspace("/ws/proyecto");
  const pedido = (entrada: Record<string, unknown> | null): PedidoPermiso => ({ sessionId: "s", entrada, toolCall: {}, opciones: [] });
  assert.equal(p(pedido(null)) as string, "permitir");
  assert.equal(p(pedido({ file_path: "src/a.ts", sandbox_permissions: "workspace-write" })) as string, "permitir");
  assert.equal(p(pedido({ file_path: "/ws/proyecto/src/a.ts" })) as string, "permitir");
  assert.equal(p(pedido({ file_path: "/etc/passwd" })) as string, "rechazar");
  assert.equal(p(pedido({ path: "../otro/x" })) as string, "rechazar");
  assert.equal(p(pedido({ command: "ls", sandbox_permissions: "danger-full-access" })) as string, "rechazar");
});

test("session/request_permission se contesta con la política; lo que el cliente no implementa da -32601", async () => {
  const f = agente(`${OK_INIT}
    if (m.method === "session/prompt") {
      salir({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s", update: { sessionUpdate: "tool_call", toolCallId: "t1", title: "write", rawInput: { file_path: "/etc/x" } } } });
      salir({ jsonrpc: "2.0", id: 100, method: "session/request_permission", params: { sessionId: "s", toolCall: { toolCallId: "t1" }, options: [{ optionId: "allow-once", kind: "allow_once" }, { optionId: "reject-once", kind: "reject_once" }] } });
      salir({ jsonrpc: "2.0", id: 101, method: "fs/read_text_file", params: {} });
      globalThis.pendiente = m.id; return;
    }
    if (m.id === 100) globalThis.dec = m.result.outcome.optionId;
    if (m.id === 101) globalThis.cod = m.error.code;
    if (globalThis.dec && globalThis.cod) salir({ jsonrpc: "2.0", id: globalThis.pendiente, result: { stopReason: globalThis.dec + "/" + globalThis.cod } });`);
  const vistos: string[] = [];
  const c = nuevo({ comando: process.execPath, args: [f], raiz: trabajo, alActualizar: (_s, u) => vistos.push(u.sessionUpdate) });
  await c.iniciar();
  assert.deepEqual(await c.prompt("s", [{ type: "text", text: "x" }]), { stopReason: "reject-once/-32601" });
  assert.deepEqual(vistos, ["tool_call"]);
  // Con una política propia que permite todo.
  const c2 = nuevo({ comando: process.execPath, args: [f], permiso: () => "permitir" });
  await c2.iniciar();
  assert.equal((await c2.prompt("s", [{ type: "text", text: "x" }])).stopReason, "allow-once/-32601");
});

// --- contra dsh de verdad -----------------------------------------------------------------------------------------------

const parche = (baseURL: string, imagenes = false) => {
  const f = path.join(tmp, `cordis-${Math.random().toString(36).slice(2, 7)}.patch.yml`);
  writeFileSync(f, escribirParche({ proveedor: "ollama", modelo: "fake-model", baseURL, imagenes }));
  return f;
};
const dsh = (parch: string, extra: Record<string, string> = {}, o: Partial<ConstructorParameters<typeof ClienteAcp>[0]> = {}) =>
  nuevo({
    comando: DSH!,
    args: ["--profile", "acp", "--patch", parch],
    cwd: trabajo,
    env: { ...entornoDsh("ollama", { ...process.env, HOME: home, DSH_HOME: dshHome }), ...extra },
    ...o,
  });

test("dsh: razonamiento + herramienta + texto llegan como session/update en orden; resume en otro proceso; cancel", { skip: SIN_DSH, timeout: 120_000 }, async () => {
  const falso = await arrancarFalso(tmp, { OPENAI_FALSO_MS_LENTO: "300" });
  after(() => falso.cerrar());
  const p = parche(falso.baseURL);
  const updates: any[] = [];
  const c = dsh(p, {}, { alActualizar: (_s, u) => updates.push(u) });
  const ini = await c.iniciar();
  assert.equal(ini.protocolVersion, 1);
  assert.equal(c.puedeRetomar, true);
  assert.equal(c.aceptaImagenes, false, "el modelo declara sólo texto");
  const { sessionId, configOptions } = await c.nuevaSesion(trabajo);
  assert.equal(configOptions.find((o) => o.id === "model")?.currentValue, valorModeloAcp("ollama", "fake-model"));
  const r = await c.prompt(sessionId, [{ type: "text", text: "RAZONA HERRAMIENTA hacelo" }]);
  assert.equal(r.stopReason, "end_turn");
  const tipos = updates.map((u) => u.sessionUpdate).filter((t) => t !== "usage_update");
  assert.deepEqual(tipos, ["agent_thought_chunk", "tool_call", "tool_call_update", "agent_message_chunk"]);
  assert.equal(updates.find((u) => u.sessionUpdate === "agent_thought_chunk").content.text, "Pienso en la respuesta.");
  const tc = updates.find((u) => u.sessionUpdate === "tool_call");
  assert.equal(tc.title, "bash");
  assert.equal(tc.rawInput.command, "echo hola-desde-bash");
  const res = updates.find((u) => u.sessionUpdate === "tool_call_update");
  assert.equal(res.status, "completed");
  assert.match(res.content[0].content.text, /hola-desde-bash/);
  assert.equal(updates.find((u) => u.sessionUpdate === "agent_message_chunk").content.text, "listo: hola-desde-bash");
  const uso = updates.findLast((u) => u.sessionUpdate === "usage_update");
  assert.ok(uso.used > 0 && uso.size > 0);

  // Cambiar el modelo con set_config_option (value = string JSON) y que una opción desconocida falle.
  const cfg = await c.configurar(sessionId, "model", valorModeloAcp("ollama", "fake-model"));
  assert.equal(cfg.configOptions.find((o) => o.id === "model")?.currentValue, valorModeloAcp("ollama", "fake-model"));
  await assert.rejects(c.configurar(sessionId, "model", valorModeloAcp("ollama", "no-existe")), ErrorAcp);

  // Cancelar a mitad de un turno lento: termina "cancelled" y la sesión sigue sirviendo.
  const largo = c.prompt(sessionId, [{ type: "text", text: "DESPACIO" }]);
  await hasta(() => falso.pedidos().length >= 2);
  c.cancelar(sessionId);
  assert.equal((await largo).stopReason, "cancelled");
  updates.length = 0;
  assert.equal((await c.prompt(sessionId, [{ type: "text", text: "dos" }])).stopReason, "end_turn");
  assert.equal(updates.find((u) => u.sessionUpdate === "agent_message_chunk").content.text, "eco: dos");
  await c.cerrar();
  assert.equal(c.activo, false);

  // Otro proceso de dsh retoma la misma sesión: el modelo ve lo de antes.
  const c2 = dsh(p);
  await c2.iniciar();
  await c2.retomar(sessionId, trabajo);
  await c2.prompt(sessionId, [{ type: "text", text: "tres" }]);
  const ult = falso.pedidos().at(-1)!;
  // (el prompt cortado por session/cancel antes de que el modelo cerrara un paso no queda en la historia de dsh: "DESPACIO" no está)
  assert.deepEqual(usuarios(ult), ["RAZONA HERRAMIENTA hacelo", "dos", "tres"], "la historia viajó con la sesión");
  // Una sesión que no existe no se retoma.
  const c3 = dsh(p);
  await c3.iniciar();
  await assert.rejects(c3.retomar("no-existe", trabajo), /not resumable|unknown|no/i);
  await c2.cerrar();
  await c3.cerrar();
});

test("dsh: un bloque image llega al modelo (modelo con imágenes) y se rechaza si el modelo no las declara", { skip: SIN_DSH, timeout: 90_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const PNG = pngValido().toString("base64");
  const c = dsh(parche(falso.baseURL, true));
  await c.iniciar();
  assert.equal(c.aceptaImagenes, true);
  const { sessionId } = await c.nuevaSesion(trabajo);
  await c.prompt(sessionId, [{ type: "text", text: "mirá" }, { type: "image", data: PNG, mimeType: "image/png" }]);
  const m = falso.pedidos().at(-1)!.body.messages.filter((x: any) => x.role === "user")[0];
  assert.ok(Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url" && /^data:image\/png;base64,/.test(p.image_url.url)), JSON.stringify(m.content).slice(0, 300));
  await c.cerrar();
  const sin = dsh(parche(falso.baseURL, false));
  await sin.iniciar();
  const s = await sin.nuevaSesion(trabajo);
  await assert.rejects(sin.prompt(s.sessionId, [{ type: "image", data: PNG, mimeType: "image/png" }]), ErrorAcp);
  await sin.cerrar();
});

test("dsh: pedir escalar el sandbox (read-only) pasa por session/request_permission y la política decide", { skip: SIN_DSH, timeout: 90_000 }, async () => {
  const falso = await arrancarFalso(tmp);
  after(() => falso.cerrar());
  const p = parche(falso.baseURL);
  const probar = async (permiso: "permitir" | "rechazar") => {
    const pedidos: PedidoPermiso[] = [];
    const resultado: any[] = [];
    const c = dsh(p, { DSH_PERMISSION_MODE: "read-only" }, { permiso: (x) => (pedidos.push(x), permiso), alActualizar: (_s, u) => u.sessionUpdate === "tool_call_update" && resultado.push(u) });
    await c.iniciar();
    const { sessionId } = await c.nuevaSesion(trabajo);
    await c.prompt(sessionId, [{ type: "text", text: "ESCALA escribí" }]);
    await c.cerrar();
    assert.equal(pedidos.length, 1);
    assert.equal(pedidos[0]!.entrada?.sandbox_permissions, "workspace-write", "el pedido trae el rawInput del tool_call");
    assert.deepEqual(pedidos[0]!.opciones.map((o) => o.kind), ["allow_once", "reject_once"]);
    return resultado[0];
  };
  const no = await probar("rechazar");
  assert.equal(no.status, "failed");
  assert.ok(!existsSync(path.join(trabajo, "escalado.txt")));
  const si = await probar("permitir");
  assert.equal(si.status, "completed");
  assert.equal(readFileSync(path.join(trabajo, "escalado.txt"), "utf8"), "x\n");
});
