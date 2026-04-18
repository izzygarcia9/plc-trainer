/**
 * SAE-3: Mining Conveyor Sequential Start/Stop
 *
 * 3 conveyors (BC1, BC2, BC3) + Feeder. Material flows: Feeder → BC1 → BC2 → BC3
 * Start sequence (downstream first): BC3 → delay → BC2 → delay → BC1 → Feeder
 * Stop sequence: Feeder stops first, then BC1 → BC2 → BC3 (upstream first)
 * Feeder stops when level switch goes HIGH (bin full)
 * 3s delay between each conveyor start
 *
 * Step sequencer: STEP 0=idle, 1=BC3 start, 2=delay, 3=BC2 start, 4=delay, 5=BC1 start, 6=delay, 7=feeder
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start pushbutton');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop pushbutton');
plc.defineRegister('I:0/2','LEVEL_SW','BOOL',false,'Level switch (HIGH=full)');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'System running');
plc.defineRegister('B3:0/1','SEQ_DONE','BOOL',false,'Startup sequence complete');
plc.defineRegister('O:0/0','BC3_MOTOR','BOOL',false,'BC3 motor output');
plc.defineRegister('O:0/1','BC2_MOTOR','BOOL',false,'BC2 motor output');
plc.defineRegister('O:0/2','BC1_MOTOR','BOOL',false,'BC1 motor output');
plc.defineRegister('O:0/3','FEEDER','BOOL',false,'Feeder output');
plc.defineRegister('N7:0','SEQ_STEP','INT',0,'Sequence step (0-7)');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',3,'Delay timer preset (3s)');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');

// R0: Start/Stop
plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT STOP → SYS_RUN',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),st=e.get('STOP_PB');
    const on=(s||r)&&!st;e.set('SYS_RUN',on);
    if(s&&!r){e.set('SEQ_STEP',1);e.set('SEQ_DONE',false);}
    if(st){e.set('FEEDER',false);e.set('BC1_MOTOR',false);e.set('BC2_MOTOR',false);e.set('BC3_MOTOR',false);e.set('SEQ_STEP',0);e.set('SEQ_DONE',false);}
    if(s)e.set('START_PB',false);if(st)e.set('STOP_PB',false);
    const log=[];if(on&&!r)log.push({type:'action',message:'START — beginning sequential startup (BC3 first)'});
    if(!on&&r)log.push({type:'action',message:'STOP — all conveyors off'});
    return{energized:on,conditionStates:[s,r,!st],outputStates:[on],log};}
));

// R1: Sequencer — steps through startup
plc.addRung(new Rung(1,'Sequencer: step-based startup with 3s delays',
    [{type:'contact-no',tag:'SYS_RUN',label:'SYS_RUN'},{type:'contact-nc',tag:'SEQ_DONE',label:'SEQ_DONE (NC)'}],
    [{type:'coil-out',tag:'SEQ_STEP',label:'SEQ logic'}],
    (e)=>{if(!e.get('SYS_RUN')||e.get('SEQ_DONE'))return{energized:false,conditionStates:[false,true],outputStates:[false],log:[]};
    const step=e.get('SEQ_STEP');const log=[];
    switch(step){
        case 1:e.set('BC3_MOTOR',true);e.set('SEQ_STEP',2);log.push({type:'action',message:'Step 1: BC3 started'});break;
        case 2:if(simTON(e,true,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0')){e.set('SEQ_STEP',3);}break;
        case 3:e.set('BC2_MOTOR',true);e.set('SEQ_STEP',4);tsub.T0=0;e.set('T0_ACC',0);e.set('T0_DN',false);log.push({type:'action',message:'Step 3: BC2 started'});break;
        case 4:if(simTON(e,true,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0')){e.set('SEQ_STEP',5);}break;
        case 5:e.set('BC1_MOTOR',true);e.set('SEQ_STEP',6);tsub.T0=0;e.set('T0_ACC',0);e.set('T0_DN',false);log.push({type:'action',message:'Step 5: BC1 started'});break;
        case 6:if(simTON(e,true,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0')){e.set('SEQ_STEP',7);}break;
        case 7:e.set('FEEDER',true);e.set('SEQ_DONE',true);e.set('SEQ_STEP',7);log.push({type:'action',message:'Step 7: Feeder started — sequence complete'});break;
    }
    return{energized:true,conditionStates:[true,true],outputStates:[true],log};}
));

// R2: Feeder stops when level switch HIGH
plc.addRung(new Rung(2,'LEVEL_SW (HIGH/full) → stop FEEDER',
    [{type:'contact-no',tag:'LEVEL_SW',label:'LEVEL_SW'},{type:'contact-no',tag:'SEQ_DONE',label:'SEQ_DONE'}],
    [{type:'coil-out',tag:'FEEDER',label:'FEEDER OFF'}],
    (e)=>{const lvl=e.get('LEVEL_SW'),done=e.get('SEQ_DONE');
    if(lvl&&done&&e.get('FEEDER')){e.set('FEEDER',false);return{energized:true,conditionStates:[true,true],outputStates:[true],log:[{type:'action',message:'Level HIGH — Feeder STOPPED'}]};}
    // Restart feeder when level goes low again
    if(!lvl&&done&&!e.get('FEEDER')&&e.get('SYS_RUN')){e.set('FEEDER',true);return{energized:false,conditionStates:[false,true],outputStates:[false],log:[{type:'action',message:'Level LOW — Feeder RESTARTED'}]};}
    return{energized:lvl&&done,conditionStates:[lvl,done],outputStates:[lvl&&done],log:[]};}
));

function updateUI(e){
    const bc3=e.get('BC3_MOTOR'),bc2=e.get('BC2_MOTOR'),bc1=e.get('BC1_MOTOR'),fdr=e.get('FEEDER'),lvl=e.get('LEVEL_SW');
    ['bc3','bc2','bc1'].forEach(id=>{const on=e.get(id.toUpperCase()+'_MOTOR');
    document.getElementById(id+'-ind').className='chain-motor'+(on?' on':'');
    document.getElementById(id+'-bar').className='chain-bar'+(on?' on':'');
    document.getElementById(id+'-box').className='equip-box'+(on?' on':'');
    document.getElementById(id+'-status').textContent=on?'RUNNING':'OFF';});
    document.getElementById('fdr-ind').className='chain-motor feeder'+(fdr?' on':'');
    document.getElementById('fdr-box').className='equip-box'+(fdr?' on':'');document.getElementById('fdr-status').textContent=fdr?'RUNNING':'OFF';
    document.getElementById('lvl-box').className='equip-box'+(lvl?' warn':'');document.getElementById('lvl-status').textContent=lvl?'HIGH':'LOW';
    const step=e.get('SEQ_STEP');document.getElementById('seq-bar').style.width=(step/7*100)+'%';document.getElementById('seq-time').textContent='Step '+step;
    const st=document.getElementById('state-display');
    if(e.get('SEQ_DONE')){st.textContent=fdr?'RUNNING':'FEEDER PAUSED (level)';st.style.color=fdr?'#2ecc71':'#f39c12';}
    else if(e.get('SYS_RUN')){st.textContent='STARTING...';st.style.color='#3498db';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;
    ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN. Conveyors start downstream first.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleLevel(){plc.set('LEVEL_SW',!plc.get('LEVEL_SW'));plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
