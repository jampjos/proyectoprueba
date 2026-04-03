// public/login.js
console.log('Login page loaded');

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('errorMsg');
  errorDiv.textContent = '';

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }) // <-- ¡esto faltaba!
    });
    const result = await response.json();
    if (result.success) {
      // Guardar token y datos en localStorage
      localStorage.setItem('token', result.token);
      localStorage.setItem('rol', result.rol);
      localStorage.setItem('propietarioId', result.propietario_id);
      localStorage.setItem('usuarioId', result.usuario_id);

      if (result.rol === 'master') {
        window.location.href = '/index.html';
      } else if (result.rol === 'propietario') {
        window.location.href = `/propietario.html?propietarioId=${result.propietario_id}&usuarioId=${result.usuario_id}`;
      }
    } else {
      errorDiv.textContent = result.message || 'Usuario o contraseña incorrectos';
    }
  } catch (err) {
    console.error(err);
    errorDiv.textContent = 'Error al conectar con el servidor';
  }
});