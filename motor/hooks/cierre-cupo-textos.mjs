// Los textos del cierre por cupo, en UN solo lugar (es y en), para los dos que avisan a un trabajo vivo:
//   - el hook `cierre-cupo.mjs` (sesiones del `claude` oficial: líderes y workers de pa), y
//   - el main de la app (`app/electron/cierre-cupo-texto.ts`, que lo carga de acá), que se lo manda por la cola a los líderes de otro
//     motor (Gemini, dsh, opencode), que no corren hooks.
// Módulo puro (sin disco, sin reloj, sin efectos al importarlo): viaja junto al hook (en Windows, `app\hooks`). El formato de la señal está en
// motor/docs/protocolo-cierre-cupo.md. Lo prueba app/tests/cierre-cupo-hook.test.ts.

/** Los pasos de cierre del worker: copia de CIERRE_TAREA sin su primera línea (app/electron/cli/pa/contrato.ts, `CIERRE_PASOS`); un test los compara. */
const PASOS_WORKER = {
  es: [
    "1) Commiteá, archivo por archivo, SOLO lo que tocaste vos (nada de `git add -A`, `-u` ni `.`).",
    "2) Respondé con el bloque RESULTADO / ARCHIVOS / DECISION / SIGUE / FRENÓ, y en DECISION decí explícitamente",
    "   qué quedó sin terminar.",
    "Si no hay nada tuyo para commitear, decilo y reportá igual. Nada de empezar trabajo nuevo.",
  ],
  en: [
    "1) Commit, file by file, ONLY what you touched yourself (no `git add -A`, `-u` or `.`).",
    "2) Answer with the RESULTADO / ARCHIVOS / DECISION / SIGUE / FRENÓ block, and say explicitly in DECISION",
    "   what was left unfinished.",
    "If you have nothing of your own to commit, say so and report anyway. Do not start any new work.",
  ],
};

/** La línea que el líder le dice al dueño al terminar (la pidió el dueño; una sola). */
export const LINEA_DUENO = {
  es: "Tenés la cuota muy baja, te dejé las cosas en este punto, el resumen está listo para retomar.",
  en: "Your quota is very low, I left things at this point, the summary is ready to resume.",
};

const NOMBRES = { claude: "Claude", google: "Google", chatgpt: "ChatGPT" };

const PLANTILLAS = {
  es: {
    worker: (d) =>
      [
        `[Trama · cupo] Te queda poco cupo de ${d.prov}: quedan ${d.pct} %, ${d.vuelve}; no arranques nada nuevo.`,
        "Cerrá ahora:",
        ...PASOS_WORKER.es,
      ].join("\n"),
    lider: (d) =>
      [
        `[Trama · cupo] Quedan ${d.pct} % de la suscripción de ${d.prov} (ventana ${d.ventana}); ${d.vuelve}. Cerrá ordenado y no arranques nada nuevo:`,
        "1) Dejá commiteado y andando lo que funciona (commits archivo por archivo, nada de `git add -A`).",
        `2) Escribí el resumen para retomar en ${d.archivo}: qué se hizo, en qué quedó, el próximo paso, los archivos tocados y los comandos para verificar.`,
        "3) Mandá a cerrar a tus workers vivos (SendMessage a cada pa/<slug>) y no lances workers nuevos con esta suscripción.",
        `4) Terminá con UNA sola línea al dueño: «${LINEA_DUENO.es}»`,
        "Si el dueño te sigue escribiendo, seguí chateando normal: esto no bloquea nada.",
      ].join("\n"),
    vuelveA: (h) => `vuelve a las ${h}`,
    vuelveSin: "vuelve cuando se reinicie la ventana",
  },
  en: {
    worker: (d) =>
      [
        `[Trama · quota] You are low on ${d.prov} quota: ${d.pct} % left, ${d.vuelve}; do not start anything new.`,
        "Wrap up now:",
        ...PASOS_WORKER.en,
      ].join("\n"),
    lider: (d) =>
      [
        `[Trama · quota] ${d.pct} % left on the ${d.prov} subscription (${d.ventana} window); ${d.vuelve}. Close down in an orderly way and do not start anything new:`,
        "1) Leave what works committed and running (commit file by file, never `git add -A`).",
        `2) Write the summary to resume in ${d.archivo}: what was done, where it stands, the next step, the files touched and the commands to verify.`,
        "3) Tell your live workers to wrap up (SendMessage to each pa/<slug>) and do not launch new workers on this subscription.",
        `4) Finish with ONE single line to the owner: «${LINEA_DUENO.en}»`,
        "If the owner keeps writing to you, keep chatting as usual: this blocks nothing.",
      ].join("\n"),
    vuelveA: (h) => `resets at ${h}`,
    vuelveSin: "resets when the window restarts",
  },
};

const dos = (n) => String(n).padStart(2, "0");

/** `HH:MM` local de un epoch en segundos; si no es de hoy, `dd/mm HH:MM`. `null` si no se sabe. */
export function horaDe(vuelve, ahora = Date.now() / 1000) {
  if (typeof vuelve !== "number" || !Number.isFinite(vuelve)) return null;
  const d = new Date(vuelve * 1000);
  const hoy = new Date(ahora * 1000);
  const hm = `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  return d.toDateString() === hoy.toDateString() ? hm : `${dos(d.getDate())}/${dos(d.getMonth() + 1)} ${hm}`;
}

export const idiomaValido = (x) => (x === "en" ? "en" : "es");

/**
 * El texto para un trabajo vivo. `rol`: `worker` (un worker de pa) o `lider`. `entrada`: la de la señal (`proveedor`, `ventana`,
 * `restante`, `vuelve`). `archivo`: dónde deja el resumen un líder (sólo `lider`).
 */
export function textoCierre({ rol, idioma, entrada, archivo = "", ahora }) {
  const t = PLANTILLAS[idiomaValido(idioma)];
  const hora = horaDe(entrada.vuelve, ahora);
  const d = {
    prov: NOMBRES[entrada.proveedor] ?? String(entrada.proveedor),
    pct: String(Math.max(0, Math.round(Number(entrada.restante) || 0))),
    ventana: String(entrada.ventana ?? ""),
    vuelve: hora ? t.vuelveA(hora) : t.vuelveSin,
    archivo,
  };
  return rol === "worker" ? t.worker(d) : t.lider(d);
}
