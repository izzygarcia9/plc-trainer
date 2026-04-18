/**
 * One-Shot Rising (OSR) Toggle Latch - PLC Trainer
 *
 * PLC Concept: One-Shot Rising Edge Detection
 *   A pushbutton is held across many scans, but we only want to act
 *   on the FIRST scan where it transitions from 0→1 (rising edge).
 *
 * Technique:
 *   PB_PREV stores the button state from the PREVIOUS scan.
 *   ONE_SHOT = PB_INPUT AND NOT PB_PREV
 *   This is TRUE for exactly ONE scan cycle on the rising edge.
 *
 * Toggle Latch:
 *   Each one-shot pulse XORs (flips) the BULB_OUT state.
 *   If BULB was OFF → turns ON. If ON → turns OFF.
 *
 * Ladder Rungs:
 *   R0: ONE_SHOT = PB_INPUT AND NOT PB_PREV  (edge detect)
 *   R1: ONE_SHOT AND NOT BULB_OUT → SET BULB  (turn on if off)
 *   R2: ONE_SHOT AND BULB_OUT → RESET BULB    (turn off if on)
 *   R3: Update PB_PREV = PB_INPUT             (save for next scan)
 *   R4: BULB_LATCH → BULB_OUT                 (output)
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 200;

// Timing history for diagram
const timingHistory = [];
const MAX_HISTORY = 40;

// ─── Registers ───
plc.defineRegister('I:0/0',  'PB_INPUT',   'BOOL', false, 'Push button raw input (1=pressed)');
plc.defineRegister('B3:0/0', 'PB_PREV',    'BOOL', false, 'PB state from previous scan');
plc.defineRegister('B3:0/1', 'ONE_SHOT',   'BOOL', false, 'One-shot rising edge pulse');
plc.defineRegister('B3:0/2', 'BULB_LATCH', 'BOOL', false, 'Bulb toggle latch (internal)');
plc.defineRegister('B3:0/3', 'BULB_SNAP',  'BOOL', false, 'Bulb state snapshot (start of scan)');
plc.defineRegister('O:0/0',  'BULB_OUT',   'BOOL', false, 'Bulb output');
plc.defineRegister('N7:0',   'PRESS_COUNT','INT',  0,     'Total press count');

// ─── Rung 0: Snapshot BULB_LATCH at start of scan ───
// This prevents the race condition where SET and RESET see different values
plc.addRung(new Rung(0,
    'Snapshot: BULB_SNAP = BULB_LATCH (capture state before toggle logic)',
    [
        { type: 'contact-no', tag: 'BULB_LATCH', label: 'BULB_LATCH' }
    ],
    [
        { type: 'coil-out', tag: 'BULB_SNAP', label: 'BULB_SNAP' }
    ],
    (engine) => {
        const bulb = engine.get('BULB_LATCH');
        engine.set('BULB_SNAP', bulb);
        return {
            energized: bulb,
            conditionStates: [bulb],
            outputStates: [bulb],
            log: []
        };
    }
));

// ─── Rung 1: One-Shot Rising Edge Detection ───
// ONE_SHOT = PB_INPUT AND NOT PB_PREV
plc.addRung(new Rung(1,
    'OSR: ONE_SHOT = PB_INPUT AND NOT PB_PREV (true for 1 scan only)',
    [
        { type: 'contact-no', tag: 'PB_INPUT', label: 'PB_INPUT' },
        { type: 'contact-nc', tag: 'PB_PREV', label: 'PB_PREV (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'ONE_SHOT', label: 'ONE_SHOT' }
    ],
    (engine) => {
        const input = engine.get('PB_INPUT');
        const prev = engine.get('PB_PREV');
        const oneShot = input && !prev;
        engine.set('ONE_SHOT', oneShot);

        const log = [];
        if (oneShot) {
            log.push({ type: 'action', message: 'ONE-SHOT FIRED (rising edge detected)' });
            engine.set('PRESS_COUNT', engine.get('PRESS_COUNT') + 1);
        }
        return {
            energized: oneShot,
            conditionStates: [input, !prev],
            outputStates: [oneShot],
            log
        };
    }
));

// ─── Rung 2: Toggle ON — ONE_SHOT + bulb snapshot OFF → SET bulb ───
plc.addRung(new Rung(2,
    'ONE_SHOT AND NOT BULB_SNAP → SET BULB_LATCH (turn ON)',
    [
        { type: 'contact-no', tag: 'ONE_SHOT', label: 'ONE_SHOT' },
        { type: 'contact-nc', tag: 'BULB_SNAP', label: 'BULB_SNAP (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'BULB_LATCH', label: 'SET BULB_LATCH' }
    ],
    (engine) => {
        const os = engine.get('ONE_SHOT');
        const snap = engine.get('BULB_SNAP');
        const setIt = os && !snap;
        if (setIt) {
            engine.set('BULB_LATCH', true);
        }
        const log = [];
        if (setIt) {
            log.push({ type: 'state-change', message: 'BULB latched ON' });
        }
        return {
            energized: setIt,
            conditionStates: [os, !snap],
            outputStates: [setIt],
            log
        };
    }
));

// ─── Rung 3: Toggle OFF — ONE_SHOT + bulb snapshot ON → RESET bulb ───
plc.addRung(new Rung(3,
    'ONE_SHOT AND BULB_SNAP → RESET BULB_LATCH (turn OFF)',
    [
        { type: 'contact-no', tag: 'ONE_SHOT', label: 'ONE_SHOT' },
        { type: 'contact-no', tag: 'BULB_SNAP', label: 'BULB_SNAP' }
    ],
    [
        { type: 'coil-out', tag: 'BULB_LATCH', label: 'RST BULB_LATCH' }
    ],
    (engine) => {
        const os = engine.get('ONE_SHOT');
        const snap = engine.get('BULB_SNAP');
        const resetIt = os && snap;
        if (resetIt) {
            engine.set('BULB_LATCH', false);
        }
        const log = [];
        if (resetIt) {
            log.push({ type: 'state-change', message: 'BULB latched OFF' });
        }
        return {
            energized: resetIt,
            conditionStates: [os, snap],
            outputStates: [resetIt],
            log
        };
    }
));

// ─── Rung 3: Save current PB state for next scan ───
// PB_PREV = PB_INPUT (always executes)
plc.addRung(new Rung(3,
    'Update PB_PREV = PB_INPUT (store for next scan edge detection)',
    [
        { type: 'contact-no', tag: 'PB_INPUT', label: 'PB_INPUT' }
    ],
    [
        { type: 'coil-out', tag: 'PB_PREV', label: 'PB_PREV' }
    ],
    (engine) => {
        const input = engine.get('PB_INPUT');
        engine.set('PB_PREV', input);
        return {
            energized: input,
            conditionStates: [input],
            outputStates: [input],
            log: []
        };
    }
));

// ─── Rung 4: Output — BULB_LATCH → BULB_OUT ───
plc.addRung(new Rung(4,
    'BULB_LATCH → BULB_OUT (physical output)',
    [
        { type: 'contact-no', tag: 'BULB_LATCH', label: 'BULB_LATCH' }
    ],
    [
        { type: 'coil-out', tag: 'BULB_OUT', label: 'BULB_OUT' }
    ],
    (engine) => {
        const on = engine.get('BULB_LATCH');
        engine.set('BULB_OUT', on);
        return {
            energized: on,
            conditionStates: [on],
            outputStates: [on],
            log: []
        };
    }
));

// ─── UI Update ───
function updateUI(engine) {
    const input = engine.get('PB_INPUT');
    const prev = engine.get('PB_PREV');
    const oneShot = engine.get('ONE_SHOT');
    const bulb = engine.get('BULB_OUT');

    // Push button visual
    const pbBtn = document.getElementById('push-button');
    pbBtn.className = 'push-button' + (input ? ' pressed' : '');
    const pbState = document.getElementById('pb-state');
    pbState.textContent = input ? 'PRESSED' : 'RELEASED';
    pbState.className = 'pb-state' + (input ? ' pressed' : '');

    // OSR badge
    const osrBadge = document.getElementById('osr-badge');
    osrBadge.className = 'osr-badge' + (oneShot ? ' fired' : '');

    // Bulb
    const bulbEl = document.getElementById('bulb');
    bulbEl.className = 'bulb' + (bulb ? ' on' : '');
    const bulbState = document.getElementById('bulb-state');
    bulbState.textContent = bulb ? 'ON' : 'OFF';
    bulbState.className = 'bulb-state' + (bulb ? ' on' : '');

    // Explanation values
    const exInput = document.getElementById('ex-input');
    exInput.textContent = input ? '1' : '0';
    exInput.className = 'ex-val ' + (input ? 'high' : 'low');

    const exPrev = document.getElementById('ex-prev');
    exPrev.textContent = prev ? '1' : '0';
    exPrev.className = 'ex-val ' + (prev ? 'high' : 'low');

    const exOs = document.getElementById('ex-oneshot');
    exOs.textContent = oneShot ? '1' : '0';
    exOs.className = 'ex-val ' + (oneShot ? 'pulse' : 'low');

    const exBulb = document.getElementById('ex-bulb');
    exBulb.textContent = bulb ? '1' : '0';
    exBulb.className = 'ex-val ' + (bulb ? 'high' : 'low');

    // Timing history
    timingHistory.push({
        input: input ? 1 : 0,
        oneShot: oneShot ? 1 : 0,
        bulb: bulb ? 1 : 0,
        prev: prev ? 1 : 0
    });
    if (timingHistory.length > MAX_HISTORY) timingHistory.shift();
    drawTimingDiagram();

    // Scan count
    document.getElementById('scan-count').textContent = engine.scanCount;

    ladder.update(engine.rungs);
    updateRegisterTable(engine);
    updateScanLog(engine);
}

function drawTimingDiagram() {
    const canvas = document.getElementById('timing-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const signals = [
        { label: 'PB_INPUT',  color: '#e74c3c', key: 'input' },
        { label: 'ONE_SHOT',  color: '#f39c12', key: 'oneShot' },
        { label: 'BULB_OUT',  color: '#f1c40f', key: 'bulb' }
    ];

    const rowH = h / signals.length;
    const leftMargin = 65;
    const rightMargin = 5;
    const plotW = w - leftMargin - rightMargin;
    const stepW = plotW / MAX_HISTORY;

    signals.forEach((sig, si) => {
        const y0 = si * rowH;
        const baseline = y0 + rowH - 10;
        const topline = y0 + 12;
        const sigH = baseline - topline;

        // Label
        ctx.fillStyle = sig.color;
        ctx.font = '9px Courier New';
        ctx.fillText(sig.label, 2, y0 + rowH / 2 + 3);

        // Baseline
        ctx.strokeStyle = '#2a2a4a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(leftMargin, baseline);
        ctx.lineTo(w - rightMargin, baseline);
        ctx.stroke();

        // Signal trace
        ctx.strokeStyle = sig.color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        for (let i = 0; i < timingHistory.length; i++) {
            const val = timingHistory[i][sig.key];
            const x = leftMargin + i * stepW;
            const y = val ? topline : baseline;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                const prevVal = timingHistory[i - 1][sig.key];
                if (val !== prevVal) {
                    // Vertical transition
                    ctx.lineTo(x, prevVal ? topline : baseline);
                    ctx.lineTo(x, y);
                }
                ctx.lineTo(x + stepW, y);
            }
        }
        ctx.stroke();

        // Separator line
        if (si > 0) {
            ctx.strokeStyle = '#1a1a3a';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, y0);
            ctx.lineTo(w, y0);
            ctx.stroke();
        }
    });
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
    logDiv.innerHTML = html || '<div class="log-entry">Press RUN, then click and hold the push button.</div>';
}

// ─── Controls ───
function buttonDown() {
    plc.set('PB_INPUT', true);
    plc.notifyListeners();
}

function buttonUp() {
    plc.set('PB_INPUT', false);
    plc.notifyListeners();
}

function toggleRun() {
    running = !running;
    const btn = document.getElementById('run-btn');
    if (running) {
        btn.textContent = '\u23F8 STOP';
        btn.classList.add('running');
        scanInterval = setInterval(() => plc.scan(), scanSpeed);
    } else {
        btn.textContent = '\u25B6 RUN';
        btn.classList.remove('running');
        clearInterval(scanInterval);
    }
}

function singleScan() {
    plc.scan();
}

function updateScanSpeed(val) {
    scanSpeed = parseInt(val, 10);
    document.getElementById('scan-time').textContent = scanSpeed;
    if (running) {
        clearInterval(scanInterval);
        scanInterval = setInterval(() => plc.scan(), scanSpeed);
    }
}

// ─── Initialize ───
plc.onChange(updateUI);
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);
plc.scan();
