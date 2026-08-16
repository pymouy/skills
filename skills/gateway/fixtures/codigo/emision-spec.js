// Un test que apunta a producción. Emite comprobantes fiscales reales cada vez que
// corre el pipeline, y pasa en verde. Existe acá para que `validar.mjs codigo` lo
// encuentre: es el hallazgo que más caro sale y el más fácil de escribir sin querer.
//
// Dos cosas del archivo son deliberadas, y si las deshacés el fixture se vuelve el
// problema que describe:
//
//   - El nombre lleva guion (`emision-spec.js`) y no punto (`emision.spec.js`). El
//     verificador mira el nombre y los dos le alcanzan; el glob por defecto de jest y de
//     vitest pide el punto. Este bundle se copia adentro del repo del integrador, así que
//     con punto su runner lo colectaba y lo corría.
//   - El caso no se registra en ningún runner: es una función suelta que nadie llama. La
//     forma del error se lee igual, y no hay nada que ejecutar.

const BASE = 'https://gateway.pymo.uy';

async function testEmiteUnaFactura() {
  const res = await fetch(`${BASE}/v1/companies/219999990008/sendCfes/1`, { method: 'POST' });
  expect(res.status).toBe(200);
}

module.exports = { testEmiteUnaFactura };
