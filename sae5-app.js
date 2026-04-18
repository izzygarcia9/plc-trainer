/**
 * SAE-5: Controller Handshake with Success Counter
 * Start PB initiates handshake. Both controllers must be active.
 * Count "success" every 3s of continuous handshake. Stop at 10.
 */
const plc=new PLCEngine(),ladder=new LadderRenderer('ladder-content');
let running=false,scanInterval=null,scanSpeed=500,timeScale=1;
const tsub={T0:0};
function simTON(e,en,a,p,eT,tT,dT,k){const pr=e.get(p);let ac=e.get(a);if(!en){e.set(a,0);e.set(eT,false);e.set(tT,false);e.set(dT,false);tsub[k]=0;return false;}e.set(eT,true);if(ac>=pr){e.set(tT,false);e.set(dT,true);return true;}tsub[k]++;if(tsub[k]>=timeScale){ac++;e.set(a,ac);tsub[k]=0;}const d=ac>=pr;e.set(tT,!d);e.set(dT,d);return d;}

plc.defineRegister('I:0/0','START_PB','BOOL',false,'Start (momentary)');
plc.defineRegister('I:0/1','STOP_PB','BOOL',false,'Stop (momentary)');
plc.defineRegister('B3:0/0','COMM_ACTIVE','BOOL',false,'Communication active');
plc.defineRegister('B3:0/1','CTRL1_READY','BOOL',true,'Controller #1 ready');
plc.defineRegister('B3:0/2','CTRL2_READY','BOOL',true,'Controller #2 ready');
plc.defineRegister('B3:0/3','HANDSHAKE','BOOL',false,'Handshake established');
plc.defineRegister('B3:0/4','COMPLETE','BOOL',false,'Success reached 10');
plc.defineRegister('O:0/0','COMM_LED','BOOL',false,'Communication LED');
plc.defineRegister('T4:0.PRE','T0_PRE','INT',3,'3s timer preset');
plc.defineRegister('T4:0.ACC','T0_ACC','INT',0,'');plc.defineRegister('T4:0/EN','T0_EN','BOOL',false,'');plc.defineRegister('T4:0/TT','T0_TT','BOOL',false,'');plc.defineRegister('T4:0/DN','T0_DN','BOOL',false,'');
plc.defineRegister('N7:0','SUCCESS','INT',0,'Success counter');

plc.addRung(new Rung(0,'(START OR COMM_ACTIVE) AND NOT STOP AND NOT COMPLETE → COMM_ACTIVE',
    [{type:'contact-no',tag:'START_PB',label:'START'},{type:'contact-no',tag:'COMM_ACTIVE',label:'COMM (seal)'},{type:'contact-nc',tag:'STOP_PB',label:'STOP (NC)'},{type:'contact-nc',tag:'COMPLETE',label:'DONE (NC)'}],
    [{type:'coil-out',tag:'COMM_ACTIVE',label:'COMM_ACTIVE'}],
    (e)=>{const s=e.get('START_PB'),c=e.get('COMM_ACTIVE'),st=e.get('STOP_PB'),d=e.get('COMPLETE');
    const on=(s||c)&&!st&&!d;e.set('COMM_ACTIVE',on);
    if(s)e.set('START_PB',false);if(st){e.set('STOP_PB',false);e.set('SUCCESS',0);e.set('COMPLETE',false);}
    return{energized:on,conditionStates:[s,c,!st,!d],outputStates:[on],log:on&&!c?[{type:'action',message:'Communication initiated'}]:!on&&c?[{type:'action',message:'Communication stopped'}]:[]};}
));

plc.addRung(new Rung(1,'COMM_ACTIVE AND CTRL1 AND CTRL2 → HANDSHAKE',
    [{type:'contact-no',tag:'COMM_ACTIVE',label:'COMM'},{type:'contact-no',tag:'CTRL1_READY',label:'CTRL1'},{type:'contact-no',tag:'CTRL2_READY',label:'CTRL2'}],
    [{type:'coil-out',tag:'HANDSHAKE',label:'HANDSHAKE'}],
    (e)=>{const on=e.get('COMM_ACTIVE')&&e.get('CTRL1_READY')&&e.get('CTRL2_READY');e.set('HANDSHAKE',on);e.set('COMM_LED',on);
    return{energized:on,conditionStates:[e.get('COMM_ACTIVE'),e.get('CTRL1_READY'),e.get('CTRL2_READY')],outputStates:[on],log:[]};}
));

plc.addRung(new Rung(2,'HANDSHAKE → TON 3s, on DN increment SUCCESS and reset timer',
    [{type:'contact-no',tag:'HANDSHAKE',label:'HANDSHAKE'}],
    [{type:'coil-out',tag:'T0_EN',label:'TON 3s'}],
    (e)=>{const hs=e.get('HANDSHAKE');const dn=simTON(e,hs,'T0_ACC','T0_PRE','T0_EN','T0_TT','T0_DN','T0');
    if(dn){e.set('SUCCESS',e.get('SUCCESS')+1);e.set('T0_ACC',0);e.set('T0_DN',false);tsub.T0=0;}
    return{energized:hs,conditionStates:[hs],outputStates:[hs],log:dn?[{type:'action',message:`SUCCESS = ${e.get('SUCCESS')}`}]:[]};}
));

plc.addRung(new Rung(3,'SUCCESS >= 10 → COMPLETE, stop comm',
    [{type:'compare-gt',tag:'SUCCESS',label:'SUCCESS >= 10',compareValue:'10'}],
    [{type:'coil-out',tag:'COMPLETE',label:'COMPLETE'}],
    (e)=>{const done=e.get('SUCCESS')>=10;e.set('COMPLETE',done);if(done)e.set('COMM_ACTIVE',false);
    return{energized:done,conditionStates:[done],outputStates:[done],log:done&&!e.registers['COMPLETE'].prevValue?[{type:'action',message:'SUCCESS reached 10 — COMPLETE!'}]:[]};}
));

function updateUI(e){
    const hs=e.get('HANDSHAKE'),comm=e.get('COMM_ACTIVE'),done=e.get('COMPLETE');
    document.getElementById('ctrl1-box').className='ctrl-box'+(e.get('CTRL1_READY')&&comm?' active':done?' done':'');
    document.getElementById('ctrl1-status').textContent=e.get('CTRL1_READY')?'READY':'OFFLINE';
    document.getElementById('ctrl2-box').className='ctrl-box'+(e.get('CTRL2_READY')&&comm?' active':done?' done':'');
    document.getElementById('ctrl2-status').textContent=e.get('CTRL2_READY')?'READY':'OFFLINE';
    document.getElementById('hs-pulse').className='hs-pulse'+(hs?' active':'');
    document.getElementById('success-val').textContent=e.get('SUCCESS');
    document.getElementById('hs-bar').style.width=(e.get('T0_ACC')/3*100)+'%';document.getElementById('hs-time').textContent=e.get('T0_ACC')+'/3s';
    const st=document.getElementById('state-display');
    if(done){st.textContent='COMPLETE';st.style.color='#f1c40f';}else if(hs){st.textContent='HANDSHAKE ACTIVE';st.style.color='#2ecc71';}else if(comm){st.textContent='WAITING FOR HANDSHAKE';st.style.color='#f39c12';}else{st.textContent='IDLE';st.style.color='#555';}
    document.getElementById('scan-count').textContent=e.scanCount;ladder.update(e.rungs);uRT(e);uSL(e);
}
function uRT(e){const t=document.getElementById('register-body'),r=e.getAllRegisters();if(!t.children.length)for(const g of r){const tr=document.createElement('tr');tr.dataset.tag=g.tag;tr.innerHTML=`<td>${g.address}</td><td>${g.tag}</td><td>${g.type}</td><td class="value-cell"></td><td>${g.description}</td>`;t.appendChild(tr);}for(const g of r){const tr=t.querySelector(`tr[data-tag="${g.tag}"]`);if(!tr)continue;const td=tr.querySelector('.value-cell');tr.className=g.value!==g.prevValue?'changed':'';if(g.type==='BOOL'){td.textContent=g.value?'TRUE':'FALSE';td.className='value-cell '+(g.value?'val-true':'val-false');}else{td.textContent=g.value;td.className='value-cell val-number';}}}
function uSL(e){const d=document.getElementById('scan-log');let h='';for(const s of e.logEntries.slice(0,25))for(const n of s.entries)h+=`<div class="log-entry ${n.type}">[Scan ${s.scan}] ${n.message}</div>`;d.innerHTML=h||'<div class="log-entry">Both controllers start READY. Press START then RUN.</div>';}
function pressStart(){plc.set('START_PB',true);plc.scan();}
function pressStop(){plc.set('STOP_PB',true);plc.scan();}
function toggleCtrl1(){plc.set('CTRL1_READY',!plc.get('CTRL1_READY'));plc.scan();}
function toggleCtrl2(){plc.set('CTRL2_READY',!plc.get('CTRL2_READY'));plc.scan();}
function toggleRun(){running=!running;const b=document.getElementById('run-btn');if(running){b.textContent='\u23F8 STOP';b.classList.add('running');scanInterval=setInterval(()=>plc.scan(),scanSpeed);}else{b.textContent='\u25B6 RUN';b.classList.remove('running');clearInterval(scanInterval);}}
function singleScan(){plc.scan();}
function updateScanSpeed(v){scanSpeed=parseInt(v);document.getElementById('scan-time').textContent=scanSpeed;if(running){clearInterval(scanInterval);scanInterval=setInterval(()=>plc.scan(),scanSpeed);}}
plc.onChange(updateUI);ladder.render(plc.rungs);uRT(plc);uSL(plc);plc.scan();
