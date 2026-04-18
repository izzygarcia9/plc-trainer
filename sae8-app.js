/**
 * SAE-8: Conveyor Jam Detection & Reset Horn
 * Toggle start on/off → motor runs. EE blocked 3s → JAM latch, motor stops.
 * If jammed + EE clear + reset toggled: 5s reset timer with horn. Then conveyor restarts.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_SW','BOOL',false,'Start toggle switch');
plc.defineRegister('I:0/1','EE_SENSOR','BOOL',false,'EE photo-eye (true=blocked)');
plc.defineRegister('I:0/2','RESET_SW','BOOL',false,'Reset toggle switch');
plc.defineRegister('B3:0/0','JAM_LATCH','BOOL',false,'Jam latched');
plc.defineRegister('B3:0/1','RESETTING','BOOL',false,'Reset in progress');
plc.defineRegister('O:0/0','CONV_MOTOR','BOOL',false,'Conveyor motor');
plc.defineRegister('O:0/1','HORN','BOOL',false,'Horn output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',3,'Jam timer (3s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',5,'Reset timer (5s)');
plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'');plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'');

// R0: Motor runs when START on AND NOT jammed AND NOT resetting
plc.addRung(new Rung(0,'START AND NOT JAM AND NOT RESETTING → CONV_MOTOR',
    [{type:'contact-no',tag:'START_SW',label:'START'},{type:'contact-nc',tag:'JAM_LATCH',label:'JAM (NC)'},{type:'contact-nc',tag:'RESETTING',label:'RESET (NC)'}],
    [{type:'coil-out',tag:'CONV_MOTOR',label:'CONV_MOTOR'}],
    (e)=>{const s=e.get('START_SW'),j=e.get('JAM_LATCH'),r=e.get('RESETTING');const on=s&&!j&&!r;e.set('CONV_MOTOR',on);
    return{energized:on,conditionStates:[s,!j,!r],outputStates:[on],log:[]};}
));

// R1: EE blocked + motor running → TON 3s → JAM
plc.addRung(new Rung(1,'EE blocked AND CONV_MOTOR → TON 3s jam detect',
    [{type:'contact-no',tag:'EE_SENSOR',label:'EE'},{type:'contact-no',tag:'CONV_MOTOR',label:'MOTOR'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 3s'}],
    (e)=>{const en=e.get('EE_SENSOR')&&e.get('CONV_MOTOR');simTON(e,en,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    if(e.get('T0_DN')&&!e.get('JAM_LATCH'))e.set('JAM_LATCH',true);
    return{energized:en,conditionStates:[e.get('EE_SENSOR'),e.get('CONV_MOTOR')],outputStates:[en],
    log:e.get('T0_DN')&&!e.registers['JAM_LATCH'].prevValue?[{type:'action',message:'JAM DETECTED — EE blocked >3s'}]:[]};}
));

// R2: Reset conditions: JAM + EE clear + RESET toggle → start 5s reset timer
plc.addRung(new Rung(2,'JAM AND NOT EE AND RESET → RESETTING + TON 5s',
    [{type:'contact-no',tag:'JAM_LATCH',label:'JAM'},{type:'contact-nc',tag:'EE_SENSOR',label:'EE clear (NC)'},{type:'contact-no',tag:'RESET_SW',label:'RESET'}],
    [{type:'coil-out',tag:'RESETTING',label:'RESETTING + TON 5s'}],
    (e)=>{const j=e.get('JAM_LATCH'),ee=e.get('EE_SENSOR'),r=e.get('RESET_SW');
    const en=j&&!ee&&r;e.set('RESETTING',en||e.get('RESETTING')&&!e.get('T1_DN'));
    simTON(e,e.get('RESETTING'),'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    return{energized:en,conditionStates:[j,!ee,r],outputStates:[en],
    log:en&&!e.registers['RESETTING'].prevValue?[{type:'action',message:'Reset initiated — horn ON for 5s'}]:[]};}
));

// R3: Horn during reset
plc.addRung(new Rung(3,'RESETTING AND NOT T1_DN → HORN ON',
    [{type:'contact-no',tag:'RESETTING',label:'RESETTING'},{type:'contact-nc',tag:'T1_DN',label:'T1_DN (NC)'}],
    [{type:'coil-out',tag:'HORN',label:'HORN'}],
    (e)=>{const on=e.get('RESETTING')&&!e.get('T1_DN');e.set('HORN',on);
    return{energized:on,conditionStates:[e.get('RESETTING'),!e.get('T1_DN')],outputStates:[on],log:[]};}
));

// R4: Reset timer done → clear jam, clear resetting, conveyor restarts
plc.addRung(new Rung(4,'T1_DN → clear JAM, RESETTING, HORN',
    [{type:'contact-no',tag:'T1_DN',label:'T1_DN'}],
    [{type:'coil-out',tag:'JAM_LATCH',label:'CLEAR all'}],
    (e)=>{const dn=e.get('T1_DN');if(dn){e.set('JAM_LATCH',false);e.set('RESETTING',false);e.set('HORN',false);}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log:dn&&e.registers['JAM_LATCH'].prevValue?[{type:'action',message:'Reset complete — jam cleared, conveyor restarting'}]:[]};}
));

function updateUI(e){
    const conv=e.get('CONV_MOTOR'),jam=e.get('JAM_LATCH'),horn=e.get('HORN'),rst=e.get('RESETTING'),ee=e.get('EE_SENSOR');
    document.getElementById('motor-dot').className='pe-dot'+(conv?' on':'');
    document.getElementById('pe-dot').className='pe-dot'+(ee?' warn':'');
    document.getElementById('conv-box').className='equip-box'+(conv?' on':'');document.getElementById('conv-status').textContent=conv?'RUNNING':'OFF';
    document.getElementById('jam-box').className='equip-box'+(jam?' active':'');document.getElementById('jam-status').textContent=jam?'JAM!':'OK';
    document.getElementById('horn-box').className='equip-box'+(horn?' warn':'');document.getElementById('horn-status').textContent=horn?'SOUNDING':'OFF';
    document.getElementById('reset-box').className='equip-box'+(rst?' on':'');document.getElementById('reset-status').textContent=rst?'YES':'NO';
    document.getElementById('jam-bar').style.width=(e.get('T0_ACC')/3*100)+'%';document.getElementById('jam-time').textContent=e.get('T0_ACC')+'/3s';
    document.getElementById('rst-bar').style.width=(e.get('T1_ACC')/5*100)+'%';document.getElementById('rst-time').textContent=e.get('T1_ACC')+'/5s';
    const st=document.getElementById('state-display');
    if(rst){st.textContent='RESETTING (horn)';st.style.color='#f39c12';}else if(jam){st.textContent='JAMMED';st.style.color='#e74c3c';}else if(conv){st.textContent='RUNNING';st.style.color='#2ecc71';}else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Toggle START, then block EE to trigger jam.</div>';}
function toggleStart(){plc.set('START_SW',!plc.get('START_SW'));plc.scan();}
function toggleEE(){plc.set('EE_SENSOR',!plc.get('EE_SENSOR'));plc.scan();}
function toggleReset(){plc.set('RESET_SW',!plc.get('RESET_SW'));plc.scan();}
function toggleRunPLC(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
