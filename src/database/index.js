// database/index.js
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clearFilterCache, getCachedFilter, setCachedFilter } from '../utils/filterCache.js';
import { sanitizeInput } from '../utils/sanitization.js';

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
let transactionTimeouts = new Map();

// Validation functions
function validateGuildId(guildId) {
    return typeof guildId === 'string' && /^\d+$/.test(guildId);
}

function validateUserId(userId) {
    return typeof userId === 'string' && /^\d+$/.test(userId);
}

function validateMessageId(messageId) {
    return typeof messageId === 'string' && /^\d+$/.test(messageId);
}

function validateChannelId(channelId) {
    return !channelId || (typeof channelId === 'string' && /^\d+$/.test(channelId));
}

function validateThreadId(threadId) {
    return !threadId || (typeof threadId === 'string' && /^\d+$/.test(threadId));
}

function validateInteger(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
    return Number.isInteger(value) && value >= min && value <= max;
}

function validateBoolean(value) {
    return typeof value === 'boolean' || value === 0 || value === 1;
}

function validateString(value, maxLength = 2000) {
    return typeof value === 'string' && value.length <= maxLength;
}

// Column validation - these are all the valid columns in server_settings table
const validServerSettingsColumns = [
    'setup_completed', 'mod_role_id', 'disabled_commands', 'welcome_channel_id',
    'log_channel_id', 'reports_channel_id', 'warning_threshold', 'warning_expire_days',
    'cooldown_seconds', 'welcome_enabled', 'rules_channel_id', 'welcome_role_id',
    'welcome_messages', 'spam_protection', 'spam_threshold', 'spam_interval',
    'spam_warning_message', 'channel_restrictions_enabled', 'content_filter_enabled',
    'content_filter_log_suspicious', 'content_filter_notify_user', 'content_filter_notify_message',
    'tickets_channel_id', 'tickets_category_id', 'tickets_enabled', 'created_at', 'updated_at'
];

function validateColumnName(column) {
    return validServerSettingsColumns.includes(column);
}

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
       await db.run(`ALTER TABLE server_settings 
            ADD COLUMN tickets_channel_id TEXT`).catch(() => {});
       await db.run(`ALTER TABLE server_settings 
            ADD COLUMN tickets_category_id TEXT`).catch(() => {});
       await db.run(`ALTER TABLE server_settings 
            ADD COLUMN tickets_enabled BOOLEAN DEFAULT FALSE`).catch(() => {});

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
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                tickets_channel_id TEXT,
                tickets_category_id TEXT,
                tickets_enabled BOOLEAN DEFAULT FALSE,
                warning_threshold INTEGER DEFAULT 3
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

        // Reminders
        await db.run(`
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                message TEXT NOT NULL,
                reminder_time TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
       await db.run(`CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(reminder_time)`);
       await db.run(`CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)`);

       await updateDatabaseSchema();
       console.log('Database ready');
   } catch (error) {
       console.error('Database initialization error:', error);
       process.exit(1);
   }
}

const database = {
   // Transaction Management
   beginTransaction: async () => {
       await db.run('BEGIN TRANSACTION');
       const transactionId = Date.now().toString() + Math.random().toString(36).substr(2, 5);
       const timeout = setTimeout(async () => {
           try {
               await db.run('ROLLBACK');
               console.error('Transaction timed out and was rolled back:', transactionId);
               transactionTimeouts.delete(transactionId);
           } catch (error) {
               console.error('Error rolling back timed-out transaction:', error);
           }
       }, 30000); // 30 seconds timeout
       
       transactionTimeouts.set(transactionId, timeout);
       return transactionId;
   },
   
   commitTransaction: async (transactionId) => {
       if (transactionId && transactionTimeouts.has(transactionId)) {
           clearTimeout(transactionTimeouts.get(transactionId));
           transactionTimeouts.delete(transactionId);
       }
       return await db.run('COMMIT');
   },
   
   rollbackTransaction: async (transactionId) => {
       if (transactionId && transactionTimeouts.has(transactionId)) {
           clearTimeout(transactionTimeouts.get(transactionId));
           transactionTimeouts.delete(transactionId);
       }
       return await db.run('ROLLBACK');
   },

   // Server Settings
   getServerSettings: async (guildId) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return null;
           }
           
           if (serverSettingsCache.has(guildId)) {
               const cached = serverSettingsCache.get(guildId);
               if (Date.now() - lastCacheCleanup > CACHE_CLEANUP_INTERVAL) {
                   serverSettingsCache.clear();
                   lastCacheCleanup = Date.now();
               }
               return cached;
           }

           const settings = await db.get('SELECT * FROM server_settings WHERE guild_id = ?', [guildId]);
           if (settings) {
               serverSettingsCache.set(guildId, settings);
           }
           return settings;
       } catch (error) {
           console.error('Error getting server settings:', {
               error: error.message,
               guildId: guildId
           });
           return null;
       }
   },

   updateServerSettings: async (guildId, settings) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return { error: 'Invalid guild ID' };
           }
           
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

           // Validate and filter columns
           const validColumns = Object.keys(settings).filter(key => {
               if (key === 'guild_id') return false;
               if (!validateColumnName(key)) {
                   console.warn(`Invalid column name ${key} ignored`);
                   return false;
               }
               return true;
           });
           
           if (validColumns.length === 0) {
               console.error('No valid columns to update');
               return { error: 'No valid columns' };
           }
           
           // Sanitize values
           const values = validColumns.map(col => {
               const value = settings[col];
               if (typeof value === 'string') {
                   return sanitizeInput(value);
               }
               return value;
           });
           
           const sql = `
               INSERT OR REPLACE INTO server_settings (
                   guild_id,
                   ${validColumns.join(',')},
                   updated_at
               ) VALUES (
                   ?,
                   ${validColumns.map(() => '?').join(',')},
                   CURRENT_TIMESTAMP
               )
           `;

           return await db.run(sql, [guildId, ...values]);
       } catch (error) {
           console.error('Error updating server settings:', {
               error: error.message,
               guildId: guildId,
               settings: JSON.stringify(settings)
           });
           return { error: 'Database error', details: error.message };
       }
   },

   // Command Pack Management
   registerCommandPack: async (packName, description, category, isCore) => {
        try {
            if (!validateString(packName, 100)) {
                console.error('Invalid pack name:', packName);
                return false;
            }
            
            if (!validateString(description, 500)) {
                console.error('Invalid pack description');
                return false;
            }
            
            if (!validateString(category, 100)) {
                console.error('Invalid pack category');
                return false;
            }
            
            if (!validateBoolean(isCore)) {
                console.error('Invalid isCore value');
                return false;
            }
            
            const existingPack = await db.get(
                'SELECT id FROM command_packs WHERE name = ?',
                [sanitizeInput(packName)]
            );

            if (existingPack) {
                await db.run(`
                    UPDATE command_packs 
                    SET description = ?, category = ?, is_core = ?
                    WHERE name = ?
                `, [sanitizeInput(description), sanitizeInput(category), isCore ? 1 : 0, sanitizeInput(packName)]);
                return true;
            }

            await db.run(`
                INSERT INTO command_packs 
                (name, description, category, is_core) 
                VALUES (?, ?, ?, ?)
            `, [sanitizeInput(packName), sanitizeInput(description), sanitizeInput(category), isCore ? 1 : 0]);
            
            return true;
        } catch (error) {
            console.error('Error registering command pack:', {
                error: error.message,
                packName: packName
            });
            return false;
        }
    },

    getEnabledPacks: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guild ID format:', guildId);
                return [];
            }
            
            const enabledPacks = await db.all(`
                SELECT DISTINCT cp.* 
                FROM command_packs cp
                LEFT JOIN server_command_packs scp ON cp.id = scp.pack_id AND scp.guild_id = ?
                WHERE cp.is_core = 1 OR scp.enabled = 1
            `, [guildId]);
            
            return enabledPacks;
        } catch (error) {
            console.error('Error getting enabled packs:', {
                error: error.message,
                guildId: guildId
            });
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
            if (!validateGuildId(guildId) || !validateString(packName, 100)) {
                console.error('Invalid parameters for isPackEnabled');
                return false;
            }
            
            const result = await db.get(`
                SELECT cp.id, cp.name, cp.is_core, COALESCE(scp.enabled, 0) as enabled
                FROM command_packs cp
                LEFT JOIN server_command_packs scp ON cp.id = scp.pack_id AND scp.guild_id = ?
                WHERE cp.name = ?
            `, [guildId, sanitizeInput(packName)]);

            return result?.is_core === 1 || result?.enabled === 1;
        } catch (error) {
            console.error('Error checking pack enabled status:', {
                error: error.message,
                guildId: guildId,
                packName: packName
            });
            return false;
        }
    },

    enablePack: async (guildId, packName) => {
        try {
            if (!validateGuildId(guildId) || !validateString(packName, 100)) {
                console.error('Invalid parameters for enablePack');
                return false;
            }
            
            console.log(`Enabling pack ${packName} for guild ${guildId}`);
            
            const pack = await db.get('SELECT id FROM command_packs WHERE name = ?', [sanitizeInput(packName)]);
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
            
            const verification = await db.get(
                'SELECT * FROM server_command_packs WHERE guild_id = ? AND pack_id = ?',
                [guildId, pack.id]
            );
            console.log('Verification of pack enablement:', verification);
    
            return true;
        } catch (error) {
            console.error('Error enabling pack:', {
                error: error.message,
                guildId: guildId,
                packName: packName
            });
            return false;
        }
    },

   disablePack: async (guildId, packName) => {
       try {
           if (!validateGuildId(guildId) || !validateString(packName, 100)) {
               console.error('Invalid parameters for disablePack');
               return false;
           }
           
           const pack = await db.get(`
               SELECT id, is_core 
               FROM command_packs 
               WHERE name = ?
           `, [sanitizeInput(packName)]);

           if (!pack || pack.is_core) return false;

           await db.run(`
               DELETE FROM server_command_packs
               WHERE guild_id = ? AND pack_id = ?
           `, [guildId, pack.id]);

           return true;
       } catch (error) {
           console.error('Error disabling pack:', {
               error: error.message,
               guildId: guildId,
               packName: packName
           });
           return false;
       }
   },

   getLastWelcomeMessages: async (guildId, limit = 5) => {
        try {
            if (!validateGuildId(guildId) || !validateInteger(limit, 1, 20)) {
                console.error('Invalid parameters for getLastWelcomeMessages');
                return [];
            }
            
            const messages = await db.all(`
                SELECT message 
                FROM welcome_message_history 
                WHERE guild_id = ? 
                ORDER BY created_at DESC 
                LIMIT ?
            `, [guildId, limit]);
            
            return messages.map(m => m.message);
        } catch (error) {
            console.error('Error getting last welcome messages:', {
                error: error.message,
                guildId: guildId
            });
            return [];
        }
    },

    addWelcomeMessageToHistory: async (guildId, message) => {
        try {
            if (!validateGuildId(guildId) || !validateString(message, 2000)) {
                console.error('Invalid parameters for addWelcomeMessageToHistory');
                return false;
            }
            
            await db.run(`
                INSERT INTO welcome_message_history (guild_id, message)
                VALUES (?, ?)
            `, [guildId, sanitizeInput(message)]);
            
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
            console.error('Error adding welcome message to history:', {
                error: error.message,
                guildId: guildId
            });
            return false;
        }
    },

    logWelcome: async (guildId, userId, message) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId) || !validateString(message, 2000)) {
                console.error('Invalid parameters for logWelcome');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT INTO logs (
                    guild_id, 
                    user_id, 
                    action_type, 
                    action_details, 
                    executed_by
                ) VALUES (?, ?, 'WELCOME', ?, 'SYSTEM')`,
                [guildId, userId, sanitizeInput(message)]
            );
        } catch (error) {
            console.error('Error logging welcome:', {
                error: error.message,
                guildId: guildId, 
                userId: userId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    logRoleAssignment: async (guildId, userId, roleId, reason = 'welcome') => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId) || 
                !validateString(roleId, 100) || !validateString(reason, 200)) {
                console.error('Invalid parameters for logRoleAssignment');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT INTO logs (
                    guild_id, 
                    user_id, 
                    action_type, 
                    action_details, 
                    executed_by
                ) VALUES (?, ?, 'ROLE_ASSIGN', ?, 'SYSTEM')`,
                [guildId, userId, `Role ${sanitizeInput(roleId)} assigned (${sanitizeInput(reason)})`]
            );
        } catch (error) {
            console.error('Error logging role assignment:', {
                error: error.message,
                guildId: guildId,
                userId: userId,
                roleId: roleId
            });
            return { error: 'Database error', details: error.message };
        }
    },

   // Role Management
   createRoleMessage: async (data) => {
       try {
           if (!validateMessageId(data.message_id) || !validateGuildId(data.guild_id) || 
               !validateChannelId(data.channel_id) || !Array.isArray(data.roles)) {
               console.error('Invalid parameters for createRoleMessage');
               return { error: 'Invalid parameters' };
           }
           
           const sanitizedRoles = JSON.stringify(data.roles.map(role => 
               typeof role === 'string' ? sanitizeInput(role) : role
           ));
           
           return await db.run(
               'INSERT INTO role_messages (message_id, guild_id, channel_id, roles) VALUES (?, ?, ?, ?)',
               [data.message_id, data.guild_id, data.channel_id, sanitizedRoles]
           );
       } catch (error) {
           console.error('Error creating role message:', {
               error: error.message,
               messageId: data.message_id
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getRoleMessage: async (messageId) => {
       try {
           if (!validateMessageId(messageId)) {
               console.error('Invalid message ID format:', messageId);
               return null;
           }
           
           const msg = await db.get('SELECT * FROM role_messages WHERE message_id = ?', [messageId]);
           if (msg) {
               try {
                   msg.roles = JSON.parse(msg.roles);
               } catch (parseError) {
                   console.error('Error parsing roles JSON:', parseError);
                   msg.roles = [];
               }
           }
           return msg;
       } catch (error) {
           console.error('Error getting role message:', {
               error: error.message,
               messageId: messageId
           });
           return null;
       }
   },

   deleteRoleMessage: async (messageId) => {
       try {
           if (!validateMessageId(messageId)) {
               console.error('Invalid message ID format:', messageId);
               return { error: 'Invalid message ID' };
           }
           
           return await db.run('DELETE FROM role_messages WHERE message_id = ?', [messageId]);
       } catch (error) {
           console.error('Error deleting role message:', {
               error: error.message,
               messageId: messageId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getAllRoleMessages: async (guildId) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return [];
           }
           
           const messages = await db.all('SELECT * FROM role_messages WHERE guild_id = ?', [guildId]);
           return messages.map(msg => {
               try {
                   return {
                       ...msg,
                       roles: JSON.parse(msg.roles)
                   };
               } catch (parseError) {
                   console.error('Error parsing roles JSON:', parseError);
                   return {
                       ...msg,
                       roles: []
                   };
               }
           });
       } catch (error) {
           console.error('Error getting all role messages:', {
               error: error.message,
               guildId: guildId
           });
           return [];
       }
   },

   // Warning System
   addWarning: async (guildId, userId, warnedBy, reason) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId) || 
               !validateUserId(warnedBy) || !validateString(reason, 1000)) {
               console.error('Invalid parameters for addWarning');
               return { error: 'Invalid parameters' };
           }
           
           const settings = await database.getServerSettings(guildId);
           const expiresAt = settings?.warning_expire_days > 0 
               ? new Date(Date.now() + (settings.warning_expire_days * 24 * 60 * 60 * 1000)).toISOString()
               : null;

           return await db.run(
               'INSERT INTO warnings (guild_id, user_id, warned_by, reason, expires_at) VALUES (?, ?, ?, ?, ?)',
               [guildId, userId, warnedBy, sanitizeInput(reason), expiresAt]
           );
       } catch (error) {
           console.error('Error adding warning:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getActiveWarnings: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for getActiveWarnings');
               return [];
           }
           
           return await db.all(
               `SELECT * FROM warnings 
               WHERE guild_id = ? 
               AND user_id = ? 
               AND (expires_at IS NULL OR expires_at > datetime('now')) 
               ORDER BY created_at DESC`,
               [guildId, userId]
           );
       } catch (error) {
           console.error('Error getting active warnings:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return [];
       }
   },

   getAllWarnings: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for getAllWarnings');
               return [];
           }
           
           return await db.all(
               'SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC',
               [guildId, userId]
           );
       } catch (error) {
           console.error('Error getting all warnings:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return [];
       }
   },

   clearWarnings: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for clearWarnings');
               return { error: 'Invalid parameters' };
           }
           
           return await db.run(
               'DELETE FROM warnings WHERE guild_id = ? AND user_id = ?',
               [guildId, userId]
           );
       } catch (error) {
           console.error('Error clearing warnings:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   // Spam Protection
   addSpamWarning: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for addSpamWarning');
               return { error: 'Invalid parameters' };
           }
           
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
       } catch (error) {
           console.error('Error adding spam warning:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getSpamWarnings: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for getSpamWarnings');
               return null;
           }
           
           return await db.get(
               'SELECT * FROM spam_warnings WHERE guild_id = ? AND user_id = ?',
               [guildId, userId]
           );
       } catch (error) {
           console.error('Error getting spam warnings:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return null;
       }
   },

   resetSpamWarnings: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for resetSpamWarnings');
               return { error: 'Invalid parameters' };
           }
           
           return await db.run(
               'DELETE FROM spam_warnings WHERE guild_id = ? AND user_id = ?',
               [guildId, userId]
           );
       } catch (error) {
           console.error('Error resetting spam warnings:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   // Reports System
   createReport: async (reportData) => {
       try {
           if (!validateGuildId(reportData.guild_id) || !validateUserId(reportData.reporter_id) ||
               (reportData.reported_user_id && !validateUserId(reportData.reported_user_id)) ||
               (reportData.message_id && !validateMessageId(reportData.message_id)) ||
               (reportData.channel_id && !validateChannelId(reportData.channel_id)) ||
               !validateString(reportData.type, 50) || !validateString(reportData.reason, 1000)) {
               console.error('Invalid parameters for createReport');
               return { error: 'Invalid parameters' };
           }
           
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
                   sanitizeInput(reportData.type),
                   sanitizeInput(reportData.reason)
               ]
           );
       } catch (error) {
           console.error('Error creating report:', {
               error: error.message,
               reportData: JSON.stringify(reportData)
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getReport: async (messageId) => {
        try {
            if (!validateMessageId(messageId)) {
                console.error('Invalid message ID format:', messageId);
                return null;
            }
            
            return await db.get('SELECT * FROM reports WHERE message_id = ?', [messageId]);
        } catch (error) {
            console.error('Error getting report:', {
                error: error.message,
                messageId: messageId
            });
            return null;
        }
    },

   getPendingReports: async (guildId) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return [];
           }
           
           return await db.all(
               'SELECT * FROM reports WHERE guild_id = ? AND status = ? ORDER BY created_at DESC',
               [guildId, 'PENDING']
           );
       } catch (error) {
           console.error('Error getting pending reports:', {
               error: error.message,
               guildId: guildId
           });
           return [];
       }
   },

   hasActiveReports: async (userId, guildId) => {
       try {
           if (!validateUserId(userId) || !validateGuildId(guildId)) {
               console.error('Invalid parameters for hasActiveReports');
               return false;
           }
           
           const pendingReports = await db.get(`
               SELECT COUNT(*) as count 
               FROM reports 
               WHERE guild_id = ? 
               AND reported_user_id = ? 
               AND status = 'PENDING'`, 
               [guildId, userId]
           );
           return pendingReports.count > 0;
       } catch (error) {
           console.error('Error checking active reports:', {
               error: error.message,
               userId: userId,
               guildId: guildId
           });
           return false;
       }
   },

   resolveReport: async (reportId, resolvedBy) => {
       try {
           if (!validateMessageId(reportId) || !validateUserId(resolvedBy)) {
               console.error('Invalid parameters for resolveReport');
               return {
                   success: false,
                   error: 'Invalid parameters'
               };
           }
           
           console.log('Starting report resolution for message ID:', reportId);
           const transactionId = await database.beginTransaction();

           const report = await db.get('SELECT reported_user_id, guild_id FROM reports WHERE message_id = ?', [reportId]);
           console.log('Found report:', report);

           if (!report) {
               await database.rollbackTransaction(transactionId);
               return {
                   success: false,
                   error: 'Report not found'
               };
           }

           await db.run(`
               UPDATE reports 
               SET status = 'RESOLVED', 
                   resolved_by = ?, 
                   resolved_at = CURRENT_TIMESTAMP 
               WHERE message_id = ?`,
               [resolvedBy, reportId]
           );

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

           await database.commitTransaction(transactionId);
           return {
               success: true,
               hasOtherActiveReports: remainingReports.count > 0,
               reportedUserId: report.reported_user_id
           };
       } catch (error) {
           await database.rollbackTransaction();
           console.error('Error resolving report:', {
               error: error.message,
               reportId: reportId
           });
           return {
               success: false,
               error: error.message
           };
       }
   },

   deleteReport: async (reportId) => {
       try {
           if (!validateMessageId(reportId)) {
               console.error('Invalid report ID format:', reportId);
               return { error: 'Invalid report ID' };
           }
           
           return await db.run('DELETE FROM reports WHERE message_id = ?', [reportId]);
       } catch (error) {
           console.error('Error deleting report:', {
               error: error.message,
               reportId: reportId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getUserReports: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for getUserReports');
               return [];
           }
           
           return await db.all(`
               SELECT * FROM reports 
               WHERE guild_id = ? 
               AND (reporter_id = ? OR reported_user_id = ?) 
               ORDER BY created_at DESC`,
               [guildId, userId, userId]
           );
       } catch (error) {
           console.error('Error getting user reports:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return [];
       }
   },

   // Backup Management
   createBackup: async (guildId, backupData, createdBy) => {
       try {
           if (!validateGuildId(guildId) || !backupData || !validateUserId(createdBy)) {
               console.error('Invalid parameters for createBackup');
               return { error: 'Invalid parameters' };
           }
           
           return await db.run(
               'INSERT INTO server_backups (guild_id, backup_data, created_by) VALUES (?, ?, ?)',
               [guildId, JSON.stringify(backupData), createdBy]
           );
       } catch (error) {
           console.error('Error creating backup:', {
               error: error.message,
               guildId: guildId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getLatestBackup: async (guildId) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return null;
           }
           
           return await db.get(
               'SELECT * FROM server_backups WHERE guild_id = ? ORDER BY created_at DESC LIMIT 1',
               [guildId]
           );
       } catch (error) {
           console.error('Error getting latest backup:', {
               error: error.message,
               guildId: guildId
           });
           return null;
       }
   },

   importBackup: async (guildId, backupData) => {
       try {
           if (!validateGuildId(guildId) || !backupData) {
               console.error('Invalid parameters for importBackup');
               return false;
           }
           
           const transactionId = await database.beginTransaction();

           try {
               if (backupData.settings) {
                   await database.updateServerSettings(guildId, backupData.settings);
               }

               if (backupData.warnings && Array.isArray(backupData.warnings)) {
                   const stmt = await db.prepare(
                       `INSERT INTO warnings 
                       (guild_id, user_id, warned_by, reason, created_at, expires_at) 
                       VALUES (?, ?, ?, ?, ?, ?)`
                   );

                   for (const warning of backupData.warnings) {
                       if (!validateUserId(warning.user_id) || !validateUserId(warning.warned_by)) {
                           console.warn('Skipping warning with invalid user IDs');
                           continue;
                       }
                       
                       await stmt.run([
                           guildId,
                           warning.user_id,
                           warning.warned_by,
                           sanitizeInput(warning.reason || ''),
                           warning.created_at,
                           warning.expires_at
                       ]);
                   }

                   await stmt.finalize();
               }

               if (backupData.roleMessages && Array.isArray(backupData.roleMessages)) {
                   const stmt = await db.prepare(
                       `INSERT INTO role_messages 
                       (message_id, guild_id, channel_id, roles) 
                       VALUES (?, ?, ?, ?)`
                   );

                   for (const msg of backupData.roleMessages) {
                       if (!validateMessageId(msg.message_id) || !validateChannelId(msg.channel_id)) {
                           console.warn('Skipping role message with invalid IDs');
                           continue;
                       }
                       
                       await stmt.run([
                           msg.message_id,
                           guildId,
                           msg.channel_id,
                           JSON.stringify(msg.roles || [])
                       ]);
                   }

                   await stmt.finalize();
               }

               await database.commitTransaction(transactionId);
               return true;
           } catch (error) {
               await database.rollbackTransaction(transactionId);
               throw error;
           }
       } catch (error) {
           console.error('Error importing backup:', {
               error: error.message,
               guildId: guildId
           });
           return false;
       }
   },

   // Server Management
   resetServer: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guild ID format:', guildId);
                return false;
            }
            
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

            const transactionId = await database.beginTransaction();

            try {
                for (const table of tables) {
                    await db.run(`DELETE FROM ${table} WHERE guild_id = ?`, [guildId]);
                }

                await database.commitTransaction(transactionId);
                return true;
            } catch (error) {
                await database.rollbackTransaction(transactionId);
                throw error;
            }
        } catch (error) {
            console.error('Error resetting server:', {
                error: error.message,
                guildId: guildId
            });
            return false;
        }
    },

   resetServerForSetup: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guild ID format:', guildId);
                return false;
            }
            
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

            const transactionId = await database.beginTransaction();

            try {
                for (const table of tables) {
                    await db.run(`DELETE FROM ${table} WHERE guild_id = ?`, [guildId]);
                }

                await database.commitTransaction(transactionId);
                return true;
            } catch (error) {
                await database.rollbackTransaction(transactionId);
                throw error;
            }
        } catch (error) {
            console.error('Error resetting server for setup:', {
                error: error.message,
                guildId: guildId
            });
            return false;
        }
    },

   // Utility Functions
   clearExpiredWarnings: async () => {
        try {
            const expiringWarnings = await db.all(`
                SELECT w.*, g.log_channel_id 
                FROM warnings w
                JOIN server_settings g ON w.guild_id = g.guild_id
                WHERE w.expires_at IS NOT NULL 
                AND w.expires_at < datetime('now')
            `);

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

            await db.run(`
                DELETE FROM warnings 
                WHERE expires_at IS NOT NULL 
                AND expires_at < datetime('now')
            `);

            return warningsByGuildAndUser;
        } catch (error) {
            console.error('Error clearing expired warnings:', error);
            return {};
        }
    },

    // Reminder System
    createReminder: async (userId, guildId, channelId, message, reminderTime) => {
        try {
            if (!validateUserId(userId) || !validateGuildId(guildId) || 
                !validateChannelId(channelId) || !validateString(message, 1000)) {
                console.error('Invalid parameters for createReminder');
                return { error: 'Invalid parameters' };
            }
            
            const reminderTimeStr = reminderTime instanceof Date ? 
                reminderTime.toISOString() : reminderTime;
                
            return await db.run(`
                INSERT INTO reminders 
                (user_id, guild_id, channel_id, message, reminder_time) 
                VALUES (?, ?, ?, ?, ?)
            `, [userId, guildId, channelId, sanitizeInput(message), reminderTimeStr]);
        } catch (error) {
            console.error('Error creating reminder:', {
                error: error.message,
                userId: userId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    getUserReminders: async (userId) => {
        try {
            if (!validateUserId(userId)) {
                console.error('Invalid userId parameter for getUserReminders');
                return [];
            }
            
            return await db.all(`
                SELECT id, message, reminder_time 
                FROM reminders
                WHERE user_id = ? AND reminder_time > datetime('now')
                ORDER BY reminder_time ASC
            `, [userId]);
        } catch (error) {
            console.error('Error getting user reminders:', {
                error: error.message,
                userId: userId
            });
            return [];
        }
    },

    deleteReminder: async (id, userId) => {
        try {
            if (!validateInteger(id, 1) || !validateUserId(userId)) {
                console.error('Invalid parameters for deleteReminder');
                return { error: 'Invalid parameters' };
            }
            
            // Check if the reminder exists in the database
            const reminder = await db.get(`
                SELECT * FROM reminders 
                WHERE id = ? AND user_id = ?
            `, [id, userId]);
            
            if (!reminder) {
                return { success: false, reason: 'Reminder not found or not yours' };
            }
            
            // Proceed with the deletion
            await db.run('DELETE FROM reminders WHERE id = ?', [id]);
            return { success: true };
        } catch (error) {
            console.error('Error deleting reminder:', {
                error: error.message,
                id: id,
                userId: userId
            });
            return { success: false, reason: 'Database error' };
        }
    },    

    getPendingRemindersInTimeframe: async (startTime, endTime) => {
        try {
            return await db.all(`
                SELECT * FROM reminders
                WHERE reminder_time > ? AND reminder_time < ?
                ORDER BY reminder_time ASC
            `, [startTime.toISOString(), endTime.toISOString()]);
        } catch (error) {
            console.error('Error getting pending reminders in timeframe:', error);
            return [];
        }
    },

    getReminderById: async (id, userId) => {
        try {
            if (!validateInteger(id, 1) || !validateUserId(userId)) {
                console.error('Invalid parameters for getReminderById');
                return null;
            }
            
            return await db.get(`
                SELECT * FROM reminders 
                WHERE id = ? AND user_id = ?
            `, [id, userId]);
        } catch (error) {
            console.error('Error getting reminder by ID:', error);
            return null;
        }
    },

    countUserReminders: async (userId) => {
        try {
            const result = await db.get(`
                SELECT COUNT(*) as count
                FROM reminders
                WHERE user_id = ? AND reminder_time > datetime('now')
            `, [userId]);
            return result.count;
        } catch (error) {
            console.error('Error counting user reminders:', error);
            return 0;
        }
    },

    getPendingReminders: async () => {
        try {
            return await db.all(`
                SELECT * FROM reminders
                WHERE reminder_time > datetime('now')
                ORDER BY reminder_time ASC
            `);
        } catch (error) {
            console.error('Error getting pending reminders:', error);
            return [];
        }
    },

    cleanupExpiredReminders: async () => {
        try {
            const result = await db.run(`
                DELETE FROM reminders 
                WHERE reminder_time < datetime('now', '-1 day')
            `);
            return { success: true, deleted: result.changes };
        } catch (error) {
            console.error('Error cleaning up expired reminders:', error);
            return { success: false, error: error.message };
        }
    },

   clearOldBackups: async (guildId, keepCount = 5) => {
       try {
           if (!validateGuildId(guildId) || !validateInteger(keepCount, 1, 20)) {
               console.error('Invalid parameters for clearOldBackups');
               return { error: 'Invalid parameters' };
           }
           
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
       } catch (error) {
           console.error('Error clearing old backups:', {
               error: error.message,
               guildId: guildId
           });
           return { error: 'Database error', details: error.message };
       }
   },

   clearOldSpamWarnings: async (hours = 24) => {
       try {
           if (!validateInteger(hours, 1, 720)) { // Max 30 days
               console.error('Invalid hours parameter for clearOldSpamWarnings:', hours);
               return { error: 'Invalid parameter' };
           }
           
           return await db.run(
               `DELETE FROM spam_warnings 
               WHERE last_warning < datetime('now', '-' || ? || ' hours')`,
               [hours]
           );
       } catch (error) {
           console.error('Error clearing old spam warnings:', {
               error: error.message,
               hours: hours
           });
           return { error: 'Database error', details: error.message };
       }
   },

   clearOldResolvedReports: async (days = 30) => {
       try {
           if (!validateInteger(days, 1, 365)) {
               console.error('Invalid days parameter for clearOldResolvedReports:', days);
               return { error: 'Invalid parameter' };
           }
           
           return await db.run(
               `DELETE FROM reports 
               WHERE status = 'RESOLVED' 
               AND resolved_at < datetime('now', '-' || ? || ' days')`,
               [days]
           );
       } catch (error) {
           console.error('Error clearing old resolved reports:', {
               error: error.message,
               days: days
           });
           return { error: 'Database error', details: error.message };
       }
   },

   // Logging System
   logAction: async (guildId, actionType, userId, details) => {
       try {
           if (!validateGuildId(guildId) || !validateString(actionType, 50) || 
               !validateUserId(userId) || !validateString(details, 2000)) {
               console.error('Invalid parameters for logAction');
               return { error: 'Invalid parameters' };
           }
           
           return await db.run(
               'INSERT INTO audit_logs (guild_id, action_type, user_id, details) VALUES (?, ?, ?, ?)',
               [guildId, sanitizeInput(actionType), userId, sanitizeInput(details)]
           );
       } catch (error) {
           console.error('Error logging action:', {
               error: error.message,
               guildId: guildId,
               actionType: actionType
           });
           return { error: 'Database error', details: error.message };
       }
   },

   getModActions: async (guildId, userId) => {
       try {
           if (!validateGuildId(guildId) || !validateUserId(userId)) {
               console.error('Invalid parameters for getModActions');
               return [];
           }
           
           return await db.all(
               `SELECT * FROM audit_logs 
               WHERE guild_id = ? 
               AND (user_id = ? OR target_id = ?)
               AND action_type IN ('BAN', 'KICK', 'TIMEOUT', 'WARN', 'MUTE', 'UNMUTE')
               ORDER BY created_at DESC
               LIMIT 10`,
               [guildId, userId, userId]
           );
       } catch (error) {
           console.error('Error getting mod actions:', {
               error: error.message,
               guildId: guildId,
               userId: userId
           });
           return [];
       }
   },

   // Stats and Reporting
   getServerStats: async (guildId) => {
       try {
           if (!validateGuildId(guildId)) {
               console.error('Invalid guild ID format:', guildId);
               return {
                   warningCount: 0,
                   activeWarnings: 0,
                   spamWarnings: 0,
                   backupCount: 0,
                   moderationActions: 0,
                   pendingReports: 0
               };
           }
           
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
       } catch (error) {
           console.error('Error getting server stats:', {
               error: error.message,
               guildId: guildId
           });
           return {
               warningCount: 0,
               activeWarnings: 0,
               spamWarnings: 0,
               backupCount: 0,
               moderationActions: 0,
               pendingReports: 0
           };
       }
   },

   getCurrentBOTD: async () => {
        try {
            const today = new Date().toISOString().split('T')[0];
            return await db.get(
                'SELECT * FROM block_of_the_day WHERE shown_at = ?',
                [today]
            );
        } catch (error) {
            console.error('Error getting current BOTD:', error);
            return null;
        }
    },

    getRecentBOTDs: async (days = 30) => {
        try {
            if (!validateInteger(days, 1, 365)) {
                console.error('Invalid days parameter for getRecentBOTDs:', days);
                return [];
            }
            
            return await db.all(`
                SELECT block_title 
                FROM block_of_the_day 
                WHERE shown_at >= date('now', ?) 
                ORDER BY shown_at DESC`,
                [`-${days} days`]
            );
        } catch (error) {
            console.error('Error getting recent BOTDs:', {
                error: error.message,
                days: days
            });
            return [];
        }
    },

    setBlockOfTheDay: async (blockTitle) => {
        try {
            if (!validateString(blockTitle, 500)) {
                console.error('Invalid blockTitle parameter for setBlockOfTheDay');
                return { error: 'Invalid parameter' };
            }
            
            const today = new Date().toISOString().split('T')[0];
            return await db.run(
                'INSERT INTO block_of_the_day (block_title, shown_at) VALUES (?, ?)',
                [sanitizeInput(blockTitle), today]
            );
        } catch (error) {
            console.error('Error setting block of the day:', {
                error: error.message,
                blockTitle: blockTitle
            });
            return { error: 'Database error', details: error.message };
        }
    },

    startBlockGame: async (channelId, blockTitle) => {
        try {
            if (!validateChannelId(channelId) || !validateString(blockTitle, 500)) {
                console.error('Invalid parameters for startBlockGame');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'INSERT OR REPLACE INTO block_games (channel_id, block_title, hints_given) VALUES (?, ?, 0)',
                [channelId, sanitizeInput(blockTitle)]
            );
        } catch (error) {
            console.error('Error starting block game:', {
                error: error.message,
                channelId: channelId
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    getActiveGame: async (channelId) => {
        try {
            if (!validateChannelId(channelId)) {
                console.error('Invalid channelId parameter for getActiveGame');
                return null;
            }
            
            return await db.get(
                'SELECT * FROM block_games WHERE channel_id = ?',
                [channelId]
            );
        } catch (error) {
            console.error('Error getting active game:', {
                error: error.message,
                channelId: channelId
            });
            return null;
        }
    },
    
    incrementHints: async (channelId) => {
        try {
            if (!validateChannelId(channelId)) {
                console.error('Invalid channelId parameter for incrementHints');
                return { error: 'Invalid parameter' };
            }
            
            return await db.run(
                'UPDATE block_games SET hints_given = hints_given + 1 WHERE channel_id = ?',
                [channelId]
            );
        } catch (error) {
            console.error('Error incrementing hints:', {
                error: error.message,
                channelId: channelId
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    endGame: async (channelId) => {
        try {
            if (!validateChannelId(channelId)) {
                console.error('Invalid channelId parameter for endGame');
                return { error: 'Invalid parameter' };
            }
            
            return await db.run(
                'DELETE FROM block_games WHERE channel_id = ?',
                [channelId]
            );
        } catch (error) {
            console.error('Error ending game:', {
                error: error.message,
                channelId: channelId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    getChannelPermissions: async (guildId, channelId) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId)) {
                console.error('Invalid parameters for getChannelPermissions');
                return [];
            }
            
            return await db.all(
                'SELECT command_category FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_category IS NOT NULL',
                [guildId, channelId]
            );
        } catch (error) {
            console.error('Error getting channel permissions:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId
            });
            return [];
        }
    },
    
    getChannelCommandPermissions: async (guildId, channelId) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId)) {
                console.error('Invalid parameters for getChannelCommandPermissions');
                return [];
            }
            
            return await db.all(
                'SELECT command_name FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_name IS NOT NULL',
                [guildId, channelId]
            );
        } catch (error) {
            console.error('Error getting channel command permissions:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId
            });
            return [];
        }
    },
    
    getAllChannelPermissions: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guildId parameter for getAllChannelPermissions');
                return [];
            }
            
            return await db.all(
                'SELECT channel_id, command_category, command_name FROM channel_permissions WHERE guild_id = ?',
                [guildId]
            );
        } catch (error) {
            console.error('Error getting all channel permissions:', {
                error: error.message,
                guildId: guildId
            });
            return [];
        }
    },
    
    setChannelPermission: async (guildId, channelId, category) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId) || !validateString(category, 100)) {
                console.error('Invalid parameters for setChannelPermission');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'INSERT OR REPLACE INTO channel_permissions (guild_id, channel_id, command_category) VALUES (?, ?, ?)',
                [guildId, channelId, sanitizeInput(category)]
            );
        } catch (error) {
            console.error('Error setting channel permission:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId,
                category: category
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    setChannelCommandPermission: async (guildId, channelId, commandName) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId) || !validateString(commandName, 100)) {
                console.error('Invalid parameters for setChannelCommandPermission');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'INSERT OR REPLACE INTO channel_permissions (guild_id, channel_id, command_name) VALUES (?, ?, ?)',
                [guildId, channelId, sanitizeInput(commandName)]
            );
        } catch (error) {
            console.error('Error setting channel command permission:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId,
                commandName: commandName
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    removeChannelPermission: async (guildId, channelId, category) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId) || !validateString(category, 100)) {
                console.error('Invalid parameters for removeChannelPermission');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_category = ?',
                [guildId, channelId, sanitizeInput(category)]
            );
        } catch (error) {
            console.error('Error removing channel permission:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId,
                category: category
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    removeChannelCommandPermission: async (guildId, channelId, commandName) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId) || !validateString(commandName, 100)) {
                console.error('Invalid parameters for removeChannelCommandPermission');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ? AND command_name = ?',
                [guildId, channelId, sanitizeInput(commandName)]
            );
        } catch (error) {
            console.error('Error removing channel command permission:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId,
                commandName: commandName
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    clearChannelPermissions: async (guildId, channelId) => {
        try {
            if (!validateGuildId(guildId) || !validateChannelId(channelId)) {
                console.error('Invalid parameters for clearChannelPermissions');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(
                'DELETE FROM channel_permissions WHERE guild_id = ? AND channel_id = ?',
                [guildId, channelId]
            );
        } catch (error) {
            console.error('Error clearing channel permissions:', {
                error: error.message,
                guildId: guildId,
                channelId: channelId
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    getChannelsByPermission: async (guildId, category) => {
        try {
            if (!validateGuildId(guildId) || !validateString(category, 100)) {
                console.error('Invalid parameters for getChannelsByPermission');
                return [];
            }
            
            return await db.all(
                'SELECT DISTINCT channel_id FROM channel_permissions WHERE guild_id = ? AND command_category = ?',
                [guildId, sanitizeInput(category)]
            );
        } catch (error) {
            console.error('Error getting channels by permission:', {
                error: error.message,
                guildId: guildId,
                category: category
            });
            return [];
        }
    },
    
    getChannelsByCommand: async (guildId, commandName) => {
        try {
            if (!validateGuildId(guildId) || !validateString(commandName, 100)) {
                console.error('Invalid parameters for getChannelsByCommand');
                return [];
            }
            
            return await db.all(
                'SELECT DISTINCT channel_id FROM channel_permissions WHERE guild_id = ? AND command_name = ?',
                [guildId, sanitizeInput(commandName)]
            );
        } catch (error) {
            console.error('Error getting channels by command:', {
                error: error.message,
                guildId: guildId,
                commandName: commandName
            });
            return [];
        }
    },

    addTimeBasedRole: async (guildId, roleId, daysRequired, isCustomCreated = false) => {
        try {
            if (!validateGuildId(guildId) || !validateString(roleId, 100) || 
                !validateInteger(daysRequired, 0, 365) || !validateBoolean(isCustomCreated)) {
                console.error('Invalid parameters for addTimeBasedRole');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT OR REPLACE INTO time_based_roles 
                (guild_id, role_id, days_required, is_custom_created) 
                VALUES (?, ?, ?, ?)`,
                [guildId, roleId, daysRequired, isCustomCreated ? 1 : 0]
            );
        } catch (error) {
            console.error('Error adding time-based role:', {
                error: error.message,
                guildId: guildId,
                roleId: roleId,
                daysRequired: daysRequired
            });
            return { error: 'Database error', details: error.message };
        }
    },

    getTimeBasedRoles: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guildId parameter for getTimeBasedRoles');
                return [];
            }
            
            return await db.all(`
                SELECT * FROM time_based_roles
                WHERE guild_id = ?
                ORDER BY days_required ASC`,
                [guildId]
            );
        } catch (error) {
            console.error('Error getting time-based roles:', {
                error: error.message,
                guildId: guildId
            });
            return [];
        }
    },

    removeTimeBasedRole: async (guildId, roleId) => {
        try {
            if (!validateGuildId(guildId) || !validateString(roleId, 100)) {
                console.error('Invalid parameters for removeTimeBasedRole');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                DELETE FROM time_based_roles
                WHERE guild_id = ? AND role_id = ?`,
                [guildId, roleId]
            );
        } catch (error) {
            console.error('Error removing time-based role:', {
                error: error.message,
                guildId: guildId,
                roleId: roleId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    isTimeBasedRole: async (guildId, roleId) => {
        try {
            if (!validateGuildId(guildId) || !validateString(roleId, 100)) {
                console.error('Invalid parameters for isTimeBasedRole');
                return false;
            }
            
            const role = await db.get(`
                SELECT * FROM time_based_roles
                WHERE guild_id = ? AND role_id = ?`,
                [guildId, roleId]
            );
            return !!role;
        } catch (error) {
            console.error('Error checking if role is time-based:', {
                error: error.message,
                guildId: guildId,
                roleId: roleId
            });
            return false;
        }
    },

    getRoleTimeRequirement: async (guildId, roleId) => {
        try {
            if (!validateGuildId(guildId) || !validateString(roleId, 100)) {
                console.error('Invalid parameters for getRoleTimeRequirement');
                return null;
            }
            
            const role = await db.get(`
                SELECT days_required FROM time_based_roles
                WHERE guild_id = ? AND role_id = ?`,
                [guildId, roleId]
            );
            return role ? role.days_required : null;
        } catch (error) {
            console.error('Error getting role time requirement:', {
                error: error.message,
                guildId: guildId,
                roleId: roleId
            });
            return null;
        }
    },

    updateTimeBasedRole: async (guildId, roleId, daysRequired) => {
        try {
            if (!validateGuildId(guildId) || !validateString(roleId, 100) || 
                !validateInteger(daysRequired, 0, 365)) {
                console.error('Invalid parameters for updateTimeBasedRole');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                UPDATE time_based_roles 
                SET days_required = ? 
                WHERE guild_id = ? AND role_id = ?`,
                [daysRequired, guildId, roleId]
            );
        } catch (error) {
            console.error('Error updating time-based role:', {
                error: error.message,
                guildId: guildId,
                roleId: roleId,
                daysRequired: daysRequired
            });
            return { error: 'Database error', details: error.message };
        }
    },

    addFilteredTerm: async (guildId, term, severity, addedBy) => {
        try {
            if (!validateGuildId(guildId) || !validateString(term, 200) || 
                !['explicit', 'suspicious'].includes(severity) || !validateUserId(addedBy)) {
                console.error('Invalid parameters for addFilteredTerm');
                return { error: 'Invalid parameters' };
            }
            
            await db.run(
                'INSERT OR REPLACE INTO filtered_terms (guild_id, term, severity, added_by) VALUES (?, ?, ?, ?)',
                [guildId, sanitizeInput(term.toLowerCase()), severity, addedBy]
            );
            clearFilterCache(guildId);
            return { success: true };
        } catch (error) {
            console.error('Error adding filtered term:', {
                error: error.message,
                guildId: guildId,
                term: term
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    removeFilteredTerm: async (guildId, term) => {
        try {
            if (!validateGuildId(guildId) || !validateString(term, 200)) {
                console.error('Invalid parameters for removeFilteredTerm');
                return { error: 'Invalid parameters' };
            }
            
            await db.run(
                'DELETE FROM filtered_terms WHERE guild_id = ? AND term = ?',
                [guildId, term.toLowerCase()]
            );
            clearFilterCache(guildId);
            return { success: true };
        } catch (error) {
            console.error('Error removing filtered term:', {
                error: error.message,
                guildId: guildId,
                term: term
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    getFilteredTerms: async (guildId) => {
        try {
            if (!validateGuildId(guildId)) {
                console.error('Invalid guildId parameter for getFilteredTerms');
                return { explicit: [], suspicious: [] };
            }
            
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
        } catch (error) {
            console.error('Error getting filtered terms:', {
                error: error.message,
                guildId: guildId
            });
            return { explicit: [], suspicious: [] };
        }
    },
    
    importDefaultTerms: async (guildId, terms, addedBy) => {
        try {
            if (!validateGuildId(guildId) || !terms || !validateUserId(addedBy)) {
                console.error('Invalid parameters for importDefaultTerms');
                return { error: 'Invalid parameters' };
            }
            
            if (!terms.explicit || !terms.suspicious || 
                !Array.isArray(terms.explicit) || !Array.isArray(terms.suspicious)) {
                return { error: 'Invalid terms format' };
            }
            
            const transactionId = await database.beginTransaction();
            
            try {
                for (const term of terms.explicit) {
                    if (!validateString(term, 200)) continue;
                    await database.addFilteredTerm(guildId, term, 'explicit', addedBy);
                }
                for (const term of terms.suspicious) {
                    if (!validateString(term, 200)) continue;
                    await database.addFilteredTerm(guildId, term, 'suspicious', addedBy);
                }
                
                await database.commitTransaction(transactionId);
                return { success: true };
            } catch (error) {
                await database.rollbackTransaction(transactionId);
                throw error;
            }
        } catch (error) {
            console.error('Error importing default terms:', {
                error: error.message,
                guildId: guildId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    getActiveUserTickets: async (userId) => {
        try {
            if (!validateUserId(userId)) {
                console.error('Invalid userId parameter for getActiveUserTickets');
                return [];
            }
            
            return await db.all(`
                SELECT * FROM tickets
                WHERE user_id = ? AND status = 'OPEN'
                ORDER BY created_at DESC`,
                [userId]
            );
        } catch (error) {
            console.error('Error getting active user tickets:', {
                error: error.message,
                userId: userId
            });
            return [];
        }
    },

    getTicket: async (channelOrThreadId) => {
        try {
            if (!validateChannelId(channelOrThreadId)) {
                console.error('Invalid channelOrThreadId parameter for getTicket');
                return null;
            }
            
            return await db.get(`
                SELECT * FROM tickets
                WHERE channel_id = ? OR thread_id = ?`,
                [channelOrThreadId, channelOrThreadId]
            );
        } catch (error) {
            console.error('Error getting ticket:', {
                error: error.message,
                channelOrThreadId: channelOrThreadId
            });
            return null;
        }
    },

    getLatestTicket: async (userId) => {
        try {
            if (!validateUserId(userId)) {
                console.error('Invalid userId parameter for getLatestTicket');
                return null;
            }
            
            return await db.get(`
                SELECT * FROM tickets
                WHERE user_id = ? AND status = 'OPEN'
                ORDER BY created_at DESC
                LIMIT 1`,
                [userId]
            );
        } catch (error) {
            console.error('Error getting latest ticket:', {
                error: error.message,
                userId: userId
            });
            return null;
        }
    },

    createTicket: async (guildId, userId, channelId, threadId = null) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId) || 
                !validateChannelId(channelId) || (threadId !== null && !validateThreadId(threadId))) {
                console.error('Invalid parameters for createTicket');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT INTO tickets (guild_id, user_id, channel_id, thread_id)
                VALUES (?, ?, ?, ?)`,
                [guildId, userId, channelId, threadId]
            );
        } catch (error) {
            console.error('Error creating ticket:', {
                error: error.message,
                guildId: guildId,
                userId: userId,
                channelId: channelId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    addTicketMessage: async (ticketId, authorId, content) => {
        try {
            if (!validateInteger(ticketId, 1) || !validateUserId(authorId) || !validateString(content, 4000)) {
                console.error('Invalid parameters for addTicketMessage');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT INTO ticket_messages (ticket_id, author_id, content)
                VALUES (?, ?, ?)`,
                [ticketId, authorId, sanitizeInput(content)]
            );
        } catch (error) {
            console.error('Error adding ticket message:', {
                error: error.message,
                ticketId: ticketId,
                authorId: authorId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    closeTicket: async (ticketId, closedBy) => {
        try {
            if (!validateInteger(ticketId, 1) || !validateUserId(closedBy)) {
                console.error('Invalid parameters for closeTicket');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                UPDATE tickets
                SET status = 'CLOSED',
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by = ?
                WHERE id = ?`,
                [closedBy, ticketId]
            );
        } catch (error) {
            console.error('Error closing ticket:', {
                error: error.message,
                ticketId: ticketId,
                closedBy: closedBy
            });
            return { error: 'Database error', details: error.message };
        }
    },

    isUserBlocked: async (guildId, userId) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId)) {
                console.error('Invalid parameters for isUserBlocked');
                return false;
            }
            
            const result = await db.get(`
                SELECT 1 FROM blocked_ticket_users
                WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
            return !!result;
        } catch (error) {
            console.error('Error checking if user is blocked:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return false;
        }
    },

    blockUser: async (guildId, userId, blockedBy, reason) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId) || 
                !validateUserId(blockedBy) || !validateString(reason, 1000)) {
                console.error('Invalid parameters for blockUser');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                INSERT OR REPLACE INTO blocked_ticket_users
                (guild_id, user_id, blocked_by, reason)
                VALUES (?, ?, ?, ?)`,
                [guildId, userId, blockedBy, sanitizeInput(reason)]
            );
        } catch (error) {
            console.error('Error blocking user:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    unblockUser: async (guildId, userId) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId)) {
                console.error('Invalid parameters for unblockUser');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                DELETE FROM blocked_ticket_users
                WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
        } catch (error) {
            console.error('Error unblocking user:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return { error: 'Database error', details: error.message };
        }
    },

    getRecentTickets: async (guildId, userId) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId)) {
                console.error('Invalid parameters for getRecentTickets');
                return [];
            }
            
            return await db.all(`
                SELECT * FROM tickets
                WHERE guild_id = ? AND user_id = ?
                AND created_at > datetime('now', '-1 day')`,
                [guildId, userId]
            );
        } catch (error) {
            console.error('Error getting recent tickets:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return [];
        }
    },

    getAllUserTickets: async (guildId, userId) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId)) {
                console.error('Invalid parameters for getAllUserTickets');
                return [];
            }
            
            return await db.all(`
                SELECT * FROM tickets
                WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
        } catch (error) {
            console.error('Error getting all user tickets:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return [];
        }
    },

    wipeUserTickets: async (guildId, userId) => {
        try {
            if (!validateGuildId(guildId) || !validateUserId(userId)) {
                console.error('Invalid parameters for wipeUserTickets');
                return { error: 'Invalid parameters' };
            }
            
            return await db.run(`
                DELETE FROM tickets
                WHERE guild_id = ? AND user_id = ?`,
                [guildId, userId]
            );
        } catch (error) {
            console.error('Error wiping user tickets:', {
                error: error.message,
                guildId: guildId,
                userId: userId
            });
            return { error: 'Database error', details: error.message };
        }
    },
    
    // safely close the database connection
    shutdown: async () => {
        try {
            // Clear any open transaction timeouts
            for (const timeout of transactionTimeouts.values()) {
                clearTimeout(timeout);
            }
            transactionTimeouts.clear();
            
            // Ensure cache is cleaned up
            serverSettingsCache.clear();
            
            // Clean up reminder timeouts if reminderManager exists
            if (global.reminderManager) {
                global.reminderManager.cleanup();
            }
            
            console.log('Closing database connection...');
            await db.close();
            console.log('Database connection closed successfully');
            return true;
        } catch (error) {
            console.error('Error closing database connection:', error);
            return false;
        }
    }
};

// Initialize database
await initDatabase();

// Cleanup intervals
setInterval(async () => {
    try {
        const expiredWarnings = await database.clearExpiredWarnings();
        if (Object.keys(expiredWarnings).length > 0) {
            console.log(`Cleared ${Object.keys(expiredWarnings).length} expired warnings`);
        }
        
        const spamResult = await database.clearOldSpamWarnings(24);
        const reportsResult = await database.clearOldResolvedReports(30);
        
        const remindersResult = await database.cleanupExpiredReminders();
        
        serverSettingsCache.clear();
        lastCacheCleanup = Date.now();
    } catch (error) {
        console.error('Error in database cleanup interval:', error);
    }
}, 6 * 60 * 60 * 1000); // Every 6 hours

// Setup graceful shutdown handlers
process.on('SIGINT', async () => {
    console.log('Received SIGINT, shutting down database...');
    await database.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM, shutting down database...');
    await database.shutdown();
    process.exit(0);
});

export default database;