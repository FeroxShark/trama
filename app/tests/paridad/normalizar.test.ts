import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizar } from "./normalizar.ts";

test("normalizar: rutas, ids, uuids, fechas y pids", () => {
  const r = { tmp: ["/tmp/paridad-abc"] };
  const t = normalizar(
    "/tmp/paridad-abc/estado/proy/20261027-132056-467.hilo 3f2b8c1e-1111-4222-8333-444455556666 2026-10-27T13:20:56.123Z (pid 4242) · 12s ·",
    r,
  );
  assert.equal(t, "<TMP>/estado/proy/<ID>.hilo <UUID> <FECHA> (pid <PID>) · <DUR> ·");
});

test("normalizar: CRLF a LF y lo estable queda igual", () => {
  assert.equal(normalizar("a\r\nb", { tmp: [] }), "a\nb");
  assert.equal(normalizar("RESULTADO: ok", { tmp: [] }), "RESULTADO: ok");
});

test("normalizar: duraciones de workers y campos JSON de edad", () => {
  const n = normalizar('1h02m 20000h30m hace 12s) "arranco_hace_s": 5432, "herramienta_hace_s": 7,', { tmp: [] });
  assert.equal(n, '<DUR> <DUR> hace <DUR>) "arranco_hace_s": <N>, "herramienta_hace_s": <N>,');
});

test("normalizar: la carpeta de transcripts de Claude (ruta con guiones)", () => {
  assert.equal(normalizar("home/.claude/projects/-tmp-paridad-AjSrpl-proy", { tmp: ["/tmp/paridad-AjSrpl"] }), "home/.claude/projects/<TMP-CLAUDE>-proy");
});

test("normalizar: el pid del claude que baja --matar/--parar", () => {
  assert.equal(normalizar("pa: worker de 'proy' matado (claude 123456 y su árbol).", { tmp: [] }), "pa: worker de 'proy' matado (claude <PID> y su árbol).");
});
