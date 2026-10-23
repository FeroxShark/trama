// "La otra máquina" de tests/maquinas.test.ts: un núcleo de verdad (electron/nucleo.ts) servido por
// `crearRemoto` en 127.0.0.2, con su propio estado y los fakes. Lo arranca el test como proceso aparte (el
// núcleo es uno por proceso) con el entorno ya puesto; dice su puerto por stdout y vive hasta que lo matan.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith(".") && spec.endsWith(".js") && ctx.parentURL?.includes("/electron/")) {
      const ts = path.join(path.dirname(fileURLToPath(ctx.parentURL)), spec.slice(0, -3) + ".ts");
      if (existsSync(ts)) return next(spec.slice(0, -3) + ".ts", ctx);
    }
    return next(spec, ctx);
  },
});

const nucleo = await import("../../electron/nucleo.ts");
const { crearRemoto } = await import("../../electron/remoto.ts");
nucleo.armarNucleo();
const IP = "127.0.0.2";
const r = crearRemoto({
  dist: process.env.HILOS_STATE!,
  preload: path.join(process.env.HILOS_STATE!, "preload.cjs"),
  nombres: [IP],
  propias: [],
  // En la tailnet lo dice `tailscale whois`; acá entra quien venga de 127.x.
  entra: async (ip) => ip.startsWith("127."),
  llamar: nucleo.llamarRemoto,
  consulta: () => ({}),
  seFue: nucleo.soltarRemoto,
  changelog: "",
});
nucleo.escuchar(r.difundir);
const s = await r.escuchar(IP, Number(process.env.PUERTO ?? 0));
process.stdout.write(`${(s.address() as { port: number }).port}\n`);
