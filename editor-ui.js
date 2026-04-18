/**
 * Editor UI — handles rung building, tag management, and rendering
 */

let selectedRungIdx = 0;
let scanInterval = null;

// ─── Initialize with default tags for the one-shot challenge ───
function initChallenge() {
    EditorPLC.defineTag('PB_INPUT', 'BOOL', false);
    EditorPLC.defineTag('BULB_OUT', 'BOOL', false);
    // Add one empty rung to start
    addRung();
    renderAll();
}

// ─── Tag Management ───
function addTagPrompt() {
    const name = prompt('Tag name (e.g. MY_TAG):');
    if (!name || !name.trim()) return;
    const clean = name.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
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
        if (name.endsWith('_EN') || name.endsWith('_TT') || name.endsWith('_DN') || name.endsWith('_ACC')) continue;
        const div = document.createElement('div');
        div.className = 'tag-item';
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

    const isOutput = ['OTE', 'OTL', 'OTU', 'TON', 'MOV', 'ADD', 'SUB', 'MUL', 'DIV'].includes(type);
    const isCondition = ['XIC', 'XIO', 'GRT', 'LES', 'EQU'].includes(type);

    const inst = { type, tag: '', id: 'inst_' + Date.now() + '_' + Math.random().toString(36).substr(2,4) };

    // For compare instructions, need a second tag
    if (['GRT', 'LES', 'EQU'].includes(type)) inst.tag2 = '';
    // For math, need source and dest
    if (['ADD', 'SUB', 'MUL', 'DIV'].includes(type)) { inst.tag2 = ''; inst.tag3 = ''; }
    if (type === 'MOV') inst.tag2 = '';
    if (type === 'TON') inst.preset = 5;

    if (isOutput) {
        rung.outputs.push(inst);
    } else {
        rung.conditions.push(inst);
    }

    renderRungs();
    // Auto-open tag picker for the new instruction
    pickTag(inst.id, 'tag');
}

function removeInst(rungIdx, side, instIdx) {
    const rung = EditorPLC.rungs[rungIdx];
    if (side === 'cond') rung.conditions.splice(instIdx, 1);
    else rung.outputs.splice(instIdx, 1);
    renderRungs();
}

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
    let listHtml = tags.map(t =>
        `<div class="tag-pick-item" onclick="applyTagPick('${t}')">${t} <span style="color:#555;font-size:.6rem">(${EditorPLC.tags[t].type})</span></div>`
    ).join('');

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
        // Auto-create tag if it doesn't exist
        if (!EditorPLC.tags[val]) {
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
        if (rung.conditions.length === 0) {
            condDiv.innerHTML = '<div class="drop-hint">Click an instruction above to add</div>';
        }
        rung.conditions.forEach((inst, ii) => {
            if (ii > 0) condDiv.appendChild(makeWire(rung.energized));
            condDiv.appendChild(makeInstBlock(inst, ri, 'cond', ii, rung.energized));
        });
        row.appendChild(condDiv);

        // Wire between conditions and outputs
        row.appendChild(makeWire(rung.energized));

        // Outputs
        const outDiv = document.createElement('div');
        outDiv.className = 'rung-outputs';
        if (rung.outputs.length === 0) {
            outDiv.innerHTML = '<div class="drop-hint">Add output</div>';
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
        case 'OTE': symbol = '─( )─'; break;
        case 'OTL': symbol = '─(L)─'; break;
        case 'OTU': symbol = '─(U)─'; break;
    }

    let extraHtml = '';
    if (['GRT', 'LES', 'EQU'].includes(inst.type)) {
        const op = inst.type === 'GRT' ? '>' : inst.type === 'LES' ? '<' : '=';
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
        const acc = EditorPLC.getTag(inst.tag + '_ACC') || 0;
        extraHtml = `<div class="inst-extra">PRE=${inst.preset} ACC=${acc}</div>`;
    }

    div.innerHTML = `
        <div class="inst-type">${symbol}</div>
        <div class="inst-tag" onclick="event.stopPropagation();pickTag('${inst.id}','tag')">${inst.tag || '???'}</div>
        ${extraHtml}
        <div class="inst-del" onclick="event.stopPropagation();removeInst(${rungIdx},'${side}',${instIdx})">&times;</div>
    `;
    return div;
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
