#!/usr/bin/env node
// recortar-salida.mjs <líneas> <comando> — corre el comando (con la shell de la plataforma: PowerShell en Windows, sh en lo demás),
// mezcla stdout y stderr y deja pasar sólo las últimas <líneas>. Es el `( cmd ) 2>&1 | awk …` del recorte de salidas de tests
// (PA_RECORTE) de latido, para la herramienta `PowerShell` de Claude Code, que no tiene awk ni pipefail. Devuelve el código del comando.
// `PA_RECORTE_SHELL` cambia la shell (los tests, para probarlo en Linux). Sin cola infinita: guarda sólo las últimas N líneas.
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const n = Number.parseInt(process.argv[2] ?? "", 10);
const comando = process.argv[3] ?? "";
if (!Number.isInteger(n) || n < 1 || comando === "") {
  process.stderr.write("uso: recortar-salida.mjs <líneas> <comando>\n");
  process.exit(2);
}

const shell = process.env.PA_RECORTE_SHELL || (process.platform === "win32" ? "powershell.exe" : "/bin/sh");
const esPosix = /(?:^|[\\/])(?:ba|z|da)?sh(?:\.exe)?$/i.test(shell);
const args = esPosix ? ["-c", comando] : ["-NoProfile", "-NonInteractive", "-Command", `${comando}\nif ($LASTEXITCODE) { exit $LASTEXITCODE }`];

const cola = new Array(n);
let total = 0;
const poner = (linea) => {
  cola[total % n] = linea;
  total++;
};

const hijo = spawn(shell, args, { stdio: ["inherit", "pipe", "pipe"], windowsHide: true });
for (const flujo of [hijo.stdout, hijo.stderr]) {
  const dec = new StringDecoder("utf8");
  let resto = "";
  const trozo = (texto) => {
    const partes = (resto + texto).split("\n");
    resto = partes.pop() ?? "";
    for (const p of partes) poner(p.endsWith("\r") ? p.slice(0, -1) : p);
  };
  flujo.on("data", (b) => trozo(dec.write(b)));
  flujo.on("end", () => {
    trozo(dec.end());
    if (resto !== "") poner(resto);
    resto = "";
  });
}

hijo.on("error", (e) => {
  process.stderr.write(`recortar-salida: no pude lanzar ${shell}: ${e.message}\n`);
  process.exitCode = 127;
});
hijo.on("close", (codigo, senal) => {
  const lineas = [];
  if (total > n) lineas.push(`[recortado por el hook: se omitieron las primeras ${total - n} líneas; si te falta algo, volvé a correr filtrando con grep]`);
  for (let i = total > n ? total - n : 0; i < total; i++) lineas.push(cola[i % n]);
  if (lineas.length) process.stdout.write(`${lineas.join("\n")}\n`);
  if (process.exitCode === undefined) process.exitCode = codigo ?? (senal ? 1 : 0);
});
