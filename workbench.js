/**
 * Workbench — connects the editor PLC engine to animated physical components.
 * Reads tag values each scan and updates the workbench visuals.
 */

// Override the default challenge init to load Level 1 tags
(function() {
    // Clear default init
    EditorPLC.tags = {};
    EditorPLC.rungs = [];
    EditorPLC.scanCount = 0;
    EditorPLC.timerAccs = {};

    // Level 1 tags: push button input + light output
    EditorPLC.defineTag('PB_INPUT', 'BOOL', false);
    EditorPLC.defineTag('LIGHT_OUT', 'BOOL', false);

    // Add one empty rung
    EditorPLC.rungs.push({ conditions: [], outputs: [], energized: false });

    // Track if user has successfully lit the bulb
    let successShown = false;

    // Workbench update — runs every scan
    EditorPLC.onChange((plc) => {
        const pbInput = plc.getTag('PB_INPUT');
        const lightOut = plc.getTag('LIGHT_OUT');
        const isRunning = plc.running;

        // Push button visual
        const btn = document.getElementById('wb-button');
        if (btn) btn.className = 'wb-pushbutton' + (pbInput ? ' pressed' : '');

        // Light bulb visual
        const bulb = document.getElementById('wb-bulb');
        if (bulb) bulb.className = 'wb-bulb' + (lightOut ? ' on' : '');

        // PLC run LED
        const plcLed = document.getElementById('wb-plc-run');
        if (plcLed) plcLed.className = 'wb-plc-led' + (isRunning ? ' on' : '');

        // Wires
        const wireIn = document.getElementById('wb-wire-in');
        if (wireIn) wireIn.className = 'wb-wire' + (pbInput ? ' live' : '');
        const wireOut = document.getElementById('wb-wire-out');
        if (wireOut) wireOut.className = 'wb-wire' + (lightOut ? ' live' : '');

        // Status values
        const pbVal = document.getElementById('wb-pb-val');
        if (pbVal) { pbVal.textContent = pbInput ? 'ON' : 'OFF'; pbVal.className = 'wb-status-val ' + (pbInput ? 'on' : 'off'); }
        const lightVal = document.getElementById('wb-light-val');
        if (lightVal) { lightVal.textContent = lightOut ? 'ON' : 'OFF'; lightVal.className = 'wb-status-val ' + (lightOut ? 'on' : 'off'); }

        // Success detection — if light turns on while button is pressed, they did it!
        if (lightOut && pbInput && !successShown) {
            successShown = true;
            const successEl = document.getElementById('wb-success');
            if (successEl) successEl.classList.remove('hidden');
        }

        // Update the standard editor panels
        renderTagPanel();
        renderRungs();
        renderIOPanel();
        document.getElementById('scan-num').textContent = plc.scanCount;
    });

    // Initial render
    renderAll();
})();

// Workbench button handlers
function pressButton() {
    EditorPLC.setTag('PB_INPUT', true);
    EditorPLC.notify();
}

function releaseButton() {
    EditorPLC.setTag('PB_INPUT', false);
    EditorPLC.notify();
}
