<!-- Generado por scripts/openapi-to-skill.mjs. No editar a mano: los cambios se pierden.
     La prosa se edita en surface/skill-notes.md; el contrato, en el gateway. -->

# Reglas fiscales

## IndFact - indicador de facturación por línea

Tabla **verificada en el código** del gateway.

| IndFact | Significado | IVA |
|---|---|---|
| 1 | Sin IVA (exento) | 0% |
| 2 | Tasa mínima | 10% |
| **3** | **Tasa básica** | **22%** |
| 4 | Otra tasa | - |
| 5 | Entrega gratuita | 0% |
| 6 | No facturable | 0% |
| 7 | No facturable negativo | 0% |
| 8 / 10 | Exportación y asimiladas | 0% |
| 11 | Impuesto percibido | - |
| 12 | IVA en suspenso | 0% |
| 13 | Ítem vendido por no contribuyente | - |
| 14 | Contribuyente IVA mínimo / Monotributo / Monotributo MIDES | - |
| 15 | Contribuyente IMEBA | - |
| 16 | Obligación IVA mínimo / Monotributo / Monotributo MIDES | - |

Para el caso común de una venta gravada a tasa básica (22%): `IndFact: 3`. El gateway acumula los
netos e IVA por tasa en los tags DGI correspondientes (`MntNetoIVATasaBasica` / `MntIVATasaBasica`,
etc.).

**Qué `IndFact` lleva cada línea es una decisión fiscal, no de la API.** Esta tabla dice qué
significa cada valor; no dice cuál corresponde a la operación que estás facturando. Si no te lo
dieron, pará y preguntá: elegir uno porque el otro dio error es exactamente el error que esta skill
existe para evitar.

### Ejemplo de acumulación

Bloque `Totales` de una eFactura con una sola línea gravada a tasa básica: neto 2500 → IVA 550 →
total 3050.

```json
{
  "TpoMoneda": "UYU",
  "MntNetoIVATasaBasica": 2500,
  "IVATasaBasica": 22,
  "MntIVATasaBasica": 550,
  "MntTotal": 3050,
  "MntPagar": 3050,
  "CantLinDet": 1
}
```

`MntIVATasaBasica` (550) = `MntNetoIVATasaBasica` (2500) × 22%. Es la única aritmética de este
archivo que podés rehacer vos: si tus totales no cierran así, el problema está en cómo estás
acumulando, no en la API.

## Redondeo

**Verificado en código.** El gateway **no re-redondea** las líneas: los importes
de línea viajan tal como los manda el integrador. El único redondeo que aplica es
sobre los **totales en UYU al enviar a DGI**, a 2 decimales.

Consecuencia práctica para el integrador:

- Redondeá vos las líneas a 2 decimales antes de enviar; el gateway no lo hace por
  vos a nivel línea.
- Los totales se formatean a 2 decimales hacia DGI.
- El ejemplo real de arriba (neto 2500, IVA 550, total 3050) ya está en enteros y
  cierra exacto; con decimales, la coherencia línea-vs-total es responsabilidad del
  emisor.

Referencia normativa: [Formato CFE](https://www.efactura.dgi.gub.uy/principal/ampliacion_de_contenido/documento-de-formato-cfe-version-23-1) de DGI. Es la versión vigente al
momento de escribir esto (23-1); DGI la actualiza, y la lista de versiones está
en [Documentos de interés](https://www.efactura.dgi.gub.uy/principal/ampliacion_de_contenido/documentos-de-interes).

# Contingencia

> **Info**
>
> **No hay endpoints separados de contingencia.** La contingencia se emite por el
> mismo `POST /v1/companies/{rut}/sendCfes/{branchOffice}`, usando el tipo de CFE
> de contingencia correspondiente (verificado en el código del gateway: la tabla de tipos es una sola y las rutas
> no tienen variantes `_cont`).

## Mapeo tipo normal → tipo contingencia

| Comprobante | Normal | Contingencia |
|---|---|---|
| eTicket / NC / ND | 101 / 102 / 103 | 201 / 202 / 203 |
| eFactura / NC / ND | 111 / 112 / 113 | 211 / 212 / 213 |
| eFactura Expo / NC / ND / eRemito Expo | 121 / 122 / 123 / 124 | 221 / 222 / 223 / 224 |
| eTicket Cuenta Ajena / NC / ND | 131 / 132 / 133 | 231 / 232 / 233 |
| eFactura Cuenta Ajena / NC / ND | 141 / 142 / 143 | 241 / 242 / 243 |
| eBoleta / NC / ND | 151 / 152 / 153 | 251 / 252 / 253 |
| eRemito / eResguardo | 181 / 182 | 281 / 282 |

Los tipos de contingencia usan **CAEs propios** (numeración separada): la
empresa debe tener cargada numeración de contingencia para poder emitirlos -
ver `GET /v1/companies/{rut}/cfesActiveNumbers`.

## La diferencia práctica: la numeración la ponés vos

Es el cambio que rompe una integración si no se conoce. En los tipos normales el
gateway asigna serie y número desde el CAE, y mandarlos no hace nada. **En los
tipos de contingencia tenés que mandarlos vos**, en `IdDoc.Serie` e `IdDoc.Nro`:

```json
{
  "201": [
    {
      "clientEmissionId": "cont-2026-000012",
      "IdDoc": { "Serie": "A", "Nro": 2221321, "MntBruto": "1", "FmaPago": "1" },
      "…": "el resto igual que una emisión normal"
    }
  ]
}
```

La lista es exacta y no tiene excepciones: los veintiún tipos `2xx` llevan serie
y número propios, y los veintiún tipos `1xx` los reciben del CAE. Si la serie o
el número no son válidos, el comprobante queda en `BAD_CUSTOM_SERIE_NUMBER`.

## Qué le pasa a un comprobante de contingencia después

Dos cosas que sólo les pasan a estos:

- **Se pueden reliquidar.** DGI puede devolver un CFC reliquidado, y el estado
  queda en `PROCESSED_RELIQUIDATED`. Los comprobantes normales nunca pasan por
  ahí.
- **`PROCESSED_REJECTED` es ambiguo para ellos.** El gateway usa el mismo valor
  para un CFE rechazado y para un CFC observado, así que el estado por sí solo no
  distingue los dos casos (ver Emisión).

## Cuándo corresponde usar contingencia

> **⚠️ Atención**
>
> **El criterio es de DGI, no de esta API.** Cuántos fallos o cuánto tiempo sin
> respuesta habilitan emitir en contingencia, y por cuánto, es una regla del
> régimen, y no está codificada en el gateway: no hay un umbral ni un modo que se
> active solo. El gateway sólo registra la condición, con
> `CAN NOT CONNECT TO DGI. Use contingency` cuando no logra conectarse.
>
> Es exactamente el tipo de decisión de la sección Cuándo parar y
> preguntar: consultalo con el contador de la empresa antes de emitir en
> contingencia, no lo deduzcas del comportamiento de la API.

> **Nota**
>
> **Sin verificar:** el mecanismo por el que los comprobantes de contingencia se
> informan a DGI una vez normalizado el servicio (reporte diario contra reenvío)
> no está reproducido acá. El stack local no llegó a emitir un CFE aceptado, así
> que la reconciliación no se pudo observar de punta a punta. Queda como pregunta
> abierta al equipo de pymo.
