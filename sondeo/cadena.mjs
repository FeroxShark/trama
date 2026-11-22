// Sondeo (CI de Windows): la cadena de lanzar_worker con el pa real. raíz sin consola → «MCP» (consola sin ventana) → pa --async →
// WMI → runner → claude.cmd falso → hijo con la forma de un MCP de Claude (stdio pipe,pipe,inherit). Un monitor anota ventanas visibles.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const yo = fileURLToPath(import.meta.url);
const aqui = path.dirname(yo);
const [, , modo, ...resto] = process.argv;
const NODE = process.execPath;
const T = "C:\\t";

if (modo === "falso") {
  // claude falso: --version, o una corrida que arranca un «MCP» (la hoja) y devuelve un RESULTADO.
  const a = resto;
  if (a[0] === "--version") { process.stdout.write("2.1.330 (Claude Code)\n"); process.exit(0); }
  const val = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const sid = val("--session-id") ?? val("--resume") ?? "";
  fs.appendFileSync(path.join(T, "falso.log"), JSON.stringify(a.slice(0, 6)) + "\n");
  const h = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(aqui, "hoja.ps1"), "-out", path.join(T, "hojas.txt"), "-espera", "2", "-nombre", "mcp-de-claude"], { stdio: ["pipe", "pipe", "inherit"], windowsHide: true });
  h.stdout.resume();
  h.on("exit", () => setTimeout(() => {
    process.stdout.write(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "RESULTADO: listo\nARCHIVOS: ninguno\nVERIFICACION: ninguna\nDECISION: nada\nSIGUE: nada", session_id: sid, num_turns: 1, duration_ms: 1000, total_cost_usd: 0 }) + "\n");
    process.exit(0);
  }, 1500));
} else if (modo === "mcp") {
  // como el servidor MCP de Trama: corre pa con pipes y windowsHide (cli/mcp-trama.ts) y guarda su salida.
  const [env64, ...pa] = resto;
  const env = JSON.parse(Buffer.from(env64, "base64").toString("utf8"));
  const p = spawn(NODE, pa, { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: path.join(T, "demo") });
  let s = "";
  p.stdout.on("data", (d) => (s += d));
  p.stderr.on("data", (d) => (s += d));
  p.on("exit", (rc) => { fs.writeFileSync(path.join(T, "pa-salida.txt"), `rc=${rc}\n${s}`); process.exit(0); });
} else if (modo === "raiz") {
  // sin consola (detached), como la ventana de Electron o el claude que corre el MCP
  const p = spawn(NODE, [yo, "mcp", ...resto], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  p.stdout.resume(); p.stderr.resume();
  p.on("exit", () => process.exit(0));
} else {
  const repo = path.resolve(resto[0] ?? ".");
  for (const d of ["home", "estado", "proj", "shim", "demo"]) fs.mkdirSync(path.join(T, d), { recursive: true });
  const git = (...a) => execFileSync("git", ["-C", path.join(T, "demo"), "-c", "user.email=a@b", "-c", "user.name=x", ...a], { windowsHide: true });
  git("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(T, "demo", "a.txt"), "hola\n");
  git("add", "a.txt"); git("commit", "-qm", "base");
  const reg = path.join(T, "home", "registry.json");
  fs.writeFileSync(reg, JSON.stringify({ projects: [{ name: "demo", path: path.join(T, "demo") }] }));
  fs.writeFileSync(path.join(T, "shim", "claude.cmd"), `@echo off\r\n"${NODE}" "${yo}" falso %*\r\n`);
  const env = { ...process.env, USERPROFILE: path.join(T, "home"), HOME: path.join(T, "home"), PA_STATE: path.join(T, "estado"), PA_PROJ: path.join(T, "proj"),
    PROYECTOS_REGISTRY: reg, TRAMA_MODELOS: path.join(T, "no-hay.json"), PA_JEFE: "", PA_JEFE_ID: "", PA_RAM_MIN_MB: "0", PATH: `${path.join(T, "shim")};${process.env.PATH}` };
  for (const k of Object.keys(env)) if (/^(CLAUDE|ANTHROPIC)/.test(k)) delete env[k];
  const salida = path.join(T, "ventanas.txt"), listo = salida + ".listo";
  const mon = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(aqui, "monitor.ps1"), "-out", salida, "-listo", listo, "-segundos", "70"], { windowsHide: true, stdio: "ignore" });
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 300 && !fs.existsSync(listo); i++) await esperar(100);
  const pa = [path.join(repo, "app", "electron", "cli", "pa.ts"), "demo", "--async", "--sin-jefe", "--leer", "-m", "claude-sonnet-5-5", "Objetivo: decir hola. Listo cuando: dijiste hola."];
  spawn(NODE, [yo, "raiz", Buffer.from(JSON.stringify(env)).toString("base64"), ...pa], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  await new Promise((r) => mon.on("exit", r));
  const ver = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim() : "(no existe)");
  console.log("== salida de pa --async:\n" + ver(path.join(T, "pa-salida.txt")).slice(0, 1500));
  console.log("== llamadas al claude falso:\n" + ver(path.join(T, "falso.log")));
  console.log("== hojas (consola del «MCP» de Claude):\n" + ver(path.join(T, "hojas.txt")));
  const dir = path.join(T, "estado", "demo");
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) if (/\.(listo|log)$/.test(f)) console.log(`== ${f}:\n${ver(path.join(dir, f)).slice(-1200)}`);
  console.log("== ventanas de consola visibles durante la cadena:\n" + ver(salida));
  console.log("FIN");
}
