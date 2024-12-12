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

async function runMigration(version, description, up) {
    console.log(`Running migration ${version}: ${description}`);
    try {
        await up(db);
        await db.run(
            'INSERT INTO migrations (version, description, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [version, description]
        );
        console.log(`Migration ${version} completed successfully`);
    } catch (error) {
        console.error(`Migration ${version} failed:`, error);
        throw error;
    }
}

async function initMigrations() {
    // Create migrations table if it doesn't exist
    await db.run(`
        CREATE TABLE IF NOT EXISTS migrations (
            version INTEGER PRIMARY KEY,
            description TEXT NOT NULL,
            applied_at TIMESTAMP NOT NULL
        )
    `);

    // Get current version
    const result = await db.get('SELECT MAX(version) as version FROM migrations');
    const currentVersion = result?.version || 0;
    console.log('Current database version:', currentVersion);

    // Define all migrations
    const migrations = [
        {
            version: 1,
            description: 'Initial schema setup',
            up: async (db) => {
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

                await db.run(`
                    CREATE TABLE IF NOT EXISTS block_info (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        section TEXT,
                        title TEXT NOT NULL,
                        image TEXT,
                        caption TEXT,
                        weight TEXT,
                        size TEXT,
                        hp TEXT,
                        aero TEXT,
                        other TEXT,
                        about TEXT,
                        added_by TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
            }
        },
        {
            version: 2,
            description: 'Add message and role tables',
            up: async (db) => {
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
            }
        },
        {
            version: 3,
            description: 'Add reports and quotes tables',
            up: async (db) => {
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
            }
        },
        {
            version: 4,
            description: 'Add audit and warning tables',
            up: async (db) => {
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
            }
        },
        {
            version: 5,
            description: 'Add logging and welcome history tables',
            up: async (db) => {
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
            }
        },
        {
            version: 6,
            description: 'Add backup and spam tables',
            up: async (db) => {
                await db.run(`
                    CREATE TABLE IF NOT EXISTS server_backups (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        guild_id TEXT NOT NULL,
                        backup_data TEXT NOT NULL,
                        created_by TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
        
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
            }
        },
        {
            version: 7,
            description: 'Create all remaining indices',
            up: async (db) => {
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
                await db.run(`CREATE INDEX IF NOT EXISTS idx_block_info_guild_title ON block_info(guild_id, title)`);
            }
        }
    ];

    // Run pending migrations in order
    for (const migration of migrations) {
        if (migration.version > currentVersion) {
            await runMigration(migration.version, migration.description, migration.up);
        }
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

        // Run migrations
        await initMigrations();

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
        await db.run(`CREATE INDEX IF NOT EXISTS idx_block_info_guild_title ON block_info(guild_id, title)`);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        process.exit(1);
    }
}

const database = {
    // Database version management
    getCurrentVersion: async () => {
        const result = await db.get('SELECT MAX(version) as version FROM migrations');
        return result?.version || 0;
    },

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
                await db.run(`
                    UPDATE command_packs 
                    SET description = ?, category = ?, is_core = ?
                    WHERE name = ?
                `, [description, category, isCore, packName]);
                return true;
            }

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

            return result?.is_core === 1 || result?.enabled === 1;
        } catch (error) {
            console.error('Error checking pack enabled status:', error);
            return false;
        }
    },

    enablePack: async (guildId, packName) => {
        try {
            const pack = await db.get('SELECT id FROM command_packs WHERE name = ?', [packName]);
            if (!pack) {
                return false;
            }

            await db.run(`
                INSERT OR REPLACE INTO server_command_packs 
                (guild_id, pack_id, enabled) 
                VALUES (?, ?, 1)
            `, [guildId, pack.id]);

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

    // Block Info Management
    importBlockInfo: async (guildId, section, blockData) => {
        console.log(`Starting importBlockInfo for section ${section}`);
        
        const stmt = await db.prepare(`
            INSERT INTO block_info (
                guild_id, section, title, image, caption, weight, 
                size, hp, aero, other, about, added_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        try {
            if (blockData.categories) {
                for (const category of blockData.categories) {
                    for (const block of category.blocks) {
                        await stmt.run([
                            guildId,
                            `${section} - ${category.name}`,
                            block.title,
                            block.image,
                            block.caption || '',
                            block.weight,
                            block.size,
                            block.hp?.toString() || '',
                            block.aero || '',
                            block.other || '',
                            block.about || '',
                            'SYSTEM'
                        ]);
                    }
                }
            }
        } catch (error) {
            console.error(`Error during block import for section ${section}:`, error);
            throw error;
        } finally {
            await stmt.finalize();
        }
    },

    importBlocksData: async (guildId, packName) => {
        const blocksPath = path.join(__dirname, '..', 'commands', 'packs', packName, 'blocks.json');
        if (!fs.existsSync(blocksPath)) return;
    
        try {
            const blockData = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
            
            for (const section of blockData.blocks) {
                await database.importBlockInfo(guildId, section.section, section);
            }
        } catch (error) {
            console.error('Error importing blocks:', error);
            throw error;
        }
    },

    searchBlockTitles: async (guildId, search) => {
        try {
            return await db.all(
                `SELECT DISTINCT title 
                 FROM block_info 
                 WHERE guild_id = ? 
                 AND LOWER(title) LIKE LOWER(?)
                 ORDER BY title LIMIT 25`,
                [guildId, `%${search}%`]
            );
        } catch (error) {
            console.error('Error searching block titles:', error);
            return [];
        }
    },

    getBlockInfo: async (guildId, blockName) => {
        let block = await db.get(
            'SELECT * FROM block_info WHERE guild_id = ? AND LOWER(title) = LOWER(?)',
            [guildId, blockName]
        );
        
        if (!block) {
            block = await db.get(
                'SELECT * FROM block_info WHERE guild_id = ? AND LOWER(title) LIKE LOWER(?)',
                [guildId, `%${blockName}%`]
            );
        }
    
        return block;
    },

    getBlockCategories: async (guildId, section) => {
        try {
            const sectionPrefix = `${section} - `;
            const categories = await db.all(`
                SELECT DISTINCT SUBSTR(section, LENGTH(?) + 1) as category
                FROM block_info
                WHERE guild_id = ? 
                AND section LIKE ?
                ORDER BY category
            `, [sectionPrefix, guildId, sectionPrefix + '%']);
            
            return categories.map(row => row.category);
        } catch (error) {
            console.error('Error getting block categories:', error);
            return [];
        }
    },
    
    searchCategories: async (guildId, section, search) => {
        try {
            const sectionPrefix = `${section} - `;
            const categories = await db.all(`
                SELECT DISTINCT SUBSTR(section, LENGTH(?) + 1) as category
                FROM block_info
                WHERE guild_id = ? 
                AND section LIKE ?
                AND LOWER(section) LIKE LOWER(?)
                ORDER BY category
                LIMIT 25
            `, [sectionPrefix, guildId, sectionPrefix + '%', '%' + search + '%']);
    
            return categories.map(row => row.category);
        } catch (error) {
            console.error('Error searching categories:', error);
            return [];
        }
    },

    addBlockInfo: async (guildId, data, addedBy) => {
        const result = await db.run(`
            INSERT INTO block_info (
                guild_id, section, title, image, caption, weight, 
                size, hp, aero, other, about, added_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            guildId, data.section, data.title, data.image || null, 
            data.caption, data.weight, data.size, data.hp, 
            data.aero, data.other, data.about, addedBy
        ]);
        return result.lastID;
    },

    removeBlockInfo: async (guildId, title) => {
        const result = await db.run(
            'DELETE FROM block_info WHERE guild_id = ? AND LOWER(title) = LOWER(?)',
            [guildId, title]
        );
        return result.changes > 0;
    },

    updateBlockInfo: async (guildId, title, updates) => {
        const setClauses = Object.entries(updates)
            .filter(([_, value]) => value !== null)
            .map(([key, _]) => `${key} = ?`)
            .join(', ');
        
        const values = [
            ...Object.entries(updates)
                .filter(([_, value]) => value !== null)
                .map(([_, value]) => value),
            guildId,
            title
        ];
    
        return await db.run(`
            UPDATE block_info 
            SET ${setClauses}
            WHERE guild_id = ? AND LOWER(title) = LOWER(?)
        `, values);
    },

    // Backup and Restore
    createBackup: async (guildId) => {
        try {
            await database.beginTransaction();

            const backup = {
                version: await database.getCurrentVersion(),
                timestamp: new Date().toISOString(),
                data: {}
            };

            // Backup each table with guild_id
            const tables = [
                'server_settings',
                'block_info',
                'server_command_packs',
                'role_messages',
                'command_permissions',
                'reports',
                'quotes',
                'warnings',
                'logs'
            ];

            for (const table of tables) {
                backup.data[table] = await db.all(
                    `SELECT * FROM ${table} WHERE guild_id = ?`,
                    [guildId]
                );
            }

            await database.commitTransaction();
            return backup;
        } catch (error) {
            await database.rollbackTransaction();
            throw error;
        }
    },

    restoreBackup: async (guildId, backup) => {
        try {
            await database.beginTransaction();

            // Clear existing data
            await database.resetServer(guildId);

            // Restore each table
            for (const [table, data] of Object.entries(backup.data)) {
                if (!data || !data.length) continue;

                const columns = Object.keys(data[0]);
                const placeholders = columns.map(() => '?').join(',');
                
                const stmt = await db.prepare(`
                    INSERT INTO ${table} (${columns.join(',')})
                    VALUES (${placeholders})
                `);

                for (const row of data) {
                    await stmt.run(Object.values(row));
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

    // Health Check
    getDatabaseHealth: async () => {
        try {
            const health = {
                version: await database.getCurrentVersion(),
                tables: {},
                indexes: {},
                lastMigration: null
            };

            // Get table info
            const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
            for (const table of tables) {
                const count = await db.get(`SELECT COUNT(*) as count FROM ${table.name}`);
                health.tables[table.name] = count.count;
            }

            // Get last migration info
            const lastMigration = await db.get(
                'SELECT * FROM migrations ORDER BY version DESC LIMIT 1'
            );
            health.lastMigration = lastMigration;

            return health;
        } catch (error) {
            console.error('Error checking database health:', error);
            throw error;
        }
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