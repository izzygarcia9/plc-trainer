/**
 * AE-16: Pallet Counter with Conveyor Control
 *
 * Pallet_Sensor detects pallet → CTU (one-shot debounced)
 * Count reaches 3 → conveyor stops
 * Clear_Button → reset counter, resume conveyor
 *
 * R0: Sensor OSR (debounce — one count per pallet)
 * R1: OSR → CTU PKG_COUNT + 1
 * R2: PKG_COUNT >= 3 → FULL_FLAG
 * R3: CONV_CMD AND NOT FULL_FLAG → CONV_MOTOR
 * R4: CLEAR_PB → reset counter, clear FULL_FLAG
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','PALLET_SENSOR','BOOL',false,'Pallet sensor (momentary)');
plc.defineRegister('I:0/1','CLEAR_PB','BOOL',false,'Clear/Reset button');
plc.defineRegister('B3:0/0','SENSOR_PREV','BOOL',false,'Sensor prev scan');
plc.defineRegister('B3:0/1','SENSOR_OSR','BOOL',false,'Sensor one-shot');
plc.defineRegister('B3:0/2','CONV_CMD','BOOL',true,'Conveyor run command');
plc.defineRegister('B3:0/3','FULL_FLAG','BOOL',false,'3 pallets reached');
plc.defineRegister('O:0/0','CONV_MOTOR','BOOL',false,'Conveyor motor output');
plc.defineRegister('N7:0','PKG_COUNT','INT',0,'Pallet count (0-3)');

plc.addRung(new Rung(0,'Sensor OSR: PALLET_SENSOR AND NOT PREV',
    [{type:'contact-no',tag:'PALLET_SENSOR',label:'SENSOR'},{type:'contact-nc',tag:'SENSOR_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'SENSOR_OSR',label:'SENSOR_OSR'}],
    (e)=>{const s=e.get('PALLET_SENSOR'),p=e.get('SENSOR_PREV');const osr=s&&!p;e.set('SENSOR_OSR',osr);
    e.set('SENSOR_PREV',s);e.set('PALLET_SENSOR',false);
    return{energized:osr,conditionStates:[s,!p],outputStates:[osr],log:osr?[{type:'action',message:'Pallet detected (debounced)'}]:[]};}
));

plc.addRung(new Rung(1,'SENSOR_OSR AND NOT FULL → CTU PKG_COUNT + 1',
    [{type:'contact-no',tag:'SENSOR_OSR',label:'OSR'},{type:'contact-nc',tag:'FULL_FLAG',label:'FULL (NC)'}],
    [{type:'math-add',tag:'PKG_COUNT',label:'COUNT + 1'}],
    (e)=>{const osr=e.get('SENSOR_OSR'),full=e.get('FULL_FLAG');const fire=osr&&!full;
    if(fire)e.set('PKG_COUNT',e.get('PKG_COUNT')+1);
    return{energized:fire,conditionStates:[osr,!full],outputStates:[fire],log:fire?[{type:'state-change',message:`Count: ${e.get('PKG_COUNT')}`}]:[]};}
));

plc.addRung(new Rung(2,'PKG_COUNT >= 3 → FULL_FLAG',
    [{type:'compare-gt',tag:'PKG_COUNT',label:'COUNT >= 3',compareValue:'3'}],
    [{type:'coil-out',tag:'FULL_FLAG',label:'FULL_FLAG'}],
    (e)=>{const full=e.get('PKG_COUNT')>=3;e.set('FULL_FLAG',full);
    const log=[];if(full&&!e.registers['FULL_FLAG'].prevValue)log.push({type:'action',message:'3 PALLETS — conveyor STOPPED'});
    return{energized:full,conditionStates:[full],outputStates:[full],log};}
));

plc.addRung(new Rung(3,'CONV_CMD AND NOT FULL_FLAG → CONV_MOTOR',
    [{type:'contact-no',tag:'CONV_CMD',label:'CONV_CMD'},{type:'contact-nc',tag:'FULL_FLAG',label:'FULL (NC)'}],
    [{type:'coil-out',tag:'CONV_MOTOR',label:'CONV_MOTOR'}],
    (e)=>{const cmd=e.get('CONV_CMD'),full=e.get('FULL_FLAG');const on=cmd&&!full;e.set('CONV_MOTOR',on);
    return{energized:on,conditionStates:[cmd,!full],outputStates:[on],log:[]};}
));

plc.addRung(new Rung(4,'CLEAR_PB → reset PKG_COUNT, clear FULL_FLAG',
    [{type:'contact-no',tag:'CLEAR_PB',label:'CLEAR_PB'}],
    [{type:'coil-out',tag:'PKG_COUNT',label:'RESET'}],
    (e)=>{const c=e.get('CLEAR_PB');if(c){e.set('PKG_COUNT',0);e.set('FULL_FLAG',false);e.set('CLEAR_PB',false);}
    return{energized:c,conditionStates:[c],outputStates:[c],log:c?[{type:'action',message:'CLEARED — counter reset, conveyor resumed'}]:[]};}
));

function updateUI(e){
    const cnt=e.get('PKG_COUNT'),full=e.get('FULL_FLAG'),conv=e.get('CONV_MOTOR');
    document.getElementById('sensor-dot').className='pe-dot'+(e.get('SENSOR_OSR')?' on':'');
    document.getElementById('count-val').textContent=cnt;
    document.getElementById('count-val').style.color=full?'#e74c3c':'#00d4ff';
    document.getElementById('conv-box').className='equip-box'+(conv?' on':'');document.getElementById('conv-status').textContent=conv?'RUNNING':'STOPPED';
    document.getElementById('full-box').className='equip-box'+(full?' warn':'');document.getElementById('full-status').textContent=full?'FULL!':'NO';
    const icons=document.getElementById('pallet-icons');icons.innerHTML='';
    for(let i=0;i<cnt;i++)icons.innerHTML+='<span style="position:absolute;bottom:26px;left:'+(30+i*25)+'%;font-size:1rem">&#128230;</span>';
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Click Pallet Detected to count.</div>';}
function toggleConv(){plc.set('CONV_CMD',!plc.get('CONV_CMD'));plc.scan();}
function triggerSensor(){plc.set('PALLET_SENSOR',true);plc.scan();}
function pressClear(){plc.set('CLEAR_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
