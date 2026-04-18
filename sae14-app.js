/**
 * SAE-14: Sequential Water Tank Filling (3 Tanks)
 * Fill T1 until HI, then T2, then T3. Stop when all full.
 * Manual override per tank.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System running');
plc.defineRegister('B3:0/1','FILL_T1','BOOL',false,'Filling tank 1');
plc.defineRegister('B3:0/2','FILL_T2','BOOL',false,'Filling tank 2');
plc.defineRegister('B3:0/3','FILL_T3','BOOL',false,'Filling tank 3');
plc.defineRegister('B3:0/4','ALL_FULL','BOOL',false,'All tanks full');
plc.defineRegister('B3:0/5','OVR_1','BOOL',false,'Manual override T1');
plc.defineRegister('B3:0/6','OVR_2','BOOL',false,'Manual override T2');
plc.defineRegister('B3:0/7','OVR_3','BOOL',false,'Manual override T3');
for(let i=1;i<=3;i++){
    plc.defineRegister(`N7:${i-1}`,`LVL_${i}`,'INT',0,`Tank ${i} level (0-100)`);
    plc.defineRegister(`B3:1/${(i-1)*2}`,`T${i}_HI`,'BOOL',false,`Tank ${i} high level`);
    plc.defineRegister(`B3:1/${(i-1)*2+1}`,`T${i}_LO`,'BOOL',false,`Tank ${i} low level`);
}
plc.defineRegister('O:0/0','VALVE_1','BOOL',false,'Valve 1');
plc.defineRegister('O:0/1','VALVE_2','BOOL',false,'Valve 2');
plc.defineRegister('O:0/2','VALVE_3','BOOL',false,'Valve 3');

plc.addRung(new Rung(0,'Start/Stop',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'ALL_FULL',label:'FULL (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),f=e.get('ALL_FULL');
    const on=(s||r)&&!st&&!f;e.set('SYS_RUN',on);
    if(s&&!r){e.set('FILL_T1',true);e.set('FILL_T2',false);e.set('FILL_T3',false);}
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    return{energized:on,conditionStates:[s,r,!st,!f],outputStates:[on],log:on&&!r?[{type:'action',message:'Started — filling Tank 1'}]:[]};}
));

plc.addRung(new Rung(1,'Sequential: T1 full → T2, T2 full → T3',
    [{type:'contact-no',tag:'SYS_RUN',label:'RUN'}],[{type:'coil-out',tag:'FILL_T1',label:'SEQ'}],
    (e)=>{if(!e.get('SYS_RUN'))return{energized:false,conditionStates:[false],outputStates:[false],log:[]};
    const log=[];
    if(e.get('FILL_T1')&&e.get('T1_HI')){e.set('FILL_T1',false);e.set('FILL_T2',true);log.push({type:'action',message:'Tank 1 FULL → filling Tank 2'});}
    if(e.get('FILL_T2')&&e.get('T2_HI')){e.set('FILL_T2',false);e.set('FILL_T3',true);log.push({type:'action',message:'Tank 2 FULL → filling Tank 3'});}
    if(e.get('FILL_T3')&&e.get('T3_HI')){e.set('FILL_T3',false);e.set('ALL_FULL',true);e.set('SYS_RUN',false);log.push({type:'action',message:'Tank 3 FULL → ALL TANKS FULL'});}
    return{energized:true,conditionStates:[true],outputStates:[true],log};}
));

plc.addRung(new Rung(2,'Valve outputs (auto + manual override)',
    [{type:'contact-no',tag:'SYS_RUN',label:'any'}],[{type:'coil-out',tag:'VALVE_1',label:'VALVES'}],
    (e)=>{e.set('VALVE_1',(e.get('FILL_T1')&&e.get('SYS_RUN'))||e.get('OVR_1'));
    e.set('VALVE_2',(e.get('FILL_T2')&&e.get('SYS_RUN'))||e.get('OVR_2'));
    e.set('VALVE_3',(e.get('FILL_T3')&&e.get('SYS_RUN'))||e.get('OVR_3'));
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

plc.addRung(new Rung(3,'Simulate tank levels + update sensors',
    [{type:'contact-no',tag:'VALVE_1',label:'any valve'}],[{type:'math-add',tag:'LVL_1',label:'SIM'}],
    (e)=>{for(let i=1;i<=3;i++){let lv=e.get('LVL_'+i);if(e.get('VALVE_'+i))lv=Math.min(100,lv+2);
    e.set('LVL_'+i,lv);e.set('T'+i+'_HI',lv>=90);e.set('T'+i+'_LO',lv>=15);}
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

function manualOverride(n){plc.set('OVR_'+n,!plc.get('OVR_'+n));plc.scan();}
function drainAll(){for(let i=1;i<=3;i++){plc.set('LVL_'+i,0);plc.set('T'+i+'_HI',false);plc.set('T'+i+'_LO',false);}plc.set('ALL_FULL',false);plc.notifyListeners();}

function updateUI(e){
    for(let i=1;i<=3;i++){document.getElementById('w'+i).style.height=e.get('LVL_'+i)+'%';
    document.getElementById('v'+i).className='tk-valve'+(e.get('VALVE_'+i)?' open':'');
    document.getElementById('h'+i).className='tk-hi'+(e.get('T'+i+'_HI')?' on':'');
    document.getElementById('l'+i).className='tk-lo'+(e.get('T'+i+'_LO')?' on':'');}
    const st=document.getElementById('state-display');
    if(e.get('ALL_FULL')){st.textContent='ALL FULL';st.style.color='#f1c40f';}
    else if(e.get('FILL_T1')){st.textContent='FILLING T1';st.style.color='#3498db';}
    else if(e.get('FILL_T2')){st.textContent='FILLING T2';st.style.color='#3498db';}
    else if(e.get('FILL_T3')){st.textContent='FILLING T3';st.style.color='#3498db';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Drain tanks, then START + RUN.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
