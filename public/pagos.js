// public/pagos.js
console.log('📄 Módulo pagos cargado (master)');

document.addEventListener('DOMContentLoaded', function() {
  // NOTA: La funcionalidad de conversión de PDF a imágenes ha sido eliminada.
  // Los recibos se suben ahora manualmente o mediante CSV.

  // Función genérica fetch con credenciales
  async function fetchAPI(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include' // para enviar cookies de sesión
    };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`/api${endpoint}`, options);
    if (!res.ok) {
      let errorMsg = `Error ${res.status}`;
      try {
        const errorData = await res.json();
        errorMsg = errorData.error || errorMsg;
      } catch (e) {}
      throw new Error(errorMsg);
    }
    return await res.json();
  }

  // Cargar lista de pagos pendientes
  async function cargarPagosPendientes() {
    const tbody = document.querySelector('#tablaPagos tbody');
    if (!tbody) return;
    tbody.innerHTML = '<td colspan="6">Cargando...</td>';
    try {
      const pagos = await fetchAPI('/pagos/pendientes');
      tbody.innerHTML = '';
      pagos.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.propietario_nombre} (${p.apartamento})</td>
          <td>${p.fecha_pago || '—'}</td>
          <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
          <td>${p.referencia || '—'}</td>
          <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
          <td><button class="btn-verificar" onclick="abrirModalVerificacion(${p.id})">Verificar</button></td>
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error('Error cargando pagos:', err);
      tbody.innerHTML = `<td colspan="6">Error: ${err.message}</td>`;
    }
  }

  // Función global para abrir modal de verificación
  window.abrirModalVerificacion = async (pagoId) => {
    try {
      // Obtener el pago específico (podríamos hacer una llamada directa, pero no hay endpoint individual)
      // En su lugar, recargamos la lista y buscamos el pago
      const pagos = await fetchAPI('/pagos/pendientes');
      const pago = pagos.find(p => p.id === pagoId);
      if (!pago) return alert('Pago no encontrado');

      // Crear modal dinámico
      const modalHTML = `
        <div id="modalVerificar" class="modal" style="display:block;">
          <div class="modal-content" style="width:500px;">
            <span class="close" onclick="this.parentElement.parentElement.style.display='none'">&times;</span>
            <h3>Verificar Pago</h3>
            <p><strong>Propietario:</strong> ${pago.propietario_nombre} (${pago.apartamento})</p>
            <p><strong>Fecha Pago:</strong> ${pago.fecha_pago || '—'}</p>
            <p><strong>Monto Bs:</strong> ${pago.monto_bs ? pago.monto_bs.toFixed(2) : '—'}</p>
            <p><strong>Referencia:</strong> ${pago.referencia || '—'}</p>
            <p><strong>Tasa BCV:</strong> ${pago.tasa_bcv ? pago.tasa_bcv.toFixed(2) : '—'}</p>
            <p><strong>Monto USD calculado:</strong> ${pago.monto_bs && pago.tasa_bcv ? (pago.monto_bs / pago.tasa_bcv).toFixed(2) : '—'}</p>
            <button id="confirmarVerificacion">Confirmar Verificación</button>
            <button onclick="document.getElementById('modalVerificar').remove()">Cancelar</button>
          </div>
        </div>
      `;
      const modalContainer = document.createElement('div');
      modalContainer.innerHTML = modalHTML;
      document.body.appendChild(modalContainer);

      document.getElementById('confirmarVerificacion').addEventListener('click', async () => {
        try {
          await fetchAPI(`/pagos/${pagoId}/verificar`, 'POST');
          alert('Pago verificado correctamente');
          document.getElementById('modalVerificar').remove();
          cargarPagosPendientes(); // Recargar la tabla
        } catch (err) {
          alert('Error al verificar: ' + err.message);
        }
      });
    } catch (err) {
      alert('Error al preparar verificación: ' + err.message);
    }
  };

  // Cargar pagos al iniciar
  cargarPagosPendientes();
});