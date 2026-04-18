/**
 * AE-5: Bottle Fill Conveyor
 *
 * Start toggle runs conveyor. When bottle breaks sensor (PE),
 * conveyor stops, fill valve opens for 5 seconds, then conveyor
 * resumes and sensor unlatches. Inputs: start toggle, PE sensor toggle.
 *
 * Rungs:
 *  R0: Start toggle seal-in → CONV_RUN_CMD
 *  R1: PE_SENSOR AND CONV_RUNNING → BOTTLE_PRESENT latch
 *  R2: BOTTLE_PRESENT → stop conveyor, start fill
 *  R3: TON T4:0 (5s) fill timer
 *  R4: T4:0/DN → FILL_DONE, unlatch BOTTLE_PRESENT
 *  R5: CONV_RUN_CMD AND NOT BOTTLE_PRESENT → CONV_MOTOR
 *  R6: BOTTLE_PRESENT AND NOT FILL_DONE → FILL_VALVE
 *  R7: Simulate bottle position (moves with conveyor)
 */
const plc = new PLCEngine();
const ladder = new LadderRenderer('ladder-content');
let running = false, scanInterval = null, scanSpeed = 500, timeScale = 1;
const FILL_PRE = 5;
const timerSub = { T0: 0 };

function simTON(engine, enable, accTag, preTag, enTag, ttTag, dnTag, key) {
    const pre = engine.get(preTag); let acc = engine.get(accTag);
    if (!enable) { engine.set(accTag,0);engine.set(enTag,false);engine.set(ttTag,false);engine.set(dnTag,false);timerSub[key]=0;return{en:false,tt:false,dn:false}; }
    engine.set(enTag,true);
    if (acc>=pre){engine.set(ttTag,false);engine.set(dnTag,true);return{en:true,tt:false,dn:true};}
    timerSub[key]++;if(timerSub[key]>=timeScale){acc++;engine.set(accTag,acc);timerSub[key]=0;}
    const done=acc>=pre;engine.set(ttTag,!done);engine.set(dnTag,done);return{en:true,tt:!done,dn:done};
}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start toggle');
plc.defineRegister('I:0/1','PE_SENSOR','BOOL',false,'Product present sensor');
plc.defineRegister('B3:0/0','CONV_RUN_CMD','BOOL',false,'Conveyor run command latch');
plc.defineRegister('B3:0/1','BOTTLE_PRESENT','BOOL',false,'Bottle at fill station');
plc.defineRegister('B3:0/2','FILL_DONE','BOOL',false,'Fill cycle complete');
plc.defineRegister('O:0/0','CONV_MOTOR','BOOL',false,'Conveyor motor output');
plc.defineRegister('O:0/1','FILL_VALVE','BOOL',false,'Fill valve output');
plc.defineRegister('T4:0.PRE','T4_0_PRE','INT',FILL_PRE,'Fill timer preset (5s)');
plc.defineRegister('T4:0.ACC','T4_0_ACC','INT',0,'Fill timer accumulated');
plc.defineRegister('T4:0/EN','T4_0_EN','BOOL',false,'Fill timer enable');
plc.defineRegister('T4:0/TT','T4_0_TT','BOOL',false,'Fill timer timing');
plc.defineRegister('T4:0/DN','T4_0_DN','BOOL',false,'Fill timer done');
plc.defineRegister('N7:0','BOTTLE_POS','INT',0,'Bottle position (0-20)');
plc.defineRegister('N7:1','BOTTLE_COUNT','INT',0,'Bottles filled');

// R0: Start toggle latch
plc.addRung(new Rung(0,'START toggle → CONV_RUN_CMD latch',
    [{type:'contact-no',tag:'START_PB',label:'START_PB'}],
    [{type:'coil-out',tag:'CONV_RUN_CMD',label:'CONV_RUN_CMD'}],
    (e)=>{const s=e.get('START_PB');e.set('CONV_RUN_CMD',s);return{energized:s,conditionStates:[s],outputStates:[s],log:[]};}
));

// R1: PE_SENSOR + conveyor running → latch BOTTLE_PRESENT
plc.addRung(new Rung(1,'PE_SENSOR AND CONV_MOTOR → latch BOTTLE_PRESENT',
    [{type:'contact-no',tag:'PE_SENSOR',label:'PE_SENSOR'},{type:'contact-no',tag:'CONV_MOTOR',label:'CONV_MOTOR'}],
    [{type:'coil-out',tag:'BOTTLE_PRESENT',label:'BOTTLE_PRESENT'}],
    (e)=>{
        const pe=e.get('PE_SENSOR'),conv=e.get('CONV_MOTOR'),bp=e.get('BOTTLE_PRESENT');
        const latch=(pe&&conv)||bp;
        // Don't latch if fill is done (unlatch)
        if(e.get('FILL_DONE'))e.set('BOTTLE_PRESENT',false);
        else e.set('BOTTLE_PRESENT',latch);
        const on=e.get('BOTTLE_PRESENT');
        const log=[];
        if(on&&!bp)log.push({type:'action',message:'Bottle detected at fill station'});
        return{energized:on,conditionStates:[pe,conv],outputStates:[on],log};
    }
));

// R2: BOTTLE_PRESENT → clear FILL_DONE for new cycle
plc.addRung(new Rung(2,'BOTTLE_PRESENT AND NOT FILL_DONE → enable fill cycle',
    [{type:'contact-no',tag:'BOTTLE_PRESENT',label:'BOTTLE_PRESENT'},{type:'contact-nc',tag:'FILL_DONE',label:'FILL_DONE (NC)'}],
    [{type:'coil-out',tag:'FILL_VALVE',label:'FILL_VALVE'}],
    (e)=>{const bp=e.get('BOTTLE_PRESENT'),fd=e.get('FILL_DONE');const on=bp&&!fd;e.set('FILL_VALVE',on);
    return{energized:on,conditionStates:[bp,!fd],outputStates:[on],log:[]};}
));

// R3: TON fill timer
plc.addRung(new Rung(3,'TON T4:0: FILL_VALVE enables 5s fill timer',
    [{type:'contact-no',tag:'FILL_VALVE',label:'FILL_VALVE'}],
    [{type:'coil-out',tag:'T4_0_EN',label:'TON T4:0 (5s)'}],
    (e)=>{const en=e.get('FILL_VALVE');const r=simTON(e,en,'T4_0_ACC','T4_0_PRE','T4_0_EN','T4_0_TT','T4_0_DN','T0');
    return{energized:en,conditionStates:[en],outputStates:[r.en],log:[]};}
));

// R4: Fill done → unlatch bottle, set FILL_DONE
plc.addRung(new Rung(4,'T4:0/DN → FILL_DONE, unlatch BOTTLE_PRESENT, clear PE',
    [{type:'contact-no',tag:'T4_0_DN',label:'T4:0/DN'}],
    [{type:'coil-out',tag:'FILL_DONE',label:'FILL_DONE'}],
    (e)=>{const dn=e.get('T4_0_DN');
    if(dn&&!e.get('FILL_DONE')){e.set('FILL_DONE',true);e.set('BOTTLE_PRESENT',false);e.set('PE_SENSOR',false);e.set('FILL_VALVE',false);e.set('BOTTLE_COUNT',e.get('BOTTLE_COUNT')+1);}
    const log=[];if(dn&&e.registers['FILL_DONE'].prevValue===false)log.push({type:'action',message:`Fill complete! Bottle #${e.get('BOTTLE_COUNT')}`});
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

// R5: Conveyor motor output
plc.addRung(new Rung(5,'CONV_RUN_CMD AND NOT BOTTLE_PRESENT → CONV_MOTOR',
    [{type:'contact-no',tag:'CONV_RUN_CMD',label:'CONV_RUN_CMD'},{type:'contact-nc',tag:'BOTTLE_PRESENT',label:'BOTTLE_PRESENT (NC)'}],
    [{type:'coil-out',tag:'CONV_MOTOR',label:'CONV_MOTOR'}],
    (e)=>{const cmd=e.get('CONV_RUN_CMD'),bp=e.get('BOTTLE_PRESENT');const on=cmd&&!bp;e.set('CONV_MOTOR',on);
    // Reset fill_done when conveyor resumes
    if(on&&e.get('FILL_DONE'))e.set('FILL_DONE',false);
    return{energized:on,conditionStates:[cmd,!bp],outputStates:[on],log:[]};}
));

// R6: Simulate bottle position
plc.addRung(new Rung(6,'CONV_MOTOR → move bottle position +1',
    [{type:'contact-no',tag:'CONV_MOTOR',label:'CONV_MOTOR'}],
    [{type:'math-add',tag:'BOTTLE_POS',label:'POS + 1'}],
    (e)=>{const on=e.get('CONV_MOTOR');
    if(on){let p=e.get('BOTTLE_POS')+1;if(p>20)p=0;e.set('BOTTLE_POS',p);
    // Auto-trigger sensor at position 10
    if(p===10)e.set('PE_SENSOR',true);}
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// ─── UI ───
function updateUI(engine) {
    const conv=engine.get('CONV_MOTOR'),bp=engine.get('BOTTLE_PRESENT'),fv=engine.get('FILL_VALVE'),pe=engine.get('PE_SENSOR');
    const pos=engine.get('BOTTLE_POS');
    // Bottle position
    const pct=15+(pos/20)*70;
    document.getElementById('bottle').style.left=pct+'%';
    // Bottle liquid fill
    const fillAcc=engine.get('T4_0_ACC');
    document.getElementById('bottle-liquid').style.height=(bp?Math.min(100,fillAcc/FILL_PRE*100):0)+'%';
    // Nozzle stream
    document.getElementById('nozzle-stream').className='nozzle-stream'+(fv?' active':'');
    // Sensor beam
    document.getElementById('sensor-beam').className='sensor-beam'+(pe?' blocked':'');
    // Equipment boxes
    document.getElementById('conv-box').className='equip-box'+(conv?' active':'');
    document.getElementById('conv-status').textContent=conv?'RUNNING':'OFF';
    document.getElementById('sensor-box').className='equip-box'+(pe?' blocked':'');
    document.getElementById('sensor-status').textContent=pe?'BLOCKED':'CLEAR';
    document.getElementById('fill-box').className='equip-box'+(fv?' active':'');
    document.getElementById('fill-status').textContent=fv?'OPEN':'CLOSED';
    // Timer bar
    document.getElementById('fill-bar').style.width=(fillAcc/FILL_PRE*100)+'%';
    document.getElementById('fill-time').textContent=`${fillAcc} / ${FILL_PRE}s`;
    // State
    const stateEl=document.getElementById('state-display');
    if(fv){stateEl.textContent='FILLING';stateEl.style.color='#3498db';}
    else if(conv){stateEl.textContent='RUNNING';stateEl.style.color='#2ecc71';}
    else{stateEl.textContent='IDLE';stateEl.style.color='#888';}
    document.getElementById('bottle-count').textContent=engine.get('BOTTLE_COUNT');
    document.getElementById('start-btn').className='plc-btn start-btn'+(engine.get('START_PB')?' on':'');
    document.getElementById('scan-count').textContent=engine.scanCount;
    ladder.update(engine.rungs);updateRegisterTable(engine);updateScanLog(engine);
}
function updateRegisterTable(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function updateScanLog(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Toggle START then RUN.</div>';}

function pressStart(){const cur=plc.get('START_PB');plc.set('START_PB',!cur);plc.notifyListeners();}
function toggleSensor(){plc.set('PE_SENSOR',!plc.get('PE_SENSOR'));plc.notifyListeners();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}

plc.onChange(updateUI);ladder.render(plc.rungs);updateRegisterTable(plc);updateScanLog(plc);plc.scan();
