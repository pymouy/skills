// Ejemplo de lo que NO hay que hacer. No lo copies: existe para que `validar.mjs codigo`
// tenga algo donde encontrar los siete patrones que rompen una integración con el gateway,
// y para que se vea cómo se ven en código real.
//
// Cada uno de estos errores devuelve HTTP 200 y no rompe ningún test.
//
// Los endpoints fuera de superficie que se llaman acá son inventados. La regla salta con
// cualquier ruta que no esté en el contrato, así que una inventada la ejercita igual de
// bien, y qué endpoints existen y no se publican es una decisión de pymo que no tiene por
// qué viajar adentro de un fixture.

const BASE = 'https://gateway.pymo.uy';

async function emitir(pedido) {
  const res = await fetch(`${BASE}/v1/companies/${pedido.rut}/sendCfes/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      111: [
        {
          clientEmissionId: crypto.randomUUID(),
          IdDoc: { MntBruto: '1', FmaPago: '1' },
          Receptor: pedido.receptor,
          Totales: { TpoMoneda: 'UYU' },
          Items: pedido.items,
        },
      ],
    }),
  });

  if (!res.ok) throw new Error('falló la emisión');

  const data = await res.json();
  const emitido = data.payload.cfesIds[0];

  await db.facturas.update(pedido.id, {
    serie: emitido.serie,
    numero: emitido.nro,
    aceptadaPorDgi: true,
  });

  return emitido;
}

async function emitirConReintento(pedido) {
  try {
    return await emitir(pedido);
  } catch (e) {
    pedido.clientEmissionId = crypto.randomUUID();
    return await emitir(pedido);
  }
}

// Plantillas que se solapan: esta ruta concreta encaja en la aprobada
// /inSobres/cfes/{cfeId} tomando "reintentar" como el id, y encajaría igual en cualquier
// otra plantilla de la misma cantidad de segmentos que tuviera fijo ese lugar. El
// verificador ve la aprobada y se queda tranquilo; es su punto ciego, y está anotado en
// validar.mjs. Acá no hay hallazgo, y esa ausencia es justamente lo que muestra.
async function reprocesarConcreto(rut) {
  return fetch(`${BASE}/v1/companies/${rut}/inSobres/cfes/reintentar`, { method: 'POST' });
}

// La ruta armada en una línea y llamada en la siguiente sigue siendo una llamada.
async function reprocesar(rut, sobreId) {
  const ruta = `/v1/companies/${rut}/inSobres/${sobreId}/reintentar`;
  return fetch(`${BASE}${ruta}`, { method: 'POST' });
}

async function cotizaciones() {
  const res = await fetch(`${BASE}/v1/cotizaciones`);
  return res.json();
}

// Cuelga de /v1/companies/{rut}, que sí está soportado, y aun así está fuera:
// extender una ruta aprobada no la hace aprobada.
async function refrescarEstados(rut, cfes) {
  return fetch(`${BASE}/v1/companies/${rut}/refrescarEstados`, {
    method: 'POST',
    body: JSON.stringify({ cfes }),
  });
}

async function aceptarRecibido(rut, cfeId) {
  return fetch(`${BASE}/v1/companies/${rut}/inSobres/cfes/${cfeId}/cfeStatus`, {
    method: 'PUT',
    body: JSON.stringify({ cfeStatus: 'accepted' }),
  });
}
