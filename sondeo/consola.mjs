// Sondeo (sólo CI de Windows): qué consola tiene cada eslabón de la cadena de `pa --async` y si aparece alguna ventana visible.
// No es parte de la app. Cada hoja (PowerShell) reporta GetConsoleCP (0 = sin consola), GetConsoleWindow (0 = consola sin ventana)
// e IsWindowVisible. Un monitor aparte anota toda ventana de consola visible que aparezca durante cada escenario.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const modo = process.argv[2];

const HOJA = path.join(aqui, "hoja.ps1");
const MONITOR = path.join(aqui, "monitor.ps1");
const hoja = (out, nombre, espera = 4) => ["powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", HOJA, "-out", out, "-espera", String(espera), "-nombre", nombre]];

// --- modos internos -------------------------------------------------------------------------------------------------------------
if (modo === "lanzador") {
  // Como LANZADOR_JS: lee el pedido, suelta cada hijo con su salida al log y se va.
  const j = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  for (const h of j.hijos) {
    const fd = fs.openSync(j.log, "a");
    const p = spawn(h.cmd, h.args, { detached: h.detached, windowsHide: true, stdio: ["ignore", fd, fd] });
    p.on("error", () => {});
    p.unref();
  }
  fs.writeFileSync(j.listo, "1");
  process.exit(0);
}
if (modo === "runner") {
  // Como el runner de pa: lanza el «claude» con su salida a archivos (lanzar.ts:873) y, como Claude con un MCP, un hijo con stderr inherit.
  const [, , , out, prefijo] = process.argv;
  const fd = fs.openSync(out + ".log", "a");
  const [c1, a1] = hoja(out, `${prefijo}/worker(fd)`);
  const w = spawn(c1, a1, { windowsHide: true, stdio: ["ignore", fd, fd] });
  const [c2, a2] = hoja(out, `${prefijo}/mcp(pipe,pipe,inherit)`);
  const m = spawn(c2, a2, { windowsHide: true, stdio: ["pipe", "pipe", "inherit"] });
  m.stdout.resume();
  let vivos = 2;
  const fin = () => --vivos === 0 && process.exit(0);
  w.on("exit", fin);
  m.on("exit", fin);
  setTimeout(() => process.exit(0), 40_000);
}
if (modo === "respaldo") {
  // Como lanzarSuelto sin WMI: desde un proceso con consola sin ventana (pa bajo el MCP), suelta el runner y se va enseguida.
  const [, , , out, prefijo, det] = process.argv;
  const fd = fs.openSync(out + ".log", "a");
  const p = spawn(NODE, [fileURLToPath(import.meta.url), "runner", out, prefijo], { detached: det === "1", windowsHide: true, stdio: ["ignore", fd, fd] });
  p.unref();
  process.exit(0);
}

if (modo === "raiz-claude") {
  // Sin consola (la lanzan con detached, como la ventana de Electron). Corre `claude mcp list`, que arranca cada servidor MCP para chequearlo.
  const [, , , claude, variante, out, nombre] = process.argv;
  const fd = fs.openSync(out + ".log", "a");
  const env = { ...process.env, SONDEO_NOMBRE: nombre + "/" };
  const stdio = variante === "fd" ? ["ignore", fd, fd] : ["pipe", "pipe", "pipe"];
  const p = spawn("cmd.exe", ["/d", "/s", "/c", `""${claude}" mcp list"`], { env, windowsHide: true, windowsVerbatimArguments: true, detached: variante === "det", stdio });
  p.stdout?.on("data", (d) => fs.appendFileSync(out + ".log", d));
  p.stderr?.on("data", (d) => fs.appendFileSync(out + ".log", d));
  p.on("exit", (c) => { fs.appendFileSync(out + ".log", `claude salió con ${c}\n`); process.exit(0); });
  setTimeout(() => process.exit(0), 60_000);
}

if (modo === "relanzar") {
  // Como `relanzar` de cli/pa.ts dentro del runner (detached, sin consola): otro proceso de consola con stdio heredado.
  const [, , , out, nombre, ocultar] = process.argv;
  const [c, a] = hoja(out, nombre, 3);
  spawnSync(c, a, { stdio: "inherit", ...(ocultar === "1" ? { windowsHide: true } : {}) });
  process.exit(0);
}

// --- el sondeo ----------------------------------------------------------------------------------------------------------------------
if (!modo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sondeo-"));
  const q = (t) => `'${t.replaceAll("'", "''")}'`;
  const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

  function wmi(linea, flags) {
    const props = flags ? `@{ShowWindow=[uint16]0;CreateFlags=[uint32]${flags}}` : "@{ShowWindow=[uint16]0}";
    const ps = [
      "$ErrorActionPreference='Stop'",
      "$ProgressPreference='SilentlyContinue'",
      `$st=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property ${props}`,
      `$a=@{CommandLine=${q(linea)};ProcessStartupInformation=$st}`,
      "$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $a",
      'Write-Output ("rv=" + $r.ReturnValue + " pid=" + $r.ProcessId)',
    ].join("\n");
    const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8", timeout: 60_000 });
    const o = (r.stdout || "").trim();
    return /rv=/.test(o) ? o : `${o} ${(r.stderr || "").replace(/#< CLIXML|<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300)}`;
  }

  function monitor(nombre, segundos) {
    const out = path.join(dir, `${nombre}.ventanas`);
    const listo = out + ".listo";
    const p = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", MONITOR, "-out", out, "-listo", listo, "-segundos", String(segundos)], { windowsHide: true, stdio: "ignore" });
    return {
      listo: async () => {
        for (let i = 0; i < 300 && !fs.existsSync(listo); i++) await esperar(100);
      },
      fin: () => new Promise((r) => p.on("exit", () => r(fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "(sin archivo del monitor)"))),
    };
  }

  async function escenario(nombre, correr, segundos = 22) {
    const out = path.join(dir, `${nombre}.txt`);
    const mon = monitor(nombre, segundos);
    await mon.listo();
    const extra = await correr(out);
    const ventanas = await mon.fin();
    const hojas = fs.existsSync(out) ? fs.readFileSync(out, "utf8").trim() : "(ninguna hoja reportó)";
    console.log(`\n===== ${nombre}${extra ? `  [${extra}]` : ""}\n-- hojas:\n${hojas}\n-- ventanas de consola visibles:\n${ventanas || "(ninguna)"}`);
  }

  function pedido(out, nombre, hijos) {
    const f = path.join(dir, `${nombre}.json`);
    fs.writeFileSync(f, JSON.stringify({ hijos, log: out + ".log", listo: out + ".listo" }));
    return f;
  }
  const yo = fileURLToPath(import.meta.url);
  const runner = (out, prefijo, detached) => ({ cmd: NODE, args: [yo, "runner", out, prefijo], detached });
  const consolaCmd = (out, prefijo) => {
    const [c, a] = hoja(out, `${prefijo}/consola-del-cmd`, 0);
    return { cmd: c, args: a, detached: false };
  };
  const lineaCmd = (f) => `cmd.exe /d /s /c "set ELECTRON_RUN_AS_NODE=1&& "${NODE}" "${yo}" lanzador "${f}""`;

  console.log(`node ${process.version} · ${os.release()} · ${os.userInfo().username}`);
  if (process.env.SONDEO_V3) {
    for (const [nombre, ocultar] of [["R0-relanzar-sin-windowsHide", "0"], ["R1-relanzar-con-windowsHide", "1"]]) {
      await escenario(nombre, async (out) => {
        const fd = fs.openSync(out + ".log", "a");
        spawn(NODE, [yo, "relanzar", out, nombre.slice(0, 2), ocultar], { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] }).unref();
        await esperar(16000);
      });
    }
    for (const [nombre, sw] of [["WM0-wmi-cmd-ShowWindow0", 0], ["WM1-wmi-cmd-ShowWindow1-control", 1]]) {
      await escenario(nombre, async (out) => {
        const [c, a] = hoja(out, nombre.slice(0, 3), 3);
        const linea = `cmd.exe /d /s /c ""${c}" ${a.map((x) => `"${x}"`).join(" ")}"`;
        const ps = ["$ErrorActionPreference='Stop'", "$ProgressPreference='SilentlyContinue'",
          `$st=New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ShowWindow=[uint16]${sw}}`,
          `$a=@{CommandLine=${q(linea)};ProcessStartupInformation=$st}`,
          "$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $a", 'Write-Output ("rv=" + $r.ReturnValue)'].join("\n");
        const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(ps, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8", timeout: 60_000 });
        await esperar(16000);
        return (r.stdout || "").trim();
      });
    }
    await esperar(5000);
    for (const f of fs.readdirSync(dir).sort()) if (/\.(txt|log)$/.test(f)) console.log(`--- ${f}\n${fs.readFileSync(path.join(dir, f), "utf8").trim().slice(0, 800)}`);
    console.log("\nFIN");
    process.exit(0);
  }

  // Control positivo: una consola visible a propósito (Start-Process abre una consola nueva normal).
  await escenario("P-control-visible", async (out) => {
    const [c, a] = hoja(out, "P/hoja-visible", 3);
    const ps = `Start-Process -FilePath ${q(c)} -ArgumentList ${q(a.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" "))}`;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], { windowsHide: true });
    await esperar(9000);
  });

  // W0: lo de hoy. WMI → cmd.exe (ShowWindow=0) → lanzador → runner detached.
  await escenario("W0-hoy", async (out) => {
    const f = pedido(out, "W0", [runner(out, "W0", true), consolaCmd(out, "W0")]);
    const rv = wmi(lineaCmd(f));
    await esperar(19000);
    return rv;
  });

  // W4: lo de hoy pero el runner sin detached: hereda la consola oculta del cmd de WMI.
  await escenario("W4-runner-sin-detached", async (out) => {
    const f = pedido(out, "W4", [runner(out, "W4", false), consolaCmd(out, "W4")]);
    const rv = wmi(lineaCmd(f));
    await esperar(19000);
    return rv;
  });

  // W1: WMI con CREATE_NO_WINDOW (0x08000000) en el cmd.exe, runner sin detached.
  await escenario("W1-cmd-sin-ventana", async (out) => {
    const f = pedido(out, "W1", [runner(out, "W1", false), consolaCmd(out, "W1")]);
    const rv = wmi(lineaCmd(f), 0x08000000);
    await esperar(19000);
    return rv;
  });

  // W2: WMI → conhost --headless → cmd.exe, runner sin detached.
  await escenario("W2-conhost-headless", async (out) => {
    const f = pedido(out, "W2", [runner(out, "W2", false), consolaCmd(out, "W2")]);
    const rv = wmi(`conhost.exe --headless ${lineaCmd(f)}`);
    await esperar(19000);
    return rv;
  });

  // W3: WMI con DETACHED_PROCESS (documentado) directo a node, sin cmd; runner sin detached.
  await escenario("W3-node-detached-sin-cmd", async (out) => {
    const f = pedido(out, "W3", [runner(out, "W3", false)]);
    const rv = wmi(`"${NODE}" "${yo}" lanzador "${f}"`, 8);
    await esperar(19000);
    return rv;
  });

  // F0/F1: respaldo sin WMI desde un pa con consola sin ventana (pipes + windowsHide = CREATE_NO_WINDOW), runner con y sin detached.
  for (const [nombre, det] of [["F0-respaldo-detached", "1"], ["F1-respaldo-sin-detached", "0"]]) {
    await escenario(nombre, async (out) => {
      const p = spawn(NODE, [yo, "respaldo", out, nombre.slice(0, 2), det], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      p.stdout.resume();
      p.stderr.resume();
      await new Promise((r) => p.on("exit", r));
      await esperar(19000);
      return "pa ya terminó";
    });
  }
  // C: Claude Code real arrancando un servidor MCP (la hoja), desde una raíz sin consola.
  const donde = spawnSync("where", ["claude"], { encoding: "utf8", windowsHide: true });
  const claude = (donde.stdout || "").split(/\r?\n/).find((l) => /\.cmd$/i.test(l.trim()))?.trim();
  if (claude) {
    const mcpOut = path.join(dir, "C-mcp.txt");
    const add = spawnSync("cmd.exe", ["/d", "/s", "/c", `""${claude}" mcp add -s user sondeo -- powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${HOJA}" -out "${mcpOut}" -espera 0 -nombre mcp"`], { encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout: 60_000 });
    console.log(`claude: ${claude}\nmcp add: rc=${add.status} ${(add.stdout || "").trim()} ${(add.stderr || "").trim()}`);
    for (const [nombre, variante] of [["C1-lider-pipes", "pipes"], ["C2-worker-fd-sin-consola", "fd"], ["C3-claude-detached", "det"]]) {
      await escenario(nombre, async (out) => {
        const p = spawn(NODE, [yo, "raiz-claude", claude, variante, mcpOut, nombre], { detached: true, windowsHide: true, stdio: "ignore" });
        await new Promise((r) => p.on("exit", r));
        await esperar(3000);
        return `variante ${variante}`;
      }, 30);
    }
  } else console.log("\n(sin claude: no corren los escenarios C)");

  await esperar(8000);
  console.log("\n######## todo lo que reportaron las hojas (al final, por si alguna llegó tarde)");
  for (const f of fs.readdirSync(dir).sort()) {
    if (!/\.(txt|log)$/.test(f)) continue;
    console.log(`--- ${f}\n${fs.readFileSync(path.join(dir, f), "utf8").trim().slice(0, 1500)}`);
  }
  console.log("\nFIN");
}
