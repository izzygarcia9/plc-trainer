/**
 * SAE-18: Shuttle Dumper — 5 Sequential Locations with Pause
 * Start at Loc 1. Dump 5s at each. Move to next. After 5, return to 1 and stop.
 * Stop resets to Loc 1. Pause holds current step/timer, resume continues.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(eT,false);e.set(tT,false);e.set(dT,false);return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop/Reset');
plc.defineRegister('I:0/2','PAUSE_PB','BOOL',false,'Pause toggle');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'Running');
plc.defineRegister('B3:0/1','PAUSED','BOOL',false,'Paused');
plc.defineRegister('B3:0/2','DUMPING','BOOL',false,'Currently dumping');
plc.defineRegister('B3:0/3','MOVING','BOOL',false,'Moving to next loc');
plc.defineRegister('B3:0/4','COMPLETE','BOOL',false,'All 5 done');
plc.defineRegister('B3:0/5','PAUSE_PREV','BOOL',false,'Pause prev');
plc.defineRegister('N7:0','LOCATION','INT',1,'Current location (1-5)');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',5,'Dump timer (5s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');

// R0: Start/Stop
plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT STOP AND NOT COMPLETE → SYS_RUN',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'COMPLETE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB'),d=e.get('COMPLETE');
    const on=(s||r)&&!st&&!d;e.set('SYS_RUN',on);
    if(s&&!r){e.set('LOCATION',1);e.set('DUMPING',true);e.set('MOVING',false);e.set('PAUSED',false);e.set('T0_ACC',0);tsub.T0=0;}
    if(st){e.set('LOCATION',1);e.set('DUMPING',false);e.set('MOVING',false);e.set('PAUSED',false);e.set('COMPLETE',false);e.set('T0_ACC',0);tsub.T0=0;}
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    return{energized:on,conditionStates:[s,r,!st,!d],outputStates:[on],log:on&&!r?[{type:'action',message:'Started at Location 1'}]:!on&&r?[{type:'action',message:'STOPPED — reset to Loc 1'}]:[]};}
));

// R1: Pause toggle (one-shot)
plc.addRung(new Rung(1,'PAUSE OSR → toggle PAUSED',
    [{type:'contact-no',tag:'PAUSE_PB',label:'PAUSE'},{type:'contact-nc',tag:'PAUSE_PREV',label:'PREV (NC)'}],
    [{type:'coil-out',tag:'PAUSED',label:'toggle PAUSED'}],
    (e)=>{const p=e.get('PAUSE_PB'),prev=e.get('PAUSE_PREV');const osr=p&&!prev;
    if(osr)e.set('PAUSED',!e.get('PAUSED'));
    e.set('PAUSE_PREV',p);e.set('PAUSE_PB',false);
    return{energized:osr,conditionStates:[p,!prev],outputStates:[osr],
    log:osr?[{type:'action',message:e.get('PAUSED')?'PAUSED':'RESUMED'}]:[]};}
));

// R2: Dump timer (only when dumping AND not paused)
plc.addRung(new Rung(2,'DUMPING AND NOT PAUSED → TON 5s dump',
    [{type:'contact-no',tag:'DUMPING',label:'DUMPING'},{type:'contact-nc',tag:'PAUSED',label:'PAUSED (NC)'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 5s'}],
    (e)=>{const en=e.get('DUMPING')&&!e.get('PAUSED');
    // Don't reset ACC on pause — retentive behavior
    if(en)simTON(e,true,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    else{e.set('T0_EN',false);e.set('T0_TT',false);}
    return{energized:en,conditionStates:[e.get('DUMPING'),!e.get('PAUSED')],outputStates:[en],log:[]};}
));

// R3: Dump done → move to next location
plc.addRung(new Rung(3,'T0_DN → next location or complete',
    [{type:'contact-no',tag:'T0_DN',label:'T0_DN'}],[{type:'coil-out',tag:'LOCATION',label:'NEXT LOC'}],
    (e)=>{const dn=e.get('T0_DN');if(dn&&e.get('DUMPING')){
    e.set('DUMPING',false);const loc=e.get('LOCATION');
    if(loc>=5){e.set('COMPLETE',true);e.set('SYS_RUN',false);e.set('LOCATION',1);}
    else{e.set('LOCATION',loc+1);e.set('DUMPING',true);e.set('T0_ACC',0);tsub.T0=0;}}
    const log=[];if(dn&&e.registers['DUMPING'].prevValue){const l=e.get('LOCATION');
    log.push({type:'action',message:e.get('COMPLETE')?'ALL 5 LOCATIONS DONE — returned to Loc 1':`Loc ${l-1} done → moving to Loc ${l}`});}
    return{energized:dn,conditionStates:[dn],outputStates:[dn],log};}
));

// Build location boxes
const locRow=document.getElementById('loc-row');
for(let i=1;i<=5;i++)locRow.innerHTML+=`<div class="loc-box" id="loc-${i}"><div class="loc-num">${i}</div><div style="font-size:.55rem">Loc ${i}</div></div>`;

function updateUI(e){
    const loc=e.get('LOCATION'),dumping=e.get('DUMPING'),paused=e.get('PAUSED'),complete=e.get('COMPLETE');
    for(let i=1;i<=5;i++){const box=document.getElementById('loc-'+i);
    if(i===loc&&dumping)box.className='loc-box current';
    else if(i<loc||(complete&&i<=5))box.className='loc-box done';
    else box.className='loc-box';}
    document.getElementById('dump-bar').style.width=(e.get('T0_ACC')/5*100)+'%';document.getElementById('dump-time').textContent=e.get('T0_ACC')+'/5s';
    document.getElementById('loc-val').textContent=loc;
    const st=document.getElementById('state-display');
    if(complete){st.textContent='COMPLETE';st.style.color='#f1c40f';}
    else if(paused){st.textContent='PAUSED (Loc '+loc+')';st.style.color='#f39c12';}
    else if(dumping){st.textContent='DUMPING Loc '+loc;st.style.color='#e67e22';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN. Try PAUSE mid-dump.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function pressPause(){plc.set('PAUSE_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
