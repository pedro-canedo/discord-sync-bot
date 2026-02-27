-- Script SQL para criar a tabela no SQLite (base de dados local).
-- A tabela é criada automaticamente pelo bot na pasta data/.
-- Use este ficheiro apenas como referência ou para criar manualmente.

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
