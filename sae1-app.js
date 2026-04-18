/**
 * SAE-1: Alternating Bulbs with Cycle Counter
 *
 * Sequence: BULB_A ON 5s → OFF → WAIT 3s → BULB_B ON 5s → OFF → increment cycle → repeat
 * Stops after N cycles.
 *
 * State machine: IDLE → A_ON → A_WAIT → B_ON → B_DONE → (loop or stop)
 * Uses 3 TON timers: T_A_ON(5s), T_WAIT(3s), T_B_ON(5s)
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0,T2:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start (momentary)');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop/Reset (momentary)');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System running latch');
plc.defineRegister('B3:0/1','STATE_A_ON','BOOL',false,'Bulb A ON phase');
plc.defineRegister('B3:0/2','STATE_WAIT','BOOL',false,'Wait phase');
plc.defineRegister('B3:0/3','STATE_B_ON','BOOL',false,'Bulb B ON phase');
plc.defineRegister('B3:0/4','DONE','BOOL',false,'All cycles complete');
plc.defineRegister('O:0/0','BULB_A','BOOL',false,'Bulb A output');
plc.defineRegister('O:0/1','BULB_B','BOOL',false,'Bulb B output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',5,'A ON timer preset');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',3,'Wait timer preset');
plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'');plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'');
plc.defineRegister('T4:2.PRE','T2_PRE','INT',5,'B ON timer preset');
plc.defineRegister('T4:2.ACC','T2_ACC','INT',0,'');plc.defineRegister('T4:2/EN','T2_EN','BOOL',false,'');plc.defineRegister('T4:2/TT','T2_TT','BOOL',false,'');plc.defineRegister('T4:2/DN','T2_DN','BOOL',false,'');
plc.defineRegister('N7:0','CYCLE_CNT','INT',0,'Current cycle count');
plc.defineRegister('N7:1','N_CYCLES','INT',3,'Target cycles');

// R0: Start/Stop latch
plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT STOP AND NOT DONE → SYS_RUN',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'DONE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),d=e.get('DONE');
    const on=(s||r)&&!st&&!d;e.set('SYS_RUN',on);
    if(s&&!r&&!d){e.set('STATE_A_ON',true);e.set('STATE_WAIT',false);e.set('STATE_B_ON',false);e.set('CYCLE_CNT',0);}
    if(s)e.set('START_PB',false);if(st){e.set('STOP_PB',false);e.set('STATE_A_ON',false);e.set('STATE_WAIT',false);e.set('STATE_B_ON',false);e.set('DONE',false);e.set('CYCLE_CNT',0);}
    const log=[];if(on&&!r)log.push({type:'action',message:'System STARTED — Bulb A phase'});
    if(!on&&r)log.push({type:'action',message:'System STOPPED'});
    return{energized:on,conditionStates:[s,r,!st,!d],outputStates:[on],log};}
));

// R1: TON A ON (5s)
plc.addRung(new Rung(1,'STATE_A_ON → TON T4:0 (5s) + BULB_A ON',
    [{type:'contact-no',tag:'STATE_A_ON',label:'STATE_A_ON'}],
    [{type:'coil-out',tag:'BULB_A',label:'BULB_A + TON 5s'}],
    (e)=>{const on=e.get('STATE_A_ON');e.set('BULB_A',on);simTON(e,on,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// R2: A done → transition to WAIT
plc.addRung(new Rung(2,'T4:0/DN → clear A, set WAIT',
    [{type:'contact-no',tag:'T0_DN',label:'T4:0/DN'}],
    [{type:'coil-out',tag:'STATE_WAIT',label:'→ WAIT'}],
    (e)=>{const dn=e.get('T0_DN');if(dn&&e.get('STATE_A_ON')){e.set('STATE_A_ON',false);e.set('STATE_WAIT',true);e.set('BULB_A',false);}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log:dn&&e.registers['STATE_WAIT'].prevValue===false?[{type:'action',message:'Bulb A OFF → waiting 3s'}]:[]};}
));

// R3: TON WAIT (3s)
plc.addRung(new Rung(3,'STATE_WAIT → TON T4:1 (3s)',
    [{type:'contact-no',tag:'STATE_WAIT',label:'STATE_WAIT'}],
    [{type:'coil-out',tag:'T1_EN',label:'TON 3s wait'}],
    (e)=>{simTON(e,e.get('STATE_WAIT'),'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    return{energized:e.get('STATE_WAIT'),conditionStates:[e.get('STATE_WAIT')],outputStates:[e.get('T1_EN')],log:[]};}
));

// R4: Wait done → transition to B ON
plc.addRung(new Rung(4,'T4:1/DN → clear WAIT, set B_ON',
    [{type:'contact-no',tag:'T1_DN',label:'T4:1/DN'}],
    [{type:'coil-out',tag:'STATE_B_ON',label:'→ B_ON'}],
    (e)=>{const dn=e.get('T1_DN');if(dn&&e.get('STATE_WAIT')){e.set('STATE_WAIT',false);e.set('STATE_B_ON',true);}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log:dn&&e.registers['STATE_B_ON'].prevValue===false?[{type:'action',message:'Wait done → Bulb B ON'}]:[]};}
));

// R5: TON B ON (5s)
plc.addRung(new Rung(5,'STATE_B_ON → TON T4:2 (5s) + BULB_B ON',
    [{type:'contact-no',tag:'STATE_B_ON',label:'STATE_B_ON'}],
    [{type:'coil-out',tag:'BULB_B',label:'BULB_B + TON 5s'}],
    (e)=>{const on=e.get('STATE_B_ON');e.set('BULB_B',on);simTON(e,on,'T2_ACC','T2_PRE','T2_EN','T2_TT','T2_DN','T2');
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// R6: B done → increment cycle, loop or stop
plc.addRung(new Rung(6,'T4:2/DN → cycle++, if < N restart A, else DONE',
    [{type:'contact-no',tag:'T2_DN',label:'T4:2/DN'}],
    [{type:'coil-out',tag:'CYCLE_CNT',label:'CYCLE++ / loop'}],
    (e)=>{const dn=e.get('T2_DN');if(dn&&e.get('STATE_B_ON')){
    e.set('STATE_B_ON',false);e.set('BULB_B',false);
    const cnt=e.get('CYCLE_CNT')+1;e.set('CYCLE_CNT',cnt);
    if(cnt>=e.get('N_CYCLES')){e.set('DONE',true);e.set('SYS_RUN',false);}
    else{e.set('STATE_A_ON',true);}}
    const log=[];if(dn&&e.registers['STATE_B_ON'].prevValue){
    const c=e.get('CYCLE_CNT');if(e.get('DONE'))log.push({type:'action',message:`Cycle ${c}/${e.get('N_CYCLES')} — ALL CYCLES COMPLETE`});
    else log.push({type:'action',message:`Cycle ${c}/${e.get('N_CYCLES')} done → restarting Bulb A`});}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

function updateUI(e){
    const a=e.get('BULB_A'),b=e.get('BULB_B'),done=e.get('DONE');
    document.getElementById('bulb-a').className='bulb-circle'+(a?' on-a':'');
    document.getElementById('bulb-b').className='bulb-circle'+(b?' on-b':'');
    document.getElementById('cycle-val').textContent=e.get('CYCLE_CNT');
    document.getElementById('cycle-max').textContent=e.get('N_CYCLES');
    document.getElementById('a-on-bar').style.width=(e.get('T0_ACC')/5*100)+'%';document.getElementById('a-on-time').textContent=e.get('T0_ACC')+'/5s';
    document.getElementById('wait-bar').style.width=(e.get('T1_ACC')/3*100)+'%';document.getElementById('wait-time').textContent=e.get('T1_ACC')+'/3s';
    document.getElementById('b-on-bar').style.width=(e.get('T2_ACC')/5*100)+'%';document.getElementById('b-on-time').textContent=e.get('T2_ACC')+'/5s';
    const st=document.getElementById('state-display');
    if(done){st.textContent='COMPLETE';st.style.color='#2ecc71';}
    else if(a){st.textContent='BULB A ON';st.style.color='#f1c40f';}
    else if(e.get('STATE_WAIT')){st.textContent='WAITING';st.style.color='#888';}
    else if(b){st.textContent='BULB B ON';st.style.color='#3498db';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
