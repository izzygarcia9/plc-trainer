/**
 * PLC Engine - Simulates a PLC scan cycle with registers and ladder logic evaluation
 */
class PLCEngine {
    constructor() {
        // Data table: all PLC registers/tags
        this.registers = {};
        this.rungs = [];
        this.scanCount = 0;
        this.listeners = [];
        this.logEntries = [];
    }

    // Define a register/tag
    defineRegister(address, tag, type, initialValue, description) {
        this.registers[tag] = {
            address,
            tag,
            type,       // 'BOOL', 'INT', 'REAL'
            value: initialValue,
            prevValue: initialValue,
            description
        };
    }

    // Get register value by tag
    get(tag) {
        return this.registers[tag] ? this.registers[tag].value : undefined;
    }

    // Set register value by tag
    set(tag, value) {
        if (this.registers[tag]) {
            this.registers[tag].prevValue = this.registers[tag].value;
            this.registers[tag].value = value;
        }
    }

    // Add a rung to the program
    addRung(rung) {
        this.rungs.push(rung);
    }

    // Execute one full scan cycle
    scan() {
        this.scanCount++;
        const scanLog = [];

        // Snapshot previous values
        for (const tag in this.registers) {
            this.registers[tag].prevValue = this.registers[tag].value;
        }

        // Evaluate each rung
        for (const rung of this.rungs) {
            const result = rung.evaluate(this);
            if (result.log) {
                scanLog.push(...result.log);
            }
        }

        // Detect changes and log them
        for (const tag in this.registers) {
            const reg = this.registers[tag];
            if (reg.value !== reg.prevValue) {
                scanLog.push({
                    type: 'state-change',
                    message: `${tag}: ${reg.prevValue} → ${reg.value}`
                });
            }
        }

        if (scanLog.length > 0) {
            this.logEntries.unshift({
                scan: this.scanCount,
                entries: scanLog
            });
            // Keep only last 50 scan logs
            if (this.logEntries.length > 50) {
                this.logEntries.pop();
            }
        }

        // Notify listeners
        this.notifyListeners();
    }

    onChange(callback) {
        this.listeners.push(callback);
    }

    notifyListeners() {
        for (const cb of this.listeners) {
            cb(this);
        }
    }

    getAllRegisters() {
        return Object.values(this.registers);
    }
}

/**
 * Rung types for ladder logic
 */
class Rung {
    constructor(number, comment, conditions, outputs, evaluateFn) {
        this.number = number;
        this.comment = comment;
        this.conditions = conditions;  // Array of {type, tag, label}
        this.outputs = outputs;        // Array of {type, tag, label}
        this.evaluateFn = evaluateFn;
        this.energized = false;
        this.conditionStates = [];     // Track each condition's state
        this.outputStates = [];        // Track each output's state
    }

    evaluate(engine) {
        const result = this.evaluateFn(engine);
        this.energized = result.energized;
        this.conditionStates = result.conditionStates || [];
        this.outputStates = result.outputStates || [];
        return result;
    }
}
