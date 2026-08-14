// La forma exacta con la que se emite en producción sin querer: la URL base sale de
// configuración -que es lo correcto- y el valor por defecto es producción. Un `.env`
// faltante, una variable mal escrita o un contenedor sin su configuración dejan al cliente
// emitiendo documentos fiscales reales, y no hay ningún error que lo delate.
//
// Está acá porque el verificador la dejaba pasar. La regla de "producción como default"
// eximía toda línea que nombrara `process.env`, razonando que leer configuración es la
// mitigación; en esta línea `process.env` está y la mitigación no. El integrador que corrió
// el verificador y lo vio en verde recibió una respuesta falsa sobre la línea más cara que
// puede escribir.
const BASE = process.env.PYMO_BASE_URL || 'https://gateway.pymo.uy';

module.exports = { BASE };
