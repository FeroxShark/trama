// El esfuerzo del revisor de un plan («Revisar con otro modelo»): lo que se ofrece al lado del selector de modelo. Los niveles son los
// que ese modelo corre (su tabla) menos los que el dueño apagó en Ajustes > Modelos (`efforts_permitidos`); el de entrada es el de fábrica del
// modelo, y `max` nunca. La cuenta pura está en electron/revision-plan-texto.ts (la comparte el main, que vuelve a mirar al recibir el pedido).
import { esfuerzosRevisor } from "../../electron/revision-plan-texto.ts";
import { defDe, effortsDe } from "./modelos.ts";

export type PermitidosAjustes = Readonly<Record<string, readonly string[]>> | null | undefined;

/** Los esfuerzos que se ofrecen para ese revisor y el que queda marcado de entrada (`niveles` vacío: el modelo no tiene esfuerzo que elegir). */
export const esfuerzosDeRevisor = (modelo: string, permitidos: PermitidosAjustes): { niveles: string[]; defecto: string } =>
  esfuerzosRevisor(modelo, effortsDe(modelo), defDe(modelo)?.effortDefecto, permitidos);
