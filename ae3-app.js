/**
 * AE-3: Material Age Clock — Tank A-15
 *
 * A15_CLK_STT: Start/Reset — resets clock to 0 and starts running
 * A15_CLK_STP: Stop/Hold — stops clock and holds current time
 *
 * Clock counts: A15_MIN (0-59), A15_HR (0-23), A15_DAY (0+)
 * Uses cascading TON timers: seconds → minutes → hours → days
 *
 * PLC approach:
 *   R0: Start/Stop latch (CLK_STT sets RUN, CLK_STP clears RUN)
 *   R1: CLK_STT resets all counters to 0
 *   R2: TON 60s timer → increment minutes
 *   R3: Minutes == 60 → reset minutes, increment hours
 *   R4: Hours == 24 → reset hours, increment days
 */

const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 1000;
let timeScale = 1;
let secSubCount = 0;

// ─── Registers ───
plc.defineRegister('I:0/0',  'A15_CLK_STT', 'BOOL', false, 'Clock start/reset (momentary)');
plc.defineRegister('I:0/1',  'A15_CLK_STP', 'BOOL', false, 'Clock stop/hold (momentary)');
plc.defineRegister('B3:0/0', 'CLK_RUN',     'BOOL', false, 'Clock running latch');
plc.defineRegister('N7:0',   'A15_SEC',     'INT',  0,     'Seconds counter (0-59)');
plc.defineRegister('N7:1',   'A15_MIN',     'INT',  0,     'Minutes (0-59)');
plc.defineRegister('N7:2',   'A15_HR',      'INT',  0,     'Hours (0-23)');
plc.defineRegister('N7:3',   'A15_DAY',     'INT',  0,     'Days');
plc.defineRegister('N7:4',   'TOTAL_SEC',   'INT',  0,     'Total elapsed seconds');

// ─── Rung 0: Start/Stop latch ───
plc.addRung(new Rung(0,
    'CLK_STT sets CLK_RUN, CLK_STP clears CLK_RUN',
    [
        { type: 'contact-no', tag: 'A15_CLK_STT', label: 'A15_CLK_STT' },
        { type: 'contact-no', tag: 'CLK_RUN', label: 'CLK_RUN (seal)' },
        { type: 'contact-nc', tag: 'A15_CLK_STP', label: 'CLK_STP (NC)' }
    ],
    [
        { type: 'coil-out', tag: 'CLK_RUN', label: 'CLK_RUN' }
    ],
    (engine) => {
        const stt = engine.get('A15_CLK_STT');
        const run = engine.get('CLK_RUN');
        const stp = engine.get('A15_CLK_STP');
        const latch = (stt || run) && !stp;
        engine.set('CLK_RUN', latch);
        if (stp) engine.set('A15_CLK_STP', false);
        const log = [];
        if (latch !== run) log.push({ type:'action', message: latch ? 'Clock STARTED' : 'Clock STOPPED' });
        return { energized:latch, conditionStates:[stt,run,!stp], outputStates:[latch], log };
    }
));

// ─── Rung 1: CLK_STT resets all counters ───
plc.addRung(new Rung(1,
    'CLK_STT (start) → reset all time registers to 0',
    [
        { type: 'contact-no', tag: 'A15_CLK_STT', label: 'A15_CLK_STT' }
    ],
    [
        { type: 'coil-out', tag: 'A15_SEC', label: 'RESET all to 0' }
    ],
    (engine) => {
        const stt = engine.get('A15_CLK_STT');
        if (stt) {
            engine.set('A15_SEC', 0);
            engine.set('A15_MIN', 0);
            engine.set('A15_HR', 0);
            engine.set('A15_DAY', 0);
            engine.set('TOTAL_SEC', 0);
            secSubCount = 0;
            engine.set('A15_CLK_STT', false);
        }
        return {
            energized: stt, conditionStates:[stt], outputStates:[stt],
            log: stt ? [{ type:'action', message:'Clock RESET to 00:00:00' }] : []
        };
    }
));

// ─── Rung 2: CLK_RUN → increment seconds (1 per timeScale scans) ───
plc.addRung(new Rung(2,
    'CLK_RUN → increment A15_SEC each second',
    [
        { type: 'contact-no', tag: 'CLK_RUN', label: 'CLK_RUN' }
    ],
    [
        { type: 'math-add', tag: 'A15_SEC', label: 'A15_SEC + 1' }
    ],
    (engine) => {
        const run = engine.get('CLK_RUN');
        let ticked = false;
        if (run) {
            secSubCount++;
            if (secSubCount >= timeScale) {
                engine.set('A15_SEC', engine.get('A15_SEC') + 1);
                engine.set('TOTAL_SEC', engine.get('TOTAL_SEC') + 1);
                secSubCount = 0;
                ticked = true;
            }
        }
        return { energized:run, conditionStates:[run], outputStates:[run], log:[] };
    }
));

// ─── Rung 3: A15_SEC >= 60 → reset seconds, increment minutes ───
plc.addRung(new Rung(3,
    'A15_SEC >= 60 → A15_SEC = 0, A15_MIN + 1',
    [
        { type: 'compare-gt', tag: 'A15_SEC', label: 'SEC >= 60', compareValue: '60' }
    ],
    [
        { type: 'math-add', tag: 'A15_MIN', label: 'MIN + 1, SEC = 0' }
    ],
    (engine) => {
        const sec = engine.get('A15_SEC');
        const fire = sec >= 60;
        if (fire) {
            engine.set('A15_SEC', 0);
            engine.set('A15_MIN', engine.get('A15_MIN') + 1);
        }
        return { energized:fire, conditionStates:[fire], outputStates:[fire], log:[] };
    }
));

// ─── Rung 4: A15_MIN >= 60 → reset minutes, increment hours ───
plc.addRung(new Rung(4,
    'A15_MIN >= 60 → A15_MIN = 0, A15_HR + 1',
    [
        { type: 'compare-gt', tag: 'A15_MIN', label: 'MIN >= 60', compareValue: '60' }
    ],
    [
        { type: 'math-add', tag: 'A15_HR', label: 'HR + 1, MIN = 0' }
    ],
    (engine) => {
        const min = engine.get('A15_MIN');
        const fire = min >= 60;
        if (fire) {
            engine.set('A15_MIN', 0);
            engine.set('A15_HR', engine.get('A15_HR') + 1);
        }
        return { energized:fire, conditionStates:[fire], outputStates:[fire], log:[] };
    }
));

// ─── Rung 5: A15_HR >= 24 → reset hours, increment days ───
plc.addRung(new Rung(5,
    'A15_HR >= 24 → A15_HR = 0, A15_DAY + 1',
    [
        { type: 'compare-gt', tag: 'A15_HR', label: 'HR >= 24', compareValue: '24' }
    ],
    [
        { type: 'math-add', tag: 'A15_DAY', label: 'DAY + 1, HR = 0' }
    ],
    (engine) => {
        const hr = engine.get('A15_HR');
        const fire = hr >= 24;
        if (fire) {
            engine.set('A15_HR', 0);
            engine.set('A15_DAY', engine.get('A15_DAY') + 1);
        }
        return {
            energized:fire, conditionStates:[fire], outputStates:[fire],
            log: fire ? [{ type:'state-change', message:`Day ${engine.get('A15_DAY')}` }] : []
        };
    }
));

// ─── UI ───
function updateUI(engine) {
    const days = engine.get('A15_DAY');
    const hrs = engine.get('A15_HR');
    const mins = engine.get('A15_MIN');
    const secs = engine.get('A15_SEC');
    const clkRun = engine.get('CLK_RUN');

    document.getElementById('days-val').textContent = String(days).padStart(3,'0');
    document.getElementById('hours-val').textContent = String(hrs).padStart(2,'0');
    document.getElementById('mins-val').textContent = String(mins).padStart(2,'0');

    const stateEl = document.getElementById('clock-state');
    stateEl.textContent = clkRun ? `RUNNING (${secs}s)` : 'STOPPED';
    stateEl.className = 'clock-state ' + (clkRun ? 'running' : 'stopped');

    // Tank fill based on age (visual only — fills over ~7 days worth)
    const totalSec = engine.get('TOTAL_SEC');
    const fillPct = Math.min(100, totalSec / (7*24*60) * 100);
    document.getElementById('tank-fill').style.height = fillPct + '%';

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
            tr.innerHTML = `<td>${reg.address}</td><td>${reg.tag}</td><td>${reg.type}</td><td class="value-cell"></td><td>${reg.description}</td>`;
            tbody.appendChild(tr);
        }
    }
    for (const reg of regs) {
        const tr = tbody.querySelector(`tr[data-tag="${reg.tag}"]`);
        if (!tr) continue;
        const td = tr.querySelector('.value-cell');
        tr.className = reg.value !== reg.prevValue ? 'changed' : '';
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
    for (const sl of engine.logEntries.slice(0, 25)) {
        for (const e of sl.entries) html += `<div class="log-entry ${e.type}">[Scan ${sl.scan}] ${e.message}</div>`;
    }
    logDiv.innerHTML = html || '<div class="log-entry">Press A15_CLK_STT to start the clock.</div>';
}

// ─── Controls ───
function pressClkStart() {
    plc.set('A15_CLK_STT', true);
    plc.set('A15_CLK_STP', false);
    plc.scan();
}
function pressClkStop() {
    plc.set('A15_CLK_STP', true);
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
function singleScan() { plc.scan(); }
function updateScanSpeed(val) {
    scanSpeed = parseInt(val);
    document.getElementById('scan-time').textContent = scanSpeed;
    if (running) { clearInterval(scanInterval); scanInterval = setInterval(() => plc.scan(), scanSpeed); }
}

// ─── Init ───
plc.onChange(updateUI);
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);
plc.scan();
