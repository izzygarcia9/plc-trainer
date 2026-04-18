/**
 * Editor PLC Engine — executes user-built ladder logic
 *
 * Tags are stored in a simple object: { name, type, value, prevValue }
 * Rungs are arrays of instruction objects: { type, tag, tag2, preset, ... }
 * Each scan evaluates all rungs top-to-bottom, left-to-right.
 */

const EditorPLC = {
    tags: {},
    rungs: [],    // [{conditions:[], outputs:[]}]
    scanCount: 0,
    running: false,
    interval: null,
    scanSpeed: 200,
    listeners: [],
    timerAccs: {},  // tag -> {acc, sub}

    defineTag(name, type, initial) {
        this.tags[name] = { name, type, value: initial, prevValue: initial };
    },

    getTag(name) {
        const t = this.tags[name];
        return t ? t.value : 0;
    },

    setTag(name, value) {
        if (this.tags[name]) {
            this.tags[name].value = value;
        }
    },

    deleteTag(name) {
        delete this.tags[name];
        delete this.timerAccs[name];
    },

    toggleTag(name) {
        const t = this.tags[name];
        if (t && t.type === 'BOOL') {
            t.value = !t.value;
            this.notify();
        }
    },

    scan() {
        this.scanCount++;
        // Snapshot prev values
        for (const k in this.tags) {
            this.tags[k].prevValue = this.tags[k].value;
        }

        // Evaluate each rung
        for (const rung of this.rungs) {
            this.evalRung(rung);
        }

        this.notify();
    },

    evalRung(rung) {
        // Evaluate conditions left-to-right (series AND)
        let power = true;
        for (const inst of rung.conditions) {
            power = power && this.evalCondition(inst);
        }
        rung.energized = power;

        // If power flows, execute outputs
        for (const inst of rung.outputs) {
            this.evalOutput(inst, power);
        }
    },

    evalCondition(inst) {
        const val = this.getTag(inst.tag);
        switch (inst.type) {
            case 'XIC': return !!val;                    // Examine if closed (NO)
            case 'XIO': return !val;                     // Examine if open (NC)
            case 'GRT': return this.getTag(inst.tag) > this.getTag(inst.tag2 || '__zero');
            case 'LES': return this.getTag(inst.tag) < this.getTag(inst.tag2 || '__zero');
            case 'EQU': return this.getTag(inst.tag) === this.getTag(inst.tag2 || '__zero');
            default: return true;
        }
    },

    evalOutput(inst, power) {
        switch (inst.type) {
            case 'OTE':  // Output energize — follows power
                this.setTag(inst.tag, power);
                break;
            case 'OTL':  // Output latch — sets on power, stays
                if (power) this.setTag(inst.tag, true);
                break;
            case 'OTU':  // Output unlatch — clears on power
                if (power) this.setTag(inst.tag, false);
                break;
            case 'TON':  // Timer on-delay
                this.evalTON(inst, power);
                break;
            case 'MOV':
                if (power) this.setTag(inst.tag, this.getTag(inst.tag2));
                break;
            case 'ADD':
                if (power) this.setTag(inst.tag, this.getTag(inst.tag2) + this.getTag(inst.tag3 || inst.tag2));
                break;
            case 'SUB':
                if (power) this.setTag(inst.tag, this.getTag(inst.tag2) - this.getTag(inst.tag3 || inst.tag2));
                break;
            case 'MUL':
                if (power) this.setTag(inst.tag, this.getTag(inst.tag2) * this.getTag(inst.tag3 || inst.tag2));
                break;
            case 'DIV':
                if (power) {
                    const d = this.getTag(inst.tag3 || inst.tag2);
                    this.setTag(inst.tag, d !== 0 ? Math.floor(this.getTag(inst.tag2) / d) : 0);
                }
                break;
        }
    },

    evalTON(inst, power) {
        const key = inst.id || inst.tag;
        if (!this.timerAccs[key]) this.timerAccs[key] = { acc: 0, sub: 0 };
        const t = this.timerAccs[key];
        const pre = inst.preset || 5;

        if (!power) {
            t.acc = 0; t.sub = 0;
            this.setTag(inst.tag + '_EN', false);
            this.setTag(inst.tag + '_TT', false);
            this.setTag(inst.tag + '_DN', false);
            this.setTag(inst.tag + '_ACC', 0);
            return;
        }

        this.setTag(inst.tag + '_EN', true);
        if (t.acc >= pre) {
            this.setTag(inst.tag + '_TT', false);
            this.setTag(inst.tag + '_DN', true);
            this.setTag(inst.tag + '_ACC', t.acc);
            return;
        }

        t.acc++;
        this.setTag(inst.tag + '_ACC', t.acc);
        const done = t.acc >= pre;
        this.setTag(inst.tag + '_TT', !done);
        this.setTag(inst.tag + '_DN', done);
    },

    onChange(cb) { this.listeners.push(cb); },
    notify() { for (const cb of this.listeners) cb(this); },

    reset() {
        this.scanCount = 0;
        this.timerAccs = {};
        for (const k in this.tags) {
            this.tags[k].value = this.tags[k].type === 'BOOL' ? false : 0;
            this.tags[k].prevValue = this.tags[k].value;
        }
        this.notify();
    }
};
