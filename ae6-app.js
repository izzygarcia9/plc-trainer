/**
 * AE-6: Dual Tank Priority Fill
 *
 * Two tanks with High/Low level switches.
 * When both empty (LL=HIGH means empty), Tank 1 fills first (priority).
 * Tank 1 fills until its LL goes LOW (no longer empty).
 * Then Tank 2 can fill.
 *
 * Level switch logic (inverted — industrial convention):
 *   LL = HIGH (true) → tank is EMPTY (below low level)
 *   HL = HIGH (true) → tank is FULL (above high level)
 *
 * Rungs:
 *  R0: T1_LL (empty) AND NOT T1_HL (not full) → VALVE_A (Tank 1 priority)
 *  R1: T2_LL (empty) AND NOT T2_HL AND NOT VALVE_A → VALVE_B (Tank 2 only if T1 not filling)
 *  R2: Simulate Tank 1 level (fills when VALVE_A, drains slowly)
 *  R3: Simulate Tank 2 level
 *  R4: Update level switches from tank levels
 */
const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500;

plc.defineRegister('I:0/0','T1_LL','BOOL',true,'Tank 1 Low Level (true=empty)');
plc.defineRegister('I:0/1','T1_HL','BOOL',false,'Tank 1 High Level (true=full)');
plc.defineRegister('I:0/2','T2_LL','BOOL',true,'Tank 2 Low Level (true=empty)');
plc.defineRegister('I:0/3','T2_HL','BOOL',false,'Tank 2 High Level (true=full)');
plc.defineRegister('O:0/0','VALVE_A','BOOL',false,'Motor Valve A (Tank 1 fill)');
plc.defineRegister('O:0/1','VALVE_B','BOOL',false,'Motor Valve B (Tank 2 fill)');
plc.defineRegister('N7:0','T1_LEVEL','INT',0,'Tank 1 level (0-100)');
plc.defineRegister('N7:1','T2_LEVEL','INT',0,'Tank 2 level (0-100)');

// R0: Tank 1 priority fill
plc.addRung(new Rung(0,
    'T1_LL (empty) AND NOT T1_HL (not full) → VALVE_A ON (Tank 1 priority)',
    [{type:'contact-no',tag:'T1_LL',label:'T1_LL (empty)'},{type:'contact-nc',tag:'T1_HL',label:'T1_HL (NC)'}],
    [{type:'coil-out',tag:'VALVE_A',label:'VALVE_A'}],
    (e)=>{const ll=e.get('T1_LL'),hl=e.get('T1_HL');const on=ll&&!hl;e.set('VALVE_A',on);
    const log=[];if(on!==e.registers['VALVE_A'].prevValue)log.push({type:'action',message:`VALVE A ${on?'OPEN — filling Tank 1':'CLOSED'}`});
    return{energized:on,conditionStates:[ll,!hl],outputStates:[on],log};}
));

// R1: Tank 2 fill (only when Valve A is NOT active)
plc.addRung(new Rung(1,
    'T2_LL (empty) AND NOT T2_HL AND NOT VALVE_A → VALVE_B (T2 only if T1 not filling)',
    [{type:'contact-no',tag:'T2_LL',label:'T2_LL (empty)'},{type:'contact-nc',tag:'T2_HL',label:'T2_HL (NC)'},{type:'contact-nc',tag:'VALVE_A',label:'VALVE_A (NC)'}],
    [{type:'coil-out',tag:'VALVE_B',label:'VALVE_B'}],
    (e)=>{const ll=e.get('T2_LL'),hl=e.get('T2_HL'),va=e.get('VALVE_A');const on=ll&&!hl&&!va;e.set('VALVE_B',on);
    const log=[];if(on!==e.registers['VALVE_B'].prevValue)log.push({type:'action',message:`VALVE B ${on?'OPEN — filling Tank 2':'CLOSED'}`});
    return{energized:on,conditionStates:[ll,!hl,!va],outputStates:[on],log};}
));

// R2: Simulate Tank 1 level
plc.addRung(new Rung(2,'Simulate: VALVE_A → T1_LEVEL +2, else -0 (hold)',
    [{type:'contact-no',tag:'VALVE_A',label:'VALVE_A'}],
    [{type:'math-add',tag:'T1_LEVEL',label:'T1_LEVEL +2'}],
    (e)=>{const va=e.get('VALVE_A');let lv=e.get('T1_LEVEL');
    if(va)lv=Math.min(100,lv+2);
    e.set('T1_LEVEL',lv);return{energized:va,conditionStates:[va],outputStates:[va],log:[]};}
));

// R3: Simulate Tank 2 level
plc.addRung(new Rung(3,'Simulate: VALVE_B → T2_LEVEL +2, else hold',
    [{type:'contact-no',tag:'VALVE_B',label:'VALVE_B'}],
    [{type:'math-add',tag:'T2_LEVEL',label:'T2_LEVEL +2'}],
    (e)=>{const vb=e.get('VALVE_B');let lv=e.get('T2_LEVEL');
    if(vb)lv=Math.min(100,lv+2);
    e.set('T2_LEVEL',lv);return{energized:vb,conditionStates:[vb],outputStates:[vb],log:[]};}
));

// R4: Update level switches from levels
plc.addRung(new Rung(4,'Update level switches: LL=level<20, HL=level>=90',
    [{type:'compare-lt',tag:'T1_LEVEL',label:'always',compareValue:'999'}],
    [{type:'coil-out',tag:'T1_LL',label:'Update switches'}],
    (e)=>{
    const l1=e.get('T1_LEVEL'),l2=e.get('T2_LEVEL');
    e.set('T1_LL',l1<20);e.set('T1_HL',l1>=90);
    e.set('T2_LL',l2<20);e.set('T2_HL',l2>=90);
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

// ─── UI ───
function updateUI(e){
    const va=e.get('VALVE_A'),vb=e.get('VALVE_B'),l1=e.get('T1_LEVEL'),l2=e.get('T2_LEVEL');
    document.getElementById('tank1-fill').style.height=l1+'%';
    document.getElementById('tank2-fill').style.height=l2+'%';
    document.getElementById('valve-a-ind').className='valve-indicator'+(va?' open':'');
    document.getElementById('valve-b-ind').className='valve-indicator'+(vb?' open':'');
    document.getElementById('va-box').className='equip-box'+(va?' active':'');
    document.getElementById('va-status').textContent=va?'OPEN':'CLOSED';
    document.getElementById('vb-box').className='equip-box'+(vb?' active':'');
    document.getElementById('vb-status').textContent=vb?'OPEN':'CLOSED';
    const t1ll=e.get('T1_LL'),t1hl=e.get('T1_HL'),t2ll=e.get('T2_LL'),t2hl=e.get('T2_HL');
    document.getElementById('t1-lo-sw').textContent='LO: '+(t1ll?'HIGH':'LOW');document.getElementById('t1-lo-sw').className='sw'+(t1ll?' on':'');
    document.getElementById('t1-hi-sw').textContent='HI: '+(t1hl?'HIGH':'LOW');document.getElementById('t1-hi-sw').className='sw'+(t1hl?' on':'');
    document.getElementById('t2-lo-sw').textContent='LO: '+(t2ll?'HIGH':'LOW');document.getElementById('t2-lo-sw').className='sw'+(t2ll?' on':'');
    document.getElementById('t2-hi-sw').textContent='HI: '+(t2hl?'HIGH':'LOW');document.getElementById('t2-hi-sw').className='sw'+(t2hl?' on':'');
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);updateRegisterTable(e);updateScanLog(e);
}
function updateRegisterTable(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function updateScanLog(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Drain tanks then RUN to see priority fill.</div>';}

function drainTank(n){plc.set(n===1?'T1_LEVEL':'T2_LEVEL',0);plc.scan();}
function drainBoth(){plc.set('T1_LEVEL',0);plc.set('T2_LEVEL',0);plc.scan();}
function fillBoth(){plc.set('T1_LEVEL',100);plc.set('T2_LEVEL',100);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}

plc.onChange(updateUI);ladder.render(plc.rungs);updateRegisterTable(plc);updateScanLog(plc);plc.scan();
