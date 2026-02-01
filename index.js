const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { Client: RconClient } = require('rustrcon');
const { Pool } = require('pg');
const http = require('http');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID; 

// RCON Configuration
const parseRconConfigs = () => {
  const configs = [];
  let index = 1;
  
  if (process.env.RCON_HOST && !process.env.RCON_HOST_1) {
    configs.push({
      host: process.env.RCON_HOST,
      port: process.env.RCON_PORT ? parseInt(process.env.RCON_PORT) : 28016,
      password: process.env.RCON_PASSWORD
    });
  } else {
    // if MULTISERVER
    while (process.env[`RCON_HOST_${index}`]) {
      configs.push({
        host: process.env[`RCON_HOST_${index}`],
        port: process.env[`RCON_PORT_${index}`] ? parseInt(process.env[`RCON_PORT_${index}`]) : 28016,
        password: process.env[`RCON_PASSWORD_${index}`]
      });
      index++;
    }
  }
  
  return configs;
};

const rconConfigs = parseRconConfigs();
const groupName = process.env.GROUP_NAME;
const apiSecretKey = process.env.API_SECRET_KEY;

const dbConfig = {
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const dbPool = new Pool(dbConfig);

const rconClients = [];

rconConfigs.forEach((config, index) => {
  if (config.host && config.password) {
    const rconClient = new RconClient({
      ip: config.host,
      port: config.port,
      password: config.password
    });

    const clientInfo = {
      client: rconClient,
      config: config,
      connected: false,
      index: index + 1
    };

    rconClient.on('connected', () => {
      clientInfo.connected = true;
      console.log(`Connected to RCON #${clientInfo.index} at ${config.host}:${config.port}`);
    });

    rconClient.on('error', (err) => {
      clientInfo.connected = false;
      if (err.error && err.error.code === 'ECONNREFUSED') {
        console.error(`❌ RCON #${clientInfo.index} connection refused at ${config.host}:${config.port}`);
        console.error(`   Possíveis causas:`);
        console.error(`   - Servidor Rust não está rodando`);
        console.error(`   - RCON não está habilitado no servidor`);
        console.error(`   - Porta ou IP incorretos`);
        console.error(`   - Firewall bloqueando a conexão`);
      } else {
        console.error(`RCON #${clientInfo.index} Error:`, err);
        console.error(`RCON #${clientInfo.index} connection failed. Please verify RCON_HOST, RCON_PORT, and RCON_PASSWORD are correct.`);
      }
    });

    rconClient.on('disconnect', () => {
      clientInfo.connected = false;
      console.log(`Disconnected from RCON #${clientInfo.index}`);
    });

    rconClient.on('message', (message) => {
      console.log(`RCON #${clientInfo.index} Message:`, message);
    });

    rconClients.push(clientInfo);
  }
});

// HELPER FUNCTION FOR MULTISERVER
const sendRconCommandToAll = (command) => {
  let sentCount = 0;
  rconClients.forEach((clientInfo) => {
    try {
      const isConnected = clientInfo.connected || 
        (clientInfo.client.ws && clientInfo.client.ws.ws && clientInfo.client.ws.ws.readyState === 1);
      
      if (isConnected) {
        clientInfo.client.send(command, 'DiscordBot', 1);
        console.log(`Sent RCON command to server #${clientInfo.index}: ${command}`);
        sentCount++;
      }
    } catch (error) {
      console.error(`Error sending RCON command to server #${clientInfo.index}:`, error);
    }
  });
  return sentCount;
};

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('link')
      .setDescription('Link an input')
      .addStringOption(option =>
        option
          .setName('input')
          .setDescription('The input to link (must be exactly 4 characters)')
          .setRequired(true)
      )
      .toJSON(),
  ];

  const rest = new REST({ version: '10' }).setToken(token);

  try {
    console.log('Started refreshing application (/) commands.');

    if (guildId) {
      await rest.put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: commands },
      );
      console.log(`Successfully registered application (/) commands to guild ${guildId}.`);
    } else {
      await rest.put(
        Routes.applicationCommands(clientId),
        { body: commands },
      );
      console.log('Successfully registered application (/) commands globally.');
      console.log('Note: Global commands can take up to 1 hour to appear. Add GUILD_ID to .env for instant updates.');
    }
  } catch (error) {
    if (error.code === 50001) {
      console.error('❌ Missing Access: O bot não tem permissão para registrar comandos no servidor.');
      console.error('   Solução:');
      console.error('   1. Certifique-se de que o bot foi convidado com a permissão "applications.commands"');
      console.error('   2. Ou remova o GUILD_ID do .env para registrar comandos globalmente');
      console.error('   3. Verifique se o bot tem permissões de administrador no servidor');
    } else {
      console.error('Error registering commands:', error);
    }
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'link') {
    const input = interaction.options.getString('input');
    const discordUserId = interaction.user.id;
    
    try {
      const member = await interaction.guild.members.fetch(discordUserId);
      const linkedRole = interaction.guild.roles.cache.find(role => role.name === 'Linked');
      
      if (linkedRole && member.roles.cache.has(linkedRole.id)) {
        await interaction.reply({
          content: `❌ Your account is already linked.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    } catch (error) {
      console.error('Error checking user role:', error);
    }
    
    if (input.length !== 4) {
      await interaction.reply({
        content: `❌ Input must be exactly 4 characters long. You provided ${input.length} character(s).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      
      // Ensure table exists in rust-server schema
      await dbPool.query(`
        CREATE SCHEMA IF NOT EXISTS "rust-server"
      `);
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          discord_id TEXT NOT NULL DEFAULT '',
          token TEXT
        )
      `);
      
      // Search for token (case-insensitive)
      const { rows } = await dbPool.query(
        'SELECT * FROM "rust-server".discord_link_table WHERE UPPER(token) = UPPER($1)',
        [input]
      );
      
      console.log(`🔍 Searching for token: ${input} (found ${rows.length} results)`);
      
      if (rows.length === 0) {
        // Check if any tokens exist at all for debugging
        const allTokens = await dbPool.query('SELECT token, user_id, discord_id FROM "rust-server".discord_link_table WHERE token IS NOT NULL ORDER BY id DESC LIMIT 10');
        console.log(`📋 Recent tokens in database (last 10):`);
        allTokens.rows.forEach(row => {
          console.log(`   - Token: ${row.token}, UserID: ${row.user_id}, DiscordID: ${row.discord_id || 'none'}`);
        });
        
        if (allTokens.rows.length === 0) {
          console.log('⚠️ No tokens found in database. Plugin may not be inserting tokens via HTTP API.');
        }
        
        await interaction.editReply({
          content: `❌ Invalid token. The provided token does not match.\n\n**Troubleshooting:**\n1. Make sure you used \`/link\` in the game first\n2. Copy the token exactly as shown (case-sensitive)\n3. The token expires after ${process.env.TOKEN_VALID_TIME || 15} minutes\n4. Generate a new token if needed\n5. Check server console for HTTP API connection errors`,
        });
        return;
      }
      
      if (rows[0].discord_id && rows[0].discord_id !== discordUserId) {
        await interaction.editReply({
          content: `⚠️ This token is already linked to another Discord account.`,
        });
        return;
      }
      
      const { rows: existingLink } = await dbPool.query(
        'SELECT * FROM "rust-server".discord_link_table WHERE discord_id = $1 AND token != $2',
        [discordUserId, input]
      );
      
      if (existingLink.length > 0) {
        await interaction.editReply({
          content: `⚠️ Your account is already linked with a different token.`,
        });
        return;
      }
      
      const updateResult = await dbPool.query(
        'UPDATE "rust-server".discord_link_table SET discord_id = $1, token = NULL WHERE token = $2',
        [discordUserId, input]
      );
      
      if (updateResult.rowCount > 0) {
        try {
          const member = await interaction.guild.members.fetch(discordUserId);
          const role = interaction.guild.roles.cache.find(role => role.name === 'Linked');
          
          if (role) {
            await member.roles.add(role);
            console.log(`Assigned "Linked" role to user ${discordUserId}`);
            
            try {
              const { rows: userRows } = await dbPool.query(
                'SELECT user_id FROM "rust-server".discord_link_table WHERE discord_id = $1',
                [discordUserId]
              );
              
              if (userRows.length > 0 && userRows[0].user_id && groupName) {
                const playerId = String(userRows[0].user_id);
                const rconCommand = `oxide.usergroup add ${playerId} ${groupName}`;
                
                const sentCount = sendRconCommandToAll(rconCommand);
                if (sentCount === 0) {
                  console.warn('No RCON servers connected, cannot send usergroup command');
                }
              } else {
                console.warn(`Could not send RCON command: user_id not found or GROUP_NAME not configured`);
              }
            } catch (rconError) {
              console.error('Error sending RCON command:', rconError);
            }
          } else {
            console.warn(`Role "Linked" not found in server ${interaction.guild.id}`);
          }
        } catch (roleError) {
          console.error('Error assigning role:', roleError);
        }
      }
      
      await interaction.editReply({
        content: `✅ Token verified, Your account has been linked successfully!`,
      });
    } catch (error) {
      console.error('Database error:', error);
      await interaction.editReply({
        content: `❌ An error occurred while processing the token. Please try again later.`,
      });
    }
  }
});

client.on('guildMemberRemove', async (member) => {
  const discordUserId = member.user.id;
  
  try {
    const { rows: userRows } = await dbPool.query(
      'SELECT user_id FROM "rust-server".discord_link_table WHERE discord_id = $1',
      [discordUserId]
    );
    
    if (userRows.length > 0 && userRows[0].user_id && groupName) {
      const playerId = String(userRows[0].user_id);
      const rconCommand = `oxide.usergroup remove ${playerId} ${groupName}`;
      
      try {
        const sentCount = sendRconCommandToAll(rconCommand);
        if (sentCount === 0) {
          console.warn('No RCON servers connected, cannot send usergroup remove command');
        }
      } catch (rconError) {
        console.error('Error sending RCON command:', rconError);
      }
    }
    
    const result = await dbPool.query(
      'DELETE FROM "rust-server".discord_link_table WHERE discord_id = $1',
      [discordUserId]
    );
    
    if (result.rowCount > 0) {
      console.log(`Removed linked account for user ${discordUserId} who left the server.`);
    } else {
      console.log(`User ${discordUserId} left the server but had no linked account.`);
    }
  } catch (error) {
    console.error('Error removing user link from database:', error);
  }
});

// Bot ready event
client.once('ready', async () => {
  console.log(`Bot is ready! Logged in as ${client.user.tag}`);
  registerCommands();
  
  try {
    const client = await dbPool.connect();
    console.log('✅ Database connection established');
    
    // Create table if it doesn't exist
    await client.query(`
        CREATE SCHEMA IF NOT EXISTS "rust-server"
      `);
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          discord_id TEXT NOT NULL DEFAULT '',
          token TEXT
        )
      `);
    console.log('✅ Table rust-server.discord_link_table checked/created');
    
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
  
  if (rconClients.length > 0) {
    rconClients.forEach((clientInfo) => {
      clientInfo.client.login();
    });
    console.log(`Connecting to ${rconClients.length} RCON server(s)...`);
  } else {
    console.log('RCON not configured. Set RCON_HOST, RCON_PORT, and RCON_PASSWORD (or RCON_HOST_1, RCON_PORT_1, RCON_PASSWORD_1, etc.) in .env to enable RCON commands.');
  }
});

// HTTP server for plugin to insert tokens
const httpServer = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }
  
  if (req.method === 'POST' && req.url === '/api/insert-token') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        console.log(`📥 Received request - Headers:`, JSON.stringify(req.headers, null, 2));
        console.log(`📥 Request body:`, body);
        
        // Parse body first to check for API key in body (fallback)
        let parsedBody;
        try {
          parsedBody = JSON.parse(body);
        } catch (parseError) {
          console.error('❌ Failed to parse JSON body:', parseError);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON in request body' }));
          return;
        }
        
        // Check for API secret key in headers or body
        const authHeader = req.headers['x-api-key'] || req.headers['authorization'];
        const providedKey = authHeader?.replace('Bearer ', '') || authHeader || parsedBody.api_key;
        
        console.log(`🔑 Provided key (header): ${authHeader ? '***' + (authHeader.replace('Bearer ', '') || authHeader).slice(-4) : 'NONE'}`);
        console.log(`🔑 Provided key (body): ${parsedBody.api_key ? '***' + parsedBody.api_key.slice(-4) : 'NONE'}`);
        console.log(`🔑 Expected key: ${apiSecretKey ? '***' + apiSecretKey.slice(-4) : 'NOT CONFIGURED'}`);
        
        if (!apiSecretKey) {
          console.error('❌ API_SECRET_KEY not configured in .env');
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Server configuration error' }));
          return;
        }
        
        if (providedKey !== apiSecretKey) {
          console.error('❌ Invalid API key provided');
          console.error(`   Expected: ${apiSecretKey}`);
          console.error(`   Received (header): ${authHeader || 'NONE'}`);
          console.error(`   Received (body): ${parsedBody.api_key || 'NONE'}`);
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: Invalid API key' }));
          return;
        }
        
        console.log(`✅ API key validated successfully`);
        console.log(`📥 Received authenticated token insertion request`);
        
        const { user_id, token } = parsedBody;
        
        if (!user_id || !token) {
          console.error('❌ Missing user_id or token in request');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'user_id and token are required' }));
          return;
        }

        // Ensure schema and table exist
        await dbPool.query(`
          CREATE SCHEMA IF NOT EXISTS "rust-server"
        `);
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            discord_id TEXT NOT NULL DEFAULT '',
            token TEXT
          )
        `);
        
        // Check if token already exists
        const existing = await dbPool.query(
          'SELECT * FROM "rust-server".discord_link_table WHERE token = $1',
          [token]
        );
        
        if (existing.rows.length > 0) {
          console.log(`⚠️ Token ${token} already exists in database`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, inserted: false, message: 'Token already exists' }));
          return;
        }
        
        // Insert token into database
        const result = await dbPool.query(
          'INSERT INTO "rust-server".discord_link_table (user_id, token) VALUES ($1, $2) RETURNING id',
          [user_id, token]
        );

        console.log(`✅ Token ${token} inserted for user ${user_id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, inserted: result.rowCount > 0, id: result.rows[0]?.id }));
      } catch (error) {
        console.error('❌ Error inserting token via API:', error);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);
        if (error.stack) {
          console.error('❌ Error stack:', error.stack);
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          error: 'Internal server error', 
          message: error.message,
          name: error.name
        }));
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

httpServer.listen(3000, '0.0.0.0', () => {
  console.log('🌐 HTTP API server listening on port 3000 (0.0.0.0:3000) for token insertions');
});

client.login(token);


