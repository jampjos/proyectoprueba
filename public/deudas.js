// public/deudas.js
console.log('📋 Módulo deudas cargado');

document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('modalDeuda');
  const btnNuevo = document.getElementById('nuevaDeuda');
  const spanClose = document.querySelector('#modalDeuda .close');
  const formDeuda = document.getElementById('formDeuda');
  const selectPropietario = document.getElementById('deudaPropietarioId');

  if (!modal || !btnNuevo) return;

  // Función genérica fetch con credentials
  async function fetchAPI(endpoint, method = 'GET', body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
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

  // Cargar propietarios en el select
  async function cargarPropietariosSelect() {
    try {
      const propietarios = await fetchAPI('/propietarios');
      selectPropietario.innerHTML = '<option value="">Seleccione...</option>';
      propietarios.forEach(p => {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = `${p.apartamento} - ${p.nombre}`;
        selectPropietario.appendChild(option);
      });
    } catch (err) {
      console.error('Error cargando propietarios:', err);
    }
  }

  // Abrir modal para nueva deuda
  btnNuevo.addEventListener('click', async (e) => {
    e.preventDefault();
    await cargarPropietariosSelect();
    document.getElementById('deudaId').value = '';
    document.getElementById('deudaPeriodo').value = '';
    document.getElementById('deudaMonto').value = '';
    document.getElementById('deudaVencimiento').value = '';
    modal.style.display = 'block';
  });

  // Cerrar modal
  if (spanClose) {
    spanClose.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }
  window.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  // Guardar deuda (crear o editar)
  if (formDeuda) {
    formDeuda.addEventListener('submit', async (e) => {
      e.preventDefault();
      const deudaId = document.getElementById('deudaId').value;
      const deuda = {
        propietario_id: parseInt(document.getElementById('deudaPropietarioId').value),
        periodo: document.getElementById('deudaPeriodo').value,
        monto_usd: parseFloat(document.getElementById('deudaMonto').value),
        fecha_vencimiento: document.getElementById('deudaVencimiento').value || null
      };

      if (!deuda.propietario_id || !deuda.periodo || isNaN(deuda.monto_usd)) {
        alert('Todos los campos son obligatorios');
        return;
      }

      try {
        if (deudaId) {
          // Editar
          await fetchAPI(`/deudas/${deudaId}`, 'PUT', deuda);
        } else {
          // Crear
          await fetchAPI('/deudas', 'POST', deuda);
        }
        modal.style.display = 'none';
        cargarDeudas();
      } catch (err) {
        alert('Error al guardar deuda: ' + err.message);
      }
    });
  }

  // Cargar lista de deudas
  async function cargarDeudas() {
    const tbody = document.querySelector('#tablaDeudas tbody');
    if (!tbody) return;
    tbody.innerHTML = '<td colspan="7">Cargando...</td>';
    try {
      const deudas = await fetchAPI('/deudas');
      tbody.innerHTML = '';
      for (const d of deudas) {
        // Obtener propietario
        const prop = await fetchAPI(`/propietarios/${d.propietario_id}`);
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${d.id}</td>
          <td>${prop ? prop.apartamento + ' - ' + prop.nombre : d.propietario_id}</td>
          <td>${d.periodo}</td>
          <td>${d.monto_usd}</td>
          <td>${d.fecha_vencimiento || '—'}</td>
          <td>${d.pagado ? 'Sí' : 'No'}</td>
          <td>
            <button onclick="editarDeuda(${d.id})">Editar</button>
            <button onclick="eliminarDeuda(${d.id})">Eliminar</button>
          </td>
        `;
        tbody.appendChild(tr);
      }
    } catch (err) {
      console.error(err);
      tbody.innerHTML = `<td colspan="7">Error: ${err.message}</td>`;
    }
  }

  // Editar deuda
  window.editarDeuda = async (id) => {
    try {
      // Obtener deuda por id (usando endpoint existente: /api/deudas?propietarioId=... no es ideal; mejor obtener todas y filtrar)
      const deudas = await fetchAPI('/deudas');
      const deuda = deudas.find(d => d.id === id);
      if (!deuda) throw new Error('Deuda no encontrada');

      // Cargar propietarios y seleccionar el correcto
      await cargarPropietariosSelect();
      document.getElementById('deudaId').value = deuda.id;
      document.getElementById('deudaPropietarioId').value = deuda.propietario_id;
      document.getElementById('deudaPeriodo').value = deuda.periodo;
      document.getElementById('deudaMonto').value = deuda.monto_usd;
      document.getElementById('deudaVencimiento').value = deuda.fecha_vencimiento || '';
      modal.style.display = 'block';
    } catch (err) {
      alert('Error al cargar deuda: ' + err.message);
    }
  };

  // Eliminar deuda
  window.eliminarDeuda = async (id) => {
    if (confirm('¿Eliminar esta deuda?')) {
      try {
        await fetchAPI(`/deudas/${id}`, 'DELETE');
        cargarDeudas();
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  };

  // Cargar deudas al iniciar
  cargarDeudas();
});