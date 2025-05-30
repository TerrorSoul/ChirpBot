// src/services/mistralService.js
import MistralClient from '@mistralai/mistralai';

let mistralClients = [];
let currentClientIndex = 0;

export function initMistral() {
    // Collect all numbered API keys from environment
    const apiKeys = [];
    let keyIndex = 1;
    
    // Check for numbered keys (MISTRAL_API_KEY_1, MISTRAL_API_KEY_2, etc.)
    while (process.env[`MISTRAL_API_KEY_${keyIndex}`]) {
        apiKeys.push(process.env[`MISTRAL_API_KEY_${keyIndex}`]);
        keyIndex++;
    }
    
    if (apiKeys.length === 0) {
        throw new Error('No Mistral API keys found. Please set MISTRAL_API_KEY_1, MISTRAL_API_KEY_2, etc. in your environment variables');
    }
    
    // Create clients for each API key
    mistralClients = apiKeys.map(key => new MistralClient(key));
    
    console.log(`Initialized ${mistralClients.length} Mistral API clients`);
}

// Get the next client in rotation
function getNextClient() {
    if (mistralClients.length === 0) {
        throw new Error('No Mistral clients initialized');
    }
    
    const client = mistralClients[currentClientIndex];
    currentClientIndex = (currentClientIndex + 1) % mistralClients.length;
    return client;
}

export async function generateJoke() {
    const client = getNextClient();
    const chatResult = await client.chat({
        model: "open-mistral-nemo",
        messages: [
            {
                role: "system",
                content: "You are a comedy writer creating one short, clever joke specifically for Trailmakers players. The joke should focus on real in-game mechanics such as building vehicles, using blocks (wheels, engines, buoyancy blocks, servos, cannons), or interacting with the game's terrain (desert, ocean, mountains, floating islands). Use actual gameplay scenarios like vehicle malfunctions, failed builds, or funny outcomes. Keep the joke concise (one or two sentences) and sharp, without relying on forced puns or wordplay. Include two emojis for flair but avoid overdoing them. The humor can be slightly edgy, but it should always be family-friendly and connected directly to Trailmakers gameplay. The goal is to make the joke feel authentic to the game's mechanics and relatable to players."
            },
            {
                role: "user",
                content: "Generate a funny short Trailmakers joke"
            }
        ],
        temperature: 0.7
    });

    return chatResult.choices[0].message.content;
}

export async function generateModCode(prompt, includeExplanation = false) {
    const client = getNextClient();
    const chatResult = await client.chat({
        model: "devstral-small-2505",
        messages: [
            {
                role: "system",
                content: `You are an expert Trailmakers mod developer. Generate clean, well-commented Lua code using ONLY the official Trailmakers modding API.

CORE PRINCIPLES:
- Use 'local' for all variables
- Never use object-oriented syntax (no : notation)
- Never use print(), always use tm.os.Log()
- Code runs from top to bottom when mod loads
- Only include update() function if the mod needs frame-based logic
- Simple one-time actions don't need any functions

API FUNCTIONS WITH TYPES:

1. TIMING & LOGGING:
- tm.os.SetModTargetDeltaTime(targetDeltaTime: number) → nil
  Example: tm.os.SetModTargetDeltaTime(1/60) -- 60fps
- tm.os.GetModDeltaTime() → number (seconds since last update)
- tm.os.GetTime() → number (game time in seconds)
- tm.os.GetRealtimeSinceStartup() → number (real time in seconds)
- tm.os.Log(message: string) → nil
  Example: tm.os.Log("Hello world")

2. FILE OPERATIONS:
- tm.os.ReadAllText_Static(path: string) → string
- tm.os.ReadAllText_Dynamic(path: string) → string
- tm.os.WriteAllText_Dynamic(path: string, content: string) → nil

3. PHYSICS (tm.physics):
- tm.physics.SetGravityMultiplier(multiplier: number) → nil
  Example: tm.physics.SetGravityMultiplier(2.0) -- Double gravity
- tm.physics.GetGravityMultiplier() → number
- tm.physics.SetTimeScale(speed: number) → nil
- tm.physics.GetTimeScale() → number
- tm.physics.SpawnObject(position: ModVector3, name: string) → ModGameObject
  Example: tm.physics.SpawnObject(tm.vector3.Create(0, 10, 0), "PFB_Barrel")
- tm.physics.DespawnObject(gameObject: ModGameObject) → nil
- tm.physics.SpawnableNames() → string[] (table of spawnable names)
- tm.physics.SpawnBoxTrigger(position: ModVector3, size: ModVector3) → ModGameObject
- tm.physics.SpawnCustomObject(position: ModVector3, meshName: string, textureName: string) → ModGameObject
- tm.physics.Raycast(origin: ModVector3, direction: ModVector3, hitOut: ModVector3, maxDistance: number, ignoreTriggers: boolean) → boolean
- tm.physics.RaycastData(origin: ModVector3, direction: ModVector3, maxDistance: number, ignoreTriggers: boolean) → ModRaycastHit
- tm.physics.GetMapName() → string

4. PLAYERS (tm.players):
- tm.players.CurrentPlayers() → Player[] (table of player objects)
- tm.players.GetPlayerName(playerId: number) → string
  Example: tm.players.GetPlayerName(0) -- Host player name
- tm.players.GetPlayerTransform(playerId: number) → ModTransform
- tm.players.GetPlayerGameObject(playerId: number) → ModGameObject
- tm.players.GetPlayerStructures(playerId: number) → ModStructure[] (table)
- tm.players.GetPlayerStructuresInBuild(playerId: number) → ModStructure[] (table)
- tm.players.GetPlayerSelectBlockInBuild(playerId: number) → ModBlock
- tm.players.IsPlayerInSeat(playerId: number) → boolean
- tm.players.GetPlayerIsInBuildMode(playerId: number) → boolean
- tm.players.KillPlayer(playerId: number) → nil
- tm.players.CanKillPlayer(playerId: number) → boolean
- tm.players.SetPlayerIsInvincible(playerId: number, enabled: boolean) → nil
- tm.players.SetJetpackEnabled(playerId: number, enabled: boolean) → nil
- tm.players.GetPlayerTeam(playerId: number) → number
- tm.players.SetPlayerTeam(playerId: number, teamID: number) → nil
- tm.players.GetMaxTeamIndex() → number
- tm.players.SpawnStructure(playerId: number, blueprint: string, structureId: string, position: ModVector3, rotation: ModVector3) → nil
- tm.players.DespawnStructure(structureId: string) → nil
- tm.players.PlacePlayerInSeat(playerId: number, structureId: string) → nil

5. UI SYSTEM (tm.playerUI):
- tm.playerUI.AddUIButton(playerId: number, id: string, text: string, callback: function, data: any) → nil
  Example: tm.playerUI.AddUIButton(0, "myButton", "Click Me", myCallback, nil)
- tm.playerUI.AddUIText(playerId: number, id: string, defaultValue: string, callback: function, data: any) → nil
- tm.playerUI.AddUILabel(playerId: number, id: string, text: string) → nil
- tm.playerUI.RemoveUI(playerId: number, id: string) → nil
- tm.playerUI.SetUIValue(playerId: number, id: string, value: string) → nil
- tm.playerUI.ClearUI(playerId: number) → nil
- tm.playerUI.AddSubtleMessageForPlayer(playerId: number, header: string, message: string, duration: number, spriteAssetName: string) → string (message ID)
- tm.playerUI.AddSubtleMessageForAllPlayers(header: string, message: string, duration: number, spriteAssetName: string) → string (message ID)

6. VECTOR3 OPERATIONS (tm.vector3):
- tm.vector3.Create(x: number, y: number, z: number) → ModVector3
- tm.vector3.Create() → ModVector3 (zero vector)
- tm.vector3.Create(input: string) → ModVector3 (from string like "(1, 2, 3)")
- tm.vector3.Right() → ModVector3 (1, 0, 0)
- tm.vector3.Left() → ModVector3 (-1, 0, 0)
- tm.vector3.Up() → ModVector3 (0, 1, 0)
- tm.vector3.Down() → ModVector3 (0, -1, 0)
- tm.vector3.Forward() → ModVector3 (0, 0, 1)
- tm.vector3.Back() → ModVector3 (0, 0, -1)

7. VECTOR3 METHODS (on ModVector3 objects):
- vector.Magnitude() → number (length of vector)
- vector.Dot(otherVector: ModVector3) → number
- vector.Cross(otherVector: ModVector3) → ModVector3
- vector.Distance(otherVector: ModVector3) → number
- vector.Angle(otherVector: ModVector3) → number (degrees)

8. AUDIO (tm.audio):
- tm.audio.PlayAudioAtPosition(audioName: string, position: ModVector3, keepObjectDuration: number) → nil
- tm.audio.PlayAudioAtGameobject(audioName: string, gameObject: ModGameObject) → nil
- tm.audio.StopAllAudioAtGameobject(gameObject: ModGameObject) → nil
- tm.audio.GetAudioNames() → string[] (table of available audio clips)

9. INPUT (tm.input):
- tm.input.RegisterFunctionToKeyDownCallback(playerId: number, functionName: string, keyName: string) → function
- tm.input.RegisterFunctionToKeyUpCallback(playerId: number, functionName: string, keyName: string) → function

10. WORLD (tm.world):
- tm.world.SetTimeOfDay(percentage: number) → nil (0-100)
- tm.world.GetTimeOfDay() → number (0-100)
- tm.world.SetPausedTimeOfDay(isPaused: boolean) → nil
- tm.world.SetCycleDurationTimeOfDay(duration: number) → nil (seconds)
- tm.world.IsTimeOfDayPaused() → boolean

11. GAMEOBJECT METHODS (on ModGameObject):
- gameObject.Despawn() → nil
- gameObject.GetTransform() → ModTransform
- gameObject.SetIsVisible(isVisible: boolean) → nil
- gameObject.GetIsVisible() → boolean
- gameObject.Exists() → boolean
- gameObject.AddForce(x: number, y: number, z: number) → nil
- gameObject.SetTexture(textureName: string) → nil

12. TRANSFORM METHODS (on ModTransform - CRITICAL FOR SCALING):
- transform.SetPosition(position: ModVector3) → nil
- transform.SetPosition(x: number, y: number, z: number) → nil
- transform.GetPosition() → ModVector3
- transform.SetRotation(rotation: ModVector3) → nil
- transform.SetRotation(x: number, y: number, z: number) → nil
- transform.GetRotation() → ModVector3
- transform.SetScale(scale: ModVector3) → nil
- transform.SetScale(x: number, y: number, z: number) → nil
- transform.SetScale(scale: number) → nil (uniform scaling)
- transform.GetScale() → ModVector3

13. STRUCTURE METHODS (on ModStructure):
- structure.GetBlocks() → ModBlock[] (table of blocks)
- structure.AddForce(x: number, y: number, z: number) → nil
- structure.GetVelocity() → ModVector3
- structure.GetSpeed() → number (m/s)
- structure.GetOwnedByPlayerId() → number (-1 if no owner)
- structure.GetPowerCores() → number
- structure.Destroy() → nil

14. BLOCK METHODS (on ModBlock):
- block.SetPrimaryColor(r: number, g: number, b: number) → nil (build mode only, 0-1 range)
- block.SetSecondaryColor(r: number, g: number, b: number) → nil (build mode only, 0-1 range)
- block.SetMass(mass: number) → nil (build mode only)
- block.GetMass() → number
- block.SetBuoyancy(buoyancy: number) → nil (build mode only)
- block.GetBuoyancy() → number
- block.SetHealth(hp: number) → nil
- block.GetCurrentHealth() → number
- block.GetStartHealth() → number
- block.GetName() → string (block type name)
- block.SetEnginePower(power: number) → nil (engine blocks only, 0-1)
- block.GetEnginePower() → number
- block.SetJetPower(power: number) → nil (jet blocks only, 0-1)
- block.GetJetPower() → number
- block.IsEngineBlock() → boolean
- block.IsJetBlock() → boolean
- block.IsPropellerBlock() → boolean
- block.IsPlayerSeatBlock() → boolean
- block.Exists() → boolean

STRUCTURE EXAMPLES:

Spawning and scaling objects:
-- Spawn a sheep and make it twice as big
local position = tm.vector3.Create(0, 300, 0)
local sheep = tm.physics.SpawnObject(position, "PFB_Sheep")
if sheep.Exists() then
    local sheepTransform = sheep.GetTransform()
    sheepTransform.SetScale(2.0) -- Make it twice as big
    tm.os.Log("Spawned and scaled sheep")
end

-- Spawn multiple objects with different scales
local objects = {"PFB_Barrel", "PFB_Sheep", "PFB_Cow"}
for i = 1, #objects do
    local pos = tm.vector3.Create(i * 5, 10, 0)
    local obj = tm.physics.SpawnObject(pos, objects[i])
    if obj.Exists() then
        local transform = obj.GetTransform()
        transform.SetScale(0.5 + i * 0.5) -- Different scales: 1.0, 1.5, 2.0
    end
end

Frame-based mod:
-- Gravity controller that changes over time
tm.os.SetModTargetDeltaTime(1/60)
local timeElapsed = 0

function update()
    timeElapsed = timeElapsed + tm.os.GetModDeltaTime()
    local newGravity = 1.0 + math.sin(timeElapsed) * 0.5
    tm.physics.SetGravityMultiplier(newGravity)
end

CRITICAL RULES:
1. ALL variables must be declared with 'local'
2. ALWAYS check if objects exist before using them with .Exists()
3. To scale objects: spawn → get transform → set scale
4. Player IDs range 0-7, where 0 is always the host
5. Colors use 0-1 range (not 0-255)
6. Only use tm.os.SetModTargetDeltaTime() if you have an update() function
7. Tables in Lua are 1-indexed, not 0-indexed
8. Use proper type checking when working with returned tables/objects

FORMAT: Generate clean Lua code with proper types and error checking.` + (includeExplanation ? "" : "\nProvide code only, no explanation.")
            },
            {
                role: "user",
                content: `Generate Trailmakers Lua code for: ${prompt}`
            }
        ],
        temperature: 0.2
    });

    return chatResult.choices[0].message.content;
}

export async function scanImageForNSFW(imageUrl) {
    const client = getNextClient();
    try {
        const chatResult = await client.chat({
            model: "pixtral-12b-2409",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: "Is this image NSFW? Reply: SAFE, NSFW, or UNCLEAR"
                        },
                        {
                            type: "image_url",
                            image_url: imageUrl
                        }
                    ]
                }
            ],
            temperature: 0.1,
            max_tokens: 10 // Limit response to save tokens
        });

        const response = chatResult.choices[0].message.content.trim().toUpperCase();
        
        // Validate response and default to UNCLEAR if unexpected
        if (['SAFE', 'NSFW', 'UNCLEAR'].includes(response)) {
            return response;
        } else {
            console.warn('Unexpected NSFW scan response:', response);
            return 'UNCLEAR';
        }
    } catch (error) {
        console.error('Error scanning image for NSFW content:', error);
        return 'UNCLEAR'; // Default to unclear on error
    }
}

export async function checkImageAgainstRules(imageUrl, serverRules) {
    const client = getNextClient();
    try {
        const chatResult = await client.chat({
            model: "pixtral-12b-2409",
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: `Analyze this image against these server rules:

${serverRules}

Does this image violate any of the above rules? Consider:
- Inappropriate content
- Offensive imagery  
- Rule-breaking behavior shown
- Community guidelines

Respond with either:
- "No violations detected" if the image is acceptable
- "Potential violation: [specific rule and reason]" if there are concerns`
                        },
                        {
                            type: "image_url",
                            image_url: imageUrl
                        }
                    ]
                }
            ],
            temperature: 0.2,
            max_tokens: 100
        });

        return chatResult.choices[0].message.content.trim();
    } catch (error) {
        console.error('Error checking image against rules:', error);
        return 'Error analyzing image content';
    }
}

export async function analyzeMessage(content) {
    const client = getNextClient();
    const chatResult = await client.chat({
        model: "open-mistral-nemo", 
        messages: [
            {
                role: "system", 
                content: `
                    You are a moderation assistant. Analyze the following message based on these server rules:
                    1. If staff (Moderators and/or Devs) tell you to stop a certain behavior, just stop.
                    2. No discrimination - No hate speech or offensive language (e.g., swastikas, fascist references, racist, sexist).
                    3. Arguments are fine, but be civilized. Don't insult or degrade others.
                    4. No NSFW content or chatting.
                    5. No mindless shitposting (including in off-topic channels).
                    6. Stay on topic in channels, read channel descriptions if unsure.
                    7. No advertising or promoting other servers.
                    8. This is an English-speaking server.
                    9. No disruptive or annoying behavior (e.g., excessive spam or disruptive actions).

                    For each message, provide the following response:
                    - **Action:** <recommended action>
                    - **Reason:** <reason for action>
                    If no action is required, state "No action needed" with a reason if appropriate. If the message violates any rules, suggest an action like "Warn user", "Mute user", "Delete message", etc.
                `
            },
            {
                role: "user", 
                content: `Analyze the following message based on the above rules: "${content}"`
            }
        ]
    });

    const responseMessage = chatResult.choices[0].message.content.trim();
    
    return responseMessage;
}

export async function translateToEnglish(text) {
    const client = getNextClient();
    try {
        const chatResult = await client.chat({
            model: "open-mistral-nemo", 
            messages: [
                {
                    role: "system", 
                    content: `You are a professional translator. Your task is to translate any non-English text into clear, natural English. 

Rules:
1. If text is already in English, return it exactly as is
2. If text contains mixed languages, translate only the non-English parts
3. Preserve the original tone and meaning
4. For greetings: "bonjour" = "hello", "hola" = "hello", "guten tag" = "hello"
5. For thanks: "gracias" = "thank you", "merci" = "thank you", "danke" = "thank you"
6. Translate complete sentences naturally
7. Return ONLY the English text, no explanations

Examples:
- "bonjour" → "hello"
- "gracias amigo" → "thank you friend"  
- "comment allez-vous?" → "how are you?"
- "hello world" → "hello world"
- "¿cómo estás?" → "how are you?"`
                },
                {
                    role: "user", 
                    content: text
                }
            ],
            temperature: 0.1,
            max_tokens: 200
        });

        const translatedMessage = chatResult.choices[0].message.content.trim();
        
        // Clean up any formatting artifacts
        return translatedMessage
            .replace(/^["'`]|["'`]$/g, '') // Remove wrapping quotes
            .replace(/^\*\*|\*\*$/g, '') // Remove bold formatting
            .replace(/^Translation:\s*/i, '') // Remove "Translation:" prefix
            .trim();
        
    } catch (error) {
        console.error('Translation error:', error);
        return text; // Return original text if translation fails
    }
}

export async function explainCode(code) {
    const client = getNextClient();
    const result = await client.chat({
        model: "devstral-small-2505",
        messages: [
            {
                role: "system",
                content: `You are a Trailmakers modding expert. Explain Lua code in detail, focusing on Trailmakers API usage, types, and best practices.

TRAILMAKERS API REFERENCE FOR EXPLANATIONS:

1. TIMING & LOGGING:
- tm.os.SetModTargetDeltaTime(targetDeltaTime: number) → nil (sets update frequency, only needed with update())
- tm.os.GetModDeltaTime() → number (seconds since last update, use in update())
- tm.os.GetTime() → number (game time in seconds)
- tm.os.Log(message: string) → nil (console logging, never use print())

2. PHYSICS:
- tm.physics.SetGravityMultiplier(multiplier: number) → nil (1.0 = normal gravity)
- tm.physics.SpawnObject(position: ModVector3, name: string) → ModGameObject
- tm.physics.DespawnObject(gameObject: ModGameObject) → nil
- tm.physics.SpawnableNames() → string[] (get valid spawn names)
- tm.physics.SpawnBoxTrigger(position: ModVector3, size: ModVector3) → ModGameObject

3. PLAYERS:
- tm.players.GetPlayerName(playerId: number) → string (playerId 0-7, 0=host)
- tm.players.GetPlayerTransform(playerId: number) → ModTransform
- tm.players.GetPlayerStructures(playerId: number) → ModStructure[]
- tm.players.KillPlayer(playerId: number) → nil
- tm.players.SetPlayerIsInvincible(playerId: number, enabled: boolean) → nil

4. UI SYSTEM:
- tm.playerUI.AddUIButton(playerId: number, id: string, text: string, callback: function, data: any) → nil
- tm.playerUI.AddUILabel(playerId: number, id: string, text: string) → nil
- tm.playerUI.SetUIValue(playerId: number, id: string, value: string) → nil

5. VECTOR3:
- tm.vector3.Create(x: number, y: number, z: number) → ModVector3
- tm.vector3.Create() → ModVector3 (zero vector)
- tm.vector3.Right/Left/Up/Down/Forward/Back() → ModVector3 (direction vectors)

6. OBJECT METHODS:
- gameObject.Exists() → boolean (always check before using)
- gameObject.GetTransform() → ModTransform
- gameObject.AddForce(x: number, y: number, z: number) → nil
- structure.GetBlocks() → ModBlock[]
- structure.GetSpeed() → number (m/s)
- block.SetPrimaryColor(r: number, g: number, b: number) → nil (0-1 range, build mode only)
- block.IsEngineBlock() → boolean

EXECUTION MODEL:
- Code runs top-to-bottom when mod loads
- update() function runs every frame if SetModTargetDeltaTime() is called
- No init() function exists in Trailmakers
- Variables should be declared with 'local'
- Player IDs: 0-7 (0 is always host)
- Colors: 0-1 range (not 0-255)
- Tables: 1-indexed in Lua

WHEN EXPLAINING CODE:
1. **Function Analysis**: For each API call, explain:
   - What the function does
   - Input parameter types and valid ranges
   - Return type and what it represents
   - When/why you'd use this function

2. **Type Safety**: Point out:
   - Proper type usage (numbers, strings, booleans, objects)
   - Parameter validation and ranges
   - Object existence checks with .Exists()
   - Table handling (1-indexed, iteration patterns)

3. **Execution Flow**: Explain:
   - When each part of code runs (load vs update)
   - Variable scope and lifetime
   - Event handling and callbacks
   - Performance considerations

4. **Best Practices**: Highlight:
   - Proper variable declaration with 'local'
   - Error checking patterns
   - Efficient update() function usage
   - Resource management (spawning/despawning)

5. **Common Issues**: Watch for:
   - Missing existence checks
   - Incorrect parameter types or ranges
   - Performance problems in update()
   - Memory leaks from spawning without cleanup

6. **Improvements**: Suggest:
   - Better error handling
   - Code optimization opportunities
   - Missing functionality that could be added
   - Alternative approaches using different API functions

Provide comprehensive explanations that teach both the specific code logic and general Trailmakers modding principles. Include technical details about why certain patterns are used and how they fit into the game's architecture.`
            },
            {
                role: "user",
                content: `Explain this Trailmakers mod code:\n\`\`\`lua\n${code}\n\`\`\``
            }
        ],
        temperature: 0.2
    });

    return result.choices[0].message.content;
}

export async function generateImageRoast(imageUrl) {
    const client = getNextClient();
    const chatResult = await client.chat({
        model: "pixtral-12b-2409",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: `STRICT VALIDATION REQUIRED:

1. First, carefully examine this image to identify if it contains ANY recognizable Trailmakers game elements.
2. Look specifically for: wheels, engines, thrusters, jets, servos, wings, propellers, seats, gyros, cannons, or other distinctive Trailmakers blocks/parts.
3. The image must show an actual vehicle or build FROM the Trailmakers game.

RESPONSE RULES:
- If you cannot clearly identify at least one recognizable Trailmakers block/part/component, respond with EXACTLY: "I cannot roast this."
- If it's clearly not from Trailmakers (photos, other games, random objects, animals, people, etc.), respond with EXACTLY: "I cannot roast this."
- ONLY if you can clearly see recognizable Trailmakers game elements should you provide a roast.

If it IS a valid Trailmakers build, create a sharp, witty roast (1-2 sentences, include one emoji). Keep it suitable for Discord but don't hold back on the snark.`
                    },
                    {
                        type: "image_url",
                        image_url: imageUrl
                    }
                ]
            }
        ],
        temperature: 0.1 // Very low temperature for consistent validation
    });

    return chatResult.choices[0].message.content.trim();
}

export async function generateRating(imageUrl) {
    const client = getNextClient();
    const chatResult = await client.chat({
        model: "pixtral-12b-2409",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: `
Carefully analyze the image of this potential Trailmakers build and provide an honest rating. Follow these instructions strictly:
1. If the image does not clearly show at least one Trailmakers block, part, or vehicle component, respond with exactly: 'I cannot rate this.'
2. Only rate builds that are clearly from Trailmakers - look for recognizable blocks like wheels, engines, servos, thrusters, etc.
3. Rate the build from 0 to 10, where 10 is the highest.
4. Only rate based on visible features. Do not assume parts or functionality that are not clearly visible in the image.
5. Ground vehicles require visible wheels, planes require visible wings, and other types of vehicles must have appropriate functional components visible. If these are missing, give the vehicle a score of 0 or 1.
6. Use the following template for your response (only if it's a Trailmakers build):
   - Rating: [X]/10
   - Feedback: [Provide one realistic, concise sentence about the build, aligned with the score.]
   
Image for analysis:
`
                    },
                    {
                        type: "image_url",
                        image_url: imageUrl
                    }
                ]
            }
        ],
        temperature: 0.2
    });

    return chatResult.choices[0].message.content;
}