/**
 * SAE-2: Motor CW/CCW Toggle with Cycle Limit
 *
 * First press → CW. Second press → CCW. Alternates.
 * Each CW+CCW pair = 1 cycle. After N cycles, start button disabled until reset.
 *
 * R0: START OSR (one-shot)
 * R1: OSR AND NOT LOCKED → toggle DIR
 * R2: DIR snap for toggle (same pattern as one-shot bulb)
 * R3: Toggle: OSR + DIR_SNAP=CW → switch to CCW, increment half-cycle
 * R4: Toggle: OSR + DIR_SNAP=CCW → switch to CW, increment half-cycle
 * R5: HALF_CYCLES >= N*2 → LOCKED
 * R6: RESET → clear all
 * R7: DIR → MOTOR_CW / MOTOR_CCW outputs
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start toggle (momentary)');
plc.defineRegister('I:0/1','RESET_PB','BOOL',false,'Reset (momentary)');
plc.defineRegister('B3:0/0','PB_PREV','BOOL',false,'PB prev scan');
plc.defineRegister('B3:0/1','PB_OSR','BOOL',false,'PB one-shot');
plc.defineRegister('B3:0/2','DIR_CW','BOOL',true,'Direction: true=CW');
plc.defineRegister('B3:0/3','DIR_SNAP','BOOL',true,'Direction snapshot');
plc.defineRegister('B3:0/4','MOTOR_RUNNING','BOOL',false,'Motor is running');
plc.defineRegister('B3:0/5','LOCKED','BOOL',false,'Cycle limit reached');
plc.defineRegister('O:0/0','MOTOR_CW','BOOL',false,'Motor CW output');
plc.defineRegister('O:0/1','MOTOR_CCW','BOOL',false,'Motor CCW output');
plc.defineRegister('N7:0','HALF_CYCLES','INT',0,'Half-cycle count (CW+CCW=2)');
plc.defineRegister('N7:1','CYCLE_CNT','INT',0,'Full cycles (half/2)');
plc.defineRegister('N7:2','N_LIMIT','INT',3,'Cycle limit');

// R0: OSR
plc.addRung(new Rung(0,'START OSR: START AND NOT PREV → PB_OSR',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-nc',tag:'PB_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'PB_OSR',label:'PB_OSR'}],
    (e)=>{const s=e.get('START_PB'),p=e.get('PB_PREV');const osr=s&&!p;e.set('PB_OSR',osr);
    e.set('PB_PREV',s);e.set('START_PB',false);
    return{energized:osr,conditionStates:[s,!p],outputStates:[osr],log:[]};}
));

// R1: Snapshot direction before toggle
plc.addRung(new Rung(1,'Snapshot DIR_CW → DIR_SNAP',
    [{type:'contact-no',tag:'DIR_CW',label:'DIR_CW'}],
    [{type:'coil-out',tag:'DIR_SNAP',label:'DIR_SNAP'}],
    (e)=>{e.set('DIR_SNAP',e.get('DIR_CW'));
    return{energized:e.get('DIR_CW'),conditionStates:[e.get('DIR_CW')],outputStates:[e.get('DIR_CW')],log:[]};}
));

// R2: OSR + NOT LOCKED + was CW → switch to CCW, count
plc.addRung(new Rung(2,'OSR AND DIR_SNAP(CW) AND NOT LOCKED → CCW, half++',
    [{type:'contact-no',tag:'PB_OSR',label:'OSR'},{type:'contact-no',tag:'DIR_SNAP',label:'DIR_SNAP(CW)'},{type:'contact-nc',tag:'LOCKED',label:'LOCKED (NC)'}],
    [{type:'coil-out',tag:'DIR_CW',label:'SET CCW'}],
    (e)=>{const osr=e.get('PB_OSR'),snap=e.get('DIR_SNAP'),locked=e.get('LOCKED');
    const fire=osr&&snap&&!locked;
    if(fire){e.set('DIR_CW',false);e.set('MOTOR_RUNNING',true);e.set('HALF_CYCLES',e.get('HALF_CYCLES')+1);}
    return{energized:fire,conditionStates:[osr,snap,!locked],outputStates:[fire],
    log:fire?[{type:'action',message:'Toggled → CCW'}]:[]};}
));

// R3: OSR + NOT LOCKED + was CCW → switch to CW, count
plc.addRung(new Rung(3,'OSR AND NOT DIR_SNAP(CCW) AND NOT LOCKED → CW, half++',
    [{type:'contact-no',tag:'PB_OSR',label:'OSR'},{type:'contact-nc',tag:'DIR_SNAP',label:'DIR_SNAP(CCW)'},{type:'contact-nc',tag:'LOCKED',label:'LOCKED (NC)'}],
    [{type:'coil-out',tag:'DIR_CW',label:'SET CW'}],
    (e)=>{const osr=e.get('PB_OSR'),snap=e.get('DIR_SNAP'),locked=e.get('LOCKED');
    const fire=osr&&!snap&&!locked;
    if(fire){e.set('DIR_CW',true);e.set('MOTOR_RUNNING',true);e.set('HALF_CYCLES',e.get('HALF_CYCLES')+1);}
    return{energized:fire,conditionStates:[osr,!snap,!locked],outputStates:[fire],
    log:fire?[{type:'action',message:'Toggled → CW'}]:[]};}
));

// R4: Calculate full cycles = half / 2
plc.addRung(new Rung(4,'CYCLE_CNT = HALF_CYCLES / 2',
    [{type:'compare-gt',tag:'HALF_CYCLES',label:'always',compareValue:'0'}],
    [{type:'math-add',tag:'CYCLE_CNT',label:'HALF / 2'}],
    (e)=>{e.set('CYCLE_CNT',Math.floor(e.get('HALF_CYCLES')/2));
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

// R5: CYCLE_CNT >= N_LIMIT → LOCKED
plc.addRung(new Rung(5,'CYCLE_CNT >= N_LIMIT → LOCKED',
    [{type:'compare-gt',tag:'CYCLE_CNT',label:'CNT >= N',compareValue:'N_LIMIT'}],
    [{type:'coil-out',tag:'LOCKED',label:'LOCKED'}],
    (e)=>{const locked=e.get('CYCLE_CNT')>=e.get('N_LIMIT');e.set('LOCKED',locked);
    if(locked){e.set('MOTOR_RUNNING',false);e.set('MOTOR_CW',false);e.set('MOTOR_CCW',false);}
    const log=[];if(locked&&!e.registers['LOCKED'].prevValue)log.push({type:'action',message:`LOCKED — ${e.get('N_LIMIT')} cycles reached. Press RESET.`});
    return{energized:locked,conditionStates:[locked],outputStates:[locked],log};}
));

// R6: Motor outputs
plc.addRung(new Rung(6,'MOTOR_RUNNING AND NOT LOCKED → CW or CCW output',
    [{type:'contact-no',tag:'MOTOR_RUNNING',label:'RUNNING'},{type:'contact-nc',tag:'LOCKED',label:'LOCKED (NC)'}],
    [{type:'coil-out',tag:'MOTOR_CW',label:'CW/CCW outputs'}],
    (e)=>{const run=e.get('MOTOR_RUNNING'),locked=e.get('LOCKED'),dir=e.get('DIR_CW');
    const on=run&&!locked;e.set('MOTOR_CW',on&&dir);e.set('MOTOR_CCW',on&&!dir);
    return{energized:on,conditionStates:[run,!locked],outputStates:[on],log:[]};}
));

// R7: RESET
plc.addRung(new Rung(7,'RESET → clear all',
    [{type:'contact-no',tag:'RESET_PB',label:'RESET'}],
    [{type:'coil-out',tag:'LOCKED',label:'RESET all'}],
    (e)=>{const r=e.get('RESET_PB');if(r){e.set('LOCKED',false);e.set('HALF_CYCLES',0);e.set('CYCLE_CNT',0);e.set('MOTOR_RUNNING',false);e.set('MOTOR_CW',false);e.set('MOTOR_CCW',false);e.set('DIR_CW',true);e.set('RESET_PB',false);}
    return{energized:r,conditionStates:[r],outputStates:[r],log:r?[{type:'action',message:'RESET — unlocked, counter cleared'}]:[]};}
));

function updateUI(e){
    const cw=e.get('MOTOR_CW'),ccw=e.get('MOTOR_CCW'),locked=e.get('LOCKED');
    const mc=document.getElementById('motor-circle');
    mc.className='motor-circle'+(cw?' cw':ccw?' ccw':locked?' locked':'');
    const arrow=document.getElementById('motor-arrow');
    arrow.textContent=cw?'\u21BB':ccw?'\u21BA':'\u25CF';
    const ms=document.getElementById('motor-state');
    if(locked){ms.textContent='LOCKED';ms.className='motor-state locked';}
    else if(cw){ms.textContent='RUNNING CW';ms.className='motor-state cw';}
    else if(ccw){ms.textContent='RUNNING CCW';ms.className='motor-state ccw';}
    else{ms.textContent='STOPPED';ms.className='motor-state';}
    document.getElementById('cw-box').className='equip-box'+(cw?' active':'');document.getElementById('cw-status').textContent=cw?'ON':'OFF';
    document.getElementById('ccw-box').className='equip-box'+(ccw?' active':'');document.getElementById('ccw-status').textContent=ccw?'ON':'OFF';
    document.getElementById('cycle-val').textContent=e.get('CYCLE_CNT');
    document.getElementById('cycle-max').textContent=e.get('N_LIMIT');
    document.getElementById('locked-badge').className='locked-badge'+(locked?'':' hidden');
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START to toggle direction.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressReset(){plc.set('RESET_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
