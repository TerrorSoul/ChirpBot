// src/services/mistralService.js
import MistralClient from '@mistralai/mistralai';

let mistralClient = null;

export function initMistral() {
    mistralClient = new MistralClient(process.env.MISTRAL_API_KEY);
}

export async function generateJoke() {
    const chatResult = await mistralClient.chat({
        model: "open-mistral-7b",
        messages: [
            {
                role: "system",
                content: "You are a comedy writer creating one short, clever joke specifically for Trailmakers players. The joke should focus on real in-game mechanics such as building vehicles, using blocks (wheels, engines, buoyancy blocks, servos, cannons), or interacting with the game’s terrain (desert, ocean, mountains, floating islands). Use actual gameplay scenarios like vehicle malfunctions, failed builds, or funny outcomes. Keep the joke concise (one or two sentences) and sharp, without relying on forced puns or wordplay. Include two emojis for flair but avoid overdoing them. The humor can be slightly edgy, but it should always be family-friendly and connected directly to Trailmakers gameplay. The goal is to make the joke feel authentic to the game’s mechanics and relatable to players."
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
    const chatResult = await mistralClient.chat({
        model: "codestral-mamba-2407",
        messages: [
            {
                role: "system",
                content: process.env.SYSTEM_PROMPT + (includeExplanation ? "" : "\nProvide code only, no explanation.")
            },
            {
                role: "user",
                content: `Generate Trailmakers Lua code for: ${prompt}`
            }
        ]
    });

    return chatResult.choices[0].message.content;
}

export async function explainCode(code) {
    const result = await mistralClient.chat({
        model: "codestral-mamba-2407",
        messages: [
            {
                role: "system",
                content: "You are a Trailmakers mod expert. Explain the provided Lua code in detail, focusing on its functionality and usage of the Trailmakers API."
            },
            {
                role: "user",
                content: `Explain this Trailmakers mod code:\n\`\`\`lua\n${code}\n\`\`\``
            }
        ]
    });

    return result.choices[0].message.content;
}

export async function generateImageRoast(imageUrl) {
    const chatResult = await mistralClient.chat({
        model: "pixtral-12b-2409",
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Create a sharp and edgy roast for this Trailmakers vehicle. Don't hold back, but keep it suitable for a Discord community server. Focus on what you see in the build and make it witty, snarky, and funny, it can also be sarcastic. Include one emoji. Keep it short (1-2 sentences). Respond without quotation marks surrounding full response."
                    },
                    {
                        type: "image_url",
                        image_url: imageUrl
                    }
                ]
            }
        ],
        temperature: 0.8
    });

    return chatResult.choices[0].message.content;
}