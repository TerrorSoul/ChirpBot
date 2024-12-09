export const command = {
    name: 'template',
    description: 'Get a basic Trailmakers mod template',
    permissionLevel: 'moderator',
    execute: async (interaction) => {
        const template = `# 📝 Trailmakers Mod Template\n\n\`\`\`lua
-- Mod: ${interaction.user.username}'s Trailmakers Mod
-- Created with Trailmakers Bot
-- Date: ${new Date().toISOString().split('T')[0]}

-- Initialize any necessary variables
local initialized = false

-- Called when the mod is initialized
function init()
    -- Log initialization
    tm.os.Log("Mod initialized!")
    
    -- Set up any required configurations
    initialized = true
    
    -- Set update frequency (60 times per second)
    tm.os.SetModTargetDeltaTime(1/60)
end

-- Called every update cycle
function update()
    -- Safety check to ensure initialization
    if not initialized then return end
    
    -- Add your update logic here
    -- Example: tm.os.Log("Update cycle: " .. tm.os.GetTime())
end

-- Register the init function to start the mod
init()\`\`\``;
        
        await interaction.reply(template);
    }
};