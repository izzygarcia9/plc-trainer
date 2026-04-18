/**
 * SAE-6: MHE Motor Fault/Jam/Disconnect Alarm
 * Motor with disconnect switch, photo-eye, fault conditions.
 * Motor fault latch, jam (PE blocked 3s), disconnect alarm.
 * Bonus: motor replacement alarm at 1000 hours.
 * Each condition has its own reset.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop');
plc.defineRegister('I:0/2','MOTOR_DISC','BOOL',false,'Motor disconnect (true=open/tripped)');
plc.defineRegister('I:0/3','PE_SENSOR','BOOL',false,'Photo-eye (true=blocked)');
plc.defineRegister('I:0/4','FAULT_INPUT','BOOL',false,'Motor fault input (overload etc)');
plc.defineRegister('I:0/5','RESET_PB','BOOL',false,'Reset all faults');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System running');
plc.defineRegister('B3:0/1','MOTOR_FAULT','BOOL',false,'Motor fault latched');
plc.defineRegister('B3:0/2','JAM_FAULT','BOOL',false,'Jam fault latched');
plc.defineRegister('B3:0/3','DISC_ALARM','BOOL',false,'Disconnect alarm');
plc.defineRegister('B3:0/4','REPLACE_ALARM','BOOL',false,'Motor replacement alarm (1000hrs)');
plc.defineRegister('B3:0/5','ANY_FAULT','BOOL',false,'Any fault active');
plc.defineRegister('O:0/0','MOTOR_OUT','BOOL',false,'Motor output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',3,'Jam timer (3s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('N7:0','RUN_HOURS','INT',0,'Motor run hours');
plc.defineRegister('N7:1','RUN_SEC','INT',0,'Seconds counter for hours');

// R0: Start/Stop with fault interlock
plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT STOP AND NOT ANY_FAULT → SYS_RUN',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'ANY_FAULT',label:'FAULT (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),f=e.get('ANY_FAULT');
    const on=(s||r)&&!st&&!f;e.set('SYS_RUN',on);
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    return{energized:on,conditionStates:[s,r,!st,!f],outputStates:[on],log:[]};}
));

// R1: Motor output
plc.addRung(new Rung(1,'SYS_RUN AND NOT MOTOR_DISC → MOTOR_OUT',
    [{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'MOTOR_DISC',label:'DISC (NC)'}],
    [{type:'coil-out',tag:'MOTOR_OUT',label:'MOTOR_OUT'}],
    (e)=>{const on=e.get('SYS_RUN')&&!e.get('MOTOR_DISC');e.set('MOTOR_OUT',on);
    return{energized:on,conditionStates:[e.get('SYS_RUN'),!e.get('MOTOR_DISC')],outputStates:[on],log:[]};}
));

// R2: Motor fault latch
plc.addRung(new Rung(2,'FAULT_INPUT OR MOTOR_FAULT (seal) AND NOT RESET → MOTOR_FAULT',
    [{type:'contact-no',tag:'FAULT_INPUT',label:'FAULT_IN'},{type:'contact-no',tag:'MOTOR_FAULT',label:'FAULT (seal)'},{type:'contact-nc',tag:'RESET_PB',label:'RESET (NC)'}],
    [{type:'coil-out',tag:'MOTOR_FAULT',label:'MOTOR_FAULT'}],
    (e)=>{const fi=e.get('FAULT_INPUT'),mf=e.get('MOTOR_FAULT'),rst=e.get('RESET_PB');
    const on=(fi||mf)&&!rst;e.set('MOTOR_FAULT',on);if(fi)e.set('FAULT_INPUT',false);
    const log=[];if(on&&!mf)log.push({type:'action',message:'MOTOR FAULT latched!'});
    return{energized:on,conditionStates:[fi,mf,!rst],outputStates:[on],log};}
));

// R3: Jam detection — PE blocked 3s while motor running
plc.addRung(new Rung(3,'PE AND MOTOR_OUT → TON 3s → JAM latch',
    [{type:'contact-no',tag:'PE_SENSOR',label:'PE'},{type:'contact-no',tag:'MOTOR_OUT',label:'MOTOR'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 3s jam'}],
    (e)=>{const en=e.get('PE_SENSOR')&&e.get('MOTOR_OUT');simTON(e,en,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    if(e.get('T0_DN')&&!e.get('JAM_FAULT'))e.set('JAM_FAULT',true);
    return{energized:en,conditionStates:[e.get('PE_SENSOR'),e.get('MOTOR_OUT')],outputStates:[en],
    log:e.get('T0_DN')&&!e.registers['JAM_FAULT'].prevValue?[{type:'action',message:'JAM FAULT — PE blocked >3s'}]:[]};}
));

// R4: Jam seal-in
plc.addRung(new Rung(4,'JAM seal, cleared by RESET',
    [{type:'contact-no',tag:'JAM_FAULT',label:'JAM'},{type:'contact-nc',tag:'RESET_PB',label:'RESET (NC)'}],
    [{type:'coil-out',tag:'JAM_FAULT',label:'JAM_FAULT'}],
    (e)=>{e.set('JAM_FAULT',e.get('JAM_FAULT')&&!e.get('RESET_PB'));
    return{energized:e.get('JAM_FAULT'),conditionStates:[e.get('JAM_FAULT'),!e.get('RESET_PB')],outputStates:[e.get('JAM_FAULT')],log:[]};}
));

// R5: Disconnect alarm
plc.addRung(new Rung(5,'MOTOR_DISC AND SYS_RUN → DISC_ALARM',
    [{type:'contact-no',tag:'MOTOR_DISC',label:'DISC'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'}],
    [{type:'coil-out',tag:'DISC_ALARM',label:'DISC_ALARM'}],
    (e)=>{const on=e.get('MOTOR_DISC')&&e.get('SYS_RUN');e.set('DISC_ALARM',on);
    const log=[];if(on&&!e.registers['DISC_ALARM'].prevValue)log.push({type:'action',message:'DISCONNECT ALARM — switch open while running!'});
    return{energized:on,conditionStates:[e.get('MOTOR_DISC'),e.get('SYS_RUN')],outputStates:[on],log};}
));

// R6: Run hour counter (each "hour" = 60 scans for demo)
plc.addRung(new Rung(6,'MOTOR_OUT → count run hours (60 scans = 1 hr for demo)',
    [{type:'contact-no',tag:'MOTOR_OUT',label:'MOTOR_OUT'}],
    [{type:'math-add',tag:'RUN_SEC',label:'RUN_SEC++'}],
    (e)=>{if(e.get('MOTOR_OUT')){let s=e.get('RUN_SEC')+1;if(s>=60){e.set('RUN_HOURS',e.get('RUN_HOURS')+1);s=0;}e.set('RUN_SEC',s);}
    return{energized:e.get('MOTOR_OUT'),conditionStates:[e.get('MOTOR_OUT')],outputStates:[e.get('MOTOR_OUT')],log:[]};}
));

// R7: Replacement alarm at 1000 hours
plc.addRung(new Rung(7,'RUN_HOURS >= 1000 → REPLACE_ALARM',
    [{type:'compare-gt',tag:'RUN_HOURS',label:'HRS >= 1000',compareValue:'1000'}],
    [{type:'coil-out',tag:'REPLACE_ALARM',label:'REPLACE_ALARM'}],
    (e)=>{const on=e.get('RUN_HOURS')>=1000;e.set('REPLACE_ALARM',on);
    const log=[];if(on&&!e.registers['REPLACE_ALARM'].prevValue)log.push({type:'action',message:'REPLACE MOTOR — 1000 hours reached!'});
    return{energized:on,conditionStates:[on],outputStates:[on],log};}
));

// R8: ANY_FAULT
plc.addRung(new Rung(8,'ANY_FAULT = MOTOR_FAULT OR JAM OR DISC_ALARM',
    [{type:'contact-no',tag:'MOTOR_FAULT',label:'any fault'}],
    [{type:'coil-out',tag:'ANY_FAULT',label:'ANY_FAULT'}],
    (e)=>{const any=e.get('MOTOR_FAULT')||e.get('JAM_FAULT')||e.get('DISC_ALARM');e.set('ANY_FAULT',any);
    if(any)e.set('SYS_RUN',false);return{energized:any,conditionStates:[any],outputStates:[any],log:[]};}
));

// R9: Reset
plc.addRung(new Rung(9,'RESET clears momentary',
    [{type:'contact-no',tag:'RESET_PB',label:'RESET'}],
    [{type:'coil-out',tag:'RESET_PB',label:'clear RESET'}],
    (e)=>{if(e.get('RESET_PB')){e.set('RESET_PB',false);e.set('DISC_ALARM',false);}
    return{energized:false,conditionStates:[false],outputStates:[false],log:e.registers['RESET_PB'].prevValue?[{type:'action',message:'RESET — faults cleared'}]:[]};}
));

function updateUI(e){
    const mot=e.get('MOTOR_OUT'),disc=e.get('MOTOR_DISC'),pe=e.get('PE_SENSOR'),mf=e.get('MOTOR_FAULT'),jf=e.get('JAM_FAULT'),da=e.get('DISC_ALARM'),ra=e.get('REPLACE_ALARM');
    document.getElementById('motor-box').className='equip-box'+(mot?' on':'');document.getElementById('motor-status').textContent=mot?'RUNNING':'OFF';
    document.getElementById('disc-box').className='equip-box'+(disc?' warn':'');document.getElementById('disc-status').textContent=disc?'OPEN':'CLOSED';
    document.getElementById('pe-box').className='equip-box'+(pe?' warn':'');document.getElementById('pe-status').textContent=pe?'BLOCKED':'CLEAR';
    document.getElementById('mf-box').className='equip-box'+(mf?' warn':'');document.getElementById('mf-status').textContent=mf?'FAULT!':'OK';
    document.getElementById('jam-box').className='equip-box'+(jf?' active':'');document.getElementById('jam-status').textContent=jf?'JAM!':'OK';
    document.getElementById('da-box').className='equip-box'+(da?' warn':'');document.getElementById('da-status').textContent=da?'ALARM!':'OK';
    document.getElementById('hr-box').className='equip-box'+(ra?' warn':'');document.getElementById('hr-status').textContent=e.get('RUN_HOURS')+(ra?' REPLACE!':'');
    document.getElementById('jam-bar').style.width=(e.get('T0_ACC')/3*100)+'%';document.getElementById('jam-time').textContent=e.get('T0_ACC')+'/3s';
    document.getElementById('hr-bar').style.width=Math.min(100,e.get('RUN_HOURS')/1000*100)+'%';document.getElementById('hr-time').textContent=e.get('RUN_HOURS')+'/1000';
    const st=document.getElementById('state-display');
    if(mf||jf||da){st.textContent=mf?'MOTOR FAULT':jf?'JAM':'DISC ALARM';st.style.color='#e74c3c';}
    else if(mot){st.textContent='RUNNING ('+e.get('RUN_HOURS')+'hrs)';st.style.color='#2ecc71';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">START then trigger faults to test.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function togglePE(){plc.set('PE_SENSOR',!plc.get('PE_SENSOR'));plc.scan();}
function toggleDisc(){plc.set('MOTOR_DISC',!plc.get('MOTOR_DISC'));plc.scan();}
function triggerFault(){plc.set('FAULT_INPUT',true);plc.scan();}
function pressReset(){plc.set('RESET_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
