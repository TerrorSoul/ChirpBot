import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client, GatewayIntentBits } from 'discord.js';
import { initHandlers } from './src/handlers/eventHandler.js';
import db from './src/database/index.js';
import createReminderManager from './src/utils/reminderManager.js';
import createTimeoutManager from './src/utils/timeoutManager.js';
import createCountdownManager from './src/utils/countdownManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, 'config', '.env') });

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.DirectMessages,
    ],
});

// Attach database to client
client.db = db;

// Initialize and attach all managers
client.reminderManager = createReminderManager(client, db);
client.timeoutManager = createTimeoutManager(client, db);
client.countdownManager = createCountdownManager(client, db);

// Initialize managers when client is ready (handled in eventHandler.js)

initHandlers(client);

client.on('error', error => {
    console.error('Discord client error:', error);
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down...');
    
    // Cleanup all managers
    if (client.reminderManager) {
        client.reminderManager.cleanup();
    }
    if (client.timeoutManager) {
        client.timeoutManager.cleanup();
    }
    if (client.countdownManager) {
        client.countdownManager.cleanup();
    }
    
    if (db.shutdown) {
        await db.shutdown();
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down...');
    
    // Cleanup all managers
    if (client.reminderManager) {
        client.reminderManager.cleanup();
    }
    if (client.timeoutManager) {
        client.timeoutManager.cleanup();
    }
    if (client.countdownManager) {
        client.countdownManager.cleanup();
    }
    
    if (db.shutdown) {
        await db.shutdown();
    }
    process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);