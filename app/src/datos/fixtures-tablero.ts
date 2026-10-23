// Un tablero inventado para las capturas y las mediciones (nada real): unos 500 items, con una
// bandeja de más de 200 para ver que las columnas largas scrollean sin trabar. Tiene la forma de
// lo que manda el main (electron/tablero.ts) y sale siempre igual.

const PROYECTOS = ["atlas", "brote", "cauce", "duna", "eco", "faro", "sistema", "casa"];
const ETAPAS: Record<string, string> = {
  atlas: "activo",
  brote: "activo",
  cauce: "pausado",
  duna: "idea",
  eco: "infra",
  faro: "?",
  sistema: "área",
  casa: "área",
};
const VERBOS = ["Revisar", "Probar", "Decidir", "Arreglar", "Medir", "Ordenar", "Escribir", "Mirar"];
const COSAS = [
  "el arranque en frío",
  "los colores del panel de noche",
  "la migración de la tabla de eventos",
  "el aviso cuando se corta la red",
  "qué pasa con dos ventanas a la vez",
  "el atajo de teclado que no responde en la segunda pantalla",
  "el texto del botón de exportar",
  "la importación de un archivo de más de mil filas",
  "si el cálculo redondea para abajo",
];
const PRUEBAS = ["npm test", "atlas --exportar ejemplo.csv", "Abrir Brote y tocar «Regar»", "cauce medir --dias 7"];

const CUANTOS: [string, number][] = [
  ["bandeja", 224],
  ["sigue", 38],
  ["en-curso", 7],
  ["espera-dueno", 12],
  ["espera-externo", 9],
  ["ideas", 186],
];

/**
 * El tablero de mentira, con las fechas contadas hacia atrás desde `ahora` (ms). Con `conPendientes`
 * la columna `espera-dueno` es la de `pendientesFijos` (las capturas del tablero nuevo). Con `conMaquinas`
 * unos items vienen de otra máquina (id `dell:N`, su máquina) y otra más está caída (`tablero-maquinas`).
 */
export function tableroFijo(ahora: number, conPendientes = false, conMaquinas = false): unknown {
  const iso = (ms: number) => new Date(ms).toISOString();
  let id = 0;
  const item = (columna: string, n: number) => {
    id++;
    // Revuelto: que cada columna tenga de todos los proyectos.
    const proyecto = PROYECTOS[(((id * 2654435761) >>> 0) >>> 13) % PROYECTOS.length];
    // De minutos a meses: que se vean las tres edades (m, h, d).
    const creado = ahora - (n * n * 9 + id * 13 + 4) * 60_000;
    const conPrueba = columna === "espera-dueno" ? n % 3 !== 2 : id % 11 === 0;
    return {
      id,
      columna,
      proyecto,
      titulo: `${VERBOS[id % VERBOS.length]} ${COSAS[(id + n) % COSAS.length]}`,
      detalle: id % 3 === 0 ? `Quedó a medias en la última vuelta.\nFalta ${COSAS[(id + 2) % COSAS.length]}.` : "",
      prueba: conPrueba ? PRUEBAS[id % PRUEBAS.length] : "",
      origen: id % 5 === 0 ? "pa" : id % 7 === 0 ? "shark" : "jefe",
      clave: id % 5 === 0 ? `pa:20260101-0101${String(id % 60).padStart(2, "0")}-${1000 + id}` : "",
      head: columna === "sigue" && n < 4 ? "a1b2c3d" : null,
      creado: iso(creado),
      tocado: iso(creado + 30 * 60_000),
      cerrado: null,
      hasta: null,
    };
  };
  const columnas = Object.fromEntries(CUANTOS.map(([c, cuantos]) => [c, Array.from({ length: cuantos }, (_, n) => item(c, n))]));
  if (conPendientes) columnas["espera-dueno"] = pendientesFijos(ahora) as ReturnType<typeof item>[];
  const hecho = Array.from({ length: 14 }, (_, n) => ({ ...item("hecho", n), cerrado: iso(ahora - (n * 9 + 1) * 3_600_000) }));
  const abiertos = (p: string) => Object.values(columnas).reduce((s, l) => s + l.filter((i) => i.proyecto === p).length, 0);
  const proyectos = PROYECTOS.map((p, n) => ({
    proyecto: p,
    etapa: ETAPAS[p],
    dias: ETAPAS[p] === "área" ? null : [0, 2, 41, 120, 9, 17][n] ?? null,
    abiertos: abiertos(p),
    sigue: n % 2 === 0 ? `${VERBOS[n]} ${COSAS[n]}` : null,
  }));
  // Retirados: sin repo donde mirar (el CLI los trae al final con `--retirados`, sin días).
  proyectos.push(
    { proyecto: "viejo", etapa: "retirado", dias: null, abiertos: 2, sigue: null },
    { proyecto: "ensayo", etapa: "retirado", dias: null, abiertos: 0, sigue: null },
  );
  // Tres pospuestos (ids aparte de los de las columnas): salen de ellas hasta su día.
  const dia = 86_400_000;
  const pospuestosLista = [
    { ...item("sigue", 3), id: 8001, hasta: iso(ahora + 3 * dia).slice(0, 10) },
    { ...item("bandeja", 5), id: 8002, hasta: iso(ahora + 6 * dia).slice(0, 10) },
    { ...item("ideas", 7), id: 8003, hasta: iso(ahora + 20 * dia).slice(0, 10) },
  ];
  if (conMaquinas) {
    // Como los marca electron/tablero-junto.ts: el número con su máquina, que se repite con los de acá.
    const deAlla = (l: { id: unknown }[], desde: number, cuantos: number) =>
      l.slice(desde, desde + cuantos).forEach((i, n) => Object.assign(i, { id: `dell:${n + 1}`, maquina: "dell", maquinaNombre: "Dell" }));
    deAlla(columnas["en-curso"], 1, 2);
    deAlla(columnas["sigue"], 1, 3);
    deAlla(columnas["espera-dueno"], 1, 2);
    deAlla(hecho, 1, 2);
  }
  return { version: 1, vista: { columnas, contadores: { pospuestos: pospuestosLista.length } }, hecho, proyectos, pospuestosLista, aviso: null, caidas: conMaquinas ? ["Casa"] : [] };
}

// --- Lo que le toca al usuario (el tablero nuevo, src/datos/pendientes.ts) ---------------------------
// Items de `espera-dueno` con los campos nuevos (palabras simples, opciones, una sugerida) y uno viejo
// sin ellos, repartidos en proyectos activos, con una sola cosa ya mandada y parados. Sólo para las
// capturas `tablero-nuevo*` (el resto del tablero inventado queda como estaba): ids desde 9000.

type Op = [id: string, texto: string];
export function pendientesFijos(ahora: number): unknown[] {
  const h = (horas: number) => new Date(ahora - horas * 3_600_000).toISOString();
  const base = { detalle: "", prueba: "", origen: "jefe", clave: "", head: null, cerrado: null, hasta: null };
  const preg = (id: number, proyecto: string, horas: number, titulo: string, contexto: string, ops: Op[], def: string | null, extra: object = {}) => ({
    ...base,
    id,
    columna: "espera-dueno",
    proyecto,
    tipo: "pregunta",
    titulo: `${titulo} (detalle técnico del worker)`,
    titulo_simple: titulo,
    contexto,
    // Como las numera el CLI: a, b, c… por posición (la etiqueta de cada una sólo sirve para decir cuál es la sugerida).
    opciones: ops.map(([, texto], k) => ({ id: String.fromCharCode(97 + k), texto })),
    por_defecto: def === null ? null : String.fromCharCode(97 + ops.findIndex(([o]) => o === def)),
    creado: h(horas + 2),
    tocado: h(horas),
    ...extra,
  });
  const prueba = (id: number, proyecto: string, horas: number, titulo: string, que: string) => ({
    ...base,
    id,
    columna: "espera-dueno",
    proyecto,
    tipo: "prueba",
    titulo,
    titulo_simple: titulo,
    contexto: "",
    prueba: que,
    creado: h(horas + 2),
    tocado: h(horas),
  });
  const dia = (n: number) => n * 24;
  return [
    preg(9001, "atlas", 3, "¿Guardamos los mapas en un archivo o en una base?", "Hoy se pierden al cerrar el programa. Un archivo alcanza para empezar y se cambia después.", [["archivo", "Un archivo"], ["base", "Una base de datos"], ["nada", "Todavía no"]], "archivo", {
      // La dejó un worker de ana-c7 (líder de la app): "Responder y avisar" ofrece a ese líder y al de la carpeta.
      clave: "pa:20261003-103620-49377",
    }),
    preg(9002, "atlas", 3, "¿Qué mostramos si el mapa no carga?", "Pasa cuando se corta internet. Hoy queda la pantalla en blanco.", [["ultimo", "El último que anduvo"], ["cartel", "Un cartel de error"], ["reintenta", "Reintentar solo"]], "ultimo"),
    preg(9003, "atlas", 4, "¿Se puede borrar un mapa viejo sin preguntar?", "Son los de más de un año. Borrar no tiene vuelta atrás.", [["pregunta", "Preguntar siempre"], ["sin", "Borrar sin preguntar"]], "pregunta"),
    preg(9004, "atlas", 4, "¿Qué nombre le ponemos al archivo exportado?", "Elegí uno; se puede cambiar cuando exportes.", [["fijo", "atlas-export"], ["fecha", "mapa + fecha de hoy"], ["pregunta", "Que pregunte cada vez"]], "fijo"),
    preg(9005, "atlas", 5, "¿Sacamos el modo claro?", "Casi no se usa y duplica el trabajo de cada pantalla nueva.", [["sacar", "Sí, sacarlo"], ["dejar", "Dejarlo como está"]], "sacar"),
    preg(9006, "atlas", 5, "¿Subimos la versión ahora o con lo próximo?", "Lo hecho hasta acá ya anda; lo próximo recién empieza.", [["ahora", "Ahora"], ["despues", "Con lo próximo"]], "despues"),
    prueba(9011, "atlas", 3, "Abrí un mapa grande y movelo con el mouse", "npm run dev -- --mapa grande"),
    prueba(9012, "atlas", 3, "Exportá un mapa y volvelo a importar", "atlas exportar --prueba"),
    prueba(9013, "atlas", 4, "Que pasen los tests del mapa", "npm test -- mapa"),
    // Ya contestada y mandada: sigue acá hasta que el líder la cierra.
    preg(9007, "atlas", 6, "¿Qué versión de Node usamos?", "El proyecto corre en la 22; la 24 trae mejoras que no necesitamos todavía.", [["22", "La 22"], ["24", "La 24"]], "22", {
      respuesta: { texto: "", opcion: "a", opcion_texto: "La 22", fecha: h(2) },
    }),
    preg(9021, "baliza", 5, "¿Avisamos por correo o sólo en pantalla?", "Cuando una baliza deja de responder. El correo necesita una cuenta configurada.", [["pantalla", "Sólo en pantalla"], ["correo", "También por correo"]], "pantalla"),
    prueba(9022, "baliza", 5, "Apagá una baliza de prueba y mirá si avisa", "baliza simular --apagar b-03"),
    prueba(9023, "baliza", 6, "Volvela a prender: el aviso tiene que irse", "baliza simular --prender b-03"),
    preg(9031, "cauce", 26, "¿Reintentamos los envíos que fallaron?", "Fallan 2 de cada 100. Reintentar los repite hasta 3 veces, con espera.", [["si", "Sí, hasta 3 veces"], ["no", "No, que queden en la lista"]], "si"),
    // Uno viejo: sin título simple, sin contexto, sin opciones; sólo el campo libre.
    {
      ...base,
      id: 9032,
      columna: "espera-dueno",
      proyecto: "cauce",
      titulo: "Decidir cuánto tiempo guardamos el registro de envíos: hoy ocupa unos 200 MB por mes y hay que elegir entre 30 y 90 días antes de que se llene el disco del servidor",
      detalle: "Falló la limpieza automática de la semana pasada y el registro creció más de lo esperado.\nHabría que elegir una política y aplicarla en el próximo arranque.",
      creado: h(30),
      tocado: h(28),
    },
    prueba(9033, "cauce", 26, "Mandá un envío que falle a propósito", "cauce enviar --falla"),
    preg(9041, "tinta", dia(12), "¿Seguimos con este proyecto o lo pausamos?", "No se toca hace casi dos semanas y nada depende de él.", [["seguir", "Seguir"], ["pausar", "Pausarlo"]], "pausar"),
    preg(9042, "tinta", dia(12), "¿Qué tipo de letra usamos para los títulos?", "La actual se ve cortada en pantallas chicas.", [["actual", "La actual"], ["angosta", "Una más angosta"]], "actual"),
    prueba(9051, "ocaso", dia(31), "Abrí la página de inicio en el celular", "ocaso servir --puerto 8080"),
    // Un proyecto con sólo una mandada: no espera nada, pero se ve lo que mandó.
    preg(9061, "brote", 8, "¿Regamos a la mañana o a la noche?", "El sensor mide mejor con el suelo frío.", [["manana", "A la mañana"], ["noche", "A la noche"]], "noche", {
      respuesta: { texto: "", opcion: "b", opcion_texto: "A la noche", fecha: h(7) },
    }),
  ];
}
