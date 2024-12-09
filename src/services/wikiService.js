import fetch from 'node-fetch';

export async function searchWiki(query) {
    try {
        const cleanQuery = query.toLowerCase().trim();
        
        const searchUrl = `https://trailmakers.wiki.gg/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
        const searchResponse = await fetch(searchUrl);
        const searchData = await searchResponse.json();
        
        if (!searchData.query?.search?.length) {
            return { error: 'No results found' };
        }
    
        const title = searchData.query.search[0].title;
        const contentUrl = `https://trailmakers.wiki.gg/api.php?action=query&titles=${encodeURIComponent(title)}&prop=revisions&rvprop=content&format=json`;
        const contentResponse = await fetch(contentUrl);
        const contentData = await contentResponse.json();
        
        const pages = contentData.query.pages;
        const pageId = Object.keys(pages)[0];
        const content = pages[pageId]?.revisions?.[0]?.['*'];
    
        const templates = content?.match(/\{\{PIpowercore[\s\S]*?\}\}/g) || [];
        
        const matchingTemplate = templates.find(template => {
            const titleMatch = template.match(/\|title= (.*?)(?:\||$)/m);
            return titleMatch && titleMatch[1].toLowerCase().trim() === cleanQuery;
        });
    
        if (!matchingTemplate) {
            return {
                title: title,
                content: `No specific item information found. Visit the wiki page for more details.`,
                url: `https://trailmakers.wiki.gg/wiki/${encodeURIComponent(title.replace(' ', '_'))}`
            };
        }
    
        const itemInfo = {
            title: (matchingTemplate.match(/\|title= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            image: (matchingTemplate.match(/\|image= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            caption: (matchingTemplate.match(/\|caption= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            powercores: (matchingTemplate.match(/\|powercores= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            weight: (matchingTemplate.match(/\|weight= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            size: (matchingTemplate.match(/\|size= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            power: (matchingTemplate.match(/\|power= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            hp: (matchingTemplate.match(/\|hp= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            dmg: (matchingTemplate.match(/\|dmg= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            aero: (matchingTemplate.match(/\|aero= (.*?)(?:\||$)/m)?.[1] || '').trim(),
            other: (matchingTemplate.match(/\|other= (.*?)(?:\||$)/m)?.[1] || '').trim()
        };
    
        let imageUrl = null;
        if (itemInfo.image) {
            const imageInfoUrl = `https://trailmakers.wiki.gg/api.php?action=query&titles=File:${encodeURIComponent(itemInfo.image)}&prop=imageinfo&iiprop=url&format=json`;
            const imageResponse = await fetch(imageInfoUrl);
            const imageData = await imageResponse.json();
            const imagePages = imageData.query.pages;
            const imagePageId = Object.keys(imagePages)[0];
            imageUrl = imagePages[imagePageId]?.imageinfo?.[0]?.url;
        }
    
        return {
            title: itemInfo.title,
            content: formatItemInfo(itemInfo),
            imageUrl: imageUrl,
            url: `https://trailmakers.wiki.gg/wiki/${encodeURIComponent(title.replace(' ', '_'))}`
        };
    } catch (error) {
        console.error('Wiki search error:', error);
        return { error: 'Error searching the wiki' };
    }
}

function formatItemInfo(info) {
    let formatted = `# ${info.title}\n\n`;
    
    if (info.caption && info.caption !== 'undefined') {
        formatted += `*${info.caption}*\n\n`;
    }

    formatted += '## Specifications\n';
    
    const specs = [
        { label: 'Power Cores', value: info.powercores },
        { label: 'Weight', value: info.weight },
        { label: 'Size', value: info.size },
        { label: 'Power', value: info.power },
        { label: 'HP', value: info.hp },
        { label: 'Damage', value: info.dmg },
        { label: 'Aerodynamics', value: info.aero }
    ];

    specs.forEach(spec => {
        if (spec.value && spec.value !== 'undefined' && spec.value.trim() !== '') {
            formatted += `• ${spec.label}: ${spec.value}\n`;
        }
    });

    if (info.other && info.other !== 'undefined' && info.other.trim() !== '') {
        formatted += `\n## Additional Information\n${info.other}\n`;
    }

    return formatted;
}