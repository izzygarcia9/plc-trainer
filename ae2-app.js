/**
 * AE-2: Compare 5 Random Variables — Find Highest
 *
 * PLC Technique: Sequential GRT (Greater Than) comparisons with MOV
 *   1. MOV VAR_A → HIGHEST (assume A is highest)
 *   2. GRT VAR_B > HIGHEST → MOV VAR_B → HIGHEST
 *   3. GRT VAR_C > HIGHEST → MOV VAR_C → HIGHEST
 *   4. GRT VAR_D > HIGHEST → MOV VAR_D → HIGHEST
 *   5. GRT VAR_E > HIGHEST → MOV VAR_E → HIGHEST
 *
 * This is the standard PLC approach — no arrays, no loops,
 * just sequential compare-and-move instructions.
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');

// ─── Registers ───
plc.defineRegister('I:0/0',  'START_PB',  'BOOL', false, 'Start pushbutton (momentary)');
plc.defineRegister('N7:0',   'VAR_A',     'INT',  0,     'Variable A');
plc.defineRegister('N7:1',   'VAR_B',     'INT',  0,     'Variable B');
plc.defineRegister('N7:2',   'VAR_C',     'INT',  0,     'Variable C');
plc.defineRegister('N7:3',   'VAR_D',     'INT',  0,     'Variable D');
plc.defineRegister('N7:4',   'VAR_E',     'INT',  0,     'Variable E');
plc.defineRegister('N7:5',   'HIGHEST',   'INT',  0,     'Highest value found');
plc.defineRegister('B3:0/0', 'DONE',      'BOOL', false, 'Comparison complete');

// Track which var won (for UI highlighting)
let winnerTag = '';

// ─── Rung 0: START pressed → initialize HIGHEST = VAR_A ───
plc.addRung(new Rung(0,
    'START → MOV VAR_A to HIGHEST (assume A is highest initially)',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' }
    ],
    [
        { type: 'coil-out', tag: 'HIGHEST', label: 'MOV VAR_A → HIGHEST' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        if (start) {
            engine.set('HIGHEST', engine.get('VAR_A'));
            engine.set('DONE', false);
            winnerTag = 'VAR_A';
        }
        return {
            energized: start,
            conditionStates: [start],
            outputStates: [start],
            log: start ? [{ type: 'action', message: `MOV VAR_A (${engine.get('VAR_A')}) → HIGHEST` }] : []
        };
    }
));

// ─── Rung 1: GRT VAR_B > HIGHEST → MOV VAR_B → HIGHEST ───
plc.addRung(new Rung(1,
    'GRT: If VAR_B > HIGHEST → MOV VAR_B to HIGHEST',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' },
        { type: 'compare-gt', tag: 'VAR_B', label: 'VAR_B > HIGHEST', compareValue: 'HIGHEST' }
    ],
    [
        { type: 'coil-out', tag: 'HIGHEST', label: 'MOV VAR_B → HIGHEST' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        const gt = engine.get('VAR_B') > engine.get('HIGHEST');
        const fire = start && gt;
        if (fire) {
            engine.set('HIGHEST', engine.get('VAR_B'));
            winnerTag = 'VAR_B';
        }
        return {
            energized: fire,
            conditionStates: [start, gt],
            outputStates: [fire],
            log: fire ? [{ type: 'action', message: `VAR_B (${engine.get('VAR_B')}) > HIGHEST → MOV` }] : []
        };
    }
));

// ─── Rung 2: GRT VAR_C > HIGHEST → MOV VAR_C → HIGHEST ───
plc.addRung(new Rung(2,
    'GRT: If VAR_C > HIGHEST → MOV VAR_C to HIGHEST',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' },
        { type: 'compare-gt', tag: 'VAR_C', label: 'VAR_C > HIGHEST', compareValue: 'HIGHEST' }
    ],
    [
        { type: 'coil-out', tag: 'HIGHEST', label: 'MOV VAR_C → HIGHEST' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        const gt = engine.get('VAR_C') > engine.get('HIGHEST');
        const fire = start && gt;
        if (fire) {
            engine.set('HIGHEST', engine.get('VAR_C'));
            winnerTag = 'VAR_C';
        }
        return {
            energized: fire,
            conditionStates: [start, gt],
            outputStates: [fire],
            log: fire ? [{ type: 'action', message: `VAR_C (${engine.get('VAR_C')}) > HIGHEST → MOV` }] : []
        };
    }
));

// ─── Rung 3: GRT VAR_D > HIGHEST → MOV VAR_D → HIGHEST ───
plc.addRung(new Rung(3,
    'GRT: If VAR_D > HIGHEST → MOV VAR_D to HIGHEST',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' },
        { type: 'compare-gt', tag: 'VAR_D', label: 'VAR_D > HIGHEST', compareValue: 'HIGHEST' }
    ],
    [
        { type: 'coil-out', tag: 'HIGHEST', label: 'MOV VAR_D → HIGHEST' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        const gt = engine.get('VAR_D') > engine.get('HIGHEST');
        const fire = start && gt;
        if (fire) {
            engine.set('HIGHEST', engine.get('VAR_D'));
            winnerTag = 'VAR_D';
        }
        return {
            energized: fire,
            conditionStates: [start, gt],
            outputStates: [fire],
            log: fire ? [{ type: 'action', message: `VAR_D (${engine.get('VAR_D')}) > HIGHEST → MOV` }] : []
        };
    }
));

// ─── Rung 4: GRT VAR_E > HIGHEST → MOV VAR_E → HIGHEST ───
plc.addRung(new Rung(4,
    'GRT: If VAR_E > HIGHEST → MOV VAR_E to HIGHEST',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' },
        { type: 'compare-gt', tag: 'VAR_E', label: 'VAR_E > HIGHEST', compareValue: 'HIGHEST' }
    ],
    [
        { type: 'coil-out', tag: 'HIGHEST', label: 'MOV VAR_E → HIGHEST' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        const gt = engine.get('VAR_E') > engine.get('HIGHEST');
        const fire = start && gt;
        if (fire) {
            engine.set('HIGHEST', engine.get('VAR_E'));
            winnerTag = 'VAR_E';
        }
        return {
            energized: fire,
            conditionStates: [start, gt],
            outputStates: [fire],
            log: fire ? [{ type: 'action', message: `VAR_E (${engine.get('VAR_E')}) > HIGHEST → MOV` }] : []
        };
    }
));

// ─── Rung 5: Set DONE, clear START ───
plc.addRung(new Rung(5,
    'START → DONE = true, clear START (momentary)',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' }
    ],
    [
        { type: 'coil-out', tag: 'DONE', label: 'DONE' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        if (start) {
            engine.set('DONE', true);
            engine.set('START_PB', false);
        }
        return {
            energized: start,
            conditionStates: [start],
            outputStates: [start],
            log: start ? [{ type: 'state-change', message: `HIGHEST = ${engine.get('HIGHEST')} (from ${winnerTag})` }] : []
        };
    }
));

// ─── UI ───
function updateUI(engine) {
    const vars = ['VAR_A','VAR_B','VAR_C','VAR_D','VAR_E'];
    const highest = engine.get('HIGHEST');
    const ids = ['a','b','c','d','e'];

    // Variable cards
    vars.forEach((v, i) => {
        const val = engine.get(v);
        document.getElementById('val-' + ids[i]).textContent = val;
        const card = document.getElementById('var-' + ids[i]);
        card.className = 'var-card' + (v === winnerTag && engine.get('DONE') ? ' winner' : '');
    });

    // Result
    document.getElementById('highest-val').textContent = highest;
    document.getElementById('highest-src').textContent = engine.get('DONE') ? `from ${winnerTag}` : '\u2014';
    document.getElementById('scan-count').textContent = engine.scanCount;

    const resultBox = document.querySelector('.result-display');
    resultBox.className = 'result-display' + (engine.get('DONE') ? ' found' : '');

    // Bar chart
    const maxVal = Math.max(...vars.map(v => engine.get(v)), 1);
    const chart = document.getElementById('bar-chart');
    chart.innerHTML = '';
    vars.forEach((v, i) => {
        const val = engine.get(v);
        const pct = Math.round(val / maxVal * 100);
        const isWinner = v === winnerTag && engine.get('DONE');
        chart.innerHTML += `
            <div class="bar-row">
                <span class="bar-label">${v.replace('VAR_','')}</span>
                <div class="bar-track">
                    <div class="bar-fill${isWinner ? ' winner' : ''}" style="width:${pct}%"></div>
                </div>
                <span class="bar-val">${val}</span>
            </div>`;
    });

    ladder.update(engine.rungs);
    updateRegisterTable(engine);
    updateScanLog(engine);
}

function updateRegisterTable(engine) {
    const tbody = document.getElementById('register-body');
    const regs = engine.getAllRegisters();
    if (tbody.children.length === 0) {
        for (const reg of regs) {
            const tr = document.createElement('tr');
            tr.dataset.tag = reg.tag;
            tr.innerHTML = `<td>${reg.address}</td><td>${reg.tag}</td><td>${reg.type}</td><td class="value-cell"></td><td>${reg.description}</td>`;
            tbody.appendChild(tr);
        }
    }
    for (const reg of regs) {
        const tr = tbody.querySelector(`tr[data-tag="${reg.tag}"]`);
        if (!tr) continue;
        const td = tr.querySelector('.value-cell');
        const changed = reg.value !== reg.prevValue;
        tr.className = changed ? 'changed' : '';
        if (reg.type === 'BOOL') {
            td.textContent = reg.value ? 'TRUE' : 'FALSE';
            td.className = 'value-cell ' + (reg.value ? 'val-true' : 'val-false');
        } else {
            td.textContent = reg.value;
            td.className = 'value-cell val-number';
        }
    }
}

function updateScanLog(engine) {
    const logDiv = document.getElementById('scan-log');
    let html = '';
    for (const scanLog of engine.logEntries.slice(0, 25)) {
        for (const entry of scanLog.entries) {
            html += `<div class="log-entry ${entry.type}">[Scan ${scanLog.scan}] ${entry.message}</div>`;
        }
    }
    logDiv.innerHTML = html || '<div class="log-entry">Press START to randomize and compare.</div>';
}

// ─── Controls ───
function pressStart() {
    // Randomize 5 variables (1-999)
    plc.set('VAR_A', Math.floor(Math.random() * 999) + 1);
    plc.set('VAR_B', Math.floor(Math.random() * 999) + 1);
    plc.set('VAR_C', Math.floor(Math.random() * 999) + 1);
    plc.set('VAR_D', Math.floor(Math.random() * 999) + 1);
    plc.set('VAR_E', Math.floor(Math.random() * 999) + 1);
    plc.set('START_PB', true);
    plc.set('DONE', false);
    winnerTag = '';
    plc.scan();
}

function toggleEdit() {
    const panel = document.getElementById('edit-panel');
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
        document.getElementById('edit-a').value = plc.get('VAR_A');
        document.getElementById('edit-b').value = plc.get('VAR_B');
        document.getElementById('edit-c').value = plc.get('VAR_C');
        document.getElementById('edit-d').value = plc.get('VAR_D');
        document.getElementById('edit-e').value = plc.get('VAR_E');
    }
}

function applyManual() {
    plc.set('VAR_A', parseInt(document.getElementById('edit-a').value) || 0);
    plc.set('VAR_B', parseInt(document.getElementById('edit-b').value) || 0);
    plc.set('VAR_C', parseInt(document.getElementById('edit-c').value) || 0);
    plc.set('VAR_D', parseInt(document.getElementById('edit-d').value) || 0);
    plc.set('VAR_E', parseInt(document.getElementById('edit-e').value) || 0);
    plc.set('START_PB', true);
    plc.set('DONE', false);
    winnerTag = '';
    plc.scan();
}

function singleScan() { plc.scan(); }

// ─── Init ───
plc.onChange(updateUI);
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);
plc.scan();
