/**
 * SAE-9: Pump-Out Control with Float Monitoring
 * System Start toggle activates system. Pump starts when BOTH floats active.
 * Pump continues when HI drops. Stops only when LO drops. Restarts on next both-active.
 * Stop button deactivates everything.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','SYS_START','BOOL',false,'System Start toggle');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop button');
plc.defineRegister('I:0/2','HI_FLOAT','BOOL',false,'High-level float (true=active/water present)');
plc.defineRegister('I:0/3','LO_FLOAT','BOOL',false,'Low-level float (true=active/water present)');
plc.defineRegister('B3:0/0','SYS_ACTIVE','BOOL',false,'System active latch');
plc.defineRegister('B3:0/1','PUMP_LATCH','BOOL',false,'Pump running latch');
plc.defineRegister('O:0/0','PUMP_OUT','BOOL',false,'Pump output');
plc.defineRegister('O:0/1','SYS_LIGHT','BOOL',false,'System Active pilot light');
plc.defineRegister('N7:0','PUMP_CYCLES','INT',0,'Pump on/off cycles');
plc.defineRegister('N7:1','WATER_LEVEL','INT',0,'Simulated water level (0-100)');

// R0: System active latch
plc.addRung(new Rung(0,'(SYS_START OR SYS_ACTIVE) AND NOT STOP → SYS_ACTIVE',
    [{type:'contact-no',tag:'SYS_START',label:'SYS_START'},{type:'contact-no',tag:'SYS_ACTIVE',label:'SYS_ACTIVE'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'}],
    [{type:'coil-out',tag:'SYS_ACTIVE',label:'SYS_ACTIVE'}],
    (e)=>{const s=e.get('SYS_START'),a=e.get('SYS_ACTIVE'),st=e.get('STOP_PB');
    const on=(s||a)&&!st;e.set('SYS_ACTIVE',on);e.set('SYS_LIGHT',on);
    if(st){e.set('STOP_PB',false);e.set('PUMP_LATCH',false);e.set('PUMP_OUT',false);}
    const log=[];if(on&&!a)log.push({type:'action',message:'System ACTIVATED'});if(!on&&a)log.push({type:'action',message:'System DEACTIVATED'});
    return{energized:on,conditionStates:[s,a,!st],outputStates:[on],log};}
));

// R1: Pump starts when BOTH floats active (seal-in with LO float)
// (HI AND LO) OR (PUMP_LATCH AND LO) → PUMP_LATCH
plc.addRung(new Rung(1,'(HI+LO OR PUMP_LATCH+LO) AND SYS_ACTIVE → PUMP_LATCH',
    [{type:'contact-no',tag:'HI_FLOAT',label:'HI_FLOAT'},{type:'contact-no',tag:'LO_FLOAT',label:'LO_FLOAT'},{type:'contact-no',tag:'PUMP_LATCH',label:'PUMP (seal)'},{type:'contact-no',tag:'SYS_ACTIVE',label:'SYS_ACTIVE'}],
    [{type:'coil-out',tag:'PUMP_LATCH',label:'PUMP_LATCH'}],
    (e)=>{const hi=e.get('HI_FLOAT'),lo=e.get('LO_FLOAT'),pl=e.get('PUMP_LATCH'),sa=e.get('SYS_ACTIVE');
    // Start: both floats. Continue: pump latched + LO still active. Stop: LO drops.
    const on=((hi&&lo)||(pl&&lo))&&sa;e.set('PUMP_LATCH',on);
    const log=[];
    if(on&&!pl)log.push({type:'action',message:'PUMP STARTED (both floats active)'});
    if(!on&&pl){log.push({type:'action',message:'PUMP STOPPED (LO float inactive)'});e.set('PUMP_CYCLES',e.get('PUMP_CYCLES')+1);}
    return{energized:on,conditionStates:[hi,lo,pl,sa],outputStates:[on],log};}
));

// R2: Pump output
plc.addRung(new Rung(2,'PUMP_LATCH → PUMP_OUT',
    [{type:'contact-no',tag:'PUMP_LATCH',label:'PUMP_LATCH'}],
    [{type:'coil-out',tag:'PUMP_OUT',label:'PUMP_OUT'}],
    (e)=>{const on=e.get('PUMP_LATCH');e.set('PUMP_OUT',on);
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// R3: Simulate water level (pump drains, auto-fills slowly)
plc.addRung(new Rung(3,'Simulate: pump drains -2, auto-fill +1 when sys active',
    [{type:'contact-no',tag:'SYS_ACTIVE',label:'SYS_ACTIVE'}],
    [{type:'math-sub',tag:'WATER_LEVEL',label:'SIM level'}],
    (e)=>{let lv=e.get('WATER_LEVEL');
    if(e.get('PUMP_OUT'))lv=Math.max(0,lv-2);
    else if(e.get('SYS_ACTIVE'))lv=Math.min(100,lv+1);
    e.set('WATER_LEVEL',lv);
    // Update floats from level
    e.set('LO_FLOAT',lv>15);e.set('HI_FLOAT',lv>70);
    return{energized:e.get('SYS_ACTIVE'),conditionStates:[e.get('SYS_ACTIVE')],outputStates:[true],log:[]};}
));

function updateUI(e){
    const sa=e.get('SYS_ACTIVE'),pump=e.get('PUMP_OUT'),hi=e.get('HI_FLOAT'),lo=e.get('LO_FLOAT'),lv=e.get('WATER_LEVEL');
    document.getElementById('pump-water').style.height=lv+'%';
    document.getElementById('hi-float').className='float-mark hi-float'+(hi?' active':'');
    document.getElementById('lo-float').className='float-mark lo-float'+(lo?' active':'');
    document.getElementById('pump-icon').className='pump-icon'+(pump?' on':'');
    document.getElementById('sys-box').className='equip-box'+(sa?' on':'');document.getElementById('sys-status').textContent=sa?'ACTIVE':'OFF';
    document.getElementById('pump-box').className='equip-box'+(pump?' on':'');document.getElementById('pump-status').textContent=pump?'RUNNING':'OFF';
    document.getElementById('hi-box').className='equip-box'+(hi?' on':'');document.getElementById('hi-status').textContent=hi?'ACTIVE':'OFF';
    document.getElementById('lo-box').className='equip-box'+(lo?' on':'');document.getElementById('lo-status').textContent=lo?'ACTIVE':'OFF';
    const st=document.getElementById('state-display');
    if(!sa){st.textContent='INACTIVE';st.style.color='#555';}else if(pump){st.textContent='PUMPING OUT';st.style.color='#2ecc71';}else{st.textContent='ACTIVE — WAITING';st.style.color='#3498db';}
    document.getElementById('cycle-count').textContent=e.get('PUMP_CYCLES');
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Toggle System Start, then Simulate Fill to see pump cycle.</div>';}
function toggleSysStart(){plc.set('SYS_START',!plc.get('SYS_START'));plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleHiFloat(){plc.set('HI_FLOAT',!plc.get('HI_FLOAT'));plc.scan();}
function toggleLoFloat(){plc.set('LO_FLOAT',!plc.get('LO_FLOAT'));plc.scan();}
function fillTank(){plc.set('WATER_LEVEL',90);plc.scan();}
function toggleRunPLC(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
