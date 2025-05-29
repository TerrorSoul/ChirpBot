// services/wikiService.js
import fetch from 'node-fetch';
import { sanitizeInput } from '../utils/sanitization.js';

const WIKI_BASE_URL = 'https://trailmakers.wiki.gg';
const WIKI_API_URL = `${WIKI_BASE_URL}/api.php`;

export async function searchWiki(query, options = {}) {
    try {
        const cleanQuery = sanitizeInput(query).toLowerCase().trim();
        
        if (!cleanQuery || cleanQuery.length < 2) {
            return { error: 'Search query too short' };
        }

        // Check if this is a section search (contains #)
        const [pageQuery, sectionQuery] = cleanQuery.includes('#') ? 
            cleanQuery.split('#').map(s => s.trim()) : 
            [cleanQuery, null];

        // Search for pages
        const searchResults = await searchPages(pageQuery);
        
        if (!searchResults.length) {
            return { error: 'No results found on the wiki' };
        }

        // Get the best match
        const bestMatch = findBestMatch(searchResults, pageQuery);
        
        // Get both raw content and parsed content
        const [rawContent, parsedContent] = await Promise.all([
            getPageContent(bestMatch.title),
            getParsedContent(bestMatch.title)
        ]);
        
        if (!rawContent && !parsedContent) {
            return { error: 'Could not retrieve page content' };
        }

        // If searching for a specific section
        if (sectionQuery) {
            const sectionInfo = extractSection(rawContent, parsedContent, sectionQuery, bestMatch.title);
            if (sectionInfo) {
                return {
                    ...sectionInfo,
                    url: `${WIKI_BASE_URL}/wiki/${encodeURIComponent(bestMatch.title.replace(/ /g, '_'))}#${encodeURIComponent(sectionQuery.replace(/ /g, '_'))}`
                };
            }
        }

        // Try to extract clean information
        const pageInfo = await extractCleanInfo(bestMatch, rawContent, parsedContent, pageQuery);
        
        return {
            ...pageInfo,
            url: `${WIKI_BASE_URL}/wiki/${encodeURIComponent(bestMatch.title.replace(/ /g, '_'))}`
        };

    } catch (error) {
        console.error('Wiki search error:', error);
        return { error: 'Error searching the wiki' };
    }
}

async function searchPages(query) {
    try {
        const searchUrl = `${WIKI_API_URL}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=10&format=json`;
        
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'ChirpBot/1.0 Discord Bot' },
            timeout: 10000
        });
        
        if (!response.ok) {
            throw new Error(`API request failed: ${response.status}`);
        }
        
        const data = await response.json();
        return data.query?.search || [];
        
    } catch (error) {
        console.error('Error searching wiki pages:', error);
        return [];
    }
}

function findBestMatch(results, query) {
    const scored = results.map(result => {
        const title = result.title.toLowerCase();
        let score = 0;
        
        // Exact match gets highest score
        if (title === query) {
            score = 1000;
        }
        // Title starts with query
        else if (title.startsWith(query)) {
            score = 800;
        }
        // Title contains query as whole word
        else if (new RegExp(`\\b${query}\\b`).test(title)) {
            score = 700;
        }
        // Title contains query
        else if (title.includes(query)) {
            score = 600;
        }
        // Query words in title
        else {
            const queryWords = query.split(' ');
            const titleWords = title.split(' ');
            const matches = queryWords.filter(word => 
                titleWords.some(titleWord => titleWord.includes(word))
            );
            score = matches.length * 100;
        }
        
        // Boost score for relevant page types
        if (title.includes('block') || title.includes('part') || title.includes('weapon') || 
            title.includes('engine') || title.includes('wing') || title.includes('gear')) {
            score += 100;
        }
        
        // Penalize disambiguation and category pages
        if (title.includes('disambiguation') || title.includes('category:')) {
            score -= 200;
        }
        
        return { ...result, score };
    });
    
    return scored.sort((a, b) => b.score - a.score)[0];
}

async function getPageContent(title) {
    try {
        const contentUrl = `${WIKI_API_URL}?action=query&titles=${encodeURIComponent(title)}&prop=revisions&rvprop=content&format=json`;
        
        const response = await fetch(contentUrl, {
            headers: { 'User-Agent': 'ChirpBot/1.0 Discord Bot' },
            timeout: 10000
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        const pages = data.query?.pages;
        
        if (!pages) return null;
        
        const pageId = Object.keys(pages)[0];
        return pages[pageId]?.revisions?.[0]?.['*'];
        
    } catch (error) {
        console.error('Error getting raw page content:', error);
        return null;
    }
}

async function getParsedContent(title) {
    try {
        const parseUrl = `${WIKI_API_URL}?action=parse&page=${encodeURIComponent(title)}&format=json&prop=text`;
        
        const response = await fetch(parseUrl, {
            headers: { 'User-Agent': 'ChirpBot/1.0 Discord Bot' },
            timeout: 10000
        });
        
        if (!response.ok) return null;
        
        const data = await response.json();
        return data.parse?.text?.['*'];
        
    } catch (error) {
        console.error('Error getting parsed page content:', error);
        return null;
    }
}

function extractSection(rawContent, parsedContent, sectionName, pageTitle) {
    try {
        // Try to find the section in raw content first (more reliable)
        if (rawContent) {
            const sections = extractSectionsFromRaw(rawContent);
            const targetSection = findMatchingSection(sections, sectionName);
            
            if (targetSection) {
                return {
                    type: 'section',
                    title: `${pageTitle} - ${targetSection.title}`,
                    description: `Section: ${targetSection.title}`,
                    content: smartTruncate(targetSection.content, 900), // Reduced from 1000
                    sectionTitle: targetSection.title,
                    pageTitle: pageTitle
                };
            }
        }
        
        // Fallback to parsed content
        if (parsedContent) {
            const sections = extractSectionsFromHTML(parsedContent);
            const targetSection = findMatchingSection(sections, sectionName);
            
            if (targetSection) {
                return {
                    type: 'section',
                    title: `${pageTitle} - ${targetSection.title}`,
                    description: `Section: ${targetSection.title}`,
                    content: smartTruncate(cleanText(targetSection.content), 900), // Added cleanText and reduced limit
                    sectionTitle: targetSection.title,
                    pageTitle: pageTitle
                };
            }
        }
        
        return null;
        
    } catch (error) {
        console.error('Error extracting section:', error);
        return null;
    }
}

function extractSectionsFromRaw(content) {
    const sections = [];
    
    if (!content || typeof content !== 'string') {
        console.warn('Invalid content provided to extractSectionsFromRaw');
        return sections;
    }
    
    try {
        const lines = content.split('\n');
        let currentSection = null;
        let currentContent = [];
        
        for (const line of lines) {
            const trimmed = line.trim();
            
            // Check for section headers
            const headerMatch = trimmed.match(/^(={2,6})\s*([^=]+?)\s*\1$/);
            
            if (headerMatch) {
                // Save previous section
                if (currentSection && currentSection.title) {
                    // Clean and process the content before saving
                    const rawContent = currentContent.join('\n').trim();
                    const cleanedContent = cleanText(rawContent);
                    
                    sections.push({
                        title: currentSection.title,
                        content: cleanedContent,
                        level: currentSection.level
                    });
                }
                
                // Start new section
                const level = headerMatch[1].length;
                const title = headerMatch[2].trim();
                
                // Validate title
                if (title && typeof title === 'string' && title.length > 0) {
                    currentSection = { title, level };
                    currentContent = [];
                } else {
                    currentSection = null;
                    currentContent = [];
                }
            } else if (currentSection && trimmed) {
                // Skip templates, categories, and file references
                if (!trimmed.startsWith('{{') && 
                    !trimmed.startsWith('[[Category:') && 
                    !trimmed.startsWith('[[File:') &&
                    !trimmed.startsWith('[[Image:') &&
                    !trimmed.match(/^\d+px\|/)) { // Skip image size declarations
                    currentContent.push(trimmed);
                }
            }
        }
        
        // Add final section
        if (currentSection && currentSection.title) {
            const rawContent = currentContent.join('\n').trim();
            const cleanedContent = cleanText(rawContent);
            
            sections.push({
                title: currentSection.title,
                content: cleanedContent,
                level: currentSection.level
            });
        }
        
    } catch (error) {
        console.error('Error in extractSectionsFromRaw:', error);
    }
    
    return sections;
}

function extractSectionsFromHTML(content) {
    const sections = [];
    
    try {
        // Match section headers and their content
        const headerPattern = /<h([2-6])[^>]*>\s*<span[^>]*>([^<]+)<\/span>.*?<\/h\1>/gi;
        let lastIndex = 0;
        let match;
        
        const headers = [];
        while ((match = headerPattern.exec(content)) !== null) {
            headers.push({
                level: parseInt(match[1]),
                title: cleanText(match[2]),
                index: match.index,
                fullMatch: match[0]
            });
        }
        
        // Extract content between headers
        for (let i = 0; i < headers.length; i++) {
            const header = headers[i];
            const nextHeader = headers[i + 1];
            
            const startIndex = header.index + header.fullMatch.length;
            const endIndex = nextHeader ? nextHeader.index : content.length;
            
            const sectionContent = content.substring(startIndex, endIndex);
            const cleanedContent = cleanText(sectionContent);
            
            if (cleanedContent.length > 20 && header.title) {
                sections.push({
                    title: header.title,
                    content: cleanedContent,
                    level: header.level
                });
            }
        }
        
    } catch (error) {
        console.error('Error extracting sections from HTML:', error);
    }
    
    return sections;
}

function findMatchingSection(sections, sectionName) {
    if (!Array.isArray(sections) || !sectionName || typeof sectionName !== 'string') {
        return null;
    }
    
    const normalizedQuery = sectionName.toLowerCase().trim();
    
    try {
        // First try exact match
        let match = sections.find(section => 
            section && 
            section.title && 
            typeof section.title === 'string' && 
            section.title.toLowerCase() === normalizedQuery
        );
        
        if (match) return match;
        
        // Try partial match
        match = sections.find(section => 
            section && 
            section.title && 
            typeof section.title === 'string' && 
            (section.title.toLowerCase().includes(normalizedQuery) ||
             normalizedQuery.includes(section.title.toLowerCase()))
        );
        
        if (match) return match;
        
        // Try word matching
        const queryWords = normalizedQuery.split(' ');
        match = sections.find(section => {
            if (!section || !section.title || typeof section.title !== 'string') {
                return false;
            }
            
            const titleWords = section.title.toLowerCase().split(' ');
            return queryWords.some(qword => 
                titleWords.some(tword => tword.includes(qword) || qword.includes(tword))
            );
        });
        
        return match;
        
    } catch (error) {
        console.error('Error in findMatchingSection:', error);
        return null;
    }
}

async function extractCleanInfo(result, rawContent, parsedContent, query) {
    try {
        // First try to extract from infoboxes in parsed HTML
        const infoboxData = extractFromInfobox(parsedContent);
        
        if (infoboxData && Object.keys(infoboxData).length > 2) {
            return {
                type: 'item',
                title: infoboxData.name || result.title,
                description: cleanDescription(infoboxData.description || result.snippet),
                specs: infoboxData.specs,
                image: infoboxData.image,
                category: infoboxData.category
            };
        }
        
        // Try to extract from templates in raw content
        const templateData = extractFromTemplates(rawContent, query);
        
        if (templateData && Object.keys(templateData).length > 2) {
            return {
                type: 'item',
                title: templateData.title || result.title,
                description: cleanDescription(templateData.description),
                specs: templateData.specs,
                image: templateData.image,
                category: templateData.category
            };
        }
        
        // Fall back to general page extraction
        const generalInfo = extractGeneralInfo(parsedContent || rawContent, result);
        
        return {
            type: 'page',
            title: result.title,
            description: generalInfo.description,
            content: generalInfo.content,
            sections: generalInfo.sections
        };
        
    } catch (error) {
        console.error('Error extracting clean info:', error);
        return {
            type: 'page',
            title: result.title,
            description: cleanDescription(result.snippet) || 'No description available'
        };
    }
}

function extractFromInfobox(htmlContent) {
    if (!htmlContent) return null;
    
    try {
        // Look for infobox tables
        const infoboxMatch = htmlContent.match(/<table[^>]*class="[^"]*infobox[^"]*"[^>]*>(.*?)<\/table>/is);
        
        if (!infoboxMatch) return null;
        
        const infoboxHtml = infoboxMatch[1];
        const specs = {};
        let name = '';
        let description = '';
        let image = '';
        let category = '';
        
        // Extract title/name
        const titleMatch = infoboxHtml.match(/<th[^>]*colspan[^>]*>([^<]+)</i);
        if (titleMatch) {
            name = cleanText(titleMatch[1]);
        }
        
        // Extract image
        const imgMatch = infoboxHtml.match(/<img[^>]*src="([^"]+)"/i);
        if (imgMatch) {
            image = imgMatch[1];
        }
        
        // Extract rows
        const rowMatches = infoboxHtml.match(/<tr[^>]*>.*?<\/tr>/gis);
        
        if (rowMatches) {
            for (const row of rowMatches) {
                const cellMatch = row.match(/<t[hd][^>]*>([^<]+)<\/t[hd]>[^<]*<t[hd][^>]*>([^<]+)<\/t[hd]>/i);
                
                if (cellMatch) {
                    const label = cleanText(cellMatch[1]);
                    const value = cleanText(cellMatch[2]);
                    
                    if (label && value && !label.includes('colspan')) {
                        if (label.toLowerCase().includes('type') || label.toLowerCase().includes('category')) {
                            category = value;
                        } else {
                            specs[label] = value;
                        }
                    }
                }
            }
        }
        
        return {
            name,
            description,
            image,
            category,
            specs: Object.keys(specs).length > 0 ? specs : null
        };
        
    } catch (error) {
        console.error('Error extracting from infobox:', error);
        return null;
    }
}

function extractFromTemplates(rawContent, query) {
    if (!rawContent) return null;
    
    try {
        // Look for various template patterns
        const templatePatterns = [
            /\{\{(?:PI)?(?:powercore|block|item|part|weapon|engine)\s*\|(.*?)\}\}/gis,
            /\{\{infobox[^|]*\|(.*?)\}\}/gis
        ];
        
        let bestTemplate = null;
        let bestScore = 0;
        
        for (const pattern of templatePatterns) {
            const matches = rawContent.match(pattern);
            
            if (matches) {
                for (const match of matches) {
                    const parsed = parseTemplate(match);
                    
                    if (parsed.title) {
                        const score = scoreTemplate(parsed, query);
                        
                        if (score > bestScore) {
                            bestScore = score;
                            bestTemplate = parsed;
                        }
                    }
                }
            }
        }
        
        return bestTemplate;
        
    } catch (error) {
        console.error('Error extracting from templates:', error);
        return null;
    }
}

function parseTemplate(templateText) {
    const data = { specs: {} };
    
    try {
        // Split by | and parse each parameter
        const parts = templateText.split('|');
        
        for (const part of parts) {
            const paramMatch = part.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
            
            if (paramMatch) {
                const key = paramMatch[1].toLowerCase().trim();
                const value = cleanText(paramMatch[2]);
                
                if (!value || value === 'undefined') continue;
                
                // Map common field names
                switch (key) {
                    case 'title':
                    case 'name':
                        data.title = value;
                        break;
                    case 'caption':
                    case 'description':
                    case 'desc':
                        data.description = value;
                        break;
                    case 'image':
                    case 'img':
                        data.image = value;
                        break;
                    case 'category':
                    case 'type':
                        data.category = value;
                        break;
                    case 'weight':
                    case 'size':
                    case 'power':
                    case 'powercores':
                    case 'power_cores':
                    case 'hp':
                    case 'health':
                    case 'damage':
                    case 'dmg':
                    case 'speed':
                    case 'thrust':
                    case 'aero':
                    case 'aerodynamics':
                        data.specs[key.charAt(0).toUpperCase() + key.slice(1)] = value;
                        break;
                    default:
                        if (value && key.length < 20) {
                            data.specs[key.charAt(0).toUpperCase() + key.slice(1)] = value;
                        }
                }
            }
        }
        
        return data;
        
    } catch (error) {
        console.error('Error parsing template:', error);
        return { specs: {} };
    }
}

function scoreTemplate(template, query) {
    let score = 0;
    
    if (template.title) {
        const title = template.title.toLowerCase();
        
        if (title === query) score += 1000;
        else if (title.includes(query)) score += 500;
        else if (query.includes(title)) score += 300;
    }
    
    if (Object.keys(template.specs).length > 0) score += 200;
    if (template.description) score += 100;
    if (template.image) score += 50;
    
    return score;
}

function extractGeneralInfo(content, result) {
    try {
        let description = '';
        let mainContent = '';
        const sections = [];
        
        if (content && content.includes('<p>')) {
            // Parse HTML content
            const paragraphs = content.match(/<p[^>]*>(.*?)<\/p>/gis);
            
            if (paragraphs && paragraphs.length > 0) {
                description = smartTruncate(cleanText(paragraphs[0]), 400);
                
                if (paragraphs.length > 1) {
                    const contentParagraphs = [];
                    for (let i = 1; i < Math.min(paragraphs.length, 4); i++) {
                        const cleaned = cleanText(paragraphs[i]);
                        if (cleaned.length > 30 && !cleaned.toLowerCase().includes('see also') && 
                            !cleaned.toLowerCase().includes('external links')) {
                            contentParagraphs.push(cleaned);
                        }
                    }
                    
                    if (contentParagraphs.length > 0) {
                        mainContent = smartTruncate(contentParagraphs.join('\n\n'), 900);
                    }
                }
            }
            
            // Extract section headers for navigation
            const headerMatches = content.match(/<h[2-4][^>]*>\s*<span[^>]*>([^<]+)<\/span>/gi);
            
            if (headerMatches) {
                sections.push(...headerMatches
                    .map(h => cleanText(h))
                    .filter(h => h.length > 0 && h.length < 50)
                    .filter(h => !h.toLowerCase().includes('contents') && 
                                !h.toLowerCase().includes('references') &&
                                !h.toLowerCase().includes('external links'))
                    .slice(0, 10)
                );
            }
        } else if (content) {
            // Parse wiki markup
            const lines = content.split('\n');
            let introFound = false;
            const contentLines = [];
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                if (trimmed.startsWith('{{') || trimmed.startsWith('[[Category:') || 
                    trimmed.startsWith('#') || trimmed === '' || trimmed.startsWith('__')) {
                    continue;
                }
                
                if (trimmed.startsWith('==')) {
                    const header = trimmed.replace(/=/g, '').trim();
                    if (header.length > 0 && header.length < 50 && 
                        !header.toLowerCase().includes('contents') &&
                        !header.toLowerCase().includes('references') &&
                        !header.toLowerCase().includes('external links')) {
                        sections.push(header);
                    }
                    continue;
                }
                
                if (!introFound && trimmed.length > 50) {
                    description = smartTruncate(cleanText(trimmed), 400);
                    introFound = true;
                } else if (introFound && trimmed.length > 30 && contentLines.join('\n').length < 800) {
                    const cleaned = cleanText(trimmed);
                    if (!cleaned.toLowerCase().includes('see also') && 
                        !cleaned.toLowerCase().includes('external links')) {
                        contentLines.push(cleaned);
                    }
                }
            }
            
            if (contentLines.length > 0) {
                mainContent = smartTruncate(contentLines.join('\n\n'), 900);
            }
        }
        
        return {
            description: description || cleanDescription(result.snippet) || 'No description available',
            content: mainContent || null,
            sections: sections.length > 0 ? sections : null
        };
        
    } catch (error) {
        console.error('Error extracting general info:', error);
        return {
            description: cleanDescription(result.snippet) || 'No description available',
            content: null,
            sections: null
        };
    }
}

function cleanText(text) {
    if (!text) return '';
    
    // First, let's handle code blocks by identifying them before HTML cleaning
    const codeBlocks = [];
    let codeBlockIndex = 0;
    
    // Handle different types of code blocks
    text = text.replace(/<pre[^>]*>(.*?)<\/pre>/gis, (match, content) => {
        const placeholder = `__CODEBLOCK_${codeBlockIndex}__`;
        // Clean the code content but preserve structure
        const cleanCode = content
            .replace(/<[^>]+>/g, '') // Remove HTML tags
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        codeBlocks[codeBlockIndex] = cleanCode;
        codeBlockIndex++;
        return placeholder;
    });
    
    text = text.replace(/<code[^>]*>(.*?)<\/code>/gis, (match, content) => {
        const placeholder = `__CODEBLOCK_${codeBlockIndex}__`;
        const cleanCode = content
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        codeBlocks[codeBlockIndex] = cleanCode;
        codeBlockIndex++;
        return placeholder;
    });
    
    // Handle syntax highlighted code (common in wikis)
    text = text.replace(/<div[^>]*class="[^"]*highlight[^"]*"[^>]*>(.*?)<\/div>/gis, (match, content) => {
        const placeholder = `__CODEBLOCK_${codeBlockIndex}__`;
        const cleanCode = content
            .replace(/<[^>]+>/g, '')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .trim();
        codeBlocks[codeBlockIndex] = cleanCode;
        codeBlockIndex++;
        return placeholder;
    });
    
    // Now clean the rest of the text normally
    let cleaned = text
        .replace(/<[^>]+>/g, '') // Remove ALL HTML tags
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[link|text]] -> text
        .replace(/\[\[([^\]]+)\]\]/g, '$1') // [[link]] -> link
        .replace(/'''([^']+)'''/g, '**$1**') // '''bold''' -> **bold**
        .replace(/''([^']+)''/g, '*$1*') // ''italic'' -> *italic*
        .replace(/\{\{[^}]+\}\}/g, '') // Remove templates
        .replace(/\[\s*https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1') // [url text] -> text
        .replace(/https?:\/\/[^\s\]]+/g, '') // Remove remaining URLs
        .replace(/\d+px\|[^|]*\|[^|]*\|/g, '') // Remove image syntax
        .replace(/\d+px\|[^|]*\|/g, '') // Remove shorter image syntax
        .replace(/\|\s*thumb\s*\|/g, '') // Remove |thumb|
        .replace(/\|\s*right\s*\|/g, '') // Remove |right|
        .replace(/\|\s*left\s*\|/g, '') // Remove |left|
        .replace(/&nbsp;/g, ' ') // Non-breaking space
        .replace(/&amp;/g, '&') // Ampersand
        .replace(/&lt;/g, '<') // Less than
        .replace(/&gt;/g, '>') // Greater than
        .replace(/&quot;/g, '"') // Quote
        .replace(/&#39;/g, "'") // Apostrophe
        .replace(/&#91;/g, '[') // Left bracket
        .replace(/&#93;/g, ']') // Right bracket
        .replace(/&#40;/g, '(') // Left parenthesis
        .replace(/&#41;/g, ')') // Right parenthesis
        .replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
            try {
                const code = parseInt(hex, 16);
                return String.fromCharCode(code);
            } catch (e) {
                return '';
            }
        })
        .replace(/&#(\d+);/g, (match, num) => {
            try {
                return String.fromCharCode(parseInt(num, 10));
            } catch (e) {
                return '';
            }
        })
        .replace(/&[a-zA-Z]+;/g, '') // Remove any remaining HTML entities
        .replace(/^\s*\|\s*/gm, '') // Remove leading pipe characters
        .replace(/\s*\|\s*$/gm, ''); // Remove trailing pipe characters

    // Handle line formatting while preserving code blocks
    const lines = cleaned.split('\n');
    const processedLines = [];
    
    for (let line of lines) {
        line = line.trim();
        
        if (!line) continue; // Skip empty lines
        
        // Check if this line contains a code block placeholder
        if (line.includes('__CODEBLOCK_')) {
            processedLines.push(line);
            continue;
        }
        
        // Convert wiki list items to bullet points
        if (line.match(/^#\s+/)) {
            line = '• ' + line.replace(/^#\s+/, '');
        } else if (line.match(/^\*+\s+/)) {
            line = '• ' + line.replace(/^\*+\s+/, '');
        }
        
        processedLines.push(line);
    }
    
    // Join lines back together with proper spacing
    let result = processedLines.join('\n');
    
    // Restore code blocks with simple formatting for embeds
    for (let i = 0; i < codeBlocks.length; i++) {
        const placeholder = `__CODEBLOCK_${i}__`;
        const codeContent = codeBlocks[i];
        
        if (!codeContent) continue;
        
        // For embeds, we'll format code simply without fancy formatting
        // Split into lines and format nicely
        const codeLines = codeContent.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        
        if (codeLines.length === 0) {
            result = result.replace(placeholder, '');
            continue;
        }
        
        // For short single-line code, use inline backticks
        if (codeLines.length === 1 && codeLines[0].length < 60) {
            result = result.replace(placeholder, `\`${codeLines[0]}\``);
        } else {
            // For multi-line code, create a simple formatted block
            const formattedLines = codeLines.slice(0, 8) // Limit to 8 lines to avoid field length issues
                .map(line => `\`${line.substring(0, 80)}\``) // Limit line length too
                .join('\n');
            
            result = result.replace(placeholder, '\n' + formattedLines + '\n');
        }
    }
    
    // Add spacing around important elements
    result = result
        .replace(/(\w)\n•/g, '$1\n\n•') // Add space before bullet lists
        .replace(/\*\*Note\*\*/g, '\n**Note**') // Add space before notes
        .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
        .trim();
    
    return result;
}

function smartTruncate(text, maxLength) {
    if (!text || text.length <= maxLength) return text;
    
    // For Discord embed fields, be more conservative
    const safeMaxLength = Math.min(maxLength, 1020); // Leave some buffer for Discord
    
    // Try to truncate at sentence boundary
    const sentences = text.split(/[.!?]+/);
    let result = '';
    
    for (const sentence of sentences) {
        const potential = result + sentence + '.';
        if (potential.length > safeMaxLength - 20) {
            break;
        }
        result = potential;
    }
    
    // If we got a good sentence break, use it
    if (result.length > safeMaxLength * 0.7) {
        return result.trim();
    }
    
    // Otherwise truncate at word boundary
    const words = text.split(' ');
    result = '';
    
    for (const word of words) {
        const potential = result + (result ? ' ' : '') + word;
        if (potential.length > safeMaxLength - 10) {
            break;
        }
        result = potential;
    }
    
    return result.trim() + (result.length < text.length ? '...' : '');
}

function cleanDescription(text) {
    if (!text) return '';
    
    const cleaned = cleanText(text);
    
    // Remove common wiki prefixes that add noise
    const cleanedFurther = cleaned
        .replace(/^(File:|Image:|Category:)/i, '')
        .replace(/^(thumb\|)/i, '')
        .replace(/^\d+px\|/i, '');
    
    return smartTruncate(cleanedFurther, 400);
}

export async function getRandomWikiPage() {
    try {
        const randomUrl = `${WIKI_API_URL}?action=query&list=random&rnnamespace=0&rnlimit=1&format=json`;
        
        const response = await fetch(randomUrl, {
            headers: { 'User-Agent': 'ChirpBot/1.0 Discord Bot' },
            timeout: 5000
        });
        
        if (!response.ok) {
            throw new Error(`Random page request failed: ${response.status}`);
        }
        
        const data = await response.json();
        const randomPage = data.query?.random?.[0];
        
        if (!randomPage) {
            return { error: 'Could not get random page' };
        }
        
        return {
            title: randomPage.title,
            url: `${WIKI_BASE_URL}/wiki/${encodeURIComponent(randomPage.title.replace(/ /g, '_'))}`
        };
        
    } catch (error) {
        console.error('Error getting random wiki page:', error);
        return { error: 'Error getting random page' };
    }
}

export async function getWikiSuggestions(query) {
    try {
        if (!query || query.length < 2) return [];
        
        // If query contains #, suggest sections for the page
        if (query.includes('#')) {
            const [pageQuery, sectionQuery] = query.split('#').map(s => s.trim());
            if (pageQuery.length > 1) {
                return await getPageSections(pageQuery, sectionQuery);
            }
        }
        
        const searchUrl = `${WIKI_API_URL}?action=opensearch&search=${encodeURIComponent(query)}&limit=8&format=json`;
        
        const response = await fetch(searchUrl, {
            headers: { 'User-Agent': 'ChirpBot/1.0 Discord Bot' },
            timeout: 5000
        });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        return data[1] || []; // OpenSearch returns [query, [titles], [descriptions], [urls]]
        
    } catch (error) {
        console.error('Error getting wiki suggestions:', error);
        return [];
    }
}

async function getPageSections(pageTitle, sectionFilter = '') {
    try {
        if (!pageTitle || pageTitle.length < 2) return [];
        
        const searchResults = await searchPages(pageTitle);
        if (!searchResults.length) return [];
        
        const bestMatch = findBestMatch(searchResults, pageTitle);
        const rawContent = await getPageContent(bestMatch.title);
        
        if (!rawContent) return [];
        
        const sections = extractSectionsFromRaw(rawContent);
        
        // Add validation to ensure section has a title property
        const filteredSections = sections
            .filter(section => {
                // Validate section object and title property
                if (!section || typeof section !== 'object') {
                    console.warn('Invalid section object:', section);
                    return false;
                }
                
                if (!section.title || typeof section.title !== 'string') {
                    console.warn('Section missing or invalid title:', section);
                    return false;
                }
                
                if (!sectionFilter) return true;
                
                try {
                    return section.title.toLowerCase().includes(sectionFilter.toLowerCase());
                } catch (error) {
                    console.error('Error filtering section:', error, section);
                   return false;
               }
           })
           .slice(0, 8)
           .map(section => {
               try {
                   return `${pageTitle}#${section.title}`;
               } catch (error) {
                   console.error('Error mapping section:', error, section);
                   return null;
               }
           })
           .filter(item => item !== null); // Remove any null results
           
       return filteredSections;
       
   } catch (error) {
       console.error('Error getting page sections:', error);
       return [];
   }
}