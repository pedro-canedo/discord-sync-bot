const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
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
      
      // Ensure schema and table exist with proper permissions
      await dbPool.query(`CREATE SCHEMA IF NOT EXISTS "rust-server"`);
      await dbPool.query(`GRANT ALL ON SCHEMA "rust-server" TO postgres`);
      await dbPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "rust-server" GRANT ALL ON TABLES TO postgres`);
      await dbPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "rust-server" GRANT ALL ON SEQUENCES TO postgres`);
      
      await dbPool.query(`
        CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          discord_id TEXT NOT NULL DEFAULT '',
          token TEXT,
          linked_at TIMESTAMP,
          executed BOOLEAN DEFAULT false
        )
      `);
      
      // Try to alter table ownership to postgres (if we have superuser privileges)
      try {
        await dbPool.query(`ALTER TABLE "rust-server".discord_link_table OWNER TO postgres`);
      } catch (ownerError) {
        // If we can't change ownership, try to grant all privileges instead
        // This is expected if we don't have superuser privileges
      }
      
      // Grant permissions on the table
      try {
        await dbPool.query(`GRANT ALL PRIVILEGES ON "rust-server".discord_link_table TO postgres`);
        await dbPool.query(`GRANT USAGE, SELECT ON SEQUENCE "rust-server".discord_link_table_id_seq TO postgres`);
      } catch (grantError) {
        // Permissions may already be granted
      }
      
      // Add columns if they don't exist (for existing tables)
      try {
        await dbPool.query(`
          DO $$ 
          BEGIN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_schema = 'rust-server' 
                           AND table_name = 'discord_link_table' 
                           AND column_name = 'linked_at') THEN
              ALTER TABLE "rust-server".discord_link_table ADD COLUMN linked_at TIMESTAMP;
            END IF;
            
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                           WHERE table_schema = 'rust-server' 
                           AND table_name = 'discord_link_table' 
                           AND column_name = 'executed') THEN
              ALTER TABLE "rust-server".discord_link_table ADD COLUMN executed BOOLEAN DEFAULT false;
            END IF;
          END $$;
        `);
      } catch (alterError) {
        // If we can't alter the table, check if columns already exist
        const checkColumns = await dbPool.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_schema = 'rust-server' 
          AND table_name = 'discord_link_table'
          AND column_name IN ('linked_at', 'executed')
        `);
        
        if (checkColumns.rows.length < 2) {
          console.error('⚠️ Could not add columns to table. You may need to run this SQL manually:');
          console.error('   ALTER TABLE "rust-server".discord_link_table ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;');
          console.error('   ALTER TABLE "rust-server".discord_link_table ADD COLUMN IF NOT EXISTS executed BOOLEAN DEFAULT false;');
        }
      }
      
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
        'UPDATE "rust-server".discord_link_table SET discord_id = $1, token = NULL, linked_at = NOW() WHERE token = $2',
        [discordUserId, input]
      );
      
      if (updateResult.rowCount > 0) {
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
    const { rows: userRows } = await dbPool.query(
      'SELECT user_id FROM "rust-server".discord_link_table WHERE discord_id = $1',
      [discordUserId]
    );
    
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
    
    // Create schema and table with proper permissions
    await client.query(`CREATE SCHEMA IF NOT EXISTS "rust-server"`);
    await client.query(`GRANT ALL ON SCHEMA "rust-server" TO postgres`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "rust-server" GRANT ALL ON TABLES TO postgres`);
    await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA "rust-server" GRANT ALL ON SEQUENCES TO postgres`);
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        discord_id TEXT NOT NULL DEFAULT '',
        token TEXT,
        linked_at TIMESTAMP,
        executed BOOLEAN DEFAULT false
      )
    `);
    
    // Try to alter table ownership to postgres (if we have superuser privileges)
    try {
      await client.query(`ALTER TABLE "rust-server".discord_link_table OWNER TO postgres`);
    } catch (ownerError) {
      // If we can't change ownership, try to grant all privileges instead
      console.log('⚠️ Could not change table ownership, attempting to grant privileges...');
    }
    
    // Grant permissions on the table
    try {
      await client.query(`GRANT ALL PRIVILEGES ON "rust-server".discord_link_table TO postgres`);
      await client.query(`GRANT USAGE, SELECT ON SEQUENCE "rust-server".discord_link_table_id_seq TO postgres`);
    } catch (grantError) {
      console.log('⚠️ Could not grant privileges (may already have them):', grantError.message);
    }
    
    // Add columns if they don't exist (for existing tables)
    try {
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_schema = 'rust-server' 
                         AND table_name = 'discord_link_table' 
                         AND column_name = 'linked_at') THEN
            ALTER TABLE "rust-server".discord_link_table ADD COLUMN linked_at TIMESTAMP;
          END IF;
          
          IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                         WHERE table_schema = 'rust-server' 
                         AND table_name = 'discord_link_table' 
                         AND column_name = 'executed') THEN
            ALTER TABLE "rust-server".discord_link_table ADD COLUMN executed BOOLEAN DEFAULT false;
          END IF;
        END $$;
      `);
    } catch (alterError) {
      // If we can't alter the table, check if columns already exist
      const checkColumns = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'rust-server' 
        AND table_name = 'discord_link_table'
        AND column_name IN ('linked_at', 'executed')
      `);
      
      if (checkColumns.rows.length < 2) {
        console.error('❌ Could not add columns to table. You may need to run this SQL manually:');
        console.error('   ALTER TABLE "rust-server".discord_link_table ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;');
        console.error('   ALTER TABLE "rust-server".discord_link_table ADD COLUMN IF NOT EXISTS executed BOOLEAN DEFAULT false;');
        console.error('   Error:', alterError.message);
      } else {
        console.log('✅ Columns already exist or were added successfully');
      }
    }
    
    console.log('✅ Table rust-server.discord_link_table checked/created with permissions');
    
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
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

        // Ensure schema and table exist with proper permissions
        try {
          await dbPool.query(`CREATE SCHEMA IF NOT EXISTS "rust-server"`);
          // Grant permissions to postgres user
          await dbPool.query(`GRANT ALL ON SCHEMA "rust-server" TO postgres`);
          await dbPool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA "rust-server" TO postgres`);
          await dbPool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "rust-server" TO postgres`);
        } catch (schemaError) {
          console.error('⚠️ Schema creation/permission error (may already exist):', schemaError.message);
        }
        
        await dbPool.query(`
          CREATE TABLE IF NOT EXISTS "rust-server".discord_link_table (
            id SERIAL PRIMARY KEY,
            user_id TEXT NOT NULL,
            discord_id TEXT NOT NULL DEFAULT '',
            token TEXT
          )
        `);
        
        // Grant permissions on the table
        try {
          await dbPool.query(`GRANT ALL PRIVILEGES ON "rust-server".discord_link_table TO postgres`);
          await dbPool.query(`GRANT USAGE, SELECT ON SEQUENCE "rust-server".discord_link_table_id_seq TO postgres`);
        } catch (permError) {
          console.error('⚠️ Permission grant error (may already have permissions):', permError.message);
        }
        
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

    // Query for tokens linked in the last 2 minutes that haven't been executed
    dbPool.query(`
      SELECT user_id, token, linked_at 
      FROM "rust-server".discord_link_table 
      WHERE linked_at IS NOT NULL 
      AND linked_at > NOW() - INTERVAL '2 minutes'
      AND executed = false
      ORDER BY linked_at DESC
    `, (err, result) => {
      if (err) {
        console.error('Database error checking linked tokens:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', message: err.message }));
        return;
      }

      const tokens = result.rows.map(row => ({
        user_id: row.user_id,
        token: row.token
      }));

      // Mark as executed if there are tokens
      if (tokens.length > 0) {
        const userIds = tokens.map(t => t.user_id);
        dbPool.query(`
          UPDATE "rust-server".discord_link_table 
          SET executed = true 
          WHERE user_id = ANY($1::text[])
          AND executed = false
        `, [userIds], (updateErr) => {
          if (updateErr) {
            console.error('Error marking tokens as executed:', updateErr);
          } else {
            console.log(`✅ Marked ${tokens.length} token(s) as executed`);
          }
        });
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, tokens: tokens }));
    });
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

    // Query for linked account
    dbPool.query(`
      SELECT user_id, discord_id, linked_at, executed
      FROM "rust-server".discord_link_table 
      WHERE user_id = $1 
      AND discord_id IS NOT NULL 
      AND discord_id != ''
      AND linked_at IS NOT NULL
    `, [userId], (err, result) => {
      if (err) {
        console.error('Database error checking link:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', message: err.message }));
        return;
      }

      if (result.rows.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, linked: false, message: 'Account not linked yet' }));
        return;
      }

      const linkData = result.rows[0];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ 
        success: true, 
        linked: true,
        user_id: linkData.user_id,
        discord_id: linkData.discord_id,
        linked_at: linkData.linked_at,
        executed: linkData.executed
      }));
    });
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

    // Mark as executed (update all records for this user_id)
    dbPool.query(`
      UPDATE "rust-server".discord_link_table 
      SET executed = true 
      WHERE user_id = $1
      AND executed = false
    `, [userId], (err, result) => {
      if (err) {
        console.error('Database error marking as executed:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Database error', message: err.message }));
        return;
      }

      console.log(`✅ Marked ${result.rowCount} record(s) as executed for user ${userId}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, updated: result.rowCount > 0 }));
    });
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


