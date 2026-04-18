/**
 * HVAC Scenario - PLC Trainer Application
 */

// Initialize engine and renderer
const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false;
let scanInterval = null;
let scanSpeed = 500;

// ─── Define Registers (Data Table) ───
plc.defineRegister('N7:0',  'ROOM_TEMP',     'INT',  72,    'Current room temperature (°F)');
plc.defineRegister('N7:1',  'SETPOINT',      'INT',  75,    'Temperature setpoint (°F)');
plc.defineRegister('N7:2',  'DEADBAND',      'INT',  2,     'Deadband range (±°F)');
plc.defineRegister('B3:0/0','HEATER_CMD',    'BOOL', false, 'Heater output command');
plc.defineRegister('B3:0/1','AC_CMD',        'BOOL', false, 'A/C output command');
plc.defineRegister('B3:0/2','TEMP_BELOW_LO', 'BOOL', false, 'Temp below low limit');
plc.defineRegister('B3:0/3','TEMP_ABOVE_HI', 'BOOL', false, 'Temp above high limit');
plc.defineRegister('B3:0/4','SYSTEM_ON',     'BOOL', true,  'System enable');
plc.defineRegister('N7:3',  'LOW_LIMIT',     'INT',  73,    'Low limit (setpoint - deadband)');
plc.defineRegister('N7:4',  'HIGH_LIMIT',    'INT',  77,    'High limit (setpoint + deadband)');

// ─── Define Ladder Logic Rungs ───

// Rung 0: Calculate limits from setpoint and deadband
plc.addRung(new Rung(0,
    'Calculate low/high limits from setpoint ± deadband',
    [
        { type: 'contact-no', tag: 'SYSTEM_ON', label: 'SYSTEM_ON' }
    ],
    [
        { type: 'math-sub', tag: 'LOW_LIMIT', label: 'LOW = SP - DB' },
        { type: 'math-add', tag: 'HIGH_LIMIT', label: 'HIGH = SP + DB' }
    ],
    (engine) => {
        const sysOn = engine.get('SYSTEM_ON');
        if (sysOn) {
            const sp = engine.get('SETPOINT');
            const db = engine.get('DEADBAND');
            engine.set('LOW_LIMIT', sp - db);
            engine.set('HIGH_LIMIT', sp + db);
        }
        return {
            energized: sysOn,
            conditionStates: [sysOn],
            outputStates: [sysOn, sysOn],
            log: []
        };
    }
));

// Rung 1: Compare - is temp below low limit?
plc.addRung(new Rung(1,
    'If room temp < low limit → TEMP_BELOW_LO = true',
    [
        { type: 'compare-lt', tag: 'ROOM_TEMP', label: 'ROOM_TEMP', compareValue: 'LOW_LIMIT' }
    ],
    [
        { type: 'coil-out', tag: 'TEMP_BELOW_LO', label: 'TEMP_BELOW_LO' }
    ],
    (engine) => {
        const temp = engine.get('ROOM_TEMP');
        const low = engine.get('LOW_LIMIT');
        const below = temp < low;
        engine.set('TEMP_BELOW_LO', below);
        return {
            energized: below,
            conditionStates: [below],
            outputStates: [below],
            log: []
        };
    }
));

// Rung 2: Compare - is temp above high limit?
plc.addRung(new Rung(2,
    'If room temp > high limit → TEMP_ABOVE_HI = true',
    [
        { type: 'compare-gt', tag: 'ROOM_TEMP', label: 'ROOM_TEMP', compareValue: 'HIGH_LIMIT' }
    ],
    [
        { type: 'coil-out', tag: 'TEMP_ABOVE_HI', label: 'TEMP_ABOVE_HI' }
    ],
    (engine) => {
        const temp = engine.get('ROOM_TEMP');
        const high = engine.get('HIGH_LIMIT');
        const above = temp > high;
        engine.set('TEMP_ABOVE_HI', above);
        return {
            energized: above,
            conditionStates: [above],
            outputStates: [above],
            log: []
        };
    }
));

// Rung 3: Heater ON when temp below low AND system on
plc.addRung(new Rung(3,
    'System ON + Temp below low limit → HEATER ON',
    [
        { type: 'contact-no', tag: 'SYSTEM_ON', label: 'SYSTEM_ON' },
        { type: 'contact-no', tag: 'TEMP_BELOW_LO', label: 'TEMP_BELOW_LO' }
    ],
    [
        { type: 'coil-out', tag: 'HEATER_CMD', label: 'HEATER_CMD' }
    ],
    (engine) => {
        const sysOn = engine.get('SYSTEM_ON');
        const below = engine.get('TEMP_BELOW_LO');
        const heaterOn = sysOn && below;
        engine.set('HEATER_CMD', heaterOn);
        const log = [];
        if (heaterOn !== engine.registers['HEATER_CMD'].prevValue) {
            log.push({ type: 'action', message: `HEATER ${heaterOn ? 'ON 🔥' : 'OFF'}` });
        }
        return {
            energized: heaterOn,
            conditionStates: [sysOn, below],
            outputStates: [heaterOn],
            log
        };
    }
));

// Rung 4: AC ON when temp above high AND system on
plc.addRung(new Rung(4,
    'System ON + Temp above high limit → A/C ON',
    [
        { type: 'contact-no', tag: 'SYSTEM_ON', label: 'SYSTEM_ON' },
        { type: 'contact-no', tag: 'TEMP_ABOVE_HI', label: 'TEMP_ABOVE_HI' }
    ],
    [
        { type: 'coil-out', tag: 'AC_CMD', label: 'AC_CMD' }
    ],
    (engine) => {
        const sysOn = engine.get('SYSTEM_ON');
        const above = engine.get('TEMP_ABOVE_HI');
        const acOn = sysOn && above;
        engine.set('AC_CMD', acOn);
        const log = [];
        if (acOn !== engine.registers['AC_CMD'].prevValue) {
            log.push({ type: 'action', message: `A/C ${acOn ? 'ON ❄️' : 'OFF'}` });
        }
        return {
            energized: acOn,
            conditionStates: [sysOn, above],
            outputStates: [acOn],
            log
        };
    }
));

// Rung 5: Simulate temp change - heater adds 1°F per scan
plc.addRung(new Rung(5,
    'Heater ON → Room temp +1 each scan (simulated heat)',
    [
        { type: 'contact-no', tag: 'HEATER_CMD', label: 'HEATER_CMD' }
    ],
    [
        { type: 'math-add', tag: 'ROOM_TEMP', label: 'TEMP + 1' }
    ],
    (engine) => {
        const heaterOn = engine.get('HEATER_CMD');
        if (heaterOn) {
            engine.set('ROOM_TEMP', engine.get('ROOM_TEMP') + 1);
        }
        return {
            energized: heaterOn,
            conditionStates: [heaterOn],
            outputStates: [heaterOn],
            log: heaterOn ? [{ type: 'action', message: `Heating: temp → ${engine.get('ROOM_TEMP')}°F` }] : []
        };
    }
));

// Rung 6: Simulate temp change - AC subtracts 1°F per scan
plc.addRung(new Rung(6,
    'A/C ON → Room temp -1 each scan (simulated cooling)',
    [
        { type: 'contact-no', tag: 'AC_CMD', label: 'AC_CMD' }
    ],
    [
        { type: 'math-sub', tag: 'ROOM_TEMP', label: 'TEMP - 1' }
    ],
    (engine) => {
        const acOn = engine.get('AC_CMD');
        if (acOn) {
            engine.set('ROOM_TEMP', engine.get('ROOM_TEMP') - 1);
        }
        return {
            energized: acOn,
            conditionStates: [acOn],
            outputStates: [acOn],
            log: acOn ? [{ type: 'action', message: `Cooling: temp → ${engine.get('ROOM_TEMP')}°F` }] : []
        };
    }
));

// ─── UI Update Functions ───

function updateUI(engine) {
    const temp = engine.get('ROOM_TEMP');
    const heater = engine.get('HEATER_CMD');
    const ac = engine.get('AC_CMD');

    // Thermostat
    document.getElementById('thermo-temp').textContent = temp;
    document.getElementById('setpoint-display').textContent = engine.get('SETPOINT');

    const ring = document.getElementById('thermo-ring');
    ring.className = 'thermo-ring ' + (heater ? 'heating' : ac ? 'cooling' : 'idle');

    // Color the temp display
    const tempEl = document.getElementById('thermo-temp');
    if (heater) tempEl.style.color = '#ff6b35';
    else if (ac) tempEl.style.color = '#00b4d8';
    else tempEl.style.color = '#e0e0e0';

    // Equipment
    const heaterBox = document.getElementById('heater-visual');
    const acBox = document.getElementById('ac-visual');
    heaterBox.className = 'equip-box' + (heater ? ' active' : '');
    acBox.className = 'equip-box' + (ac ? ' active' : '');
    document.getElementById('heater-status').textContent = heater ? 'ON' : 'OFF';
    document.getElementById('ac-status').textContent = ac ? 'ON' : 'OFF';

    // Scan count
    document.getElementById('scan-count').textContent = engine.scanCount;

    // Update ladder diagram
    ladder.update(engine.rungs);

    // Update register table
    updateRegisterTable(engine);

    // Update scan log
    updateScanLog(engine);
}

function updateRegisterTable(engine) {
    const tbody = document.getElementById('register-body');
    const regs = engine.getAllRegisters();

    if (tbody.children.length === 0) {
        // Initial render
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

    // Update values
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
    for (const scanLog of engine.logEntries.slice(0, 20)) {
        for (const entry of scanLog.entries) {
            html += `<div class="log-entry ${entry.type}">[Scan ${scanLog.scan}] ${entry.message}</div>`;
        }
    }
    logDiv.innerHTML = html || '<div class="log-entry">No activity yet. Press RUN or Single Scan.</div>';
}

// ─── Control Functions ───

function toggleRun() {
    running = !running;
    const btn = document.getElementById('run-btn');
    if (running) {
        btn.textContent = '⏸ STOP';
        btn.classList.add('running');
        scanInterval = setInterval(() => plc.scan(), scanSpeed);
    } else {
        btn.textContent = '▶ RUN';
        btn.classList.remove('running');
        clearInterval(scanInterval);
    }
}

function singleScan() {
    plc.scan();
}

function applyTemp() {
    const input = document.getElementById('room-temp-input');
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 30 && val <= 120) {
        plc.set('ROOM_TEMP', val);
        plc.notifyListeners();
        addManualLog(`Manual temp set: ${val}°F`);
    }
}

function adjustTemp(delta) {
    const input = document.getElementById('room-temp-input');
    let val = parseInt(input.value, 10) + delta;
    val = Math.max(30, Math.min(120, val));
    input.value = val;
    plc.set('ROOM_TEMP', val);
    plc.notifyListeners();
    addManualLog(`Manual temp adjust: ${delta > 0 ? '+' : ''}${delta} → ${val}°F`);
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

// Initial render of ladder
ladder.render(plc.rungs);
updateRegisterTable(plc);
updateScanLog(plc);

// Run one scan to set initial state
plc.scan();
