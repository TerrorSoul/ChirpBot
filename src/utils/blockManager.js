// utils/blockManager.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const blocksPath = path.join(__dirname, '..', 'commands', 'packs', 'trailmakers', 'data', 'blocks.json');

let blocksData = null;

function loadBlocksData() {
    if (!blocksData) {
        try {
            const data = fs.readFileSync(blocksPath, 'utf8');
            blocksData = JSON.parse(data);
        } catch (error) {
            console.error('Error loading blocks.json:', error);
            return null;
        }
    }
    return blocksData;
}

export function getBlockInfo(blockName) {
    const data = loadBlocksData();
    if (!data?.blocks) return null;

    for (const section of data.blocks) {
        for (const category of section.categories) {
            const block = category.blocks?.find(b => 
                b.title.toLowerCase() === blockName.toLowerCase()
            );
            if (block) {
                return {
                    ...block,
                    section: section.section
                };
            }
        }
    }
    return null;
}

export function searchBlockTitles(search) {
    const data = loadBlocksData();
    if (!data?.blocks) return [];

    const matches = [];
    for (const section of data.blocks) {
        for (const category of section.categories) {
            const blockMatches = category.blocks?.filter(block =>
                block.title.toLowerCase().includes(search.toLowerCase())
            ) || [];
            matches.push(...blockMatches);
        }
    }

    return matches.slice(0, 25).map(block => ({
        title: block.title
    }));
}

export function getBlockSections() {
    const data = loadBlocksData();
    if (!data?.blocks) return [];
    
    return data.blocks.map(section => ({
        section: section.section
    }));
}

export function getAllBlocks() {
    const data = loadBlocksData();
    if (!data?.blocks) return [];

    const allBlocks = [];
    for (const section of data.blocks) {
        for (const category of section.categories) {
            allBlocks.push(...(category.blocks || []));
        }
    }
    return allBlocks;
}

// Clear cache to force reload of blocks.json
export function clearCache() {
    blocksData = null;
}