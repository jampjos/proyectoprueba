master de respaldo

// public/master.js - Versión con mejoras solicitadas (descripción en gastos específicos)
console.log('🖥️ Master UI cargada');

const API_BASE = '/api';

let grupos = [];
let propietarios = [];
let deudasGlobal = [];
let recibos = [];
let grupoSeleccionado = null;
let propiedadSeleccionada = null;
let grupoPropSeleccionado = null;
let currentTasaBCV = null;
let currentFechaTasa = null;

// ---------- Fetch con token ----------
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
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
    try { const errorData = await res.json(); errorMsg = errorData.error || errorMsg; } catch (e) {}
    throw new Error(errorMsg);
  }
  return await res.json();
}

// ---------- API ----------
const api = {
  getGrupos: () => fetchAPI('/grupos'),
  addGrupo: (nombre) => fetchAPI('/grupos', 'POST', { nombre }),
  updateGrupo: (id, nombre) => fetchAPI(`/grupos/${id}`, 'PUT', { nombre }),
  deleteGrupo: (id) => fetchAPI(`/grupos/${id}`, 'DELETE'),
  getPropietarios: () => fetchAPI('/propietarios'),
  getPropietariosConSaldo: () => fetchAPI('/propietarios/saldo'),
  addPropietario: (propietario) => fetchAPI('/propietarios', 'POST', propietario),
  updatePropietario: (propietario) => fetchAPI(`/propietarios/${propietario.id}`, 'PUT', propietario),
  deletePropietario: (id) => fetchAPI(`/propietarios/${id}`, 'DELETE'),
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),
  getUsuarioByPropietarioId: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/usuario`),
  crearUsuarioPropietario: (propietarioId, username, password) => fetchAPI(`/propietarios/${propietarioId}/usuario`, 'POST', { username, password }),
  actualizarUsuarioPropietario: (propietarioId, username, password) => fetchAPI(`/propietarios/${propietarioId}/usuario`, 'PUT', { username, password }),
  addRecibo: (recibo) => fetchAPI('/recibos', 'POST', recibo),
  getRecibos: (grupoId) => fetchAPI('/recibos' + (grupoId ? `?grupoId=${grupoId}` : '')),
  deleteRecibo: (id) => fetchAPI(`/recibos/${id}`, 'DELETE'),
  getReciboById: (id) => fetchAPI(`/recibos/${id}`),
  addDeuda: (deuda) => fetchAPI('/deudas', 'POST', deuda),
  getDeudas: (propietarioId) => fetchAPI('/deudas' + (propietarioId ? `?propietarioId=${propietarioId}` : '')),
  getDeudasByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/deudas`),
  updateDeuda: (deuda) => fetchAPI(`/deudas/${deuda.id}`, 'PUT', deuda),
  deleteDeuda: (id) => fetchAPI(`/deudas/${id}`, 'DELETE'),
  asignarPropietariosAGrupo: (ids, grupoId) => fetchAPI(`/grupos/${grupoId}/asignar`, 'POST', { ids }),
  getPagosPendientes: () => fetchAPI('/pagos/pendientes'),
  verificarPago: (pagoId) => fetchAPI(`/pagos/${pagoId}/verificar`, 'POST'),
  revertirPago: (pagoId) => fetchAPI(`/pagos/${pagoId}/revertir`, 'POST'),
  getAllUsers: () => fetchAPI('/usuarios'),
  updateUser: (userId, username, password) => fetchAPI(`/usuarios/${userId}`, 'PUT', { username, password }),
  deleteUser: (userId) => fetchAPI(`/usuarios/${userId}`, 'DELETE'),
  usernameExiste: (username) => fetchAPI(`/usuarios/existe?username=${encodeURIComponent(username)}`),
  getTasaBCV: () => fetchAPI('/tasa-bcv')
};

// ========== TASA Y GASTOS ==========
async function obtenerTasaBCV() {
  try {
    const data = await api.getTasaBCV();
    currentTasaBCV = data.tasa;
    currentFechaTasa = data.fecha;
    const tasaInput = document.getElementById('tasaBCV');
    if (tasaInput) {
      tasaInput.value = currentTasaBCV;
      const fechaSpan = document.getElementById('fechaTasa');
      if (fechaSpan) fechaSpan.innerText = `Actualizada: ${new Date(currentFechaTasa).toLocaleString()}`;
    }
    calcularTotalGastos();
    actualizarUSDEnGastosEspecificos(); // actualizar conversión de gastos específicos
    recalcularTodo();
    return currentTasaBCV;
  } catch (error) {
    console.error('Error obteniendo tasa BCV:', error);
    alert('No se pudo obtener la tasa BCV automáticamente. Puedes ingresarla manualmente.');
    return null;
  }
}

// Función para actualizar el valor en USD de cada gasto específico según la tasa actual
function actualizarUSDEnGastosEspecificos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) return;
  const rows = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
  rows.forEach(row => {
    const montoVESInput = row.querySelector('.gasto-especifico-monto-ves');
    const usdSpan = row.querySelector('.gasto-especifico-usd');
    if (montoVESInput && usdSpan) {
      const montoVES = parseFloat(montoVESInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
}

function agregarFilaGasto(descripcion = '', montoVES = 0) {
  const container = document.getElementById('gastosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-row';
  row.innerHTML = `
    <input type="text" class="gasto-desc" placeholder="Descripción" value="${escapeHtml(descripcion)}">
    <input type="number" class="gasto-monto" placeholder="Monto VES" step="any" value="${montoVES}">
    <span class="gasto-usd">0.00 USD</span>
    <button type="button" class="btn-eliminar-gasto">✖</button>
  `;
  const eliminarBtn = row.querySelector('.btn-eliminar-gasto');
  if (eliminarBtn) eliminarBtn.addEventListener('click', () => { row.remove(); calcularTotalGastos(); recalcularTodo(); });
  const montoInput = row.querySelector('.gasto-monto');
  if (montoInput) montoInput.addEventListener('input', () => { calcularTotalGastos(); recalcularTodo(); });
  container.appendChild(row);
  calcularTotalGastos();
}

function calcularTotalGastos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) {
    const totalSpan = document.getElementById('totalGastosUSD');
    if (totalSpan) totalSpan.innerText = '0.00';
    return 0;
  }
  let totalUSD = 0;
  const filas = document.querySelectorAll('#gastosContainer .gasto-row');
  filas.forEach(fila => {
    const montoInput = fila.querySelector('.gasto-monto');
    const usdSpan = fila.querySelector('.gasto-usd');
    if (montoInput && usdSpan) {
      const montoVES = parseFloat(montoInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        totalUSD += usd;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
  const totalSpan = document.getElementById('totalGastosUSD');
  if (totalSpan) totalSpan.innerText = totalUSD.toFixed(2);
  return totalUSD;
}

// ========== ALÍCUOTAS ==========
function agregarGrupoAlicuota(grupoId = '', porcentaje = '') {
  const container = document.getElementById('gruposAlicuotasContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'grupo-alicuota-row';
  const select = document.createElement('select');
  select.innerHTML = '<option value="">Seleccione grupo</option>' + grupos.map(g => `<option value="${g.id}" ${grupoId == g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
  select.addEventListener('change', () => { recalcularTodo(); validarSumaAlicuotas(); });
  const inputPorc = document.createElement('input');
  inputPorc.type = 'number';
  inputPorc.step = '0.001';
  inputPorc.placeholder = '%';
  inputPorc.value = porcentaje;
  inputPorc.addEventListener('input', () => { recalcularTodo(); validarSumaAlicuotas(); });
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); validarSumaAlicuotas(); });
  row.appendChild(select);
  row.appendChild(inputPorc);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

function validarSumaAlicuotas() {
  let suma = 0;
  const rows = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
  rows.forEach(row => {
    const input = row.querySelector('input[type="number"]');
    if (input && input.value) suma += parseFloat(input.value) || 0;
  });
  const msgDiv = document.getElementById('sumaAlicuotasMsg');
  if (!msgDiv) return false;
  if (Math.abs(suma - 100) > 0.001) {
    msgDiv.innerHTML = `⚠️ La suma de alícuotas es ${suma.toFixed(3)}%. Debe ser 100% para continuar.`;
    msgDiv.style.color = 'orange';
    return false;
  } else {
    msgDiv.innerHTML = `✅ Suma correcta: 100%`;
    msgDiv.style.color = 'green';
    return true;
  }
}

// ========== GASTOS ESPECÍFICOS (en bolívares, con descripción) ==========
function agregarGastoEspecifico() {
  const container = document.getElementById('gastosEspecificosContainer');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'gasto-especifico-row';
  row.style.display = 'flex';
  row.style.gap = '10px';
  row.style.alignItems = 'center';
  row.style.marginBottom = '8px';
  row.style.backgroundColor = '#e9ecef';
  row.style.padding = '8px';
  row.style.borderRadius = '4px';
  row.style.flexWrap = 'wrap';

  const selectTipo = document.createElement('select');
  selectTipo.innerHTML = '<option value="grupo">Afecta a un grupo (reparto equitativo)</option><option value="propietario">Afecta a un propietario específico</option>';
  selectTipo.style.flex = '1';
  const selectDestino = document.createElement('select');
  selectDestino.innerHTML = '<option value="">Seleccione...</option>';
  selectDestino.style.flex = '1';
  const inputDescripcion = document.createElement('input');
  inputDescripcion.type = 'text';
  inputDescripcion.placeholder = 'Descripción del gasto';
  inputDescripcion.style.flex = '1.5';
  const inputMontoVES = document.createElement('input');
  inputMontoVES.type = 'number';
  inputMontoVES.step = 'any';
  inputMontoVES.placeholder = 'Monto VES';
  inputMontoVES.className = 'gasto-especifico-monto-ves';
  inputMontoVES.style.flex = '1';
  const usdSpan = document.createElement('span');
  usdSpan.className = 'gasto-especifico-usd';
  usdSpan.innerText = '0.00 USD';
  usdSpan.style.flex = '0.8';
  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.style.padding = '5px 10px';

  async function cargarDestinos() {
    if (selectTipo.value === 'grupo') {
      const gruposList = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' + gruposList.map(g => `<option value="grupo_${g.id}">${g.nombre}</option>`).join('');
    } else {
      const props = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' + props.map(p => `<option value="prop_${p.id}">${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }

  // Función para actualizar el valor en USD según la tasa actual
  function actualizarUSD() {
    if (!currentTasaBCV || currentTasaBCV <= 0) return;
    const montoVES = parseFloat(inputMontoVES.value);
    if (!isNaN(montoVES) && montoVES > 0) {
      const usd = montoVES / currentTasaBCV;
      usdSpan.innerText = usd.toFixed(2) + ' USD';
    } else {
      usdSpan.innerText = '0.00 USD';
    }
  }

  selectTipo.addEventListener('change', cargarDestinos);
  cargarDestinos();
  inputMontoVES.addEventListener('input', () => {
    actualizarUSD();
    recalcularTodo();
  });
  inputDescripcion.addEventListener('input', () => recalcularTodo());
  selectDestino.addEventListener('change', () => recalcularTodo());
  btnEliminar.addEventListener('click', () => { row.remove(); recalcularTodo(); });

  row.appendChild(selectTipo);
  row.appendChild(selectDestino);
  row.appendChild(inputDescripcion);
  row.appendChild(inputMontoVES);
  row.appendChild(usdSpan);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ========== CÁLCULO FINAL POR PROPIETARIO (PREVISUALIZACIÓN) ==========
async function recalcularTodo() {
  const totalGastosGeneralesUSD = parseFloat(document.getElementById('totalGastosUSD')?.innerText) || 0;
  if (totalGastosGeneralesUSD === 0) return;

  const alicuotasGrupo = [];
  const rowsGrupo = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
  for (const row of rowsGrupo) {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select && select.value && input && input.value) {
      alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
    }
  }
  if (!validarSumaAlicuotas()) return;

  // Obtener gastos específicos: ahora cada fila tiene descripción, monto en VES y destino
  const gastosEsp = [];
  const rowsEsp = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
  for (const row of rowsEsp) {
    const tipo = row.querySelector('select:first-child')?.value;
    const destinoSelect = row.querySelector('select:nth-child(2)');
    const descripcion = row.querySelector('input[type="text"]')?.value;
    const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
    if (destinoSelect && destinoSelect.value && !isNaN(montoVES) && montoVES > 0 && currentTasaBCV > 0) {
      const [tipoDest, id] = destinoSelect.value.split('_');
      const montoUSD = montoVES / currentTasaBCV;
      gastosEsp.push({ tipo: tipoDest, id: parseInt(id), monto: montoUSD, descripcion: descripcion || 'Gasto específico' });
    }
  }

  const todosPropietarios = await api.getPropietarios();
  const propietariosPorGrupo = {};
  todosPropietarios.forEach(p => {
    if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
    propietariosPorGrupo[p.grupo_id].push(p);
  });

  const montoPorPropietario = new Map(); // id -> { base, adicional }
  for (const ag of alicuotasGrupo) {
    const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
    const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
    if (propietariosDelGrupo.length === 0) continue;
    const montoPorProp = montoGrupo / propietariosDelGrupo.length;
    propietariosDelGrupo.forEach(p => {
      if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(p.id).base += montoPorProp;
    });
  }
  for (const ge of gastosEsp) {
    if (ge.tipo === 'grupo') {
      const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        if (!montoPorPropietario.has(p.id)) montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
        montoPorPropietario.get(p.id).adicional += montoAdicionalPorProp;
      });
    } else if (ge.tipo === 'prop') {
      if (!montoPorPropietario.has(ge.id)) montoPorPropietario.set(ge.id, { base: 0, adicional: 0 });
      montoPorPropietario.get(ge.id).adicional += ge.monto;
    }
  }

  const tbody = document.querySelector('#tablaResumenPropietarios tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const [propId, montos] of montoPorPropietario.entries()) {
    const prop = todosPropietarios.find(p => p.id === propId);
    if (!prop) continue;
    const grupoNombre = grupos.find(g => g.id === prop.grupo_id)?.nombre || 'Sin grupo';
    const total = montos.base + montos.adicional;
    const row = tbody.insertRow();
    row.insertCell(0).innerText = prop.nombre;
    row.insertCell(1).innerText = prop.apartamento;
    row.insertCell(2).innerText = grupoNombre;
    row.insertCell(3).innerText = montos.base.toFixed(2);
    row.insertCell(4).innerText = montos.adicional.toFixed(2);
    row.insertCell(5).innerText = total.toFixed(2);
  }
}

// ========== ENVÍO DEL RECIBO (con prevención de doble envío y feedback) ==========
let isSubmitting = false;
document.getElementById('formRecibo')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  e.stopPropagation();

  if (isSubmitting) {
    alert('Ya se está procesando el recibo. Por favor espera.');
    return;
  }

  const submitBtn = document.querySelector('#formRecibo button[type="submit"]');
  const originalText = submitBtn?.textContent || 'Crear Recibo y Deudas';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Procesando...';
  }
  isSubmitting = true;

  try {
    const periodo = document.getElementById('periodoRecibo')?.value;
    if (!periodo || !/^\d{2}\/\d{4}$/.test(periodo)) {
      alert('Período inválido (MM/AAAA)');
      return;
    }
    // Obtener la tasa actual del campo (ya sea automática o manual)
    const tasaInput = document.getElementById('tasaBCV');
    if (tasaInput) {
      currentTasaBCV = parseFloat(tasaInput.value);
      if (isNaN(currentTasaBCV) || currentTasaBCV <= 0) {
        alert('Ingrese una tasa BCV válida (positiva)');
        return;
      }
    } else {
      if (!currentTasaBCV || currentTasaBCV <= 0) {
        alert('Obtenga o ingrese la tasa BCV primero');
        return;
      }
    }

    // 1. Gastos generales (en VES, convertir a USD con tasa actual)
    const gastos = [];
    const filasGastos = document.querySelectorAll('#gastosContainer .gasto-row');
    for (let f of filasGastos) {
      const desc = f.querySelector('.gasto-desc')?.value;
      const montoVES = parseFloat(f.querySelector('.gasto-monto')?.value);
      if (desc && !isNaN(montoVES) && montoVES > 0) {
        gastos.push({
          descripcion: desc,
          monto_ves: montoVES,
          monto_usd: montoVES / currentTasaBCV
        });
      }
    }
    if (gastos.length === 0) {
      alert('Agregue al menos un gasto general');
      return;
    }
    const totalGastosGeneralesUSD = gastos.reduce((s, g) => s + g.monto_usd, 0);

    // 2. Alícuotas
    const alicuotasGrupo = [];
    const rowsGrupo = document.querySelectorAll('#gruposAlicuotasContainer .grupo-alicuota-row');
    for (const row of rowsGrupo) {
      const select = row.querySelector('select');
      const input = row.querySelector('input[type="number"]');
      if (select?.value && input?.value) {
        alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
      }
    }
    if (!validarSumaAlicuotas()) {
      alert('La suma de alícuotas debe ser 100%');
      return;
    }

    // 3. Gastos específicos (con descripción, monto en VES, destino)
    const gastosEspecificos = [];
    const rowsEsp = document.querySelectorAll('#gastosEspecificosContainer .gasto-especifico-row');
    const gruposEnAlicuota = new Set(alicuotasGrupo.map(ag => ag.grupoId));
    for (const row of rowsEsp) {
      const tipo = row.querySelector('select:first-child')?.value;
      const destinoSelect = row.querySelector('select:nth-child(2)');
      const descripcion = row.querySelector('input[type="text"]')?.value;
      const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
      if (destinoSelect?.value && !isNaN(montoVES) && montoVES > 0) {
        const [tipoDest, id] = destinoSelect.value.split('_');
        if (tipoDest === 'grupo') {
          const grupoId = parseInt(id);
          if (!gruposEnAlicuota.has(grupoId)) {
            alert(`Error: El grupo "${destinoSelect.options[destinoSelect.selectedIndex]?.text}" no está en la lista de alícuotas.`);
            return;
          }
        }
        const montoUSD = montoVES / currentTasaBCV;
        gastosEspecificos.push({
          tipo: tipoDest,
          id: parseInt(id),
          monto: montoUSD,
          descripcion: descripcion || 'Gasto específico'
        });
      }
    }
    const totalGastosEspecificosUSD = gastosEspecificos.reduce((sum, ge) => sum + ge.monto, 0);
    const totalGastosUSD = totalGastosGeneralesUSD + totalGastosEspecificosUSD;

    // 4. Calcular montos por propietario
    const todosPropietarios = await api.getPropietarios();
    const propietariosPorGrupo = {};
    todosPropietarios.forEach(p => {
      if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
      propietariosPorGrupo[p.grupo_id].push(p);
    });
    const montoPorPropietario = new Map();

    for (const ag of alicuotasGrupo) {
      const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
      const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoPorProp = montoGrupo / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoPorProp);
      });
    }
    for (const ge of gastosEspecificos) {
      if (ge.tipo === 'grupo') {
        const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
        if (propietariosDelGrupo.length === 0) continue;
        const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
        propietariosDelGrupo.forEach(p => {
          montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoAdicionalPorProp);
        });
      } else if (ge.tipo === 'prop') {
        montoPorPropietario.set(ge.id, (montoPorPropietario.get(ge.id) || 0) + ge.monto);
      }
    }

    // Validación anti-error
    const propietariosList = Array.from(montoPorPropietario.entries());
    const umbral = 0.95;
    let error = false;
    for (let [propId, monto] of propietariosList) {
      if (propietariosList.length > 1 && monto >= totalGastosUSD * umbral) {
        const prop = todosPropietarios.find(p => p.id === propId);
        alert(`Error: El propietario ${prop?.nombre} (${prop?.apartamento}) recibiría ${(monto/totalGastosUSD*100).toFixed(1)}% del total. Revise gastos específicos.`);
        error = true;
      }
    }
    if (error) return;

    // 5. Crear recibo
    let reciboId = null;
    const reciboData = {
      periodo,
      monto_usd: totalGastosUSD,
      gastos_generales: JSON.stringify(gastos),
      alicuotas_grupo: JSON.stringify(alicuotasGrupo),
      gastos_especificos: JSON.stringify(gastosEspecificos),
      tasa_bcv: currentTasaBCV,
      fecha_tasa: currentFechaTasa || new Date().toISOString()
    };
    const reciboCreado = await api.addRecibo(reciboData);
    reciboId = reciboCreado.id;
    if (!reciboId) throw new Error('No se obtuvo ID del recibo');
    console.log('Recibo resumen creado con ID:', reciboId);

    // 6. Crear deudas
    let deudasCreadas = 0;
    for (let [propId, monto] of montoPorPropietario.entries()) {
      if (monto <= 0) continue;
      const montoRedondeado = Math.round(monto * 100) / 100;
      await api.addDeuda({
        propietario_id: propId,
        periodo,
        monto_usd: montoRedondeado,
        fecha_vencimiento: null,
        recibo_id: reciboId,
        porcentaje_alicuota: (montoRedondeado / totalGastosUSD) * 100
      });
      deudasCreadas++;
    }

    alert(`✅ Recibo creado. Se generaron ${deudasCreadas} deudas.`);
    const modal = document.getElementById('modalRecibo');
    if (modal) modal.style.display = 'none';
    cargarRecibos();
    if (propiedadSeleccionada) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
    cargarPagosPendientes();
    cargarPropietarios(grupoPropSeleccionado);
  } catch (err) {
    console.error('Error al crear recibo:', err);
    alert('Error al crear el recibo: ' + err.message);
  } finally {
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
});

// ========== BOTÓN AGREGAR RECIBO Y CONFIGURACIÓN DEL MODAL ==========
const btnAgregarRecibo = document.getElementById('btnAgregarRecibo');
if (btnAgregarRecibo) {
  btnAgregarRecibo.addEventListener('click', async () => {
    console.log('Botón Agregar Recibo clickeado');
    const safeClear = (id) => {
      const el = document.getElementById(id);
      if (el) {
        if (el.tagName === 'INPUT' || el.tagName === 'SELECT') el.value = '';
        else el.innerHTML = '';
      }
    };
    safeClear('periodoRecibo');
    const gastosContainer = document.getElementById('gastosContainer');
    if (gastosContainer) gastosContainer.innerHTML = '';
    const gruposAlicContainer = document.getElementById('gruposAlicuotasContainer');
    if (gruposAlicContainer) gruposAlicContainer.innerHTML = '';
    const gastosEspContainer = document.getElementById('gastosEspecificosContainer');
    if (gastosEspContainer) gastosEspContainer.innerHTML = '';
    const resumenTbody = document.querySelector('#tablaResumenPropietarios tbody');
    if (resumenTbody) resumenTbody.innerHTML = '';
    agregarFilaGasto(); // una fila inicial
    try { grupos = await api.getGrupos(); } catch (err) { console.error(err); }
    try {
      if (!currentTasaBCV) await obtenerTasaBCV();
      else {
        const tasaInput = document.getElementById('tasaBCV');
        if (tasaInput) tasaInput.value = currentTasaBCV;
        const fechaSpan = document.getElementById('fechaTasa');
        if (fechaSpan && currentFechaTasa) fechaSpan.innerText = `Actualizada: ${new Date(currentFechaTasa).toLocaleString()}`;
      }
    } catch (err) { console.error(err); }
    const modal = document.getElementById('modalRecibo');
    if (modal) modal.style.display = 'block';
    else alert('Error: no se encontró el modal de recibo');
  });
} else {
  console.error('Botón btnAgregarRecibo no encontrado');
}

// ========== EVENTOS DEL MODAL RECIBO ==========
// Botón para obtener tasa automática (sigue funcionando, pero el campo ya es editable)
document.getElementById('btnActualizarTasa')?.addEventListener('click', () => obtenerTasaBCV());
document.getElementById('btnAgregarGasto')?.addEventListener('click', () => agregarFilaGasto());
document.getElementById('btnAgregarGrupoAlicuota')?.addEventListener('click', () => agregarGrupoAlicuota());
document.getElementById('btnAgregarGastoEspecifico')?.addEventListener('click', () => agregarGastoEspecifico());

// Cierre del modal (botón ×)
const modalRecibo = document.getElementById('modalRecibo');
const closeBtn = modalRecibo?.querySelector('.close');
if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    modalRecibo.style.display = 'none';
  });
}
// También cerrar al hacer clic fuera del contenido
window.addEventListener('click', (e) => {
  if (e.target === modalRecibo) {
    modalRecibo.style.display = 'none';
  }
});

// Eventos para recalcular cuando cambian los inputs
document.addEventListener('change', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer')) recalcularTodo();
});
document.addEventListener('input', (e) => {
  if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer')) recalcularTodo();
  // Si cambia la tasa BCV manualmente, actualizar todos los cálculos
  if (e.target.id === 'tasaBCV') {
    const nuevaTasa = parseFloat(e.target.value);
    if (!isNaN(nuevaTasa) && nuevaTasa > 0) {
      currentTasaBCV = nuevaTasa;
      calcularTotalGastos();
      actualizarUSDEnGastosEspecificos();
      recalcularTodo();
    }
  }
});

// ========== FUNCIONES EXISTENTES (PROPIETARIOS, GRUPOS, DEUDAS, PAGOS) ==========
// ... (el resto de las funciones originales se mantienen igual, no se modifican)
// Asegúrate de que todo el código que ya tenías (cargarGruposPropietarios, cargarPropietarios, etc.) esté presente.
// Por brevedad, no repito aquí todo el código que ya está en tu archivo.
// Debes conservar todo el contenido desde "// ---------- Funciones auxiliares ----------" hasta el final.
function generarUsernameBase(apartamento) {
  return apartamento.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
}
function generarPassword(longitud = 8) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';
  for (let i = 0; i < longitud; i++) password += chars.charAt(Math.floor(Math.random() * chars.length));
  return password;
}
async function usernameExiste(username) {
  try {
    const data = await api.usernameExiste(username);
    return data.exists;
  } catch { return false; }
}
async function generarUsernameUnico(base) {
  let username = base;
  let contador = 1;
  while (await usernameExiste(username)) {
    username = base + contador;
    contador++;
  }
  return username;
}
async function apartamentoExiste(apartamento, exceptId = null) {
  const props = await api.getPropietarios();
  if (exceptId) return props.some(p => p.apartamento === apartamento && p.id !== exceptId);
  return props.some(p => p.apartamento === apartamento);
}
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return m;
  });
}

// ---------- Cargar grupos para propietarios ----------
async function cargarGruposPropietarios() {
  const container = document.getElementById('gruposPropContainer');
  if (!container) return;
  try {
    grupos = await api.getGrupos();
    container.innerHTML = '';

    const sinGrupoTab = document.createElement('div');
    sinGrupoTab.className = 'group-tab';
    sinGrupoTab.style.backgroundColor = (grupoPropSeleccionado === null) ? '#007bff' : '#6c757d';
    const btnSinGrupo = document.createElement('button');
    btnSinGrupo.textContent = 'Sin grupo';
    btnSinGrupo.style.backgroundColor = 'transparent';
    btnSinGrupo.addEventListener('click', () => seleccionarGrupoPropietarios(null));
    const actionsDivSinGrupo = document.createElement('div');
    actionsDivSinGrupo.className = 'group-actions';
    actionsDivSinGrupo.style.display = 'none';
    sinGrupoTab.appendChild(btnSinGrupo);
    sinGrupoTab.appendChild(actionsDivSinGrupo);
    container.appendChild(sinGrupoTab);

    for (const g of grupos) {
      const tabDiv = document.createElement('div');
      tabDiv.className = 'group-tab';
      tabDiv.style.backgroundColor = (grupoPropSeleccionado === g.id) ? '#007bff' : '#6c757d';
      const btn = document.createElement('button');
      btn.textContent = g.nombre;
      btn.style.backgroundColor = 'transparent';
      btn.addEventListener('click', () => seleccionarGrupoPropietarios(g.id));
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'group-actions';
      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.title = 'Editar grupo';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mostrarModalGrupo(true, g);
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑';
      deleteBtn.title = 'Eliminar grupo';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar el grupo "${g.nombre}"? Los propietarios de este grupo quedarán sin grupo asignado.`)) return;
        try {
          await api.deleteGrupo(g.id);
          await cargarGruposPropietarios();
          await cargarGruposParaDeudas();
          cargarPropietarios(g.id === grupoPropSeleccionado ? null : grupoPropSeleccionado);
        } catch (err) {
          alert('Error al eliminar grupo: ' + err.message);
        }
      });
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);
      tabDiv.appendChild(btn);
      tabDiv.appendChild(actionsDiv);
      container.appendChild(tabDiv);
    }
    if (grupoPropSeleccionado === undefined && (grupos.length > 0 || container.children.length > 0)) {
      seleccionarGrupoPropietarios(null);
    }
  } catch (err) {
    console.error('Error cargando grupos propietarios:', err);
  }
}

async function seleccionarGrupoPropietarios(grupoId) {
  grupoPropSeleccionado = grupoId;
  const tabs = document.querySelectorAll('#gruposPropContainer .group-tab');
  const gruposList = await api.getGrupos();
  tabs.forEach(tab => {
    const btn = tab.querySelector('button');
    const isSinGrupo = btn.textContent === 'Sin grupo';
    if (isSinGrupo && grupoId === null) {
      tab.style.backgroundColor = '#007bff';
    } else if (!isSinGrupo) {
      const g = gruposList.find(g => g.nombre === btn.textContent);
      if (g && g.id === grupoId) {
        tab.style.backgroundColor = '#007bff';
      } else {
        tab.style.backgroundColor = '#6c757d';
      }
    } else {
      tab.style.backgroundColor = '#6c757d';
    }
  });
  cargarPropietarios(grupoId);
}

async function cargarPropietarios(grupoId = null) {
  const tbody = document.querySelector('#tablaPropietarios tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="8">Cargando...<\/td>';
  try {
    const todos = await api.getPropietariosConSaldo();
    let props = todos;
    if (grupoId !== null && grupoId !== undefined) {
      props = todos.filter(p => p.grupo_id === grupoId);
    } else if (grupoId === null) {
      props = todos.filter(p => p.grupo_id === null);
    }
    propietarios = props;
    tbody.innerHTML = '';
    for (const p of props) {
      const usuario = await api.getUsuarioByPropietarioId(p.id);
      const esSaldoAFavor = p.saldo_neto >= 0;
      const saldoTexto = esSaldoAFavor ? `$${p.saldo_neto.toFixed(2)}` : `-$${Math.abs(p.saldo_neto).toFixed(2)}`;
      const saldoClase = esSaldoAFavor ? 'saldo-favor' : 'saldo-deuda';
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${p.id}</td>
          <td>${p.apartamento}</td>
          <td>${p.nombre}</td>
          <td>${p.telefono || ''}</td>
          <td>${p.email || ''}</td>
          <td>${usuario ? usuario.username : '—'}</td>
        <td class="${saldoClase}">${saldoTexto}</td>
          <td>
          <button onclick="editarPropietario(${p.id})">Editar</button>
          <button onclick="eliminarPropietario(${p.id})">Eliminar</button>
          </td>
      `;
      tbody.appendChild(tr);
    }
    document.getElementById('propietariosTableContainer').style.display = 'block';
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="8">Error: ${err.message}<\/td>`;
  }
}

window.editarPropietario = async (id) => {
  const prop = propietarios.find(p => p.id === id);
  if (!prop) return;
  await cargarGruposSelect();
  const modal = document.getElementById('modalPropietario');
  document.getElementById('modalTitulo').textContent = 'Editar Propietario';
  document.getElementById('propietarioId').value = prop.id;
  document.getElementById('apartamento').value = prop.apartamento;
  document.getElementById('nombre').value = prop.nombre;
  document.getElementById('telefono').value = prop.telefono || '';
  document.getElementById('email').value = prop.email || '';
  document.getElementById('grupoSelect').value = prop.grupo_id || '';
  const usuario = await api.getUsuarioByPropietarioId(id);
  document.getElementById('username').value = usuario ? usuario.username : '';
  document.getElementById('password').value = '';
  document.getElementById('credencialesGeneradas').style.display = 'none';
  modal.style.display = 'block';
};

window.eliminarPropietario = async (id) => {
  if (confirm('¿Eliminar propietario? Se eliminarán también su usuario y pagos asociados.')) {
    try {
      await api.deletePropietario(id);
      cargarPropietarios(grupoPropSeleccionado);
      if (propiedadSeleccionada === id) {
        propiedadSeleccionada = null;
        document.getElementById('deudasTableContainer').style.display = 'none';
      }
      cargarPagosPendientes();
      cargarGruposParaDeudas();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }
};

// Modal propietario
const modalProp = document.getElementById('modalPropietario');
const btnNuevoProp = document.getElementById('nuevoPropietarioBtn');
const spanCloseProp = document.querySelector('#modalPropietario .close');
const formProp = document.getElementById('formPropietario');
const credencialesDiv = document.getElementById('credencialesGeneradas');
const nuevoUsernameSpan = document.getElementById('nuevoUsername');
const nuevoPasswordSpan = document.getElementById('nuevoPassword');

async function cargarGruposSelect() {
  try {
    const gruposList = await api.getGrupos();
    const select = document.getElementById('grupoSelect');
    if (!select) return;
    select.innerHTML = '<option value="">Sin grupo</option>' +
      gruposList.map(g => `<option value="${g.id}">${g.nombre}</option>`).join('');
  } catch (err) {
    console.error('Error cargando grupos para select:', err);
  }
}

btnNuevoProp.addEventListener('click', async () => {
  await cargarGruposSelect();
  if (grupoPropSeleccionado) {
    document.getElementById('grupoSelect').value = grupoPropSeleccionado;
  }
  document.getElementById('modalTitulo').textContent = 'Nuevo Propietario';
  document.getElementById('propietarioId').value = '';
  document.getElementById('apartamento').value = '';
  document.getElementById('nombre').value = '';
  document.getElementById('telefono').value = '';
  document.getElementById('email').value = '';
  document.getElementById('username').value = '';
  document.getElementById('password').value = '';
  credencialesDiv.style.display = 'none';
  modalProp.style.display = 'block';
});

spanCloseProp.addEventListener('click', () => modalProp.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalProp) modalProp.style.display = 'none';
});

formProp.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('propietarioId').value;
  let username = document.getElementById('username').value.trim();
  let password = document.getElementById('password').value;
  const apartamento = document.getElementById('apartamento').value;
  const nombre = document.getElementById('nombre').value;
  const telefono = document.getElementById('telefono').value;
  const email = document.getElementById('email').value;
  const grupo_id = document.getElementById('grupoSelect').value ? parseInt(document.getElementById('grupoSelect').value) : null;

  if (!apartamento || !nombre) {
    alert('Apartamento y nombre son obligatorios');
    return;
  }

  if (!id && await apartamentoExiste(apartamento)) {
    alert('El apartamento ya existe. Por favor ingrese uno diferente.');
    return;
  }
  if (id && await apartamentoExiste(apartamento, parseInt(id))) {
    alert('El apartamento ya existe. Por favor ingrese uno diferente.');
    return;
  }

  const propietario = { id: id ? parseInt(id) : null, apartamento, nombre, telefono, email, grupo_id };

  try {
    let usuarioCreado = false;
    let nuevoUsuario = null;

    if (id) {
      await api.updatePropietario(propietario);
      const usuarioExistente = await api.getUsuarioByPropietarioId(parseInt(id));
      if (usuarioExistente) {
        await api.actualizarUsuarioPropietario(parseInt(id), username, password || null);
      } else if (username && password) {
        await api.crearUsuarioPropietario(parseInt(id), username, password);
        nuevoUsuario = { username, password };
        usuarioCreado = true;
      }
    } else {
      if (!username) {
        const base = generarUsernameBase(apartamento);
        username = await generarUsernameUnico(base);
      } else {
        if (await usernameExiste(username)) {
          alert('El nombre de usuario ya existe. Elige otro o déjalo en blanco para generar uno automático.');
          return;
        }
      }
      if (!password) password = generarPassword();

      const nuevo = await api.addPropietario(propietario);
      await api.crearUsuarioPropietario(nuevo.id, username, password);
      nuevoUsuario = { username, password };
      usuarioCreado = true;
    }

    if (usuarioCreado && nuevoUsuario) {
      nuevoUsernameSpan.textContent = nuevoUsuario.username;
      nuevoPasswordSpan.textContent = nuevoUsuario.password;
      credencialesDiv.style.display = 'block';
    } else {
      credencialesDiv.style.display = 'none';
    }

    modalProp.style.display = 'none';
    cargarPropietarios(grupoPropSeleccionado);
    cargarGruposParaDeudas();
    if (propiedadSeleccionada) cargarDeudas(propiedadSeleccionada);
  } catch (err) {
    alert('Error al guardar: ' + err.message);
  }
});

// Grupos
const modalGrupo = document.getElementById('modalGrupo');
const btnNuevoGrupo = document.getElementById('nuevoGrupoBtn');
const spanCloseGrupo = document.querySelector('#modalGrupo .close');
const formGrupo = document.getElementById('formGrupo');
const grupoNombreInput = document.getElementById('grupoNombre');
const grupoIdInput = document.getElementById('grupoId');

let asignarPropietariosDiv = document.getElementById('asignarPropietariosContainer');
if (!asignarPropietariosDiv) {
  asignarPropietariosDiv = document.createElement('div');
  asignarPropietariosDiv.id = 'asignarPropietariosContainer';
  asignarPropietariosDiv.style.marginTop = '15px';
  asignarPropietariosDiv.style.borderTop = '1px solid #ccc';
  asignarPropietariosDiv.style.paddingTop = '10px';
  asignarPropietariosDiv.innerHTML = '<h4>Asignar propietarios a este grupo</h4><div id="listaPropietariosSinGrupo"></div><button id="btnAsignarPropietarios" style="margin-top:10px;">Asignar seleccionados</button>';
  modalGrupo.querySelector('.modal-content').appendChild(asignarPropietariosDiv);
}

const listaPropietariosSinGrupo = document.getElementById('listaPropietariosSinGrupo');
const btnAsignarPropietarios = document.getElementById('btnAsignarPropietarios');

async function cargarPropietariosSinGrupo() {
  const todos = await api.getPropietariosConSaldo();
  let sinGrupo = todos.filter(p => p.grupo_id === null);
  if (!listaPropietariosSinGrupo) return;
  listaPropietariosSinGrupo.innerHTML = '';
  if (sinGrupo.length === 0) {
    listaPropietariosSinGrupo.innerHTML = '<p>No hay propietarios sin grupo.</p>';
    if (btnAsignarPropietarios) btnAsignarPropietarios.disabled = true;
    return;
  }
  if (btnAsignarPropietarios) btnAsignarPropietarios.disabled = false;
  sinGrupo.forEach(p => {
    const label = document.createElement('label');
    label.style.display = 'block';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = p.id;
    cb.style.marginRight = '5px';
    label.appendChild(cb);
    label.appendChild(document.createTextNode(`${p.apartamento} - ${p.nombre}`));
    listaPropietariosSinGrupo.appendChild(label);
  });
}

function mostrarModalGrupo(editMode = false, grupo = null) {
  if (editMode && grupo) {
    grupoIdInput.value = grupo.id;
    grupoNombreInput.value = grupo.nombre;
    document.getElementById('modalGrupoTitulo').textContent = 'Editar Grupo';
    cargarPropietariosSinGrupo();
  } else {
    grupoIdInput.value = '';
    grupoNombreInput.value = '';
    document.getElementById('modalGrupoTitulo').textContent = 'Nuevo Grupo';
    if (listaPropietariosSinGrupo) listaPropietariosSinGrupo.innerHTML = '<p>Primero guarda el grupo para asignar propietarios.</p>';
    if (btnAsignarPropietarios) btnAsignarPropietarios.disabled = true;
  }
  modalGrupo.style.display = 'block';
  grupoNombreInput.focus();
}

btnNuevoGrupo.addEventListener('click', () => mostrarModalGrupo(false));
spanCloseGrupo.addEventListener('click', () => modalGrupo.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalGrupo) modalGrupo.style.display = 'none';
});

if (btnAsignarPropietarios) {
  btnAsignarPropietarios.addEventListener('click', async () => {
    const grupoId = grupoIdInput.value;
    if (!grupoId) {
      alert('Primero guarda el grupo para asignar propietarios.');
      return;
    }
    const checkboxes = document.querySelectorAll('#listaPropietariosSinGrupo input[type="checkbox"]:checked');
    const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));
    if (ids.length === 0) {
      alert('No hay propietarios seleccionados.');
      return;
    }
    try {
      await api.asignarPropietariosAGrupo(ids, parseInt(grupoId));
      alert(`${ids.length} propietario(s) asignado(s) al grupo.`);
      await cargarPropietariosSinGrupo();
      cargarPropietarios(grupoPropSeleccionado);
      cargarGruposParaDeudas();
      if (modalGrupo.style.display === 'block') {
        await cargarPropietariosSinGrupo();
      }
    } catch (err) {
      alert('Error al asignar: ' + err.message);
    }
  });
}

formGrupo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = grupoIdInput.value;
  const nombre = grupoNombreInput.value.trim();
  if (!nombre) {
    alert('El nombre del grupo es obligatorio');
    return;
  }
  try {
    if (id) {
      await api.updateGrupo(parseInt(id), nombre);
    } else {
      await api.addGrupo(nombre);
    }
    modalGrupo.style.display = 'none';
    await cargarGruposPropietarios();
    await cargarGruposParaDeudas();
    cargarPropietarios(grupoPropSeleccionado);
  } catch (err) {
    alert('Error al guardar grupo: ' + err.message);
  }
});

// Recibos existentes
async function cargarRecibos() {
  const tbody = document.querySelector('#tablaRecibos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="4">Cargando...<\/td>';
  try {
    recibos = await api.getRecibos();
    tbody.innerHTML = '';
    for (const r of recibos) {
      const grupo = grupos.find(g => g.id === r.grupo_id);
      const grupoNombre = grupo ? grupo.nombre : 'Todos';
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${r.periodo}</td>
          <td>$${r.monto_usd.toFixed(2)}</td>
          <td>${grupoNombre}</td>
          <td><button onclick="eliminarRecibo(${r.id})">Eliminar</button></td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="4">Error: ${err.message}<\/td>`;
  }
}

window.eliminarRecibo = async (id) => {
  if (confirm('¿Eliminar este recibo? Se eliminará el recibo, pero las deudas generadas quedarán en el sistema.')) {
    try {
      await api.deleteRecibo(id);
      cargarRecibos();
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }
};

// Deudas, pagos, etc.
async function cargarGruposParaDeudas() {
  const container = document.getElementById('gruposContainer');
  if (!container) return;
  try {
    const gruposList = await api.getGrupos();
    container.innerHTML = '';

    const sinGrupoTab = document.createElement('div');
    sinGrupoTab.className = 'group-tab';
    sinGrupoTab.style.backgroundColor = (grupoSeleccionado === null) ? '#007bff' : '#6c757d';
    const sinGrupoBtn = document.createElement('button');
    sinGrupoBtn.textContent = 'Sin grupo';
    sinGrupoBtn.style.backgroundColor = 'transparent';
    sinGrupoBtn.addEventListener('click', () => seleccionarGrupoDeuda(null));
    sinGrupoTab.appendChild(sinGrupoBtn);
    container.appendChild(sinGrupoTab);

    for (const g of gruposList) {
      const tabDiv = document.createElement('div');
      tabDiv.className = 'group-tab';
      tabDiv.style.backgroundColor = (grupoSeleccionado === g.id) ? '#007bff' : '#6c757d';
      const btn = document.createElement('button');
      btn.textContent = g.nombre;
      btn.style.backgroundColor = 'transparent';
      btn.addEventListener('click', () => seleccionarGrupoDeuda(g.id));
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'group-actions';
      const editBtn = document.createElement('button');
      editBtn.textContent = '✎';
      editBtn.title = 'Editar grupo';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        mostrarModalGrupo(true, g);
      });
      const deleteBtn = document.createElement('button');
      deleteBtn.textContent = '🗑';
      deleteBtn.title = 'Eliminar grupo';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm(`¿Eliminar el grupo "${g.nombre}"? Los propietarios de este grupo quedarán sin grupo asignado.`)) return;
        try {
          await api.deleteGrupo(g.id);
          await cargarGruposPropietarios();
          await cargarGruposParaDeudas();
          if (propiedadSeleccionada) cargarDeudas(propiedadSeleccionada);
        } catch (err) {
          alert('Error al eliminar grupo: ' + err.message);
        }
      });
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);
      tabDiv.appendChild(btn);
      tabDiv.appendChild(actionsDiv);
      container.appendChild(tabDiv);
    }
    if (!grupoSeleccionado && (gruposList.length > 0 || true)) {
      seleccionarGrupoDeuda(null);
    }
  } catch (err) {
    console.error(err);
  }
}

async function seleccionarGrupoDeuda(grupoId) {
  grupoSeleccionado = grupoId;
  const tabs = document.querySelectorAll('#gruposContainer .group-tab');
  const gruposList = await api.getGrupos();
  tabs.forEach(tab => {
    const btn = tab.querySelector('button');
    const isSinGrupo = btn.textContent === 'Sin grupo';
    if (isSinGrupo && grupoId === null) {
      tab.style.backgroundColor = '#007bff';
    } else if (!isSinGrupo) {
      const g = gruposList.find(g => g.nombre === btn.textContent);
      if (g && g.id === grupoId) {
        tab.style.backgroundColor = '#007bff';
      } else {
        tab.style.backgroundColor = '#6c757d';
      }
    } else {
      tab.style.backgroundColor = '#6c757d';
    }
  });
  await cargarPropiedadesDeuda(grupoId);
}

async function cargarPropiedadesDeuda(grupoId) {
  const container = document.getElementById('propiedadesContainer');
  if (!container) return;
  container.innerHTML = '';
  try {
    const props = await api.getPropietarios();
    let propsGrupo;
    if (grupoId === null) {
      propsGrupo = props.filter(p => p.grupo_id === null);
    } else {
      propsGrupo = props.filter(p => p.grupo_id === grupoId);
    }
    if (propsGrupo.length === 0) {
      container.innerHTML = '<p>No hay propiedades en este grupo. Agrega propietarios y asígnalos a este grupo.</p>';
      document.getElementById('deudasTableContainer').style.display = 'none';
      return;
    }
    for (let i = 0; i < propsGrupo.length; i += 4) {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.gap = '5px';
      row.style.marginBottom = '5px';
      row.style.flexWrap = 'wrap';
      for (let j = i; j < Math.min(i+4, propsGrupo.length); j++) {
        const prop = propsGrupo[j];
        const btn = document.createElement('button');
        btn.textContent = prop.apartamento;
        btn.style.backgroundColor = '#6c757d';
        btn.style.padding = '5px 10px';
        btn.style.cursor = 'pointer';
        btn.addEventListener('click', () => seleccionarPropiedadDeuda(prop.id));
        row.appendChild(btn);
      }
      container.appendChild(row);
    }
    if (propiedadSeleccionada && propsGrupo.some(p => p.id === propiedadSeleccionada)) {
      const selectedProp = propsGrupo.find(p => p.id === propiedadSeleccionada);
      document.querySelectorAll('#propiedadesContainer button').forEach(btn => {
        if (btn.textContent === selectedProp.apartamento) btn.style.backgroundColor = '#007bff';
      });
    } else if (propsGrupo.length > 0) {
      seleccionarPropiedadDeuda(propsGrupo[0].id);
    }
  } catch (err) {
    console.error(err);
  }
}

async function actualizarSaldoPropietario(propietarioId) {
  try {
    const prop = await api.getPropietarioById(propietarioId);
    if (!prop) return;
    const deudas = await api.getDeudasByPropietario(propietarioId);
    const totalDeudas = deudas.reduce((sum, d) => sum + (d.pagado ? 0 : d.monto_usd), 0);
    const saldoNeto = (prop.saldo_favor || 0) - totalDeudas;
    const esSaldoAFavor = saldoNeto >= 0;
    const saldoTexto = esSaldoAFavor ? `$${saldoNeto.toFixed(2)} (Saldo a favor)` : `-$${Math.abs(saldoNeto).toFixed(2)} (Deuda pendiente)`;
    const saldoElement = document.getElementById('saldoNetoPropiedad');
    if (saldoElement) {
      saldoElement.textContent = saldoTexto;
      saldoElement.style.color = esSaldoAFavor ? 'green' : 'red';
    }
  } catch (err) {
    console.error('Error al obtener saldo de la propiedad:', err);
  }
}

async function seleccionarPropiedadDeuda(propId) {
  propiedadSeleccionada = propId;
  const btns = document.querySelectorAll('#propiedadesContainer button');
  const props = await api.getPropietarios();
  const prop = props.find(p => p.id === propId);
  btns.forEach(btn => {
    if (btn.textContent === prop.apartamento) btn.style.backgroundColor = '#007bff';
    else btn.style.backgroundColor = '#6c757d';
  });
  await cargarDeudas(propId);
  await actualizarSaldoPropietario(propId);
  document.getElementById('deudasTableContainer').style.display = 'block';
}

async function cargarDeudas(propietarioId) {
  const tbody = document.querySelector('#tablaDeudas tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="7">Cargando...<\/td>';
  try {
    const deudas = await api.getDeudasByPropietario(propietarioId);
    deudasGlobal = deudas;
    tbody.innerHTML = '';
    if (deudas.length === 0) {
      tbody.innerHTML = '<td colspan="7">No hay deudas registradas para esta propiedad.<\/td>';
      return;
    }
    for (const d of deudas) {
      const isPaid = d.pagado === 1;
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${d.periodo}</td>
          <td>$${d.monto_usd.toFixed(2)}</td>
          <td>${d.fecha_vencimiento || '—'}</td>
        <td class="${isPaid ? 'verificado' : 'pendiente'}">${isPaid ? 'Pagada' : 'Pendiente'}</td>
          <td>${d.fecha_pago || '—'}</td>
          <td>${d.referencia_pago || '—'}</td>
          <td>
          <button onclick="editarDeuda(${d.id})">Editar</button>
          <button onclick="eliminarDeuda(${d.id})">Eliminar</button>
          </td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="7">Error: ${err.message}<\/td>`;
  }
}

// Modal de deuda
const modalDeuda = document.getElementById('modalDeuda');
const btnAgregarDeuda = document.getElementById('btnAgregarDeuda');
const spanCloseDeuda = document.querySelector('#modalDeuda .close');
const formDeuda = document.getElementById('formDeuda');
const propietarioSelect = document.getElementById('propietarioSelect');

btnAgregarDeuda.addEventListener('click', async () => {
  if (!propiedadSeleccionada) {
    alert('Primero selecciona una propiedad');
    return;
  }
  const props = await api.getPropietarios();
  propietarioSelect.innerHTML = '<option value="">Seleccionar</option>' +
    props.map(p => `<option value="${p.id}" ${p.id === propiedadSeleccionada ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');
  document.getElementById('deudaId').value = '';
  document.getElementById('periodo').value = '';
  document.getElementById('montoUSD').value = '';
  document.getElementById('fechaVencimiento').value = '';
  document.getElementById('modalDeudaTitulo').textContent = 'Agregar Deuda';
  modalDeuda.style.display = 'block';
});

spanCloseDeuda.addEventListener('click', () => modalDeuda.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalDeuda) modalDeuda.style.display = 'none';
});

formDeuda.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('deudaId').value;
  const propietario_id = parseInt(propietarioSelect.value);
  const periodo = document.getElementById('periodo').value;
  const monto_usd = parseFloat(document.getElementById('montoUSD').value);
  const fecha_vencimiento = document.getElementById('fechaVencimiento').value || null;

  if (!propietario_id || !periodo || isNaN(monto_usd) || monto_usd <= 0) {
    alert('Propietario, período y monto válido son obligatorios');
    return;
  }

  try {
    if (id) {
      await api.updateDeuda({ id: parseInt(id), periodo, monto_usd, fecha_vencimiento });
    } else {
      await api.addDeuda({ propietario_id, periodo, monto_usd, fecha_vencimiento });
    }
    modalDeuda.style.display = 'none';
    if (propiedadSeleccionada === propietario_id) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    } else if (!propiedadSeleccionada) {
      cargarDeudas();
    }
  } catch (err) {
    alert('Error al guardar deuda: ' + err.message);
  }
});

window.editarDeuda = async (id) => {
  const deuda = deudasGlobal.find(d => d.id === id);
  if (!deuda) return;
  const props = await api.getPropietarios();
  propietarioSelect.innerHTML = '<option value="">Seleccionar</option>' +
    props.map(p => `<option value="${p.id}" ${p.id === deuda.propietario_id ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');
  document.getElementById('deudaId').value = deuda.id;
  document.getElementById('periodo').value = deuda.periodo;
  document.getElementById('montoUSD').value = deuda.monto_usd;
  document.getElementById('fechaVencimiento').value = deuda.fecha_vencimiento || '';
  document.getElementById('modalDeudaTitulo').textContent = 'Editar Deuda';
  modalDeuda.style.display = 'block';
};

window.eliminarDeuda = async (id) => {
  if (confirm('¿Eliminar esta deuda?')) {
    try {
      await api.deleteDeuda(id);
      if (propiedadSeleccionada) {
        cargarDeudas(propiedadSeleccionada);
        await actualizarSaldoPropietario(propiedadSeleccionada);
      }
    } catch (err) {
      alert('Error al eliminar: ' + err.message);
    }
  }
};

// Pagos pendientes
async function cargarPagosPendientes() {
  const tbody = document.querySelector('#tablaPagos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...<\/td>';
  try {
    const pagos = await api.getPagosPendientes();
    tbody.innerHTML = '';
    pagos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${p.propietario_nombre} (${p.apartamento})</td>
          <td>${p.fecha_pago || '—'}</td>
          <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
          <td>${p.referencia || '—'}</td>
          <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
          <td><button class="btn-verificar" onclick="verificarPago(${p.id})">Verificar</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="6">Error: ${err.message}<\/td>`;
  }
}

window.verificarPago = async (pagoId) => {
  try {
    await api.verificarPago(pagoId);
    alert('Pago verificado correctamente');
    cargarPagosPendientes();
    if (propiedadSeleccionada) {
      cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
  } catch (err) {
    alert('Error al verificar: ' + err.message);
  }
};

// Importar CSV
const modalImportar = document.getElementById('modalImportar');
const btnImportar = document.getElementById('importarPropietariosBtn');
const spanCloseImportar = document.querySelector('#modalImportar .close');
const csvFileInput = document.getElementById('csvFile');
const btnProcesarCSV = document.getElementById('procesarCSV');
const importProgress = document.getElementById('importProgress');

btnImportar.addEventListener('click', () => {
  csvFileInput.value = '';
  importProgress.innerHTML = '';
  modalImportar.style.display = 'block';
});

spanCloseImportar.addEventListener('click', () => modalImportar.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalImportar) modalImportar.style.display = 'none';
});

document.getElementById('descargarPlantilla').addEventListener('click', (e) => {
  e.preventDefault();
  const csvContent = "apartamento,nombre,telefono,email,grupo\nA-101,Juan Pérez,+584123456789,juan@ejemplo.com,Edificio 1\nA-102,María García,+584123456790,maria@ejemplo.com,Edificio 1\nC-1,Carlos López,+584123456791,carlos@ejemplo.com,Casa 1\n";
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.setAttribute('download', 'plantilla_propietarios.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
});

btnProcesarCSV.addEventListener('click', async () => {
  const file = csvFileInput.files[0];
  if (!file) {
    alert('Selecciona un archivo CSV');
    return;
  }

  importProgress.innerHTML = '<p>Procesando archivo...</p>';
  btnProcesarCSV.disabled = true;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    complete: async function(results) {
      const rows = results.data;
      if (rows.length === 0) {
        importProgress.innerHTML = '<p>No se encontraron datos en el archivo.</p>';
        btnProcesarCSV.disabled = false;
        return;
      }

      const requiredColumns = ['apartamento', 'nombre'];
      const missingColumns = requiredColumns.filter(col => !results.meta.fields.includes(col));
      if (missingColumns.length) {
        importProgress.innerHTML = `<p style="color:red;">Error: El archivo debe contener las columnas: ${requiredColumns.join(', ')}. Faltan: ${missingColumns.join(', ')}</p>`;
        btnProcesarCSV.disabled = false;
        return;
      }

      let gruposMap = new Map();
      let createdGroups = [];
      let createdOwners = 0;
      let errors = [];

      const gruposExistentes = await api.getGrupos();
      gruposExistentes.forEach(g => gruposMap.set(g.nombre, g.id));

      const propietariosExistentes = await api.getPropietarios();
      const apartamentosExistentes = new Set(propietariosExistentes.map(p => p.apartamento));

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const apartamento = row.apartamento?.trim();
        const nombre = row.nombre?.trim();
        if (!apartamento || !nombre) {
          errors.push(`Fila ${i+2}: apartamento y nombre son obligatorios.`);
          continue;
        }

        if (apartamentosExistentes.has(apartamento)) {
          errors.push(`Fila ${i+2}: El apartamento "${apartamento}" ya existe. Se omite.`);
          continue;
        }

        let grupoId = null;
        const grupoNombre = row.grupo?.trim();
        if (grupoNombre) {
          if (gruposMap.has(grupoNombre)) {
            grupoId = gruposMap.get(grupoNombre);
          } else {
            try {
              const nuevoGrupo = await api.addGrupo(grupoNombre);
              grupoId = nuevoGrupo.id;
              gruposMap.set(grupoNombre, grupoId);
              createdGroups.push(grupoNombre);
            } catch (err) {
              errors.push(`Fila ${i+2}: Error al crear grupo "${grupoNombre}": ${err.message}`);
              continue;
            }
          }
        }

        const telefono = row.telefono?.trim() || '';
        const email = row.email?.trim() || '';

        const propietarioData = {
          apartamento,
          nombre,
          telefono,
          email,
          grupo_id: grupoId
        };

        try {
          const nuevoProp = await api.addPropietario(propietarioData);

          let username = row.usuario?.trim();
          let password = row.password?.trim();
          if (!username) {
            username = apartamento.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '');
            let base = username;
            let cont = 1;
            while (await usernameExiste(username)) {
              username = base + cont;
              cont++;
            }
          }
          if (!password) {
            password = generarPassword(8);
          }

          await api.crearUsuarioPropietario(nuevoProp.id, username, password);
          createdOwners++;
          apartamentosExistentes.add(apartamento);
        } catch (err) {
          errors.push(`Fila ${i+2}: Error al crear propietario "${apartamento}": ${err.message}`);
        }
      }

      let msg = `<p>✅ Importación finalizada.</p>`;
      msg += `<p>Propietarios creados: ${createdOwners}</p>`;
      if (createdGroups.length) msg += `<p>Grupos creados: ${createdGroups.join(', ')}</p>`;
      if (errors.length) {
        msg += `<p style="color:orange;">⚠️ Errores (${errors.length}):</p><ul>${errors.map(e => `<li>${e}</li>`).join('')}</ul>`;
      }
      importProgress.innerHTML = msg;

      await cargarGruposPropietarios();
      await cargarGruposParaDeudas();
      cargarPropietarios(grupoPropSeleccionado);
      cargarPagosPendientes();

      btnProcesarCSV.disabled = false;
    },
    error: function(error) {
      importProgress.innerHTML = `<p style="color:red;">Error al leer el archivo: ${error.message}</p>`;
      btnProcesarCSV.disabled = false;
    }
  });
});

// Gestión de usuarios
const modalUsuarios = document.getElementById('modalUsuarios');
const btnGestionarUsuarios = document.getElementById('gestionarUsuariosBtn');
const spanCloseUsuarios = document.querySelector('#modalUsuarios .close');
const tablaUsuarios = document.getElementById('tablaUsuarios');
const editForm = document.getElementById('editarUsuarioForm');
const editUserId = document.getElementById('editUserId');
const editUsername = document.getElementById('editUsername');
const editPassword = document.getElementById('editPassword');
const guardarUsuarioBtn = document.getElementById('guardarUsuarioBtn');
const cancelarEdicionBtn = document.getElementById('cancelarEdicionBtn');

let usuariosActuales = [];

btnGestionarUsuarios.addEventListener('click', async () => {
  await cargarUsuarios();
  modalUsuarios.style.display = 'block';
});

spanCloseUsuarios.addEventListener('click', () => {
  modalUsuarios.style.display = 'none';
  editForm.style.display = 'none';
});

window.addEventListener('click', (e) => {
  if (e.target === modalUsuarios) {
    modalUsuarios.style.display = 'none';
    editForm.style.display = 'none';
  }
});

async function cargarUsuarios() {
  const tbody = tablaUsuarios.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="6">Cargando...<\/td>';
  try {
    usuariosActuales = await api.getAllUsers();
    tbody.innerHTML = '';
    for (const u of usuariosActuales) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${u.id}</td>
          <td>${u.username}</td>
          <td>${u.propietario_nombre || '—'}</td>
          <td>${u.apartamento || '—'}</td>
          <td>${u.rol}</td>
          <td>
          <button onclick="editarUsuario(${u.id})">Editar</button>
          <button onclick="eliminarUsuario(${u.id})" ${u.username === 'admin' ? 'disabled' : ''}>Eliminar</button>
          </td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="6">Error: ${err.message}<\/td>`;
  }
}

window.editarUsuario = (userId) => {
  const user = usuariosActuales.find(u => u.id === userId);
  if (!user) return;
  editUserId.value = user.id;
  editUsername.value = user.username;
  editPassword.value = '';
  editForm.style.display = 'block';
};

guardarUsuarioBtn.addEventListener('click', async () => {
  const userId = parseInt(editUserId.value);
  const newUsername = editUsername.value.trim();
  const newPassword = editPassword.value;

  if (!newUsername && !newPassword) {
    alert('Debe proporcionar al menos un nuevo nombre de usuario o contraseña.');
    return;
  }

  try {
    await api.updateUser(userId, newUsername || null, newPassword || null);
    alert('Usuario actualizado correctamente');
    await cargarUsuarios();
    editForm.style.display = 'none';
    editUsername.value = '';
    editPassword.value = '';
  } catch (err) {
    alert('Error al actualizar: ' + err.message);
  }
});

cancelarEdicionBtn.addEventListener('click', () => {
  editForm.style.display = 'none';
  editUsername.value = '';
  editPassword.value = '';
});

window.eliminarUsuario = async (userId) => {
  const user = usuariosActuales.find(u => u.id === userId);
  if (!user) return;
  if (user.username === 'admin') {
    alert('No se puede eliminar el usuario administrador.');
    return;
  }
  if (!confirm(`¿Eliminar el usuario "${user.username}"?`)) return;
  try {
    await api.deleteUser(userId);
    alert('Usuario eliminado');
    await cargarUsuarios();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
};

// Logout
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/login.html';
});

// Inicialización
document.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('token')) {
    window.location.href = '/login.html';
    return;
  }
  try {
    await api.getGrupos();
  } catch (err) {
    return;
  }
  await cargarGruposPropietarios();
  await cargarGruposParaDeudas();
  await cargarRecibos();
  cargarPagosPendientes();
  obtenerTasaBCV();
});
