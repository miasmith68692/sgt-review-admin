/**
 * 审稿通 - 后台数据库模块
 * 双模式支持：
 *   1. 设置了 DATABASE_URL → 使用 PostgreSQL（Render 生产环境）
 *   2. 未设置 DATABASE_URL → 使用 sql.js（本地开发/测试）
 * 不需要额外配置即可启动
 */

let backend = null;

// ================================================================
//  模式 A：PostgreSQL（需要 DATABASE_URL 环境变量）
// ================================================================

async function initPg() {
  const { Pool } = require('pg');
  const connectionString = process.env.DATABASE_URL;
  const pool = new Pool({ connectionString });

  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS activation_codes (
      id           SERIAL PRIMARY KEY,
      plan         TEXT NOT NULL,
      uid          TEXT NOT NULL,
      key_value    TEXT NOT NULL,
      expire_date  TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      reported_at  TEXT,
      status       TEXT DEFAULT 'unused'
    )
  `);

  console.log('→ PostgreSQL 数据库已连接');
  return {
    insertCode: async ({ plan, uid, key_value, expire_date }) => {
      const r = await pool.query(
        `INSERT INTO activation_codes (plan, uid, key_value, expire_date, generated_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [plan, uid, key_value, expire_date, new Date().toISOString()]
      );
      return r.rows[0].id;
    },
    getAllCodes: async () => {
      const r = await pool.query('SELECT * FROM activation_codes ORDER BY generated_at DESC');
      return r.rows;
    },
    markReported: async (uid, plan) => {
      const find = await pool.query(
        `SELECT id FROM activation_codes WHERE uid = $1 AND plan = $2 AND status = 'unused' ORDER BY generated_at DESC LIMIT 1`,
        [uid, plan]
      );
      if (find.rows.length === 0) return false;
      await pool.query(`UPDATE activation_codes SET status = 'activated', reported_at = $1 WHERE id = $2`,
        [new Date().toISOString(), find.rows[0].id]);
      return true;
    }
  };
}

// ================================================================
//  模式 B：sql.js（本地文件数据库，无需额外配置）
// ================================================================

async function initSqlite() {
  const initSqlJs = require('sql.js');
  const fs = require('fs');
  const path = require('path');

  const dbDir = path.join(__dirname, 'data');
  const dbPath = path.join(dbDir, 'sgt_admin.db');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const SQL = await initSqlJs();
  let sqlDb;

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    sqlDb = new SQL.Database(buffer);
  } else {
    sqlDb = new SQL.Database();
  }

  // 创建表
  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS activation_codes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      plan         TEXT NOT NULL,
      uid          TEXT NOT NULL,
      key_value    TEXT NOT NULL,
      expire_date  TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      reported_at  TEXT,
      status       TEXT DEFAULT 'unused'
    )
  `);

  const save = () => {
    const data = sqlDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
  };

  console.log('→ sql.js 本地数据库已就绪 (' + dbPath + ')');
  console.log('   （设置 DATABASE_URL 环境变量可切换为 PostgreSQL）');

  return {
    insertCode: ({ plan, uid, key_value, expire_date }) => {
      const stmt = sqlDb.prepare(
        `INSERT INTO activation_codes (plan, uid, key_value, expire_date, generated_at)
         VALUES (?, ?, ?, ?, ?)`
      );
      stmt.run([plan, uid, key_value, expire_date, new Date().toISOString()]);
      const id = sqlDb.exec('SELECT last_insert_rowid()')[0].values[0][0];
      stmt.free();
      save();
      return id;
    },
    getAllCodes: () => {
      const results = sqlDb.exec('SELECT * FROM activation_codes ORDER BY generated_at DESC');
      if (!results.length) return [];
      const cols = results[0].columns;
      return results[0].values.map(row => {
        const obj = {};
        cols.forEach((c, i) => { obj[c] = row[i]; });
        return obj;
      });
    },
    markReported: (uid, plan) => {
      const find = sqlDb.exec(
        `SELECT id FROM activation_codes WHERE uid = '${uid}' AND plan = '${plan}' AND status = 'unused' ORDER BY generated_at DESC LIMIT 1`
      );
      if (!find.length || !find[0].values.length) return false;
      const foundId = find[0].values[0][0];
      sqlDb.run(
        `UPDATE activation_codes SET status = 'activated', reported_at = '${new Date().toISOString()}' WHERE id = ${foundId}`
      );
      save();
      return true;
    }
  };
}

// ================================================================
//  统一入口
// ================================================================

async function initDatabase() {
  if (process.env.DATABASE_URL) {
    backend = await initPg();
  } else {
    backend = await initSqlite();
  }
  return backend;
}

function getBackend() {
  if (!backend) {
    throw new Error('数据库未初始化，请先调用 initDatabase()');
  }
  return backend;
}

// 兼容旧接口名
const getPool = getBackend;

async function insertCode(params) {
  return getBackend().insertCode(params);
}

async function getAllCodes() {
  return getBackend().getAllCodes();
}

async function markReported(uid, plan) {
  return getBackend().markReported(uid, plan);
}

module.exports = {
  initDatabase,
  getBackend,
  getPool,
  insertCode,
  getAllCodes,
  markReported
};