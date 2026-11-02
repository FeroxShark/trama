// Maqueta de la tarjeta de un líder trabajando (status-trabajando-*.png). No es código de la app: se inyecta con `pantalla js` en una Trama
// de ejemplo, así usa sus tokens, sus fuentes, su conversación y su caja de verdad. Sólo pinta: datos inventados y sin movimiento (la captura es una
// foto; lo que late o corre se describe en LEEME.md). Dos propuestas: A, Tejido y B, Frase.
(() => {
  const CSS = `
  /* Comunes */
  .st-punto { flex: none; width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--acento); box-shadow: 0 0 0 0.125rem color-mix(in srgb, var(--acento) 22%, transparent), 0 0 0.625rem color-mix(in srgb, var(--acento) 55%, transparent); }
  .st-est { display: inline-flex; flex: none; align-items: center; gap: var(--esp-2); color: var(--texto-3); font-size: var(--letra-4); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .st-v { flex: none; color: var(--texto-3); font-size: var(--letra-4); font-weight: 500; }
  .st-out { flex: 1 1 0; min-width: 0; overflow: hidden; color: var(--texto-6); font-family: var(--font-mono); font-size: var(--letra-3); white-space: pre; mask-image: linear-gradient(to left, transparent, #000 1.5rem); }
  .st-ver { display: inline-flex; flex: none; align-items: center; gap: var(--esp-0-5); color: var(--texto-5); font-size: var(--letra-4); }
  .st-mod { position: relative; flex: none; color: var(--apagado); font-size: var(--letra-4); white-space: nowrap; }
  .st-parar { height: 1.75rem; padding: 0 var(--esp-3); font-size: var(--letra-4); }
  .st-crudo { color: var(--texto-3); font-family: var(--font-mono); font-size: var(--letra-3); line-height: 1.6; white-space: pre-wrap; }
  .st-err { color: var(--fallo-texto); font-family: var(--font-mono); font-size: var(--letra-3); line-height: 1.6; white-space: pre-wrap; }
  .st-tip { position: absolute; z-index: 5; padding: var(--esp-1-5) var(--esp-2-5); border-radius: var(--r-sm); background: var(--popover-tip-fondo); box-shadow: var(--popover-luz), var(--popover-sombra); color: var(--texto); font-size: var(--letra-4); font-weight: 400; white-space: nowrap; }
  .st-tip span { color: var(--apagado); }
  [data-e="quieto"] .st-est { color: var(--decision-texto); font-weight: 500; }
  [data-e="quieto"] .st-punto { background: var(--aviso); box-shadow: none; }
  [data-e="quieto"] .st-parar { background: var(--decision-relleno); color: var(--decision-sobre); font-weight: 600; }
  [data-e="fallo"] .st-est { color: var(--fallo-texto); font-weight: 500; }
  [data-e="fallo"] .st-v { color: var(--fallo-texto); }
  [data-e="fallo"] .st-out { color: var(--texto-4); }

  /* A, Tejido: una hoja baja y sin marco; lo que hizo el turno queda tejido en el borde de abajo. */
  .sa { position: relative; display: flex; flex-direction: column; gap: var(--esp-1); padding: var(--esp-2-5) var(--esp-4) var(--esp-4); border-radius: var(--r-md); background: var(--capa-card); }
  .sa-1, .sa-2 { display: flex; min-width: 0; align-items: center; gap: var(--esp-3); }
  .sa-tit { flex: 1 1 0; min-width: 0; overflow: hidden; color: var(--texto-1); font-size: var(--letra-6); font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
  .sa-2 { min-height: 1.75rem; gap: var(--esp-2-5); }
  .sa-mas { display: flex; flex-direction: column; gap: var(--esp-1); padding: var(--esp-1) 0 var(--esp-1); }
  /* El tejido: dos hileras de puntadas corridas, una por paso del turno, de largo proporcional a lo que duró. */
  .sa-tej { position: absolute; right: var(--esp-4); bottom: var(--esp-1-5); left: var(--esp-4); display: flex; height: 0.3125rem; gap: var(--esp-1); }
  .sa-tej i, .sa-mue i { --pt: 0.3125rem; --hueco: 0.1875rem; --an: calc(var(--pt) + var(--hueco)); display: block; min-width: var(--an); background: linear-gradient(to right, var(--c) 0 var(--pt), transparent var(--pt)) 0 0 / var(--an) 0.125rem repeat-x, linear-gradient(to right, var(--c) 0 var(--pt), transparent var(--pt)) 0.25rem 100% / var(--an) 0.125rem repeat-x; }
  .sa-lan { position: absolute; bottom: 0.3125rem; width: 3.5rem; height: 0.4375rem; border-radius: var(--r-cap); background: var(--acento); box-shadow: 0 0 0.75rem color-mix(in srgb, var(--acento) 70%, transparent); }
  .sa[data-e="quieto"] { background: var(--decision-fondo); }
  .sa[data-e="quieto"] .sa-tej i { --c: var(--capa-track) !important; }
  .sa[data-e="quieto"] .sa-tej i:last-child { --c: var(--aviso) !important; --hueco: 0.625rem; }
  .sa[data-e="fallo"] { background: var(--fallo-fondo); }
  .sa[data-e="fallo"] .sa-tej i { --c: var(--capa-track) !important; }
  .sa[data-e="fallo"] .sa-tej i:nth-last-child(2) { --c: var(--critico) !important; }
  .sa[data-e="fallo"] .sa-tej i:last-child { --c: var(--critico) !important; flex: 0 0 var(--esp-4) !important; margin-left: var(--esp-3); }
  .sa-pl { display: inline-flex; align-self: flex-start; align-items: center; gap: var(--esp-2-5); height: 1.75rem; color: var(--texto-4); font-size: var(--letra-5); }
  .sa-mue { display: flex; width: 3.5rem; height: 0.3125rem; flex: none; gap: var(--esp-0-5); }

  /* B, Frase: una cápsula de vidrio hermana de la caja; manda la frase grande, con lo de recién yéndose a la izquierda. */
  .sb { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: var(--esp-3); padding: var(--esp-2-5) var(--esp-4) var(--esp-2-5) var(--esp-2-5); border-radius: var(--r-xl); background: var(--capa-tile); box-shadow: var(--popover-luz), var(--sombra-vidrio); }
  .sb-tile { display: grid; width: 2.75rem; height: 2.75rem; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--c, var(--acento)) 18%, transparent); color: var(--c, var(--acento)); }
  .sb-cu { display: flex; min-width: 0; flex-direction: column; }
  .sb-1, .sb-2 { display: flex; min-width: 0; align-items: center; gap: var(--esp-2-5); }
  .sb-1 { min-height: 1.5rem; }
  .sb-2 { min-height: 1.75rem; }
  .sb-frase { display: flex; flex: 1 1 0; min-width: 0; align-items: baseline; gap: var(--esp-2); }
  .sb-tit { flex: none; color: var(--texto-1); font-size: var(--letra-7); font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
  .sb-ant { display: flex; flex: 0 1 auto; min-width: 0; justify-content: flex-end; overflow: hidden; color: var(--texto-6); font-size: var(--letra-4); white-space: nowrap; mask-image: linear-gradient(to right, transparent, #000 2.5rem); }
  .sb-ant > span { flex: none; }
  .sb-mas { display: flex; flex-direction: column; gap: var(--esp-1); padding: var(--esp-1) 0 var(--esp-1-5); }
  .sb[data-e="quieto"] { --c: var(--aviso); background: var(--decision-fondo); box-shadow: inset 0 0 0 1px var(--decision-luz), var(--decision-brillo); }
  .sb[data-e="quieto"] .st-out { color: var(--texto-4); }
  .sb[data-e="detalle"] { align-items: start; border-radius: var(--r-lg); }
  .sb[data-e="fallo"] { --c: var(--critico); align-items: start; border-radius: var(--r-lg); background: var(--fallo-fondo); box-shadow: inset 0 0 0 1px var(--fallo-luz), var(--fallo-brillo); }
  .sb-pl { display: inline-flex; align-self: flex-start; align-items: center; gap: var(--esp-2); height: 2rem; padding: 0 var(--esp-3) 0 var(--esp-1); border-radius: var(--r-cap); background: var(--capa-card); box-shadow: inset 0 0 0 1px var(--capa-div); color: var(--texto-3); font-size: var(--letra-5); }
  .sb-pl .sb-tile { --c: var(--ok); width: 1.5rem; height: 1.5rem; }
  `;

  const I = {
    term: '<path d="M12 19h8"/><path d="m4 17 6-6-6-6"/>',
    pausa: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    tilde: '<path d="M20 6 9 17l-5-5"/>',
    abajo: '<path d="m6 9 6 6 6-6"/>',
    arriba: '<path d="m18 15-6-6-6 6"/>',
    der: '<path d="m9 18 6-6-6-6"/>',
  };
  const svg = (n, t = 16, g = 2) => `<svg width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${g}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${I[n]}</svg>`;

  const TEXTOS = {
    es: {
      yo0: "Dale, las dos.", hecho: "Corrió 2 comandos · 2 m", el0: "Listo: atlas integrado (tests verdes) y cauce lanzado. Te aviso cuando termine.",
      yo: "¿Cómo vienen los workers? Fijate también qué quedó en el tablero.",
      el: "Hay dos workers en marcha en cauce y ninguno trabado. En el tablero quedan tres pendientes; el primero es migrar la config.",
      tit: "Revisando workers y tablero", tit2: "Probando la barra", titSin: "Corriendo Bash", titFin: "Revisó workers y tablero", titFallo: "No pudo revisar workers y tablero",
      corre: "Corriendo", corrio: "Corrió", ver: "Ver todo", menos: "Ver menos", parar: "Parar", quieto: "Sin novedades hace 2 m", fallo: "Falló",
      out: "cauce-e9  corriendo  21 m  pa/cauce/0312", out2: "riel-logica.test.ts  14 bien", outQ: "esperando respuesta de cauce-e9",
      codigo: "salió con código 1", err: "tablero: no se pudo abrir la base de tareas\ndatabase is locked (hay otra sesión escribiendo)",
      crudo: "pa estado --workers --json | jq -r '.[] | select(.vivo) | .id' \\\n  && tablero lista --abiertas --proyecto atlas",
      ant: ["Buscó «pintorDura»", "Leyó Actividad.tsx", "Editó riel-estilos.css"], tipSeg: "Leyó Actividad.tsx", tipTok: "1,2 k tokens", tipPas: "5 pasos",
      est: ["Un comando", "Varias herramientas seguidas", "Sin novedades", "Terminó: se pliega sola", "Falló: queda abierta"],
    },
    en: {
      yo0: "Go ahead, both.", hecho: "Ran 2 commands · 2 m", el0: "Done: atlas integrated (tests green) and cauce launched. I'll let you know when it's done.",
      yo: "How are the workers doing? Check what's left on the board too.",
      el: "Two workers are running on cauce and none is stuck. Three items are left on the board; the first one is migrating the config.",
      tit: "Checking workers and board", tit2: "Testing the sidebar", titSin: "Running Bash", titFin: "Checked workers and board", titFallo: "Couldn't check workers and board",
      corre: "Running", corrio: "Ran", ver: "Show all", menos: "Show less", parar: "Stop", quieto: "No updates for 2 m", fallo: "Failed",
      out: "cauce-e9  running  21 m  pa/cauce/0312", out2: "riel-logica.test.ts  14 passed", outQ: "waiting for cauce-e9 to answer",
      codigo: "exited with code 1", err: "tablero: could not open the task database\ndatabase is locked (another session is writing)",
      crudo: "pa estado --workers --json | jq -r '.[] | select(.vivo) | .id' \\\n  && tablero lista --abiertas --proyecto atlas",
      ant: ["Searched “pintorDura”", "Read Actividad.tsx", "Edited riel-estilos.css"], tipSeg: "Read Actividad.tsx", tipTok: "1.2k tokens", tipPas: "5 steps",
      est: ["One command", "Several tools in a row", "No updates", "Finished: folds by itself", "Failed: stays open"],
    },
  };

  // Los tramos del tejido: [clase de paso, cuánto duró]. Pensar, leer, editar y correr, con los colores de paso de la app.
  const TEJ = {
    uno: [["pensar", 1], ["correr", 5]],
    varios: [["pensar", 3], ["leer", 2], ["leer", 2], ["leer", 4], ["pensar", 5], ["editar", 3], ["editar", 2], ["pensar", 2], ["correr", 22]],
    fin: [["pensar", 2], ["correr", 10]],
    fallo: [["pensar", 2], ["correr", 10], ["correr", 0]],
  };
  const tramos = (x) => x.map(([c, n]) => `<i style="--c: ${c === "correr" ? "color-mix(in srgb, var(--paso-correr) 60%, transparent)" : `var(--paso-${c})`}; flex: ${n} 1 0"></i>`).join("");
  const est = (e, x) => {
    if (e === "quieto") return `<span class="st-est"><i class="st-punto"></i>${x.quieto}</span>`;
    if (e === "fallo") return `<span class="st-est">${svg("x", 14, 2.4)}${x.fallo} · 12 s</span>`;
    return `<span class="st-est"><i class="st-punto"></i>${e === "varias" ? "48 s" : "6 s"}</span>`;
  };
  const ver = (x, abierto) => `<span class="st-ver">${abierto ? x.menos : x.ver}${svg(abierto ? "arriba" : "abajo", 12)}</span>`;
  const mod = (x, tip) => `<span class="st-mod">Opus 5.5 · medium${tip ? `<span class="st-tip" style="right: 0; bottom: 1.625rem">${x.tipTok}<span> · ${x.tipPas}</span></span>` : ""}</span>`;
  const parar = (x) => `<button type="button" class="btn2 st-parar">${x.parar}</button>`;

  // Lo que dice cada estado, igual en las dos propuestas.
  const datos = (e, x) => ({
    trab: { tit: x.tit, v: x.corre, out: x.out, parar: true },
    varias: { tit: x.tit2, v: x.corre, out: x.out2, parar: true },
    quieto: { tit: x.tit, v: x.corre, out: x.outQ, parar: true },
    fallo: { tit: x.titFallo, v: x.corrio, out: x.codigo, mas: `<div class="st-err">${x.err}</div>` },
    detalle: { tit: x.titSin, v: "", out: x.out, parar: true, abierto: true, tip: true, mas: `<div class="st-crudo">${x.crudo}</div>` },
  })[e];

  function a(e, x, hoja) {
    if (e === "fin") return `<div class="sa-pl"><span class="sa-mue">${tramos(TEJ.fin)}</span>${x.titFin} · 12 s${svg("der", 12)}</div>`;
    const d = datos(e, x);
    const tej = e === "varias" ? TEJ.varios : e === "fallo" ? TEJ.fallo : TEJ.uno;
    const vivo = e === "trab" || e === "varias" || e === "detalle";
    const tipo = e === "varias" && !hoja ? `<span class="st-tip" style="left: 6%; top: calc(100% + 0.375rem)">${x.tipSeg}<span> · 1 s</span></span>` : "";
    return `<div class="sa" data-e="${e}">
      <div class="sa-1"><span class="sa-tit">${d.tit}</span>${est(e, x)}</div>
      <div class="sa-2">${d.v ? `<span class="st-v">${d.v}</span>` : ""}<span class="st-out">${d.out}</span>${ver(x, d.abierto)}${mod(x, d.tip)}${d.parar ? parar(x) : ""}</div>
      ${d.mas ? `<div class="sa-mas">${d.mas}</div>` : ""}
      <div class="sa-tej">${tramos(tej)}</div>${vivo ? '<span class="sa-lan" style="right: 22%"></span>' : ""}${tipo}
    </div>`;
  }

  function b(e, x) {
    if (e === "fin") return `<div class="sb-pl"><span class="sb-tile">${svg("tilde", 13, 2.6)}</span>${x.titFin} · 12 s${svg("der", 12)}</div>`;
    const d = datos(e, x);
    const ic = e === "quieto" ? "pausa" : e === "fallo" ? "x" : "term";
    const ant = e === "varias" ? `<span class="sb-ant"><span>${x.ant.join("  ›  ")}  ›</span></span>` : "";
    return `<div class="sb" data-e="${e}">
      <span class="sb-tile">${svg(ic, 20, 2)}</span>
      <div class="sb-cu">
        <div class="sb-1"><span class="sb-frase">${ant}<span class="sb-tit">${d.tit}</span></span>${est(e, x)}</div>
        <div class="sb-2">${d.v ? `<span class="st-v">${d.v}</span>` : ""}<span class="st-out">${d.out}</span>${ver(x, d.abierto)}${mod(x, d.tip)}${d.parar ? parar(x) : ""}</div>
        ${d.mas ? `<div class="sb-mas">${d.mas}</div>` : ""}
      </div>
    </div>`;
  }

  const hora = (h) => `<div class="hora"><span>${h}</span></div>`;

  /** Pinta un estado de una propuesta adentro de la conversación real. `hoja`: los cinco estados, uno abajo del otro, sin conversación. */
  window.__status = ({ p, e, idioma = "es", hoja = false }) => {
    let s = document.getElementById("st-css");
    if (!s) {
      s = document.createElement("style");
      s.id = "st-css";
      document.head.append(s);
    }
    s.textContent = CSS;
    const x = TEXTOS[idioma];
    const tarjeta = p === "a" ? a : b;
    // La píldora de la cabecera diría lo mismo que la tarjeta; el pedido es un solo estado.
    document.querySelector("[data-pildora-trabajando]")?.setAttribute("hidden", "");
    const conv = document.querySelector(".conv");
    document.querySelector(".caja-zona").style.display = hoja ? "none" : "";
    if (hoja) {
      const orden = ["trab", "varias", "quieto", "fin", "fallo"];
      conv.innerHTML = orden.map((k, i) => `<div style="display:flex;flex-direction:column;gap:var(--esp-2)"><span style="color:var(--texto-6);font-size:var(--letra-4)">${x.est[i]}</span>${tarjeta(k, x, true)}</div>`).join("");
      return "ok";
    }
    const base = `<div class="yo"><p>${x.yo0}</p></div>${hora("03:44")}<details class="trabajo"><summary>${svg("der", 11)}${x.hecho}</summary></details><div class="el"><p>${x.el0}</p></div>${hora("03:46")}<div class="yo"><p>${x.yo}</p></div>${hora("03:51")}`;
    conv.innerHTML = base + tarjeta(e, x) + (e === "fin" ? `<div class="el"><p>${x.el}</p></div>${hora("03:51")}` : "");
    const z = document.querySelector(".conv-zona");
    z.scrollTop = z.scrollHeight;
    return "ok";
  };
})();
