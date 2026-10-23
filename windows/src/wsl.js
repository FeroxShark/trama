"use strict";
// Lo único que toca Windows de verdad: wsl.exe, PowerShell (para el permiso de administrador) y la
// consola donde se inicia sesión. `pasos.js` lo recibe por inyección; acá no hay lógica de pasos.

const { spawn } = require("node:child_process");

// wsl.exe habla en UTF-16 con sus propios mensajes (`-l`, `--install`…) y en UTF-8 cuando corre un
// programa de adentro. WSL_UTF8=1 lo pide en UTF-8 y, si una versión vieja lo ignora, se reconoce
// por los ceros de UTF-16.
function decodificar(buf) {
  if (buf.length >= 2 && buf.includes(0)) return buf.toString("utf16le").replace(/^﻿/, "").replace(/\0/g, "");
  return buf.toString("utf8");
}

function wsl(args, { input, onLinea, timeoutMs = 0 } = {}) {
  return new Promise((resolver) => {
    let p;
    try {
      p = spawn("wsl.exe", args, { windowsHide: true, env: { ...process.env, WSL_UTF8: "1" }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      return resolver({ code: -1, stdout: "", stderr: String(e), falta: true });
    }
    const salida = [];
    const error = [];
    let resto = "";
    let fin = false;
    const cerrar = (r) => {
      if (fin) return;
      fin = true;
      clearTimeout(reloj);
      resolver(r);
    };
    const reloj = timeoutMs
      ? setTimeout(() => {
          p.kill();
          cerrar({ code: -2, stdout: decodificar(Buffer.concat(salida)), stderr: "Se agotó el tiempo de espera.", falta: false });
        }, timeoutMs)
      : null;
    p.stdout.on("data", (b) => {
      salida.push(b);
      if (!onLinea) return;
      const partes = (resto + b.toString("utf8")).split(/\r?\n/);
      resto = partes.pop();
      for (const l of partes) onLinea(l);
    });
    p.stderr.on("data", (b) => error.push(b));
    p.on("error", (e) => cerrar({ code: -1, stdout: "", stderr: String(e), falta: e.code === "ENOENT" }));
    p.on("close", (code) => {
      if (resto && onLinea) onLinea(resto);
      cerrar({ code: code ?? -1, stdout: decodificar(Buffer.concat(salida)), stderr: decodificar(Buffer.concat(error)), falta: false });
    });
    p.stdin.on("error", () => {});
    p.stdin.end(input ?? "");
  });
}

// `wsl.exe <args>` como administrador (aparece el aviso de Windows). 1223 = la persona dijo que no.
function elevarWsl(args) {
  const lista = args.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
  const ps =
    `try { $p = Start-Process -FilePath wsl.exe -ArgumentList ${lista} -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode } ` +
    `catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1223 }`;
  return new Promise((resolver) => {
    const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { windowsHide: true });
    const error = [];
    p.stderr.on("data", (b) => error.push(b));
    p.on("error", (e) => resolver({ code: -1, stderr: String(e) }));
    p.on("close", (code) => {
      // `wsl --install` abre «Welcome to Windows Subsystem for Linux» (wslsettings.exe) encima del asistente.
      if (args.includes("--install")) cerrarBienvenidaWsl();
      resolver({ code, cancelado: code === 1223, stderr: decodificar(Buffer.concat(error)) });
    });
  });
}

// Cierra (con WM_CLOSE, sin /F) la ventana de bienvenida de WSL. La ventana aparece algo después de que
// termine el instalador, así que se intenta tres veces. Sin verificar en Windows de verdad.
function cerrarBienvenidaWsl() {
  const intento = () => {
    try {
      const p = spawn("taskkill.exe", ["/IM", "wslsettings.exe"], { windowsHide: true, stdio: "ignore" });
      p.on("error", () => {});
    } catch {}
  };
  for (const ms of [0, 2000, 6000]) setTimeout(intento, ms).unref?.();
}

// Que Windows reabra Trama una vez, en el próximo inicio de sesión (HKCU RunOnce; sin administrador).
const RUNONCE = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
function reabrirTrasReinicio(exe) {
  return {
    registrar() {
      return new Promise((resolver) => {
        const p = spawn("reg.exe", ["add", RUNONCE, "/v", "Trama", "/t", "REG_SZ", "/d", `"${exe}"`, "/f"], { windowsHide: true, stdio: "ignore" });
        p.on("error", () => resolver(false));
        p.on("close", (c) => resolver(c === 0));
      });
    },
    quitar() {
      return new Promise((resolver) => {
        const p = spawn("reg.exe", ["delete", RUNONCE, "/v", "Trama", "/f"], { windowsHide: true, stdio: "ignore" });
        p.on("error", () => resolver(false));
        p.on("close", (c) => resolver(c === 0));
      });
    },
  };
}

// Una consola con `comando` corriendo adentro de la distro: Windows Terminal si está, y si no la
// consola de siempre. El comando viaja en base64 para no pelearse con las comillas ni con el `;`
// que Windows Terminal toma como separador.
function abrirConsola(distro, comando) {
  const b64 = Buffer.from(comando, "utf8").toString("base64");
  const wslArgs = ["wsl.exe", "-d", distro, "-e", "bash", "-lc", `bash <(echo ${b64}|base64 -d)`];
  return new Promise((resolver, rechazar) => {
    const probar = (exe, args, siFalla) => {
      const p = spawn(exe, args, { detached: true, stdio: "ignore", windowsHide: false });
      p.on("error", (e) => (siFalla ? siFalla() : rechazar(e)));
      p.on("spawn", () => {
        p.unref();
        resolver();
      });
    };
    probar("wt.exe", wslArgs, () => probar("cmd.exe", ["/c", "start", "", ...wslArgs]));
  });
}

// Deja `wsl.exe -d <distro> -e sleep infinity` corriendo mientras la ventana esté abierta: así
// WSL no apaga la distro por inactiva y el motor sigue vivo para el celular y los workers.
// `wsl --terminate` y `wsl --shutdown` (los pasos «sistema» y el modo espejo) lo matan: mientras no
// se llame a `parar()`, al morir se relanza solo (con espera: 1 s, y si cae enseguida de nuevo, el doble
// hasta `topeMs`, para no girar en vacío si la distro todavía no existe).
function mantenerVivo(distro, { lanzar, programar = setTimeout, cancelar = clearTimeout, ahora = Date.now, baseMs = 1000, topeMs = 15000, vidaMinMs = 5000 } = {}) {
  const lanzarReal = () => spawn("wsl.exe", ["-d", distro, "-e", "sleep", "infinity"], { windowsHide: true, stdio: "ignore" });
  lanzar = lanzar || lanzarReal;
  let hijo = null;
  let quiero = false;
  let reloj = null;
  let espera = baseMs;
  const arrancar = () => {
    reloj = null;
    if (!quiero || hijo) return;
    const mio = lanzar();
    const desde = ahora();
    hijo = mio;
    let visto = false;
    const salio = () => {
      if (visto) return;
      visto = true;
      if (hijo === mio) hijo = null;
      if (!quiero || reloj) return;
      espera = ahora() - desde >= vidaMinMs ? baseMs : Math.min(espera * 2, topeMs);
      reloj = programar(arrancar, espera);
      reloj?.unref?.();
    };
    mio.on("error", salio);
    mio.on("close", salio);
  };
  return {
    iniciar() {
      quiero = true;
      if (!hijo) {
        if (reloj) cancelar(reloj);
        reloj = null;
        espera = baseMs;
        arrancar();
      }
    },
    parar() {
      quiero = false;
      if (reloj) cancelar(reloj);
      reloj = null;
      const h = hijo;
      hijo = null;
      if (h) h.kill();
    },
    // ¿hay un `sleep infinity` andando ahora? (para los tests y el log)
    get activo() {
      return !!hijo;
    },
  };
}

module.exports = { wsl, elevarWsl, abrirConsola, mantenerVivo, decodificar, reabrirTrasReinicio, cerrarBienvenidaWsl };
