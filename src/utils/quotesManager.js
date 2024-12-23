// utils/quotesManager.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const quotesPath = path.join(__dirname, '..', 'commands', 'packs', 'trailmakers', 'data', 'quotes.json');

let quotesData = null;

function loadQuotes() {
    if (!quotesData) {
        try {
            if (!fs.existsSync(quotesPath)) {
                fs.writeFileSync(quotesPath, JSON.stringify([], null, 2));
                return { quotes: [] };
            }
            const data = fs.readFileSync(quotesPath, 'utf8');
            const rawQuotes = JSON.parse(data);
            
            // IDs
            quotesData = {
                quotes: rawQuotes.map((quote, index) => ({
                    id: index + 1,
                    text: quote.text || '',
                    author: quote.author || 'Unknown',
                    date: quote.date || 'Unknown',
                }))
            };
        } catch (error) {
            console.error('Error loading quotes.json:', error);
            return { quotes: [] };
        }
    }
    return quotesData;
}

export function getQuoteById(id) {
    const data = loadQuotes();
    return data.quotes.find(quote => quote.id === id) || null;
}

export function getRandomQuote(excludeIds = []) {
    const data = loadQuotes();
    const availableQuotes = data.quotes.filter(quote => !excludeIds.includes(quote.id));
    
    if (availableQuotes.length === 0) {
        return null;
    }
    
    const randomIndex = Math.floor(Math.random() * availableQuotes.length);
    return availableQuotes[randomIndex];
}

// Clear cache to force reload of quotes.json
export function clearCache() {
    quotesData = null;
}