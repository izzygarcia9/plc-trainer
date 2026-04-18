/**
 * SAE-7: Automatic Car Wash — 4-Phase Sequential
 * Conveyor moves car. Position sensors trigger each phase (50s each).
 * Conveyor stops during phase, resumes after. Stops at exit sensor.
 * Stop pauses mid-phase, Start resumes from same phase.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(eT,false);e.set(tT,false);return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start/Resume');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop/Pause');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System active');
plc.defineRegister('B3:0/1','CONV_RUN','BOOL',false,'Conveyor running');
plc.defineRegister('B3:0/2','IN_PHASE','BOOL',false,'Currently in a wash phase');
plc.defineRegister('B3:0/3','PAUSED','BOOL',false,'Paused mid-phase');
plc.defineRegister('B3:0/4','COMPLETE','BOOL',false,'Car at exit');
plc.defineRegister('N7:0','PHASE','INT',0,'Current phase (0=moving,1-4=wash,5=exit)');
plc.defineRegister('N7:1','CAR_POS','INT',0,'Car position (0-100)');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',50,'Phase timer (50s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');

const PHASE_POS=[0,15,35,55,75,95]; // positions where each phase triggers

// R0: Start/Stop
plc.addRung(new Rung(0,'START/STOP control',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'RUN'},{type:'contact-nc',tag:'COMPLETE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),d=e.get('COMPLETE');
    if(st&&r){e.set('PAUSED',true);e.set('STOP_PB',false);return{energized:true,conditionStates:[s,r,!d],outputStates:[true],log:[{type:'action',message:'PAUSED'}]};}
    if(s&&e.get('PAUSED')){e.set('PAUSED',false);e.set('START_PB',false);return{energized:true,conditionStates:[true,true,!d],outputStates:[true],log:[{type:'action',message:'RESUMED'}]};}
    const on=(s||r)&&!d;e.set('SYS_RUN',on);
    if(s&&!r){e.set('CAR_POS',0);e.set('PHASE',0);e.set('IN_PHASE',false);e.set('PAUSED',false);e.set('T0_ACC',0);e.set('T0_DN',false);tsub.T0=0;}
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    return{energized:on,conditionStates:[s,r,!d],outputStates:[on],log:on&&!r?[{type:'action',message:'Car wash started — conveyor moving'}]:[]};}
));

// R1: Conveyor runs when SYS_RUN AND NOT IN_PHASE AND NOT PAUSED AND NOT COMPLETE
plc.addRung(new Rung(1,'SYS_RUN AND NOT IN_PHASE AND NOT PAUSED → CONV_RUN',
    [{type:'contact-no',tag:'SYS_RUN',label:'RUN'},{type:'contact-nc',tag:'IN_PHASE',label:'PHASE (NC)'},{type:'contact-nc',tag:'PAUSED',label:'PAUSE (NC)'},{type:'contact-nc',tag:'COMPLETE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'CONV_RUN',label:'CONV_RUN'}],
    (e)=>{const on=e.get('SYS_RUN')&&!e.get('IN_PHASE')&&!e.get('PAUSED')&&!e.get('COMPLETE');e.set('CONV_RUN',on);
    return{energized:on,conditionStates:[e.get('SYS_RUN'),!e.get('IN_PHASE'),!e.get('PAUSED'),!e.get('COMPLETE')],outputStates:[on],log:[]};}
));

// R2: Move car when conveyor running
plc.addRung(new Rung(2,'CONV_RUN → CAR_POS + 1',
    [{type:'contact-no',tag:'CONV_RUN',label:'CONV_RUN'}],[{type:'math-add',tag:'CAR_POS',label:'POS+1'}],
    (e)=>{if(e.get('CONV_RUN')){let p=e.get('CAR_POS')+1;e.set('CAR_POS',Math.min(100,p));
    // Check position sensors
    const phase=e.get('PHASE');
    if(phase<4&&p>=PHASE_POS[phase+1]){e.set('PHASE',phase+1);e.set('IN_PHASE',true);e.set('T0_ACC',0);e.set('T0_DN',false);tsub.T0=0;}
    if(p>=PHASE_POS[5]&&phase>=4){e.set('COMPLETE',true);e.set('CONV_RUN',false);}}
    return{energized:e.get('CONV_RUN'),conditionStates:[e.get('CONV_RUN')],outputStates:[e.get('CONV_RUN')],
    log:e.get('IN_PHASE')&&!e.registers['IN_PHASE'].prevValue?[{type:'action',message:`Phase ${e.get('PHASE')} started — conveyor stopped`}]:
    e.get('COMPLETE')&&!e.registers['COMPLETE'].prevValue?[{type:'action',message:'Car at EXIT — wash complete!'}]:[]};}
));

// R3: Phase timer (50s) — only when IN_PHASE and NOT PAUSED
plc.addRung(new Rung(3,'IN_PHASE AND NOT PAUSED → TON 50s',
    [{type:'contact-no',tag:'IN_PHASE',label:'IN_PHASE'},{type:'contact-nc',tag:'PAUSED',label:'PAUSE (NC)'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 50s'}],
    (e)=>{const en=e.get('IN_PHASE')&&!e.get('PAUSED');
    if(en)simTON(e,true,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    else{e.set('T0_EN',false);e.set('T0_TT',false);}
    return{energized:en,conditionStates:[e.get('IN_PHASE'),!e.get('PAUSED')],outputStates:[en],log:[]};}
));

// R4: Phase done → clear IN_PHASE, conveyor resumes
plc.addRung(new Rung(4,'T0_DN → phase complete, resume conveyor',
    [{type:'contact-no',tag:'T0_DN',label:'T0_DN'}],[{type:'coil-out',tag:'IN_PHASE',label:'clear phase'}],
    (e)=>{if(e.get('T0_DN')&&e.get('IN_PHASE')){e.set('IN_PHASE',false);e.set('T0_ACC',0);e.set('T0_DN',false);tsub.T0=0;
    return{energized:true,conditionStates:[true],outputStates:[true],log:[{type:'action',message:`Phase ${e.get('PHASE')} complete — conveyor resuming`}]};}
    return{energized:false,conditionStates:[false],outputStates:[false],log:[]};}
));

const phaseNames=['','PRE-SOAK','SOAP','RINSE','DRY'];
function updateUI(e){
    const phase=e.get('PHASE'),inP=e.get('IN_PHASE'),pos=e.get('CAR_POS'),complete=e.get('COMPLETE'),paused=e.get('PAUSED');
    for(let i=1;i<=4;i++){const el=document.getElementById('wp'+i);
    if(i===phase&&inP)el.className='wash-phase active';
    else if(i<phase||(i===phase&&!inP&&phase>0))el.className='wash-phase done';
    else el.className='wash-phase';}
    document.getElementById('wp-exit').className='wash-phase exit-phase'+(complete?' active':'');
    document.getElementById('car-icon').style.left=(5+pos*0.85)+'%';
    document.getElementById('phase-bar').style.width=(e.get('T0_ACC')/50*100)+'%';document.getElementById('phase-time').textContent=e.get('T0_ACC')+'/50s';
    document.getElementById('phase-val').textContent=phase;
    document.getElementById('conv-state').textContent=e.get('CONV_RUN')?'MOVING':'STOPPED';
    const st=document.getElementById('state-display');
    if(complete){st.textContent='COMPLETE';st.style.color='#f1c40f';}
    else if(paused){st.textContent='PAUSED (Phase '+phase+')';st.style.color='#f39c12';}
    else if(inP){st.textContent=phaseNames[phase]||'PHASE '+phase;st.style.color='#3498db';}
    else if(e.get('CONV_RUN')){st.textContent='CONVEYOR MOVING';st.style.color='#2ecc71';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN. Stop pauses mid-phase.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
