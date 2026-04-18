/**
 * AE-10: EV Charging Cost Calculator
 *
 * Start → timer counts seconds. Cost = elapsed * $0.25.
 * Stop pauses timer and holds cost. Start resumes.
 *
 * Key PLC concept: retentive timer behavior (ACC preserved on stop).
 * We use a RTO (Retentive Timer On) approach — ACC doesn't reset when disabled.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=1000,timeScale=1,subCnt=0;

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start/Resume (momentary)');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop/Pause (momentary)');
plc.defineRegister('I:0/2','RESET_PB','BOOL',false,'Reset (momentary)');
plc.defineRegister('B3:0/0','CHARGING','BOOL',false,'Charging active latch');
plc.defineRegister('N7:0','ELAPSED_SEC','INT',0,'Elapsed seconds (retentive)');
plc.defineRegister('N7:1','COST_CENTS','INT',0,'Cost in cents (elapsed*25)');
plc.defineRegister('N7:2','RATE_CENTS','INT',25,'Rate: cents per second');

// R0: Start/Stop latch (seal-in)
plc.addRung(new Rung(0,'(START OR CHARGING) AND NOT STOP → CHARGING',
    [{type:'contact-no',tag:'START_PB',label:'START_PB'},{type:'contact-no',tag:'CHARGING',label:'CHARGING (seal)'},{type:'contact-nc',tag:'STOP_PB',label:'STOP_PB (NC)'}],
    [{type:'coil-out',tag:'CHARGING',label:'CHARGING'}],
    (e)=>{const s=e.get('START_PB'),c=e.get('CHARGING'),st=e.get('STOP_PB');
    const on=(s||c)&&!st;e.set('CHARGING',on);
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    const log=[];if(on!==c)log.push({type:'action',message:on?'Charging STARTED':'Charging PAUSED'});
    return{energized:on,conditionStates:[s,c,!st],outputStates:[on],log};}
));

// R1: CHARGING → increment elapsed (retentive — doesn't reset on stop)
plc.addRung(new Rung(1,'CHARGING → ELAPSED_SEC + 1 each second (retentive)',
    [{type:'contact-no',tag:'CHARGING',label:'CHARGING'}],
    [{type:'math-add',tag:'ELAPSED_SEC',label:'ELAPSED + 1'}],
    (e)=>{const on=e.get('CHARGING');
    if(on){subCnt++;if(subCnt>=timeScale){e.set('ELAPSED_SEC',e.get('ELAPSED_SEC')+1);subCnt=0;}}
    return{energized:on,conditionStates:[on],outputStates:[on],log:[]};}
));

// R2: Calculate cost = elapsed * rate
plc.addRung(new Rung(2,'COST_CENTS = ELAPSED_SEC * RATE_CENTS (25 cents/sec)',
    [{type:'math-add',tag:'ELAPSED_SEC',label:'ELAPSED_SEC'}],
    [{type:'math-add',tag:'COST_CENTS',label:'MUL ELAPSED * RATE'}],
    (e)=>{e.set('COST_CENTS',e.get('ELAPSED_SEC')*e.get('RATE_CENTS'));
    return{energized:true,conditionStates:[true],outputStates:[true],log:[]};}
));

// R3: Reset
plc.addRung(new Rung(3,'RESET_PB → clear elapsed, cost, stop charging',
    [{type:'contact-no',tag:'RESET_PB',label:'RESET_PB'}],
    [{type:'coil-out',tag:'ELAPSED_SEC',label:'RESET all'}],
    (e)=>{const r=e.get('RESET_PB');
    if(r){e.set('ELAPSED_SEC',0);e.set('COST_CENTS',0);e.set('CHARGING',false);e.set('RESET_PB',false);subCnt=0;}
    return{energized:r,conditionStates:[r],outputStates:[r],log:r?[{type:'action',message:'RESET — cost cleared'}]:[]};}
));

function updateUI(e){
    const ch=e.get('CHARGING'),el=e.get('ELAPSED_SEC'),cost=e.get('COST_CENTS');
    document.getElementById('cost-val').textContent='$'+(cost/100).toFixed(2);
    document.getElementById('elapsed-val').textContent=el;
    document.getElementById('charge-ind').className='charge-indicator'+(ch?' charging':'');
    document.getElementById('battery-fill').style.width=Math.min(100,el)+'%';
    document.getElementById('battery-pct').textContent=Math.min(100,el)+'%';
    document.querySelector('.cost-display').className='cost-display'+(ch?' active':'');
    const st=document.getElementById('state-display');
    st.textContent=ch?'CHARGING':(el>0?'PAUSED':'IDLE');st.style.color=ch?'#2ecc71':(el>0?'#f39c12':'#888');
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);updateRT(e);updateSL(e);
}
function updateRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function updateSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN.</div>';}

function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function resetAll(){plc.set('RESET_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}

plc.onChange(updateUI);ladder.render(plc.rungs);updateRT(plc);updateSL(plc);plc.scan();
