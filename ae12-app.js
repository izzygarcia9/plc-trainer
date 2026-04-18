/**
 * AE-12: Spiral Package Counter with Jam Detection
 *
 * PE1 (top) → CTU (count up) on rising edge
 * PE2 (bottom) → CTD (count down) on rising edge
 * If counter >= 10 → JAM_ALARM (OTE)
 * RESET_PB → clear jam and reset counter
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300;

plc.defineRegister('I:0/0','PE1','BOOL',false,'PE1 entry sensor (momentary pulse)');
plc.defineRegister('I:0/1','PE2','BOOL',false,'PE2 exit sensor (momentary pulse)');
plc.defineRegister('I:0/2','RESET_PB','BOOL',false,'Reset pushbutton');
plc.defineRegister('B3:0/0','PE1_PREV','BOOL',false,'PE1 previous scan (edge detect)');
plc.defineRegister('B3:0/1','PE2_PREV','BOOL',false,'PE2 previous scan (edge detect)');
plc.defineRegister('B3:0/2','PE1_OSR','BOOL',false,'PE1 one-shot rising');
plc.defineRegister('B3:0/3','PE2_OSR','BOOL',false,'PE2 one-shot rising');
plc.defineRegister('O:0/0','JAM_ALARM','BOOL',false,'Jam alarm output (OTE)');
plc.defineRegister('N7:0','PKG_COUNT','INT',0,'Packages in chute');

// R0: PE1 one-shot rising
plc.addRung(new Rung(0,'PE1 OSR: PE1 AND NOT PE1_PREV → PE1_OSR',
    [{type:'contact-no',tag:'PE1',label:'PE1'},{type:'contact-nc',tag:'PE1_PREV',label:'PE1_PREV (NC)'}],
    [{type:'coil-out',tag:'PE1_OSR',label:'PE1_OSR'}],
    (e)=>{const p=e.get('PE1'),prev=e.get('PE1_PREV');const osr=p&&!prev;e.set('PE1_OSR',osr);
    return{energized:osr,conditionStates:[p,!prev],outputStates:[osr],log:osr?[{type:'action',message:'PE1 triggered — package entering'}]:[]};}
));

// R1: PE2 one-shot rising
plc.addRung(new Rung(1,'PE2 OSR: PE2 AND NOT PE2_PREV → PE2_OSR',
    [{type:'contact-no',tag:'PE2',label:'PE2'},{type:'contact-nc',tag:'PE2_PREV',label:'PE2_PREV (NC)'}],
    [{type:'coil-out',tag:'PE2_OSR',label:'PE2_OSR'}],
    (e)=>{const p=e.get('PE2'),prev=e.get('PE2_PREV');const osr=p&&!prev;e.set('PE2_OSR',osr);
    return{energized:osr,conditionStates:[p,!prev],outputStates:[osr],log:osr?[{type:'action',message:'PE2 triggered — package exiting'}]:[]};}
));

// R2: CTU — PE1_OSR → PKG_COUNT + 1
plc.addRung(new Rung(2,'CTU: PE1_OSR → PKG_COUNT + 1',
    [{type:'contact-no',tag:'PE1_OSR',label:'PE1_OSR'}],
    [{type:'math-add',tag:'PKG_COUNT',label:'PKG_COUNT + 1'}],
    (e)=>{const osr=e.get('PE1_OSR');if(osr)e.set('PKG_COUNT',e.get('PKG_COUNT')+1);
    return{energized:osr,conditionStates:[osr],outputStates:[osr],log:[]};}
));

// R3: CTD — PE2_OSR → PKG_COUNT - 1 (min 0)
plc.addRung(new Rung(3,'CTD: PE2_OSR → PKG_COUNT - 1 (min 0)',
    [{type:'contact-no',tag:'PE2_OSR',label:'PE2_OSR'}],
    [{type:'math-sub',tag:'PKG_COUNT',label:'PKG_COUNT - 1'}],
    (e)=>{const osr=e.get('PE2_OSR');if(osr)e.set('PKG_COUNT',Math.max(0,e.get('PKG_COUNT')-1));
    return{energized:osr,conditionStates:[osr],outputStates:[osr],log:[]};}
));

// R4: JAM detection — PKG_COUNT >= 10 → JAM_ALARM
plc.addRung(new Rung(4,'PKG_COUNT >= 10 → JAM_ALARM (OTE)',
    [{type:'compare-gt',tag:'PKG_COUNT',label:'PKG_COUNT >= 10',compareValue:'10'}],
    [{type:'coil-out',tag:'JAM_ALARM',label:'JAM_ALARM'}],
    (e)=>{const jam=e.get('PKG_COUNT')>=10;e.set('JAM_ALARM',jam);
    const log=[];if(jam&&!e.registers['JAM_ALARM'].prevValue)log.push({type:'action',message:'JAM DETECTED — 10+ packages in chute!'});
    return{energized:jam,conditionStates:[jam],outputStates:[jam],log};}
));

// R5: RESET — clear jam and counter
plc.addRung(new Rung(5,'RESET_PB → clear JAM_ALARM, PKG_COUNT = 0',
    [{type:'contact-no',tag:'RESET_PB',label:'RESET_PB'}],
    [{type:'coil-out',tag:'PKG_COUNT',label:'RESET'}],
    (e)=>{const r=e.get('RESET_PB');if(r){e.set('PKG_COUNT',0);e.set('JAM_ALARM',false);e.set('RESET_PB',false);}
    return{energized:r,conditionStates:[r],outputStates:[r],log:r?[{type:'action',message:'RESET — counter cleared'}]:[]};}
));

// R6: Save PE prev states
plc.addRung(new Rung(6,'Update PE1_PREV, PE2_PREV for edge detection',
    [{type:'contact-no',tag:'PE1',label:'PE1'}],
    [{type:'coil-out',tag:'PE1_PREV',label:'PE1_PREV'}],
    (e)=>{e.set('PE1_PREV',e.get('PE1'));e.set('PE2_PREV',e.get('PE2'));
    // Clear momentary pulses
    e.set('PE1',false);e.set('PE2',false);
    return{energized:e.get('PE1_PREV'),conditionStates:[e.get('PE1_PREV')],outputStates:[e.get('PE1_PREV')],log:[]};}
));

let autoJamInterval=null;
function updateUI(e){
    const cnt=e.get('PKG_COUNT'),jam=e.get('JAM_ALARM');
    const d=document.getElementById('pkg-display');d.textContent=cnt;
    d.className='pkg-count-display'+(jam?' jam':(cnt>=7?' warning':''));
    document.getElementById('pe1-dot').className='pe-dot'+(e.get('PE1_OSR')?' triggered':'');
    document.getElementById('pe2-dot').className='pe-dot'+(e.get('PE2_OSR')?' triggered':'');
    document.getElementById('jam-box').className='equip-box'+(jam?' alarmed':'');
    document.getElementById('jam-status').textContent=jam?'JAM!':'OK';
    document.getElementById('count-status').textContent=cnt;
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);updateRT(e);updateSL(e);
}
function updateRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function updateSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Click PE1/PE2 buttons or simulate jam.</div>';}

function triggerPE1(){plc.set('PE1',true);plc.scan();}
function triggerPE2(){plc.set('PE2',true);plc.scan();}
function pressReset(){plc.set('RESET_PB',true);plc.scan();}
function startAutoJam(){if(autoJamInterval){clearInterval(autoJamInterval);autoJamInterval=null;return;}
    let tick=0;autoJamInterval=setInterval(()=>{tick++;plc.set('PE1',true);plc.scan();
    if(tick%3===0){plc.set('PE2',true);plc.scan();}if(plc.get('JAM_ALARM')){clearInterval(autoJamInterval);autoJamInterval=null;}},400);}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}

plc.onChange(updateUI);ladder.render(plc.rungs);updateRT(plc);updateSL(plc);plc.scan();
