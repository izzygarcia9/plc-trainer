/**
 * Ladder Logic Renderer - Draws ladder diagrams in the DOM
 */
class LadderRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
    }

    render(rungs) {
        this.container.innerHTML = '';
        for (const rung of rungs) {
            this.container.appendChild(this.createRungElement(rung));
        }
    }

    update(rungs) {
        const rungElements = this.container.querySelectorAll('.rung');
        rungs.forEach((rung, i) => {
            if (rungElements[i]) {
                this.updateRungElement(rungElements[i], rung);
            }
        });
    }

    createRungElement(rung) {
        const div = document.createElement('div');
        div.className = 'rung' + (rung.energized ? ' energized' : '');
        div.dataset.rungNum = rung.number;

        // Rung number
        const numSpan = document.createElement('span');
        numSpan.className = 'rung-number';
        numSpan.textContent = `R${rung.number}`;
        div.appendChild(numSpan);

        // Comment
        if (rung.comment) {
            const comment = document.createElement('div');
            comment.className = 'rung-comment';
            comment.textContent = `// ${rung.comment}`;
            div.appendChild(comment);
        }

        // Visual ladder diagram
        const visual = document.createElement('div');
        visual.className = 'ladder-rung-visual';

        // Left rail
        const leftRail = document.createElement('div');
        leftRail.className = 'rail' + (rung.energized ? ' energized' : '');
        visual.appendChild(leftRail);

        // Wire before conditions
        visual.appendChild(this.createWire(true));

        // Conditions
        rung.conditions.forEach((cond, idx) => {
            const el = this.createLadderElement(cond, rung.conditionStates[idx]);
            visual.appendChild(el);
            visual.appendChild(this.createWire(
                rung.conditionStates[idx] !== false && rung.energized
            ));
        });

        // Spacer wire pushes outputs to the right
        const spacer = this.createWire(rung.energized);
        spacer.style.flex = '1';
        spacer.style.minWidth = '20px';
        visual.appendChild(spacer);

        // Outputs (right side of rung)
        rung.outputs.forEach((out, idx) => {
            const el = this.createLadderElement(out, rung.outputStates[idx]);
            visual.appendChild(el);
        });

        // Wire after outputs
        visual.appendChild(this.createWire(rung.energized));

        // Right rail
        const rightRail = document.createElement('div');
        rightRail.className = 'rail' + (rung.energized ? ' energized' : '');
        visual.appendChild(rightRail);

        div.appendChild(visual);
        return div;
    }

    updateRungElement(el, rung) {
        el.className = 'rung' + (rung.energized ? ' energized' : '');

        // Update rails
        const rails = el.querySelectorAll('.rail');
        rails.forEach(r => {
            r.className = 'rail' + (rung.energized ? ' energized' : '');
        });

        // Update wires
        const wires = el.querySelectorAll('.wire');
        // First wire is always energized if rung starts
        if (wires[0]) wires[0].className = 'wire' + (rung.energized ? ' energized' : '');

        // Update elements
        const elements = el.querySelectorAll('.ladder-element');
        let elemIdx = 0;

        rung.conditions.forEach((cond, idx) => {
            if (elements[elemIdx]) {
                const isOn = rung.conditionStates[idx];
                elements[elemIdx].className = this.getElementClass(cond, isOn);
                // Update wire after this condition
                const wireIdx = idx + 1;
                if (wires[wireIdx]) {
                    wires[wireIdx].className = 'wire' + (isOn && rung.energized ? ' energized' : '');
                }
            }
            elemIdx++;
        });

        rung.outputs.forEach((out, idx) => {
            if (elements[elemIdx]) {
                const isOn = rung.outputStates[idx];
                elements[elemIdx].className = this.getElementClass(out, isOn);
            }
            elemIdx++;
        });

        // Last wire
        const lastWire = wires[wires.length - 1];
        if (lastWire) {
            lastWire.className = 'wire' + (rung.energized ? ' energized' : '');
        }
    }

    createWire(energized) {
        const wire = document.createElement('div');
        wire.className = 'wire' + (energized ? ' energized' : '');
        return wire;
    }

    createLadderElement(config, isOn) {
        const el = document.createElement('div');
        el.className = this.getElementClass(config, isOn);

        const symbol = document.createElement('div');
        symbol.className = 'elem-symbol';
        symbol.textContent = this.getSymbol(config, isOn);

        const tag = document.createElement('div');
        tag.className = 'elem-tag';
        tag.textContent = config.label || config.tag;

        el.appendChild(symbol);
        el.appendChild(tag);
        return el;
    }

    getElementClass(config, isOn) {
        let cls = 'ladder-element ' + config.type;
        if (isOn) cls += ' energized';
        return cls;
    }

    getSymbol(config, isOn) {
        switch (config.type) {
            case 'contact-no':  return isOn ? '─┤/├─' : '─┤ ├─';
            case 'contact-nc':  return isOn ? '─┤\\├─' : '─┤/├─';
            case 'compare-lt':  return `< ${config.compareValue || ''}`;
            case 'compare-gt':  return `> ${config.compareValue || ''}`;
            case 'compare-eq':  return `= ${config.compareValue || ''}`;
            case 'coil-out':    return isOn ? '─( )─' : '─(/)─';
            case 'math-add':    return 'ADD';
            case 'math-sub':    return 'SUB';
            default:            return config.type;
        }
    }
}
