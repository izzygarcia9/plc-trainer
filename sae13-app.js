/**
 * SAE-13: Automated Packaging Cycle
 * Fill 10s → Seal 5s → Transfer 3s → repeat 50 times then stop.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=300,timeScale=1;
const tsub={T0:0,T1:0,T2:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start');
plc.defineRegister('I:0/1','RESET_PB','BOOL',false,'Reset');
plc.defineRegister('B3:0/0','SYS_RUN','BOOL',false,'Running');
plc.defineRegister('B3:0/1','S_FILL','BOOL',false,'Fill phase');
plc.defineRegister('B3:0/2','S_SEAL','BOOL',false,'Seal phase');
plc.defineRegister('B3:0/3','S_XFER','BOOL',false,'Transfer phase');
plc.defineRegister('B3:0/4','DONE','BOOL',false,'50 packages done');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',10,'Fill (10s)');plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('T4:1.PRE','T1_PRE','INT',5,'Seal (5s)');plc.defineRegister('T4:1.ACC','T1_ACC','INT',0,'');plc.defineRegister('T4:1/EN','T1_EN','BOOL',false,'');plc.defineRegister('T4:1/TT','T1_TT','BOOL',false,'');plc.defineRegister('T4:1/DN','T1_DN','BOOL',false,'');
plc.defineRegister('T4:2.PRE','T2_PRE','INT',3,'Transfer (3s)');plc.defineRegister('T4:2.ACC','T2_ACC','INT',0,'');plc.defineRegister('T4:2/EN','T2_EN','BOOL',false,'');plc.defineRegister('T4:2/TT','T2_TT','BOOL',false,'');plc.defineRegister('T4:2/DN','T2_DN','BOOL',false,'');
plc.defineRegister('N7:0','PKG_CNT','INT',0,'Packages completed');

plc.addRung(new Rung(0,'(START OR SYS_RUN) AND NOT DONE → SYS_RUN',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'SYS_RUN',label:'RUN'},{type:'contact-nc',tag:'DONE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'SYS_RUN',label:'SYS_RUN'}],
    (e)=>{const s=e.get('START_PB'),r=e.get('SYS_RUN'),d=e.get('DONE');const on=(s||r)&&!d;e.set('SYS_RUN',on);
    if(s&&!r){e.set('S_FILL',true);e.set('S_SEAL',false);e.set('S_XFER',false);}if(s)e.set('START_PB',false);
    return{energized:on,conditionStates:[s,r,!d],outputStates:[on],log:on&&!r?[{type:'action',message:'Packaging started — FILL phase'}]:[]};}
));

plc.addRung(new Rung(1,'S_FILL → TON 10s',
    [{type:'contact-no',tag:'S_FILL',label:'S_FILL'}],[{type:'coil-out',tag:'T0_EN',label:'TON 10s'}],
    (e)=>{simTON(e,e.get('S_FILL'),'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    if(e.get('T0_DN')&&e.get('S_FILL')){e.set('S_FILL',false);e.set('S_SEAL',true);}
    return{energized:e.get('S_FILL'),conditionStates:[e.get('S_FILL')],outputStates:[e.get('T0_EN')],
    log:e.get('T0_DN')&&e.registers['S_FILL'].prevValue?[{type:'action',message:'Fill done → SEAL phase'}]:[]};}
));

plc.addRung(new Rung(2,'S_SEAL → TON 5s',
    [{type:'contact-no',tag:'S_SEAL',label:'S_SEAL'}],[{type:'coil-out',tag:'T1_EN',label:'TON 5s'}],
    (e)=>{simTON(e,e.get('S_SEAL'),'T1_ACC','T1_PRE','T1_EN','T1_TT','T1_DN','T1');
    if(e.get('T1_DN')&&e.get('S_SEAL')){e.set('S_SEAL',false);e.set('S_XFER',true);}
    return{energized:e.get('S_SEAL'),conditionStates:[e.get('S_SEAL')],outputStates:[e.get('T1_EN')],
    log:e.get('T1_DN')&&e.registers['S_SEAL'].prevValue?[{type:'action',message:'Seal done → TRANSFER phase'}]:[]};}
));

plc.addRung(new Rung(3,'S_XFER → TON 3s → count + loop or done',
    [{type:'contact-no',tag:'S_XFER',label:'S_XFER'}],[{type:'coil-out',tag:'T2_EN',label:'TON 3s'}],
    (e)=>{simTON(e,e.get('S_XFER'),'T2_ACC','T2_PRE','T2_EN','T2_TT','T2_DN','T2');
    if(e.get('T2_DN')&&e.get('S_XFER')){e.set('S_XFER',false);const c=e.get('PKG_CNT')+1;e.set('PKG_CNT',c);
    if(c>=50){e.set('DONE',true);e.set('SYS_RUN',false);}else e.set('S_FILL',true);}
    const log=[];if(e.get('T2_DN')&&e.registers['S_XFER'].prevValue){const c=e.get('PKG_CNT');
    log.push({type:'action',message:e.get('DONE')?`Package ${c}/50 — ALL DONE!`:`Package ${c}/50 → restart FILL`});}
    return{energized:e.get('S_XFER'),conditionStates:[e.get('S_XFER')],outputStates:[e.get('T2_EN')],log};}
));

plc.addRung(new Rung(4,'RESET → clear all',
    [{type:'contact-no',tag:'RESET_PB',label:'RESET'}],[{type:'coil-out',tag:'PKG_CNT',label:'RESET'}],
    (e)=>{if(e.get('RESET_PB')){e.set('PKG_CNT',0);e.set('DONE',false);e.set('SYS_RUN',false);e.set('S_FILL',false);e.set('S_SEAL',false);e.set('S_XFER',false);e.set('RESET_PB',false);}
    return{energized:e.get('RESET_PB'),conditionStates:[e.get('RESET_PB')],outputStates:[e.get('RESET_PB')],log:e.registers['RESET_PB'].prevValue?[{type:'action',message:'RESET — counter cleared'}]:[]};}
));

function updateUI(e){
    document.getElementById('fill-phase').className='phase-box'+(e.get('S_FILL')?' active':'');document.getElementById('fill-t').textContent=e.get('T0_ACC')+'/10s';
    document.getElementById('seal-phase').className='phase-box'+(e.get('S_SEAL')?' active':'');document.getElementById('seal-t').textContent=e.get('T1_ACC')+'/5s';
    document.getElementById('xfer-phase').className='phase-box'+(e.get('S_XFER')?' active':'');document.getElementById('xfer-t').textContent=e.get('T2_ACC')+'/3s';
    document.getElementById('pkg-val').textContent=e.get('PKG_CNT');
    const st=document.getElementById('state-display');
    if(e.get('DONE')){st.textContent='COMPLETE (50/50)';st.style.color='#f1c40f';}
    else if(e.get('S_FILL')){st.textContent='FILLING';st.style.color='#3498db';}
    else if(e.get('S_SEAL')){st.textContent='SEALING';st.style.color='#e67e22';}
    else if(e.get('S_XFER')){st.textContent='TRANSFERRING';st.style.color='#2ecc71';}
    else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Press START then RUN.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressReset(){plc.set('RESET_PB',true);plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
