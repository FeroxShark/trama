// Arma la vista de un worker a partir de datos.js. ?p=a|b &s=trabajando|trabado|termino|fallo &l=es|en &t=oscuro|claro
// &sel=<paso> &tip=<paso> &grupo=1 (abre «Buscó en el código») &consigna=1 &filtro=1 («Sólo cambios»).
(async () => {
  const q = new URLSearchParams(location.search);
  const P = q.get("p") || "a";
  const S = q.get("s") || "trabajando";
  const L = q.get("l") || "es";
  const TEMA = q.get("t") || "oscuro";
  const OP = { sel: q.get("sel"), tip: q.get("tip"), grupo: q.get("grupo") === "1", consigna: q.get("consigna") === "1", filtro: q.get("filtro") === "1" };

  const T = {
    es: {
      consigna: "Consigna", pasos: "Pasos", cambios: "Sólo cambios", todo: "Todo", comando: "Comando", salida: "Salida", copiar: "Copiar",
      veces: (n) => `${n} veces`, pensoS: (t) => `Pensó ${t}`, penso: "Pensó", tipos: { leer: "Leer", editar: "Editar", correr: "Comando", pensar: "Pensar" },
      parar: "Parar", integrar: "Integrar", archivar: "Archivar", seguir: "Seguir con otro modelo", pasoAct: "este paso", total: "en total", enEste: "sin salida",
      estado: { trabajando: "Trabajando", trabado: "Trabado", termino: "Terminó", fallo: "Falló" },
      h: {
        trabajando: "Corriendo todos los tests", trabado: "Trabado corriendo todos los tests", termino: "Agregó el índice de rutas y los tests pasan", fallo: "Se quedó sin cupo con 2 tests en rojo",
      },
      sub: {
        trabajando: (d) => `Empezó hace ${d.vivo}. Antes guardó el commit del índice.`,
        trabado: (d) => `Lleva ${d.vivo} y la última línea salió hace ${d.silencio}. Se quedó en <span class="wv-nb">rutas-integracion</span>.`,
        termino: (d) => `Último paso: corrió todos los tests y pasaron los ${d.tests}.`,
        fallo: () => "Último paso: corrió todos los tests y salió con exit 1. Lo hecho quedó en su rama.",
      },
      seTrabo: (t) => `Se trabó acá: sin salida hace ${t}`, seTraboCorto: "Se trabó acá", corriendo: "corriendo",
      abierto: "El comando sigue abierto", lleva: (t) => `lleva ${t}`, sinSalida: (t) => `Sin salida nueva hace ${t}`, sigue: "Sigue corriendo", ultima: (t) => `última línea hace ${t}`,
      exit: (n) => `exit ${n}`, coincidencias: (n) => `${n} coincidencias`, archivos: (n) => `en ${n} archivos`, abrir: "Abrir en el editor", masFilas: (n) => `${n} líneas más`,
      tests: (n) => `${n} tests`, fallan: (n) => `${n} tests fallan`, aLos: (t) => `a los ${t}`,
    },
    en: {
      consigna: "Brief", pasos: "Steps", cambios: "Changes only", todo: "All", comando: "Command", salida: "Output", copiar: "Copy",
      veces: (n) => `${n} times`, pensoS: (t) => `Thought ${t}`, penso: "Thought", tipos: { leer: "Read", editar: "Edit", correr: "Command", pensar: "Think" },
      parar: "Stop", integrar: "Merge", archivar: "Archive", seguir: "Continue with another model", pasoAct: "this step", total: "total", enEste: "no output",
      estado: { trabajando: "Working", trabado: "Stuck", termino: "Finished", fallo: "Failed" },
      h: {
        trabajando: "Running the full test suite", trabado: "Stuck running the full test suite", termino: "Added the routes index and the tests pass", fallo: "Ran out of quota with 2 failing tests",
      },
      sub: {
        trabajando: (d) => `Started ${d.vivo} ago. Before that it committed the index.`,
        trabado: (d) => `Running for ${d.vivo}; the last line came out ${d.silencio} ago. It stopped at <span class="wv-nb">rutas-integracion</span>.`,
        termino: (d) => `Last step: ran the full suite and all ${d.tests} tests passed.`,
        fallo: () => "Last step: ran the full suite, which exited with 1. The work so far is on its branch.",
      },
      seTrabo: (t) => `Stuck here: no output for ${t}`, seTraboCorto: "Stuck here", corriendo: "running",
      abierto: "The command is still open", lleva: (t) => `running for ${t}`, sinSalida: (t) => `No new output for ${t}`, sigue: "Still running", ultima: (t) => `last line ${t} ago`,
      exit: (n) => `exit ${n}`, coincidencias: (n) => `${n} matches`, archivos: (n) => `in ${n} files`, abrir: "Open in the editor", masFilas: (n) => `${n} more lines`,
      tests: (n) => `${n} tests`, fallan: (n) => `${n} tests failing`, aLos: (t) => `at ${t}`,
    },
  }[L];

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const ico = (n, tam = 16, ancho = 1.8) => `<svg class="wv-i" viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="${ancho}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${window.ICONOS[n]}</svg>`;
  const dura = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s / 60} m`);
  const reloj = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ---- La corrida: pasos planos (para la tira) y filas (para la lista) ----
  const items = window.CORRIDAS[S]();
  const planos = [];
  let t = 0;
  const aplanar = (p) => {
    p.t0 = t;
    t += p.seg;
    planos.push(p);
  };
  for (const it of items) {
    if (it.grupo) {
      it.t0 = t;
      it.hijos.forEach(aplanar);
      it.seg = it.hijos.reduce((a, h) => a + h.seg, 0);
    } else aplanar(it);
  }
  const TOTAL = t;
  console.assert(planos.reduce((a, p) => a + p.seg, 0) === TOTAL);

  const filas = [];
  let marca = null;
  for (const it of items) {
    if (it.tipo === "pensar") {
      if (it.texto || it.seg > 30) filas.push({ ...it, propia: true });
      else marca = it.seg;
      continue;
    }
    filas.push({ ...it, marca });
    marca = null;
  }
  const claveTipo = (p) => p.tipo;
  const esCambio = (f) => f.tipo === "editar" || f.verbo === "commit" || f.error;
  const cambiosN = filas.filter(esCambio).length;

  // El paso elegido: por nombre corto o el último.
  const elegido = (() => {
    if (OP.sel === "grep") return planos.find((p) => p.salida?.grep);
    if (OP.sel === "mig") return planos.find((p) => p.archivo?.startsWith("migraciones"));
    return [...planos].reverse().find((p) => p.tipo !== "pensar" && p.tipo !== "texto");
  })();

  // ---- Lo que resume la caja ----
  const vivo = planos.find((p) => p.vivo);
  const d = {
    vivo: vivo ? dura(vivo.seg) : "",
    silencio: vivo?.ultimaSalida ? dura(vivo.seg - vivo.ultimaSalida) : "",
    tests: planos.filter((p) => p.tests).at(-1)?.tests ?? 0,
  };
  const porArchivo = new Map();
  for (const p of planos) if (p.archivo) {
    const a = porArchivo.get(p.archivo) ?? { mas: 0, menos: 0 };
    a.mas += p.mas;
    a.menos += p.menos;
    porArchivo.set(p.archivo, a);
  }
  const chips = () => {
    const out = [];
    if (S === "termino") out.push(`<button class="ui-chip wk-chip" data-ok="">${ico("check", 13, 2.4)}${T.tests(d.tests)}</button>`);
    if (S === "fallo") out.push(`<button class="ui-chip wk-chip" data-mal="">${T.fallan(2)}</button>`);
    for (const [ruta, a] of porArchivo) {
      out.push(`<button class="ui-chip wk-chip"><span class="wk-nombre">${esc(ruta.split("/").pop())}</span>${a.mas ? `<b class="wk-mas">+${a.mas}</b>` : ""}${a.menos ? `<b class="wk-menos">−${a.menos}</b>` : ""}</button>`);
    }
    return `<div class="wk-chips wv-chips">${out.join("")}</div>`;
  };
  const acciones = (grande) => {
    if (S === "trabajando") return `<button class="ui-btn wv-btn">${ico("parar", 12, 2.4).replace('fill="none"', 'fill="currentColor"')}${T.parar}</button>`;
    if (S === "trabado") return `<button class="ui-btn wv-btn" data-tono="decision">${ico("parar", 12, 2.4).replace('fill="none"', 'fill="currentColor"')}${T.parar}</button>`;
    if (S === "termino") return `<button class="ui-btn wv-btn" data-tono="acento">${ico("integrar", 14, 2.2)}${T.integrar}</button><button class="ui-btn wv-btn">${T.archivar}</button>`;
    return `<button class="ui-btn wv-btn" data-tono="fallo">${ico("seguir", 14, 2.2)}${T.seguir}</button>`;
  };
  const glifo = () => {
    if (S === "trabajando") return `<span class="wv-glifo" data-e="trabajando"><span class="wv-pulso"></span></span>`;
    if (S === "trabado") return `<span class="wv-glifo" data-e="trabado">${ico("alerta", 17, 2.2)}</span>`;
    if (S === "termino") return `<span class="wv-glifo" data-e="termino">${ico("check", 17, 2.6)}</span>`;
    return `<span class="wv-glifo" data-e="fallo">${ico("x", 17, 2.6)}</span>`;
  };
  const consigna = () => `
    <div class="wv-consigna" data-abierta="${OP.consigna ? 1 : 0}">
      <span class="wv-caret">${ico("caret", 13, 2.2)}</span>
      <b>${T.consigna}</b>
      <span class="wv-consigna-t">${esc(window.CONSIGNA[L])}</span>
    </div>`;

  // ---- La tira ----
  const iconoDe = (p) => (p.verbo === "commit" ? "commit" : p.verbo === "escribir" ? "escribir" : p.tipo === "correr" ? "correr" : p.tipo === "editar" ? "editar" : p.tipo === "pensar" ? "pensar" : p.tipo === "texto" ? "leer" : p.cmd?.startsWith("grep") ? "buscar" : "leer");
  const nombreSeg = (p) => (p.tipo === "pensar" ? T.pensoS(dura(p.seg)) : p[L]);
  const segsDe = (p) => {
    if (p.trabado) {
      return [
        { p, seg: p.ultimaSalida, parte: "activa" },
        { p, seg: p.seg - p.ultimaSalida, parte: "colgada" },
      ];
    }
    return [{ p, seg: p.seg }];
  };
  const totales = () => {
    const m = { leer: 0, editar: 0, correr: 0, pensar: 0 };
    for (const p of planos) m[p.tipo === "texto" ? "leer" : p.tipo] += p.seg;
    return m;
  };
  const leyenda = (conCifras) => {
    const m = totales();
    return `<div class="wv-leyenda">${Object.entries(m).map(([k, v]) => `<span data-t="${k}"><i></i>${T.tipos[k]}${conCifras ? ` <em>${dura(v)}</em>` : ""}</span>`).join("")}</div>`;
  };
  const tiempos = () => {
    const pasos = [30, 60, 120, 180, 300, 600];
    const paso = pasos.find((x) => TOTAL / x <= 7) ?? 300;
    const out = [];
    for (let s = 0; s < TOTAL - paso * 0.75; s += paso) out.push(`<span style="left:${(s / TOTAL) * 100}%">${s === 0 ? "0" : dura(s)}</span>`);
    out.push(`<span class="wv-fin" style="right:0">${dura(TOTAL)}</span>`);
    return `<div class="wv-regla">${out.join("")}</div>`;
  };
  const sel = (p) => p === elegido;
  const tipSeg = OP.tip;
  const coincideTip = (p, parte) => {
    if (!tipSeg) return false;
    if (tipSeg === "midio") return p.cmd?.startsWith("psql");
    if (tipSeg === "pienso") return p.tipo === "pensar" && p.seg === 48;
    if (tipSeg === "colgado") return parte === "colgada";
    if (tipSeg === "corrio") return p.tests === 22;
    if (tipSeg === "error") return p.error && p === planos.find((x) => x.error);
    if (tipSeg === "tests") return p.tests === 214;
    return false;
  };
  const tooltip = (p, s) => `<span class="wv-tip"><b>${esc(nombreSeg(p))}</b><span>${dura(s.parte ? p.seg : p.seg)} · ${T.aLos(dura(p.t0))}</span></span>`;

  const cinta = (ancho) => {
    const px = (s) => (s / TOTAL) * ancho;
    return planos.flatMap(segsDe).map((s) => {
      const p = s.p;
      const w = px(s.seg);
      let txt = "";
      if (P === "a") {
        if (s.parte === "colgada") txt = `${ico("alerta", 14, 2.2)}<span>${T.seTrabo(d.silencio)}</span>`;
        else if (p.tipo === "pensar" && w >= 78) txt = `${ico("pensar", 13)}<span>${dura(p.seg)}</span>`;
        else if (p.tipo === "leer" ? w >= 46 : w >= 28) txt = ico(iconoDe(p), 13);
        if (w >= 120 && !s.parte && p.vivo) txt = `${ico("correr", 13)}<span>${T.corriendo}</span>`;
      }
      const tip = coincideTip(p, s.parte) ? tooltip(p, s) : "";
      const alinear = (p.t0 + s.seg / 2) / TOTAL;
      return `<span class="wv-seg" data-t="${p.tipo === "texto" ? "leer" : p.tipo}" ${sel(p) && s.parte !== "activa" ? "data-sel" : ""} ${p.vivo && !p.trabado ? "data-vivo" : ""} ${s.parte === "colgada" ? "data-colgado" : ""} ${p.error ? "data-error" : ""} ${p.verbo === "commit" ? "data-commit" : ""} style="flex:${s.seg} 0 0;--lado:${alinear > 0.7 ? "derecha" : "izq"}">${txt}${tip ? tip.replace("wv-tip", `wv-tip ${alinear > 0.72 ? "wv-tip-der" : alinear < 0.2 ? "wv-tip-izq" : ""}`) : ""}</span>`;
    }).join("");
  };

  // ---- Las filas ----
  const tiempoFila = (f) => {
    if (f.vivo && f.trabado) return `<span class="wv-t wv-t-mal">${dura(f.seg)}</span>`;
    return `<span class="wv-t">${dura(f.seg)}</span>`;
  };
  const insignia = (f) => {
    if (f.tipo === "editar") return `<span class="wv-dif">${f.mas ? `<b class="wk-mas">+${f.mas}</b>` : ""}${f.menos ? `<b class="wk-menos">−${f.menos}</b>` : ""}</span>`;
    if (f.verbo === "commit") return `<span class="wv-hash">${f.hash}</span>`;
    if (f.error) return `<span class="wv-chip-err">${T.exit(f.error)}</span>`;
    if (f.trabado) return `<span class="wv-chip-tra">${T.estado.trabado.toLowerCase()}</span>`;
    return "";
  };

  const filaA = (f, hijo) => {
    if (f.propia) {
      return `<li class="wv-f wv-f-pensar" data-t="pensar"><span class="wv-f-i">${ico("pensar")}</span><span class="wv-f-s">${f.texto ? `<b>${T.penso}:</b> ${esc(f.texto[L])}` : T.pensoS(dura(f.seg))}</span>${f.texto ? `<span class="wv-t">${dura(f.seg)}</span>` : ""}</li>`;
    }
    if (f.grupo) {
      const abierto = OP.grupo && f.grupo === "buscar";
      const r = f.grupo === "buscar" ? `${f[L]} <em>· ${T.veces(f.hijos.length)}</em>` : f[L];
      return `<li class="wv-f" data-t="leer"><span class="wv-f-i">${ico(f.grupo === "buscar" ? "buscar" : "leer")}</span><span class="wv-f-s">${r}<span class="wv-caret" data-abierta="${abierto ? 1 : 0}">${ico("caret", 12, 2.2)}</span></span>${f.marca ? marcaA(f.marca) : ""}${tiempoFila(f)}</li>${abierto ? f.hijos.map((h) => filaA({ ...h }, true)).join("") : ""}`;
    }
    const cambio = esCambio(f);
    const esSel = f.cmd === elegido?.cmd && f[L] === elegido?.[L];
    return `<li class="wv-f ${hijo ? "wv-f-hijo" : ""}" data-t="${f.tipo === "texto" ? "leer" : f.tipo}" ${cambio ? `data-cambio="${f.error ? "error" : f.verbo === "commit" ? "commit" : "edit"}"` : ""} ${esSel ? "data-sel" : ""} ${f.trabado ? "data-trabado" : ""} ${f.vivo && !f.trabado ? "data-vivo" : ""}><span class="wv-f-i">${f.vivo && !f.trabado ? `<span class="wv-giro"></span>` : ico(f.error ? "x" : iconoDe(f), hijo ? 14 : 16, f.error ? 2.4 : 1.8)}</span><span class="wv-f-s">${esc(f[L])}</span>${insignia(f)}${f.marca ? marcaA(f.marca) : ""}${tiempoFila(f)}</li>`;
  };
  const marcaA = (seg) => `<span class="wv-marca" data-t="pensar" title="${T.pensoS(dura(seg))}">${ico("pensar", 12, 2)}<span>${seg} s</span></span>`;

  const filaB = (f, hijo) => {
    const peine = (p) => `style="--x0:${(p.t0 / TOTAL) * 100}%;--xw:${Math.max((p.seg / TOTAL) * 100, 0.5)}%"`;
    const nudo = f.marca ? `<span class="wv-nudo" title="${T.pensoS(dura(f.marca))}"><span>${f.marca} s</span></span>` : "";
    if (f.propia) {
      return `<li class="wv-r wv-r-pensar" data-t="pensar" ${peine(f)}><span class="wv-nodo">${ico("pensar", 13, 2)}</span><span class="wv-r-s">${f.texto ? `<b>${T.penso}:</b> ${esc(f.texto[L])}` : T.pensoS(dura(f.seg))}</span>${f.texto ? `<span class="wv-t">${dura(f.seg)}</span>` : ""}</li>`;
    }
    if (f.grupo) {
      const abierto = OP.grupo && f.grupo === "buscar";
      const r = f.grupo === "buscar" ? `${f[L]} <em>· ${T.veces(f.hijos.length)}</em>` : f[L];
      return `<li class="wv-r" data-t="leer" ${peine(f)}>${nudo}<span class="wv-nodo wv-nodo-grupo"><i></i><i></i><i></i></span><span class="wv-r-s"><span>${r}<span class="wv-caret" data-abierta="${abierto ? 1 : 0}">${ico("caret", 12, 2.2)}</span></span></span>${tiempoFila(f)}</li>${abierto ? f.hijos.map((h) => filaB({ ...h }, true)).join("") : ""}`;
    }
    const cambio = esCambio(f);
    const esSel = f.cmd === elegido?.cmd && f[L] === elegido?.[L];
    const nodo = f.error ? `<span class="wv-nodo wv-nodo-lleno" data-c="error">${ico("x", 13, 2.8)}</span>`
      : f.verbo === "commit" ? `<span class="wv-nodo wv-nodo-lleno" data-c="commit">${ico("commit", 14, 2.4)}</span>`
      : f.tipo === "editar" ? `<span class="wv-nodo wv-nodo-lleno" data-c="edit">${ico(iconoDe(f), 12, 2.4)}</span>`
      : f.trabado ? `<span class="wv-nodo wv-nodo-lleno" data-c="trabado">${ico("alerta", 12, 2.6)}</span>`
      : f.vivo ? `<span class="wv-nodo wv-nodo-vivo"><span class="wv-pulso"></span></span>`
      : `<span class="wv-nodo"><i></i></span>`;
    const sub = f.archivo ? `<span class="wv-r-ruta">${esc(f.archivo)}</span>` : "";
    return `<li class="wv-r ${hijo ? "wv-r-hijo" : ""} ${sub ? "wv-r-2" : ""}" data-t="${f.tipo === "texto" ? "leer" : f.tipo}" ${cambio ? `data-cambio="${f.error ? "error" : f.verbo === "commit" ? "commit" : "edit"}"` : ""} ${esSel ? "data-sel" : ""} ${f.trabado ? "data-trabado" : ""} ${f.vivo && !f.trabado ? "data-vivo" : ""} ${peine(f)}>${nudo}${nodo}<span class="wv-r-s"><span>${esc(f[L])}</span>${sub}</span>${insignia(f)}${tiempoFila(f)}</li>`;
  };

  const listaFilas = (fn) => filas.filter((f) => !OP.filtro || esCambio(f)).map((f) => fn(f)).join("");

  // ---- El panel derecho ----
  const conRutas = (linea) => esc(linea).replace(/((?:tests|src|migraciones)\/[\w./-]+\.\w+(?::\d+){1,2})/g, `<a class="wv-ruta">$1</a>`);
  const tonoLinea = (l) => (/^\s*✔/.test(l) ? "ok" : /^\s*✖/.test(l) || /^exit 1/.test(l) || /AssertionError/.test(l) ? "mal" : /^\s*⏵/.test(l) ? "espera" : /^▶/.test(l) ? "grupo" : /^(>|ℹ)/.test(l) ? "tenue" : "");
  const lineaTexto = (l) => {
    const sang = l.match(/^ */)[0].length;
    return `<div class="wv-l" data-tono="${tonoLinea(l)}" style="--sang:${sang}ch">${l.trim() ? conRutas(l.trim()) : "&nbsp;"}</div>`;
  };
  const salidaGrep = (lineas) => {
    if (P === "a") {
      return lineas.map(([r, n, c]) => `<div class="wv-g"><a class="wv-ruta">${r}:${n}</a><span class="wv-g-c">${esc(c)}</span></div>`).join("");
    }
    const pa = new Map();
    for (const [r, n, c] of lineas) pa.set(r, [...(pa.get(r) ?? []), [n, c]]);
    return [...pa].map(([r, ls]) => `<div class="wv-ga"><a class="wv-ruta wv-ruta-tit">${ico("leer", 13, 2)}<span>${r}</span></a><em>${ls.length}</em></div>${ls.map(([n, c]) => `<div class="wv-gb"><a class="wv-ruta">${n}</a><span>${esc(c)}</span></div>`).join("")}`).join("");
  };
  const salidaDiff = (ls, resto) => `${ls.map(([s, n, c]) => `<div class="wv-d"><span>${n}</span><span>${s}</span><span>${esc(c) || "&nbsp;"}</span></div>`).join("")}${resto ? `<div class="wv-d-mas">${T.masFilas(resto)}</div>` : ""}`;

  const panel = () => {
    const p = elegido;
    const s = p.salida ?? { texto: [] };
    const cuerpo = s.grep ? salidaGrep(s.grep) : s.diff ? salidaDiff(s.diff, Math.max(p.mas - s.diff.length, 0)) : s.texto.map(lineaTexto).join("");
    const nArch = s.grep ? new Set(s.grep.map((x) => x[0])).size : 0;
    const estado =
      p.trabado ? `<span class="wv-pie-e" data-e="trabado">${ico("alerta", 13, 2.2)}${T.abierto}</span><span>${T.lleva(dura(p.seg))}</span>`
      : p.vivo ? `<span class="wv-pie-e" data-e="vivo"><span class="wv-giro"></span>${T.sigue}</span><span>${T.ultima("2 s")}</span>`
      : p.error ? `<span class="wv-pie-e" data-e="error">${ico("x", 13, 2.4)}${T.exit(p.error)}</span><span>${dura(p.seg)}</span>`
      : s.grep ? `<span class="wv-pie-e">${T.coincidencias(s.grep.length)}</span><span>${T.archivos(nArch)}</span><span>${dura(p.seg)}</span>`
      : p.archivo ? `<span class="wv-pie-e"><b class="wk-mas">+${p.mas}</b>${p.menos ? ` <b class="wk-menos">−${p.menos}</b>` : ""}</span><span>${dura(p.seg)}</span>`
      : `<span class="wv-pie-e" data-e="ok">${ico("check", 13, 2.4)}${T.exit(0)}</span><span>${dura(p.seg)}</span>`;
    const colgado = s.colgado ? `<div class="wv-silencio">${ico("reloj", 14, 2)}<span>${T.sinSalida(d.silencio)}</span></div>` : s.sigue ? `<div class="wv-cursor"></div>` : "";
    return `<section class="wv-panel" data-t="${p.tipo}">
      <header class="wv-p-cab">
        <span class="wv-p-pal">${esc(p[L])}</span>
        <div class="wv-p-cmd"><span class="wv-p-pr">${p.cmd?.startsWith("Read") || p.cmd?.startsWith("Edit") || p.cmd?.startsWith("Write") ? ico(p.tipo === "editar" ? "editar" : "leer", 13, 2) : "$"}</span><code>${esc(p.cmd ?? "")}</code><button class="wv-copiar" aria-label="${T.copiar}">${ico("copiar", 14)}</button></div>
      </header>
      <div class="wv-p-sal">${cuerpo}${colgado}</div>
      <footer class="wv-p-pie">${estado}</footer>
    </section>`;
  };

  // ---- Las dos propuestas ----
  const ANCHO_A = 1036;
  const propuestaA = () => `
    <div class="wv wv-a" data-e="${S}">
      <section class="wv-caja" data-e="${S}">
        <div class="wv-sup">
          ${glifo()}
          <div class="wv-tit"><h2>${T.h[S]}</h2><p>${T.sub[S](d)}</p></div>
          <div class="wv-acc">${acciones()}</div>
        </div>
        <div class="wv-med">${consigna()}${chips()}</div>
        <div class="wv-tira">
          ${leyenda(true)}
          <div class="wv-cinta" role="img">${cinta(ANCHO_A)}</div>
          ${tiempos()}
        </div>
      </section>
      <div class="wv-cuerpo">
        <section class="wv-lista">
          <header class="wv-l-cab">
            <b>${T.pasos}</b><span class="wv-cuenta">${OP.filtro ? `${cambiosN} / ${filas.length}` : filas.length}</span>
            <div class="wv-seg-ctl" role="group"><button ${OP.filtro ? "" : "data-on"}>${T.todo}</button><button ${OP.filtro ? "data-on" : ""}>${T.cambios}<em>${cambiosN}</em></button></div>
          </header>
          <ol>${listaFilas(filaA)}</ol>
        </section>
        ${panel()}
      </div>
    </div>`;

  const ANCHO_B = 590;
  const propuestaB = () => {
    const unidad = S === "termino" || S === "fallo" ? T.total : S === "trabado" ? T.pasoAct : T.pasoAct;
    const cifra = S === "termino" || S === "fallo" ? reloj(TOTAL) : reloj(vivo.seg);
    return `
    <div class="wv wv-b" data-e="${S}">
      <div class="wv-izq">
        <section class="wv-caja" data-e="${S}">
          <div class="wv-sup">
            <div class="wv-reloj"><b>${cifra}</b><span>${unidad}</span></div>
            <div class="wv-tit"><h2>${T.h[S]}</h2><p>${T.sub[S](d)}</p></div>
          </div>
          ${consigna()}
          <div class="wv-med">${chips()}<div class="wv-acc">${acciones()}</div></div>
        </section>
        <div class="wv-tira">
          <div class="wv-tira-sobre">${S === "trabado" ? `<span class="wv-bandera" style="left:${((vivo.t0 + vivo.ultimaSalida) / TOTAL) * 100}%">${ico("alerta", 12, 2.4)}${T.seTraboCorto}</span>` : ""}</div>
          <div class="wv-cinta" role="img">${cinta(ANCHO_B)}</div>
          ${tiempos()}
        </div>
        <header class="wv-l-cab">
          ${leyenda(false)}
          <button class="wv-tog" ${OP.filtro ? "data-on" : ""} role="switch" aria-checked="${OP.filtro}"><i></i>${T.cambios}<em>${cambiosN}</em></button>
        </header>
        <ol class="wv-hilo">${listaFilas(filaB)}</ol>
      </div>
      ${panel()}
    </div>`;
  };

  // ---- La ventana: la barra y el encabezado de verdad (un volcado de la app), con el estado de este worker ----
  const leer = (u) => fetch(u).then((r) => r.text());
  const leerXHR = (u) =>
    new Promise((ok, mal) => {
      const x = new XMLHttpRequest();
      x.open("GET", u);
      x.onload = () => ok(x.responseText);
      x.onerror = mal;
      x.send();
    });
  const [barra, migas] = await Promise.all([leerXHR(`barra-${L}.html`), leerXHR(`migas-${L}.html`)]);
  void leer;
  const html = document.documentElement;
  html.lang = L;
  html.dataset.tema = TEMA;
  html.setAttribute("style", `--letra: 13; --font-sans: "Inter", "Geist", ui-sans-serif, system-ui, sans-serif; --font-mono: "JetBrains Mono", "Geist Mono", ui-monospace, monospace;`);
  document.getElementById("root").innerHTML = `<div>${barra}<main class="hilo">${migas}<div class="wk">${P === "a" ? propuestaA() : propuestaB()}</div></main></div></div>`;

  // El encabezado.
  const m = document.querySelector(".migas");
  m.querySelector(".ruta b").textContent = window.TITULO[L];
  const est = m.querySelector(".estado");
  est.className = `estado ${{ trabajando: "c-trab", trabado: "c-trabado", termino: "c-term", fallo: "c-fallo" }[S]}`;
  est.querySelector(".estado-t").textContent = T.estado[S];
  m.querySelector(".wk-espera")?.remove();
  m.querySelector(".wk-tiempo span").textContent = dura(TOTAL);

  // El encabezado del proyecto: este worker ya no cuenta como «en marcha» si terminó o falló.
  if (S === "termino" || S === "fallo") for (const n of document.querySelectorAll(".barra *")) {
    if (n.children.length === 0 && /^2 (en marcha|running)/.test(n.textContent.trim())) n.textContent = n.textContent.replace("2", "1");
  }
  // La fila de este worker en la barra.
  const PALOMITA = `<span class="wv-palomita" role="img" aria-label="${T.estado.termino}">${ico("check", 13, 2.8)}</span>`;
  const fila = document.querySelector('.fila[aria-current="true"]');
  const li = fila.closest("li");
  fila.querySelector(".t").textContent = window.TITULO[L];
  fila.querySelector(".tierno")?.remove();
  const cuando = fila.querySelector(".cuando");
  cuando.textContent = S === "termino" || S === "fallo" ? (L === "es" ? "hace 1 m" : "1 m ago") : `${Math.round(TOTAL / 60)} m`;
  const punto = fila.querySelector(".g-punto");
  if (S === "trabado") {
    li.querySelector(".hilo-vivo")?.remove();
    punto.innerHTML = `<span class="pt pt-trabado gira"></span>`;
    fila.querySelector(".l2").insertAdjacentHTML("afterbegin", `<span class="pal">${T.estado.trabado}</span>`);
  } else if (S === "termino") {
    li.querySelector(".hilo-vivo")?.remove();
    punto.outerHTML = PALOMITA;
  } else if (S === "fallo") {
    li.querySelector(".hilo-vivo")?.remove();
    fila.dataset.atencion = "fallo";
    punto.outerHTML = `<span class="llamado" data-at="fallo"><span class="g" data-g="falla" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></span></span>`;
    fila.querySelector(".l2").insertAdjacentHTML("afterbegin", `<span class="chip-at" data-at="fallo">${L === "es" ? "falló" : "failed"}</span>`);
  }
  // En inglés, los títulos que el dueño escribió en el volcado también van en inglés (son datos, no interfaz).
  if (L === "en") {
    const dic = window.TITULOS_EN;
    const textos = document.createTreeWalker(document.querySelector(".barra"), NodeFilter.SHOW_TEXT);
    for (let n; (n = textos.nextNode()); ) {
      const clave = Object.keys(dic).find((k) => n.textContent.trim() === k);
      if (clave) n.textContent = dic[clave];
    }
  }

  await document.fonts.ready;
  document.querySelector(".wv [data-sel]:is(li)")?.scrollIntoView({ block: "nearest" });
  await Promise.all([...document.fonts].filter((f) => f.family.includes("Inter") || f.family.includes("JetBrains")).map((f) => f.load().catch(() => {})));
  // El tooltip no tapa «Sólo cambios» ni la leyenda (B los tiene justo abajo de la tira), y en la regla no asoman marcas a medio tapar.
  const tip = document.querySelector(".wv-tip");
  if (tip) {
    const tog = document.querySelector(".wv-tog")?.getBoundingClientRect();
    const sobra = tog ? tip.getBoundingClientRect().right - (tog.left - 12) : 0;
    if (sobra > 0) tip.style.translate = `${-sobra}px 0`;
    const r = tip.getBoundingClientRect();
    for (const m of document.querySelectorAll(".wv-regla span")) {
      const b = m.getBoundingClientRect();
      if (b.right > r.left - 4 && b.left < r.right + 4 && b.bottom > r.top && b.top < r.bottom) m.style.visibility = "hidden";
    }
  }
  document.body.dataset.listo = "1";
})();
