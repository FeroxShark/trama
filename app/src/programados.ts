// Lo programado y lo pospuesto (electron/programados.ts) en la ventana: una sola foto compartida que pone al día el aviso del main
// (`fuente.alProgramados`). La barra la usa para esconder las conversaciones pospuestas y para el globo del pie; la caja del líder,
// para listar lo que tiene programado. Al volver una conversación pospuesta avisa con la notificación de escritorio (la misma que "te espera").
import { useSyncExternalStore } from "react";
import type { Estado, Pospuesto } from "../electron/programados";
import { fuente } from "./datos/fuente";
import { t } from "./i18n";

const VACIO: Estado = { mensajes: [], pospuestos: [] };
let foto: Estado = VACIO;
let arrancado = false;
const oyentes = new Set<() => void>();

function poner(e: Estado) {
  foto = e;
  oyentes.forEach((f) => f());
}

/** Una conversación pospuesta volvió a su hora: aviso de escritorio (con la ventana sin foco; abrirlo lleva a la conversación). */
function volvio(p: Pospuesto) {
  const nombre = p.nombre || t("lider.sesionJefe");
  fuente.esperaNotificar({ sid: p.sid, titulo: t("progr.volvio", { nombre }), cuerpo: t("progr.volvioCuerpo") });
}

function arrancar() {
  if (arrancado) return;
  arrancado = true;
  void fuente.programados().then(poner, () => {});
  fuente.alProgramados((a) => {
    poner({ mensajes: a.mensajes, pospuestos: a.pospuestos });
    if (a.desperto) volvio(a.desperto);
  });
}

const suscribir = (fn: () => void) => {
  arrancar();
  oyentes.add(fn);
  return () => void oyentes.delete(fn);
};
const leer = () => foto;

export const useProgramados = (): Estado => useSyncExternalStore(suscribir, leer);
