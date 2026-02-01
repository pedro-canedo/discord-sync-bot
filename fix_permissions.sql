-- Script SQL para corrigir permissões da tabela discord_link_table
-- Execute este script como superuser (ou o usuário que criou a tabela)

-- Alterar o dono da tabela para postgres
ALTER TABLE "rust-server".discord_link_table OWNER TO postgres;

-- Conceder todas as permissões ao usuário postgres
GRANT ALL PRIVILEGES ON "rust-server".discord_link_table TO postgres;
GRANT USAGE, SELECT ON SEQUENCE "rust-server".discord_link_table_id_seq TO postgres;

-- Adicionar colunas se não existirem
ALTER TABLE "rust-server".discord_link_table 
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;

ALTER TABLE "rust-server".discord_link_table 
  ADD COLUMN IF NOT EXISTS executed BOOLEAN DEFAULT false;

-- Verificar se as colunas foram adicionadas
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_schema = 'rust-server' 
AND table_name = 'discord_link_table'
ORDER BY ordinal_position;

