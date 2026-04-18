/**
 * AE-13: Dual Conveyor Energy-Saving Logic
 *
 * Conv1 feeds into Conv2. PE between them.
 * If Conv2 stopped AND PE blocked → stop Conv1 (prevent buildup)
 * If PE unblocked for 20s → both enter energy-saving mode (stop)
 *
 * Rungs:
 *  R0: Conv2 command (toggle)
 *  R1: Conv1 runs IF Conv2 running OR PE not blocked (no buildup risk)
 *       BUT stop if Conv2 stopped AND PE blocked
 *  R2: TON 20s — PE unblocked timer
 *  R3: T4:0/DN → ECO_MODE (both stop)
 *  R4: Conv1 output: CONV1_CMD AND NOT ECO_MODE AND NOT (Conv2 stopped AND PE blocked)
 *  R5: Conv2 output: CONV2_CMD AND NOT ECO_MODE
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const ECO_PRE=20;
const timerSub={T0:0};
function simTON(e,en,accT,preT,enT,ttT,dnT,k){const pre=e.get(preT);let acc=e.get(accT);if(!en){e.set(accT,0);e.set(enT,false);e.set(ttT,false);e.set(dnT,false);timerSub[k]=0;return{en:false};}e.set(enT,true);if(acc>=pre){e.set(ttT,false);e.set(dnT,true);return{en:true};}timerSub[k]++;if(timerSub[k]>=timeScale){acc++;e.set(accT,acc);timerSub[k]=0;}const d=acc>=pre;e.set(ttT,!d);e.set(dnT,d);return{en:true};}

plc.defineRegister('I:0/0','PE_SENSOR','BOOL',false,'Photoeye between conveyors');
plc.defineRegister('B3:0/0','CONV1_CMD','BOOL',true,'Conv1 run command');
plc.defineRegister('B3:0/1','CONV2_CMD','BOOL',true,'Conv2 run command');
plc.defineRegister('B3:0/2','ECO_MODE','BOOL',false,'Energy-saving mode active');
plc.defineRegister('B3:0/3','BUILDUP_STOP','BOOL',false,'Conv1 stopped due to buildup');
plc.defineRegister('O:0/0','CONV1_MOTOR','BOOL',false,'Conv1 motor output');
plc.defineRegister('O:0/1','CONV2_MOTOR','BOOL',false,'Conv2 motor output');
plc.defineRegister('T4:0.PRE','T4_0_PRE','INT',ECO_PRE,'Eco timer preset (20s)');
plc.defineRegister('T4:0.ACC','T4_0_ACC','INT',0,'Eco timer accumulated');
plc.defineRegister('T4:0/EN','T4_0_EN','BOOL',false,'Eco timer enable');
plc.defineRegister('T4:0/TT','T4_0_TT','BOOL',false,'Eco timer timing');
plc.defineRegister('T4:0/DN','T4_0_DN','BOOL',false,'Eco timer done');

// R0: Buildup detection — Conv2 stopped AND PE blocked
plc.addRung(new Rung(0,'NOT CONV2_MOTOR AND PE_SENSOR → BUILDUP_STOP',
    [{type:'contact-nc',tag:'CONV2_MOTOR',label:'CONV2 (NC)'},{type:'contact-no',tag:'PE_SENSOR',label:'PE_SENSOR'}],
    [{type:'coil-out',tag:'BUILDUP_STOP',label:'BUILDUP_STOP'}],
    (e)=>{const c2=e.get('CONV2_MOTOR'),pe=e.get('PE_SENSOR');const on=!c2&&pe;e.set('BUILDUP_STOP',on);
    const log=[];if(on!==e.registers['BUILDUP_STOP'].prevValue)log.push({type:'action',message:on?'BUILDUP — Conv1 stopped (Conv2 down + PE blocked)':'Buildup cleared'});
    return{energized:on,conditionStates:[!c2,pe],outputStates:[on],log};}
));

// R1: Eco timer — PE unblocked starts 20s countdown
plc.addRung(new Rung(1,'TON T4:0: NOT PE_SENSOR enables 20s eco timer',
    [{type:'contact-nc',tag:'PE_SENSOR',label:'PE_SENSOR (NC)'}],
    [{type:'coil-out',tag:'T4_0_EN',label:'TON T4:0 (20s)'}],
    (e)=>{const noPE=!e.get('PE_SENSOR');simTON(e,noPE,'T4_0_ACC','T4_0_PRE','T4_0_EN','T4_0_TT','T4_0_DN','T0');
    return{energized:noPE,conditionStates:[noPE],outputStates:[noPE],log:[]};}
));

// R2: Eco mode — timer done
plc.addRung(new Rung(2,'T4:0/DN → ECO_MODE (both conveyors idle)',
    [{type:'contact-no',tag:'T4_0_DN',label:'T4:0/DN'}],
    [{type:'coil-out',tag:'ECO_MODE',label:'ECO_MODE'}],
    (e)=>{const dn=e.get('T4_0_DN');e.set('ECO_MODE',dn);
    const log=[];if(dn&&!e.registers['ECO_MODE'].prevValue)log.push({type:'action',message:'ECO MODE — no product for 20s, conveyors idle'});
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

// R3: PE blocked → clear eco mode (product detected, wake up)
plc.addRung(new Rung(3,'PE_SENSOR → clear ECO_MODE (wake up)',
    [{type:'contact-no',tag:'PE_SENSOR',label:'PE_SENSOR'}],
    [{type:'coil-out',tag:'ECO_MODE',label:'clear ECO'}],
    (e)=>{const pe=e.get('PE_SENSOR');if(pe&&e.get('ECO_MODE')){e.set('ECO_MODE',false);
    return{energized:true,conditionStates:[true],outputStates:[true],log:[{type:'action',message:'Product detected — exiting ECO mode'}]};}
    return{energized:pe,conditionStates:[pe],outputStates:[pe],log:[]};}
));

// R4: Conv1 output
plc.addRung(new Rung(4,'CONV1_CMD AND NOT ECO_MODE AND NOT BUILDUP_STOP → CONV1_MOTOR',
    [{type:'contact-no',tag:'CONV1_CMD',label:'CONV1_CMD'},{type:'contact-nc',tag:'ECO_MODE',label:'ECO (NC)'},{type:'contact-nc',tag:'BUILDUP_STOP',label:'BUILDUP (NC)'}],
    [{type:'coil-out',tag:'CONV1_MOTOR',label:'CONV1_MOTOR'}],
    (e)=>{const cmd=e.get('CONV1_CMD'),eco=e.get('ECO_MODE'),bu=e.get('BUILDUP_STOP');const on=cmd&&!eco&&!bu;e.set('CONV1_MOTOR',on);
    return{energized:on,conditionStates:[cmd,!eco,!bu],outputStates:[on],log:[]};}
));

// R5: Conv2 output
plc.addRung(new Rung(5,'CONV2_CMD AND NOT ECO_MODE → CONV2_MOTOR',
    [{type:'contact-no',tag:'CONV2_CMD',label:'CONV2_CMD'},{type:'contact-nc',tag:'ECO_MODE',label:'ECO (NC)'}],
    [{type:'coil-out',tag:'CONV2_MOTOR',label:'CONV2_MOTOR'}],
    (e)=>{const cmd=e.get('CONV2_CMD'),eco=e.get('ECO_MODE');const on=cmd&&!eco;e.set('CONV2_MOTOR',on);
    return{energized:on,conditionStates:[cmd,!eco],outputStates:[on],log:[]};}
));

function updateUI(e){
    const c1=e.get('CONV1_MOTOR'),c2=e.get('CONV2_MOTOR'),pe=e.get('PE_SENSOR'),eco=e.get('ECO_MODE'),bu=e.get('BUILDUP_STOP');
    document.getElementById('conv1-belt').className='conv-belt'+(c1?' running':'');
    document.getElementById('conv2-belt').className='conv-belt'+(c2?' running':'');
    document.getElementById('conv1-ind').className='conv-motor-ind'+(c1?' on':'');
    document.getElementById('conv2-ind').className='conv-motor-ind'+(c2?' on':'');
    document.getElementById('pe-beam').className='pe-beam'+(pe?' blocked':'');
    document.getElementById('item-box').className='item-box'+(pe?' present':'');
    document.getElementById('c1-box').className='equip-box'+(c1?' active':(bu?' blocked':''));
    document.getElementById('c1-status').textContent=c1?'RUNNING':(bu?'BUILDUP STOP':'OFF');
    document.getElementById('c2-box').className='equip-box'+(c2?' active':'');
    document.getElementById('c2-status').textContent=c2?'RUNNING':'OFF';
    document.getElementById('pe-box').className='equip-box'+(pe?' blocked':'');
    document.getElementById('pe-status').textContent=pe?'BLOCKED':'CLEAR';
    document.getElementById('eco-box').className='equip-box'+(eco?' eco':'');
    document.getElementById('eco-status').textContent=eco?'ACTIVE':'OFF';
    const acc=e.get('T4_0_ACC');
    document.getElementById('eco-bar').style.width=(acc/ECO_PRE*100)+'%';
    document.getElementById('eco-time').textContent=`${acc} / ${ECO_PRE}s`;
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);updateRT(e);updateSL(e);
}
function updateRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function updateSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Both conveyors start running. Toggle PE or Conv2 to test.</div>';}

function toggleConv2(){plc.set('CONV2_CMD',!plc.get('CONV2_CMD'));plc.scan();}
function togglePE(){plc.set('PE_SENSOR',!plc.get('PE_SENSOR'));plc.scan();}
function startBoth(){plc.set('CONV1_CMD',true);plc.set('CONV2_CMD',true);plc.set('ECO_MODE',false);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}

plc.onChange(updateUI);ladder.render(plc.rungs);updateRT(plc);updateSL(plc);plc.scan();
