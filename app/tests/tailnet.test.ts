// Quién entra por red (electron/tailnet.ts): lo que dicen `tailscale status` y `tailscale whois`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { esIp, ipLimpia, nodoDe, permitido, tailnet, yoDe } from "../electron/tailnet.ts";

const STATUS = {
  BackendState: "Running",
  MagicDNSSuffix: "ejemplo.ts.net",
  Self: { TailscaleIPs: ["192.0.2.1", "fd7a:115c:a1e0::1"], DNSName: "mi-pc.ejemplo.ts.net.", UserID: 11, HostName: "mi-pc" },
};
const whois = (nombre: string, usuario: number, tags?: string[]) => ({ Node: { Name: `${nombre}.`, User: usuario, ...(tags ? { Tags: tags } : {}) }, UserProfile: { ID: usuario } });

test("tailnet: esta máquina, o nada si Tailscale no está andando", () => {
  assert.deepEqual(yoDe(STATUS), { ips: ["192.0.2.1", "fd7a:115c:a1e0::1"], nombre: "mi-pc.ejemplo.ts.net", sufijo: "ejemplo.ts.net", usuario: 11 });
  assert.equal(yoDe({ ...STATUS, BackendState: "Stopped" }), null);
  assert.equal(yoDe({ ...STATUS, Self: { ...STATUS.Self, TailscaleIPs: [] } }), null);
  assert.equal(yoDe(null), null);
  assert.equal(yoDe("x"), null);
});

test("tailnet: sólo un dispositivo anotado, del mismo usuario y sin etiquetas", () => {
  const yo = yoDe(STATUS)!;
  const celu = nodoDe(whois("mi-celu.ejemplo.ts.net", 11));
  assert.equal(permitido(yo, celu, ["mi-celu"]), true);
  assert.equal(permitido(yo, celu, ["Mi-Celu"]), true);
  assert.equal(permitido(yo, celu, []), false, "sin lista no entra nadie");
  assert.equal(permitido(yo, celu, ["otro"]), false, "mío pero no anotado");
  assert.equal(permitido(yo, nodoDe(whois("mi-celu.ejemplo.ts.net", 12)), ["mi-celu"]), false, "de otro usuario");
  assert.equal(permitido(yo, nodoDe(whois("mi-celu.ejemplo.ts.net", 11, ["tag:servicio"])), ["mi-celu"]), false, "etiquetado");
  assert.equal(permitido(yo, nodoDe(whois("mi-celu.otra-red.ts.net", 11)), ["mi-celu"]), false, "el mismo nombre en otra tailnet");
  assert.equal(permitido(yo, null, ["mi-celu"]), false, "una IP que no es de nadie");
  assert.equal(nodoDe({ Node: { Name: 3 } }), null);
});

test("tailnet: IPs", () => {
  assert.equal(ipLimpia("::ffff:192.0.2.9"), "192.0.2.9");
  assert.equal(ipLimpia("FD7A:115C::1%tailscale0"), "fd7a:115c::1");
  assert.equal(ipLimpia(undefined), "");
  for (const x of ["192.0.2.9", "fd7a:115c:a1e0::1"]) assert.equal(esIp(x), true, x);
  for (const x of ["", "192.0.2.9, 1.2.3.4", "--json", "host.name", "192.0.2.9 ; x"]) assert.equal(esIp(x), false, x);
});

test("tailnet: lo que no es una IP no llega al CLI", async () => {
  assert.equal(await tailnet().quien("--socket=/tmp/x"), null);
});
