// Pantalla de prueba de B0: sólo mide si el engine banca el motion. No es diseño.
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { Minus, RotateCcw, Shuffle } from "lucide-react";
import { Medidor, resumir } from "./medidor";
import { bench } from "./puente";
import { t } from "./i18n";

type Fila = { id: string; proyecto: string; tarea: string };

const PROYECTOS = ["atlas", "brote", "cauce", "duna", "eco"];
const TAREAS = [
  "fix the date parser",
  "add paging to the list",
  "measure cold start",
  "migrate config to toml",
  "exporter tests",
  "clean up clippy warnings",
  "review last night's diff",
  "rename the queue module",
];

const TODAS: Fila[] = Array.from({ length: 30 }, (_, i) => ({
  id: (0x1a2b + i * 977).toString(16),
  proyecto: PROYECTOS[i % PROYECTOS.length],
  tarea: TAREAS[(i * 3) % TAREAS.length],
}));

const resorte = { type: "spring", stiffness: 520, damping: 42, mass: 1 } as const;

function barajar<T>(xs: T[]) {
  const c = [...xs];
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [c[i], c[j]] = [c[j], c[i]];
  }
  return c;
}

function sacar(xs: Fila[], n: number) {
  const c = [...xs];
  for (let k = 0; k < n && c.length; k++) c.splice(Math.floor(Math.random() * c.length), 1);
  return c;
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dosFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

// Singleton y guion una sola vez: en dev StrictMode monta el efecto dos veces y
// el cleanup del primero no tiene que cortar el guion del bench.
const medidor = new Medidor();
let guionCorriendo = false;

export function Bench() {
  const [filas, setFilas] = useState(TODAS);
  const [resorteVivo, setResorteVivo] = useState(true);
  const salida = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    medidor.salida = salida.current;
    medidor.arrancar();

    (async () => {
      if (guionCorriendo || !(await bench.modo().catch(() => false))) return;
      guionCorriendo = true;
      // Primer frame pintado desde que arrancó el proceso.
      await dosFrames();
      const arranque_ms = await bench.listo();
      const webview_ms = performance.now();
      await espera(300);

      // Fase animación: FLIP cada 450 ms + resorte continuo, 5 s grabando.
      const cpuAnim0 = await bench.cpu();
      medidor.grabando = true;
      const acciones = [
        () => setFilas((f) => barajar(f)),
        () => setFilas((f) => sacar(f, 3)),
        () => setFilas((f) => barajar(f)),
        () => setFilas(TODAS),
      ];
      for (let k = 0; k < 11; k++) {
        acciones[k % acciones.length]();
        await espera(450);
      }
      medidor.grabando = false;
      const cpuAnim1 = await bench.cpu();
      const animacion = resumir(medidor.grabadas);

      // Fase reposo: todo quieto, ni rAF propio ni resorte.
      medidor.parar();
      setResorteVivo(false);
      await espera(600);
      const cpu0 = await bench.cpu();
      await espera(2500);
      // Segunda mitad aparte: la primera arrastra el GC de después de animar.
      const cpuMitad = await bench.cpu();
      await espera(2500);
      const cpu1 = await bench.cpu();

      await bench.fin({
        arranque_ms,
        webview_hasta_primer_frame_ms: webview_ms,
        animacion,
        cpu_animacion: { cpu0: cpuAnim0, cpu1: cpuAnim1 },
        reposo: { cpu0, cpu_mitad: cpuMitad, cpu1 },
        ua: navigator.userAgent,
        reduced_motion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
    })();

    return () => {
      medidor.parar();
    };
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-full flex-col gap-3 p-4 text-sm">
        <header className="flex items-center gap-2 [-webkit-app-region:drag]">
          <span className="font-medium text-zinc-300">hilos · B0</span>
          <span ref={salida} className="ml-auto font-mono text-xs tabular-nums text-violet-300">
            …
          </span>
        </header>

        <div className="flex items-center gap-2">
          <Boton onClick={() => setFilas((f) => barajar(f))} icono={<Shuffle size={14} />}>
            {t("b0.barajar")}
          </Boton>
          <Boton onClick={() => setFilas((f) => sacar(f, 3))} icono={<Minus size={14} />}>
            {t("b0.sacar", { n: 3 })}
          </Boton>
          <Boton onClick={() => setFilas(TODAS)} icono={<RotateCcw size={14} />}>
            {t("b0.reponer")}
          </Boton>
          <div className="relative ml-auto h-6 w-48 rounded-full bg-zinc-900">
            <motion.div
              className="absolute top-1 left-1 size-4 rounded-full bg-violet-400"
              initial={{ x: 0 }}
              animate={resorteVivo ? { x: 168 } : { x: 0 }}
              transition={
                resorteVivo
                  ? { type: "spring", stiffness: 90, damping: 6, repeat: Infinity, repeatType: "mirror" }
                  : resorte
              }
            />
          </div>
        </div>

        <ul className="relative flex-1 overflow-hidden">
          <AnimatePresence mode="popLayout" initial={false}>
            {filas.map((f) => (
              <motion.li
                key={f.id}
                layout
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={resorte}
                className="flex h-8 items-center gap-3 rounded-md px-2 hover:bg-zinc-900"
              >
                <span className="font-mono text-xs text-zinc-500">{f.id}</span>
                <span className="text-zinc-400">{f.proyecto}</span>
                <span className="truncate text-zinc-200">{f.tarea}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </MotionConfig>
  );
}

function Boton(props: { onClick: () => void; icono: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={{ type: "spring", stiffness: 700, damping: 35 }}
      onClick={props.onClick}
      className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-2.5 py-1.5 text-zinc-300 hover:bg-zinc-800"
    >
      {props.icono}
      {props.children}
    </motion.button>
  );
}
