const express = require('express');
const { Pool } = require('pg');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS dados (
    id INT PRIMARY KEY DEFAULT 1,
    json TEXT NOT NULL
  )`);
  await pool.query(`INSERT INTO dados (id, json)
    VALUES (1, '{"clientes":[],"pedidos":[],"usuarios":[],"produtos":[]}')
    ON CONFLICT (id) DO NOTHING`);
}

app.get('/api/data', async (req, res) => {
  try {
    const r = await pool.query('SELECT json FROM dados WHERE id=1');
    res.json(JSON.parse(r.rows[0].json));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/data', async (req, res) => {
  try {
    await pool.query('UPDATE dados SET json=$1 WHERE id=1', [JSON.stringify(req.body)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

init().then(() => app.listen(PORT, () => console.log('SERVIDOR OK NA PORTA ' + PORT)));
