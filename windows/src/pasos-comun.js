"use strict";
// Lo que comparten el asistente y la carcasa: el error de un paso con su detalle, las URLs locales y el parseo de lo que
// contesta `trama-estado --json`. Sin Electron ni Windows.

const OLLAMA_URL = "http://localhost:11434";
const MOTOR_URL = "http://localhost:8791";

class ErrorPaso extends Error {
  constructor(paso, mensaje, detalle = "") {
    super(mensaje);
    this.name = "ErrorPaso";
    this.paso = paso;
    this.detalle = detalle;
  }
}

function ultimasLineas(texto, n = 15) {
  return String(texto || "").trim().split(/\r?\n/).slice(-n).join("\n");
}

function parsearEstado(texto) {
  const i = String(texto).indexOf("{");
  let o;
  try {
    o = JSON.parse(String(texto).slice(i < 0 ? 0 : i));
  } catch {
    throw new ErrorPaso("instalar", "trama-estado no contestó algo legible.", ultimasLineas(texto));
  }
  if (o.version !== 1) throw new ErrorPaso("instalar", `trama-estado trae una versión que esta carcasa no conoce (${o.version}).`);
  const prov = (x) => ({ instalado: !!x?.instalado, logueado: !!x?.logueado });
  return {
    claude: prov(o.claude),
    agy: prov(o.agy),
    ollama: { url: o.ollama?.url || OLLAMA_URL, responde: !!o.ollama?.responde, modelos: o.ollama?.modelos || [] },
    motor: { vivo: !!o.motor?.vivo, url: o.motor?.url || MOTOR_URL },
  };
}

module.exports = { OLLAMA_URL, MOTOR_URL, ErrorPaso, ultimasLineas, parsearEstado };
