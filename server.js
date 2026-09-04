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

const COLECOES_VALIDAS = ['clientes', 'pedidos', 'usuarios', 'produtos', 'entregadores', 'mensagens', 'solicitacoes', 'orcamentos'];

async function init() {
  await pool.query(`CREATE TABLE IF NOT EXISTS dados (
    id INT PRIMARY KEY DEFAULT 1,
    json TEXT NOT NULL
  )`);
  await pool.query(`INSERT INTO dados (id, json)
    VALUES (1, '{"clientes":[],"pedidos":[],"usuarios":[],"produtos":[],"entregadores":[],"mensagens":[],"solicitacoes":[],"orcamentos":[]}')
    ON CONFLICT (id) DO NOTHING`);
}

// ===== LEITURA COMPLETA (usada no carregamento inicial e na sincronização periódica) =====
app.get('/api/data', async (req, res) => {
  try {
    const r = await pool.query('SELECT json FROM dados WHERE id=1');
    res.json(JSON.parse(r.rows[0].json));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SALVAMENTO COMPLETO (mantido só para APAGAR TUDO e IMPORTAR BACKUP, onde substituir tudo é a intenção) =====
app.post('/api/data', async (req, res) => {
  try {
    await pool.query('UPDATE dados SET json=$1 WHERE id=1', [JSON.stringify(req.body)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SALVAR/ATUALIZAR UM ÚNICO REGISTRO (uso normal do dia a dia) =====
// Body esperado: { collection: 'pedidos', record: {...}, versaoEsperada: <numero ou undefined> }
app.post('/api/upsert', async (req, res) => {
  const { collection, record, versaoEsperada } = req.body || {};
  if (!COLECOES_VALIDAS.includes(collection)) {
    return res.status(400).json({ ok: false, msg: 'COLEÇÃO INVÁLIDA' });
  }
  if (!record || !record.id) {
    return res.status(400).json({ ok: false, msg: 'REGISTRO SEM ID' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT json FROM dados WHERE id=1 FOR UPDATE');
    const data = JSON.parse(r.rows[0].json);
    if (!Array.isArray(data[collection])) data[collection] = [];

    const idx = data[collection].findIndex(x => x.id === record.id);
    if (idx >= 0) {
      const atual = data[collection][idx];
      const versaoAtual = atual._versao || 0;
      if (versaoEsperada !== undefined && versaoEsperada !== versaoAtual) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          ok: false,
          conflito: true,
          msg: 'ESTE REGISTRO FOI ALTERADO POR OUTRA PESSOA ENQUANTO VOCÊ EDITAVA',
          atual
        });
      }
      record._versao = versaoAtual + 1;
      data[collection][idx] = record;
    } else {
      record._versao = 1;
      data[collection].push(record);
    }

    await client.query('UPDATE dados SET json=$1 WHERE id=1', [JSON.stringify(data)]);
    await client.query('COMMIT');
    res.json({ ok: true, record });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    client.release();
  }
});

// ===== EXCLUIR UM OU MAIS REGISTROS (uma ou várias coleções, numa transação só) =====
// Body esperado: { ops: [ { collection:'pedidos', id:'...' }, { collection:'clientes', id:'...' } ] }
app.post('/api/delete', async (req, res) => {
  const { ops } = req.body || {};
  if (!Array.isArray(ops) || !ops.length) {
    return res.status(400).json({ ok: false, msg: 'NADA PARA EXCLUIR' });
  }
  for (const op of ops) {
    if (!COLECOES_VALIDAS.includes(op.collection) || !op.id) {
      return res.status(400).json({ ok: false, msg: 'OPERAÇÃO DE EXCLUSÃO INVÁLIDA' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT json FROM dados WHERE id=1 FOR UPDATE');
    const data = JSON.parse(r.rows[0].json);
    ops.forEach(op => {
      if (Array.isArray(data[op.collection])) {
        data[op.collection] = data[op.collection].filter(x => x.id !== op.id);
      }
    });
    await client.query('UPDATE dados SET json=$1 WHERE id=1', [JSON.stringify(data)]);
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, msg: e.message });
  } finally {
    client.release();
  }
});

init().then(() => app.listen(PORT, () => console.log('SERVIDOR OK NA PORTA ' + PORT)));
