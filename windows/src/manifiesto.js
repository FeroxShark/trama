"use strict";
// Todo lo que Trama deja FUERA de su propia carpeta de instalación, con la versión que lo empezó a dejar
// (`desde`) y la primera versión que ya no lo usa (`hasta`; null = sigue en uso). La limpieza
// (limpieza.js) lee esto y nada más: quitar algo que no está acá es imposible, y una entrada sólo se
// puede quitar si el sistema confirma que es de Trama (ver `dueno`).
//
// Al sacar una pieza de una versión, NO se borra la entrada: se le pone `hasta`. Así una instalación
// vieja sabe qué limpiar aunque salte varias versiones.
//
// Campos:
//   id        estable; nunca se reusa
//   ambito    "windows"
//   grupo     "carcasa" (la app de Windows) | "motor-nativo" (el motor de Trama) | "sistema" (cosas compartidas con el resto de la máquina)
//   tipo      carpeta | registro | path (una carpeta en el PATH del usuario) | gestionado (lo maneja el instalador NSIS) | compartido
//   ruta      con %VARIABLES%
//   que       qué es, en una frase (se muestra tal cual)
//   quitar    "seguro"   se puede quitar sin pedir más cuando está muerta (y en el desinstalador)
//             "datos"    datos propios de Trama en Windows: sólo el desinstalador, y preguntando
//             "nunca"    es del usuario o está compartido: jamás se borra, a lo sumo se avisa
//   auto      true = la limpieza de después de actualizar lo quita sola; false = sólo con el botón

const VERSION_MANIFIESTO = 1;

const ENTRADAS = [
  // ---------- Windows ----------
  {
    id: "win-instalacion",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "gestionado",
    ruta: "%LOCALAPPDATA%\\Programs\\Trama",
    que: "La app, el acceso directo del menú Inicio y la entrada de «Aplicaciones» (los maneja el instalador de Windows)",
    desde: "0.1.0",
    hasta: null,
    quitar: "nunca",
    auto: false,
  },
  {
    id: "win-cache-actualizador",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "carpeta",
    ruta: "%LOCALAPPDATA%\\trama-windows-updater",
    que: "Descargas viejas del actualizador (instaladores ya usados)",
    desde: "0.1.0",
    hasta: null,
    quitar: "seguro",
    auto: true,
  },
  {
    id: "win-datos-carcasa",
    ambito: "windows",
    grupo: "carcasa",
    tipo: "carpeta",
    ruta: "%APPDATA%\\Trama",
    que: "Los ajustes de la app de Windows, su registro (carcasa.log) y el estado del asistente",
    desde: "0.1.0",
    hasta: null,
    quitar: "datos",
    auto: false,
  },
];

// Compara "0.2.0" con "0.10.1" por números. Sin versión (o con letras raras) cuenta como 0.
function comparar(a, b) {
  const n = (v) => String(v || "0").split(/[.+-]/).slice(0, 3).map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

// ¿La versión `version` todavía usa esta entrada?
const vigente = (entrada, version) => !entrada.hasta || comparar(version, entrada.hasta) < 0;
const muerta = (entrada, version) => !vigente(entrada, version);

// Valida que el manifiesto esté bien armado (los tests lo corren): ids únicos, versiones y campos obligatorios.
function validar(entradas = ENTRADAS) {
  const vistos = new Set();
  const errores = [];
  for (const e of entradas) {
    if (vistos.has(e.id)) errores.push(`id repetido: ${e.id}`);
    vistos.add(e.id);
    if (e.ambito !== "windows") errores.push(`${e.id}: ámbito inválido`);
    if (!["seguro", "datos", "nunca"].includes(e.quitar)) errores.push(`${e.id}: quitar inválido`);
    if (!/^\d+\.\d+\.\d+$/.test(e.desde || "")) errores.push(`${e.id}: desde inválido`);
    if (e.hasta != null && (!/^\d+\.\d+\.\d+$/.test(e.hasta) || comparar(e.hasta, e.desde) <= 0)) errores.push(`${e.id}: hasta inválido`);
    if (!e.ruta || !e.que || !e.grupo || !e.tipo) errores.push(`${e.id}: faltan campos`);
    if (e.auto && e.quitar !== "seguro") errores.push(`${e.id}: sólo lo seguro se quita solo`);
  }
  return errores;
}

module.exports = { ENTRADAS, VERSION_MANIFIESTO, comparar, vigente, muerta, validar };
