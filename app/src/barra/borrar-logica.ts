// Lo que decide el diálogo «Borrar proyecto…» (BorrarProyecto.tsx), sin pantalla: cuándo se puede confirmar y qué dice el aviso de git.
// Puro: lo prueba tests/borrar-proyecto.test.ts. La última palabra la tiene el main (electron/proyectos-borrar.ts): esto sólo evita pedir lo que se va a negar.
import type { VistaBorrar } from "../../electron/proyectos-borrar";

export type EstadoDialogo = {
  vista: VistaBorrar | null;
  /** «También mandar la carpeta a la papelera». */
  papelera: boolean;
  /** Lo que se escribió para confirmar la papelera. */
  escrito: string;
  /** Hay un pedido en vuelo. */
  ocupado: boolean;
};

/** Quitar de Trama: se puede si se leyó el proyecto y nada lo impide. Con la papelera, además el nombre exacto y que la carpeta pase las guardas. */
export const puedeConfirmar = ({ vista, papelera, escrito, ocupado }: EstadoDialogo): boolean =>
  !!vista && !ocupado && !vista.negado && (!papelera || (!vista.papeleraNegada && escrito === vista.nombre));

/** Qué decir del estado de git de la carpeta: sin repo, limpia o con trabajo sin guardar (cuántos cambios y commits). */
export type AvisoGit = { tipo: "norepo" } | { tipo: "limpio" } | { tipo: "sucio"; sinCommitear: number; sinEmpujar: number };

export const avisoGit = (g: VistaBorrar["git"]): AvisoGit =>
  !g ? { tipo: "norepo" } : g.sinCommitear > 0 || g.sinEmpujar > 0 ? { tipo: "sucio", sinCommitear: g.sinCommitear, sinEmpujar: g.sinEmpujar } : { tipo: "limpio" };
