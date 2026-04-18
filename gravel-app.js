/**
 * Gravel Dumper System - PLC Trainer
 *
 * Sequence:
 *   1. Proximity sensor detects truck → TRUCK_PRESENT
 *   2. TON T4:0 (3s delay) starts timing
 *   3. T4:0/DN → DUMPER_RUN output ON, TON T4:1 (30s dump) starts
 *   4. T4:1/DN → DUMPER_RUN OFF, system goes IDLE (DUMP_COMPLETE)
 *   5. Truck leaves → full reset, ready for next truck
 *
 * Overdump alarm:
 *   - TON T4:2 (30s) runs whenever DUMPER_RUN is ON
 *   - If DUMPER_RUN stays on past 30s (T4:2/DN), OVERDUMP_ALARM latches
 *   - Alarm must be manually reset
 *
 * Timers:
 *   T4:0 = Delay timer    (PRE=3s)
 *   T4:1 = Dump timer     (PRE=30s)
 *   T4:2 = Overdump timer (PRE=30s, safety)
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 1000;
let timeScale = 1;

const DELAY_PRE = 3;
const DUMP_PRE = 30;
const OVERDUMP_PRE = 30;

// ─── Registers ───

// Inputs
plc.defineRegister('I:0/0', 'TRUCK_PRESENT',  'BOOL', false, 'Proximity sensor - truck detected');
plc.defineRegister('I:0/1', 'ALARM_RESET_PB', 'BOOL', false, 'Alarm reset pushbutton (momentary)');

// State bits
plc.defineRegister('B3:0/0', 'DELAY_ACTIVE',   'BOOL', false, 'Delay phase active');
plc.defineRegister('B3:0/1', 'DUMP_ACTIVE',     'BOOL', false, 'Dumping phase active');
plc.defineRegister('B3:0/2', 'DUMP_COMPLETE',   'BOOL', false, 'Dump cycle complete');

// Outputs
plc.defineRegister('O:0/0', 'DUMPER_RUN',      'BOOL', false, 'Dumper motor output');
plc.defineRegister('O:0/1', 'OVERDUMP_ALARM',  'BOOL', false, 'Overdump alarm (latched)');

// Timer T4:0 - Delay (PRE=3s)
plc.defineRegister('T4:0.PRE', 'T4_0_PRE', 'INT',  DELAY_PRE, 'Delay timer preset (3s)');
plc.defineRegister('T4:0.ACC', 'T4_0_ACC', 'INT',  0,         'Delay timer accumulated');
plc.defineRegister('T4:0/EN',  'T4_0_EN',  'BOOL', false,     'Delay timer enable');
plc.defineRegister('T4:0/TT',  'T4_0_TT',  'BOOL', false,     'Delay timer timing');
plc.defineRegister('T4:0/DN',  'T4_0_DN',  'BOOL', false,     'Delay timer done');

// Timer T4:1 - Dump (PRE=30s)
plc.defineRegister('T4:1.PRE', 'T4_1_PRE', 'INT',  DUMP_PRE,  'Dump timer preset (30s)');
plc.defineRegister('T4:1.ACC', 'T4_1_ACC', 'INT',  0,          'Dump timer accumulated');
plc.defineRegister('T4:1/EN',  'T4_1_EN',  'BOOL', false,      'Dump timer enable');
plc.defineRegister('T4:1/TT',  'T4_1_TT',  'BOOL', false,      'Dump timer timing');
plc.defineRegister('T4:1/DN',  'T4_1_DN',  'BOOL', false,      'Dump timer done');

// Timer T4:2 - Overdump safety (PRE=30s)
plc.defineRegister('T4:2.PRE', 'T4_2_PRE', 'INT',  OVERDUMP_PRE, 'Overdump timer preset (30s)');
plc.defineRegister('T4:2.ACC', 'T4_2_ACC', 'INT',  0,             'Overdump timer accumulated');
plc.defineRegister('T4:2/EN',  'T4_2_EN',  'BOOL', false,         'Overdump timer enable');
plc.defineRegister('T4:2/TT',  'T4_2_TT',  'BOOL', false,         'Overdump timer timing');
plc.defineRegister('T4:2/DN',  'T4_2_DN',  'BOOL', false,         'Overdump timer done');

// Counters
plc.defineRegister('N7:0', 'SCAN_SUB',    'INT', 0, 'Sub-scan counter for time scale');
plc.defineRegister('N7:1', 'TRUCK_COUNT', 'INT', 0, 'Trucks processed');
plc.defineRegister('N7:2', 'GRAVEL_PCT',  'INT', 0, 'Truck bed fill percentage');

// Track which timer is currently ticking (only one at a time for sub-scan sharing)
let activeTimer = null;

/**
 * TON Timer simulation
 */
function simulateTON(engine, enable, accTag, preTag, enTag, ttTag, dnTag, timerKey) {
    const pre = engine.get(preTag);
    let acc = engine.get(accTag);

    if (!enable) {
        engine.set(accTag, 0);
        engine.set(enTag, false);
        engine.set(ttTag, false);
        engine.set(dnTag, false);
        return { en: false, tt: false, dn: false, acc: 0 };
    }

    engine.set(enTag, true);

    if (acc >= pre) {
        engine.set(ttTag, false);
        engine.set(dnTag, true);
        return { en: true, tt: false, dn: true, acc };
    }

    // Each timer manages its own sub-counter independently
    // We use a simple approach: increment ACC once per (timeScale) scans
    // Store per-timer sub count in a closure-like approach via the ACC fractional tracking
    acc++;
    engine.set(accTag, acc);

    const done = acc >= pre;
    engine.set(ttTag, !done);
    engine.set(dnTag, done);
    return { en: true, tt: !done, dn: done, acc };
}

// Per-timer sub-scan counters
const timerSubCounters = { T0: 0, T1: 0, T2: 0 };

function simulateTONScaled(engine, enable, accTag, preTag, enTag, ttTag, dnTag, timerKey) {
    const pre = engine.get(preTag);
    let acc = engine.get(accTag);

    if (!enable) {
        engine.set(accTag, 0);
        engine.set(enTag, false);
        engine.set(ttTag, false);
        engine.set(dnTag, false);
        timerSubCounters[timerKey] = 0;
        return { en: false, tt: false, dn: false, acc: 0 };
    }

    engine.set(enTag, true);

    if (acc >= pre) {
        engine.set(ttTag, false);
        engine.set(dnTag, true);
        return { en: true, tt: false, dn: true, acc };
    }

    timerSubCounters[timerKey]++;
    if (timerSubCounters[timerKey] >= timeScale) {
        acc++;
        engine.set(accTag, acc);
        timerSubCounters[timerKey] = 0;
    }

    const done = acc >= pre;
    engine.set(ttTag, !done);
    engine.set(dnTag, done);
    return { en: true, tt: !done, dn: done, acc };
}

// ─── Rung 0: Truck detected → start delay phase ───
// TRUCK_PRESENT AND NOT DUMP_COMPLETE AND NOT DUMP_ACTIVE → DELAY_ACTIVE
plc.addRung(new Rung(0,
    'Truck detected + not already dumping/done → start delay phase',
    [
        { type: 'contact-no', tag: 'TRUCK_PRESENT', label: 'TRUCK_PRESENT' },
        { type: 'contact-nc', tag: 'DUMP_ACTIVE', label: 'DUMP_ACTIVE (NC)' },
        { type: 'contact-nc', tag: 'DUMP_COMPLETE', label: 'DUMP_COMPLETE (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'DELAY_ACTIVE', label: 'DELAY_ACTIVE' }
    ],
    (engine) => {
        const truck = engine.get('TRUCK_PRESENT');
        const dumping = engine.get('DUMP_ACTIVE');
        const done = engine.get('DUMP_COMPLETE');
        const on = truck && !dumping && !done;
        engine.set('DELAY_ACTIVE', on);
        return {
            energized: on,
            conditionStates: [truck, !dumping, !done],
            outputStates: [on],
            log: []
        };
    }
));

// ─── Rung 1: TON T4:0 — 3-second delay timer ───
plc.addRung(new Rung(1,
    'TON T4:0: DELAY_ACTIVE enables 3s delay before dumping',
    [
        { type: 'contact-no', tag: 'DELAY_ACTIVE', label: 'DELAY_ACTIVE' }
    ],
    [
        { type: 'coil-out', tag: 'T4_0_EN', label: 'TON T4:0 (3s)' }
    ],
    (engine) => {
        const en = engine.get('DELAY_ACTIVE');
        const result = simulateTONScaled(engine, en,
            'T4_0_ACC', 'T4_0_PRE', 'T4_0_EN', 'T4_0_TT', 'T4_0_DN', 'T0');
        return {
            energized: en,
            conditionStates: [en],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 2: Delay done → start dump phase ───
plc.addRung(new Rung(2,
    'T4:0/DN (delay done) → set DUMP_ACTIVE, clear DELAY_ACTIVE',
    [
        { type: 'contact-no', tag: 'T4_0_DN', label: 'T4:0/DN' }
    ],
    [
        { type: 'coil-out', tag: 'DUMP_ACTIVE', label: 'DUMP_ACTIVE' }
    ],
    (engine) => {
        const dn = engine.get('T4_0_DN');
        if (dn && !engine.get('DUMP_ACTIVE')) {
            engine.set('DUMP_ACTIVE', true);
            engine.set('DELAY_ACTIVE', false);
        }
        const log = [];
        if (dn && engine.registers['DUMP_ACTIVE'].prevValue === false) {
            log.push({ type: 'action', message: 'Delay complete → DUMPING STARTED' });
        }
        return {
            energized: dn,
            conditionStates: [dn],
            outputStates: [dn],
            log
        };
    }
));

// ─── Rung 3: DUMP_ACTIVE → DUMPER_RUN output ───
plc.addRung(new Rung(3,
    'TRUCK_PRESENT AND DUMP_ACTIVE AND NOT DUMP_COMPLETE → DUMPER_RUN ON',
    [
        { type: 'contact-no', tag: 'TRUCK_PRESENT', label: 'TRUCK_PRESENT' },
        { type: 'contact-no', tag: 'DUMP_ACTIVE', label: 'DUMP_ACTIVE' },
        { type: 'contact-nc', tag: 'DUMP_COMPLETE', label: 'DUMP_COMPLETE (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'DUMPER_RUN', label: 'DUMPER_RUN' }
    ],
    (engine) => {
        const truck = engine.get('TRUCK_PRESENT');
        const active = engine.get('DUMP_ACTIVE');
        const complete = engine.get('DUMP_COMPLETE');
        const on = truck && active && !complete;
        engine.set('DUMPER_RUN', on);
        const log = [];
        if (on !== engine.registers['DUMPER_RUN'].prevValue) {
            log.push({ type: 'action', message: `DUMPER ${on ? 'RUNNING' : 'STOPPED'}` });
        }
        return {
            energized: on,
            conditionStates: [truck, active, !complete],
            outputStates: [on],
            log
        };
    }
));

// ─── Rung 4: TON T4:1 — 30-second dump timer ───
plc.addRung(new Rung(4,
    'TON T4:1: DUMPER_RUN enables 30s dump timer',
    [
        { type: 'contact-no', tag: 'DUMPER_RUN', label: 'DUMPER_RUN' }
    ],
    [
        { type: 'coil-out', tag: 'T4_1_EN', label: 'TON T4:1 (30s)' }
    ],
    (engine) => {
        const en = engine.get('DUMPER_RUN');
        const result = simulateTONScaled(engine, en,
            'T4_1_ACC', 'T4_1_PRE', 'T4_1_EN', 'T4_1_TT', 'T4_1_DN', 'T1');
        // Update gravel fill percentage
        if (en) {
            const pct = Math.min(100, Math.round(engine.get('T4_1_ACC') / DUMP_PRE * 100));
            engine.set('GRAVEL_PCT', pct);
        }
        return {
            energized: en,
            conditionStates: [en],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 5: Dump timer done → DUMP_COMPLETE ───
plc.addRung(new Rung(5,
    'T4:1/DN (dump done) → DUMP_COMPLETE, stop dumper',
    [
        { type: 'contact-no', tag: 'T4_1_DN', label: 'T4:1/DN' }
    ],
    [
        { type: 'coil-out', tag: 'DUMP_COMPLETE', label: 'DUMP_COMPLETE' }
    ],
    (engine) => {
        const dn = engine.get('T4_1_DN');
        if (dn) {
            engine.set('DUMP_COMPLETE', true);
            engine.set('DUMP_ACTIVE', false);
            engine.set('GRAVEL_PCT', 100);
        }
        const log = [];
        if (dn && engine.registers['DUMP_COMPLETE'].prevValue === false) {
            log.push({ type: 'action', message: 'Dump complete → DUMPER STOPPED, waiting for truck to leave' });
            engine.set('TRUCK_COUNT', engine.get('TRUCK_COUNT') + 1);
        }
        return {
            energized: dn,
            conditionStates: [dn],
            outputStates: [dn],
            log
        };
    }
));

// ─── Rung 6: TON T4:2 — Overdump safety timer (30s) ───
// Runs independently while DUMPER_RUN is ON
plc.addRung(new Rung(6,
    'TON T4:2: DUMPER_RUN enables 30s overdump safety timer',
    [
        { type: 'contact-no', tag: 'DUMPER_RUN', label: 'DUMPER_RUN' }
    ],
    [
        { type: 'coil-out', tag: 'T4_2_EN', label: 'TON T4:2 (30s safety)' }
    ],
    (engine) => {
        const en = engine.get('DUMPER_RUN');
        const result = simulateTONScaled(engine, en,
            'T4_2_ACC', 'T4_2_PRE', 'T4_2_EN', 'T4_2_TT', 'T4_2_DN', 'T2');
        return {
            energized: en,
            conditionStates: [en],
            outputStates: [result.en],
            log: []
        };
    }
));

// ─── Rung 7: Overdump alarm latch ───
// T4:2/DN OR OVERDUMP_ALARM (seal-in), AND NOT ALARM_RESET → OVERDUMP_ALARM
plc.addRung(new Rung(7,
    'T4:2/DN OR ALARM (seal) AND NOT RESET → OVERDUMP_ALARM latched',
    [
        { type: 'contact-no', tag: 'T4_2_DN', label: 'T4:2/DN' },
        { type: 'contact-no', tag: 'OVERDUMP_ALARM', label: 'ALARM (seal)' },
        { type: 'contact-nc', tag: 'ALARM_RESET_PB', label: 'RESET (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'OVERDUMP_ALARM', label: 'OVERDUMP_ALARM' }
    ],
    (engine) => {
        const dn = engine.get('T4_2_DN');
        const alarm = engine.get('OVERDUMP_ALARM');
        const reset = engine.get('ALARM_RESET_PB');
        const latched = (dn || alarm) && !reset;
        engine.set('OVERDUMP_ALARM', latched);

        // Clear momentary reset
        if (reset) engine.set('ALARM_RESET_PB', false);

        const log = [];
        if (latched && !alarm) {
            log.push({ type: 'action', message: 'OVERDUMP ALARM TRIGGERED' });
        }
        if (!latched && alarm) {
            log.push({ type: 'action', message: 'Alarm reset' });
        }
        return {
            energized: latched,
            conditionStates: [dn, alarm, !reset],
            outputStates: [latched],
            log
        };
    }
));

// ─── Rung 8: Truck leaves → full reset ───
// When TRUCK_PRESENT goes false during ANY active phase, reset everything
plc.addRung(new Rung(8,
    'NOT TRUCK_PRESENT AND (DELAY or DUMP or COMPLETE active) → full reset',
    [
        { type: 'contact-nc', tag: 'TRUCK_PRESENT', label: 'TRUCK_PRESENT (NC)' },
        { type: 'contact-no', tag: 'DUMP_COMPLETE', label: 'any phase active' }
    ],
    [
        { type: 'coil-out', tag: 'DUMP_COMPLETE', label: 'RESET (clear all)' }
    ],
    (engine) => {
        const noTruck = !engine.get('TRUCK_PRESENT');
        const anyActive = engine.get('DELAY_ACTIVE') ||
                          engine.get('DUMP_ACTIVE') ||
                          engine.get('DUMP_COMPLETE');
        const doReset = noTruck && anyActive;
        if (doReset) {
            engine.set('DUMP_COMPLETE', false);
            engine.set('DUMP_ACTIVE', false);
            engine.set('DELAY_ACTIVE', false);
            engine.set('DUMPER_RUN', false);
            engine.set('GRAVEL_PCT', 0);
        }
        const log = [];
        if (doReset) {
            log.push({ type: 'action', message: 'Truck departed → system IDLE, ready for next truck' });
        }
        return {
            energized: doReset,
            conditionStates: [noTruck, anyActive],
            outputStates: [doReset],
            log
        };
    }
));

// ─── UI Update ───
function updateUI(engine) {
    const truck = engine.get('TRUCK_PRESENT');
    const delayActive = engine.get('DELAY_ACTIVE');
    const dumpActive = engine.get('DUMP_ACTIVE');
    const dumpComplete = engine.get('DUMP_COMPLETE');
    const dumperRun = engine.get('DUMPER_RUN');
    const alarm = engine.get('OVERDUMP_ALARM');
    const gravelPct = engine.get('GRAVEL_PCT');

    // Proximity sensor
    document.getElementById('prox-beam').className =
        'prox-beam' + (truck ? ' detected' : '');
    const proxBox = document.getElementById('prox-box');
    proxBox.className = 'equip-box' + (truck ? ' detected' : '');
    document.getElementById('prox-status').textContent = truck ? 'TRUCK HERE' : 'NO TRUCK';

    // Truck visual
    const truckEl = document.getElementById('truck');
    truckEl.className = 'truck' + (truck ? '' : ' absent');

    // Truck bed gravel fill
    document.getElementById('truck-gravel').style.height = gravelPct + '%';

    // Dumper
    const dumperBox = document.getElementById('dumper-box');
    dumperBox.className = 'equip-box' + (dumperRun ? ' running' : '');
    document.getElementById('dumper-status').textContent =
        dumperRun ? 'RUNNING' : (dumpComplete ? 'DONE' : 'IDLE');

    // Chute gravel stream
    const chute = document.getElementById('chute');
    chute.className = 'chute' + (dumperRun ? ' dumping' : '');

    // Hopper gravel (depletes as dump progresses)
    const hopperFill = dumperRun ? Math.max(20, 80 - gravelPct * 0.6) : 80;
    document.getElementById('gravel-fill').style.height = hopperFill + '%';

    // Alarm
    const alarmBox = document.getElementById('alarm-box');
    alarmBox.className = 'equip-box' + (alarm ? ' alarmed' : '');
    document.getElementById('alarm-status').textContent = alarm ? 'OVERDUMP' : 'OK';

    // Timer bars
    const dAcc = engine.get('T4_0_ACC');
    const dpAcc = engine.get('T4_1_ACC');
    const oAcc = engine.get('T4_2_ACC');

    document.getElementById('delay-bar').style.width = (dAcc / DELAY_PRE * 100) + '%';
    document.getElementById('delay-time').textContent = `${dAcc} / ${DELAY_PRE}s`;

    document.getElementById('dump-bar').style.width = (dpAcc / DUMP_PRE * 100) + '%';
    document.getElementById('dump-time').textContent = `${dpAcc} / ${DUMP_PRE}s`;

    document.getElementById('alarm-bar').style.width = (oAcc / OVERDUMP_PRE * 100) + '%';
    document.getElementById('alarm-time').textContent = `${oAcc} / ${OVERDUMP_PRE}s`;

    // State display
    const stateEl = document.getElementById('state-display');
    if (alarm) {
        stateEl.textContent = 'ALARM';
        stateEl.className = 'state-alarm';
    } else if (dumpComplete) {
        stateEl.textContent = 'DONE - WAITING';
        stateEl.className = 'state-done';
    } else if (dumperRun) {
        stateEl.textContent = 'DUMPING';
        stateEl.className = 'state-dumping';
    } else if (delayActive) {
        stateEl.textContent = 'DELAY (3s)';
        stateEl.className = 'state-delay';
    } else {
        stateEl.textContent = 'IDLE';
        stateEl.className = 'state-idle';
    }

    document.getElementById('truck-count').textContent = engine.get('TRUCK_COUNT');
    document.getElementById('scan-count').textContent = engine.scanCount;

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
    logDiv.innerHTML = html || '<div class="log-entry">Click "Truck Arrives" then RUN to start.</div>';
}

// ─── Controls ───
function truckArrive() {
    plc.set('TRUCK_PRESENT', true);
    plc.logEntries.unshift({
        scan: plc.scanCount,
        entries: [{ type: 'action', message: 'Truck arrived at dumper position' }]
    });
    plc.notifyListeners();
}

function truckLeave() {
    plc.set('TRUCK_PRESENT', false);
    plc.set('GRAVEL_PCT', 0);
    plc.logEntries.unshift({
        scan: plc.scanCount,
        entries: [{ type: 'action', message: 'Truck departing...' }]
    });
    plc.notifyListeners();
}

function resetAlarm() {
    plc.set('ALARM_RESET_PB', true);
    plc.scan();
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
