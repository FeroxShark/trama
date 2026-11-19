// Receptor de reportes anónimos de Trama (Cloudflare Worker). «Reportar un bug» > «Enviar anónimo» manda acá el texto y, si la
// persona los deja marcados, la captura y el log limpio. Nadie más que la Trama del dueño (con la clave de lectura) los puede leer.
//
//   POST   /v1/reportes       público: valida, limpia, vuelve a generar la captura (Cloudflare Images) y guarda 30 días en el KV.
//   GET    /v1/reportes       con clave: los ids guardados.
//   GET    /v1/reportes/<id>  con clave: un reporte.
//   DELETE /v1/reportes/<id>  con clave: lo borra (la Trama del dueño lo borra al bajarlo).
//
// Sin IP, nombre ni cuenta: no se guarda nada de quién manda, y el Worker no loguea (observability apagado en wrangler.toml). El
// tope por minuto usa la IP sólo en memoria de Cloudflare (Rate Limiting). La clave de lectura es un secreto del Worker
// (`wrangler secret put CLAVE_LECTURA`), nunca va en el repo. Las reglas puras están en app/electron/reportes-reglas.ts.
import { ID_RE, VIDA_S, aBase64, mismaClave, nuevoId, validarEntrada } from "../../app/electron/reportes-reglas.ts";

type KV = {
  get(k: string): Promise<string | null>;
  put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void>;
  delete(k: string): Promise<void>;
  list(o?: { prefix?: string; limit?: number }): Promise<{ keys: { name: string }[] }>;
};
type Limite = { limit(o: { key: string }): Promise<{ success: boolean }> };
type Imagenes = {
  input(s: ReadableStream<Uint8Array>): {
    transform(o: Record<string, unknown>): { output(o: { format: string; quality?: number }): Promise<{ response(): Response }> };
  };
};
export type Env = { REPORTES: KV; CLAVE_LECTURA?: string; LIMITE_IP?: Limite; LIMITE_TOTAL?: Limite; IMAGES?: Imagenes };

const PREFIJO = "r:";

const json = (estado: number, cuerpo: unknown): Response =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" },
  });

/** La captura vuelve a generarse como JPEG chico: lo que traiga escondido el archivo original no sobrevive. Sin Images, no se guarda. */
async function regenerar(env: Env, b: Uint8Array): Promise<Uint8Array | null> {
  if (!env.IMAGES) return null;
  try {
    const s = new Blob([b]).stream();
    const r = await env.IMAGES.input(s).transform({ width: 1600, fit: "scale-down" }).output({ format: "image/jpeg", quality: 80 });
    return new Uint8Array(await r.response().arrayBuffer());
  } catch {
    return null;
  }
}

async function recibir(req: Request, env: Env): Promise<Response> {
  const ip = req.headers.get("cf-connecting-ip") ?? "?";
  if (env.LIMITE_TOTAL && !(await env.LIMITE_TOTAL.limit({ key: "todos" })).success) return json(429, { error: "muchos reportes" });
  if (env.LIMITE_IP && !(await env.LIMITE_IP.limit({ key: ip })).success) return json(429, { error: "muchos reportes" });
  if (!(req.headers.get("content-type") ?? "").startsWith("application/json")) return json(415, { error: "formato" });
  const largo = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(largo) || largo > 1_600_000) return json(413, { error: "muy grande" });
  const v = validarEntrada(await req.text());
  if (!v.ok) return json(400, { error: v.error });
  const { captura, ...resto } = v.entrada;
  const jpeg = captura ? await regenerar(env, captura) : null;
  const id = nuevoId(Date.now(), crypto.getRandomValues(new Uint8Array(8)));
  // La hora, al minuto: alcanza para ordenar y no ayuda a cruzar con nada.
  const recibido = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  const guardado = { v: 1, recibido, ...resto, captura: jpeg ? aBase64(jpeg) : null, capturaDescartada: !!captura && !jpeg };
  await env.REPORTES.put(PREFIJO + id, JSON.stringify(guardado), { expirationTtl: VIDA_S });
  return json(201, { ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const partes = url.pathname.split("/").filter(Boolean);
    if (partes[0] !== "v1" || partes[1] !== "reportes" || partes.length > 3) return json(404, { error: "no existe" });
    if (partes.length === 2 && req.method === "POST") return recibir(req, env);
    // Lo demás es del dueño.
    const clave = /^Bearer (\S+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
    if (!mismaClave(clave, env.CLAVE_LECTURA)) return json(401, { error: "sin permiso" });
    if (partes.length === 2 && req.method === "GET") {
      const l = await env.REPORTES.list({ prefix: PREFIJO, limit: 100 });
      return json(200, { ids: l.keys.map((k) => k.name.slice(PREFIJO.length)).filter((id) => ID_RE.test(id)) });
    }
    const id = partes[2] ?? "";
    if (!ID_RE.test(id)) return json(404, { error: "no existe" });
    if (req.method === "GET") {
      const t = await env.REPORTES.get(PREFIJO + id);
      return t === null ? json(404, { error: "no existe" }) : new Response(t, { headers: { "content-type": "application/json; charset=utf-8", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
    }
    if (req.method === "DELETE") {
      await env.REPORTES.delete(PREFIJO + id);
      return json(200, { ok: true });
    }
    return json(405, { error: "método" });
  },
};
