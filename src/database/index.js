// database/index.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearFilterCache, getCachedFilter, setCachedFilter } from '../utils/filterCache.js';

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

async function updateDatabaseSchema() {
   try {
       // Get existing tables
       const tables = await db.all(`
           SELECT name, sql 
           FROM sqlite_master 
           WHERE type='table' AND sql IS NOT NULL
       `);

       // Add new content filter columns if they don't exist
       await db.run(`ALTER TABLE server_settings 
           ADD COLUMN content_filter_enabled BOOLEAN DEFAULT FALSE`).catch(() => {});
       await db.run(`ALTER TABLE server_settings 
           ADD COLUMN content_filter_log_suspicious BOOLEAN DEFAULT TRUE`).catch(() => {});
       await db.run(`ALTER TABLE server_settings 
           ADD COLUMN content_filter_notify_user BOOLEAN DEFAULT TRUE`).catch(() => {});
       await db.run(`ALTER TABLE server_settings 
           ADD COLUMN content_filter_notify_message TEXT 
           DEFAULT 'Your message was removed because it contained inappropriate content.'`).catch(() => {});
       await db.run(`ALTER TABLE role_messages 
            ADD COLUMN selection_type TEXT DEFAULT 'multi'`).catch(() => {});

       for (const table of tables) {
           // Get current columns in the actual table
           const currentColumns = await db.all(`PRAGMA table_info(${table.name})`);
           const currentColumnNames = new Set(currentColumns.map(col => col.name));

           // Parse the CREATE TABLE statement to get intended columns
           const createTableMatch = table.sql.match(/CREATE TABLE.*?\((.*?)\)/s);
           if (!createTableMatch) continue;

           const columnDefinitions = createTableMatch[1]
               .split(',')
               .map(col => col.trim())
               // Ignore table constraints (PRIMARY KEY, FOREIGN KEY, UNIQUE)
               .filter(col => !col.startsWith('PRIMARY KEY') && 
                            !col.startsWith('FOREIGN KEY') && 
                            !col.startsWith('UNIQUE'));

           // Extract column names and their definitions
           for (const columnDef of columnDefinitions) {
               // Skip if line is empty after trimming
               if (!columnDef) continue;
               
               // Split on first space to get column name
               const columnName = columnDef.split(/\s+/)[0];
               
               // Skip if column name is empty or not valid
               if (!columnName || columnName.includes('(')) continue;
               
               // Skip if column already exists
               if (currentColumnNames.has(columnName)) continue;

               // Extract the column definition without constraints
               const definition = columnDef
                   .replace(/PRIMARY KEY/i, '')
                   .replace(/REFERENCES.*?$/i, '')
                   .replace(/UNIQUE/i, '')
                   .trim();

               console.log(`Adding missing column ${columnName} to ${table.name}`);
               
               try {
                   await db.run(`ALTER TABLE ${table.name} ADD COLUMN ${definition}`);
                   console.log(`Successfully added column ${columnName} to ${table.name}`);
               } catch (error) {
                   console.error(`Error adding column ${columnName} to ${table.name}:`, error);
               }
           }
       }

   } catch (error) {
       console.error('Error updating database schema:', error);
   }
}

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
                channel_restrictions_enabled BOOLEAN DEFAULT FALSE,
                content_filter_enabled BOOLEAN DEFAULT FALSE,
                content_filter_log_suspicious BOOLEAN DEFAULT TRUE,
                content_filter_notify_user BOOLEAN DEFAULT TRUE,
                content_filter_notify_message TEXT DEFAULT 'Your message contained inappropriate content.',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

       await db.run(`
            CREATE TABLE IF NOT EXISTS filtered_terms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                term TEXT NOT NULL,
                severity TEXT NOT NULL,
                added_by TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, term)
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

       await db.run(`
        CREATE TABLE IF NOT EXISTS block_of_the_day (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            block_title TEXT NOT NULL,
            shown_at DATE DEFAULT CURRENT_DATE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.run(`
            CREATE TABLE IF NOT EXISTS block_games (
                channel_id TEXT PRIMARY KEY,
                block_title TEXT NOT NULL,
                hints_given INTEGER DEFAULT 0,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        await db.run(`
            CREATE TABLE IF NOT EXISTS channel_permissions (
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                command_category TEXT,
                command_name TEXT,
                PRIMARY KEY (guild_id, channel_id, command_category, command_name)
        )`);

        await db.run(`
            CREATE TABLE IF NOT EXISTS time_based_roles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                role_id TEXT NOT NULL,
                days_required INTEGER NOT NULL,
                is_custom_created BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, role_id)
            )
        `);

        await db.run(`
            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT,
                thread_id TEXT,
                status TEXT DEFAULT 'OPEN',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP,
                closed_by TEXT
            )`);
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS ticket_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                author_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE
            )`);
        
        await db.run(`
            CREATE TABLE IF NOT EXISTS blocked_ticket_users (
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                blocked_by TEXT NOT NULL,
                reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (guild_id, user_id)
            )`);

       // Create indices
       await db.run(`CREATE INDEX IF NOT EXISTS idx_welcome_history_guild ON welcome_message_history(guild_id)`);
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
       await db.run('CREATE INDEX IF NOT EXISTS idx_botd_date ON block_of_the_day(shown_at)');
       await db.run(`CREATE INDEX IF NOT EXISTS idx_filtered_terms_guild ON filtered_terms(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_guild ON tickets(guild_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_tickets_thread ON tickets(thread_id)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_ticket_messages ON ticket_messages(ticket_id)`);

       await updateDatabaseSchema();
       console.log('Database ready');
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

   getLastWelcomeMessages: async (guildId, limit = 5) => {
        try {
            const messages = await db.all(`
                SELECT message 
                FROM welcome_message_history 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);
            
            return messages.map(m => m.message);
        } catch (error) {
            console.error('Error getting last welcome messages:', error);
            return [];
        }
    },

    addWelcomeMessageToHistory: async (guildId, message) => {
        try {
            await db.run(`
                INSERT INTO welcome_message_history (guild_id, message)
                VALUES (?, ?)
            `, [guildId, message]);
            
            // Keep only the last 10 messages per guild
            await db.run(`
                DELETE FROM welcome_message_history 
                WHERE guild_id = ? 
                AND id NOT IN (
                    SELECT id 
                    FROM welcome_message_history 
                    WHERE guild_id = ? 
                    ORDER BY created_at DESC 
                    LIMIT 10
                )
            `, [guildId, guildId]);
            
            return true;
        } catch (error) {
            console.error('Error adding welcome message to history:', error);
            return false;
        }
    },

    logWelcome: async (guildId, userId, message) => {
        return await db.run(`
            INSERT INTO logs (
                guild_id, 
                user_id, 
                action_type, 
                action_details, 
                executed_by
            ) VALUES (?, ?, 'WELCOME', ?, 'SYSTEM')`,
            [guildId, userId, message]
        );
    },

    logRoleAssignment: async (guildId, userId, roleId, reason = 'welcome') => {
        return await db.run(`
            INSERT INTO logs (
                guild_id, 
                user_id, 
                action_type, 
                action_details, 
                executed_by
            ) VALUES (?, ?, 'ROLE_ASSIGN', ?, 'SYSTEM')`,
            [guildId, userId, `Role ${roleId} assigned (${reason})`]
        );
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

   getReport: async (messageId) => {
        return await db.get('SELECT * FROM reports WHERE message_id = ?', [messageId]);
    },

   getPendingReports: async (guildId) => {
       return await db.all(
           'SELECT * FROM reports WHERE guild_id = ? AND status = ? ORDER BY created_at DESC',
           [guildId, 'PENDING']
       );
   },

   hasActiveReports: async (userId, guildId) => {
    const pendingReports = await db.get(`
        SELECT COUNT(*) as count 
        FROM reports 
        WHERE guild_id = ? 
        AND reported_user_id = ? 
        AND status = 'PENDING'`, 
        [guildId, userId]
    );
    return pendingReports.count > 0;
},
resolveReport: async (reportId, resolvedBy) => {
    try {
        console.log('Starting report resolution for message ID:', reportId);
        await database.beginTransaction();

        // Get report info before updating
        const report = await db.get('SELECT reported_user_id, guild_id FROM reports WHERE message_id = ?', [reportId]);
        console.log('Found report:', report);

        // Update the report status
        await db.run(`
            UPDATE reports 
            SET status = 'RESOLVED', 
                resolved_by = ?, 
                resolved_at = CURRENT_TIMESTAMP 
            WHERE message_id = ?`,
            [resolvedBy, reportId]
        );

        // Check remaining active reports for this user
        const remainingReports = await db.get(`
            SELECT COUNT(*) as count 
            FROM reports 
            WHERE guild_id = ? 
            AND reported_user_id = ? 
            AND status = 'PENDING'
            AND message_id != ?`,
            [report.guild_id, report.reported_user_id, reportId]
        );
        
        console.log('Remaining active reports:', remainingReports.count);

        await database.commitTransaction();
        return {
            success: true,
            hasOtherActiveReports: remainingReports.count > 0,
            reportedUserId: report.reported_user_id
        };
    } catch (error) {
        await database.rollbackTransaction();
        console.error('Error resolving report:', error);
        return {
            success: false,
            error
        };
    }
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
        try {
            // First get all warnings that are about to expire
            const expiringWarnings = await db.all(`
                SELECT w.*, g.log_channel_id 
                FROM warnings w
                JOIN server_settings g ON w.guild_id = g.guild_id
                WHERE w.expires_at IS NOT NULL 
                AND w.expires_at < datetime('now')
            `);

            // Group warnings by guild and user for logging
            const warningsByGuildAndUser = expiringWarnings.reduce((acc, warning) => {
                const key = `${warning.guild_id}-${warning.user_id}`;
                if (!acc[key]) {
                    acc[key] = {
                        guildId: warning.guild_id,
                        userId: warning.user_id,
                        logChannelId: warning.log_channel_id,
                        count: 0
                    };
                }
                acc[key].count++;
                return acc;
            }, {});

            // Delete the expired warnings
            await db.run(`
                DELETE FROM warnings 
                WHERE expires_at IS NOT NULL 
                AND expires_at < datetime('now')
            `);

            // Log for each affected user
            for (const key of Object.keys(warningsByGuildAndUser)) {
                const { guildId, userId, count } = warningsByGuildAndUser[key];
                
                const guild = await client.guilds.fetch(guildId).catch(() => null);
                if (!guild) continue;

                const user = await client.users.fetch(userId).catch(() => null);
                if (!user) continue;

                await loggingService.logEvent(guild, 'WARNINGS_EXPIRED', {
                    userId: userId,
                    userTag: user.tag,
                    warningsExpired: count,
                    reason: 'Warning(s) expired'
                });
            }
        } catch (error) {
            console.error('Error clearing expired warnings:', error);
        }
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
   },

   getCurrentBOTD: async () => {
        const today = new Date().toISOString().split('T')[0];
        return await db.get(
            'SELECT * FROM block_of_the_day WHERE shown_at = ?',
            [today]
        );
    },

    getRecentBOTDs: async (days = 30) => {
        return await db.all(`
            SELECT block_title 
            FROM block_of_the_day 
            WHERE shown_at >= date('now', ?) 
            ORDER BY shown_at DESC`,
            [`-${days} days`]
        );
    },

    setBlockOfTheDay: async (blockTitle) => {
        const today = new Date().toISOString().split('T')[0];
        return await db.run(
            'INSERT INTO block_of_the_day (block_title, shown_at) VALUES (?, ?)',
            [blockTitle, today]
        );
    },

    startBlockGame: async (channelId, blockTitle) => {
        return await db.run(
            'INSERT OR REPLACE INTO block_games (channel_id, block_title, hints_given) VALUES (?, ?, 0)',
            [channelId, blockTitle]
        );
    },
    
    getActiveGame: async (channelId) => {
        return await db.get(
            'SELECT * FROM block_games WHERE channel_id = ?',
            [channelId]
        );
    },
    
    incrementHints: async (channelId) => {
        return await db.run(
            'UPDATE block_games SET hints_given = hints_given + 1 WHERE channel_id = ?',
            [channelId]
        );
    },
    
    endGame: async (channelId) => {
        return await db.run(
            'DELETE FROM block_games WHERE channel_id = ?',
            [channelId]
        );
    },

    getChannelPermissions: async (guildId, channelId) => {
        return await db.all(
            'SELECT command_category FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_category IS NOT NULL',
            [guildId, channelId]
        );
    },
    
    getChannelCommandPermissions: async (guildId, channelId) => {
        return await db.all(
            'SELECT command_name FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_name IS NOT NULL',
            [guildId, channelId]
        );
    },
    
    getAllChannelPermissions: async (guildId) => {
        return await db.all(
            'SELECT channel_id, command_category, command_name FROM channel_permissions WHERE guild_id = ?',
            [guildId]
        );
    },
    
    setChannelPermission: async (guildId, channelId, category) => {
        return await db.run(
            'INSERT OR REPLACE INTO channel_permissions (guild_id, channel_id, command_category) VALUES (?, ?, ?)',
            [guildId, channelId, category]
        );
    },
    
    setChannelCommandPermission: async (guildId, channelId, commandName) => {
        return await db.run(
            'INSERT OR REPLACE INTO channel_permissions (guild_id, channel_id, command_name) VALUES (?, ?, ?)',
            [guildId, channelId, commandName]
        );
    },
    
    removeChannelPermission: async (guildId, channelId, category) => {
        return await db.run(
            'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_category = ?',
            [guildId, channelId, category]
        );
    },
    
    removeChannelCommandPermission: async (guildId, channelId, commandName) => {
        return await db.run(
            'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_name = ?',
            [guildId, channelId, commandName]
        );
    },
    
    clearChannelPermissions: async (guildId, channelId) => {
        return await db.run(
            'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ?',
            [guildId, channelId]
        );
    },
    
    getChannelsByPermission: async (guildId, category) => {
        return await db.all(
            'SELECT DISTINCT channel_id FROM channel_permissions WHERE guild_id = ? AND command_category = ?',
            [guildId, category]
        );
    },
    
    getChannelsByCommand: async (guildId, commandName) => {
        return await db.all(
            'SELECT DISTINCT channel_id FROM channel_permissions WHERE guild_id = ? AND command_name = ?',
            [guildId, commandName]
        );
    },

    addTimeBasedRole: async (guildId, roleId, daysRequired, isCustomCreated = false) => {
        return await db.run(`
            INSERT OR REPLACE INTO time_based_roles 
            (guild_id, role_id, days_required, is_custom_created) 
            VALUES (?, ?, ?, ?)`,
            [guildId, roleId, daysRequired, isCustomCreated]
        );
    },

    getTimeBasedRoles: async (guildId) => {
        return await db.all(`
            SELECT * FROM time_based_roles
            WHERE guild_id = ?
            ORDER BY days_required ASC`,
            [guildId]
        );
    },

    removeTimeBasedRole: async (guildId, roleId) => {
        return await db.run(`
            DELETE FROM time_based_roles
            WHERE guild_id = ? AND role_id = ?`,
            [guildId, roleId]
        );
    },

    isTimeBasedRole: async (guildId, roleId) => {
        const role = await db.get(`
            SELECT * FROM time_based_roles
            WHERE guild_id = ? AND role_id = ?`,
            [guildId, roleId]
        );
        return !!role;
    },

    getRoleTimeRequirement: async (guildId, roleId) => {
        const role = await db.get(`
            SELECT days_required FROM time_based_roles
            WHERE guild_id = ? AND role_id = ?`,
            [guildId, roleId]
        );
        return role ? role.days_required : null;
    },

    updateTimeBasedRole: async (guildId, roleId, daysRequired) => {
        return await db.run(`
            UPDATE time_based_roles 
            SET days_required = ? 
            WHERE guild_id = ? AND role_id = ?`,
            [daysRequired, guildId, roleId]
        );
    },

    addFilteredTerm: async (guildId, term, severity, addedBy) => {
        await db.run(
            'INSERT OR REPLACE INTO filtered_terms (guild_id, term, severity, added_by) VALUES (?, ?, ?, ?)',
            [guildId, term.toLowerCase(), severity, addedBy]
        );
        clearFilterCache(guildId);
    },
    
    removeFilteredTerm: async (guildId, term) => {
        await db.run(
            'DELETE FROM filtered_terms WHERE guild_id = ? AND term = ?',
            [guildId, term.toLowerCase()]
        );
        clearFilterCache(guildId);
    },
    
    getFilteredTerms: async (guildId) => {
        let cached = getCachedFilter(guildId);
        if (cached) return cached;
    
        const terms = await db.all(
            'SELECT * FROM filtered_terms WHERE guild_id = ?',
            [guildId]
        );
        
        const result = {
            explicit: terms.filter(t => t.severity === 'explicit').map(t => t.term),
            suspicious: terms.filter(t => t.severity === 'suspicious').map(t => t.term)
        };
    
        setCachedFilter(guildId, result);
        return result;
    },
    
    importDefaultTerms: async (guildId, terms, addedBy) => {
        try {
            await database.beginTransaction();
            
            for (const term of terms.explicit) {
                await database.addFilteredTerm(guildId, term, 'explicit', addedBy);
            }
            for (const term of terms.suspicious) {
                await database.addFilteredTerm(guildId, term, 'suspicious', addedBy);
            }
            
            await database.commitTransaction();
        } catch (error) {
            await database.rollbackTransaction();
            throw error;
        }
    },

    getActiveUserTickets: async (userId) => {
        return await db.all(`
            SELECT * FROM tickets 
            WHERE user_id = ? AND status = 'OPEN'
            ORDER BY created_at DESC`,
            [userId]
        );
    },
    
    getTicket: async (channelOrThreadId) => {
        return await db.get(`
            SELECT * FROM tickets 
            WHERE channel_id = ? OR thread_id = ?`,
            [channelOrThreadId, channelOrThreadId]
        );
    },
    
    getLatestTicket: async (userId) => {
        return await db.get(`
            SELECT * FROM tickets 
            WHERE user_id = ? AND status = 'OPEN'
            ORDER BY created_at DESC 
            LIMIT 1`,
            [userId]
        );
    },
    
    createTicket: async (guildId, userId, channelId, threadId = null) => {
        return await db.run(`
            INSERT INTO tickets (guild_id, user_id, channel_id, thread_id)
            VALUES (?, ?, ?, ?)`,
            [guildId, userId, channelId, threadId]
        );
    },
    
    addTicketMessage: async (ticketId, authorId, content) => {
        return await db.run(`
            INSERT INTO ticket_messages (ticket_id, author_id, content)
            VALUES (?, ?, ?)`,
            [ticketId, authorId, content]
        );
    },
    
    closeTicket: async (ticketId, closedBy) => {
        return await db.run(`
            UPDATE tickets 
            SET status = 'CLOSED', 
                closed_at = CURRENT_TIMESTAMP, 
                closed_by = ?
            WHERE id = ?`,
            [closedBy, ticketId]
        );
    },
    
    isUserBlocked: async (guildId, userId) => {
        const result = await db.get(`
            SELECT 1 FROM blocked_ticket_users 
            WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
        return !!result;
    },
    
    blockUser: async (guildId, userId, blockedBy, reason) => {
        return await db.run(`
            INSERT OR REPLACE INTO blocked_ticket_users 
            (guild_id, user_id, blocked_by, reason)
            VALUES (?, ?, ?, ?)`,
            [guildId, userId, blockedBy, reason]
        );
    },
    
    unblockUser: async (guildId, userId) => {
        return await db.run(`
            DELETE FROM blocked_ticket_users
            WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
    },
    
    getRecentTickets: async (guildId, userId) => {
        return await db.all(`
            SELECT * FROM tickets 
            WHERE guild_id = ? AND user_id = ? 
            AND created_at > datetime('now', '-1 day')`,
            [guildId, userId]
        );
    },

    getAllUserTickets: async (guildId, userId) => {
        return await db.all(`
            SELECT * FROM tickets 
            WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
    },
    
    wipeUserTickets: async (guildId, userId) => {
        return await db.run(`
            DELETE FROM tickets 
            WHERE guild_id = ? AND user_id = ?`,
            [guildId, userId]
        );
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