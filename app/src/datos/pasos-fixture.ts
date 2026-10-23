// Un worker inventado con un paso de cada tipo, para capturas y pruebas sin un transcript de verdad
// (ids, rutas y tareas inventados: el repo es público). Lo usa `fuente` con fixtures, para cualquier id.
import type { Detalle, Paso, TipoPaso, VistaPasos } from "./pasos";

const T0 = Date.parse("2026-03-10T12:00:00Z");
const corto = (t: string) => ({ t, total: t.length, recortado: false });

let n = 0;
function paso(tipo: TipoPaso, titulo: string, seg: number, dur: number | null, detalle: Detalle, mas: Partial<Paso> = {}): Paso {
  const i = n++;
  return { n: i, v: i + 1, id: `toolu_demo_${i}`, tipo, titulo, t: T0 + seg * 1000, dur: dur === null ? null : dur * 1000, estado: "ok", error: null, detalle, ...mas };
}

/** `vivo`: el mismo worker a mitad de camino, con `npm test` corriendo y sin mensaje final. */
export function pasosFijos(id: string, vivo = false): VistaPasos {
  n = 0;
  const sub = [
    paso("buscar", "usarCuenta", 41, 1, { clase: "buscar", herramienta: "Grep", patron: "usarCuenta", ruta: "src", resultados: 3, texto: corto("src/cuenta.ts\nsrc/pantalla.ts\nsrc/pantalla.test.ts") }),
    paso("leer", "src/cuenta.ts", 42, 1, { clase: "leer", ruta: "src/cuenta.ts", desde: 1, lineas: 3, total: 3, imagen: false, texto: corto("export function usarCuenta() {\n  return 1;\n}") }),
  ];
  const largo = Array.from({ length: 400 }, (_, i) => `línea ${i} de una salida larga`).join("\n");
  const pasos: Paso[] = [
    paso("pensar", "", 3, 3, { clase: "pensar" }),
    paso("leer", "src/cuenta.ts", 4, 1, { clase: "leer", ruta: "src/cuenta.ts", desde: 1, lineas: 3, total: 3, imagen: false, texto: corto("export function usarCuenta() {\n  return 1;\n}") }),
    paso("buscar", "TODO", 6, 2, { clase: "buscar", herramienta: "Grep", patron: "TODO", ruta: null, resultados: 0, texto: corto("No files found") }),
    paso("editar", "src/cuenta.ts", 9, 2, {
      clase: "editar", ruta: "src/cuenta.ts", masCambios: 0, mas: 2, menos: 1,
      cambios: [{ viejo: corto("  return 1;"), nuevo: corto("  const n = contar();\n  return n + 1;"), todo: false, desde: 2 }],
    }),
    paso("escribir", "src/contar.ts", 12, 1, {
      clase: "escribir", ruta: "src/contar.ts", contenido: corto("export const contar = () => 41;\n"), lineas: 1, nuevo: true, mas: 1, menos: 0,
    }),
    paso("correr", "npm test", 14, 20, {
      clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: 1, interrumpido: false, fondo: false,
      salida: { t: `${largo.slice(0, 600)}\n… ${largo.length - 900} caracteres omitidos …\n${largo.slice(-300)}`, total: largo.length, recortado: true },
    }, { estado: "fallo", error: "2 tests fallan" }),
    paso("delegar", "Buscar los usos de usarCuenta", 40, 6, {
      clase: "delegar", descripcion: "Buscar los usos de usarCuenta", agente: "Explore", modelo: "claude-haiku-5-5", prompt: corto("Buscá dónde se usa usarCuenta y decime los archivos."),
      respuesta: corto("Se usa en src/pantalla.ts y en su test."), agentId: "a1b2c3d4", fondo: false, tokens: 12_400, usos: 2, pasos: sub, omitidos: 0,
    }),
    paso("correr", "npm test", 50, 18, { clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: 0, interrumpido: false, fondo: false, salida: corto("22 pass\n0 fail") }),
    paso("texto", "RESULTADO: arreglé usarCuenta y los tests pasan.", 70, 1, {
      clase: "texto", final: true, texto: corto("RESULTADO: arreglé usarCuenta y los tests pasan. Supuestos: el conteo empieza en 1; no toqué los tests viejos.\nARCHIVOS: src/cuenta.ts, src/contar.ts"),
    }),
  ];
  if (vivo) {
    // Hasta el delegar, y `npm test` todavía corriendo: sin salida, sin código y sin fin.
    const hasta = pasos.slice(0, 7);
    hasta.push(paso("correr", "npm test", 50, null, { clase: "correr", comando: corto("npm test"), descripcion: "Corre los tests", codigo: null, interrumpido: false, fondo: false, salida: corto("# Subtest: usarCuenta\nok 1 - cuenta\n# Subtest: contar") }, { estado: "corriendo" }));
    // Toda la corrida corrida al ahora: el paso en curso lleva 38 s (con el reloj quieto de las capturas, siempre los mismos).
    const delta = Date.now() - 38_000 - (T0 + 50_000);
    for (let i = 0; i < hasta.length; i++) {
      const t = hasta[i].t;
      hasta[i] = { ...hasta[i], t: t === null ? null : t + delta };
    }
    return {
      id, hay: true, gen: 1, v: 9, omitidos: 0, pasos: hasta,
      encabezado: {
        tarea: "Arreglá usarCuenta para que cuente bien", modelo: "claude-sonnet-5-5", effort: "medium", turnos: 7,
        tokens: { entrada: 90, cacheCreado: 6_100, cacheLeido: 61_000, salida: 1_500 }, total: 68_690, cache: 61_000 / 67_100,
        inicio: T0 + delta, fin: null, dur: null, compactaciones: 0, pasos: hasta.length,
        archivos: [{ ruta: "src/cuenta.ts", mas: 2, menos: 1, ediciones: 1, nuevo: false }, { ruta: "src/contar.ts", mas: 1, menos: 0, ediciones: 1, nuevo: true }],
        mas: 3, menos: 1,
      },
    };
  }
  return {
    id, hay: true, gen: 1, v: n + 1, omitidos: 0, pasos,
    encabezado: {
      tarea: "Arreglá usarCuenta para que cuente bien", modelo: "claude-sonnet-5-5", effort: "medium", turnos: 9,
      tokens: { entrada: 120, cacheCreado: 8_400, cacheLeido: 96_000, salida: 2_300 }, total: 106_820, cache: 96_000 / 104_520,
      inicio: T0, fin: T0 + 71_000, dur: 71_000, compactaciones: 0, pasos: pasos.length,
      archivos: [{ ruta: "src/cuenta.ts", mas: 2, menos: 1, ediciones: 1, nuevo: false }, { ruta: "src/contar.ts", mas: 1, menos: 0, ediciones: 1, nuevo: true }],
      mas: 3, menos: 1,
    },
  };
}
