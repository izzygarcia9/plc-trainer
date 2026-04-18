/**
 * SAE-11: Weight-Based Sorting System
 * Light: 0-5kg, Medium: 5-15kg, Heavy: 15+kg
 * Dedicated output per range, counters per category + total.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','ITEM_PRESENT','BOOL',false,'Item on scale');
plc.defineRegister('N7:0','WEIGHT','INT',0,'Item weight (kg)');
plc.defineRegister('O:0/0','DIVERT_LIGHT','BOOL',false,'Light conveyor output');
plc.defineRegister('O:0/1','DIVERT_MED','BOOL',false,'Medium conveyor output');
plc.defineRegister('O:0/2','DIVERT_HEAVY','BOOL',false,'Heavy conveyor output');
plc.defineRegister('N7:1','CNT_LIGHT','INT',0,'Light count');
plc.defineRegister('N7:2','CNT_MED','INT',0,'Medium count');
plc.defineRegister('N7:3','CNT_HEAVY','INT',0,'Heavy count');
plc.defineRegister('N7:4','CNT_TOTAL','INT',0,'Total items');
plc.defineRegister('B3:0/0','ITEM_PREV','BOOL',false,'Item prev scan');
plc.defineRegister('B3:0/1','ITEM_OSR','BOOL',false,'Item one-shot');

// R0: Item OSR
plc.addRung(new Rung(0,'ITEM_PRESENT OSR',
    [{type:'contact-no',tag:'ITEM_PRESENT',label:'ITEM'},{type:'contact-nc',tag:'ITEM_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'ITEM_OSR',label:'ITEM_OSR'}],
    (e)=>{const s=e.get('ITEM_PRESENT'),p=e.get('ITEM_PREV');const osr=s&&!p;e.set('ITEM_OSR',osr);e.set('ITEM_PREV',s);
    return{energized:osr,conditionStates:[s,!p],outputStates:[osr],log:[]};}
));

// R1: Light: weight > 0 AND weight <= 5
plc.addRung(new Rung(1,'ITEM_OSR AND WEIGHT <= 5 → DIVERT_LIGHT, CNT_LIGHT++',
    [{type:'contact-no',tag:'ITEM_OSR',label:'OSR'},{type:'compare-lt',tag:'WEIGHT',label:'W <= 5',compareValue:'6'}],
    [{type:'coil-out',tag:'DIVERT_LIGHT',label:'LIGHT'}],
    (e)=>{const osr=e.get('ITEM_OSR'),w=e.get('WEIGHT');const on=osr&&w>0&&w<=5;
    e.set('DIVERT_LIGHT',on);if(on){e.set('CNT_LIGHT',e.get('CNT_LIGHT')+1);e.set('CNT_TOTAL',e.get('CNT_TOTAL')+1);}
    return{energized:on,conditionStates:[osr,w<=5],outputStates:[on],log:on?[{type:'action',message:`LIGHT — ${w}kg → light conveyor (#${e.get('CNT_LIGHT')})`}]:[]};}
));

// R2: Medium: weight > 5 AND weight <= 15
plc.addRung(new Rung(2,'ITEM_OSR AND WEIGHT > 5 AND WEIGHT <= 15 → DIVERT_MED',
    [{type:'contact-no',tag:'ITEM_OSR',label:'OSR'},{type:'compare-gt',tag:'WEIGHT',label:'W > 5',compareValue:'5'}],
    [{type:'coil-out',tag:'DIVERT_MED',label:'MEDIUM'}],
    (e)=>{const osr=e.get('ITEM_OSR'),w=e.get('WEIGHT');const on=osr&&w>5&&w<=15;
    e.set('DIVERT_MED',on);if(on){e.set('CNT_MED',e.get('CNT_MED')+1);e.set('CNT_TOTAL',e.get('CNT_TOTAL')+1);}
    return{energized:on,conditionStates:[osr,w>5&&w<=15],outputStates:[on],log:on?[{type:'action',message:`MEDIUM — ${w}kg → medium conveyor (#${e.get('CNT_MED')})`}]:[]};}
));

// R3: Heavy: weight > 15
plc.addRung(new Rung(3,'ITEM_OSR AND WEIGHT > 15 → DIVERT_HEAVY',
    [{type:'contact-no',tag:'ITEM_OSR',label:'OSR'},{type:'compare-gt',tag:'WEIGHT',label:'W > 15',compareValue:'15'}],
    [{type:'coil-out',tag:'DIVERT_HEAVY',label:'HEAVY'}],
    (e)=>{const osr=e.get('ITEM_OSR'),w=e.get('WEIGHT');const on=osr&&w>15;
    e.set('DIVERT_HEAVY',on);if(on){e.set('CNT_HEAVY',e.get('CNT_HEAVY')+1);e.set('CNT_TOTAL',e.get('CNT_TOTAL')+1);}
    return{energized:on,conditionStates:[osr,w>15],outputStates:[on],log:on?[{type:'action',message:`HEAVY — ${w}kg → heavy conveyor (#${e.get('CNT_HEAVY')})`}]:[]};}
));

// R4: Clear item after processing
plc.addRung(new Rung(4,'ITEM_OSR → clear ITEM_PRESENT for next',
    [{type:'contact-no',tag:'ITEM_OSR',label:'OSR'}],
    [{type:'coil-out',tag:'ITEM_PRESENT',label:'clear item'}],
    (e)=>{if(e.get('ITEM_OSR'))e.set('ITEM_PRESENT',false);
    return{energized:e.get('ITEM_OSR'),conditionStates:[e.get('ITEM_OSR')],outputStates:[e.get('ITEM_OSR')],log:[]};}
));

function sendItem(w){plc.set('WEIGHT',w);plc.set('ITEM_PRESENT',true);plc.scan();}
function resetAll(){plc.set('CNT_LIGHT',0);plc.set('CNT_MED',0);plc.set('CNT_HEAVY',0);plc.set('CNT_TOTAL',0);plc.notifyListeners();}

function updateUI(e){
    const w=e.get('WEIGHT'),dl=e.get('DIVERT_LIGHT'),dm=e.get('DIVERT_MED'),dh=e.get('DIVERT_HEAVY');
    document.getElementById('weight-val').textContent=w;
    document.getElementById('light-box').className='equip-box'+(dl?' on':'');document.getElementById('light-status').textContent=dl?'ACTIVE':'OFF';document.getElementById('light-cnt').textContent=e.get('CNT_LIGHT');
    document.getElementById('med-box').className='equip-box'+(dm?' on':'');document.getElementById('med-status').textContent=dm?'ACTIVE':'OFF';document.getElementById('med-cnt').textContent=e.get('CNT_MED');
    document.getElementById('heavy-box').className='equip-box'+(dh?' on':'');document.getElementById('heavy-status').textContent=dh?'ACTIVE':'OFF';document.getElementById('heavy-cnt').textContent=e.get('CNT_HEAVY');
    document.getElementById('total-cnt').textContent=e.get('CNT_TOTAL');
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Send items to sort by weight.</div>';}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
