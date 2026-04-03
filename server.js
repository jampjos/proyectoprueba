// server.js - PostgreSQL version for Render
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load } = require('cheerio');
const https = require('https');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mi_secreto_local';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

async function obtenerTasaBCV() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'gzip, deflate, br' },
      rejectUnauthorized: false
    };
    https.request(options, res => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);
        if (res.headers['content-encoding'] === 'gzip') buffer = zlib.gunzipSync(buffer);
        const html = buffer.toString();
        const $ = load(html);
        const tasaText = $('#dolar strong').first().text().trim();
        const tasa = parseFloat(tasaText.replace(',', '.'));
        if (isNaN(tasa)) reject(new Error('No se pudo obtener tasa'));
        else resolve({ tasa, fecha: new Date().toISOString() });
      });
    }).on('error', reject).end();
  });
}

// Helper para añadir columnas si no existen
async function addColumnIfNotExists(tableName, columnName, columnType) {
  const res = await pool.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [tableName, columnName]
  );
  if (res.rows.length === 0) {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
    console.log(`✅ Columna ${columnName} agregada a ${tableName}`);
  }
}

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS grupos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS propietarios (
      id SERIAL PRIMARY KEY,
      apartamento TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
      saldo_favor REAL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT DEFAULT 'propietario',
      propietario_id INTEGER REFERENCES propietarios(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS deudas (
      id SERIAL PRIMARY KEY,
      propietario_id INTEGER REFERENCES propietarios(id) ON DELETE CASCADE,
      periodo TEXT NOT NULL,
      monto_usd REAL NOT NULL,
      fecha_vencimiento TEXT,
      pagado INTEGER DEFAULT 0,
      fecha_pago TEXT,
      referencia_pago TEXT,
      original_monto REAL
    );
    CREATE TABLE IF NOT EXISTS pagos (
      id SERIAL PRIMARY KEY,
      propietario_id INTEGER REFERENCES propietarios(id) ON DELETE CASCADE,
      fecha_pago TEXT NOT NULL,
      monto_bs REAL NOT NULL,
      tasa_bcv REAL NOT NULL,
      monto_usd REAL,
      referencia TEXT,
      imagen_ruta TEXT,
      estado TEXT DEFAULT 'pendiente',
      fecha_verificacion TEXT,
      fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS recibos (
      id SERIAL PRIMARY KEY,
      periodo TEXT NOT NULL,
      monto_usd REAL NOT NULL,
      grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Agregar columnas faltantes (PostgreSQL)
  await addColumnIfNotExists('deudas', 'recibo_id', 'INTEGER');
  await addColumnIfNotExists('deudas', 'porcentaje_alicuota', 'REAL');
  await addColumnIfNotExists('recibos', 'gastos_generales', 'JSONB');
  await addColumnIfNotExists('recibos', 'alicuotas_grupo', 'JSONB');
  await addColumnIfNotExists('recibos', 'gastos_especificos', 'JSONB');
  await addColumnIfNotExists('recibos', 'tasa_bcv', 'REAL');
  await addColumnIfNotExists('recibos', 'fecha_tasa', 'TEXT');

  // Verificar usuario admin
  const admin = await pool.query("SELECT id FROM usuarios WHERE username = 'admin'");
  if (admin.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query("INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)", ['admin', hash, 'master']);
    console.log('Usuario admin: admin / admin123');
  }
}

// Inicializar base de datos
setupDatabase().catch(console.error);

// ---------- RUTAS API ----------
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
  if (user.rows.length === 0) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
  if (bcrypt.compareSync(password, user.rows[0].password)) {
    const token = jwt.sign(
      { id: user.rows[0].id, rol: user.rows[0].rol, propietario_id: user.rows[0].propietario_id, usuario_id: user.rows[0].id },
      JWT_SECRET,
      { expiresIn: '1d' }
    );
    res.json({ success: true, token, rol: user.rows[0].rol, propietario_id: user.rows[0].propietario_id, usuario_id: user.rows[0].id });
  } else {
    res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
  }
});

app.post('/api/auth/logout', (req, res) => res.json({ success: true }));

app.get('/api/tasa-bcv', async (req, res) => {
  try {
    const tasa = await obtenerTasaBCV();
    res.json(tasa);
  } catch { res.status(500).json({ error: 'Error al obtener tasa BCV' }); }
});

app.get('/api/grupos', authenticateToken, async (req, res) => {
  const grupos = await pool.query('SELECT * FROM grupos ORDER BY nombre');
  res.json(grupos.rows);
});

app.post('/api/grupos', authenticateToken, async (req, res) => {
  const { nombre } = req.body;
  const result = await pool.query('INSERT INTO grupos (nombre) VALUES ($1) RETURNING id', [nombre]);
  res.json({ id: result.rows[0].id });
});

app.put('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  const result = await pool.query('UPDATE grupos SET nombre = $1 WHERE id = $2', [nombre, id]);
  res.json({ changes: result.rowCount });
});

app.delete('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  await pool.query('UPDATE propietarios SET grupo_id = NULL WHERE grupo_id = $1', [id]);
  const result = await pool.query('DELETE FROM grupos WHERE id = $1', [id]);
  res.json({ changes: result.rowCount });
});

app.get('/api/propietarios', authenticateToken, async (req, res) => {
  const propietarios = await pool.query('SELECT * FROM propietarios ORDER BY id');
  res.json(propietarios.rows);
});

app.get('/api/propietarios/saldo', authenticateToken, async (req, res) => {
  const rows = await pool.query(`
    SELECT p.*,
      COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0) as total_deuda,
      (p.saldo_favor - COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0)) as saldo_neto
    FROM propietarios p ORDER BY p.id
  `);
  res.json(rows.rows);
});

app.get('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const prop = await pool.query('SELECT * FROM propietarios WHERE id = $1', [req.params.id]);
  if (prop.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json(prop.rows[0]);
});

app.post('/api/propietarios', authenticateToken, async (req, res) => {
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO propietarios (apartamento, nombre, telefono, email, grupo_id, saldo_favor) VALUES ($1, $2, $3, $4, $5, 0) RETURNING id',
      [apartamento, nombre, telefono, email, grupo_id || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'El apartamento ya existe.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  const result = await pool.query(
    'UPDATE propietarios SET apartamento = $1, nombre = $2, telefono = $3, email = $4, grupo_id = $5 WHERE id = $6',
    [apartamento, nombre, telefono, email, grupo_id || null, id]
  );
  res.json({ changes: result.rowCount });
});

app.delete('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const result = await pool.query('DELETE FROM propietarios WHERE id = $1', [req.params.id]);
  res.json({ changes: result.rowCount });
});

// Usuario de propietario
app.get('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const user = await pool.query('SELECT * FROM usuarios WHERE propietario_id = $1', [req.params.id]);
  res.json(user.rows[0] || null);
});

app.post('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const result = await pool.query(
    'INSERT INTO usuarios (username, password, rol, propietario_id) VALUES ($1, $2, $3, $4) RETURNING id',
    [username, hash, 'propietario', req.params.id]
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { username, password } = req.body;
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE usuarios SET username = $1, password = $2 WHERE propietario_id = $3', [username, hash, req.params.id]);
  } else {
    await pool.query('UPDATE usuarios SET username = $1 WHERE propietario_id = $2', [username, req.params.id]);
  }
  res.json({ changes: 1 });
});

// Deudas por propietario
app.get('/api/propietarios/:id/deudas', authenticateToken, async (req, res) => {
  const deudas = await pool.query('SELECT * FROM deudas WHERE propietario_id = $1 ORDER BY periodo DESC', [req.params.id]);
  res.json(deudas.rows);
});

// Pagos por propietario
app.get('/api/propietarios/:id/pagos', authenticateToken, async (req, res) => {
  const pagos = await pool.query('SELECT * FROM pagos WHERE propietario_id = $1 ORDER BY fecha_registro DESC', [req.params.id]);
  res.json(pagos.rows);
});

// Recibos (listado)
app.get('/api/recibos', authenticateToken, async (req, res) => {
  const { grupoId } = req.query;
  let query = 'SELECT * FROM recibos';
  const params = [];
  if (grupoId) { query += ' WHERE grupo_id = $1'; params.push(grupoId); }
  query += ' ORDER BY periodo DESC';
  const recibos = await pool.query(query, params);
  res.json(recibos.rows);
});

// ========== RECIBOS: CREAR (GUARDA DETALLES) ==========
app.post('/api/recibos', authenticateToken, async (req, res) => {
  const { periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa } = req.body;
  const result = await pool.query(
    `INSERT INTO recibos (periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [periodo, monto_usd, grupo_id || null, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa]
  );
  res.json({ id: result.rows[0].id });
});

// ========== RECIBOS: OBTENER POR ID (CON DETALLES) ==========
app.get('/api/recibos/:id', authenticateToken, async (req, res) => {
  const recibo = await pool.query('SELECT * FROM recibos WHERE id = $1', [req.params.id]);
  if (recibo.rows.length === 0) return res.status(404).json({ error: 'Recibo no encontrado' });
  let reciboData = recibo.rows[0];
  // Parsear campos JSON (PostgreSQL los devuelve como objeto)
  if (reciboData.gastos_generales && typeof reciboData.gastos_generales === 'string') reciboData.gastos_generales = JSON.parse(reciboData.gastos_generales);
  if (reciboData.alicuotas_grupo && typeof reciboData.alicuotas_grupo === 'string') reciboData.alicuotas_grupo = JSON.parse(reciboData.alicuotas_grupo);
  if (reciboData.gastos_especificos && typeof reciboData.gastos_especificos === 'string') reciboData.gastos_especificos = JSON.parse(reciboData.gastos_especificos);
  reciboData.total_gastos_usd = reciboData.monto_usd;
  res.json(reciboData);
});

app.delete('/api/recibos/:id', authenticateToken, async (req, res) => {
  const result = await pool.query('DELETE FROM recibos WHERE id = $1', [req.params.id]);
  res.json({ changes: result.rowCount });
});

// Deudas (listado general)
app.get('/api/deudas', authenticateToken, async (req, res) => {
  const { propietarioId } = req.query;
  let query = 'SELECT * FROM deudas';
  const params = [];
  if (propietarioId) { query += ' WHERE propietario_id = $1'; params.push(propietarioId); }
  query += ' ORDER BY periodo DESC';
  const deudas = await pool.query(query, params);
  res.json(deudas.rows);
});

// Crear deuda (recibe recibo_id y porcentaje_alicuota)
app.post('/api/deudas', authenticateToken, async (req, res) => {
  const { propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota } = req.body;
  const result = await pool.query(
    `INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [propietario_id, periodo, monto_usd, fecha_vencimiento || null, recibo_id || null, porcentaje_alicuota || null]
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { periodo, monto_usd, fecha_vencimiento, pagado } = req.body;
  const result = await pool.query(
    'UPDATE deudas SET periodo = $1, monto_usd = $2, fecha_vencimiento = $3, pagado = $4 WHERE id = $5',
    [periodo, monto_usd, fecha_vencimiento || null, pagado, req.params.id]
  );
  res.json({ changes: result.rowCount });
});

app.delete('/api/deudas/:id', authenticateToken, async (req, res) => {
  const result = await pool.query('DELETE FROM deudas WHERE id = $1', [req.params.id]);
  res.json({ changes: result.rowCount });
});

// Pagos pendientes (para master)
app.get('/api/pagos/pendientes', authenticateToken, async (req, res) => {
  const pagos = await pool.query(`
    SELECT p.*, pr.nombre as propietario_nombre, pr.apartamento
    FROM pagos p JOIN propietarios pr ON p.propietario_id = pr.id
    WHERE p.estado = 'pendiente' ORDER BY p.fecha_registro DESC
  `);
  res.json(pagos.rows);
});

// ========== RUTAS PARA PAGOS DE PROPIETARIOS (CREAR, EDITAR, ELIMINAR) ==========
app.post('/api/pagos/propietario', authenticateToken, async (req, res) => {
  const { propietario_id, fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  if (!propietario_id || !fecha_pago || !monto_bs || !tasa_bcv || !referencia) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const monto_usd = monto_bs / tasa_bcv;
  const result = await pool.query(
    `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendiente') RETURNING id`,
    [propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia]
  );
  res.json({ id: result.rows[0].id });
});

app.put('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const pago = await pool.query('SELECT * FROM pagos WHERE id = $1', [id]);
  if (pago.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
  if (pago.rows[0].estado !== 'pendiente') {
    return res.status(400).json({ error: 'No se puede editar un pago ya verificado' });
  }
  const monto_usd = monto_bs / tasa_bcv;
  const result = await pool.query(
    `UPDATE pagos SET fecha_pago = $1, monto_bs = $2, tasa_bcv = $3, monto_usd = $4, referencia = $5 WHERE id = $6`,
    [fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, id]
  );
  res.json({ changes: result.rowCount });
});

app.delete('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const pago = await pool.query('SELECT * FROM pagos WHERE id = $1', [id]);
  if (pago.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
  if (pago.rows[0].estado !== 'pendiente') {
    return res.status(400).json({ error: 'No se puede eliminar un pago ya verificado' });
  }
  const result = await pool.query('DELETE FROM pagos WHERE id = $1', [id]);
  res.json({ changes: result.rowCount });
});

// Verificar pago (master)
app.post('/api/pagos/:id/verificar', authenticateToken, async (req, res) => {
  const pagoId = req.params.id;
  const pago = await pool.query('SELECT * FROM pagos WHERE id = $1', [pagoId]);
  if (pago.rows.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });
  const pagoData = pago.rows[0];
  if (pagoData.estado !== 'pendiente') return res.status(400).json({ error: 'Ya verificado' });
  let montoUSD = pagoData.monto_usd || (pagoData.monto_bs / pagoData.tasa_bcv);
  if (montoUSD <= 0) return res.status(400).json({ error: 'Monto inválido' });

  const deudas = await pool.query('SELECT * FROM deudas WHERE propietario_id = $1 AND pagado = 0 ORDER BY periodo', [pagoData.propietario_id]);
  let restante = montoUSD;
  for (const deuda of deudas.rows) {
    if (restante <= 0) break;
    if (restante >= deuda.monto_usd) {
      await pool.query(
        'UPDATE deudas SET pagado = 1, fecha_pago = $1, referencia_pago = $2, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $3',
        [pagoData.fecha_pago, pagoData.referencia, deuda.id]
      );
      restante -= deuda.monto_usd;
    } else {
      await pool.query(
        'UPDATE deudas SET monto_usd = $1, fecha_pago = $2, referencia_pago = $3, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $4',
        [deuda.monto_usd - restante, pagoData.fecha_pago, pagoData.referencia, deuda.id]
      );
      restante = 0;
    }
  }
  if (restante > 0) {
    await pool.query('UPDATE propietarios SET saldo_favor = saldo_favor + $1 WHERE id = $2', [restante, pagoData.propietario_id]);
  }
  await pool.query(
    'UPDATE pagos SET estado = $1, fecha_verificacion = CURRENT_TIMESTAMP, monto_usd = $2 WHERE id = $3',
    ['verificado', montoUSD, pagoId]
  );
  res.json({ changes: 1, saldo_favor: restante });
});

// Revertir pago
app.post('/api/pagos/:id/revertir', authenticateToken, async (req, res) => {
  const pagoId = req.params.id;
  const pago = await pool.query('SELECT * FROM pagos WHERE id = $1', [pagoId]);
  if (pago.rows.length === 0 || pago.rows[0].estado !== 'verificado') return res.status(400).json({ error: 'No se puede revertir' });
  const pagoData = pago.rows[0];
  const deudas = await pool.query(
    'SELECT id, monto_usd, original_monto FROM deudas WHERE propietario_id = $1 AND fecha_pago = $2 AND referencia_pago = $3',
    [pagoData.propietario_id, pagoData.fecha_pago, pagoData.referencia]
  );
  for (const deuda of deudas.rows) {
    const montoRest = deuda.original_monto || deuda.monto_usd;
    await pool.query(
      'UPDATE deudas SET pagado = 0, monto_usd = $1, fecha_pago = NULL, referencia_pago = NULL, original_monto = NULL WHERE id = $2',
      [montoRest, deuda.id]
    );
  }
  await pool.query('UPDATE propietarios SET saldo_favor = saldo_favor - $1 WHERE id = $2', [pagoData.monto_usd, pagoData.propietario_id]);
  await pool.query('UPDATE pagos SET estado = $1, fecha_verificacion = NULL WHERE id = $2', ['pendiente', pagoId]);
  res.json({ changes: 1 });
});

// Usuarios master
app.get('/api/usuarios/existe', authenticateToken, async (req, res) => {
  const user = await pool.query('SELECT id FROM usuarios WHERE username = $1', [req.query.username]);
  res.json({ exists: user.rows.length > 0 });
});

app.get('/api/usuarios', authenticateToken, async (req, res) => {
  const usuarios = await pool.query(`
    SELECT u.id, u.username, u.rol, u.propietario_id, p.nombre as propietario_nombre, p.apartamento
    FROM usuarios u LEFT JOIN propietarios p ON u.propietario_id = p.id ORDER BY u.id
  `);
  res.json(usuarios.rows);
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { username, password } = req.body;
  if (username && username.trim()) {
    const existing = await pool.query('SELECT id FROM usuarios WHERE username = $1 AND id != $2', [username, req.params.id]);
    if (existing.rows.length > 0) return res.status(400).json({ error: 'Username ya existe' });
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query('UPDATE usuarios SET username = $1, password = $2 WHERE id = $3', [username, hash, req.params.id]);
    } else {
      await pool.query('UPDATE usuarios SET username = $1 WHERE id = $2', [username, req.params.id]);
    }
  } else if (password) {
    const hash = bcrypt.hashSync(password, 10);
    await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, req.params.id]);
  }
  res.json({ changes: 1 });
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const user = await pool.query('SELECT username FROM usuarios WHERE id = $1', [req.params.id]);
  if (user.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
  if (user.rows[0].username === 'admin') return res.status(403).json({ error: 'No se puede eliminar admin' });
  const result = await pool.query('DELETE FROM usuarios WHERE id = $1', [req.params.id]);
  res.json({ changes: result.rowCount });
});

app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
  const hash = bcrypt.hashSync(req.body.nuevaPassword, 10);
  await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, req.params.id]);
  res.json({ changes: 1 });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor PostgreSQL en puerto ${PORT}`);
});