/**
 * Editor UI — handles rung building, tag management, and rendering
 */

let selectedRungIdx = 0;
let scanInterval = null;

// ─── Challenge Definitions ───
const CHALLENGES = {
    free: { text:"Free build — create any ladder logic you want.", tags:[] },
    ae1: { text:"Create a one-shot push button. When pressed once, latch the bulb ON. When pressed again, turn it OFF.", tags:[['PB_INPUT','BOOL'],['BULB_OUT','BOOL']] },
    ae2: { text:"When start is pressed, compare 5 random numerical variables and store the highest in HIGHEST.", tags:[['START_PB','BOOL'],['VAR_A','INT'],['VAR_B','INT'],['VAR_C','INT'],['VAR_D','INT'],['VAR_E','INT'],['HIGHEST','INT']] },
    ae4: { text:"Monitor room temp. Below 75 turn on heater, above 75 turn on AC. Each scan adds/subtracts 1 degree.", tags:[['ROOM_TEMP','INT'],['HEATER','BOOL'],['AC','BOOL']] },
    ae5: { text:"Bottle fill conveyor. When bottle breaks sensor, stop conveyor and fill for 5 seconds, then continue.", tags:[['START','BOOL'],['PE_SENSOR','BOOL'],['CONV_MOTOR','BOOL'],['FILL_VALVE','BOOL']] },
    ae7: { text:"Motor runs forward until PE1, reverses until PE2, cycles indefinitely. Stop button halts immediately.", tags:[['START','BOOL'],['STOP','BOOL'],['PE1','BOOL'],['PE2','BOOL'],['MOTOR_FWD','BOOL'],['MOTOR_REV','BOOL']] },
    ae9: { text:"Traffic light: Green 30s, Yellow 10s, Red 20s, repeat continuously.", tags:[['GREEN','BOOL'],['YELLOW','BOOL'],['RED','BOOL']] },
    ae12: { text:"PE1 increments counter, PE2 decrements. Counter reaches 10 = jam. Reset button clears.", tags:[['PE1','BOOL'],['PE2','BOOL'],['RESET','BOOL'],['JAM','BOOL'],['COUNT','INT']] },
    ae16: { text:"Pallet sensor increments counter. At 3 pallets, conveyor stops. Clear button resets and resumes.", tags:[['PALLET_SENSOR','BOOL'],['CLEAR','BOOL'],['CONV_MOTOR','BOOL'],['COUNT','INT']] },
    ae18: { text:"Divisibility: div by 3 only=3, div by 5 only=5, both=15, neither=0.", tags:[['INPUT','INT'],['ANSWER','INT']] },
};

function loadChallenge(id) {
    const ch = CHALLENGES[id] || CHALLENGES.free;
    document.getElementById('challenge-text').innerHTML = '<strong>Challenge:</strong> ' + ch.text;
    // Reset engine
    EditorPLC.tags = {};
    EditorPLC.rungs = [];
    EditorPLC.scanCount = 0;
    EditorPLC.timerAccs = {};
    // Load starter tags
    for (const [name, type] of ch.tags) {
        EditorPLC.defineTag(name, type, type === 'BOOL' ? false : 0);
    }
    addRung();
    renderAll();
}

// ─── Initialize with default challenge ───
function initChallenge() {
    loadChallenge('ae1');
}

// ─── Tag Management ───
function addTagPrompt() {
    const name = prompt('Tag name (e.g. MY_TAG):');
    if (!name || !name.trim()) return;
    const clean = name.trim().toUpperCase().replace(/[^A-Z0-9_.]/g, '');
    if (EditorPLC.tags[clean]) { alert('Tag already exists'); return; }
    const type = prompt('Type: BOOL or INT', 'BOOL');
    const t = (type || 'BOOL').toUpperCase().trim();
    if (t !== 'BOOL' && t !== 'INT') { alert('Must be BOOL or INT'); return; }
    EditorPLC.defineTag(clean, t, t === 'BOOL' ? false : 0);
    renderAll();
}

function deleteTag(name) {
    if (!confirm(`Delete tag ${name}?`)) return;
    EditorPLC.deleteTag(name);
    // Remove from any instructions
    for (const rung of EditorPLC.rungs) {
        rung.conditions = rung.conditions.filter(i => i.tag !== name);
        rung.outputs = rung.outputs.filter(i => i.tag !== name);
    }
    renderAll();
}

function renderTagPanel() {
    const list = document.getElementById('tag-list');
    list.innerHTML = '';
    for (const [name, tag] of Object.entries(EditorPLC.tags)) {
        if (name.endsWith('_EN') || name.endsWith('_TT') || name.endsWith('_DN') || name.endsWith('_ACC') || name.endsWith('_prev') || name.startsWith('_CONST_')) continue;
        const div = document.createElement('div');
        div.className = 'tag-item';
        div.draggable = true;
        div.ondragstart = (e) => { e.dataTransfer.setData('text/plain', name); e.dataTransfer.effectAllowed = 'copy'; };
        const isBool = tag.type === 'BOOL';
        div.innerHTML = `
            <div class="tag-toggle ${tag.value ? 'on' : ''}" onclick="EditorPLC.toggleTag('${name}');renderAll()"></div>
            <span class="tag-name">${name}</span>
            <span class="tag-type">${tag.type}</span>
            <span class="tag-val ${isBool ? (tag.value ? 'true' : 'false') : 'num'}">${isBool ? (tag.value ? '1' : '0') : tag.value}</span>
            <span class="tag-del" onclick="deleteTag('${name}')">&times;</span>
        `;
        list.appendChild(div);
    }
}

// ─── I/O Panel ───
function renderIOPanel() {
    const list = document.getElementById('io-list');
    list.innerHTML = '';
    for (const [name, tag] of Object.entries(EditorPLC.tags)) {
        const div = document.createElement('div');
        div.className = 'io-item';
        const isBool = tag.type === 'BOOL';
        const changed = tag.value !== tag.prevValue;
        div.innerHTML = `
            <span class="io-name" style="${changed ? 'color:#00d4ff' : ''}">${name}</span>
            <span class="io-val ${isBool ? (tag.value ? 'true' : 'false') : 'num'}">${isBool ? (tag.value ? 'TRUE' : 'FALSE') : tag.value}</span>
        `;
        list.appendChild(div);
    }
}

// ─── Rung Management ───
function addRung() {
    EditorPLC.rungs.push({ conditions: [], outputs: [], energized: false });
    renderRungs();
}

function deleteRung(idx) {
    EditorPLC.rungs.splice(idx, 1);
    if (selectedRungIdx >= EditorPLC.rungs.length) selectedRungIdx = Math.max(0, EditorPLC.rungs.length - 1);
    renderRungs();
}

function addInst(type) {
    if (EditorPLC.rungs.length === 0) addRung();
    const rung = EditorPLC.rungs[selectedRungIdx];
    if (!rung) return;

    const isOutput = ['OTE', 'OTL', 'OTU', 'TON', 'CTU', 'CTD', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV'].includes(type);
    const isCondition = ['XIC', 'XIO', 'OSR', 'OSF', 'GRT', 'LES', 'EQU', 'GEQ', 'LEQ', 'NEQ'].includes(type);

    const inst = { type, tag: '', id: 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) };

    // For compare instructions, need a second tag
    if (['GRT', 'LES', 'EQU', 'GEQ', 'LEQ', 'NEQ'].includes(type)) inst.tag2 = '';
    // For math, need source and dest
    if (['ADD', 'SUB', 'MUL', 'DIV'].includes(type)) { inst.tag2 = ''; inst.tag3 = ''; }
    if (type === 'MOV') inst.tag2 = '';
    if (type === 'TON') inst.preset = 5;
    if (type === 'CTU' || type === 'CTD') inst.preset = 10;

    if (isOutput) {
        rung.outputs.push(inst);
    } else {
        rung.conditions.push(inst);
    }

    renderRungs();
    // Auto-open tag picker for the new instruction
    pickTag(inst.id, 'tag');
}

// ─── Drag & Drop from Tag Panel ───
function dropTagOnRung(e, rungIdx, side) {
    e.preventDefault();
    e.stopPropagation();
    const tagName = e.dataTransfer.getData('text/plain');
    if (!tagName || !EditorPLC.tags[tagName]) return;

    const rung = EditorPLC.rungs[rungIdx];
    const inst = { type: side === 'cond' ? 'XIC' : 'OTE', tag: tagName, id: 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) };

    if (side === 'cond') {
        rung.conditions.push(inst);
    } else {
        rung.outputs.push(inst);
    }
    renderRungs();
}

// Global drag-over handler to allow drops
document.addEventListener('dragover', (e) => {
    if (e.target.closest && (e.target.closest('.rung-conditions') || e.target.closest('.rung-outputs'))) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    }
});

document.addEventListener('drop', (e) => {
    const condTarget = e.target.closest ? e.target.closest('.rung-conditions') : null;
    const outTarget = e.target.closest ? e.target.closest('.rung-outputs') : null;
    if (!condTarget && !outTarget) return;
    e.preventDefault();
    const tagName = e.dataTransfer.getData('text/plain');
    if (!tagName || !EditorPLC.tags[tagName]) return;

    // Find which rung this belongs to
    const rungRow = (condTarget || outTarget).closest('.rung-row');
    if (!rungRow) return;
    const rungIdx = Array.from(document.querySelectorAll('.rung-row')).indexOf(rungRow);
    if (rungIdx < 0) return;

    const side = condTarget ? 'cond' : 'out';
    const rung = EditorPLC.rungs[rungIdx];
    const inst = { type: side === 'cond' ? 'XIC' : 'OTE', tag: tagName, id: 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) };

    if (side === 'cond') rung.conditions.push(inst);
    else rung.outputs.push(inst);
    renderRungs();
});

// ─── Tag Picker Modal ───
let pendingPickInstId = null;
let pendingPickField = null;

function pickTag(instId, field) {
    pendingPickInstId = instId;
    pendingPickField = field;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'tag-modal';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    const tags = Object.keys(EditorPLC.tags);
    // Build tag list with dot-notation sub-tags for timers/counters
    let allTags = [];
    for (const t of tags) {
        allTags.push(t);
        // If this tag has timer/counter sub-tags, add dot-notation versions
        if (EditorPLC.tags[t + '_EN']) {
            allTags.push(t + '.EN');
            if (EditorPLC.tags[t + '_TT']) allTags.push(t + '.TT');
            allTags.push(t + '.DN');
            allTags.push(t + '.ACC');
        }
    }
    // Remove internal underscore versions from display
    allTags = allTags.filter(t => !t.endsWith('_EN') && !t.endsWith('_TT') && !t.endsWith('_DN') && !t.endsWith('_ACC') && !t.endsWith('_prev') && !t.startsWith('_CONST_'));

    let listHtml = allTags.map(t => {
        const resolved = t.replace(/\./g, '_');
        const tagObj = EditorPLC.tags[resolved];
        const typeStr = tagObj ? tagObj.type : 'BOOL';
        return `<div class="tag-pick-item" onclick="applyTagPick('${t}')">${t} <span style="color:#555;font-size:.6rem">(${typeStr})</span></div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="modal">
            <h4>Select Tag for ${field}</h4>
            <div class="tag-pick-list">${listHtml || '<div style="color:#555;padding:8px">No tags defined. Add tags first.</div>'}</div>
            <div style="margin-top:8px">
                <label>Or type a value/tag name:</label>
                <input id="tag-pick-input" placeholder="Tag name or number" onkeydown="if(event.key==='Enter')applyTagPickManual()">
            </div>
            <div class="modal-btns">
                <button onclick="document.getElementById('tag-modal').remove()">Cancel</button>
                <button class="primary" onclick="applyTagPickManual()">OK</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById('tag-pick-input').focus();
}

function applyTagPick(tagName) {
    setInstField(pendingPickInstId, pendingPickField, tagName);
    const modal = document.getElementById('tag-modal');
    if (modal) modal.remove();
    renderRungs();
}

function applyTagPickManual() {
    const input = document.getElementById('tag-pick-input');
    const val = input.value.trim().toUpperCase();
    if (!val) return;
    // If it's a number, create a constant tag
    if (/^\d+$/.test(val)) {
        const constName = '_CONST_' + val;
        if (!EditorPLC.tags[constName]) EditorPLC.defineTag(constName, 'INT', parseInt(val));
        setInstField(pendingPickInstId, pendingPickField, constName);
    } else {
        // Support dot notation — resolve to underscore for storage but keep dot for display
        const resolved = val.replace(/\./g, '_');
        // Auto-create tag if it doesn't exist (only for base tags, not sub-tags)
        if (!EditorPLC.tags[resolved] && !val.includes('.')) {
            EditorPLC.defineTag(val, 'BOOL', false);
        }
        setInstField(pendingPickInstId, pendingPickField, val);
    }
    const modal = document.getElementById('tag-modal');
    if (modal) modal.remove();
    renderAll();
}

function setInstField(instId, field, value) {
    for (const rung of EditorPLC.rungs) {
        for (const inst of [...rung.conditions, ...rung.outputs]) {
            if (inst.id === instId) {
                inst[field] = value;
                return;
            }
        }
    }
}

// ─── Render Rungs ───
function renderRungs() {
    const container = document.getElementById('rungs-container');
    container.innerHTML = '';

    EditorPLC.rungs.forEach((rung, ri) => {
        const row = document.createElement('div');
        row.className = 'rung-row' + (rung.energized ? ' energized' : '');
        row.onclick = () => { selectedRungIdx = ri; renderRungs(); };
        if (ri === selectedRungIdx) row.style.outline = '1px solid #00d4ff';

        // Rung number
        row.innerHTML = `<div class="rung-num">R${ri}</div><div class="rung-rail${rung.energized ? ' energized' : ''}"></div>`;

        // Conditions
        const condDiv = document.createElement('div');
        condDiv.className = 'rung-conditions';
        condDiv.ondragover = (e) => { e.preventDefault(); condDiv.style.background = 'rgba(0,212,255,.05)'; };
        condDiv.ondragleave = () => { condDiv.style.background = ''; };
        condDiv.ondrop = (e) => { e.preventDefault(); condDiv.style.background = ''; dropTagOnRung(e, ri, 'cond'); };
        if (rung.conditions.length === 0) {
            condDiv.innerHTML = '<div class="drop-hint">Drag a tag here or click instruction above</div>';
        }
        rung.conditions.forEach((inst, ii) => {
            if (ii > 0) condDiv.appendChild(makeWire(rung.energized));
            condDiv.appendChild(makeInstBlock(inst, ri, 'cond', ii, rung.energized));
        });
        row.appendChild(condDiv);

        // Render branches (parallel paths)
        if (rung.branches && rung.branches.length > 0) {
            const branchContainer = document.createElement('div');
            branchContainer.className = 'branch-container';
            rung.branches.forEach((branch, bi) => {
                const branchDiv = document.createElement('div');
                branchDiv.className = 'branch-path';
                branch.conditions.forEach((inst, ii) => {
                    if (ii > 0) branchDiv.appendChild(makeWire(rung.energized));
                    branchDiv.appendChild(makeInstBlock(inst, ri, 'branch_' + bi, ii, rung.energized));
                });
                if (branch.conditions.length === 0) {
                    branchDiv.innerHTML = '<div class="drop-hint" style="font-size:.55rem">Click instruction to add to branch</div>';
                }
                // Add instruction to branch button
                const addBtn = document.createElement('button');
                addBtn.className = 'branch-add-btn';
                addBtn.textContent = '+';
                addBtn.title = 'Add instruction to this branch';
                addBtn.onclick = (e) => { e.stopPropagation(); addInstToBranch(ri, bi); };
                branchDiv.appendChild(addBtn);
                branchContainer.appendChild(branchDiv);
            });
            row.appendChild(branchContainer);
        }

        // Wire between conditions and outputs (stretches to fill gap)
        const midWire = makeWire(rung.energized);
        midWire.classList.add('spacer');
        row.appendChild(midWire);

        // Outputs
        const outDiv = document.createElement('div');
        outDiv.className = 'rung-outputs';
        outDiv.ondragover = (e) => { e.preventDefault(); outDiv.style.background = 'rgba(230,126,34,.05)'; };
        outDiv.ondragleave = () => { outDiv.style.background = ''; };
        outDiv.ondrop = (e) => { e.preventDefault(); outDiv.style.background = ''; dropTagOnRung(e, ri, 'out'); };
        if (rung.outputs.length === 0) {
            outDiv.innerHTML = '<div class="drop-hint">Drag tag here for output</div>';
        }
        rung.outputs.forEach((inst, ii) => {
            outDiv.appendChild(makeInstBlock(inst, ri, 'out', ii, rung.energized));
        });
        row.appendChild(outDiv);

        // Right rail
        const rr = document.createElement('div');
        rr.className = 'rung-rail' + (rung.energized ? ' energized' : '');
        row.appendChild(rr);

        // Actions
        const actDiv = document.createElement('div');
        actDiv.className = 'rung-actions';
        actDiv.innerHTML = `<button onclick="event.stopPropagation();deleteRung(${ri})">&times;</button>`;
        row.appendChild(actDiv);

        container.appendChild(row);
    });
}

function makeWire(energized) {
    const w = document.createElement('div');
    w.className = 'wire' + (energized ? ' energized' : '');
    return w;
}

function makeInstBlock(inst, rungIdx, side, instIdx, energized) {
    const div = document.createElement('div');
    const isEnergized = energized; // simplified — real per-instruction state would need more tracking
    div.className = `inst-block ${inst.type.toLowerCase()}${isEnergized ? ' energized' : ''}`;

    let symbol = inst.type;
    switch (inst.type) {
        case 'XIC': symbol = '─] [─'; break;
        case 'XIO': symbol = '─]/[─'; break;
        case 'OSR': symbol = '─[OSR]─'; break;
        case 'OSF': symbol = '─[OSF]─'; break;
        case 'OTE': symbol = '─( )─'; break;
        case 'OTL': symbol = '─(L)─'; break;
        case 'OTU': symbol = '─(U)─'; break;
    }

    let extraHtml = '';
    if (['GRT', 'LES', 'EQU', 'GEQ', 'LEQ', 'NEQ'].includes(inst.type)) {
        const ops = {GRT:'>',LES:'<',EQU:'=',GEQ:'>=',LEQ:'<=',NEQ:'≠'};
        const op = ops[inst.type] || '?';
        extraHtml = `<div class="inst-extra">${op} <span class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag2')">${inst.tag2 || '???'}</span></div>`;
    }
    if (['ADD', 'SUB', 'MUL', 'DIV'].includes(inst.type)) {
        extraHtml = `<div class="inst-extra">
            <span class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag2')">${inst.tag2 || 'src1'}</span>
            ${inst.type === 'ADD' ? '+' : inst.type === 'SUB' ? '-' : inst.type === 'MUL' ? '*' : '/'}
            <span class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag3')">${inst.tag3 || 'src2'}</span>
        </div>`;
    }
    if (inst.type === 'MOV') {
        extraHtml = `<div class="inst-extra">from <span class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag2')">${inst.tag2 || 'src'}</span></div>`;
    }
    if (inst.type === 'TON') {
        const en = EditorPLC.getTag(inst.tag + '_EN');
        const tt = EditorPLC.getTag(inst.tag + '_TT');
        const dn = EditorPLC.getTag(inst.tag + '_DN');
        const acc = EditorPLC.getTag(inst.tag + '_ACC') || 0;
        extraHtml = `<div class="inst-extra timer-detail">
            <div>EN: <span class="${en?'on':'off'}">${en?'ON':'OFF'}</span></div>
            <div>TT: <span class="${tt?'on':'off'}">${tt?'ON':'OFF'}</span></div>
            <div>DN: <span class="${dn?'on':'off'}">${dn?'ON':'OFF'}</span></div>
            <div>ACC: ${acc}</div>
            <div>PRE: <span class="inst-tag" onclick="event.stopPropagation();editTimerPreset('${inst.id}')">${inst.preset || 5}</span></div>
        </div>`;
    }
    if (inst.type === 'CTU' || inst.type === 'CTD') {
        const en = EditorPLC.getTag(inst.tag + '_EN');
        const dn = EditorPLC.getTag(inst.tag + '_DN');
        const acc = EditorPLC.getTag(inst.tag + '_ACC') || 0;
        extraHtml = `<div class="inst-extra timer-detail">
            <div>EN: <span class="${en?'on':'off'}">${en?'ON':'OFF'}</span></div>
            <div>DN: <span class="${dn?'on':'off'}">${dn?'ON':'OFF'}</span></div>
            <div>ACC: ${acc}</div>
            <div>PRE: <span class="inst-tag" onclick="event.stopPropagation();editTimerPreset('${inst.id}')">${inst.preset || 10}</span></div>
        </div>`;
    }

    div.innerHTML = `
        <div class="inst-type">${symbol}</div>
        <div class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag')">${inst.tag || '???'}</div>
        ${extraHtml}
        <div class="inst-del" onclick="event.stopPropagation();removeInst(${rungIdx},'${side}',${instIdx})">&times;</div>
    `;
    div.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showInstMenu(e, inst, rungIdx, side, instIdx); };
    return div;
}

// ─── Right-Click Context Menu ───
function showInstMenu(e, inst, rungIdx, side, instIdx) {
    closeInstMenu();
    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    menu.id = 'ctx-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    let items = '';

    // Contact type changes
    if (['XIC','XIO'].includes(inst.type)) {
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','XIC')">&#9472;] [&#9472; XIC (NO)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','XIO')">&#9472;]/[&#9472; XIO (NC)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','OSR')">&#8593; OSR (Rising)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','OSF')">&#8595; OSF (Falling)</div>`;
    }

    // Output type changes
    if (['OTE','OTL','OTU'].includes(inst.type)) {
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','OTE')">&#9472;( )&#9472; OTE (Coil)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','OTL')">&#9472;(L)&#9472; OTL (Latch)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','OTU')">&#9472;(U)&#9472; OTU (Unlatch)</div>`;
    }

    // Timer/Counter parameters
    if (inst.type === 'TON') {
        items += `<div class="ctx-item" onclick="editTimerPreset('${inst.id}')">&#9201; Set Timer Preset (current: ${inst.preset || 5})</div>`;
    }
    if (inst.type === 'CTU' || inst.type === 'CTD') {
        items += `<div class="ctx-item" onclick="editTimerPreset('${inst.id}')">&#128290; Set Counter Preset (current: ${inst.preset || 10})</div>`;
        items += `<div class="ctx-item" onclick="resetCounter('${inst.id}')">&#8634; Reset Counter ACC</div>`;
    }

    // Compare type changes
    if (['GRT','LES','EQU','GEQ','LEQ','NEQ'].includes(inst.type)) {
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','GRT')">GRT (&gt;)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','LES')">LES (&lt;)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','EQU')">EQU (=)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','GEQ')">GEQ (&gt;=)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','LEQ')">LEQ (&lt;=)</div>`;
        items += `<div class="ctx-item" onclick="changeInstType('${inst.id}','NEQ')">NEQ (&ne;)</div>`;
    }

    // Common actions
    items += `<div class="ctx-sep"></div>`;
    items += `<div class="ctx-item" onclick="pickTag('${inst.id}','tag')">Change Tag</div>`;
    items += `<div class="ctx-item ctx-danger" onclick="removeInst(${rungIdx},'${side}',${instIdx});closeInstMenu()">Delete</div>`;

    // Branch option (only for conditions)
    if (side === 'cond') {
        items += `<div class="ctx-sep"></div>`;
        items += `<div class="ctx-item" onclick="addBranch(${rungIdx})">Add Branch (parallel)</div>`;
    }

    menu.innerHTML = items;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeInstMenu, { once: true }), 10);
}

function closeInstMenu() {
    const m = document.getElementById('ctx-menu');
    if (m) m.remove();
}

function changeInstType(instId, newType) {
    for (const rung of EditorPLC.rungs) {
        for (const inst of [...rung.conditions, ...rung.outputs]) {
            if (inst.id === instId) {
                inst.type = newType;
                // Add tag2 for compare types if missing
                if (['GRT','LES','EQU','GEQ','LEQ','NEQ'].includes(newType) && !inst.tag2) inst.tag2 = '';
                break;
            }
        }
    }
    closeInstMenu();
    renderRungs();
}

function editTimerPreset(instId) {
    const val = prompt('Enter preset value:', '5');
    if (val === null) return;
    const num = parseInt(val);
    if (isNaN(num) || num < 1) { alert('Must be a positive number'); return; }
    for (const rung of EditorPLC.rungs) {
        for (const inst of [...rung.conditions, ...rung.outputs]) {
            if (inst.id === instId) { inst.preset = num; break; }
        }
    }
    closeInstMenu();
    renderRungs();
}

function resetCounter(instId) {
    for (const rung of EditorPLC.rungs) {
        for (const inst of [...rung.conditions, ...rung.outputs]) {
            if (inst.id === instId) {
                const key = inst.id || inst.tag;
                if (EditorPLC.timerAccs[key]) EditorPLC.timerAccs[key].acc = 0;
                EditorPLC.setTag(inst.tag + '_ACC', 0);
                EditorPLC.setTag(inst.tag + '_DN', false);
                break;
            }
        }
    }
    closeInstMenu();
    renderAll();
}

// ─── Branch Support ───
function addBranch(rungIdx) {
    const rung = EditorPLC.rungs[rungIdx];
    if (!rung.branches) rung.branches = [];
    rung.branches.push({ conditions: [] });
    closeInstMenu();
    renderRungs();
}

function addInstToBranch(rungIdx, branchIdx) {
    const rung = EditorPLC.rungs[rungIdx];
    const branch = rung.branches[branchIdx];
    const inst = { type: 'XIC', tag: '', id: 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) };
    branch.conditions.push(inst);
    renderRungs();
    pickTag(inst.id, 'tag');
}

function removeInst(rungIdx, side, instIdx) {
    const rung = EditorPLC.rungs[rungIdx];
    if (side === 'cond') rung.conditions.splice(instIdx, 1);
    else if (side.startsWith('branch_')) {
        const bi = parseInt(side.split('_')[1]);
        rung.branches[bi].conditions.splice(instIdx, 1);
        if (rung.branches[bi].conditions.length === 0) rung.branches.splice(bi, 1);
    }
    else rung.outputs.splice(instIdx, 1);
    renderRungs();
}

// ─── Scan Controls ───
function toggleRun() {
    EditorPLC.running = !EditorPLC.running;
    const btn = document.getElementById('run-btn');
    if (EditorPLC.running) {
        btn.textContent = '\u23F8 STOP';
        btn.classList.add('running');
        scanInterval = setInterval(() => EditorPLC.scan(), EditorPLC.scanSpeed);
    } else {
        btn.textContent = '\u25B6 RUN';
        btn.classList.remove('running');
        clearInterval(scanInterval);
    }
}

function singleScan() {
    EditorPLC.scan();
}

function setScanSpeed(val) {
    EditorPLC.scanSpeed = parseInt(val);
    document.getElementById('scan-ms').textContent = val;
    if (EditorPLC.running) {
        clearInterval(scanInterval);
        scanInterval = setInterval(() => EditorPLC.scan(), EditorPLC.scanSpeed);
    }
}

// ─── Master Render ───
function renderAll() {
    renderTagPanel();
    renderRungs();
    renderIOPanel();
    document.getElementById('scan-num').textContent = EditorPLC.scanCount;
}

EditorPLC.onChange(() => {
    renderTagPanel();
    renderRungs();
    renderIOPanel();
    document.getElementById('scan-num').textContent = EditorPLC.scanCount;
});

// ─── Init ───
initChallenge();
