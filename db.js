/**
 * Módulo de base de dados SQLite (local).
 * Ideal para Coolify/self-hosted: um único ficheiro, sem serviço PostgreSQL.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
const DEFAULT_DB_PATH = path.join(DATA_DIR, 'discord-sync.db');

let db = null;

function getDbPath() {
  return process.env.DB_PATH || DEFAULT_DB_PATH;
}

function open() {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Cria a tabela discord_link_table se não existir.
 * Equivalente ao schema "rust-server" do PostgreSQL (SQLite não tem schemas).
 */
function init() {
  const database = open();
  database.exec(`
    CREATE TABLE IF NOT EXISTS discord_link_table (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      discord_id TEXT NOT NULL DEFAULT '',
      token TEXT,
      linked_at TEXT,
      executed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_discord_link_token ON discord_link_table(token);
    CREATE INDEX IF NOT EXISTS idx_discord_link_user_id ON discord_link_table(user_id);
    CREATE INDEX IF NOT EXISTS idx_discord_link_discord_id ON discord_link_table(discord_id);
  `);
  return database;
}

/**
 * Executa uma query e retorna { rows, rowCount } para compatibilidade com código que espera estilo pg.
 * Para SELECT: rows = array, rowCount = rows.length.
 * Para INSERT/UPDATE/DELETE: rowCount = changes.
 */
function query(sql, params = []) {
  const database = open();
  const stmt = database.prepare(sql);
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith('SELECT')) {
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }
  const result = stmt.run(...params);
  return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
}

/**
 * Um único resultado (SELECT) ou undefined.
 */
function get(sql, ...params) {
  const database = open();
  return database.prepare(sql).get(...params);
}

/**
 * Todos os resultados (SELECT).
 */
function all(sql, ...params) {
  const database = open();
  return database.prepare(sql).all(...params);
}

/**
 * Executa INSERT/UPDATE/DELETE. Retorna { changes, lastInsertRowid }.
 */
function run(sql, ...params) {
  const database = open();
  return database.prepare(sql).run(...params);
}

module.exports = {
  open,
  close,
  init,
  query,
  get,
  all,
  run,
  getDbPath,
};
