/**
 * AE-15: Conveyor Inspection — Size Reject with 5s Delay
 *
 * Entry_Sensor detects package. Size_Sensor flags oversized (TRUE).
 * 5s delay simulates travel to reject station.
 * If oversized, Reject_Actuator fires for 1s.
 *
 * R0: ENTRY_SENSOR OSR → capture SIZE_SENSOR into OVERSIZED latch
 * R1: OVERSIZED → start TON T4:0 (5s travel delay)
 * R2: T4:0/DN → REJECT_ARM ON, start TON T4:1 (1s arm duration)
 * R3: T4:1/DN → clear REJECT_ARM, clear OVERSIZED, reset
 * R4: NOT OVERSIZED after reject → increment PASS or REJECT counter
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);}

plc.defineRegister('I:0/0','ENTRY_SENSOR','BOOL',false,'Entry photoeye (momentary)');
plc.defineRegister('I:0/1','SIZE_SENSOR','BOOL',false,'Size sensor (TRUE=oversized)');
plc.defineRegister('B3:0/0','ENTRY_PREV','BOOL',false,'Entry prev scan');
plc.defineRegister('B3:0/1','ENTRY_OSR','BOOL',false,'Entry one-shot');
plc.defineRegister('B3:0/2','OVERSIZED','BOOL',false,'Oversized package latched');
plc.defineRegister('B3:0/3','REJECT_ACTIVE','BOOL',false,'Reject arm active');
plc.defineRegister('O:0/0','REJECT_ARM','BOOL',false,'Reject actuator output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',5,'Travel delay preset (5s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'Travel delay accumulated');
plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'Travel delay done');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',1,'Arm duration preset (1s)');
plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'Arm duration accumulated');
plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'Arm duration done');
plc.defineRegister('N7:0','REJECT_CNT','INT',0,'Rejected count');
plc.defineRegister('N7:1','PASS_CNT','INT',0,'Passed count');

// R0: Entry OSR + capture size
plc.addRung(new Rung(0,'ENTRY OSR → if SIZE_SENSOR, latch OVERSIZED',
    [{type:'contact-no',tag:'ENTRY_SENSOR',label:'ENTRY'},{type:'contact-nc',tag:'ENTRY_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'OVERSIZED',label:'capture SIZE'}],
    (e)=>{const s=e.get('ENTRY_SENSOR'),p=e.get('ENTRY_PREV');const osr=s&&!p;e.set('ENTRY_OSR',osr);
    if(osr){const big=e.get('SIZE_SENSOR');e.set('OVERSIZED',big);
    if(!big)e.set('PASS_CNT',e.get('PASS_CNT')+1);}
    e.set('ENTRY_PREV',s);e.set('ENTRY_SENSOR',false);
    return{energized:osr,conditionStates:[s,!p],outputStates:[osr],log:osr?[{type:'action',message:e.get('SIZE_SENSOR')?'OVERSIZED package detected!':'OK package — passed'}]:[]};}
));

// R1: OVERSIZED → TON 5s delay
plc.addRung(new Rung(1,'OVERSIZED → TON T4:0 (5s travel delay)',
    [{type:'contact-no',tag:'OVERSIZED',label:'OVERSIZED'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON T4:0 (5s)'}],
    (e)=>{simTON(e,e.get('OVERSIZED'),'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    return{energized:e.get('OVERSIZED'),conditionStates:[e.get('OVERSIZED')],outputStates:[e.get('T0_EN')],log:[]};}
));

// R2: Delay done → arm on + start 1s arm timer
plc.addRung(new Rung(2,'T4:0/DN → REJECT_ARM ON, TON T4:1 (1s)',
    [{type:'contact-no',tag:'T0_DN',label:'T4:0/DN'}],
    [{type:'coil-out',tag:'REJECT_ARM',label:'REJECT_ARM + TON 1s'}],
    (e)=>{const dn=e.get('T0_DN');e.set('REJECT_ARM',dn&&!e.get('T1_DN'));
    simTON(e,dn,'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    const log=[];if(dn&&!e.registers['REJECT_ARM'].prevValue&&!e.get('T1_DN'))log.push({type:'action',message:'REJECT ARM EXTENDED'});
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

// R3: Arm timer done → clear everything, count reject
plc.addRung(new Rung(3,'T4:1/DN → clear OVERSIZED, REJECT_ARM, count reject',
    [{type:'contact-no',tag:'T1_DN',label:'T4:1/DN'}],
    [{type:'coil-out',tag:'OVERSIZED',label:'RESET cycle'}],
    (e)=>{const dn=e.get('T1_DN');
    if(dn&&e.get('OVERSIZED')){e.set('OVERSIZED',false);e.set('REJECT_ARM',false);e.set('REJECT_CNT',e.get('REJECT_CNT')+1);}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log:dn&&e.registers['OVERSIZED'].prevValue?[{type:'action',message:`Package REJECTED (#${e.get('REJECT_CNT')})`}]:[]};}
));

function sendPackage(oversized){plc.set('SIZE_SENSOR',oversized);plc.set('ENTRY_SENSOR',true);plc.scan();}

function updateUI(e){
    const os=e.get('OVERSIZED'),arm=e.get('REJECT_ARM'),entry=e.get('ENTRY_OSR');
    document.getElementById('entry-dot').className='pe-dot'+(entry?' on':'');
    document.getElementById('size-dot').className='pe-dot'+(e.get('SIZE_SENSOR')?' warn':'');
    document.getElementById('arm-ind').className='arm-indicator'+(arm?' active':'');
    document.getElementById('entry-box').className='equip-box'+(entry?' on':'');document.getElementById('entry-status').textContent=entry?'DETECTED':'CLEAR';
    document.getElementById('size-box').className='equip-box'+(os?' warn':'');document.getElementById('size-status').textContent=os?'OVERSIZED':'OK';
    document.getElementById('arm-box').className='equip-box'+(arm?' active':'');document.getElementById('arm-status').textContent=arm?'EXTENDED':'RETRACTED';
    document.getElementById('delay-bar').style.width=(e.get('T0_ACC')/5*100)+'%';document.getElementById('delay-time').textContent=e.get('T0_ACC')+'/5s';
    document.getElementById('arm-bar').style.width=(e.get('T1_ACC')/1*100)+'%';document.getElementById('arm-time').textContent=e.get('T1_ACC')+'/1s';
    const st=document.getElementById('state-display');if(arm){st.textContent='REJECTING';st.style.color='#e74c3c';}else if(os){st.textContent='DELAY';st.style.color='#f39c12';}else{st.textContent='READY';st.style.color='#2ecc71';}
    document.getElementById('reject-count').textContent=e.get('REJECT_CNT');document.getElementById('pass-count').textContent=e.get('PASS_CNT');
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Send a package to start.</div>';}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
