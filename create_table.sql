-- Script SQL para criar a tabela discord_link_table no schema rust-server
-- Execute este script no seu banco de dados PostgreSQL

-- Criar schema se não existir
CREATE SCHEMA IF NOT EXISTS "rust-server";

-- Criar tabela no schema rust-server
CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  discord_id TEXT NOT NULL DEFAULT '',
  token TEXT
);

-- Criar índices para melhor performance
CREATE INDEX IF NOT EXISTS idx_discord_link_token ON "rust-server".discord_link_table(token);
CREATE INDEX IF NOT EXISTS idx_discord_link_user_id ON "rust-server".discord_link_table(user_id);
CREATE INDEX IF NOT EXISTS idx_discord_link_discord_id ON "rust-server".discord_link_table(discord_id);

-- Comentários nas colunas
COMMENT ON TABLE "rust-server".discord_link_table IS 'Tabela para sincronização de contas Discord com contas do servidor Rust';
COMMENT ON COLUMN "rust-server".discord_link_table.id IS 'ID único do registro';
COMMENT ON COLUMN "rust-server".discord_link_table.user_id IS 'ID do jogador no servidor Rust';
COMMENT ON COLUMN "rust-server".discord_link_table.discord_id IS 'ID do usuário no Discord';
COMMENT ON COLUMN "rust-server".discord_link_table.token IS 'Token de 4 caracteres para linkar a conta';

