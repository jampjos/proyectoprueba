// public/propietario.js - Panel del propietario con detalle de recibos y comprobantes
// Modificado: muestra descripción en gastos específicos, monto en Bs y botón de imprimir/PDF.

console.log('Panel de propietario cargado');

// Configuración base de la API
const API_BASE = '/api';

// Obtener parámetros de la URL (propietarioId y usuarioId)
const urlParams = new URLSearchParams(window.location.search);
const propietarioId = urlParams.get('propietarioId');
const usuarioId = urlParams.get('usuarioId');

console.log('propietarioId desde URL:', propietarioId);
console.log('usuarioId desde URL:', usuarioId);

if (!propietarioId) {
  alert('No se encontró información de propietario');
  window.location.href = '/login.html';
  throw new Error('No hay propietarioId');
}

let propietarioActual = null;
let deudasPendientes = [];
let grupos = [];

// ---------- Función fetch con token JWT ----------
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada');
    }
    let errorMsg = `Error ${res.status}`;
    try {
      const errorData = await res.json();
      errorMsg = errorData.error || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  return await res.json();
}

// ---------- API ----------
const api = {
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),
  getDeudasByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/deudas`),
  getPagosByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/pagos`),
  crearPagoPropietario: (datos) => fetchAPI('/pagos/propietario', 'POST', datos),
  updatePagoPropietario: (datos) => fetchAPI(`/pagos/propietario/${datos.id}`, 'PUT', datos),
  deletePagoPropietario: (pagoId) => fetchAPI(`/pagos/propietario/${pagoId}`, 'DELETE'),
  getTasaBCV: () => fetchAPI('/tasa-bcv'),
  cambiarPassword: (usuarioId, nuevaPassword) => fetchAPI(`/usuarios/${usuarioId}/password`, 'PUT', { nuevaPassword }),
  getReciboById: (reciboId) => fetchAPI(`/recibos/${reciboId}`),
  getGrupos: () => fetchAPI('/grupos')
};

// ========== FUNCIONES DE UI ==========
async function cargarDatos() {
  try {
    propietarioActual = await api.getPropietarioById(parseInt(propietarioId));
    if (!propietarioActual) throw new Error('Propietario no encontrado');

    document.getElementById('propietarioNombre').textContent = propietarioActual.nombre;
    document.getElementById('propietarioApartamento').textContent = propietarioActual.apartamento;
    document.getElementById('propietarioEmail').textContent = propietarioActual.email || '—';
    document.getElementById('propietarioTelefono').textContent = propietarioActual.telefono || '—';

    try {
      grupos = await api.getGrupos();
    } catch (err) {
      console.warn('No se pudieron cargar los grupos:', err);
      grupos = [];
    }

    await cargarDeudas();
    await cargarPagos();

    const totalDeudasPendientes = deudasPendientes.reduce((sum, d) => sum + d.monto_usd, 0);
    const saldoNeto = (propietarioActual.saldo_favor || 0) - totalDeudasPendientes;
    const saldoEstadoElement = document.getElementById('saldoEstado');
    if (saldoEstadoElement) {
      const esSaldoAFavor = saldoNeto >= 0;
      const texto = esSaldoAFavor ? 'Saldo a favor' : 'Deuda pendiente';
      const valor = Math.abs(saldoNeto).toFixed(2);
      saldoEstadoElement.textContent = `${texto}: $${valor}`;
      saldoEstadoElement.style.color = esSaldoAFavor ? 'green' : 'red';
    }
  } catch (err) {
    console.error(err);
    alert('Error al cargar datos: ' + err.message);
    window.location.href = '/login.html';
  }
}

// ========== TABLA DE DEUDAS CON BOTÓN VER DETALLE ==========
async function cargarDeudas() {
  const tbody = document.querySelector('#tablaDeudas tbody');
  if (!tbody) return;
  try {
    const deudas = await api.getDeudasByPropietario(parseInt(propietarioId));
    deudasPendientes = deudas.filter(d => !d.pagado);
    tbody.innerHTML = '';
    for (const d of deudasPendientes) {
      let descripcionCorta = '—';
      let tieneDetalle = false;
      let reciboId = null;
      if (d.recibo_id) {
        reciboId = d.recibo_id;
        tieneDetalle = true;
        try {
          const recibo = await api.getReciboById(d.recibo_id);
          if (recibo && recibo.gastos_generales && recibo.gastos_generales.length) {
            const descs = recibo.gastos_generales.map(g => g.descripcion).slice(0, 2);
            descripcionCorta = descs.join(', ') + (recibo.gastos_generales.length > 2 ? '...' : '');
          } else {
            descripcionCorta = 'Ver detalles';
          }
        } catch (err) {
          console.warn('No se pudo cargar detalle del recibo:', err);
          descripcionCorta = 'Error al cargar';
        }
      }
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.periodo}</td>
        <td>$${d.monto_usd.toFixed(2)}</td>
        <td>${d.fecha_vencimiento || '—'}</td>
        <td>
          ${descripcionCorta}
          ${tieneDetalle ? `<button class="btn-ver-detalle" data-recibo-id="${reciboId}" data-deuda-id="${d.id}" style="margin-left:10px; background:#17a2b8; color:white; border:none; border-radius:3px; padding:2px 8px; cursor:pointer;">Ver detalle</button>` : ''}
        </td>
        <td class="pendiente">Pendiente</td>
      `;
      tbody.appendChild(tr);
    }
    if (deudasPendientes.length === 0) {
      tbody.innerHTML = '<td colspan="5">No hay deudas pendientes.</td>';
    }

    document.querySelectorAll('.btn-ver-detalle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reciboId = btn.dataset.reciboId;
        const deudaId = btn.dataset.deudaId;
        mostrarDetalleRecibo(reciboId, deudaId);
      });
    });
  } catch (err) {
    console.error('Error cargando deudas:', err);
    tbody.innerHTML = '<td colspan="5">Error al cargar deudas. Intente recargar.</td>';
  }
}

// ========== MODAL DE DETALLE DEL RECIBO (CON BOTÓN IMPRIMIR Y DESCRIPCIÓN EN ESPECÍFICOS) ==========
let modalDetalle = document.getElementById('modalDetalleRecibo');
if (!modalDetalle) {
  modalDetalle = document.createElement('div');
  modalDetalle.id = 'modalDetalleRecibo';
  modalDetalle.className = 'modal';
  modalDetalle.innerHTML = `
    <div class="modal-content" style="width: 700px; max-width: 95%;">
      <span class="close">&times;</span>
      <h3>Detalles del Recibo</h3>
      <div id="detalleReciboContent" style="max-height: 70vh; overflow-y: auto;"></div>
      <div style="margin-top: 15px; text-align: center;">
        <button id="btnImprimirDetalle" style="background-color: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">🖨️ Imprimir / Guardar PDF</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalDetalle);

  const closeSpan = modalDetalle.querySelector('.close');
  closeSpan.addEventListener('click', () => modalDetalle.style.display = 'none');
  window.addEventListener('click', (e) => {
    if (e.target === modalDetalle) modalDetalle.style.display = 'none';
  });

  // Evento para el botón de imprimir
  const btnImprimir = document.getElementById('btnImprimirDetalle');
  if (btnImprimir) {
    btnImprimir.addEventListener('click', () => {
      const contenido = document.getElementById('detalleReciboContent').innerHTML;
      const titulo = 'Detalles del Recibo';
      const ventana = window.open('', '_blank', 'width=800,height=600,toolbar=yes,scrollbars=yes');
      ventana.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${titulo}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; margin: 0; }
            .detalle-container { max-width: 800px; margin: auto; }
            table { width: 100%; border-collapse: collapse; margin: 10px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            h4 { margin-top: 20px; }
            @media print {
              body { margin: 0; padding: 0; }
              button { display: none; }
            }
          </style>
        </head>
        <body>
          <div class="detalle-container">
            <h3>${titulo}</h3>
            ${contenido}
            <p style="text-align: center; margin-top: 30px; font-size: 12px; color: gray;">Documento generado automáticamente - ${new Date().toLocaleString()}</p>
          </div>
          <script>
            window.onload = function() { window.print(); setTimeout(() => window.close(), 500); };
          <\/script>
        </body>
        </html>
      `);
      ventana.document.close();
    });
  }
}

async function mostrarDetalleRecibo(reciboId, deudaId) {
  if (!reciboId) {
    alert('No hay información detallada para esta deuda (falta recibo_id).');
    return;
  }
  try {
    const recibo = await api.getReciboById(parseInt(reciboId));
    if (!recibo) throw new Error('No se pudo obtener el recibo');

    // Obtener la deuda específica para saber el porcentaje individual
    const deudas = await api.getDeudasByPropietario(parseInt(propietarioId));
    const deuda = deudas.find(d => d.id === parseInt(deudaId));

    // Calcular total de gastos generales (sin específicos)
    let totalGastosGenerales = 0;
    if (recibo.gastos_generales && recibo.gastos_generales.length) {
      totalGastosGenerales = recibo.gastos_generales.reduce((sum, g) => sum + (g.monto_usd || 0), 0);
    }
    // Total con específicos es recibo.monto_usd
    const totalConEspecificos = recibo.monto_usd || 0;

    // Calcular gastos específicos por grupo
    const especificosPorGrupo = new Map(); // grupoId -> suma USD
    if (recibo.gastos_especificos && recibo.gastos_especificos.length) {
      recibo.gastos_especificos.forEach(ge => {
        if (ge.tipo === 'grupo') {
          const grupoId = ge.id;
          const monto = ge.monto || 0;
          especificosPorGrupo.set(grupoId, (especificosPorGrupo.get(grupoId) || 0) + monto);
        }
      });
    }

    let html = `<p><strong>Período:</strong> ${recibo.periodo}</p>`;
    html += `<p><strong>Total gastos generales del condominio:</strong> $${totalGastosGenerales.toFixed(2)}</p>`;
    if (totalConEspecificos > totalGastosGenerales) {
      html += `<p><strong>Total con gastos específicos adicionales:</strong> $${totalConEspecificos.toFixed(2)}</p>`;
    }
    html += `<p><strong>Monto a pagar por este propietario:</strong> $${deuda?.monto_usd.toFixed(2) || '0.00'}</p>`;

    // Desglose de gastos generales
    html += `<h4>📋 Gastos generales del condominio:</h4>`;
    if (recibo.gastos_generales && recibo.gastos_generales.length) {
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;"><th>Descripción</th><th>Monto (Bs)</th><th>Monto (USD)</th><tr></thead>
        <tbody>`;
      recibo.gastos_generales.forEach(g => {
        html += `<tr>
          <td>${g.descripcion}</td>
          <td>${(g.monto_ves || 0).toFixed(2)} Bs</td>
          <td>$${(g.monto_usd || 0).toFixed(2)}</td>
        </tr>`;
      });
      html += `</tbody></table>`;
    } else {
      html += `<p>No hay desglose de gastos generales disponible.</p>`;
    }

    // Gastos específicos (adicionales) con descripción, monto en USD y Bs
    if (recibo.gastos_especificos && recibo.gastos_especificos.length) {
      html += `<h4>🎯 Gastos específicos adicionales:</h4>`;
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;">
          <th>Descripción</th>
          <th>Afecta a</th>
          <th>Monto (USD)</th>
          <th>Monto (Bs)*</th>
        </tr></thead>
        <tbody>`;
      recibo.gastos_especificos.forEach(ge => {
        let destino = '';
        if (ge.tipo === 'grupo') {
          const grupo = grupos.find(g => g.id === ge.id);
          destino = grupo ? `Grupo ${grupo.nombre}` : `Grupo ID ${ge.id}`;
        } else {
          destino = `Propietario ID ${ge.id}`;
        }
        const montoUSD = ge.monto || 0;
        const tasa = recibo.tasa_bcv || 1;
        const montoBs = montoUSD * tasa;
        const descripcion = ge.descripcion || '—';
        html += `<tr>
          <td>${descripcion}</td>
          <td>${destino}</td>
          <td>$${montoUSD.toFixed(2)}</td>
          <td>${montoBs.toFixed(2)} Bs</td>
        </tr>`;
      });
      html += `</tbody></table>`;
      html += `<p><small>* Monto en bolívares calculado usando la tasa BCV del momento del recibo (${recibo.tasa_bcv?.toFixed(2) || 'N/A'} Bs/USD).</small></p>`;
    }

    // Distribución por grupos con montos base + específicos
    html += `<h4>🏢 Distribución por grupos (alícuotas):</h4>`;
    if (recibo.alicuotas_grupo && recibo.alicuotas_grupo.length) {
      html += `<table style="width:100%; border-collapse:collapse; margin-top:10px;">
        <thead><tr style="background:#f2f2f2;">
          <th>Grupo</th>
          <th>Porcentaje</th>
          <th>Monto base</th>
          <th>Gastos específicos</th>
          <th>Monto total del grupo</th>
        </tr></thead>
        <tbody>`;
      recibo.alicuotas_grupo.forEach(ag => {
        const grupo = grupos.find(g => g.id === ag.grupoId);
        const nombreGrupo = grupo ? grupo.nombre : `Grupo ${ag.grupoId}`;
        const montoBase = totalGastosGenerales * (ag.porcentaje / 100);
        const especificos = especificosPorGrupo.get(ag.grupoId) || 0;
        const totalGrupo = montoBase + especificos;
        html += `<tr>
          <td>${nombreGrupo}</td>
          <td>${ag.porcentaje.toFixed(3)}%</td>
          <td>$${montoBase.toFixed(2)}</td>
          <td>$${especificos.toFixed(2)}</td>
          <td><strong>$${totalGrupo.toFixed(2)}</strong></td>
        </tr>`;
      });
      html += `</tbody></table>`;
    } else {
      html += `<p>No hay distribución por grupos.</p>`;
    }

    document.getElementById('detalleReciboContent').innerHTML = html;
    modalDetalle.style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('Error al cargar detalle del recibo: ' + err.message);
  }
}

// ========== TABLA DE PAGOS CON BOTÓN "COMPROBANTE" ==========
async function cargarPagos() {
  const tbody = document.querySelector('#tablaPagos tbody');
  if (!tbody) return;
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    tbody.innerHTML = '';
    pagos.forEach(p => {
      const tr = document.createElement('tr');
      const montoUSD = p.monto_bs && p.tasa_bcv ? (p.monto_bs / p.tasa_bcv).toFixed(2) : '—';
      const isVerified = p.estado === 'verificado';
      tr.innerHTML = `
        <td>${p.fecha_pago || '—'}</td>
        <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
        <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
        <td>${montoUSD}</td>
        <td>${p.referencia || '—'}</td>
        <td class="${isVerified ? 'verificado' : 'pendiente'}">${p.estado}</td>
        <td>${p.fecha_verificacion || '—'}</td>
        <td class="acciones-pago">
          ${!isVerified ? 
            `<button class="btn-editar" onclick="editarPago(${p.id})">Editar</button>
             <button class="btn-eliminar" onclick="eliminarPago(${p.id})">Eliminar</button>` : 
            `<button class="btn-comprobante" data-pago-id="${p.id}" style="background:#28a745; color:white; border:none; border-radius:3px; padding:4px 8px; cursor:pointer;">Comprobante</button>`
          }
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-comprobante').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const pagoId = btn.dataset.pagoId;
        generarComprobante(pagoId);
      });
    });
  } catch (err) {
    console.error('Error cargando pagos:', err);
    tbody.innerHTML = '<td colspan="8">Error al cargar pagos. Intente recargar.</td>';
  }
}

// ========== GENERAR COMPROBANTE EN NUEVA VENTANA ==========
async function generarComprobante(pagoId) {
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    const pago = pagos.find(p => p.id === parseInt(pagoId));
    if (!pago || pago.estado !== 'verificado') {
      alert('Pago no verificado o no encontrado');
      return;
    }
    const montoUSD = (pago.monto_bs / pago.tasa_bcv).toFixed(2);
    const ventana = window.open('', '_blank', 'width=600,height=550,toolbar=yes,scrollbars=yes');
    ventana.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Comprobante de Pago Verificado</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; background: #f4f4f4; }
          .comprobante { background: white; border: 1px solid #ccc; padding: 20px; border-radius: 8px; max-width: 550px; margin: auto; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          h2 { text-align: center; color: #28a745; margin-top: 0; }
          hr { margin: 15px 0; }
          .label { font-weight: bold; display: inline-block; width: 180px; }
          .footer { margin-top: 20px; font-size: 12px; text-align: center; color: gray; border-top: 1px solid #eee; padding-top: 10px; }
          button { display: block; margin: 20px auto 0; padding: 8px 20px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
          button:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <div class="comprobante">
          <h2>COMPROBANTE DE PAGO VERIFICADO</h2>
          <p><span class="label">ID del Pago:</span> ${pago.id}</p>
          <p><span class="label">Propietario:</span> ${propietarioActual.nombre} (${propietarioActual.apartamento})</p>
          <p><span class="label">Fecha de Pago:</span> ${pago.fecha_pago || '—'}</p>
          <p><span class="label">Monto en Bolívares:</span> ${pago.monto_bs.toFixed(2)} Bs</p>
          <p><span class="label">Tasa BCV aplicada:</span> ${pago.tasa_bcv.toFixed(2)} Bs/USD</p>
          <p><span class="label">Equivalente en USD:</span> $${montoUSD}</p>
          <p><span class="label">Número de Referencia:</span> ${pago.referencia || '—'}</p>
          <p><span class="label">Fecha de Verificación:</span> ${pago.fecha_verificacion || '—'}</p>
          <hr>
          <p>Este comprobante certifica que el pago fue verificado y aplicado correctamente a las deudas del condominio.</p>
          <div class="footer">Generado el ${new Date().toLocaleString()}</div>
          <button onclick="window.print();">🖨️ Imprimir / Guardar PDF</button>
        </div>
      </body>
      </html>
    `);
    ventana.document.close();
  } catch (err) {
    alert('Error al generar comprobante: ' + err.message);
  }
}

// ========== FUNCIONES DE PAGOS ==========
const modalPago = document.getElementById('modalPago');
const modalPagoTitulo = document.getElementById('modalPagoTitulo');
const formPago = document.getElementById('formPago');
const btnAgregarPago = document.getElementById('btnAgregarPago');
const spanClosePago = document.querySelector('#modalPago .close');

async function cargarTasaBCV() {
  const tasaDiv = document.getElementById('tasaActual');
  const tasaInput = document.getElementById('tasaPago');
  try {
    tasaDiv.textContent = 'Obteniendo tasa BCV...';
    const tasaData = await api.getTasaBCV();
    tasaInput.value = tasaData.tasa.toFixed(2);
    tasaDiv.textContent = `Tasa BCV actual: ${tasaData.tasa.toFixed(2)} Bs/USD (${tasaData.fecha})`;
  } catch (err) {
    console.error('Error al obtener tasa BCV:', err);
    tasaDiv.textContent = 'No se pudo obtener la tasa automáticamente. Ingresa la tasa manualmente.';
    tasaInput.value = '';
  }
}

function resetFormPago() {
  document.getElementById('pagoId').value = '';
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('fechaPago').value = hoy;
  document.getElementById('montoPago').value = '';
  document.getElementById('referenciaPago').value = '';
}

btnAgregarPago.addEventListener('click', async () => {
  modalPagoTitulo.textContent = 'Registrar Pago';
  resetFormPago();
  await cargarTasaBCV();
  modalPago.style.display = 'block';
});

spanClosePago.addEventListener('click', () => {
  modalPago.style.display = 'none';
});
window.addEventListener('click', (e) => {
  if (e.target === modalPago) modalPago.style.display = 'none';
});

formPago.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pagoId = document.getElementById('pagoId').value;
  const fecha = document.getElementById('fechaPago').value;
  const monto_bs = parseFloat(document.getElementById('montoPago').value);
  const tasa_bcv = parseFloat(document.getElementById('tasaPago').value);
  const referencia = document.getElementById('referenciaPago').value;

  if (!fecha || isNaN(monto_bs) || monto_bs <= 0 || isNaN(tasa_bcv) || tasa_bcv <= 0 || !referencia) {
    alert('Todos los campos son obligatorios y los montos deben ser positivos');
    return;
  }

  try {
    const datos = {
      id: pagoId ? parseInt(pagoId) : null,
      propietario_id: parseInt(propietarioId),
      fecha_pago: fecha,
      monto_bs,
      tasa_bcv,
      referencia
    };

    if (pagoId) {
      await api.updatePagoPropietario(datos);
      alert('Pago actualizado correctamente');
    } else {
      await api.crearPagoPropietario(datos);
      alert('Pago registrado con éxito. Queda pendiente de verificación.');
    }
    modalPago.style.display = 'none';
    await cargarDatos();
  } catch (err) {
    alert('Error al guardar pago: ' + err.message);
  }
});

window.editarPago = async (pagoId) => {
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    const pago = pagos.find(p => p.id === pagoId);
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado === 'verificado') {
      alert('No se puede editar un pago ya verificado');
      return;
    }

    modalPagoTitulo.textContent = 'Editar Pago';
    document.getElementById('pagoId').value = pago.id;
    document.getElementById('fechaPago').value = pago.fecha_pago || '';
    document.getElementById('montoPago').value = pago.monto_bs;
    document.getElementById('tasaPago').value = pago.tasa_bcv;
    document.getElementById('referenciaPago').value = pago.referencia || '';

    const tasaDiv = document.getElementById('tasaActual');
    tasaDiv.innerHTML = `Tasa registrada: ${pago.tasa_bcv.toFixed(2)} Bs/USD (puedes modificarla si es necesario)`;
    modalPago.style.display = 'block';
  } catch (err) {
    alert('Error al cargar pago: ' + err.message);
  }
};

window.eliminarPago = async (pagoId) => {
  if (!confirm('¿Estás seguro de eliminar este pago? Esta acción no se puede deshacer.')) return;
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    const pago = pagos.find(p => p.id === pagoId);
    if (pago && pago.estado === 'verificado') {
      alert('No se puede eliminar un pago ya verificado');
      return;
    }
    await api.deletePagoPropietario(pagoId);
    alert('Pago eliminado');
    await cargarDatos();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
};

// Botón recargar
const btnRecargar = document.getElementById('btnRecargar');
if (btnRecargar) {
  btnRecargar.addEventListener('click', () => {
    cargarDatos();
    alert('Datos recargados');
  });
}

// ========== CAMBIAR CONTRASEÑA ==========
const modalPassword = document.getElementById('modalPassword');
const btnCambiar = document.getElementById('btnCambiarPassword');
const spanClosePass = document.querySelector('#modalPassword .close');
const formPassword = document.getElementById('formPassword');

btnCambiar.addEventListener('click', () => modalPassword.style.display = 'block');
spanClosePass.addEventListener('click', () => modalPassword.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalPassword) modalPassword.style.display = 'none';
});

formPassword.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nueva = document.getElementById('nuevaPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (nueva !== confirm) {
    alert('Las contraseñas no coinciden');
    return;
  }
  try {
    await api.cambiarPassword(parseInt(usuarioId), nueva);
    alert('Contraseña cambiada con éxito');
    modalPassword.style.display = 'none';
    document.getElementById('nuevaPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) {
    alert('Error al cambiar contraseña: ' + err.message);
  }
});

// ========== LOGOUT ==========
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/login.html';
});

// ========== INICIALIZACIÓN ==========
document.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('token')) {
    window.location.href = '/login.html';
    return;
  }
  try {
    await api.getPropietarioById(parseInt(propietarioId));
    cargarDatos();
  } catch (err) {}
});
