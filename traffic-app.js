/**
 * Traffic Light Control - PLC Trainer
 *
 * Sequence: GREEN (30s) → YELLOW (10s) → RED (20s) → repeat
 *
 * PLC Timer approach using TON (Timer On-Delay):
 *   - Three states: STATE_GREEN, STATE_YELLOW, STATE_RED
 *   - Each state enables a TON timer
 *   - When timer DN (done) bit sets, transition to next state
 *   - Timer ACC (accumulated) counts up each scan while enabled
 *   - Timer resets (ACC=0) when its enable bit drops
 *
 * Timer addresses (classic SLC-500 style):
 *   T4:0 = Green timer  (PRE=30)
 *   T4:1 = Yellow timer (PRE=10)
 *   T4:2 = Red timer    (PRE=20)
 *
 * Time scale: 1 "second" = N scans (configurable)
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 1000;
let timeScale = 1; // scans per "second"

// Timer presets (in seconds)
const GREEN_PRE = 30;
const YELLOW_PRE = 10;
const RED_PRE = 20;

// ─── Define Registers ───

// State bits
plc.defineRegister('B3:0/0', 'STATE_GREEN',  'BOOL', true,  'Green light state active');
plc.defineRegister('B3:0/1', 'STATE_YELLOW', 'BOOL', false, 'Yellow light state active');
plc.defineRegister('B3:0/2', 'STATE_RED',    'BOOL', false, 'Red light state active');

// Light outputs
plc.defineRegister('O:0/0',  'GREEN_LIGHT',  'BOOL', false, 'Green light output');
plc.defineRegister('O:0/1',  'YELLOW_LIGHT', 'BOOL', false, 'Yellow light output');
plc.defineRegister('O:0/2',  'RED_LIGHT',    'BOOL', false, 'Red light output');

// Timer T4:0 - Green (PRE=30)
plc.defineRegister('T4:0.PRE', 'T4_0_PRE', 'INT',  GREEN_PRE, 'Green timer preset (seconds)');
plc.defineRegister('T4:0.ACC', 'T4_0_ACC', 'INT',  0,         'Green timer accumulated (seconds)');
plc.defineRegister('T4:0/EN',  'T4_0_EN',  'BOOL', false,     'Green timer enable bit');
plc.defineRegister('T4:0/TT',  'T4_0_TT',  'BOOL', false,     'Green timer timing bit');
plc.defineRegister('T4:0/DN',  'T4_0_DN',  'BOOL', false,     'Green timer done bit');

// Timer T4:1 - Yellow (PRE=10)
plc.defineRegister('T4:1.PRE', 'T4_1_PRE', 'INT',  YELLOW_PRE, 'Yellow timer preset (seconds)');
plc.defineRegister('T4:1.ACC', 'T4_1_ACC', 'INT',  0,          'Yellow timer accumulated (seconds)');
plc.defineRegister('T4:1/EN',  'T4_1_EN',  'BOOL', false,      'Yellow timer enable bit');
plc.defineRegister('T4:1/TT',  'T4_1_TT',  'BOOL', false,      'Yellow timer timing bit');
plc.defineRegister('T4:1/DN',  'T4_1_DN',  'BOOL', false,      'Yellow timer done bit');

// Timer T4:2 - Red (PRE=20)
plc.defineRegister('T4:2.PRE', 'T4_2_PRE', 'INT',  RED_PRE,   'Red timer preset (seconds)');
plc.defineRegister('T4:2.ACC', 'T4_2_ACC', 'INT',  0,          'Red timer accumulated (seconds)');
plc.defineRegister('T4:2/EN',  'T4_2_EN',  'BOOL', false,      'Red timer enable bit');
plc.defineRegister('T4:2/TT',  'T4_2_TT',  'BOOL', false,      'Red timer timing bit');
plc.defineRegister('T4:2/DN',  'T4_2_DN',  'BOOL', false,      'Red timer done bit');

// Internal
plc.defineRegister('N7:0', 'SCAN_SUB',   'INT', 0, 'Sub-scan counter for time scale');
plc.defineRegister('N7:1', 'CYCLE_COUNT','INT', 1, 'Cycle counter');

/**
 * TON Timer simulation helper
 * Returns { en, tt, dn, acc }
 */
function simulateTON(engine, enable, accTag, preTag, enTag, ttTag, dnTag) {
    const pre = engine.get(preTag);
    let acc = engine.get(accTag);

    if (!enable) {
        // Timer disabled → reset
        engine.set(accTag, 0);
        engine.set(enTag, false);
        engine.set(ttTag, false);
        engine.set(dnTag, false);
        return { en: false, tt: false, dn: false, acc: 0 };
    }

    // Timer enabled
    engine.set(enTag, true);

    if (acc >= pre) {
        // Done
        engine.set(ttTag, false);
        engine.set(dnTag, true);
        return { en: true, tt: false, dn: true, acc };
    }

    // Check sub-scan counter for time scaling
    let sub = engine.get('SCAN_SUB');
    sub++;
    if (sub >= timeScale) {
        acc++;
        engine.set(accTag, acc);
        sub = 0;
    }
    engine.set('SCAN_SUB', sub);

    const done = acc >= pre;
    engine.set(ttTag, !done);
    engine.set(dnTag, done);

    return { en: true, tt: !done, dn: done, acc };
}

// ─── Rung 0: TON T4:0 — Green Timer ───
// STATE_GREEN enables the timer. When DN, transition to yellow.
plc.addRung(new Rung(0,
    'TON T4:0: STATE_GREEN enables green timer (PRE=30s)',
    [
        { type: 'contact-no', tag: 'STATE_GREEN', label: 'STATE_GREEN' }
    ],
    [
        { type: 'coil-out', tag: 'T4_0_EN', label: 'TON T4:0 (30s)' }
    ],
    (engine) => {
        const stateGreen = engine.get('STATE_GREEN');
        const result = simulateTON(engine, stateGreen,
            'T4_0_ACC', 'T4_0_PRE', 'T4_0_EN', 'T4_0_TT', 'T4_0_DN');
        return {
            energized: stateGreen,
            conditionStates: [stateGreen],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 1: Green timer done → transition to Yellow ───
plc.addRung(new Rung(1,
    'T4:0/DN (green done) → clear GREEN, set YELLOW',
    [
        { type: 'contact-no', tag: 'T4_0_DN', label: 'T4:0/DN' }
    ],
    [
        { type: 'coil-out', tag: 'STATE_YELLOW', label: 'STATE_YELLOW' }
    ],
    (engine) => {
        const dn = engine.get('T4_0_DN');
        if (dn) {
            engine.set('STATE_GREEN', false);
            engine.set('STATE_YELLOW', true);
            engine.set('SCAN_SUB', 0);
        }
        const log = [];
        if (dn && engine.registers['STATE_YELLOW'].prevValue === false) {
            log.push({ type: 'action', message: 'GREEN done → YELLOW' });
        }
        return {
            energized: dn,
            conditionStates: [dn],
            outputStates: [dn],
            log
        };
    }
));

// ─── Rung 2: TON T4:1 — Yellow Timer ───
plc.addRung(new Rung(2,
    'TON T4:1: STATE_YELLOW enables yellow timer (PRE=10s)',
    [
        { type: 'contact-no', tag: 'STATE_YELLOW', label: 'STATE_YELLOW' }
    ],
    [
        { type: 'coil-out', tag: 'T4_1_EN', label: 'TON T4:1 (10s)' }
    ],
    (engine) => {
        const stateYellow = engine.get('STATE_YELLOW');
        const result = simulateTON(engine, stateYellow,
            'T4_1_ACC', 'T4_1_PRE', 'T4_1_EN', 'T4_1_TT', 'T4_1_DN');
        return {
            energized: stateYellow,
            conditionStates: [stateYellow],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 3: Yellow timer done → transition to Red ───
plc.addRung(new Rung(3,
    'T4:1/DN (yellow done) → clear YELLOW, set RED',
    [
        { type: 'contact-no', tag: 'T4_1_DN', label: 'T4:1/DN' }
    ],
    [
        { type: 'coil-out', tag: 'STATE_RED', label: 'STATE_RED' }
    ],
    (engine) => {
        const dn = engine.get('T4_1_DN');
        if (dn) {
            engine.set('STATE_YELLOW', false);
            engine.set('STATE_RED', true);
            engine.set('SCAN_SUB', 0);
        }
        const log = [];
        if (dn && engine.registers['STATE_RED'].prevValue === false) {
            log.push({ type: 'action', message: 'YELLOW done → RED' });
        }
        return {
            energized: dn,
            conditionStates: [dn],
            outputStates: [dn],
            log
        };
    }
));

// ─── Rung 4: TON T4:2 — Red Timer ───
plc.addRung(new Rung(4,
    'TON T4:2: STATE_RED enables red timer (PRE=20s)',
    [
        { type: 'contact-no', tag: 'STATE_RED', label: 'STATE_RED' }
    ],
    [
        { type: 'coil-out', tag: 'T4_2_EN', label: 'TON T4:2 (20s)' }
    ],
    (engine) => {
        const stateRed = engine.get('STATE_RED');
        const result = simulateTON(engine, stateRed,
            'T4_2_ACC', 'T4_2_PRE', 'T4_2_EN', 'T4_2_TT', 'T4_2_DN');
        return {
            energized: stateRed,
            conditionStates: [stateRed],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 5: Red timer done → transition back to Green (cycle restart) ───
plc.addRung(new Rung(5,
    'T4:2/DN (red done) → clear RED, set GREEN, increment cycle',
    [
        { type: 'contact-no', tag: 'T4_2_DN', label: 'T4:2/DN' }
    ],
    [
        { type: 'coil-out', tag: 'STATE_GREEN', label: 'STATE_GREEN' }
    ],
    (engine) => {
        const dn = engine.get('T4_2_DN');
        if (dn) {
            engine.set('STATE_RED', false);
            engine.set('STATE_GREEN', true);
            engine.set('SCAN_SUB', 0);
            engine.set('CYCLE_COUNT', engine.get('CYCLE_COUNT') + 1);
        }
        const log = [];
        if (dn && engine.registers['STATE_GREEN'].prevValue === false) {
            log.push({ type: 'action', message: `RED done → GREEN (cycle ${engine.get('CYCLE_COUNT')})` });
        }
        return {
            energized: dn,
            conditionStates: [dn],
            outputStates: [dn],
            log
        };
    }
));

// ─── Rung 6: Green light output ───
plc.addRung(new Rung(6,
    'STATE_GREEN → GREEN_LIGHT output ON',
    [
        { type: 'contact-no', tag: 'STATE_GREEN', label: 'STATE_GREEN' }
    ],
    [
        { type: 'coil-out', tag: 'GREEN_LIGHT', label: 'GREEN_LIGHT' }
    ],
    (engine) => {
        const on = engine.get('STATE_GREEN');
        engine.set('GREEN_LIGHT', on);
        return {
            energized: on,
            conditionStates: [on],
            outputStates: [on],
            log: []
        };
    }
));

// ─── Rung 7: Yellow light output ───
plc.addRung(new Rung(7,
    'STATE_YELLOW → YELLOW_LIGHT output ON',
    [
        { type: 'contact-no', tag: 'STATE_YELLOW', label: 'STATE_YELLOW' }
    ],
    [
        { type: 'coil-out', tag: 'YELLOW_LIGHT', label: 'YELLOW_LIGHT' }
    ],
    (engine) => {
        const on = engine.get('STATE_YELLOW');
        engine.set('YELLOW_LIGHT', on);
        return {
            energized: on,
            conditionStates: [on],
            outputStates: [on],
            log: []
        };
    }
));

// ─── Rung 8: Red light output ───
plc.addRung(new Rung(8,
    'STATE_RED → RED_LIGHT output ON',
    [
        { type: 'contact-no', tag: 'STATE_RED', label: 'STATE_RED' }
    ],
    [
        { type: 'coil-out', tag: 'RED_LIGHT', label: 'RED_LIGHT' }
    ],
    (engine) => {
        const on = engine.get('STATE_RED');
        engine.set('RED_LIGHT', on);
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
    const green = engine.get('GREEN_LIGHT');
    const yellow = engine.get('YELLOW_LIGHT');
    const red = engine.get('RED_LIGHT');

    // Traffic light bulbs
    document.getElementById('green-bulb').className =
        'light-bulb green-bulb' + (green ? ' on' : '');
    document.getElementById('yellow-bulb').className =
        'light-bulb yellow-bulb' + (yellow ? ' on' : '');
    document.getElementById('red-bulb').className =
        'light-bulb red-bulb' + (red ? ' on' : '');

    // Timer bars
    const gAcc = engine.get('T4_0_ACC');
    const yAcc = engine.get('T4_1_ACC');
    const rAcc = engine.get('T4_2_ACC');

    document.getElementById('green-bar').style.width =
        (gAcc / GREEN_PRE * 100) + '%';
    document.getElementById('green-time').textContent =
        `${gAcc} / ${GREEN_PRE}s`;

    document.getElementById('yellow-bar').style.width =
        (yAcc / YELLOW_PRE * 100) + '%';
    document.getElementById('yellow-time').textContent =
        `${yAcc} / ${YELLOW_PRE}s`;

    document.getElementById('red-bar').style.width =
        (rAcc / RED_PRE * 100) + '%';
    document.getElementById('red-time').textContent =
        `${rAcc} / ${RED_PRE}s`;

    // State display
    const stateEl = document.getElementById('state-display');
    if (green) {
        stateEl.textContent = 'GREEN';
        stateEl.className = 'green-state';
    } else if (yellow) {
        stateEl.textContent = 'YELLOW';
        stateEl.className = 'yellow-state';
    } else if (red) {
        stateEl.textContent = 'RED';
        stateEl.className = 'red-state';
    }

    document.getElementById('cycle-count').textContent = engine.get('CYCLE_COUNT');
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
    logDiv.innerHTML = html || '<div class="log-entry">Press RUN to start the traffic light cycle.</div>';
}

// ─── Controls ───
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

function resetCycle() {
    // Reset all state
    plc.set('STATE_GREEN', true);
    plc.set('STATE_YELLOW', false);
    plc.set('STATE_RED', false);
    plc.set('T4_0_ACC', 0); plc.set('T4_0_EN', false);
    plc.set('T4_0_TT', false); plc.set('T4_0_DN', false);
    plc.set('T4_1_ACC', 0); plc.set('T4_1_EN', false);
    plc.set('T4_1_TT', false); plc.set('T4_1_DN', false);
    plc.set('T4_2_ACC', 0); plc.set('T4_2_EN', false);
    plc.set('T4_2_TT', false); plc.set('T4_2_DN', false);
    plc.set('SCAN_SUB', 0);
    plc.set('CYCLE_COUNT', 1);
    plc.logEntries = [];
    plc.notifyListeners();
}

function updateScanSpeed(val) {
    scanSpeed = parseInt(val, 10);
    document.getElementById('scan-time').textContent = scanSpeed;
    if (running) {
        clearInterval(scanInterval);
        scanInterval = setInterval(() => plc.scan(), scanSpeed);
    }
}

function updateTimeScale(val) {
    timeScale = parseInt(val, 10);
    document.getElementById('scale-display').textContent = timeScale;
}

// ─── Initialize ───
plc.onChange(updateUI);
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);
plc.scan();
