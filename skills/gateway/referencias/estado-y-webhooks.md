<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Filtrado y webhooks

## Filtrado de listados

Todos los `GET` de listado aceptan el mismo formato:

```
GET .../recurso?[&f=<campo>][&<campo>=<valor>][&<campo>[<oper>]=<valor>][&s=<orden>][&sk=<skip>][&l=<limite>][&p=<populate>]
```

| Parámetro | Significado |
|---|---|
| `f=<campo>` | Proyección: incluir sólo ese campo (repetible) |
| `<campo>=<valor>` | Igualdad |
| `<campo>[<oper>]=<valor>` | Operador: `contains`, `gt`, `gte`, `lt`, `lte`, `ne` |
| `s=<campo>` / `s=-<campo>` | Orden ascendente / descendente |
| `sk=<n>` | Skip (paginación) |
| `l=<n>` | Límite (default 1000) |
| `p=<campo>` | Populate de referencias |

Ejemplo:

```
GET /v1/companies/219999990008/sentCfes/1?f=createdAt&f=company&s=-createdAt&sk=15&l=5&p=company
```

## Webhooks (notificaciones push)

El gateway avisa por `POST` cuando algo cambia. El aviso **no trae los datos**:
trae la ruta a consultar, y el integrador hace un `GET` autenticado para
obtenerlos.

```json
{ "type": "CFE_STATUS_CHANGE", "url_to_check": "/v1/companies/{rut}/sentCfes/1?updatedAt[gte]=2026-08-12T12:00:00.000Z" }
```

`url_to_check` es una **ruta, no una URL**: hay que anteponerle la URL base del
ambiente. Ya viene con el filtro `updatedAt[gte]` puesto, así que el `GET`
devuelve exactamente lo que cambió desde el aviso anterior.

Ese patrón es deliberado y conviene aprovecharlo: el aviso no está autenticado
(ver abajo), así que **no se le debe creer nada más que "andá a mirar"**. Los
datos llegan por el `GET`, que sí lleva tu sesión.

### Cómo se configura

Es un campo de la **sucursal**, no de la empresa: `callbackNotificationUrl` en
`branchOffices[]`. Cada sucursal puede tener la suya, o ninguna, y sin ella no se
envía nada.

> **⚠️ Atención**
>
> **No se puede configurar por API.** La actualización de sucursal aplica siete
> campos (`contactNumber`, `name`, `fiscalAddress`, `city`, `state`, `from` y
> `until`; estos dos últimos desactivan o reactivan la sucursal) y **descarta el
> resto en silencio**: mandar `callbackNotificationUrl` ahí responde éxito y no
> cambia nada. Se pide a pymo.

### Tipos de notificación

- `CFE_STATUS_CHANGE` - cambio de estado de un CFE (emitido o recibido)
- `NEW_REPORT` - nuevo reporte diario enviado
- `INFO|WARNING|EMERGENCY|ERROR_SSLCERT_EXPIRE_IN_LESS_THAN_{30|15|7|0}_DAYS` - vencimiento del certificado
- `INFO|WARNING|EMERGENCY|ERROR_CAE_NUMBER_EXPIRE_IN_LESS_THAN_{30|15|7|0}_DAYS` - vencimiento de CAE
- `WARN_FEW_{cfeType}_CAE_NUMBERS` - queda poca numeración para ese tipo
- `ERROR_NO_{cfeType}_CAE_NUMBERS` - sin numeración para ese tipo

### Garantías de entrega: cuáles hay y cuáles no

Esto es lo que hay que diseñar del lado del integrador, porque el gateway no lo
resuelve.

| Tema | Qué hace el gateway |
|---|---|
| Autenticación / firma | **Ninguna.** El `POST` sale con `Content-Type: application/json` y nada más: sin firma HMAC, sin secreto compartido, sin cabecera de autorización |
| Reintentos | **Hasta tres intentos**, con espera creciente entre uno y otro, si tu endpoint responde algo que no es 2xx o no acepta la conexión. Después del tercero el aviso se pierde. El mismo aviso puede llegar más de una vez |
| Timeout | El gateway no corta la espera: una respuesta lenta no genera un reintento |
| Orden | No garantizado. Dos avisos pueden llegar en cualquier orden |
| Deduplicación | Imposible sobre el aviso: el payload es `{type, url_to_check}`, sin id de evento ni timestamp propio |
| TLS | **No se valida el certificado del destino** |

Consecuencias prácticas:

1. **Tratá el aviso como una señal, no como un dato.** Cualquiera que conozca tu
   URL puede enviarte uno. Como el contenido real lo traés vos con un `GET`
   autenticado, un aviso falso te hace consultar de más y nada peor. No agregues
   lógica que dependa del body.
2. **No dependas de recibirlos todos.** Tres intentos fallidos, por un pico de
   carga o un deploy tuyo, pierden el aviso definitivamente. Hace falta un
   *polling* de respaldo con `updatedAt[gte]` sobre la última fecha que
   procesaste.
3. **Deduplicá por comprobante, no por aviso.** Un reintento repite el mismo
   aviso, y dos avisos pueden traer rangos solapados; lo estable es el `id` del
   CFE y su estado.
4. **Respondé con 2xx.** Cualquier otro código cuenta como fallo y genera un
   reintento, así que el mismo aviso te llega otra vez. El gateway no espera nada
   del cuerpo de tu respuesta.

> **Nota**
>
> La falta de firma y la falta de validación TLS son propiedades del webhook tal
> como está hoy, no recomendaciones de diseño de esta documentación: integrá
> contra lo que la tabla de arriba dice que hay.
