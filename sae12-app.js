/**
 * SAE-12: Three-Floor Elevator Control
 * Call buttons on each floor, selection buttons inside.
 * Prioritize current direction. Door open/close timers. Obstruction safety.
 * States: IDLE, MOVING, DOOR_OPEN, DOOR_CLOSING
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0,T1:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('B3:0/0','CALL_1','BOOL',false,'Floor 1 call');
plc.defineRegister('B3:0/1','CALL_2','BOOL',false,'Floor 2 call');
plc.defineRegister('B3:0/2','CALL_3','BOOL',false,'Floor 3 call');
plc.defineRegister('B3:0/3','SEL_1','BOOL',false,'Select floor 1');
plc.defineRegister('B3:0/4','SEL_2','BOOL',false,'Select floor 2');
plc.defineRegister('B3:0/5','SEL_3','BOOL',false,'Select floor 3');
plc.defineRegister('B3:0/6','DOOR_OPEN','BOOL',false,'Door is open');
plc.defineRegister('B3:0/7','MOVING','BOOL',false,'Elevator moving');
plc.defineRegister('B3:1/0','DIR_UP','BOOL',true,'Direction up');
plc.defineRegister('B3:1/1','OBSTRUCT','BOOL',false,'Door obstruction');
plc.defineRegister('N7:0','CUR_FLOOR','INT',1,'Current floor (1-3)');
plc.defineRegister('N7:1','TARGET','INT',0,'Target floor (0=none)');
plc.defineRegister('N7:2','MOVE_CNT','INT',0,'Move counter (simulates travel time)');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',3,'Door open timer (3s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');

// R0: Determine next target (prioritize current direction)
plc.addRung(new Rung(0,'Determine target: prioritize current direction of travel',
    [{type:'contact-nc',tag:'MOVING',label:'NOT MOVING'},{type:'contact-nc',tag:'DOOR_OPEN',label:'DOOR CLOSED'}],
    [{type:'coil-out',tag:'TARGET',label:'FIND TARGET'}],
    (e)=>{if(e.get('MOVING')||e.get('DOOR_OPEN'))return{energized:false,conditionStates:[false,false],outputStates:[false],log:[]};
    const cur=e.get('CUR_FLOOR'),up=e.get('DIR_UP');
    const requests=[];
    for(let f=1;f<=3;f++)if(e.get('CALL_'+f)||e.get('SEL_'+f))requests.push(f);
    if(requests.length===0){e.set('TARGET',0);return{energized:true,conditionStates:[true,true],outputStates:[true],log:[]};}
    // Prioritize current direction
    let target=0;
    if(up){const above=requests.filter(f=>f>cur).sort((a,b)=>a-b);const below=requests.filter(f=>f<cur).sort((a,b)=>b-a);
    target=above[0]||below[0]||requests[0];}
    else{const below=requests.filter(f=>f<cur).sort((a,b)=>b-a);const above=requests.filter(f=>f>cur).sort((a,b)=>a-b);
    target=below[0]||above[0]||requests[0];}
    if(target===cur){// Already here — open door
    e.set('DOOR_OPEN',true);e.set('CALL_'+cur,false);e.set('SEL_'+cur,false);e.set('TARGET',0);
    return{energized:true,conditionStates:[true,true],outputStates:[true],log:[{type:'action',message:`Already at F${cur} — door opening`}]};}
    e.set('TARGET',target);e.set('DIR_UP',target>cur);
    return{energized:true,conditionStates:[true,true],outputStates:[true],log:[]};}
));

// R1: Start moving to target
plc.addRung(new Rung(1,'TARGET != 0 AND NOT MOVING AND NOT DOOR_OPEN → start MOVING',
    [{type:'compare-gt',tag:'TARGET',label:'TARGET > 0',compareValue:'0'},{type:'contact-nc',tag:'MOVING',label:'NOT MOVING'},{type:'contact-nc',tag:'DOOR_OPEN',label:'DOOR CLOSED'}],
    [{type:'coil-out',tag:'MOVING',label:'START MOVING'}],
    (e)=>{const t=e.get('TARGET'),m=e.get('MOVING'),d=e.get('DOOR_OPEN');
    if(t>0&&!m&&!d){e.set('MOVING',true);e.set('MOVE_CNT',0);
    return{energized:true,conditionStates:[true,true,true],outputStates:[true],log:[{type:'action',message:`Moving to F${t} (${t>e.get('CUR_FLOOR')?'UP':'DOWN'})`}]};}
    return{energized:false,conditionStates:[t>0,!m,!d],outputStates:[false],log:[]};}
));

// R2: Simulate movement (3 scans per floor)
plc.addRung(new Rung(2,'MOVING → simulate travel',
    [{type:'contact-no',tag:'MOVING',label:'MOVING'}],[{type:'math-add',tag:'MOVE_CNT',label:'travel sim'}],
    (e)=>{if(!e.get('MOVING'))return{energized:false,conditionStates:[false],outputStates:[false],log:[]};
    let cnt=e.get('MOVE_CNT')+1;e.set('MOVE_CNT',cnt);
    if(cnt>=3){// Arrived at next floor
    let cur=e.get('CUR_FLOOR');const target=e.get('TARGET');
    cur+=cur<target?1:-1;e.set('CUR_FLOOR',cur);e.set('MOVE_CNT',0);
    if(cur===target){e.set('MOVING',false);e.set('DOOR_OPEN',true);e.set('TARGET',0);
    e.set('CALL_'+cur,false);e.set('SEL_'+cur,false);
    return{energized:true,conditionStates:[true],outputStates:[true],log:[{type:'action',message:`Arrived F${cur} — door opening`}]};}}
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

// R3: Door open timer (3s) then close — unless obstructed
plc.addRung(new Rung(3,'DOOR_OPEN AND NOT OBSTRUCT → TON 3s then close',
    [{type:'contact-no',tag:'DOOR_OPEN',label:'DOOR_OPEN'},{type:'contact-nc',tag:'OBSTRUCT',label:'OBSTRUCT (NC)'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 3s door'}],
    (e)=>{const en=e.get('DOOR_OPEN')&&!e.get('OBSTRUCT');
    simTON(e,en,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    if(e.get('T0_DN')){e.set('DOOR_OPEN',false);
    return{energized:true,conditionStates:[true,true],outputStates:[true],log:[{type:'action',message:'Door closed'}]};}
    return{energized:en,conditionStates:[e.get('DOOR_OPEN'),!e.get('OBSTRUCT')],outputStates:[en],log:[]};}
));

function callFloor(f){plc.set('CALL_'+f,true);plc.scan();}
function selectFloor(f){plc.set('SEL_'+f,true);plc.scan();}
function toggleObstruct(){plc.set('OBSTRUCT',!plc.get('OBSTRUCT'));plc.scan();}

const FLOOR_POS={1:'5%',2:'40%',3:'75%'};
function updateUI(e){
    const cur=e.get('CUR_FLOOR'),moving=e.get('MOVING'),doorOpen=e.get('DOOR_OPEN'),target=e.get('TARGET');
    const cab=document.getElementById('cab');cab.style.bottom=FLOOR_POS[cur]||'5%';cab.className='cab'+(moving?' moving':'');
    document.getElementById('door').className='door'+(doorOpen?' open':'');
    document.getElementById('cab-label').textContent='F'+cur;
    for(let f=1;f<=3;f++){document.getElementById('call'+f).className='call-btn'+(e.get('CALL_'+f)?' active':'');
    document.getElementById('sel'+f).className='sel-btn'+(e.get('SEL_'+f)?' active':'');}
    document.getElementById('dir-icon').textContent=moving?(e.get('DIR_UP')?'\u25B2':'\u25BC'):'\u25A0';
    document.getElementById('dir-status').textContent=moving?(e.get('DIR_UP')?'UP':'DOWN'):'IDLE';
    document.getElementById('dir-box').className='equip-box'+(moving?' on':'');
    document.getElementById('door-status').textContent=doorOpen?(e.get('OBSTRUCT')?'BLOCKED':'OPEN'):'CLOSED';
    document.getElementById('door-box').className='equip-box'+(doorOpen?' on':'')+(e.get('OBSTRUCT')?' warn':'');
    document.getElementById('floor-status').textContent=cur;
    document.getElementById('door-bar').style.width=(e.get('T0_ACC')/3*100)+'%';document.getElementById('door-time').textContent=e.get('T0_ACC')+'/3s';
    const st=document.getElementById('state-display');
    if(moving){st.textContent=`Moving ${e.get('DIR_UP')?'UP':'DOWN'} to F${target}`;st.style.color='#f39c12';}
    else if(doorOpen){st.textContent=e.get('OBSTRUCT')?'DOOR BLOCKED':'Door open at F'+cur;st.style.color=e.get('OBSTRUCT')?'#e74c3c':'#3498db';}
    else{st.textContent='Idle at F'+cur;st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Click call/select buttons then RUN.</div>';}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
