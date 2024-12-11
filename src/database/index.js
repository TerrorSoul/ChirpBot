// database/index.js
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

       await db.run('PRAGMA journal_mode = WAL');
       await db.run('PRAGMA foreign_keys = ON');

       // Server Settings
       await db.run(`
           CREATE TABLE IF NOT EXISTS server_settings (
               guild_id TEXT PRIMARY KEY,
               setup_completed BOOLEAN DEFAULT FALSE,
               mod_role_id TEXT,
               disabled_commands TEXT,
               welcome_channel_id TEXT,
               log_channel_id TEXT,
               reports_channel_id TEXT,
               warning_threshold INTEGER DEFAULT 3,
               warning_expire_days INTEGER DEFAULT 30,
               cooldown_seconds INTEGER DEFAULT 5,
               welcome_enabled BOOLEAN DEFAULT FALSE,
               rules_channel_id TEXT,
               welcome_role_id TEXT,
               welcome_messages TEXT,
               spam_protection BOOLEAN DEFAULT TRUE,
               spam_threshold INTEGER DEFAULT 5,
               spam_interval INTEGER DEFAULT 5000,
               spam_warning_message TEXT DEFAULT 'Please do not spam!',
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Command Packs
       await db.run(`
           CREATE TABLE IF NOT EXISTS command_packs (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               name TEXT NOT NULL UNIQUE,
               description TEXT NOT NULL,
               category TEXT NOT NULL,
               is_core BOOLEAN DEFAULT FALSE,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       await db.run(`
           CREATE TABLE IF NOT EXISTS server_command_packs (
            guild_id TEXT NOT NULL,
            pack_id INTEGER NOT NULL,
            enabled BOOLEAN DEFAULT TRUE,
            enabled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (guild_id, pack_id),
            FOREIGN KEY (pack_id) REFERENCES command_packs(id) ON DELETE CASCADE
           )
       `);

       // Role Messages
       await db.run(`
           CREATE TABLE IF NOT EXISTS role_messages (
               message_id TEXT PRIMARY KEY,
               guild_id TEXT NOT NULL,
               channel_id TEXT NOT NULL,
               roles TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Command Permissions
       await db.run(`
           CREATE TABLE IF NOT EXISTS command_permissions (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               command_name TEXT,
               role_id TEXT,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Reports
       await db.run(`
           CREATE TABLE IF NOT EXISTS reports (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               reporter_id TEXT NOT NULL,
               reported_user_id TEXT,
               message_id TEXT,
               channel_id TEXT,
               type TEXT NOT NULL,
               reason TEXT NOT NULL,
               status TEXT DEFAULT 'PENDING',
               resolved_by TEXT,
               resolved_at TIMESTAMP,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Quotes
       await db.run(`
           CREATE TABLE IF NOT EXISTS quotes (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               text TEXT NOT NULL,
               author TEXT NOT NULL,
               quote_date TEXT NOT NULL,
               added_by TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               FOREIGN KEY (guild_id) REFERENCES server_settings(guild_id) ON DELETE CASCADE
           )
       `);

       // Audit Logs
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

       // Warnings
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

       // Logs
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

       // Welcome Message History
       await db.run(`
           CREATE TABLE IF NOT EXISTS welcome_message_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               message TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Server Backups
       await db.run(`
           CREATE TABLE IF NOT EXISTS server_backups (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               backup_data TEXT NOT NULL,
               created_by TEXT NOT NULL,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Spam Warnings
       await db.run(`
           CREATE TABLE IF NOT EXISTS spam_warnings (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               warning_count INTEGER DEFAULT 1,
               last_warning TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
               created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
       `);

       // Create indices
       await db.run(`CREATE INDEX IF NOT EXISTS idx_welcome_history_guild ON welcome_message_history(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_quotes_guild ON quotes(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_command_packs_name ON command_packs(name)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_server_command_packs ON server_command_packs(guild_id, pack_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_guild_cmd ON command_permissions(guild_id, command_name)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_guild_action ON audit_logs(guild_id, action_type)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings(guild_id, user_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_logs_guild ON logs(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_spam_warnings_guild_user ON spam_warnings(guild_id, user_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_server_backups_guild ON server_backups(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_reports_guild ON reports(guild_id, status)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_reports_user ON reports(reported_user_id)`);

       console.log('Database initialized');
   } catch (error) {
       console.error('Database initialization error:', error);
       process.exit(1);
   }
}

const database = {
   // Transaction Management
   beginTransaction: async () => await db.run('BEGIN TRANSACTION'),
   commitTransaction: async () => await db.run('COMMIT'),
   rollbackTransaction: async () => await db.run('ROLLBACK'),

   // Server Settings
   getServerSettings: async (guildId) => {
       if (serverSettingsCache.has(guildId)) {
           const cached = serverSettingsCache.get(guildId);
           if (Date.now() - lastCacheCleanup > CACHE_CLEANUP_INTERVAL) {
               serverSettingsCache.clear();
               lastCacheCleanup = Date.now();
           }
           return cached;
       }

       const settings = await db.get('SELECT * FROM server_settings WHERE guild_id = ?', guildId);
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

       return await db.run(sql, [guildId, ...values]);
   },

   // Command Pack Management
   registerCommandPack: async (packName, description, category, isCore) => {
        try {
            // First try to get existing pack
            const existingPack = await db.get(
                'SELECT id FROM command_packs WHERE name = ?',
                [packName]
            );

            if (existingPack) {
                // Update existing pack
                await db.run(`
                    UPDATE command_packs 
                    SET description = ?, category = ?, is_core = ?
                    WHERE name = ?
                `, [description, category, isCore, packName]);
                return true;
            }

            // Insert new pack only if it doesn't exist
            await db.run(`
                INSERT INTO command_packs 
                (name, description, category, is_core) 
                VALUES (?, ?, ?, ?)
            `, [packName, description, category, isCore]);
            
            return true;
        } catch (error) {
            console.error('Error registering command pack:', error);
            return false;
        }
    },

    getEnabledPacks: async (guildId) => {
        try {
            // Get all packs that are either core OR enabled for this guild
            const enabledPacks = await db.all(`
                SELECT DISTINCT cp.* 
                FROM command_packs cp
                LEFT JOIN server_command_packs scp ON cp.id = scp.pack_id AND scp.guild_id = ?
                WHERE cp.is_core = 1 OR scp.enabled = 1
            `, [guildId]);
            
            console.log(`Enabled packs for guild ${guildId}:`, enabledPacks);
            return enabledPacks;
        } catch (error) {
            console.error('Error getting enabled packs:', error);
            return [];
        }
    },

   getAllPacks: async () => {
       try {
           return await db.all(`
               SELECT * FROM command_packs 
               ORDER BY category, name
           `);
       } catch (error) {
           console.error('Error getting all packs:', error);
           return [];
       }
   },

   isPackEnabled: async (guildId, packName) => {
        try {
            const result = await db.get(`
                SELECT cp.id, cp.name, cp.is_core, COALESCE(scp.enabled, 0) as enabled
                FROM command_packs cp
                LEFT JOIN server_command_packs scp ON cp.id = scp.pack_id AND scp.guild_id = ?
                WHERE cp.name = ?
            `, [guildId, packName]);

            console.log(`Pack enable check for ${packName} in guild ${guildId}:`, result);

            // If pack is core or explicitly enabled (1)
            return result?.is_core === 1 || result?.enabled === 1;
        } catch (error) {
            console.error('Error checking pack enabled status:', error);
            return false;
        }
    },

    enablePack: async (guildId, packName) => {
        try {
            console.log(`Enabling pack ${packName} for guild ${guildId}`);
            
            const pack = await db.get('SELECT id FROM command_packs WHERE name = ?', [packName]);
            if (!pack) {
                console.error(`Pack ${packName} not found in database`);
                return false;
            }
    
            console.log(`Found pack with ID ${pack.id}`);
    
            // Modified this query to explicitly set enabled = 1
            const result = await db.run(`
                INSERT OR REPLACE INTO server_command_packs 
                (guild_id, pack_id, enabled) 
                VALUES (?, ?, 1)
            `, [guildId, pack.id]);
    
            console.log(`Enable pack result:`, result);
            
            // Verify the pack was enabled
            const verification = await db.get(
                'SELECT * FROM server_command_packs WHERE guild_id = ? AND pack_id = ?',
                [guildId, pack.id]
            );
            console.log('Verification of pack enablement:', verification);
    
            return true;
        } catch (error) {
            console.error('Error enabling pack:', error);
            return false;
        }
    },

   disablePack: async (guildId, packName) => {
       try {
           const pack = await db.get(`
               SELECT id, is_core 
               FROM command_packs 
               WHERE name = ?
           `, [packName]);

           if (!pack || pack.is_core) return false;

           await db.run(`
               DELETE FROM server_command_packs
               WHERE guild_id = ? AND pack_id = ?
           `, [guildId, pack.id]);

           return true;
       } catch (error) {
           console.error('Error disabling pack:', error);
           return false;
       }
   },

   // Quote Management
   importDefaultQuotes: async (guildId, packName) => {
       const packPath = path.join(__dirname, '..', 'commands', 'packs', packName, 'quotes.json');
       if (!fs.existsSync(packPath)) return;

       try {
           const quotes = JSON.parse(fs.readFileSync(packPath, 'utf8'));
           
           for (const quote of quotes) {
               await db.run(`
                   INSERT INTO quotes (guild_id, text, author, quote_date, added_by)
                   VALUES (?, ?, ?, ?, ?)
               `, [guildId, quote.text, quote.author, quote.date, 'SYSTEM']);
           }
       } catch (error) {
           console.error('Error importing quotes:', error);
           throw error;
       }
   },

   getQuoteById: async (guildId, id) => {
       return await db.get(
           'SELECT * FROM quotes WHERE guild_id = ? AND id = ?',
           [guildId, id]
       );
   },

   getRandomQuote: async (guildId, excludeIds = []) => {
       let query = 'SELECT * FROM quotes WHERE guild_id = ?';
       let params = [guildId];
       
       if (excludeIds.length > 0) {
           query += ' AND id NOT IN (' + excludeIds.map(() => '?').join(',') + ')';
           params = params.concat(excludeIds);
       }
       
       query += ' ORDER BY RANDOM() LIMIT 1';
       return await db.get(query, params);
   },

   addQuote: async (guildId, text, author, date, addedBy) => {
       const result = await db.run(`
           INSERT INTO quotes (guild_id, text, author, quote_date, added_by)
           VALUES (?, ?, ?, ?, ?)
       `, [guildId, text, author, date, addedBy]);
       return result.lastID;
   },

   removeQuote: async (guildId, id) => {
       const result = await db.run(
           'DELETE FROM quotes WHERE guild_id = ? AND id = ?',
           [guildId, id]
       );
       return result.changes > 0;
   },

   // Role Management
   createRoleMessage: async (data) => {
       return await db.run(
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
       return await db.run('DELETE FROM role_messages WHERE message_id = ?', messageId);
   },

   getAllRoleMessages: async (guildId) => {
       const messages = await db.all('SELECT * FROM role_messages WHERE guild_id = ?', guildId);
       return messages.map(msg => ({
           ...msg,
           roles: JSON.parse(msg.roles)
       }));
   },

   // Warning System
   addWarning: async (guildId, userId, warnedBy, reason) => {
       const settings = await database.getServerSettings(guildId);
       const expiresAt = settings?.warning_expire_days > 0 
           ? new Date(Date.now() + (settings.warning_expire_days * 24 * 60 * 60 * 1000)).toISOString()
           : null;

       return await db.run(
           'INSERT INTO warnings (guild_id, user_id, warned_by, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
           [guildId, userId, warnedBy, reason, expiresAt]
       );
   },

   getActiveWarnings: async (guildId, userId) => {
       return await db.all(
           `SELECT * FROM warnings 
           WHERE guild_id = ? 
           AND user_id = ? 
           AND (expires_at IS NULL OR expires_at > datetime('now')) 
           ORDER BY created_at DESC`,
           [guildId, userId]
       );
   },

   getAllWarnings: async (guildId, userId) => {
       return await db.all(
           'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
           [guildId, userId]
       );
   },

   clearWarnings: async (guildId, userId) => {
       return await db.run(
           'DELETE FROM warnings WHERE guild_id = ? AND user_id = ?',
           [guildId, userId]
       );
   },

   // Spam Protection
   addSpamWarning: async (guildId, userId) => {
       const existing = await db.get(
           'SELECT * FROM spam_warnings WHERE guild_id = ? AND user_id = ?',
           [guildId, userId]
       );

       if (existing) {
           return await db.run(
               `UPDATE spam_warnings 
               SET warning_count = warning_count + 1, 
                   last_warning = CURRENT_TIMESTAMP 
               WHERE guild_id = ? AND user_id = ?`,
               [guildId, userId]
           );
       }

       return await db.run(
           'INSERT INTO spam_warnings (guild_id, user_id) VALUES (?, ?)',
           [guildId, userId]
       );
   },

   getSpamWarnings: async (guildId, userId) => {
       return await db.get(
           'SELECT * FROM spam_warnings WHERE guild_id = ? AND user_id = ?',
           [guildId, userId]
       );
   },

   resetSpamWarnings: async (guildId, userId) => {
       return await db.run(
           'DELETE FROM spam_warnings WHERE guild_id = ? AND user_id = ?',
           [guildId, userId]
       );
   },

   // Reports System
   createReport: async (reportData) => {
       return await db.run(`
           INSERT INTO reports (
               guild_id, reporter_id, reported_user_id, message_id, 
               channel_id, type, reason
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
           [
               reportData.guild_id,
               reportData.reporter_id,
               reportData.reported_user_id,
               reportData.message_id,
               reportData.channel_id,
               reportData.type,
               reportData.reason
           ]
       );
   },

   getReport: async (reportId) => {
       return await db.get('SELECT * FROM reports WHERE id = ?', [reportId]);
   },

   getPendingReports: async (guildId) => {
       return await db.all(
           'SELECT * FROM reports WHERE guild_id = ? AND status = ? ORDER BY created_at DESC',
           [guildId, 'PENDING']
       );
   },

   resolveReport: async (reportId, resolvedBy) => {
       return await db.run(`
           UPDATE reports 
           SET status = 'RESOLVED', 
               resolved_by = ?, 
               resolved_at = CURRENT_TIMESTAMP 
           WHERE id = ?`,
           [resolvedBy, reportId]
       );
   },

   deleteReport: async (reportId) => {
       return await db.run('DELETE FROM reports WHERE id = ?', [reportId]);
   },

   getUserReports: async (guildId, userId) => {
       return await db.all(`
           SELECT * FROM reports 
           WHERE guild_id = ? 
           AND (reporter_id = ? OR reported_user_id = ?) 
           ORDER BY created_at DESC`,
           [guildId, userId, userId]
       );
   },

   // Backup Management
   createBackup: async (guildId, backupData, createdBy) => {
       return await db.run(
           'INSERT INTO server_backups (guild_id, backup_data, created_by) VALUES (?, ?, ?)',
           [guildId, JSON.stringify(backupData), createdBy]
       );
   },

   getLatestBackup: async (guildId) => {
       return await db.get(
           'SELECT * FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
           [guildId]
       );
   },

   importBackup: async (guildId, backupData) => {
       try {
           await database.beginTransaction();

           if (backupData.settings) {
               await database.updateServerSettings(guildId, backupData.settings);
           }

           if (backupData.warnings) {
               const stmt = await db.prepare(
                   `INSERT INTO warnings 
                   (guild_id, user_id, warned_by, reason, created_at, expires_at) 
                   VALUES (?, ?, ?, ?, ?, ?)`
               );

               for (const warning of backupData.warnings) {
                   await stmt.run([
                       guildId,
                       warning.user_id,
                       warning.warned_by,
                       warning.reason,
                       warning.created_at,
                       warning.expires_at
                   ]);
               }

               await stmt.finalize();
           }

           if (backupData.roleMessages) {
               const stmt = await db.prepare(
                   `INSERT INTO role_messages 
                   (message_id, guild_id, channel_id, roles) 
                   VALUES (?, ?, ?, ?)`
               );

               for (const msg of backupData.roleMessages) {
                   await stmt.run([
                       msg.message_id,
                       guildId,
                       msg.channel_id,
                       JSON.stringify(msg.roles)
                   ]);
               }

               await stmt.finalize();
           }

           await database.commitTransaction();
           return true;
       } catch (error) {
           await database.rollbackTransaction();
           throw error;
       }
   },

   // Server Management
   resetServer: async (guildId) => {
        serverSettingsCache.delete(guildId);
        
        const tables = [
            'server_settings',
            'quotes',
            'warnings',
            'logs',
            'role_messages',
            'welcome_message_history',
            'spam_warnings',
            'reports',
            'server_command_packs'
        ];

        try {
            await database.beginTransaction();

            for (const table of tables) {
                await db.run(`DELETE FROM ${table} WHERE guild_id = ?`, guildId);
            }

            await database.commitTransaction();
            return true;
        } catch (error) {
            await database.rollbackTransaction();
            console.error('Error resetting server:', error);
            return false;
        }
    },

   resetServerForSetup: async (guildId) => {
        serverSettingsCache.delete(guildId);
        
        const tables = [
            'server_settings',
            'quotes',
            'warnings',
            'logs',
            'role_messages',
            'welcome_message_history',
            'spam_warnings',
            'reports'
        ];

        try {
            await database.beginTransaction();

            for (const table of tables) {
                await db.run(`DELETE FROM ${table} WHERE guild_id = ?`, guildId);
            }

            await database.commitTransaction();
            return true;
        } catch (error) {
            await database.rollbackTransaction();
            console.error('Error resetting server for setup:', error);
            return false;
        }
    },

   // Utility Functions
   clearExpiredWarnings: async () => {
       return await db.run(
           `DELETE FROM warnings 
           WHERE expires_at IS NOT NULL 
           AND expires_at < datetime('now')`
       );
   },

   clearOldBackups: async (guildId, keepCount = 5) => {
       return await db.run(
           `DELETE FROM server_backups 
           WHERE guild_id = ? 
           AND id NOT IN (
               SELECT id FROM server_backups 
               WHERE guild_id = ? 
               ORDER BY created_at DESC 
               LIMIT ?
           )`,
           [guildId, guildId, keepCount]
       );
   },

   clearOldSpamWarnings: async (hours = 24) => {
       return await db.run(
           `DELETE FROM spam_warnings 
           WHERE last_warning < datetime('now', '-' || ? || ' hours')`,
           [hours]
       );
   },

   clearOldResolvedReports: async (days = 30) => {
       return await db.run(
           `DELETE FROM reports 
           WHERE status = 'RESOLVED' 
           AND resolved_at < datetime('now', '-' || ? || ' days')`,
           [days]
       );
   },

   // Logging System
   logAction: async (guildId, actionType, userId, details) => {
       return await db.run(
           'INSERT INTO audit_logs (guild_id, action_type, user_id, details) VALUES (?, ?, ?, ?)',
           [guildId, actionType, userId, details]
       );
   },

   getModActions: async (guildId, userId) => {
       return await db.all(
           `SELECT * FROM audit_logs 
           WHERE guild_id = ? 
           AND (user_id = ? OR target_id = ?)
           AND action_type IN ('BAN', 'KICK', 'TIMEOUT', 'WARN', 'MUTE', 'UNMUTE')
           ORDER BY created_at DESC
           LIMIT 10`,
           [guildId, userId, userId]
       );
   },

   // Stats and Reporting
   getServerStats: async (guildId) => {
       const stats = {
           warningCount: 0,
           activeWarnings: 0,
           spamWarnings: 0,
           backupCount: 0,
           moderationActions: 0,
           pendingReports: 0
       };

       const results = await Promise.all([
           db.get('SELECT COUNT(*) as count FROM warnings WHERE guild_id = ?', [guildId]),
           db.get('SELECT COUNT(*) as count FROM warnings WHERE guild_id = ? AND (expires_at IS NULL OR expires_at > datetime(\'now\'))', [guildId]),
           db.get('SELECT COUNT(*) as count FROM spam_warnings WHERE guild_id = ?', [guildId]),
           db.get('SELECT COUNT(*) as count FROM server_backups WHERE guild_id = ?', [guildId]),
           db.get('SELECT COUNT(*) as count FROM audit_logs WHERE guild_id = ? AND action_type IN (\'BAN\', \'KICK\', \'TIMEOUT\', \'WARN\', \'MUTE\')', [guildId]),
           db.get('SELECT COUNT(*) as count FROM reports WHERE guild_id = ? AND status = \'PENDING\'', [guildId])
       ]);

       stats.warningCount = results[0].count;
       stats.activeWarnings = results[1].count;
       stats.spamWarnings = results[2].count;
       stats.backupCount = results[3].count;
       stats.moderationActions = results[4].count;
       stats.pendingReports = results[5].count;

       return stats;
   }
};

// Initialize database
await initDatabase();

// Cleanup intervals
setInterval(async () => {
   await database.clearExpiredWarnings();
   await database.clearOldSpamWarnings();
   await database.clearOldResolvedReports();
   serverSettingsCache.clear();
}, 6 * 60 * 60 * 1000); // Every 6 hours

export default database;