// ¿Hay alguien escuchando en el socket (o la named pipe) del motor? Aparte de local.ts para que las herramientas chicas
// (trama-estado) lo usen sin arrastrar el servidor entero (local.ts importa remoto.js, que sólo existe compilado).
import net from "node:net";

/** ¿Hay alguien escuchando en ese socket? Un archivo que quedó de un motor que murió no contesta. */
export function hayMotor(sock: string, ms = 1000): Promise<boolean> {
  return new Promise((ok) => {
    const c = net.connect(sock);
    const fin = (si: boolean) => {
      clearTimeout(t);
      c.destroy();
      ok(si);
    };
    // Un socket que acepta y no contesta igual es de alguien: mejor no pisarlo.
    const t = setTimeout(() => fin(true), ms);
    c.once("connect", () => fin(true));
    c.once("error", () => fin(false));
  });
}
