/**
 * Shuttle Motor Scenario - Reciprocating between PE1 and PE2
 *
 * Logic:
 *  - START pressed → motor runs FORWARD
 *  - Carriage moves forward (position increments each scan)
 *  - When position reaches PE1 (pos 17) → PE1 triggers → motor switches to REVERSE
 *  - Carriage moves reverse (position decrements each scan)
 *  - When position reaches PE2 (pos 3) → PE2 triggers → motor switches to FORWARD
 *  - Cycle repeats indefinitely
 *  - STOP pressed → everything halts immediately
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 300;

const PE1_POS = 17;  // PE1 sensor position (right side)
const PE2_POS = 3;   // PE2 sensor position (left side)
const TRACK_MAX = 20;

// ─── Define Registers ───
plc.defineRegister('I:0/0', 'START_PB',   'BOOL', false, 'Start pushbutton (momentary)');
plc.defineRegister('I:0/1', 'STOP_PB',    'BOOL', false, 'Stop pushbutton (NC, momentary)');
plc.defineRegister('I:0/2', 'PE1',        'BOOL', false, 'Photoelectric sensor 1 (right end)');
plc.defineRegister('I:0/3', 'PE2',        'BOOL', false, 'Photoelectric sensor 2 (left end)');
plc.defineRegister('B3:0/0','RUN_LATCH',  'BOOL', false, 'System running latch');
plc.defineRegister('B3:0/1','DIR_FWD',    'BOOL', true,  'Direction: true=FWD, false=REV');
plc.defineRegister('O:0/0', 'MOTOR_FWD',  'BOOL', false, 'Motor forward output');
plc.defineRegister('O:0/1', 'MOTOR_REV',  'BOOL', false, 'Motor reverse output');
plc.defineRegister('N7:0',  'POSITION',   'INT',  0,     'Carriage position (0-20)');

// ─── Rung 0: Start/Stop Latch (Seal-in circuit) ───
// START pressed OR already latched, AND STOP not pressed → RUN_LATCH
plc.addRung(new Rung(0,
    'Start/Stop seal-in: (START OR RUN_LATCH) AND NOT STOP → RUN_LATCH',
    [
        { type: 'contact-no', tag: 'START_PB', label: 'START_PB' },
        { type: 'contact-no', tag: 'RUN_LATCH', label: 'RUN_LATCH (seal)' },
        { type: 'contact-nc', tag: 'STOP_PB', label: 'STOP_PB (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'RUN_LATCH', label: 'RUN_LATCH' }
    ],
    (engine) => {
        const start = engine.get('START_PB');
        const latch = engine.get('RUN_LATCH');
        const stop = engine.get('STOP_PB');
        // Parallel: START OR RUN_LATCH, then series with NOT STOP
        const branchOn = (start || latch) && !stop;
        engine.set('RUN_LATCH', branchOn);

        const log = [];
        if (branchOn !== latch) {
            log.push({ type: 'action', message: branchOn ? 'SYSTEM STARTED' : 'SYSTEM STOPPED' });
        }
        // Clear momentary start after evaluation
        if (start) engine.set('START_PB', false);
        if (stop) engine.set('STOP_PB', false);

        return {
            energized: branchOn,
            conditionStates: [start, latch, !stop],
            outputStates: [branchOn],
            log
        };
    }
));

// ─── Rung 1: PE1 detection (position >= PE1_POS) ───
plc.addRung(new Rung(1,
    'PE1 sensor: position >= 17 → PE1 blocked',
    [
        { type: 'compare-gt', tag: 'POSITION', label: 'POS >= 17', compareValue: `${PE1_POS}` }
    ],
    [
        { type: 'coil-out', tag: 'PE1', label: 'PE1' }
    ],
    (engine) => {
        const pos = engine.get('POSITION');
        const triggered = pos >= PE1_POS;
        engine.set('PE1', triggered);
        return {
            energized: triggered,
            conditionStates: [triggered],
            outputStates: [triggered],
            log: []
        };
    }
));

// ─── Rung 2: PE2 detection (position <= PE2_POS) ───
plc.addRung(new Rung(2,
    'PE2 sensor: position <= 3 → PE2 blocked',
    [
        { type: 'compare-lt', tag: 'POSITION', label: 'POS <= 3', compareValue: `${PE2_POS}` }
    ],
    [
        { type: 'coil-out', tag: 'PE2', label: 'PE2' }
    ],
    (engine) => {
        const pos = engine.get('POSITION');
        const triggered = pos <= PE2_POS;
        engine.set('PE2', triggered);
        return {
            energized: triggered,
            conditionStates: [triggered],
            outputStates: [triggered],
            log: []
        };
    }
));

// ─── Rung 3: Direction control ───
// PE1 triggered → switch to reverse (DIR_FWD = false)
// PE2 triggered → switch to forward (DIR_FWD = true)
plc.addRung(new Rung(3,
    'Direction flip: PE1 hit → REV, PE2 hit → FWD',
    [
        { type: 'contact-no', tag: 'PE1', label: 'PE1' },
        { type: 'contact-no', tag: 'PE2', label: 'PE2' },
        { type: 'contact-no', tag: 'DIR_FWD', label: 'DIR_FWD' }
    ],
    [
        { type: 'coil-out', tag: 'DIR_FWD', label: 'DIR_FWD' }
    ],
    (engine) => {
        const pe1 = engine.get('PE1');
        const pe2 = engine.get('PE2');
        let dir = engine.get('DIR_FWD');
        const prevDir = dir;

        if (pe1) dir = false;   // Hit right end → go reverse
        if (pe2) dir = true;    // Hit left end → go forward
        engine.set('DIR_FWD', dir);

        const log = [];
        if (dir !== prevDir) {
            log.push({ type: 'action', message: dir ? 'Direction → FORWARD ▶' : 'Direction → REVERSE ◀' });
        }
        return {
            energized: true,
            conditionStates: [pe1, pe2, dir],
            outputStates: [dir],
            log
        };
    }
));

// ─── Rung 4: Motor Forward output ───
// RUN_LATCH AND DIR_FWD AND NOT MOTOR_REV → MOTOR_FWD
plc.addRung(new Rung(4,
    'Motor FWD: Running + Direction FWD + NOT REV → MOTOR_FWD ON',
    [
        { type: 'contact-no', tag: 'RUN_LATCH', label: 'RUN_LATCH' },
        { type: 'contact-no', tag: 'DIR_FWD', label: 'DIR_FWD' },
        { type: 'contact-nc', tag: 'MOTOR_REV', label: 'MOTOR_REV (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'MOTOR_FWD', label: 'MOTOR_FWD' }
    ],
    (engine) => {
        const run = engine.get('RUN_LATCH');
        const fwd = engine.get('DIR_FWD');
        const rev = engine.get('MOTOR_REV');
        const on = run && fwd && !rev;
        engine.set('MOTOR_FWD', on);

        const log = [];
        if (on !== engine.registers['MOTOR_FWD'].prevValue) {
            log.push({ type: 'action', message: `MOTOR FWD ${on ? 'ON ▶' : 'OFF'}` });
        }
        return {
            energized: on,
            conditionStates: [run, fwd, !rev],
            outputStates: [on],
            log
        };
    }
));

// ─── Rung 5: Motor Reverse output ───
// RUN_LATCH AND NOT DIR_FWD AND NOT MOTOR_FWD → MOTOR_REV
plc.addRung(new Rung(5,
    'Motor REV: Running + Direction REV + NOT FWD → MOTOR_REV ON',
    [
        { type: 'contact-no', tag: 'RUN_LATCH', label: 'RUN_LATCH' },
        { type: 'contact-nc', tag: 'DIR_FWD', label: 'DIR_FWD (NC)' },
        { type: 'contact-nc', tag: 'MOTOR_FWD', label: 'MOTOR_FWD (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'MOTOR_REV', label: 'MOTOR_REV' }
    ],
    (engine) => {
        const run = engine.get('RUN_LATCH');
        const fwd = engine.get('DIR_FWD');
        const mfwd = engine.get('MOTOR_FWD');
        const on = run && !fwd && !mfwd;
        engine.set('MOTOR_REV', on);

        const log = [];
        if (on !== engine.registers['MOTOR_REV'].prevValue) {
            log.push({ type: 'action', message: `MOTOR REV ${on ? 'ON ◀' : 'OFF'}` });
        }
        return {
            energized: on,
            conditionStates: [run, !fwd, !mfwd],
            outputStates: [on],
            log
        };
    }
));

// ─── Rung 6: Position simulation - Forward movement ───
plc.addRung(new Rung(6,
    'MOTOR_FWD ON → Position + 1 each scan',
    [
        { type: 'contact-no', tag: 'MOTOR_FWD', label: 'MOTOR_FWD' }
    ],
    [
        { type: 'math-add', tag: 'POSITION', label: 'POS + 1' }
    ],
    (engine) => {
        const fwd = engine.get('MOTOR_FWD');
        if (fwd) {
            const pos = Math.min(engine.get('POSITION') + 1, TRACK_MAX);
            engine.set('POSITION', pos);
        }
        return {
            energized: fwd,
            conditionStates: [fwd],
            outputStates: [fwd],
            log: fwd ? [{ type: 'action', message: `Moving FWD → pos ${engine.get('POSITION')}` }] : []
        };
    }
));

// ─── Rung 7: Position simulation - Reverse movement ───
plc.addRung(new Rung(7,
    'MOTOR_REV ON → Position - 1 each scan',
    [
        { type: 'contact-no', tag: 'MOTOR_REV', label: 'MOTOR_REV' }
    ],
    [
        { type: 'math-sub', tag: 'POSITION', label: 'POS - 1' }
    ],
    (engine) => {
        const rev = engine.get('MOTOR_REV');
        if (rev) {
            const pos = Math.max(engine.get('POSITION') - 1, 0);
            engine.set('POSITION', pos);
        }
        return {
            energized: rev,
            conditionStates: [rev],
            outputStates: [rev],
            log: rev ? [{ type: 'action', message: `Moving REV → pos ${engine.get('POSITION')}` }] : []
        };
    }
));

// ─── UI Update ───
function updateUI(engine) {
    const pos = engine.get('POSITION');
    const motorFwd = engine.get('MOTOR_FWD');
    const motorRev = engine.get('MOTOR_REV');
    const pe1 = engine.get('PE1');
    const pe2 = engine.get('PE2');
    const runLatch = engine.get('RUN_LATCH');

    // Carriage position (map 0-20 to 15%-85% of track)
    const pct = 15 + (pos / TRACK_MAX) * 70;
    const carriage = document.getElementById('carriage');
    carriage.style.left = pct + '%';

    const body = carriage.querySelector('.carriage-body');
    if (motorFwd) {
        body.className = 'carriage-body fwd';
        body.innerHTML = '&#9654;';
    } else if (motorRev) {
        body.className = 'carriage-body rev';
        body.innerHTML = '&#9664;';
    } else {
        body.className = 'carriage-body stopped';
        body.innerHTML = '&#9632;';
    }

    // Sensor posts
    document.getElementById('pe1-post').className = 'sensor-post pe1-post' + (pe1 ? ' triggered' : '');
    document.getElementById('pe2-post').className = 'sensor-post pe2-post' + (pe2 ? ' triggered' : '');

    // Motor status boxes
    const fwdBox = document.getElementById('motor-fwd-visual');
    const revBox = document.getElementById('motor-rev-visual');
    fwdBox.className = 'equip-box' + (motorFwd ? ' active' : '');
    revBox.className = 'equip-box' + (motorRev ? ' active' : '');
    document.getElementById('motor-fwd-status').textContent = motorFwd ? 'ON' : 'OFF';
    document.getElementById('motor-rev-status').textContent = motorRev ? 'ON' : 'OFF';

    // PE status boxes
    const pe1Box = document.getElementById('pe1-visual');
    const pe2Box = document.getElementById('pe2-visual');
    pe1Box.className = 'equip-box sensor-box' + (pe1 ? ' triggered' : '');
    pe2Box.className = 'equip-box sensor-box' + (pe2 ? ' triggered' : '');
    document.getElementById('pe1-status').textContent = pe1 ? 'BLOCKED' : 'CLEAR';
    document.getElementById('pe2-status').textContent = pe2 ? 'BLOCKED' : 'CLEAR';

    // Position
    document.getElementById('position-val').textContent = pos;

    // Start/Stop button visuals
    document.getElementById('start-btn').className = 'plc-btn start-btn' + (runLatch ? ' pressed' : '');
    document.getElementById('stop-btn').className = 'plc-btn stop-btn' + (!runLatch && engine.scanCount > 1 ? '' : '');

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
    logDiv.innerHTML = html || '<div class="log-entry">Press START then RUN PLC to begin.</div>';
}

// ─── Control Functions ───
function pressStart() {
    plc.set('START_PB', true);
    plc.set('STOP_PB', false);
    addManualLog('START button pressed');
    // Run a scan immediately so the latch picks up
    plc.scan();
}

function pressStop() {
    plc.set('STOP_PB', true);
    plc.set('START_PB', false);
    addManualLog('STOP button pressed');
    plc.scan();
}

function toggleRun() {
    running = !running;
    const btn = document.getElementById('run-btn');
    if (running) {
        btn.textContent = '\u23F8 STOP PLC';
        btn.classList.add('running');
        scanInterval = setInterval(() => plc.scan(), scanSpeed);
    } else {
        btn.textContent = '\u25B6 RUN PLC';
        btn.classList.remove('running');
        clearInterval(scanInterval);
    }
}

function singleScan() {
    plc.scan();
}

function addManualLog(message) {
    plc.logEntries.unshift({
        scan: plc.scanCount,
        entries: [{ type: 'action', message }]
    });
    updateScanLog(plc);
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
