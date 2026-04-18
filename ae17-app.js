/**
 * AE-17: Metal Detector Reject Arm
 *
 * Metal sensor detects metal box → 2s delay (TON) → arm activates for 1s (TON) → auto-reset
 *
 * R0: METAL_SENSOR OSR → latch METAL_DETECTED
 * R1: METAL_DETECTED → TON T4:0 (2s delay)
 * R2: T4:0/DN → ARM_ON, TON T4:1 (1s arm)
 * R3: T4:1/DN → clear METAL_DETECTED, ARM_ON, count reject
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);}

plc.defineRegister('I:0/0','METAL_SENSOR','BOOL',false,'Metal sensor (momentary)');
plc.defineRegister('B3:0/0','METAL_PREV','BOOL',false,'Sensor prev');
plc.defineRegister('B3:0/1','METAL_OSR','BOOL',false,'Sensor one-shot');
plc.defineRegister('B3:0/2','METAL_DETECTED','BOOL',false,'Metal detected latch');
plc.defineRegister('O:0/0','ARM_ON','BOOL',false,'Reject arm output');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',2,'Delay preset (2s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'Delay accumulated');
plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'Delay done');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',1,'Arm preset (1s)');
plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'Arm accumulated');
plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'Arm done');
plc.defineRegister('N7:0','REJECT_CNT','INT',0,'Reject count');

plc.addRung(new Rung(0,'METAL_SENSOR OSR → latch METAL_DETECTED',
    [{type:'contact-no',tag:'METAL_SENSOR',label:'METAL'},{type:'contact-nc',tag:'METAL_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'METAL_DETECTED',label:'METAL_DETECTED'}],
    (e)=>{const s=e.get('METAL_SENSOR'),p=e.get('METAL_PREV');const osr=s&&!p;e.set('METAL_OSR',osr);
    if(osr&&!e.get('METAL_DETECTED'))e.set('METAL_DETECTED',true);
    e.set('METAL_PREV',s);e.set('METAL_SENSOR',false);
    return{energized:osr,conditionStates:[s,!p],outputStates:[osr],log:osr?[{type:'action',message:'METAL DETECTED — starting 2s delay'}]:[]};}
));

plc.addRung(new Rung(1,'METAL_DETECTED → TON T4:0 (2s delay)',
    [{type:'contact-no',tag:'METAL_DETECTED',label:'METAL_DET'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON T4:0 (2s)'}],
    (e)=>{simTON(e,e.get('METAL_DETECTED'),'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    return{energized:e.get('METAL_DETECTED'),conditionStates:[e.get('METAL_DETECTED')],outputStates:[e.get('T0_EN')],log:[]};}
));

plc.addRung(new Rung(2,'T4:0/DN → ARM_ON, TON T4:1 (1s arm)',
    [{type:'contact-no',tag:'T0_DN',label:'T4:0/DN'}],
    [{type:'coil-out',tag:'ARM_ON',label:'ARM_ON + TON 1s'}],
    (e)=>{const dn=e.get('T0_DN');const armOn=dn&&!e.get('T1_DN');e.set('ARM_ON',armOn);
    simTON(e,dn,'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    const log=[];if(armOn&&!e.registers['ARM_ON'].prevValue)log.push({type:'action',message:'REJECT ARM ACTIVATED (1s)'});
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

plc.addRung(new Rung(3,'T4:1/DN → clear all, count reject, ready for next',
    [{type:'contact-no',tag:'T1_DN',label:'T4:1/DN'}],
    [{type:'coil-out',tag:'METAL_DETECTED',label:'RESET cycle'}],
    (e)=>{const dn=e.get('T1_DN');
    if(dn&&e.get('METAL_DETECTED')){e.set('METAL_DETECTED',false);e.set('ARM_ON',false);e.set('REJECT_CNT',e.get('REJECT_CNT')+1);}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log:dn&&e.registers['METAL_DETECTED'].prevValue?[{type:'action',message:`Reject complete (#${e.get('REJECT_CNT')}) — ready for next`}]:[]};}
));

function detectMetal(){plc.set('METAL_SENSOR',true);plc.scan();}

function updateUI(e){
    const det=e.get('METAL_DETECTED'),arm=e.get('ARM_ON');
    document.getElementById('metal-dot').className='pe-dot'+(det?' warn':'');
    document.getElementById('arm-ind').className='arm-indicator'+(arm?' active':'');
    document.getElementById('det-box').className='equip-box'+(det?' warn':'');document.getElementById('det-status').textContent=det?'DETECTED':'CLEAR';
    document.getElementById('arm-box').className='equip-box'+(arm?' active':'');document.getElementById('arm-status').textContent=arm?'EXTENDED':'OFF';
    document.getElementById('delay-bar').style.width=(e.get('T0_ACC')/2*100)+'%';document.getElementById('delay-time').textContent=e.get('T0_ACC')+'/2s';
    document.getElementById('arm-bar').style.width=(e.get('T1_ACC')/1*100)+'%';document.getElementById('arm-time').textContent=e.get('T1_ACC')+'/1s';
    const st=document.getElementById('state-display');if(arm){st.textContent='REJECTING';st.style.color='#e74c3c';}else if(det){st.textContent='DELAY';st.style.color='#f39c12';}else{st.textContent='READY';st.style.color='#2ecc71';}
    document.getElementById('rej-count').textContent=e.get('REJECT_CNT');
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Click Metal Detected then RUN.</div>';}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
