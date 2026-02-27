const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const http = require('http');
require('dotenv').config();
const db = require('./db');
const { createBugModal, handleBugModalSubmit, handleBacklogButton, setupBoardInChannel } = require('./backlog');

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

const apiSecretKey = process.env.API_SECRET_KEY;

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
    new SlashCommandBuilder()
      .setName('bug')
      .setDescription('Abre um BUG / atividade de backlog (formulário Scrum + lista todo)')
      .toJSON(),
    new SlashCommandBuilder()
      .setName('backlog-board')
      .setDescription('Cria ou atualiza a mensagem de lista (To Do / In Progress / Completed) neste canal')
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
  if (interaction.isModalSubmit()) {
    const handled = await handleBugModalSubmit(interaction, client);
    if (handled) return;
  }
  if (interaction.isButton()) {
    const handled = await handleBacklogButton(interaction, client);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'bug') {
    const modal = createBugModal();
    await interaction.showModal(modal);
    return;
  }

  if (interaction.commandName === 'backlog-board') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await setupBoardInChannel(interaction, client);
    await interaction.editReply({ content: '✅ Quadro de backlog criado/atualizado neste canal.', flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === 'link') {
    const input = interaction.options.getString('input');
    const discordUserId = interaction.user.id;
    
    try {
      const member = await interaction.guild.members.fetch(discordUserId);
      const verifiedRole = interaction.guild.roles.cache.find(role => role.name === 'Player Verificado');
      
      if (verifiedRole && member.roles.cache.has(verifiedRole.id)) {
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

      db.init();

      // Search for token (case-insensitive)
      const { rows } = db.query(
        'SELECT * FROM discord_link_table WHERE UPPER(token) = UPPER(?)',
        [input]
      );
      
      console.log(`🔍 Searching for token: ${input} (found ${rows.length} results)`);
      
      if (rows.length === 0) {
        // Check if any tokens exist at all for debugging
        const allTokens = db.query('SELECT token, user_id, discord_id FROM discord_link_table WHERE token IS NOT NULL ORDER BY id DESC LIMIT 10');
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
      
      const { rows: existingLink } = db.query(
        'SELECT * FROM discord_link_table WHERE discord_id = ? AND (token IS NULL OR token != ?)',
        [discordUserId, input]
      );
      
      if (existingLink.length > 0) {
        await interaction.editReply({
          content: `⚠️ Your account is already linked with a different token.`,
        });
        return;
      }
      
      const updateResult = db.run(
        'UPDATE discord_link_table SET discord_id = ?, token = NULL, linked_at = datetime(\'now\') WHERE UPPER(token) = UPPER(?)',
        discordUserId,
        input
      );

      if (updateResult.changes > 0) {
        try {
          const member = await interaction.guild.members.fetch(discordUserId);
          const role = interaction.guild.roles.cache.find(role => role.name === 'Player Verificado');
          
          if (role) {
            await member.roles.add(role);
            console.log(`Assigned "Player Verificado" role to user ${discordUserId}`);
          } else {
            console.warn(`Role "Player Verificado" not found in server ${interaction.guild.id}`);
          }
        } catch (roleError) {
          console.error('Error assigning role:', roleError);
        }
        
        await interaction.editReply({
          content: `✅ Token verificado! Sua conta foi linkada com sucesso!\n\n🎮 **Próximo passo:**\nVolte ao jogo e execute o comando:\n\`\`\`/check\`\`\`\n\nIsso irá validar sua conta e conceder seus benefícios!`,
        });
      } else {
        await interaction.editReply({
          content: `❌ Falha ao linkar conta. Por favor, tente novamente ou entre em contato com o suporte.`,
        });
      }
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
    const result = db.run(
      'DELETE FROM discord_link_table WHERE discord_id = ?',
      discordUserId
    );

    if (result.changes > 0) {
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
    db.init();
    console.log('✅ Base de dados SQLite pronta:', db.getDbPath());
  } catch (error) {
    console.error('❌ Erro ao inicializar base de dados:', error.message);
  }
});

// HTTP server for plugin to insert tokens
const httpServer = http.createServer(async (req, res) => {
  // Log ALL incoming requests for debugging
  console.log(`📥 [${new Date().toISOString()}] ${req.method} ${req.url}`);
  console.log(`📥 Headers:`, JSON.stringify(req.headers, null, 2));
  
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS, GET');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key, Authorization');
  
  if (req.method === 'OPTIONS') {
    console.log(`📥 OPTIONS request - sending CORS headers`);
    res.writeHead(200);
    res.end();
    return;
  }
  
  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString() }));
    return;
  }
  
  if (req.method === 'POST' && req.url === '/api/insert-token') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      // Wrap in try-catch to handle any synchronous errors
      try {
        console.log(`📥 Received request at ${new Date().toISOString()}`);
        console.log(`📥 Request URL: ${req.url}`);
        console.log(`📥 Request method: ${req.method}`);
        console.log(`📥 Request headers:`, JSON.stringify(req.headers, null, 2));
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

        db.init();

        // Check if token already exists
        const existing = db.get('SELECT * FROM discord_link_table WHERE token = ?', token);

        if (existing) {
          console.log(`⚠️ Token ${token} already exists in database`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, inserted: false, message: 'Token already exists' }));
          return;
        }

        // Insert token into database
        const result = db.run(
          'INSERT INTO discord_link_table (user_id, token) VALUES (?, ?)',
          user_id,
          token
        );

        console.log(`✅ Token ${token} inserted for user ${user_id}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, inserted: result.changes > 0, id: result.lastInsertRowid }));
      } catch (error) {
        console.error('❌ ========== ERROR ==========');
        console.error('❌ Error type:', error.constructor.name);
        console.error('❌ Error name:', error.name);
        console.error('❌ Error message:', error.message);
        console.error('❌ Error code:', error.code);
        if (error.detail) console.error('❌ Error detail:', error.detail);
        if (error.hint) console.error('❌ Error hint:', error.hint);
        if (error.stack) {
          console.error('❌ Error stack:', error.stack);
        }
        console.error('❌ Full error object:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
        console.error('❌ ==========================');
        
        // Make sure we haven't already sent a response
        if (!res.headersSent) {
          try {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'Internal server error', 
              message: error.message,
              name: error.name,
              code: error.code
            }));
          } catch (responseError) {
            console.error('❌ Failed to send error response:', responseError);
          }
        }
      }
    });
    return;
  }

  // Endpoint to check for recently linked tokens
  if (req.method === 'GET' && req.url === '/api/check-linked-tokens') {
    // Check API key
    const authHeader = req.headers['x-api-key'] || req.headers['authorization'];
    const providedKey = authHeader?.replace('Bearer ', '') || authHeader;
    
    if (!providedKey || providedKey !== apiSecretKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid API key' }));
      return;
    }

    try {
      // Query for tokens linked in the last 2 minutes that haven't been executed
      const rows = db.all(`
        SELECT user_id, token, linked_at
        FROM discord_link_table
        WHERE linked_at IS NOT NULL
        AND linked_at > datetime('now', '-2 minutes')
        AND executed = 0
        ORDER BY linked_at DESC
      `);

      const tokens = rows.map(row => ({
        user_id: row.user_id,
        token: row.token
      }));

      // Mark as executed if there are tokens
      if (tokens.length > 0) {
        const placeholders = tokens.map(() => '?').join(',');
        const userIds = tokens.map(t => t.user_id);
        db.run(`
          UPDATE discord_link_table
          SET executed = 1
          WHERE user_id IN (${placeholders})
          AND executed = 0
        `, ...userIds);
        console.log(`✅ Marked ${tokens.length} token(s) as executed`);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tokens: tokens }));
    } catch (err) {
      console.error('Database error checking linked tokens:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database error', message: err.message }));
    }
    return;
  }

  // Endpoint to check if a user_id has been linked
  if (req.method === 'GET' && req.url.startsWith('/api/check-link/')) {
    // Extract user_id from URL: /api/check-link/{user_id}
    const userId = req.url.split('/api/check-link/')[1];
    
    if (!userId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'user_id is required' }));
      return;
    }

    // Check API key
    const authHeader = req.headers['x-api-key'] || req.headers['authorization'];
    const providedKey = authHeader?.replace('Bearer ', '') || authHeader;
    
    if (!providedKey || providedKey !== apiSecretKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid API key' }));
      return;
    }

    try {
      const linkData = db.get(`
        SELECT user_id, discord_id, linked_at, executed
        FROM discord_link_table
        WHERE user_id = ?
        AND discord_id IS NOT NULL
        AND discord_id != ''
        AND linked_at IS NOT NULL
      `, userId);

      if (!linkData) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, linked: false, message: 'Account not linked yet' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        linked: true,
        user_id: linkData.user_id,
        discord_id: linkData.discord_id,
        linked_at: linkData.linked_at,
        executed: linkData.executed
      }));
    } catch (err) {
      console.error('Database error checking link:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database error', message: err.message }));
    }
    return;
  }

  // Endpoint to mark a user as executed (accepts both GET and POST)
  if ((req.method === 'GET' || req.method === 'POST') && req.url.startsWith('/api/mark-executed/')) {
    // Extract user_id from URL: /api/mark-executed/{user_id}
    const userId = req.url.split('/api/mark-executed/')[1];
    
    console.log(`📝 Mark as executed request for user: ${userId}`);
    
    if (!userId) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'user_id is required' }));
      return;
    }

    // Check API key
    const authHeader = req.headers['x-api-key'] || req.headers['authorization'];
    const providedKey = authHeader?.replace('Bearer ', '') || authHeader;
    
    if (!providedKey || providedKey !== apiSecretKey) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized: Invalid API key' }));
      return;
    }

    try {
      const result = db.run(`
        UPDATE discord_link_table
        SET executed = 1
        WHERE user_id = ?
        AND executed = 0
      `, userId);

      console.log(`✅ Marked ${result.changes} record(s) as executed for user ${userId}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, updated: result.changes > 0 }));
    } catch (err) {
      console.error('Database error marking as executed:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Database error', message: err.message }));
    }
    return;
  }

  // 404 for unknown routes
  console.log(`📥 404 - Route not found: ${req.url}`);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
  
  // Handle server errors
  req.on('error', (err) => {
    console.error('❌ Request stream error:', err);
  });
});

// Handle server-level errors
httpServer.on('error', (err) => {
  console.error('❌ HTTP Server error:', err);
});

httpServer.on('error', (err) => {
  console.error('❌ HTTP Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error('❌ Port 3000 is already in use!');
  }
});

httpServer.listen(3000, '0.0.0.0', () => {
  console.log('🌐 HTTP API server listening on port 3000 (0.0.0.0:3000) for token insertions');
  console.log('🌐 Server ready to receive requests at: http://0.0.0.0:3000/api/insert-token');
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

client.login(token);


