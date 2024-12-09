import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'data', 'bot.db');

// Ensure data directory exists
if (!fs.existsSync(path.join(__dirname, '..', 'data'))) {
   fs.mkdirSync(path.join(__dirname, '..', 'data'));
}

let db;
let serverSettingsCache = new Map();
let lastCacheCleanup = Date.now();
const CACHE_CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 minutes

async function initDatabase() {
   try {
       db = await open({
           filename: dbPath,
           driver: sqlite3.Database
       });

       // Enable WAL mode for better concurrent access
       await db.run('PRAGMA journal_mode = WAL');
       await db.run('PRAGMA foreign_keys = ON');

       await db.run(`
           CREATE TABLE IF NOT EXISTS server_settings (
               guild_id TEXT PRIMARY KEY,
               setup_completed BOOLEAN DEFAULT FALSE,
               mod_role_id TEXT,
               disabled_commands TEXT,
               welcome_channel_id TEXT,
               log_channel_id TEXT,
               warning_threshold INTEGER DEFAULT 3,
               warning_expire_days INTEGER DEFAULT 30,
               cooldown_seconds INTEGER DEFAULT 5,
               welcome_enabled BOOLEAN DEFAULT FALSE,
               rules_channel_id TEXT,
               welcome_role_id TEXT,
               welcome_messages TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
            CREATE TABLE IF NOT EXISTS role_messages (
                message_id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                roles TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS command_permissions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               command_name TEXT,
               role_id TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS quotes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               text TEXT NOT NULL,
               author TEXT NOT NULL,
               quote_date TEXT NOT NULL,
               added_by TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS audit_logs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               action_type TEXT,
               user_id TEXT,
               target_id TEXT,
               details TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS warnings (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               warned_by TEXT NOT NULL,
               reason TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               expires_at TIMESTAMP NULL
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS logs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               action_type TEXT NOT NULL,
               action_details TEXT NOT NULL,
               executed_by TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS welcome_message_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               message TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE INDEX IF NOT EXISTS idx_welcome_history_guild 
           ON welcome_message_history(guild_id)
       `);

       await db.run(`
           CREATE INDEX IF NOT EXISTS idx_guild_cmd 
           ON command_permissions(guild_id, command_name)
       `);

       await db.run(`
           CREATE INDEX IF NOT EXISTS idx_guild_action 
           ON audit_logs(guild_id, action_type)
       `);

       await db.run(`
           CREATE INDEX IF NOT EXISTS idx_warnings_guild_user 
           ON warnings(guild_id, user_id)
       `);

       await db.run(`
           CREATE INDEX IF NOT EXISTS idx_logs_guild 
           ON logs(guild_id)
       `);

       try {
            // Check if quotes table is empty
            const quoteCount = await db.get('SELECT COUNT(*) as count FROM quotes');
            if (quoteCount.count === 0) {
                // Import default quotes from JSON
                const defaultQuotes = JSON.parse(fs.readFileSync('./src/config/quotes.json', 'utf8'));
                
                const stmt = await db.prepare(
                    'INSERT INTO quotes (text, author, quote_date, added_by) VALUES (?, ?, ?, ?)'
                );
        
                for (const quote of defaultQuotes) {
                    await stmt.run(quote.text, quote.author, quote.date, 'SYSTEM');
                }
        
                await stmt.finalize();
                console.log('Default quotes imported successfully');
            }
        } catch (error) {
            console.error('Error importing default quotes:', error);
        }

       console.log('Database initialized');
   } catch (error) {
       console.error('Database initialization error:', error);
       process.exit(1);
   }
}

const database = {
   getServerSettings: async (guildId) => {
       if (serverSettingsCache.has(guildId)) {
           const cached = serverSettingsCache.get(guildId);
           if (Date.now() - lastCacheCleanup > CACHE_CLEANUP_INTERVAL) {
               serverSettingsCache.clear();
               lastCacheCleanup = Date.now();
           }
           return cached;
       }

       const settings = await db.get(
           'SELECT * FROM server_settings WHERE guild_id = ?',
           guildId
       );
       
       if (settings) {
           serverSettingsCache.set(guildId, settings);
       }
       
       return settings;
   },

   updateServerSettings: async (guildId, settings) => {
       serverSettingsCache.delete(guildId);
       
       if (settings.disabled_commands) {
           if (Array.isArray(settings.disabled_commands)) {
               settings.disabled_commands = settings.disabled_commands.join(',');
           }
       } else {
           settings.disabled_commands = '';
       }

       if (settings.welcome_messages && Array.isArray(settings.welcome_messages)) {
           settings.welcome_messages = JSON.stringify(settings.welcome_messages);
       }

       const columns = Object.keys(settings).filter(key => key !== 'guild_id');
       const values = columns.map(col => settings[col]);
       
       const sql = `
           INSERT OR REPLACE INTO server_settings (
               guild_id,
               ${columns.join(',')},
               updated_at
           ) VALUES (
               ?,
               ${columns.map(() => '?').join(',')},
               CURRENT_TIMESTAMP
           )
       `;

       return db.run(sql, [guildId, ...values]);
   },

   getLastWelcomeMessages: async (guildId, limit) => {
       const messages = await db.all(`
           SELECT message 
           FROM welcome_message_history 
           WHERE guild_id = ? 
           ORDER BY created_at DESC 
           LIMIT ?
       `, [guildId, limit]);
       return messages.map(m => m.message);
   },

   addWelcomeMessageToHistory: async (guildId, message) => {
       return db.run(`
           INSERT INTO welcome_message_history (guild_id, message)
           VALUES (?, ?)
       `, [guildId, message]);
   },

   resetServer: async (guildId) => {
       serverSettingsCache.delete(guildId);
       
       const tables = [
           'server_settings',
           'command_permissions',
           'warnings',
           'logs',
           'audit_logs',
           'role_messages',
           'welcome_message_history'
       ];

       try {
           await db.run('BEGIN TRANSACTION');

           for (const table of tables) {
               await db.run(`DELETE FROM ${table} WHERE guild_id = ?`, guildId);
           }

           await db.run('COMMIT');
           return true;
       } catch (error) {
           await db.run('ROLLBACK');
           console.error('Error resetting server:', error);
           return false;
       }
   },

   createRoleMessage: async (data) => {
        return db.run(
            'INSERT INTO role_messages (message_id, guild_id, channel_id, roles) VALUES (?, ?, ?, ?)',
            [data.message_id, data.guild_id, data.channel_id, JSON.stringify(data.roles)]
        );
    },

    getRoleMessage: async (messageId) => {
        const msg = await db.get('SELECT * FROM role_messages WHERE message_id = ?', messageId);
        if (msg) {
            msg.roles = JSON.parse(msg.roles);
        }
        return msg;
    },

    deleteRoleMessage: async (messageId) => {
        return db.run('DELETE FROM role_messages WHERE message_id = ?', messageId);
    },

    getAllRoleMessages: async (guildId) => {
        const messages = await db.all('SELECT * FROM role_messages WHERE guild_id = ?', guildId);
        return messages.map(msg => ({
            ...msg,
            roles: JSON.parse(msg.roles)
        }));
    },

   getQuoteById: async (id) => {
       return db.get('SELECT * FROM quotes WHERE id = ?', [id]);
   },

   getRandomQuote: async (lastQuoteIds = []) => {
       let sql = 'SELECT * FROM quotes';

       if (lastQuoteIds.length > 0) {
           sql += ` WHERE id NOT IN (${lastQuoteIds.join(',')})`;
       }

       sql += ' ORDER BY RANDOM() LIMIT 1';

       return db.get(sql);
   },

   addQuote: async (text, author, quoteDate, addedBy) => {
       const result = await db.run(
           'INSERT INTO quotes (text, author, quote_date, added_by) VALUES (?, ?, ?, ?)',
           [text, author, quoteDate, addedBy]
       );
       return result.lastID;
   },

   removeQuote: async (quoteId) => {
       const result = await db.run('DELETE FROM quotes WHERE id = ?', [quoteId]);
       return result.changes > 0;
   },

   addWarning: async (guildId, userId, warnedBy, reason) => {
       const settings = await database.getServerSettings(guildId);
       const expiresAt = settings?.warning_expire_days > 0 
           ? new Date(Date.now() + (settings.warning_expire_days * 24 * 60 * 60 * 1000)).toISOString()
           : null;

       return db.run(
           'INSERT INTO warnings (guild_id, user_id, warned_by, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
           [guildId, userId, warnedBy, reason, expiresAt]
       );
   },

   getActiveWarnings: async (guildId, userId) => {
       return db.all(
           `SELECT * FROM warnings 
           WHERE guild_id = ? 
           AND user_id = ? 
           AND (expires_at IS NULL OR expires_at > datetime('now')) 
           ORDER BY created_at DESC`,
           [guildId, userId]
       );
   },

   logAction: async (guildId, actionType, userId, details) => {
       return db.run(
           'INSERT INTO audit_logs (guild_id, action_type, user_id, details) VALUES (?, ?, ?, ?)',
           [guildId, actionType, userId, details]
       );
   },

   getCommandStats: async (guildId) => {
       return db.all(
           `SELECT command_name, COUNT(*) as use_count 
           FROM command_cooldowns 
           WHERE guild_id = ? 
           GROUP BY command_name`,
           guildId
       );
   },

   getRecentWarnings: async (guildId, limit = 10) => {
       return db.all(
           'SELECT * FROM warnings WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?',
           [guildId, limit]
       );
   },

   clearExpiredWarnings: async () => {
       return db.run(
           `DELETE FROM warnings 
           WHERE expires_at IS NOT NULL 
           AND expires_at < datetime('now')`
       );
   },

   logRoleAssignment: async (guildId, userId, roleId, type) => {
       return db.run(
           `INSERT INTO audit_logs 
           (guild_id, action_type, user_id, target_id, details) 
           VALUES (?, 'ROLE_ASSIGN', ?, ?, ?)`,
           [guildId, userId, roleId, `Auto-assigned ${type} role`]
       );
   },

   logWelcome: async (guildId, userId, message) => {
       return db.run(
           `INSERT INTO logs 
           (guild_id, user_id, action_type, action_details, executed_by) 
           VALUES (?, ?, 'WELCOME', ?, 'SYSTEM')`,
           [guildId, userId, message]
       );
   }
};

// Initialize database
await initDatabase();

// Cleanup interval
setInterval(async () => {
   await database.clearExpiredWarnings();
   serverSettingsCache.clear();
}, 6 * 60 * 60 * 1000);

export default database;