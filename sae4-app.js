/**
 * SAE-4: MHE Conveyor with Fault & Jam Logic
 *
 * Two conveyors (47312, 47313) in same E-stop zone.
 * Sequential start with 4s delay between them.
 * Motor fault condition and jam condition for 47313.
 * CS310 is reset button for all faults.
 *
 * R0: Start/Stop latch with E-stop interlock
 * R1: Start 47312 first
 * R2: TON 4s delay
 * R3: Delay done → start 47313
 * R4: Motor fault detection (simulated)
 * R5: Jam detection — PE blocked for 3s → JAM
 * R6: Fault/Jam → stop both conveyors
 * R7: CS310 reset clears faults and jams
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start pushbutton');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop pushbutton');
plc.defineRegister('I:0/2','ESTOP','BOOL',false,'E-stop (true=tripped)');
plc.defineRegister('I:0/3','PE_47313','BOOL',false,'Photo-eye on 47313');
plc.defineRegister('I:0/4','MOTOR_FAULT_IN','BOOL',false,'Motor fault input (simulated)');
plc.defineRegister('I:0/5','CS310','BOOL',false,'Reset button CS310');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System running');
plc.defineRegister('B3:0/1','SEQ_DONE','BOOL',false,'Startup sequence done');
plc.defineRegister('B3:0/2','MOTOR_FAULT','BOOL',false,'Motor fault latched');
plc.defineRegister('B3:0/3','JAM_FAULT','BOOL',false,'Jam fault latched');
plc.defineRegister('B3:0/4','ANY_FAULT','BOOL',false,'Any fault active');
plc.defineRegister('O:0/0','CONV_47312','BOOL',false,'Conveyor 47312 output');
plc.defineRegister('O:0/1','CONV_47313','BOOL',false,'Conveyor 47313 output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',4,'Seq delay preset (4s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',3,'Jam timer preset (3s)');
plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'');plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'');

// R0: Start/Stop with E-stop and fault interlock
plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT STOP AND NOT ESTOP AND NOT ANY_FAULT',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'ESTOP',label:'ESTOP (NC)'},{type:'contact-nc',tag:'ANY_FAULT',label:'FAULT (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),es=e.get('ESTOP'),f=e.get('ANY_FAULT');
    const on=(s||r)&&!st&&!es&&!f;e.set('SYS_RUN',on);
    if(s&&!r){e.set('SEQ_DONE',false);}
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    const log=[];if(on&&!r)log.push({type:'action',message:'System START — 47312 first'});
    if(!on&&r)log.push({type:'action',message:es?'E-STOP tripped':f?'FAULT — system stopped':'System STOPPED'});
    return{energized:on,conditionStates:[s,r,!st,!es,!f],outputStates:[on],log};}
));

// R1: Conv 47312 runs when SYS_RUN
plc.addRung(new Rung(1,'SYS_RUN → CONV_47312 ON',
    [{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'}],
    [{type:'coil-out',tag:'CONV_47312',label:'CONV_47312'}],
    (e)=>{const on=e.get('SYS_RUN');e.set('CONV_47312',on);
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// R2: TON 4s delay for 47313
plc.addRung(new Rung(2,'CONV_47312 AND NOT SEQ_DONE → TON 4s delay',
    [{type:'contact-no',tag:'CONV_47312',label:'47312'},{type:'contact-nc',tag:'SEQ_DONE',label:'SEQ_DONE (NC)'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 4s'}],
    (e)=>{const en=e.get('CONV_47312')&&!e.get('SEQ_DONE');simTON(e,en,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    return{energized:en,conditionStates:[e.get('CONV_47312'),!e.get('SEQ_DONE')],outputStates:[en],log:[]};}
));

// R3: Delay done → start 47313
plc.addRung(new Rung(3,'T4:0/DN → CONV_47313 ON, SEQ_DONE',
    [{type:'contact-no',tag:'T0_DN',label:'T4:0/DN'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'}],
    [{type:'coil-out',tag:'CONV_47313',label:'CONV_47313'}],
    (e)=>{const dn=e.get('T0_DN'),run=e.get('SYS_RUN');const on=dn&&run;
    if(on)e.set('SEQ_DONE',true);e.set('CONV_47313',on||e.get('SEQ_DONE')&&run);
    const log=[];if(on&&!e.registers['SEQ_DONE'].prevValue)log.push({type:'action',message:'4s delay done — 47313 started'});
    return{energized:on,conditionStates:[dn,run],outputStates:[on],log};}
));

// R4: Motor fault latch
plc.addRung(new Rung(4,'MOTOR_FAULT_IN OR MOTOR_FAULT (seal) AND NOT CS310 → MOTOR_FAULT',
    [{type:'contact-no',tag:'MOTOR_FAULT_IN',label:'FAULT_IN'},{type:'contact-no',tag:'MOTOR_FAULT',label:'FAULT (seal)'},{type:'contact-nc',tag:'CS310',label:'CS310 (NC)'}],
    [{type:'coil-out',tag:'MOTOR_FAULT',label:'MOTOR_FAULT'}],
    (e)=>{const fi=e.get('MOTOR_FAULT_IN'),mf=e.get('MOTOR_FAULT'),rst=e.get('CS310');
    const on=(fi||mf)&&!rst;e.set('MOTOR_FAULT',on);if(fi)e.set('MOTOR_FAULT_IN',false);
    const log=[];if(on&&!mf)log.push({type:'action',message:'MOTOR FAULT on 47313!'});
    return{energized:on,conditionStates:[fi,mf,!rst],outputStates:[on],log};}
));

// R5: Jam detection — PE blocked for 3s
plc.addRung(new Rung(5,'PE_47313 blocked → TON 3s → JAM latch',
    [{type:'contact-no',tag:'PE_47313',label:'PE_47313'},{type:'contact-no',tag:'CONV_47313',label:'47313 running'}],
    [{type:'coil-out',tag:'T1_EN',label:'TON 3s jam'}],
    (e)=>{const pe=e.get('PE_47313'),conv=e.get('CONV_47313');const en=pe&&conv;
    simTON(e,en,'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    if(e.get('T1_DN')&&!e.get('JAM_FAULT')){e.set('JAM_FAULT',true);}
    return{energized:en,conditionStates:[pe,conv],outputStates:[en],log:e.get('T1_DN')&&!e.registers['JAM_FAULT'].prevValue?[{type:'action',message:'JAM on 47313 — PE blocked >3s!'}]:[]};}
));

// R6: Jam latch (seal-in, reset by CS310)
plc.addRung(new Rung(6,'JAM_FAULT seal-in, cleared by CS310',
    [{type:'contact-no',tag:'JAM_FAULT',label:'JAM'},{type:'contact-nc',tag:'CS310',label:'CS310 (NC)'}],
    [{type:'coil-out',tag:'JAM_FAULT',label:'JAM_FAULT'}],
    (e)=>{const j=e.get('JAM_FAULT'),rst=e.get('CS310');e.set('JAM_FAULT',j&&!rst);
    return{energized:j&&!rst,conditionStates:[j,!rst],outputStates:[j&&!rst],log:[]};}
));

// R7: ANY_FAULT = MOTOR_FAULT OR JAM_FAULT OR ESTOP
plc.addRung(new Rung(7,'ANY_FAULT = MOTOR_FAULT OR JAM_FAULT OR ESTOP',
    [{type:'contact-no',tag:'MOTOR_FAULT',label:'MOTOR_FAULT'}],
    [{type:'coil-out',tag:'ANY_FAULT',label:'ANY_FAULT'}],
    (e)=>{const any=e.get('MOTOR_FAULT')||e.get('JAM_FAULT')||e.get('ESTOP');e.set('ANY_FAULT',any);
    if(any){e.set('SYS_RUN',false);e.set('CONV_47312',false);e.set('CONV_47313',false);}
    return{energized:any,conditionStates:[any],outputStates:[any],log:[]};}
));

// R8: CS310 reset
plc.addRung(new Rung(8,'CS310 → clear faults',
    [{type:'contact-no',tag:'CS310',label:'CS310'}],
    [{type:'coil-out',tag:'MOTOR_FAULT',label:'CLEAR faults'}],
    (e)=>{const r=e.get('CS310');if(r){e.set('CS310',false);e.set('ESTOP',false);e.set('SEQ_DONE',false);}
    return{energized:r,conditionStates:[r],outputStates:[r],log:r?[{type:'action',message:'CS310 RESET — faults cleared'}]:[]};}
));

function updateUI(e){
    const c1=e.get('CONV_47312'),c2=e.get('CONV_47313'),es=e.get('ESTOP'),mf=e.get('MOTOR_FAULT'),jf=e.get('JAM_FAULT'),pe=e.get('PE_47313');
    document.getElementById('c1-dot').className='pe-dot'+(c1?' on':'');
    document.getElementById('c2-dot').className='pe-dot'+(c2?' on':'');
    document.getElementById('pe-dot').className='pe-dot'+(pe?' warn':'');
    document.getElementById('c1-box').className='equip-box'+(c1?' on':'');document.getElementById('c1-status').textContent=c1?'RUNNING':'OFF';
    document.getElementById('c2-box').className='equip-box'+(c2?' on':'');document.getElementById('c2-status').textContent=c2?'RUNNING':'OFF';
    document.getElementById('estop-box').className='equip-box'+(es?' warn':'');document.getElementById('estop-status').textContent=es?'TRIPPED':'OK';
    document.getElementById('fault-box').className='equip-box'+(mf?' warn':'');document.getElementById('fault-status').textContent=mf?'FAULT!':'OK';
    document.getElementById('jam-box').className='equip-box'+(jf?' active':'');document.getElementById('jam-status').textContent=jf?'JAM!':'OK';
    document.getElementById('seq-bar').style.width=(e.get('T0_ACC')/4*100)+'%';document.getElementById('seq-time').textContent=e.get('T0_ACC')+'/4s';
    document.getElementById('jam-bar').style.width=(e.get('T1_ACC')/3*100)+'%';document.getElementById('jam-time').textContent=e.get('T1_ACC')+'/3s';
    const st=document.getElementById('state-display');
    if(mf||jf){st.textContent=mf?'MOTOR FAULT':'JAM FAULT';st.style.color='#e74c3c';}
    else if(es){st.textContent='E-STOP';st.style.color='#e74c3c';}
    else if(c2){st.textContent='RUNNING';st.style.color='#2ecc71';}
    else if(c1){st.textContent='STARTING (4s delay)';st.style.color='#f39c12';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN. Try triggering faults.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function togglePE(){plc.set('PE_47313',!plc.get('PE_47313'));plc.scan();}
function triggerEstop(){plc.set('ESTOP',true);plc.scan();}
function triggerMotorFault(){plc.set('MOTOR_FAULT_IN',true);plc.scan();}
function pressReset(){plc.set('CS310',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
