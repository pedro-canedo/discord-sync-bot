# Discord Sync Bot

A Discord bot that syncs Discord accounts with game server accounts (Rust) via RCON. The bot allows users to link their Discord accounts using tokens and automatically manages user groups on connected game servers.

## Features

- 🔗 **Account Linking**: Link Discord accounts to game accounts using 4-character tokens
- 🎮 **RCON Integration**: Automatically manages user groups on Rust game servers via RCON
- 👥 **Role Management**: Automatically assigns "Player Verificado" role to verified users
- 🔧 **Multi-Server Support**: Connect to multiple RCON servers simultaneously
- 🗄️ **Base de dados local**: Armazena os links de contas em SQLite (um ficheiro na pasta `data/`), ideal para Coolify e self-hosting
- 🚪 **Auto Cleanup**: Removes user groups when members leave the Discord server
- 📋 **Backlog / BUG**: Comando `/bug` para abrir atividades no formato Scrum (perguntas padrão + refinamento com IA). Lista todo (To Do / In Progress / Completed) atualizada automaticamente; suporte a webhook para enviar backlog a um canal.

## Prerequisites

Before setting up the bot, make sure you have:

- **Node.js** (v16 or higher recommended)
- **npm** (comes with Node.js)
- Nenhum servidor de base de dados externo (usa SQLite local)
- **Discord Bot Token** (from Discord Developer Portal)
- **RCON Access** to your Rust game server(s)
- A Discord server where you have administrator permissions

## Installation

1. **Clone or download this repository**
   ```bash
   cd discord-sync-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Create a `.env` file** in the root directory (see Configuration section below)

4. **Opcional:** Definir `DB_PATH` no `.env` para outro caminho do ficheiro SQLite (por predefinição: `data/discord-sync.db`)

5. **Configure your Discord bot** (see Discord Bot Setup section below)

6. **Start the bot**
   ```bash
   npm start
   ```

## Configuration

Create a `.env` file in the root directory with the following variables:

### Required Variables

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_bot_client_id_here
GUILD_ID=your_discord_server_id_here

# Base de dados (opcional – SQLite local por predefinição)
# DB_PATH=data/discord-sync.db

# Oxide User Group (automatically assigned when users link)
GROUP_NAME=your_group_name
```

### Optional – Backlog / BUG tracking

```env
OPEN_API_KEY=sk-...              # Chave OpenAI para refinar textos no formato Scrum
OPEN_API_URL=https://api.openai.com/v1
BACKLOG_CHANNEL_ID=             # ID do canal onde publicar atividades (vazio = mesmo canal do comando)
BACKLOG_WEBHOOK_URL=            # URL do webhook Discord para enviar lista + novos bugs a um canal
```

### Required Variables choose SINGLE SERVER / MULTI SERVER

```env

# Single RCON Server Configuration
RCON_HOST=your_rcon_server_ip
RCON_PORT=28016
RCON_PASSWORD=your_rcon_password

# Multi-Server RCON Configuration (use this instead of single server config)
RCON_HOST_1=server1_ip
RCON_PORT_1=28016
RCON_PASSWORD_1=server1_password
RCON_HOST_2=server2_ip
RCON_PORT_2=28016
RCON_PASSWORD_2=server2_password
# ... (add more servers as needed)
```





### Final Example of .env FILE for SINGLE SERVER user

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_discord_bot_token_here
CLIENT_ID=your_discord_bot_client_id_here
GUILD_ID=your_discord_server_id_here

# Base de dados: SQLite local (ficheiro em data/discord-sync.db). Opcional: DB_PATH=/caminho/para/db.sqlite

# Oxide User Group (automatically assigned when users link)
GROUP_NAME=your_group_name

# Single RCON Server Configuration
RCON_HOST=your_rcon_server_ip
RCON_PORT=28016
RCON_PASSWORD=your_rcon_password
```






### Configuration Notes

- **GUILD_ID**: If provided, slash commands will register instantly. If omitted, commands register globally (can take up to 1 hour).
- **RCON Configuration**: Use either single server config (`RCON_HOST`) or multi-server config (`RCON_HOST_1`, `RCON_HOST_2`, etc.), not both.
- **GROUP_NAME**: The Oxide user group name that will be assigned to linked users on your Rust server.



## Discord Bot Setup

1. **Create a Discord Application**
   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Click "New Application" and give it a name
   - Go to the "Bot" section
   - Click "Add Bot" and confirm

2. **Get Your Bot Token**
   - In the "Bot" section, click "Reset Token" or copy the existing token
   - Copy this token to your `.env` file as `DISCORD_TOKEN`
   - **Important**: Never share your bot token publicly!

3. **Get Your Client ID**
   - In the "General Information" section, copy the "Application ID"
   - Copy this to your `.env` file as `CLIENT_ID`

4. **Enable Required Privileges**
   - In the "Bot" section, enable the following:
     - ✅ **Server Members Intent** (under "Privileged Gateway Intents")
     - ✅ **Message Content Intent** (if needed)
   - Under "OAuth2" → "URL Generator":
     - Select scopes: `bot` and `applications.commands`
     - Select bot permissions: `Manage Roles`, `Send Messages`, `Use Slash Commands`
   - Copy the generated URL and use it to invite your bot to your server

5. **Create the "Player Verificado" Role**
   - In your Discord server, create a role named exactly `Player Verificado`
   - Make sure the bot's role is higher in the hierarchy than the "Player Verificado" role
   - This role will be automatically assigned to users who successfully link their accounts

6. **Get Your Guild ID (Optional)**
   - Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
   - Right-click your server name → "Copy Server ID"
   - Add this to your `.env` file as `GUILD_ID` for faster command registration

## Running the Bot

1. **Start the bot**:
   ```bash
   npm start
   ```

2. **Verify the bot is running**:
   - You should see: `Bot is ready! Logged in as YourBot#1234`
   - Database connection status
   - RCON connection status (if configured)

3. **Test the commands**:
   - In your Discord server, type `/` to see available commands
   - Try the `/link` command

## Commands

### `/link [input]`
Links your Discord account to a game account using a 4-character token.

- **Parameters**:
  - `input` (required): A 4-character token provided by your game server
- **Usage**: `/link ABCD`
- **Notes**:
  - Token must be exactly 4 characters
  - Each token can only be used once
  - You can only link one account at a time
  - Automatically assigns the "Player Verificado" role upon successful linking

## Troubleshooting

### Bot won't start
- ✅ Check that all required `.env` variables are set
- ✅ Verify Node.js version: `node --version` (should be v16+)
- ✅ Check that dependencies are installed: `npm install`

### Erro na base de dados
- ✅ A pasta `data/` é criada automaticamente; verifica permissões de escrita
- ✅ Se usares `DB_PATH`, confirma que o caminho existe e é gravável
- ✅ No **Coolify**: monta um volume em `data/` para persistir o ficheiro SQLite entre deploys

### RCON connection fails
- ✅ Verify RCON credentials in `.env`
- ✅ Check that RCON is enabled on your game server
- ✅ Ensure firewall allows connections to RCON port (default: 28016)
- ✅ Verify RCON password is correct
- ✅ Check server console for RCON connection errors

### Commands not appearing
- ✅ Wait up to 1 hour if using global commands (no `GUILD_ID`)
- ✅ Add `GUILD_ID` to `.env` for instant command registration
- ✅ Ensure bot has `applications.commands` scope when invited
- ✅ Try restarting the bot

### "Player Verificado" role not assigned
- ✅ Verify a role named exactly `Player Verificado` exists in your server
- ✅ Ensure bot's role is higher than "Player Verificado" role in hierarchy
- ✅ Check bot has "Manage Roles" permission
- ✅ Verify bot has "Server Members Intent" enabled

### Token linking fails
- ✅ Ensure token is exactly 4 characters
- ✅ Verify token exists in database and hasn't been used
- ✅ Check database connection is working

## Security Notes

- 🔒 **Never commit your `.env` file** to version control
- 🔒 Keep your Discord bot token secret
- 🔒 Use strong database passwords
- 🔒 Restrict RCON access to trusted networks if possible

## Support

If you encounter issues not covered in this guide:

1. Check the console output for error messages
2. Verify all configuration values are correct
3. Ensure all prerequisites are met
4. Check that your Discord bot has proper permissions

## License

ISC

