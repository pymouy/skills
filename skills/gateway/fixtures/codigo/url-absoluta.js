// Una llamada a un endpoint fuera de superficie, con el host escrito adentro del literal.
//
// Vive en su propio archivo a propósito. Puesto junto a los demás patrones, nombrar el host
// de homologación en código convierte una URL de producción hardcodeada en aviso - que es lo
// correcto - y el fixture dejaba de probar lo que decía probar.
//
// El punto acá es sólo el nivel: esto es una llamada, no una mención, y da ERROR.
//
// El endpoint es inventado, como en integracion-mala.js: la regla salta con cualquier ruta
// ausente del contrato, y nombrar una real no agrega nada.
async function activarCert(rut, certId) {
  return fetch(`https://gatewaytest.pymo.uy/v1/companies/${rut}/certificados/${certId}/activar`, {
    method: 'POST',
  });
}

module.exports = { activarCert };
