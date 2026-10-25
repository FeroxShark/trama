"use strict";
// Gestor del motor nativo para Windows: arranca trama-motor con Node/Electron
// sin requerir WSL2 ni máquinas virtuales de Linux.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MOTOR_URL = "http://127.0.0.1:8791";

function buscarMotorJs(payloadDir) {
  const candidatos = [
    path.join(payloadDir || "", "app", "dist-electron", "motor.js"),
    path.join(payloadDir || "", "dist-electron", "motor.js"),
    path.resolve(__dirname, "..", "..", "app", "dist-electron", "motor.js"),
  ];
  return candidatos.find((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  }) || null;
}

function crearMotorNativo({ payloadDir, env = process.env, log = () => {} } = {}) {
  let proceso = null;
  const motorJs = buscarMotorJs(payloadDir);

  async function estaVivo() {
    try {
      const res = await fetch(`${MOTOR_URL}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metodo: "version", args: [] }),
        signal: AbortSignal.timeout(1500),
      });
      return res.ok || res.status === 403 || res.status === 200;
    } catch {
      return false;
    }
  }

  function arrancar() {
    if (proceso) return;
    if (!motorJs) {
      log("nativo: no se encontró dist-electron/motor.js");
      return;
    }
    log(`nativo: arrancando motor con ${motorJs}`);
    const bin = process.execPath;
    const motorEnv = {
      ...env,
      ELECTRON_RUN_AS_NODE: "1",
      TRAMA_LOCAL: "1",
      TRAMA_PUERTO: env.TRAMA_PUERTO || "8791",
    };

    try {
      proceso = spawn(bin, [motorJs], {
        env: motorEnv,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      proceso.stdout?.on("data", (d) => log(`[motor] ${d.toString().trim()}`));
      proceso.stderr?.on("data", (d) => log(`[motor err] ${d.toString().trim()}`));
      proceso.on("close", (code) => {
        log(`nativo: motor cerró con código ${code}`);
        proceso = null;
      });
    } catch (e) {
      log(`nativo: error al lanzar proceso: ${e.message}`);
      proceso = null;
    }
  }

  function parar() {
    if (proceso) {
      log("nativo: deteniendo motor");
      try {
        proceso.kill();
      } catch {}
      proceso = null;
    }
  }

  return {
    arrancar,
    parar,
    estaVivo,
    get activo() {
      return !!proceso;
    },
    motorJs,
    MOTOR_URL,
  };
}

module.exports = { crearMotorNativo, buscarMotorJs, MOTOR_URL };
