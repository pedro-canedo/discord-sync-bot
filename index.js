const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = require('discord.js');
const { Client: RconClient } = require('rustrcon');
const mysql = require('mysql2/promise');
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

const dbConfig = {
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const dbPool = mysql.createPool(dbConfig);

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
      console.error(`RCON #${clientInfo.index} Error:`, err);
      console.error(`RCON #${clientInfo.index} connection failed. Please verify RCON_HOST_${clientInfo.index}, RCON_PORT_${clientInfo.index}, and RCON_PASSWORD_${clientInfo.index} are correct.`);
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
    new SlashCommandBuilder()
      .setName('rcon')
      .setDescription('Send a command to the RCON server')
      .addStringOption(option =>
        option
          .setName('command')
          .setDescription('The command to send to RCON')
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
    console.error('Error registering commands:', error);
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
          ephemeral: true,
        });
        return;
      }
    } catch (error) {
      console.error('Error checking user role:', error);
    }
    
    if (input.length !== 4) {
      await interaction.reply({
        content: `❌ Input must be exactly 4 characters long. You provided ${input.length} character(s).`,
        ephemeral: true,
      });
      return;
    }
    
    try {
      await interaction.deferReply({ ephemeral: true });
      
      const [rows] = await dbPool.execute(
        'SELECT * FROM discord_link_table WHERE token = ?',
        [input]
      );
      
      if (rows.length === 0) {
        await interaction.editReply({
          content: `❌ Invalid token. The provided token does not match.`,
        });
        return;
      }
      
      if (rows[0].discord_id && rows[0].discord_id !== discordUserId) {
        await interaction.editReply({
          content: `⚠️ This token is already linked to another Discord account.`,
        });
        return;
      }
      
      const [existingLink] = await dbPool.execute(
        'SELECT * FROM discord_link_table WHERE discord_id = ? AND token != ?',
        [discordUserId, input]
      );
      
      if (existingLink.length > 0) {
        await interaction.editReply({
          content: `⚠️ Your account is already linked with a different token.`,
        });
        return;
      }
      
      const [updateResult] = await dbPool.execute(
        'UPDATE discord_link_table SET discord_id = ?, token = NULL WHERE token = ?',
        [discordUserId, input]
      );
      
      if (updateResult.affectedRows > 0) {
        try {
          const member = await interaction.guild.members.fetch(discordUserId);
          const role = interaction.guild.roles.cache.find(role => role.name === 'Linked');
          
          if (role) {
            await member.roles.add(role);
            console.log(`Assigned "Linked" role to user ${discordUserId}`);
            
            try {
              const [userRows] = await dbPool.execute(
                'SELECT user_id FROM discord_link_table WHERE discord_id = ?',
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

  if (interaction.commandName === 'rcon') {
    if (rconClients.length === 0) {
      await interaction.reply({
        content: '❌ RCON is not configured. Please set RCON_HOST, RCON_PORT, and RCON_PASSWORD in your .env file.',
        ephemeral: true,
      });
      return;
    }

    const command = interaction.options.getString('command');
    
    try {
      await interaction.deferReply({ ephemeral: false });
      
      const sentCount = sendRconCommandToAll(command);
      
      if (sentCount > 0) {
        await interaction.editReply({
          content: `✅ Command sent to ${sentCount} RCON server(s): \`${command}\``,
        });
      } else {
        await interaction.editReply({
          content: `❌ No RCON servers are connected. Please check your RCON configuration.`,
        });
      }
    } catch (error) {
      console.error('Error sending RCON command:', error);
      await interaction.editReply({
        content: `❌ Error sending command to RCON: ${error.message}`,
      });
    }
  }
});

client.on('guildMemberRemove', async (member) => {
  const discordUserId = member.user.id;
  
  try {
    const [userRows] = await dbPool.execute(
      'SELECT user_id FROM discord_link_table WHERE discord_id = ?',
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
    
    const [result] = await dbPool.execute(
      'DELETE FROM discord_link_table WHERE discord_id = ?',
      [discordUserId]
    );
    
    if (result.affectedRows > 0) {
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
    const connection = await dbPool.getConnection();
    console.log('✅ Database connection established');
    connection.release();
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

client.login(token);


