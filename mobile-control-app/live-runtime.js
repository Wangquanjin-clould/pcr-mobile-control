  // Runs inside the approved controller closure; preview-only actions are intercepted.
  const PLC_HOST='192.168.41.129';
  let plcOnline=false,readBusy=false,sequence=0,writeChain=Promise.resolve();
  const plcValues={},pending=new Map(),requests=new Map(),excluded=new Set(['P3248','P3249','P3250','P3251']);
  const types={SerialNO:'DINT',Src_Device:'DINT',Dest_Device:'DINT',Height:'INT',Weight:'REAL',PalletNum:'INT',MajorState:'SINT',SubState:'SINT',Device:'DINT'};
  const parse=s=>typeof s==='string'?JSON.parse(s):s;
  function request(tag,type,value) {
    if(!plcOnline)return Promise.reject(Error('PLC未连接'));
    const id=String(++sequence);
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('写入响应超时：'+tag));},10000);
      pending.set(id,{resolve:r=>{clearTimeout(timer);resolve(r);},reject:e=>{clearTimeout(timer);reject(e);}});
      if(type==='STR20')AndroidPlc.writeString(id,tag,String(value));else AndroidPlc.writeTag(id,tag,type,String(value));
    });
  }
  function send(tag,type,value,message) {
    const task=writeChain.then(()=>request(tag,type,value));
    writeChain=task.catch(()=>{});
    task.then(()=>{if(message)feedback(message);}).catch(e=>feedback(e.message));
    return task;
  }
  function readString(base) {
    if(plcValues[base+'.LEN']===undefined)return '';
    const len=Math.max(0,Math.min(20,Number(plcValues[base+'.LEN'])));
    return Array.from({length:len},(_,i)=>String.fromCharCode(Number(plcValues[base+'.DATA['+i+']']||0)&255)).join('');
  }
  decoded=function(id=current().device) {
    const word=excluded.has(id)?undefined:plcValues[statusTag(id)];
    if(word===undefined)return {word:0,fault:false,automatic:false,loaded:false,mode:'unknown',label:excluded.has(id)?'出库PLC待接入':'未读取'};
    return {word,fault:!!(word&512),automatic:!!(word&256),loaded:!!(word&1024),mode:word&512?'fault':word&256?'auto':'manual',label:word&512?'故障':word&256?'自动':'手动'};
  };
  palletFor=function() {
    const p=bindings().pallet;
    return {SerialNO:plcValues[p+'.SerialNO']??'',Src_Device:plcValues[p+'.Src_Device']??'',Dest_Device:plcValues[p+'.Dest_Device']??'',PalletID:readString(p+'.PalletID'),Height:plcValues[p+'.Height']??'',Weight:plcValues[p+'.Weight']??''};
  };
  numericId=function(id) {return plcValues[bindings().chooser+(id===current().device?'.HMI_Man_No1':'.HMI_Man_No2')]??'未读取';};
  // Disable all preview write fallbacks in the packaged app.
  simWrite=function(){throw Error('预览写入路径不可用于在线操作');};
  pulse=async function(tag,message) {
    try {await send(tag,'BOOL',1);await new Promise(r=>setTimeout(r,300));}
    finally {await send(tag,'BOOL',0);}
    feedback(message||'请求已发送，以PLC回读为准');poll();
  };
  select=async function(value) {
    if(excluded.has(value)){feedback(value+' 属于出库PLC，暂不接入');return;}
    if(!plcOnline){feedback('请先连接入库PLC');return;}
    release(false);closeKeyboard();const s=current(),b=bindings();
    if(s.paused){feedback('请先恢复托盘数据刷新，再切换查询对象');return;}
    try{await send(b.inputs[0],'STR20',value);s.device=value;s.inputs[0]=value;render();poll();feedback('查询编号已发送，等待PLC实际选择回读');}catch(e){feedback(e.message);}
  };
  switchChannel=function(ch,area) {
    release(false);closeKeyboard();channel=ch;
    if(Number.isInteger(area)){current().area=area;page='设备布局';}
    root.querySelector('#pcr-modal').hidden=true;render();poll();
  };
  release=function(showFeedback=true) {
    if(jog){const active=jog;jog=null;active.button.classList.remove('pressed');send(active.tag,'BOOL',0,showFeedback?'点动停止请求已发送':null).catch(()=>{});}
    if(hold){const active=hold;hold=null;active.button.classList.remove('pressed');send(active.tag,'BOOL',0).catch(()=>{});}
  };
  const draw=render;
  render=function(){
    draw();
    if(page==='手动操作') {
      const b=bindings(),side=content.querySelector('.pcr-manual-grid > div');
      if(side)side.insertAdjacentHTML('beforeend',panel('升降到位',`<div style="display:flex;gap:20px;margin-top:12px">${[['上升到位','HMI_Stus_UpDn_At_Up'],['下降到位','HMI_Stus_UpDn_At_Dn']].map(([label,field])=>`<div class="pcr-arrival" data-arrival-tag="${b.status}.${field}" style="display:flex;align-items:center;gap:8px"><i style="width:12px;height:12px;flex-shrink:0;border-radius:50%;background:#a8b3c0"></i><span>${label}</span><b style="font-size:12px">未读取</b></div>`).join('')}</div>`));
    }
    paint();
  };
  function paint() {
    const s=current(),b=bindings();
    root.querySelector('#pcr-channel-caption').textContent=channel+' · '+(plcOnline?PLC_HOST:'未连接');
    root.querySelector('.pcr-head-right .pcr-chip').textContent=plcOnline?'● PLC在线':'● PLC未连接';
    const selected=plcValues[b.chooser+'.HMI_Man_No1'];
    root.querySelector('#pcr-selected').textContent='PLC实际选择：'+(selected??'未读取');
    for(const el of root.querySelectorAll('.pcr-machine')) {
      const st=decoded(el.dataset.device);el.classList.remove('mode-auto','mode-manual','mode-fault','mode-unknown');el.classList.add('mode-'+st.mode);
      el.querySelector('.pcr-status-dot')?.classList.toggle('loaded',st.loaded);
      el.title=st.label;el.disabled=excluded.has(el.dataset.device);
    }
    for(const el of content.querySelectorAll('.pcr-state[data-plc-tag]')) {
      const v=plcValues[el.dataset.plcTag],fault=el.dataset.plcTag.includes('Fault')||el.dataset.plcTag.endsWith('.HMI_fault');
      el.querySelector('b').textContent=v===undefined?'未读取':fault?(v?'异常':'正常'):(v?'有效':'无效');
      el.classList.toggle('inactive',v===undefined||!v);el.classList.toggle('fault',fault&&!!v);
    }
    if(page==='托盘数据'&&!s.paused)for(const el of content.querySelectorAll('[data-pallet-field]'))el.value=palletFor()[el.dataset.palletField];
    if(page==='手动操作') {
      for(const el of content.querySelectorAll('[data-arrival-tag]')) {
        const value=plcValues[el.dataset.arrivalTag];
        el.querySelector('i').style.background=value===undefined?'#a8b3c0':value?'#16a34a':'#cbd5e1';
        el.querySelector('b').textContent=value===undefined?'未读取':value?'已到位':'未到位';
      }
      const fields=content.querySelectorAll('.pcr-items strong');
      if(fields[0])fields[0].textContent=selected??'未读取';if(fields[1])fields[1].textContent=plcValues[b.chooser+'.HMI_Man_No2']??'未读取';
      const btn=content.querySelector('#pcr-manual-mode');if(btn)btn.textContent=s.manual?'手动已请求':'请求手动';
    }
  }
  function poll() {
    if(!plcOnline||readBusy)return;
    const tags=new Map(),b=bindings(),add=(tag,type)=>tags.set(tag,{tag,type});
    for(const field of ['HMI_Auto','HMI_Man','HMI_Start','HMI_EM'])add('AOI_HMI_OP_'+channel+'.'+field,'BOOL');
    add(b.manual,'BOOL');add(b.refresh,'BOOL');add(b.chooser+'.HMI_Man_No1','DINT');add(b.chooser+'.HMI_Man_No2','DINT');
    add('HMI_ZoneP1_Alarming','BOOL');add('HMI_ZoneZ5_Alarming','BOOL');
    if(page==='设备布局')for(const el of root.querySelectorAll('.pcr-machine'))if(!excluded.has(el.dataset.device))add(statusTag(el.dataset.device),'INT');
    if(!excluded.has(current().device)&&/^[PZ]\d{4}$/.test(current().device))add(statusTag(current().device),'INT');
    if(page==='设备状态')for(const [,f]of statusFields)add(b.status+'.'+f,'BOOL');
    if(page==='手动操作')for(const field of ['HMI_Stus_UpDn_At_Up','HMI_Stus_UpDn_At_Dn'])add(b.status+'.'+field,'BOOL');
    if(page==='托盘数据'||page==='手动操作') {
      for(const [field,type]of Object.entries(types))add(b.pallet+'.'+field,type);
      add(b.pallet+'.PalletID.LEN','DINT');for(let i=0;i<20;i++)add(b.pallet+'.PalletID.DATA['+i+']','SINT');
    }
    const id=String(++sequence);requests.set(id,{channel,page});readBusy=true;AndroidPlc.readTags(id,JSON.stringify([...tags.values()]));
  }
  window.onNativeConnected=function(json) {
    const r=parse(json);plcOnline=!!r.ok;readBusy=false;root.querySelector('#pcr-modal').hidden=true;render();feedback(r.message);if(plcOnline)poll();
  };
  window.onNativeDisconnected=function(){plcOnline=false;readBusy=false;render();feedback('PLC已断开');};
  window.onNativeWrite=function(json){const r=parse(json),p=pending.get(r.requestId);if(p){pending.delete(r.requestId);r.ok?p.resolve(r):p.reject(Error(r.tag+'：'+r.message));}};
  window.onNativeRead=function(json) {
    const r=parse(json),context=requests.get(r.requestId);requests.delete(r.requestId);readBusy=false;
    Object.assign(plcValues,r.values||{});
    if(context){const ch=context.channel,s=states[ch];s.manual=!!plcValues['HMI_Manual_'+ch];s.paused=!!plcValues['HMI_MAN_DATA_Ref_'+ch];s.automatic=!!plcValues['AOI_HMI_OP_'+ch+'.HMI_Auto'];s.running=!!plcValues['AOI_HMI_OP_'+ch+'.HMI_Start'];if(s.paused&&!s.draft&&ch===channel)s.draft={...palletFor()};}
    if(!jog&&!hold&&keyboard.hidden&&(page==='主画面'||page==='启停控制'))render();else paint();
    if(r.errors&&Object.keys(r.errors).length){for(const tag of Object.keys(r.errors))delete plcValues[tag];feedback('读取失败：'+Object.entries(r.errors).slice(0,2).map(([k,v])=>k+' '+v).join('；'));paint();}
  };
  // Capture real controls and suppress their preview counterparts.
  root.addEventListener('click',async event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    const key=button.dataset.keyAction;
    if(key==='confirm'&&keyTarget){
      event.stopImmediatePropagation();const target=keyTarget,value=keyBuffer;closeKeyboard();
      if(target.id==='pcr-device'||target.id==='pcr-man1'){await select(value);return;}
      try {
        if(target.dataset.inputIndex){await send(target.dataset.plcTag,'STR20',value);current().inputs[Number(target.dataset.inputIndex)]=value;render();}
        else if(target.dataset.palletField){const f=target.dataset.palletField;if(!current().paused)throw Error('请先停止数据刷新');if(f==='PalletID'&&value.length>20)throw Error('托盘号最多20字符');if(f!=='PalletID'&&(!value.trim()||!Number.isFinite(Number(value))))throw Error('请输入有效数字');await send(target.dataset.plcTag,f==='PalletID'?'STR20':types[f],value);current().draft[f]=f==='PalletID'?value:Number(value);target.value=value;feedback('缓冲字段已写入，尚未提交整盘');}
      }catch(e){feedback(e.message);}return;
    }
    if(button.id==='pcr-inbound'){event.stopImmediatePropagation();feedback('正在连接 '+PLC_HOST);AndroidPlc.connect(PLC_HOST);return;}
    const action=button.dataset.action;
    if(!['pcr-manual-mode','pcr-refresh','pcr-start','pcr-stop'].includes(button.id)&&!action)return;
    event.stopImmediatePropagation();if(!plcOnline){feedback('请先连接PLC');return;}
    const s=current(),b=bindings();
    try {
      if(button.id==='pcr-manual-mode'){release(false);await send(b.manual,'BOOL',s.manual?0:1);}
      if(button.id==='pcr-refresh'){const next=!s.paused;if(next)s.draft={...palletFor()};await send(b.refresh,'BOOL',next?1:0);s.paused=next;render();}
      if(button.id==='pcr-start'||button.id==='pcr-stop')await pulse(button.id==='pcr-start'?b.start:b.stop);
      if(action==='reset')await pulse(b.reset);
      if(action==='clear-in'||action==='clear-out')await pulse(b.status+(action==='clear-in'?'.HMI_Clr_In':'.HMI_Clr_Out'));
      poll();
    }catch(e){feedback(e.message);}
  },true);
  root.addEventListener('change',event=>{if(event.target.id==='pcr-auto'){event.stopImmediatePropagation();send(bindings().automatic,'BOOL',event.target.checked?1:0).then(poll).catch(()=>{});}},true);
  root.addEventListener('pointerdown',event=>{
    const button=event.target.closest('button');if(!button||button.disabled||(!button.dataset.jog&&!button.dataset.hold))return;
    event.stopImmediatePropagation();if(!plcOnline){feedback('请先连接PLC');return;}
    if(button.dataset.jog){
      if(jog||!current().manual){feedback('请先请求手动');return;}
      const active={button,channel,tag:bindings().jog[button.dataset.jog]};jog=active;button.setPointerCapture(event.pointerId);button.classList.add('pressed');send(active.tag,'BOOL',1).catch(()=>{if(jog===active)release(false);});
    }else{
      if(hold)return;
      const active={button,channel,tag:button.dataset.plcTag};hold=active;
      button.setPointerCapture(event.pointerId);button.classList.add('pressed');
      send(active.tag,'BOOL',1).catch(()=>{if(hold===active)release(false);});
    }
  },true);
  window.addEventListener('pagehide',()=>release(false));
  setInterval(poll,1000);
  const fit=()=>{previewScale=Math.min(innerWidth/1280,innerHeight/800);root.style.transform=`scale(${previewScale})`;stage.style.height=800*previewScale+'px';};
  new ResizeObserver(fit).observe(stage);fit();
  render();feedback('准备连接入库PLC '+PLC_HOST);AndroidPlc.connect(PLC_HOST);
