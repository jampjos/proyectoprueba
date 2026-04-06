// server.js - PostgreSQL version for Render (con asignación de propietarios a grupos)
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
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_muy_seguro_cambiar_en_produccion';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Configuración de PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors({ origin: FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));

// Middleware de autenticación
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.user = user;
    next();
  });
}

// Función para obtener tasa BCV
async function obtenerTasaBCV() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      rejectUnauthorized: false
    };
    const req = https.request(options, res => {
      let chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        let buffer = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        try {
          if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer);
          else if (encoding === 'deflate') buffer = zlib.inflateSync(buffer);
          else if (encoding === 'br') buffer = zlib.brotliDecompressSync(buffer);
          const html = buffer.toString('utf8');
          const $ = load(html);
          const tasaText = $('#dolar strong').first().text().trim();
          const tasa = parseFloat(tasaText.replace(',', '.'));
          if (isNaN(tasa)) reject(new Error('No se pudo obtener la tasa del BCV'));
          else resolve({ tasa, fecha: new Date().toISOString() });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------- Inicialización de tablas ----------
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
      original_monto REAL,
      recibo_id INTEGER,
      porcentaje_alicuota REAL
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
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      gastos_generales JSONB,
      alicuotas_grupo JSONB,
      gastos_especificos JSONB,
      tasa_bcv REAL,
      fecha_tasa TEXT
    );
  `);

  // Agregar columnas faltantes (si no existen)
  const addColumnIfNotExists = async (table, column, type) => {
    const res = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    `, [table, column]);
    if (res.rows.length === 0) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
      console.log(`✅ Columna ${column} agregada a ${table}`);
    }
  };
  await addColumnIfNotExists('deudas', 'recibo_id', 'INTEGER');
  await addColumnIfNotExists('deudas', 'porcentaje_alicuota', 'REAL');
  await addColumnIfNotExists('recibos', 'gastos_generales', 'JSONB');
  await addColumnIfNotExists('recibos', 'alicuotas_grupo', 'JSONB');
  await addColumnIfNotExists('recibos', 'gastos_especificos', 'JSONB');
  await addColumnIfNotExists('recibos', 'tasa_bcv', 'REAL');
  await addColumnIfNotExists('recibos', 'fecha_tasa', 'TEXT');

  // Limpiar referencias huérfanas: deudas con recibo_id que no existe
  const orphanResult = await pool.query(`
    UPDATE deudas 
    SET recibo_id = NULL 
    WHERE recibo_id IS NOT NULL 
      AND NOT EXISTS (SELECT 1 FROM recibos WHERE id = deudas.recibo_id)
  `);
  if (orphanResult.rowCount > 0) {
    console.log(`🧹 Se limpiaron ${orphanResult.rowCount} referencias huérfanas en deudas.recibo_id`);
  }

  // Crear usuario admin si no existe
  const admin = await pool.query("SELECT id FROM usuarios WHERE username = 'admin'");
  if (admin.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query("INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)", ['admin', hash, 'master']);
    console.log('✅ Usuario master creado: admin / admin123');
  }
}

// ---------- RUTAS ----------

// Autenticación
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    if (bcrypt.compareSync(password, user.password)) {
      const token = jwt.sign(
        { id: user.id, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id },
        JWT_SECRET,
        { expiresIn: '1d' }
      );
      res.json({ success: true, token, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id });
    } else {
      res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => res.json({ success: true }));

app.get('/api/tasa-bcv', async (req, res) => {
  try {
    const tasa = await obtenerTasaBCV();
    res.json(tasa);
  } catch { res.status(500).json({ error: 'No se pudo obtener la tasa BCV' }); }
});

// ---------- Grupos ----------
app.get('/api/grupos', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM grupos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/grupos', authenticateToken, async (req, res) => {
  const { nombre } = req.body;
  try {
    const result = await pool.query('INSERT INTO grupos (nombre) VALUES ($1) RETURNING id', [nombre]);
    res.json({ id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    const result = await pool.query('UPDATE grupos SET nombre = $1 WHERE id = $2', [nombre, id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE propietarios SET grupo_id = NULL WHERE grupo_id = $1', [id]);
    const result = await client.query('DELETE FROM grupos WHERE id = $1', [id]);
    await client.query('COMMIT');
    res.json({ changes: result.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// Asignar propietarios a grupo
app.post('/api/grupos/:id/asignar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere una lista de IDs de propietarios' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const propId of ids) {
      await client.query('UPDATE propietarios SET grupo_id = $1 WHERE id = $2', [id, propId]);
    }
    await client.query('COMMIT');
    res.json({ changes: ids.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

// ---------- Propietarios ----------
app.get('/api/propietarios', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM propietarios ORDER BY id');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/propietarios/saldo', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*,
        COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0) as total_deuda,
        (p.saldo_favor - COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0)) as saldo_neto
      FROM propietarios p ORDER BY p.id
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM propietarios WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    if (err.constraint === 'propietarios_apartamento_key') return res.status(400).json({ error: 'El apartamento ya existe.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    const result = await pool.query(
      'UPDATE propietarios SET apartamento = $1, nombre = $2, telefono = $3, email = $4, grupo_id = $5 WHERE id = $6',
      [apartamento, nombre, telefono, email, grupo_id || null, id]
    );
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM propietarios WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Usuario de propietario
app.get('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM usuarios WHERE propietario_id = $1', [id]);
    res.json(result.rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = await pool.query(
      'INSERT INTO usuarios (username, password, rol, propietario_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, 'propietario', id]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query('UPDATE usuarios SET username = $1, password = $2 WHERE propietario_id = $3', [username, hash, id]);
    } else {
      await pool.query('UPDATE usuarios SET username = $1 WHERE propietario_id = $2', [username, id]);
    }
    res.json({ changes: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deudas por propietario
app.get('/api/propietarios/:id/deudas', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM deudas WHERE propietario_id = $1 ORDER BY periodo DESC', [id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pagos por propietario
app.get('/api/propietarios/:id/pagos', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM pagos WHERE propietario_id = $1 ORDER BY fecha_registro DESC', [id]);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Recibos (listado)
app.get('/api/recibos', authenticateToken, async (req, res) => {
  const { grupoId } = req.query;
  try {
    let query = 'SELECT * FROM recibos';
    const params = [];
    if (grupoId) { query += ' WHERE grupo_id = $1'; params.push(grupoId); }
    query += ' ORDER BY periodo DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== CREAR RECIBO (GUARDA DETALLES) ==========
app.post('/api/recibos', authenticateToken, async (req, res) => {
  const { periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO recibos (periodo, monto_usd, grupo_id, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [periodo, monto_usd, grupo_id || null, gastos_generales, alicuotas_grupo, gastos_especificos, tasa_bcv, fecha_tasa]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== OBTENER RECIBO POR ID ==========
app.get('/api/recibos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM recibos WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Recibo no encontrado' });
    let recibo = result.rows[0];
    if (recibo.gastos_generales && typeof recibo.gastos_generales === 'string') recibo.gastos_generales = JSON.parse(recibo.gastos_generales);
    if (recibo.alicuotas_grupo && typeof recibo.alicuotas_grupo === 'string') recibo.alicuotas_grupo = JSON.parse(recibo.alicuotas_grupo);
    if (recibo.gastos_especificos && typeof recibo.gastos_especificos === 'string') recibo.gastos_especificos = JSON.parse(recibo.gastos_especificos);
    recibo.total_gastos_usd = recibo.monto_usd;
    res.json(recibo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== ELIMINAR RECIBO (con validación de deudas pendientes) ==========
app.delete('/api/recibos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    // Verificar si hay deudas NO PAGADAS asociadas a este recibo
    const deudasPendientes = await pool.query(
      'SELECT id FROM deudas WHERE recibo_id = $1 AND pagado = false',
      [id]
    );
    if (deudasPendientes.rows.length > 0) {
      return res.status(400).json({ 
        error: 'No se puede eliminar el recibo porque tiene deudas pendientes asociadas. Primero deben pagarse.' 
      });
    }
    // Si no hay deudas pendientes, se puede eliminar
    const result = await pool.query('DELETE FROM recibos WHERE id = $1', [id]);
    // Opcional: limpiar la referencia en las deudas (por si alguna quedó huérfana)
    await pool.query('UPDATE deudas SET recibo_id = NULL WHERE recibo_id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Deudas ----------
app.get('/api/deudas', authenticateToken, async (req, res) => {
  const { propietarioId } = req.query;
  try {
    let query = 'SELECT * FROM deudas';
    const params = [];
    if (propietarioId) { query += ' WHERE propietario_id = $1'; params.push(propietarioId); }
    query += ' ORDER BY periodo DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/deudas', authenticateToken, async (req, res) => {
  const { propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento, recibo_id, porcentaje_alicuota)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [propietario_id, periodo, monto_usd, fecha_vencimiento || null, recibo_id || null, porcentaje_alicuota || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { periodo, monto_usd, fecha_vencimiento, pagado } = req.body;
  try {
    const result = await pool.query(
      'UPDATE deudas SET periodo = $1, monto_usd = $2, fecha_vencimiento = $3, pagado = $4 WHERE id = $5',
      [periodo, monto_usd, fecha_vencimiento || null, pagado, id]
    );
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM deudas WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Pagos ----------
app.get('/api/pagos/pendientes', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, pr.nombre as propietario_nombre, pr.apartamento
      FROM pagos p JOIN propietarios pr ON p.propietario_id = pr.id
      WHERE p.estado = 'pendiente' ORDER BY p.fecha_registro DESC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/pagos/:id/verificar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pagoRes = await client.query('SELECT * FROM pagos WHERE id = $1', [id]);
    const pago = pagoRes.rows[0];
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado !== 'pendiente') throw new Error('Ya verificado');

    let montoUSD = pago.monto_usd || (pago.monto_bs / pago.tasa_bcv);
    if (montoUSD <= 0) throw new Error('Monto inválido');

    const deudasRes = await client.query('SELECT * FROM deudas WHERE propietario_id = $1 AND pagado = 0 ORDER BY periodo', [pago.propietario_id]);
    let restante = montoUSD;
    for (const deuda of deudasRes.rows) {
      if (restante <= 0) break;
      if (restante >= deuda.monto_usd) {
        await client.query(
          'UPDATE deudas SET pagado = 1, fecha_pago = $1, referencia_pago = $2, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $3',
          [pago.fecha_pago, pago.referencia, deuda.id]
        );
        restante -= deuda.monto_usd;
      } else {
        await client.query(
          'UPDATE deudas SET monto_usd = $1, fecha_pago = $2, referencia_pago = $3, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $4',
          [deuda.monto_usd - restante, pago.fecha_pago, pago.referencia, deuda.id]
        );
        restante = 0;
      }
    }
    if (restante > 0) {
      await client.query('UPDATE propietarios SET saldo_favor = saldo_favor + $1 WHERE id = $2', [restante, pago.propietario_id]);
    }
    await client.query('UPDATE pagos SET estado = $1, fecha_verificacion = CURRENT_TIMESTAMP, monto_usd = $2 WHERE id = $3', ['verificado', montoUSD, id]);
    await client.query('COMMIT');
    res.json({ changes: 1, saldo_favor: restante });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/pagos/:id/revertir', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pagoRes = await client.query('SELECT * FROM pagos WHERE id = $1', [id]);
    const pago = pagoRes.rows[0];
    if (!pago || pago.estado !== 'verificado') throw new Error('No se puede revertir');
    const deudasRes = await client.query(
      'SELECT id, monto_usd, original_monto FROM deudas WHERE propietario_id = $1 AND fecha_pago = $2 AND referencia_pago = $3',
      [pago.propietario_id, pago.fecha_pago, pago.referencia]
    );
    for (const deuda of deudasRes.rows) {
      const montoRest = deuda.original_monto || deuda.monto_usd;
      await client.query(
        'UPDATE deudas SET pagado = 0, monto_usd = $1, fecha_pago = NULL, referencia_pago = NULL, original_monto = NULL WHERE id = $2',
        [montoRest, deuda.id]
      );
    }
    await client.query('UPDATE propietarios SET saldo_favor = saldo_favor - $1 WHERE id = $2', [pago.monto_usd, pago.propietario_id]);
    await client.query('UPDATE pagos SET estado = $1, fecha_verificacion = NULL WHERE id = $2', ['pendiente', id]);
    await client.query('COMMIT');
    res.json({ changes: 1 });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

app.post('/api/pagos/propietario', authenticateToken, async (req, res) => {
  const { propietario_id, fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const monto_usd = monto_bs / tasa_bcv;
  try {
    const result = await pool.query(
      `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'pendiente') RETURNING id`,
      [propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const monto_usd = monto_bs / tasa_bcv;
  try {
    const result = await pool.query(
      'UPDATE pagos SET fecha_pago = $1, monto_bs = $2, tasa_bcv = $3, monto_usd = $4, referencia = $5 WHERE id = $6',
      [fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, id]
    );
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM pagos WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Usuarios (master) ----------
app.get('/api/usuarios/existe', authenticateToken, async (req, res) => {
  const { username } = req.query;
  try {
    const result = await pool.query('SELECT id FROM usuarios WHERE username = $1', [username]);
    res.json({ exists: result.rows.length > 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/usuarios', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.id, u.username, u.rol, u.propietario_id,
             p.nombre as propietario_nombre, p.apartamento
      FROM usuarios u LEFT JOIN propietarios p ON u.propietario_id = p.id ORDER BY u.id
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (username && username.trim()) {
      const existing = await pool.query('SELECT id FROM usuarios WHERE username = $1 AND id != $2', [username, id]);
      if (existing.rows.length > 0) return res.status(400).json({ error: 'Username ya existe' });
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        await pool.query('UPDATE usuarios SET username = $1, password = $2 WHERE id = $3', [username, hash, id]);
      } else {
        await pool.query('UPDATE usuarios SET username = $1 WHERE id = $2', [username, id]);
      }
    } else if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, id]);
    }
    res.json({ changes: 1 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await pool.query('SELECT username FROM usuarios WHERE id = $1', [id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    if (user.rows[0].username === 'admin') return res.status(403).json({ error: 'No se puede eliminar admin' });
    const result = await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nuevaPassword } = req.body;
  const hash = bcrypt.hashSync(nuevaPassword, 10);
  try {
    const result = await pool.query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, id]);
    res.json({ changes: result.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ---------- Iniciar servidor ----------
setupDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    console.log(`📦 Base de datos PostgreSQL conectada`);
  });
}).catch(err => {
  console.error('❌ Error al inicializar la base de datos:', err);
  process.exit(1);
});
