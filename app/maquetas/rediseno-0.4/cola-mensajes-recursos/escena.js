// Arma la pantalla: la barra (captura real), la conversación y una de las dos bandejas en el estado pedido.
const P = Q.get("p") || "a", E = Q.get("e") || "tres", TEMA = Q.get("tema") || "oscuro", ID = Q.get("idioma") || "es";
const T = {
  es: {
    yo: "Corré la suite de cauce y decime qué falla antes de tocar nada.",
    el: "Dale. Primero arreglé el import roto de la barra y ahora corro la suite completa para ver qué queda en rojo.",
    m1: "Cuando termine, fijate si el test de cauce falla también con el reloj en UTC",
    m2: "Mirá esta captura: la barra se corta a 300 px, ¿es lo mismo?",
    m3: "Y antes de tocar nada, mostrame el diff de src/barra/cauce.ts",
    uno: "En cola", tras: "entra tras este paso", n: (n) => `${n} en cola`, trasN: "entran juntos tras este paso",
    largo: "Esperando un comando largo", parar: "Parar",
    editar: "Editar", borrar: "Borrar", ya: "Enviar ahora", re: "Reintentar", plegar: "Plegar la cola", abrir: "Abrir la cola", mover: "Arrastrar para ordenar",
    amplia: "Ampliar la imagen", cerrar: "Cerrar",
    falloT: "1 no se pudo enviar", falloY: "2 esperan", falloM: "No salió: el motor no arrancó. Sigue guardado, también si cerrás Trama.", espera: "Espera al 1",
    confT: "¿Cortar «npm test» y enviar ahora?", confB: "Lleva 3 m. Lo que ya hizo queda como está y los 3 mensajes entran juntos, en este orden.", seguir: "Seguir esperando", cortar: "Cortar y enviar", seCorta: "Se corta",
    img: "Captura de la barra de Trama",
  },
  en: {
    yo: "Run the cauce suite and tell me what fails before you touch anything.",
    el: "Sure. I fixed the broken import in the sidebar first, and now I'm running the whole suite to see what's still red.",
    m1: "When it's done, check whether the cauce test also fails with the clock in UTC",
    m2: "Look at this screenshot: the sidebar gets cut at 300 px, is it the same thing?",
    m3: "And before touching anything, show me the diff of src/barra/cauce.ts",
    uno: "Queued", tras: "goes in after this step", n: (n) => `${n} queued`, trasN: "go in together after this step",
    largo: "Waiting on a long command", parar: "Stop",
    editar: "Edit", borrar: "Delete", ya: "Send now", re: "Retry", plegar: "Collapse the queue", abrir: "Open the queue", mover: "Drag to reorder",
    amplia: "Enlarge image", cerrar: "Close",
    falloT: "1 couldn't be sent", falloY: "2 waiting", falloM: "Not sent: the engine didn't start. It stays saved, even if you close Trama.", espera: "Waiting for 1",
    confT: "Cut “npm test” and send now?", confB: "It's been running for 3 m. What it already did stays as it is, and all 3 messages go in together, in this order.", seguir: "Keep waiting", cortar: "Cut and send", seCorta: "Gets cut",
    img: "Screenshot of the Trama sidebar",
  },
}[ID];
const ic = (n, s = 14, w = 2) => `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONO[n]}</svg>`;
const FOTO = "cola-mensajes-recursos/captura-adjunta.png";
const miniatura = (cl = "") => `<button type="button" class="cm-mini ${cl}" aria-label="${T.amplia}"><img src="${FOTO}" alt="${T.img}"></button>`;
const LARGO = E === "comando-largo" || E === "confirmar";
const TIEMPO = LARGO ? "3 m" : "40 s";
// Los mensajes de cada estado.
const LISTA = E === "uno" || E === "comando-largo" ? [{ t: T.m2, img: 1 }] : [{ t: T.m1 }, { t: T.m2, img: 1 }, { t: T.m3 }];
const N = LISTA.length;
const titulo = N === 1 ? [T.uno, T.tras] : [T.n(N), T.trasN];

/* ---------- A, Solapa: una carpeta de la que asoma la caja; la pestaña lleva el estado y tiñe toda la hoja. ---------- */
function filaA(m, k, o = {}) {
  const fallo = o.fallo, espera = o.espera;
  return `<li class="a-fila" ${N === 1 ? "data-solo" : ""} ${fallo ? "data-fallo" : ""} ${o.lit ? "data-lit" : ""} ${espera ? "data-espera" : ""} ${o.alza ? "data-alza" : ""}>
    <span class="a-agarre" title="${T.mover}">${ic("grip-vertical", 13)}</span>
    <span class="a-num">${fallo ? ic("x", 12, 2.6) : k + 1}</span>
    <div class="a-cuerpo"><p class="a-t">${m.t}</p>${fallo ? `<p class="a-err">${T.falloM}</p>` : ""}</div>
    ${m.img ? miniatura() : ""}
    <div class="a-acc">
      <button class="cm-ic" aria-label="${T.editar}" title="${T.editar}">${ic("pencil", 14)}</button>
      <button class="cm-ic" aria-label="${T.borrar}" title="${T.borrar}">${ic("trash-2", 14)}</button>
      ${fallo ? `<button class="cm-prim" data-tono="fallo">${ic("rotate-cw", 13, 2.2)}${T.re}</button>`
        : espera ? `<span class="a-esp">${T.espera}</span>`
        : `<button class="a-ya" ${o.apretado ? "data-activo" : ""}>${ic("zap", 13, 2.2)}${T.ya}</button>`}
    </div>
  </li>`;
}
function bandejaA() {
  let tono = "espera", icono = N === 1 ? "clock" : "layers", tab = `<b>${titulo[0]}</b><span>${titulo[1]}</span>`, der = "", filas = "", plegada = false;
  const chev = (arr) => `<button class="cm-ic a-chev" aria-label="${arr ? T.abrir : T.plegar}" title="${arr ? T.abrir : T.plegar}">${ic(arr ? "chevron-up" : "chevron-down", 15)}</button>`;
  if (E === "colapsada") { plegada = true; der = `<span class="a-primero">${T.m1}</span>${chev(true)}`; }
  else if (E === "comando-largo") { tono = "largo"; icono = "hourglass"; tab = `<b>${T.largo}</b><span class="a-tiempo">3 m</span>`; der = `<button class="cm-sec" data-tono="largo">${ic("square", 11, 2.4)}${T.parar}</button>`; }
  else if (E === "fallo") { tono = "fallo"; icono = "circle-x"; tab = `<b>${T.falloT}</b><span>${T.falloY}</span>`; der = chev(false); }
  else if (E === "confirmar") { tono = "largo"; icono = "hourglass"; tab = `<b>${T.largo}</b><span class="a-tiempo">3 m</span>`; der = `<button class="cm-sec" data-tono="largo">${ic("square", 11, 2.4)}${T.parar}</button>`; }
  else der = N > 1 ? chev(false) : "";
  if (!plegada) {
    filas = LISTA.map((m, k) => {
      if (E === "fallo") return filaA(m, k, k === 0 ? { fallo: 1 } : { espera: 1 });
      if (E === "tres") return filaA(m, k, { lit: k === 1 });
      if (E === "confirmar" && k === 0) return filaA(m, k, { apretado: 1 }) + `<li class="a-conf" role="alertdialog" aria-label="${T.confT}">
        <div><p class="a-conf-t">${ic("scissors", 15, 2)}${T.confT}</p><p class="a-conf-b">${T.confB}</p></div>
        <div class="a-conf-acc"><button class="cm-sec" data-foco>${T.seguir}</button><button class="cm-prim" data-tono="largo">${T.cortar}</button></div></li>`;
      if (E === "arrastrando") {
        const o = [LISTA[0], LISTA[2]];
        return k === 1 ? "" : filaA(k === 0 ? o[0] : o[1], k === 0 ? 0 : 2);
      }
      return filaA(m, k);
    }).join("");
    if (E === "arrastrando") filas = filas.replace(`</li>`, `</li><li class="a-hueco" aria-hidden="true"></li>`);
  }
  const alzada = E === "arrastrando" ? `<ol class="a-alzada">${filaA(T && LISTA[1], 1, { alza: 1 })}</ol>` : "";
  return `<div class="a" data-tono="${tono}" ${plegada ? "data-plegada" : ""}>
    <div class="a-tope"><div class="a-tab">${ic(icono, 14, 2.2)}${tab}</div><div class="a-der">${der}</div></div>
    <div class="a-hoja">${filas ? `<ol class="a-lista">${filas}</ol>` : ""}${alzada}</div>
    ${REAL_ID.caja}
  </div>`;
}

/* ---------- B, Hilván: burbujas hilvanadas a un hilo punteado que sale del botón de enviar y sube hasta el paso en curso. ---------- */
function fichaB(m, k, o = {}) {
  return `<li class="b-ficha" ${o.fallo ? "data-fallo" : ""} ${o.espera ? "data-espera" : ""} ${o.alza ? "data-alza" : ""}>
    <div class="b-burbuja">
      <div class="b-sup"><p class="b-t">${m.t}</p>${m.img ? miniatura("b-mini") : ""}</div>
      ${o.fallo ? `<p class="b-err">${T.falloM}</p>` : ""}
      <div class="b-acc">
        <span class="b-agarre" title="${T.mover}">${ic("grip-vertical", 13)}</span>
        <button class="b-txt">${ic("pencil", 12)}${T.editar}</button>
        <button class="b-txt">${ic("trash-2", 12)}${T.borrar}</button>
        <span class="b-sep"></span>
        ${o.fallo ? `<button class="cm-prim b-chico" data-tono="fallo">${ic("rotate-cw", 12, 2.2)}${T.re}</button>`
          : o.espera ? `<span class="b-esp">${T.espera}</span>`
          : `<button class="b-ya" ${o.apretado ? "data-activo" : ""}>${ic("zap", 12, 2.2)}${T.ya}</button>`}
      </div>
    </div>
    <span class="b-nudo" ${N === 1 ? "data-solo" : ""}>${o.fallo ? ic("x", 13, 2.8) : N === 1 ? "" : k + 1}</span>
  </li>`;
}
function bandejaB() {
  let tono = "espera", icono = N === 1 ? "clock" : "layers", est = `<b>${titulo[0]}</b><span>${titulo[1]}</span>`, extra = "", cuerpo = "", corte = "", pop = "";
  if (E === "comando-largo" || E === "confirmar") { tono = "largo"; icono = "hourglass"; est = `<b>${T.largo}</b><span class="a-tiempo">3 m</span>`; extra = `<button class="cm-sec" data-tono="largo">${ic("square", 11, 2.4)}${T.parar}</button>`; }
  if (E === "fallo") { tono = "fallo"; icono = "circle-x"; est = `<b>${T.falloT}</b><span>${T.falloY}</span>`; }
  if (E === "colapsada") {
    cuerpo = `<div class="b-mazo"><span class="b-canto" data-k="2"></span><span class="b-canto" data-k="1"></span><div class="b-burbuja b-tapa">
      <div class="b-tapa-t"><b>${T.n(N)}</b><span>${T.trasN}</span></div><p class="b-t b-una">${T.m1}</p>
      <button class="cm-ic b-chev" aria-label="${T.abrir}" title="${T.abrir}">${ic("chevron-up", 15)}</button></div><span class="b-nudo">${N}</span></div>`;
    est = "";
  } else if (E === "arrastrando") {
    cuerpo = `<ol class="b-lista">${fichaB(LISTA[0], 0)}<li class="b-hueco"><span class="b-nudo" data-fantasma>2</span></li>${fichaB(LISTA[2], 2)}</ol><ol class="b-alzada">${fichaB(LISTA[1], 1, { alza: 1 })}</ol>`;
  } else {
    cuerpo = `<ol class="b-lista">${LISTA.map((m, k) => E === "fallo" ? fichaB(m, k, k === 0 ? { fallo: 1 } : { espera: 1 }) : fichaB(m, k, { apretado: E === "confirmar" && k === 0 })).join("")}</ol>`;
  }
  if (E === "confirmar") {
    corte = `<span class="b-tijera">${ic("scissors", 14, 2)}</span>`;
    pop = `<div class="b-pop" role="alertdialog" aria-label="${T.confT}"><p class="a-conf-t">${T.confT}</p><p class="a-conf-b">${T.confB}</p>
      <div class="a-conf-acc"><button class="cm-sec" data-foco>${T.seguir}</button><button class="cm-prim" data-tono="largo">${T.cortar}</button></div></div>`;
  }
  if (E === "miniatura") pop = `<div class="b-lamina"><img src="${FOTO}" alt="${T.img}"><button class="cm-ic" aria-label="${T.cerrar}" title="${T.cerrar}">${ic("x", 15)}</button></div>`;
  return `<div class="b" data-tono="${tono}" data-estado="${E}">
    <div class="b-tela">
      <svg class="b-hilo" aria-hidden="true"><line x1="50%" x2="50%" data-arriba/><line x1="50%" x2="50%" data-abajo/></svg>
      ${corte}
      ${est ? `<div class="b-estado">${ic(icono, 14, 2.2)}${est}${extra}</div>` : ""}
      ${cuerpo}${pop}
    </div>
    ${REAL_ID.caja}
  </div>`;
}

/* ---------- La pantalla ---------- */
const REAL_ID = window.REAL[ID];
const trabajo = () => {
  let tv = REAL_ID.tv.replace(/<span class="tv-x">0 s<\/span>/, `<span class="tv-x">${TIEMPO}</span>`);
  if (P === "b" && E === "confirmar") tv = tv.replace('class="tv-vivo">', `class="tv-vivo" data-corta>${T.seCorta}<i hidden>`).replace(/(<i hidden>)[^<]*(<\/span>)/, "</i>$2");
  return tv;
};
const FILA = { oscuro: "#2d3545", en: "#2d3545", claro: "#dee3ec" }; // el color de la fila elegida en cada captura
const cabecera = REAL_ID.header.replace(/ · 0 s/, ` · ${TIEMPO}`);
const velo = P === "a" && E === "miniatura" ? `<div class="a-visor"><img src="${FOTO}" alt="${T.img}"><button class="cm-ic" aria-label="${T.cerrar}" title="${T.cerrar}">${ic("x", 17)}</button></div>` : "";
document.getElementById("root").innerHTML = `<div class="app cm-app">
  <img class="cm-barra" src="cola-mensajes-recursos/barra-${ID === "en" ? "en" : TEMA}.png" alt="">
  <span class="cm-tiempo-barra" style="--cm-fila:${FILA[ID === "en" ? "en" : TEMA]}">${TIEMPO}</span>
  <main class="hilo">${cabecera}<div class="lider-linea"></div>
    <div class="conv-zona" id="zona"><div class="conv">
      <div class="yo">${T.yo}</div>
      <div class="el"><p>${T.el}</p></div>
      ${trabajo()}
    </div></div>
    <div class="caja-zona cm-zona">${P === "a" ? bandejaA() : bandejaB()}</div>
  </main>${velo}</div>`;
document.getElementById("zona").scrollTop = 1e6;
// El hilo de B sube hasta el borde de la tarjeta de trabajo; con un fallo, de ese nudo para abajo queda quieto.
if (P === "b") {
  const hilo = document.querySelector(".b-hilo"), tela = document.querySelector(".b-tela"), zoom = 1;
  const r0 = tela.getBoundingClientRect(), tar = document.querySelector(".tv-tar").getBoundingClientRect();
  const arriba = Math.min(0, tar.bottom - r0.top), abajo = r0.height;
  const roto = E === "fallo" ? document.querySelector(".b-ficha[data-fallo] .b-nudo").getBoundingClientRect() : null;
  const corte = roto ? roto.top + roto.height / 2 - r0.top : abajo;
  const [a, b] = hilo.querySelectorAll("line");
  a.setAttribute("y1", arriba); a.setAttribute("y2", corte);
  b.setAttribute("y1", corte); b.setAttribute("y2", abajo);
  if (roto) b.setAttribute("data-quieto", ""); else b.remove();
}
