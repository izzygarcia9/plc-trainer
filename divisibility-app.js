/**
 * Divisibility Check Logic (FizzBuzz) - PLC Trainer
 *
 * PLC Modulo technique (no native MOD instruction):
 *   quotient  = input DIV divisor   (integer division)
 *   temp      = quotient MUL divisor
 *   remainder = input SUB temp
 *
 * Precedence order matters:
 *   1. Check div by 15 first (both 3 AND 5) → answer = 15
 *   2. Check div by 3 only → answer = 3
 *   3. Check div by 5 only → answer = 5
 *   4. Otherwise → answer = 0
 *
 * Tags match the screenshot:
 *   input, answer, quotient3, temp3, remainder3,
 *   quotient5, temp5, remainder5,
 *   constant3, constant5, constant15, constant0
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 500;

// ─── Define Registers (matching screenshot tag names) ───
plc.defineRegister('N7:0',  'input',       'INT', 4,  'Input value to check');
plc.defineRegister('N7:1',  'answer',      'INT', 0,  'Result: 3, 5, 15, or 0');

// Div-by-3 working registers
plc.defineRegister('N7:2',  'quotient3',   'INT', 0,  'input DIV 3 (integer)');
plc.defineRegister('N7:3',  'temp3',       'INT', 0,  'quotient3 * 3');
plc.defineRegister('N7:4',  'remainder3',  'INT', 0,  'input - temp3 (mod 3)');

// Div-by-5 working registers
plc.defineRegister('N7:5',  'quotient5',   'INT', 0,  'input DIV 5 (integer)');
plc.defineRegister('N7:6',  'temp5',       'INT', 0,  'quotient5 * 5');
plc.defineRegister('N7:7',  'remainder5',  'INT', 0,  'input - temp5 (mod 5)');

// Boolean flags
plc.defineRegister('B3:0/0','DIV_BY_3',    'BOOL', false, 'remainder3 == 0');
plc.defineRegister('B3:0/1','DIV_BY_5',    'BOOL', false, 'remainder5 == 0');

// Constants
plc.defineRegister('K:0',   'constant3',   'INT', 3,  'Constant: 3');
plc.defineRegister('K:1',   'constant5',   'INT', 5,  'Constant: 5');
plc.defineRegister('K:2',   'constant15',  'INT', 15, 'Constant: 15');
plc.defineRegister('K:3',   'constant0',   'INT', 0,  'Constant: 0');

// ─── Rung 0: DIV input by 3 → quotient3 ───
plc.addRung(new Rung(0,
    'Divide: quotient3 = input / 3 (integer division)',
    [
        { type: 'math-add', tag: 'input', label: 'input' }
    ],
    [
        { type: 'math-add', tag: 'quotient3', label: 'DIV input / constant3' }
    ],
    (engine) => {
        const inp = engine.get('input');
        const d = engine.get('constant3');
        const q = d !== 0 ? Math.floor(inp / d) : 0;
        engine.set('quotient3', q);
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 1: MUL quotient3 * 3 → temp3 ───
plc.addRung(new Rung(1,
    'Multiply: temp3 = quotient3 * 3',
    [
        { type: 'math-add', tag: 'quotient3', label: 'quotient3' }
    ],
    [
        { type: 'math-add', tag: 'temp3', label: 'MUL quotient3 * constant3' }
    ],
    (engine) => {
        engine.set('temp3', engine.get('quotient3') * engine.get('constant3'));
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 2: SUB input - temp3 → remainder3 ───
plc.addRung(new Rung(2,
    'Subtract: remainder3 = input - temp3',
    [
        { type: 'math-add', tag: 'input', label: 'input' }
    ],
    [
        { type: 'math-sub', tag: 'remainder3', label: 'SUB input - temp3' }
    ],
    (engine) => {
        engine.set('remainder3', engine.get('input') - engine.get('temp3'));
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 3: DIV input by 5 → quotient5 ───
plc.addRung(new Rung(3,
    'Divide: quotient5 = input / 5 (integer division)',
    [
        { type: 'math-add', tag: 'input', label: 'input' }
    ],
    [
        { type: 'math-add', tag: 'quotient5', label: 'DIV input / constant5' }
    ],
    (engine) => {
        const inp = engine.get('input');
        const d = engine.get('constant5');
        const q = d !== 0 ? Math.floor(inp / d) : 0;
        engine.set('quotient5', q);
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 4: MUL quotient5 * 5 → temp5 ───
plc.addRung(new Rung(4,
    'Multiply: temp5 = quotient5 * 5',
    [
        { type: 'math-add', tag: 'quotient5', label: 'quotient5' }
    ],
    [
        { type: 'math-add', tag: 'temp5', label: 'MUL quotient5 * constant5' }
    ],
    (engine) => {
        engine.set('temp5', engine.get('quotient5') * engine.get('constant5'));
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 5: SUB input - temp5 → remainder5 ───
plc.addRung(new Rung(5,
    'Subtract: remainder5 = input - temp5',
    [
        { type: 'math-add', tag: 'input', label: 'input' }
    ],
    [
        { type: 'math-sub', tag: 'remainder5', label: 'SUB input - temp5' }
    ],
    (engine) => {
        engine.set('remainder5', engine.get('input') - engine.get('temp5'));
        return {
            energized: true,
            conditionStates: [true],
            outputStates: [true],
            log: []
        };
    }
));

// ─── Rung 6: Compare remainder3 == 0 → DIV_BY_3 flag ───
plc.addRung(new Rung(6,
    'Compare: remainder3 == 0 → DIV_BY_3 = true',
    [
        { type: 'compare-eq', tag: 'remainder3', label: 'remainder3', compareValue: '0' }
    ],
    [
        { type: 'coil-out', tag: 'DIV_BY_3', label: 'DIV_BY_3' }
    ],
    (engine) => {
        const eq = engine.get('remainder3') === 0;
        engine.set('DIV_BY_3', eq);
        return {
            energized: eq,
            conditionStates: [eq],
            outputStates: [eq],
            log: []
        };
    }
));

// ─── Rung 7: Compare remainder5 == 0 → DIV_BY_5 flag ───
plc.addRung(new Rung(7,
    'Compare: remainder5 == 0 → DIV_BY_5 = true',
    [
        { type: 'compare-eq', tag: 'remainder5', label: 'remainder5', compareValue: '0' }
    ],
    [
        { type: 'coil-out', tag: 'DIV_BY_5', label: 'DIV_BY_5' }
    ],
    (engine) => {
        const eq = engine.get('remainder5') === 0;
        engine.set('DIV_BY_5', eq);
        return {
            energized: eq,
            conditionStates: [eq],
            outputStates: [eq],
            log: []
        };
    }
));

// ─── Rung 8: PRECEDENCE CHECK — Divisible by BOTH 3 AND 5 → answer = 15 ───
// Must be evaluated FIRST to avoid being caught by the 3-only or 5-only rungs
plc.addRung(new Rung(8,
    'DIV_BY_3 AND DIV_BY_5 → answer = 15 (check FIRST for precedence)',
    [
        { type: 'contact-no', tag: 'DIV_BY_3', label: 'DIV_BY_3' },
        { type: 'contact-no', tag: 'DIV_BY_5', label: 'DIV_BY_5' }
    ],
    [
        { type: 'coil-out', tag: 'answer', label: 'MOV 15 → answer' }
    ],
    (engine) => {
        const d3 = engine.get('DIV_BY_3');
        const d5 = engine.get('DIV_BY_5');
        const both = d3 && d5;
        if (both) {
            engine.set('answer', 15);
        }
        return {
            energized: both,
            conditionStates: [d3, d5],
            outputStates: [both],
            log: both ? [{ type: 'action', message: `Div by 3 AND 5 → answer = 15 ⭐` }] : []
        };
    }
));

// ─── Rung 9: Divisible by 3 ONLY (NOT DIV_BY_5) → answer = 3 ───
plc.addRung(new Rung(9,
    'DIV_BY_3 AND NOT DIV_BY_5 → answer = 3',
    [
        { type: 'contact-no', tag: 'DIV_BY_3', label: 'DIV_BY_3' },
        { type: 'contact-nc', tag: 'DIV_BY_5', label: 'DIV_BY_5 (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'answer', label: 'MOV 3 → answer' }
    ],
    (engine) => {
        const d3 = engine.get('DIV_BY_3');
        const d5 = engine.get('DIV_BY_5');
        const only3 = d3 && !d5;
        if (only3) {
            engine.set('answer', 3);
        }
        return {
            energized: only3,
            conditionStates: [d3, !d5],
            outputStates: [only3],
            log: only3 ? [{ type: 'action', message: `Div by 3 only → answer = 3 🟢` }] : []
        };
    }
));

// ─── Rung 10: Divisible by 5 ONLY (NOT DIV_BY_3) → answer = 5 ───
plc.addRung(new Rung(10,
    'NOT DIV_BY_3 AND DIV_BY_5 → answer = 5',
    [
        { type: 'contact-nc', tag: 'DIV_BY_3', label: 'DIV_BY_3 (NC)' },
        { type: 'contact-no', tag: 'DIV_BY_5', label: 'DIV_BY_5' }
    ],
    [
        { type: 'coil-out', tag: 'answer', label: 'MOV 5 → answer' }
    ],
    (engine) => {
        const d3 = engine.get('DIV_BY_3');
        const d5 = engine.get('DIV_BY_5');
        const only5 = !d3 && d5;
        if (only5) {
            engine.set('answer', 5);
        }
        return {
            energized: only5,
            conditionStates: [!d3, d5],
            outputStates: [only5],
            log: only5 ? [{ type: 'action', message: `Div by 5 only → answer = 5 🔴` }] : []
        };
    }
));

// ─── Rung 11: Not divisible by either → answer = 0 ───
plc.addRung(new Rung(11,
    'NOT DIV_BY_3 AND NOT DIV_BY_5 → answer = 0',
    [
        { type: 'contact-nc', tag: 'DIV_BY_3', label: 'DIV_BY_3 (NC)' },
        { type: 'contact-nc', tag: 'DIV_BY_5', label: 'DIV_BY_5 (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'answer', label: 'MOV 0 → answer' }
    ],
    (engine) => {
        const d3 = engine.get('DIV_BY_3');
        const d5 = engine.get('DIV_BY_5');
        const neither = !d3 && !d5;
        if (neither) {
            engine.set('answer', 0);
        }
        return {
            energized: neither,
            conditionStates: [!d3, !d5],
            outputStates: [neither],
            log: neither ? [{ type: 'action', message: `Not divisible → answer = 0 ❌` }] : []
        };
    }
));

// ─── UI Update ───
function updateUI(engine) {
    const inp = engine.get('input');
    const ans = engine.get('answer');
    const r3 = engine.get('remainder3');
    const r5 = engine.get('remainder5');
    const q3 = engine.get('quotient3');
    const q5 = engine.get('quotient5');
    const d3 = engine.get('DIV_BY_3');
    const d5 = engine.get('DIV_BY_5');

    // Big display
    document.getElementById('input-display').textContent = inp;
    document.getElementById('answer-display').textContent = ans;

    // Answer section color
    const ansSection = document.getElementById('answer-section');
    ansSection.className = 'div-answer-section ans-' + ans;

    // Rule highlights
    document.getElementById('rule-none').className = 'rule' + (ans === 0 ? ' active' : '');
    document.getElementById('rule-3').className = 'rule' + (ans === 3 ? ' active' : '');
    document.getElementById('rule-5').className = 'rule' + (ans === 5 ? ' active' : '');
    document.getElementById('rule-15').className = 'rule' + (ans === 15 ? ' active' : '');

    // Remainder cards
    const rem3Card = document.getElementById('rem3-card');
    const rem5Card = document.getElementById('rem5-card');
    rem3Card.className = 'rem-card' + (r3 === 0 ? ' zero' : '');
    rem5Card.className = 'rem-card' + (r5 === 0 ? ' zero' : '');

    document.getElementById('rem3-calc').innerHTML =
        `${inp} &divide; 3 = ${q3} R <strong>${r3}</strong>`;
    document.getElementById('rem5-calc').innerHTML =
        `${inp} &divide; 5 = ${q5} R <strong>${r5}</strong>`;
    document.getElementById('rem3-result').textContent = `remainder3 = ${r3}`;
    document.getElementById('rem5-result').textContent = `remainder5 = ${r5}`;

    // Scan count
    document.getElementById('scan-count').textContent = engine.scanCount;

    // Ladder + table + log
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
            tr.innerHTML = `
                <td>${reg.address}</td>
                <td>${reg.tag}</td>
                <td>${reg.type}</td>
                <td class="value-cell"></td>
                <td>${reg.description}</td>
            `;
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
    logDiv.innerHTML = html || '<div class="log-entry">Set an input value and scan.</div>';
}

// ─── Controls ───
function applyInput() {
    const val = parseInt(document.getElementById('input-val').value, 10);
    if (!isNaN(val) && val >= 0) {
        plc.set('input', val);
        plc.scan();
    }
}

function adjustInput(delta) {
    const el = document.getElementById('input-val');
    let val = Math.max(0, parseInt(el.value, 10) + delta);
    el.value = val;
    plc.set('input', val);
    plc.scan();
}

function quickSet(val) {
    document.getElementById('input-val').value = val;
    plc.set('input', val);
    plc.scan();
}

function toggleRun() {
    running = !running;
    const btn = document.getElementById('run-btn');
    if (running) {
        btn.textContent = '\u23F8 STOP';
        btn.classList.add('running');
        // Auto-increment input each scan for demo
        scanInterval = setInterval(() => {
            const cur = plc.get('input');
            plc.set('input', cur + 1);
            document.getElementById('input-val').value = cur + 1;
            plc.scan();
        }, scanSpeed);
    } else {
        btn.textContent = '\u25B6 AUTO SCAN';
        btn.classList.remove('running');
        clearInterval(scanInterval);
    }
}

function singleScan() {
    plc.scan();
}

// ─── Initialize ───
plc.onChange(updateUI);
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);
plc.scan();
