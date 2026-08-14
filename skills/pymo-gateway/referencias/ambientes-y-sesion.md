<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Ambientes y URLs base

| Ambiente | URL base | Uso |
|---|---|---|
| Homologación | `https://gatewaytest.pymo.uy` | Integración y pruebas - emite contra la ePrueba de DGI |
| Producción | `https://gateway.pymo.uy` | Comprobantes fiscales reales |

> **Info**
>
> La API es idéntica en ambos ambientes. Lo que cambia es el endpoint de DGI al
> que el gateway envía (ePrueba vs producción) y las credenciales de la empresa.

## Políticas

| Tema | Valor | Estado |
|---|---|---|
| Autenticación | Sesión por cookie vía `POST /v1/login` - ver Autenticación | verificado en código |
| Duración de sesión | Cookie con `maxAge` de **1 hora** (`config.cookieMaxAge`) | verificado en código |
| Rate limiting | **No hay** rate limiting implementado en el gateway (sin middleware ni dependencia) | verificado en código |
| Timeout del cliente | No hay timeout de servidor explícito configurado. La respuesta de emisión es rápida porque el envío a DGI es asíncrono (ver Emisión); igual conviene un timeout de cliente generoso | verificado en código |
| CORS | Habilitado con credenciales, orígenes contra una allowlist por regex (`config.corsOptions`) | verificado en código |
| Formato de fechas | ISO 8601 (`2026-08-03T00:00:00-03:00`) | relevado |

> **Nota**
>
> Que no haya rate limiting hoy no es una garantía de contrato: pymo puede agregarlo.
> Un integrador robusto no debería asumir un límite ni depender de su ausencia.

## Cómo no emitir en producción sin querer

**Lo único que separa una prueba de un comprobante fiscal real es la URL base a
la que llamás.** No hay una bandera de "modo prueba", ni un parámetro, ni una
cabecera: mandar el mismo request a `gateway.pymo.uy` en lugar de
`gatewaytest.pymo.uy` emite de verdad.

Vale la pena entender por qué eso importa más que en otras APIs. Un CFE
confirmado **consume un número de CAE que no vuelve**. No se puede borrar: lo
único que existe después es una nota de crédito o la anulación, que son
comprobantes nuevos y también quedan registrados ante DGI. Un error de ambiente
no se limpia, se compensa.

Recomendaciones concretas, en orden de cuánto protegen:

1. **La URL base va en configuración, nunca escrita en el código.** Si un
   desarrollador puede cambiar de ambiente editando una constante, en algún
   momento se va a mergear la constante equivocada.
2. **Que producción sea explícita.** Que el default de tu configuración sea
   homologación y que producción haya que pedirla, no al revés. Un `.env`
   faltante debería dejarte en homologación, no en producción.
3. **Credenciales separadas por ambiente.** Las de homologación no deberían
   funcionar en producción ni al revés; si en tu sistema son las mismas variables,
   una copia de `.env` entre entornos cambia de ambiente sin que nadie lo note.
4. **Chequeá el ambiente en el arranque, no en el request.** Loguear a qué host
   apunta el cliente al iniciar convierte un error de configuración en algo
   visible antes de la primera emisión.
5. **Reservá una serie o un rango de `clientEmissionId` para pruebas.** No impide
   el error, pero hace que se note enseguida al mirar los comprobantes emitidos.

> **⚠️ Atención**
>
> El gateway **no** te va a avisar. Un request bien formado a producción es
> indistinguible, del lado de la API, de uno de prueba: responde `SUCCESS` igual.
> La única confirmación de que estabas en el ambiente que creías es la URL que
> usaste.

# Autenticación

## Login

```bash
curl -c cookies.txt -X POST {base}/v1/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "empresa@ejemplo.com", "password": "********" }'
```

Respuesta real (stack local):

```json
{ "payload": { "email": "empresa@ejemplo.com" },
  "message": { "code": "LOGGED_IN", "value": "Sessión iniciada correctamente." },
  "status": "SUCCESS" }
```

La sesión se mantiene por **cookie**: enviar la cookie devuelta en cada request
siguiente (`-b cookies.txt` en curl).

Cada sucursal (branch office) tiene su propia cuenta `email + password`, creada
por pymo durante el onboarding de la empresa.

## Permisos

La sesión queda atada al RUT de la empresa: sólo puede operar sobre
`/v1/companies/{suRut}/...` y los recursos de referencia (`/v1/currenciesQuotes`,
`/v1/dgiData/{suRut}`). Cualquier otro path devuelve `403 FORBIDDEN`.

### Clasificación de acceso

Cada endpoint de la referencia dice a qué categoría pertenece, en la línea
**Acceso** de su descripción:

| Categoría | Qué significa | Cuántos |
|---|---|---|
| Pública | No requiere sesión | 2 |
| Restringida | Requiere sesión; no está atada a un RUT (datos de referencia y `logout`) | 5 |
| Restringida por RUT | Requiere sesión y opera sólo sobre tu propia empresa | 54 |

Las otras dos categorías que se podrían esperar están vacías, y conviene decirlo:

- **Interna / de administración**: existe en el gateway, pero no se publica acá.
  Ninguno de esos endpoints aparece en esta referencia.
- **Obsoleta**: ninguno. No hay endpoints marcados como deprecados en el gateway,
  así que nada de lo documentado está anunciado para desaparecer.

Respuesta real sin sesión o sin permiso (`HTTP 401`):

```json
{
  "payload": {},
  "message": { "code": "UNAUTHORIZED", "value": "Debe iniciar sesión." },
  "status": "FAIL"
}
```

## Logout

```bash
curl -b cookies.txt -X POST {base}/v1/logout
```

Respuesta real (`HTTP 200`):

```json
{ "payload": {},
  "message": { "code": "LOGGED_OUT", "value": "Sessión cerrada correctamente" },
  "status": "SUCCESS" }
```

## Cuánto dura la sesión

**Una hora desde el login**, y es un vencimiento absoluto: usar la API no lo
extiende. Sale de `config.cookieMaxAge` (`1000 * 60 * 60`), que no tiene override
por ambiente, así que es el mismo número en homologación y en producción.

Cuando vence, cualquier endpoint responde `401` con `UNAUTHORIZED` igual que si
nunca hubieras iniciado sesión. No hay refresh: se vuelve a llamar a
`POST /v1/login`.

La sesión se guarda del lado del servidor, así que sobrevive a un reinicio del
servicio: si tu llamada falla con un error de red y reintentás, la sesión sigue
viva. Lo que la termina es el vencimiento o `POST /v1/logout`.

> **Nota**
>
> Los cuerpos de ejemplo están capturados de un gateway real, y el resto de esta
> página está verificado contra el código del servicio.
