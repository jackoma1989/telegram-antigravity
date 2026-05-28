const fs = require('fs');

function analyze() {
    const raw = fs.readFileSync('scratch/approval_dom.json', 'utf8');
    const dom = JSON.parse(raw);
    
    function traverse(node, depth = 0) {
        if (!node) return;
        const text = (node.text || '').trim();
        const rect = node.rect || {};
        const isVis = rect.width > 0 && rect.height > 0;
        
        if (/^[1-9]/.test(text) && isVis) {
            console.log(`${'  '.repeat(depth)}<${node.tagName} id="${node.id || ''}" class="${node.className || ''}"> text: ${JSON.stringify(text)}`);
        }
        
        if (node.children) {
            node.children.forEach(c => traverse(c, depth + 1));
        }
    }
    
    traverse(dom);
}

analyze();
