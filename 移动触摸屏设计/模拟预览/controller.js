(() => {
  const root = document.getElementById('pcr-preview');
  const stage = document.getElementById('pcr-stage');
  const content = root.querySelector('#pcr-content');
  const keyboard = root.querySelector('#pcr-keyboard');
  const names = ['主画面','设备布局','手动操作','设备状态','托盘数据','启停控制'];
  const icons = ['house','layout-dashboard','hand','activity','database','power'];
  const saved = window.openai?.widgetState?.privateContent || {};
  let channel = ['1P','3P'].includes(saved.channel) ? saved.channel : '3P';
  let page = names.includes(saved.page) ? saved.page : '设备布局';
  const states = {
    '1P': {device:'P1031',area:0,manual:false,running:false,paused:false,automatic:true,inputs:['P1031','','','']},
    '3P': {device:'Z5009',area:0,manual:false,running:false,paused:false,automatic:true,inputs:['Z5009','','','']}
  };
  for (const ch of ['1P','3P']) {
    const item = saved.channels?.[ch];
    if (item?.device) { states[ch].device = String(item.device); states[ch].inputs[0] = String(item.device); }
    if (Number.isInteger(item?.area)) states[ch].area = Math.max(0,Math.min(2,item.area));
  }
  if (saved.channel && saved.device) { states[channel].device=String(saved.device); states[channel].inputs[0]=String(saved.device); }
  if (saved.channel && Number.isInteger(saved.area)) states[channel].area=Math.max(0,Math.min(2,saved.area));
  const current = () => states[channel];
  const feedback = text => root.querySelector('#pcr-feedback').textContent = text;
  const readOnlyDevices = new Set(['P1002','P1010','P1013','P1021','P1150','P1151']);
  const gantryWcs = {P1004:'P1005',P1015:'P1016'};
  const statusWords = {P1031:1024,P1047:768,P1067:1024,P1075:1792,P1095:0,Z5003:1536,Z5009:1280,Z5017:1024,Z5023:768,Z5041:1024,Z5067:768,P1004:1280,P1015:1280,P1009:1280,P1020:256};
  const devicePallets = new Map();
  let previewScale=1, jog=null, hold=null, keyTarget=null, keyBuffer='', keyFresh=false, keyLimit=20, keyDrag=null;
  function fitPreview() { previewScale=Math.min(1,stage.clientWidth/1280);root.style.transform=`scale(${previewScale})`;stage.style.height=(800*previewScale)+'px'; }
  new ResizeObserver(fitPreview).observe(stage); fitPreview();
  function bindings(ch=channel) {
    return {
      inputs:[1,2,3,4].map(i=>`HMI_Input_DeviceNo_${ch}_${i}`),
      chooser:`AOI_HMI_ID_CHOOSE_${ch}`, status:`HMI_Status_Display_${ch}`, pallet:`HMI_PalletInfo_${ch}`,
      manual:`HMI_Manual_${ch}`, start:`HMI_${ch}_Start`, stop:`HMI_${ch}_Stop`, reset:`ISB_Rst_HMI_${ch}`,
      automatic:`AOI_HMI_OP_${ch}.HMI_Auto`, refresh:`HMI_MAN_DATA_Ref_${ch}`,
      write:`HMI_PalletData_Chg_${ch}`, clear:`HMI_PalletData_Clr_${ch}`,
      jog:{'A−':`HMI_Manaul_AC_Rev_${ch}`,'C＋':`HMI_Manaul_AC_Fwd_${ch}`,'B−':`HMI_Manaul_BD_Rev_${ch}`,'D＋':`HMI_Manaul_BD_Fwd_${ch}`,'上升':`HMI_Manaul_Up_${ch}`,'下降':`HMI_Manaul_Dn_${ch}`}
    };
  }
  function statusTag(id) { const n=Number(id.slice(1));return id.startsWith('P')?`SCADA_P[1,${n%1000}].DeviceStatus`:`SCADA_Z5[${n%1000}].DeviceStatus`; }
  function decoded(id=current().device) { const w=statusWords[id]??(256+(Number(id.slice(1))%3===0?1024:0));return {word:w,fault:!!(w&512),automatic:!!(w&256),loaded:!!(w&1024),mode:w&512?'fault':w&256?'auto':'manual',label:w&512?'故障':w&256?'自动':'手动'}; }
  function numericId(id) { const n=Number(id.slice(1));return Number.isFinite(n)?(id.startsWith('P')?100000:500000)+n:0; }
  function palletFor(id) {
    if(!devicePallets.has(id)) {
      const n=Number(id.slice(1))||0,loaded=decoded(id).loaded;
      devicePallets.set(id,{SerialNO:loaded?26000000+n:0,Src_Device:loaded?numericId(id):0,Dest_Device:loaded?101029:0,PalletID:loaded?'PCR'+String(n).padStart(8,'0'):'',Height:loaded?1:0,Weight:loaded?386.5:0});
    }
    return devicePallets.get(id);
  }
  function simWrite(tag,value,message) { root.dataset.lastTag=tag;root.dataset.lastValue=String(value);if(message!==false)feedback(message||`模拟 · ${tag} = ${value}`); }
  function pulse(tag,message) { simWrite(tag,1,message);setTimeout(()=>simWrite(tag,0,false),250); }
  function remember() {
    if(window.openai?.setWidgetState) window.openai.setWidgetState({modelContent:{page,device:current().device,channel,area:current().area},privateContent:{page,device:current().device,channel,area:current().area,channels:Object.fromEntries(Object.entries(states).map(([ch,s])=>[ch,{device:s.device,area:s.area}]))}}).catch(()=>{});
  }
  function escapeHtml(value) { return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  const panel=(title,body)=>`<section class="pcr-panel"><h3>${title}</h3>${body}</section>`;
  const items=arr=>`<div class="pcr-items">${arr.map(([a,b])=>`<div><span>${a}</span><strong>${b}</strong></div>`).join('')}</div>`;
  function select(value) {
    if(!value) return;
    release();const s=current();s.device=String(value);s.inputs[0]=String(value);s.paused=false;s.draft=null;
    simWrite(bindings().inputs[0],value,`${channel} · 主查询 / 手动链条 1：${value}（模拟）`);
    render();remember();
  }
  function switchChannel(ch,area) {
    release();closeKeyboard();channel=ch;
    if(Number.isInteger(area)) { current().area=area;page='设备布局'; }
    root.querySelector('#pcr-modal').hidden=true;render();remember();
    feedback(`${channel} 触摸屏 · 共用入库 PLC · 模拟预览`);
  }
  function layout() {
    const s=current(),data=PCR_LAYOUTS[channel][s.area],is3=channel==='3P';
    const total=(data.cols+(is3?2:.3))*64,base=is3?72:14,nodeW=58,positions={},nodes=[],links=[];
    const upperY=is3?(data.branch?12:90):184,lowerY=is3?(data.branch?100:200):278;
    function pos(id,col,y,dir,kind='') { const p={id,x:base+col*64,y,dir:data.turns[id]||dir,kind,w:nodeW+64*((data.spans?.[id]||1)-1)};positions[id]=p;nodes.push(p);return p; }
    const connect=(a,b,dir)=>{if(a&&b)links.push({a,b,dir});};
    data.upper.forEach((id,i)=>pos(id,data.upperX?.[i]??i,upperY,'←'));
    data.lower.forEach((id,i)=>pos(id,data.lowerX[i],lowerY,'→'));
    [data.upper,data.lower].forEach((ids,row)=>{for(let i=1;i<ids.length;i++)connect(positions[ids[i-1]],positions[ids[i]],row?'→':'←');});
    data.vertical.forEach(([a,b,dir])=>connect(positions[a],positions[b],dir));
    const racks=(data.racks||[]).map(r=>{
      const out=r.out.map((id,i)=>pos(id,r.left,upperY-(r.out.length-i)*46,'↓'));
      const ins=r.in.map((id,i)=>pos(id,r.right,upperY-(r.in.length-i)*46,'↑'));
      const outEnd=positions[r.upperOut]||nodes.find(n=>n.y===upperY&&Math.abs(n.x-(base+r.left*64))<10);
      const inEnd=positions[r.upperIn]||nodes.find(n=>n.y===upperY&&Math.abs(n.x-(base+r.right*64))<10);
      [...out,outEnd].forEach((n,i,arr)=>{if(i)connect(arr[i-1],n,'↓');});
      [...ins,inEnd].forEach((n,i,arr)=>{if(i)connect(arr[i-1],n,'↑');});
      return `<div class="pcr-srm" style="left:${(base+(r.left+r.right)/2*64+16)/total*100}%;top:34px;height:132px">SRM${r.id}<span>堆垛机</span></div>`;
    }).join('');
    if(data.extra) { const arr=data.extra.ids.map((id,i)=>pos(id,data.extra.col,i*46,'↓','buffer'));[...arr,positions.P1055].forEach((n,i,all)=>{if(i)connect(all[i-1],n,'↓');}); }
    let branchLabels='';
    if(data.branch) {
      const b=data.branch,out=b.out.map((id,i)=>pos(id,b.outCol,158+i*50,'↓','process')),ins=b.inTopDown.map((id,i)=>pos(id,b.inCol,158+i*50,'↑','process'));
      const bridge=pos(b.bridge,(b.outCol+b.inCol)/2,308,'→','process');
      connect(positions[b.outFrom],out[0],'↓');out.forEach((p,i)=>{if(i)connect(out[i-1],p,'↓');});
      connect(out.at(-1),bridge,'→');connect(bridge,ins.at(-1),'→');
      for(let i=ins.length-1;i>0;i--)connect(ins[i],ins[i-1],'↑');
      connect(ins[0],positions[b.inTo],'↑');
      const label=(id,text,inbound=false)=>{const p=positions[id];return `<div class="pcr-branch-label ${inbound?'inbound':''}" style="left:${(p.x+(inbound?p.w+7:-7))/total*100}%;top:${p.y+12}px">${text}</div>`;};
      branchLabels=label(b.out[0],'空托盘 ↓')+label(b.liftOut,'升降机')+label(b.stripper,'拆盘机')+label(b.gantry,'龙门装盘位')+label(b.liftIn,'升降机',true)+label(b.inTopDown[2],'满盘扫码位',true);
    }
    const dockPairs=new Set();
    data.vertical.forEach(([a,b,dir])=>{const p=positions[a],q=positions[b],upper=p.y<q.y?p:q,lower=p.y<q.y?q:p,middle=(upper.y+44+lower.y)/2;upper.boxY=upper.y;upper.boxHeight=middle-1-upper.y;upper.dock='dock-upper';upper.dockDir=dir;lower.boxY=middle+1;lower.boxHeight=lower.y+44-lower.boxY;lower.dock='dock-lower';lower.dockDir=dir;dockPairs.add([a,b].sort().join('|'));});
    // Extend standalone transfer outlines without inventing a connection below.
    Object.entries(data.upperTransfers||{}).forEach(([id,dir])=>{const p=positions[id];if(!p)return;p.boxY=p.y;p.boxHeight=(upperY+44+lowerY)/2-1-p.y;p.dock='dock-upper';p.dockDir=dir;});
    const wires=links.map(({a,b,dir})=>{if(dockPairs.has([a.id,b.id].sort().join('|')))return '';if(a.y===b.y){const left=Math.min(a.x,b.x)+nodeW/2,right=Math.max(a.x,b.x)+nodeW/2;return `<div class="pcr-wire horizontal" style="left:${left/total*100}%;width:${(right-left)/total*100}%;top:${a.y+27}px"></div>`;}const top=Math.min(a.y,b.y)+27,bottom=Math.max(a.y,b.y)+27;return `<div class="pcr-wire vertical" style="left:${(a.x+nodeW/2)/total*100}%;top:${top}px;height:${bottom-top}px"><span>${dir}</span></div>`;}).join('');
    const devices=nodes.map(n=>{const status=decoded(n.id),wcs=gantryWcs[n.id];return `<button class="pcr-machine mode-${status.mode} ${n.id===s.device?'selected':''} ${n.kind} ${n.dock||''}" data-device="${n.id}" data-status-tag="${statusTag(n.id)}" aria-label="${n.id}，模拟${status.label}，${status.loaded?'有托盘':'无托盘'}${wcs?'，WCS点位'+wcs:''}，物流方向${n.dir}" style="left:${n.x/total*100}%;top:${n.boxY??n.y}px;width:${n.w/total*100}%;height:${n.boxHeight??44}px"><span class="pcr-machine-inner" style="top:${n.y-(n.boxY??n.y)}px"><strong>${n.id}</strong><span class="pcr-flow">${n.dock?n.dir.replace(/[↑↓]/g,'').trim():n.dir}</span><span class="pcr-status-dot ${status.loaded?'loaded':'empty'}" aria-hidden="true"></span></span>${n.dock?`<span class="pcr-dock-flow" aria-hidden="true">${n.dockDir}</span>`:''}</button>`;}).join('');
    function boundary(meta,side) {
      if(!meta)return '';
      return [['upper',upperY,'←'],['lower',lowerY,'→']].map(([row,y,arrow])=>`<button class="pcr-handoff" data-channel="${meta.channel}" data-layout-area="${meta.area}" style="${side}:0;width:${(is3?64:78)/total*100}%;top:${y-11}px" aria-label="转到${meta.channel} ${PCR_LAYOUTS[meta.channel][meta.area].title}"><small>${meta.channel===channel?(side==='left'?'上一页':'下一页'):meta.channel+' 衔接'}</small><span>${arrow}</span><strong>${meta[row]}</strong></button>`).join('');
    }
    const fallbackLeft=!data.leftBoundary&&s.area>0?{channel,area:s.area-1,upper:'上主线',lower:'下主线'}:null;
    const fallbackRight=!data.rightBoundary&&s.area<2?{channel,area:s.area+1,upper:'上主线',lower:'下主线'}:null;
    const sideButtons=is3?boundary(data.leftBoundary,'left')+boundary(data.rightBoundary,'right'):(data.rightBoundary?boundary(data.rightBoundary,'right'):'')+(fallbackLeft?`<button class="pcr-boundary bottom" data-area="${s.area-1}">上一页 →</button>`:'')+(fallbackRight?`<button class="pcr-boundary right-bottom" data-area="${s.area+1}">下一页 →</button>`:'');
    let ports='';
    if(data.ports)ports='<div class="pcr-port upper">P1124 · 异常上下线口</div><div class="pcr-port lower">P1103 · 异常上下线口</div>';
    if(data.exceptionPorts) {
      const p=data.exceptionPorts;
      ports=[['upper',upperY,p.upper],['lower',lowerY,p.lower]].map(([row,y,id])=>`<div class="pcr-port-info" style="left:${(base+p.col*64)/total*100}%;top:${y+1}px"><strong>异常 / 平库上下线口</strong><span>386.5 kg</span><span>PCR0000${id.slice(1)}</span></div>`).join('');
    }
    return `<section class="pcr-panel pcr-layout-panel"><div class="pcr-row"><div class="pcr-tabs">${PCR_LAYOUTS[channel].map((x,i)=>`<button data-area="${i}" aria-pressed="${s.area===i}">${x.title}</button>`).join('')}</div></div><div class="pcr-topology ${data.branch?'has-branches':''}" data-layout-channel="${channel}" data-layout-index="${s.area}">${wires}${racks}${devices}${branchLabels}${ports}${sideButtons}</div><div class="pcr-row pcr-map-bottom"><div class="pcr-legend"><span><i class="pcr-status-swatch auto"></i>自动</span><span><i class="pcr-status-swatch manual"></i>手动</span><span><i class="pcr-status-swatch fault"></i>故障</span><span><i class="pcr-pallet-key filled"></i>有托盘</span><span><i class="pcr-pallet-key"></i>无托盘</span><span>模拟状态</span></div><div class="pcr-actions"><button data-go="设备状态">查看状态</button><button data-go="托盘数据">托盘数据</button><button class="pcr-primary" data-go="手动操作">手动操作</button></div></div></section>`;
  }
  const statusFields=[['总错误','HMI_fault',true],['链条过载','HMI_Fault_Link',true],['升降过载','HMI_Fault_UpDn',true],['上限信号','HMI_Fault_UpLim',true],['下限信号','HMI_Fault_DnLim',true],['移载过载','HMI_Fault_UpDn_Move',true],['运行超时','HMI_Fault_Run_TimeOut',true],['进件中','HMI_Stus_In'],['出件中','HMI_Stus_Out'],['上升中','HMI_Stus_Up'],['下降中','HMI_Stus_Dn'],['上位','HMI_Stus_UpDn_At_Up'],['下位','HMI_Stus_UpDn_At_Dn'],['入口光电','HMI_Stus_In_IPH'],['出口光电','HMI_Stus_Out_IPH'],['有盘无数据','HMI_Fault_HavePall_NoData',true],['有数据无盘','HMI_Fault_NoPall_HaveData',true],['被禁用','HMI_Fault_Forbid',true],['托盘检测异常','HMI_Fault_IPH_Err',true],['升降检测异常','HMI_Fault_IPX_Err',true]];
  const palletFields=[['任务号','SerialNO','integer'],['源地址','Src_Device','integer'],['目标地址','Dest_Device','integer'],['托盘号','PalletID','text'],['外检状态','Height','integer'],['重量 / kg','Weight','decimal']];
  function render() {
    closeKeyboard();const s=current(),b=bindings(),status=decoded(),pallet=palletFor(s.device);
    root.dataset.channel=channel;root.dataset.mode='simulation';root.dataset.layout=String(page==='设备布局');
    root.querySelector('#pcr-nav').innerHTML=names.map((x,i)=>`<button data-page="${x}" ${page===x?'aria-current="page"':''}><i data-lucide="${icons[i]}" aria-hidden="true"></i>${x}</button>`).join('');
    root.querySelector('#pcr-title').textContent=page;root.querySelector('#pcr-subtitle').textContent='入库输送系统 / '+channel;
    root.querySelector('#pcr-channel-caption').textContent=channel+' 触摸屏 · 模拟连接';root.querySelector('#pcr-channel-footer').textContent=channel+' 操作通道 · 共用入库 PLC';
    root.querySelectorAll('[data-channel]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.channel===channel)));
    root.querySelector('#pcr-device').value=s.device;root.querySelector('#pcr-device').dataset.plcTag=b.inputs[0];
    root.querySelector('#pcr-selected').textContent='当前：'+s.device;
    if(page==='设备布局')content.innerHTML=layout();
    if(page==='主画面') content.innerHTML=`<div class="pcr-summary">${panel('连接状态',`<div class="pcr-big">模拟在线</div><div class="pcr-caption">入库 PLC · ${channel} 通道</div>`)}${panel('区域状态',`<div class="pcr-big">${s.running?'已启动':'已停止'}</div><div class="pcr-caption">${channel} 控制范围</div>`)}${panel('当前设备',`<div class="pcr-big">${s.device}</div><div class="pcr-caption">模拟${status.label} · ${status.loaded?'有托盘':'无托盘'}</div>`)}</div>${panel('区域入口','<div class="pcr-actions" style="margin-top:20px"><button data-go="设备布局">进入设备布局 →</button><button data-go="手动操作">进入手动操作 →</button><button data-go="托盘数据">进入托盘数据 →</button></div>')}<div style="margin-top:18px">${panel('触摸屏通道',`<p class="pcr-caption">两组触摸屏共用入库 PLC，查询和操作标签按通道独立。</p><div class="pcr-actions" style="margin-top:16px"><button data-channel="1P">1P 触摸屏${channel==='1P'?' · 当前':''}</button><button data-channel="3P">3P 触摸屏${channel==='3P'?' · 当前':''}</button></div>`)}</div>`;
    if(page==='手动操作') content.innerHTML=`<div class="pcr-grid pcr-manual-grid"><section class="pcr-panel"><div class="pcr-row"><h3>手动点动 · ${channel}</h3><button id="pcr-manual-mode" class="${s.manual?'pcr-primary':''}" data-plc-tag="${b.manual}">${s.manual?'手动已请求':'请求手动'}</button></div><div class="pcr-caption">按住运行 · 松开停止</div><div class="pcr-man-top" style="margin-top:12px"><label>手动链条 1<input id="pcr-man1" value="${escapeHtml(s.device)}" data-input-index="0" data-plc-tag="${b.inputs[0]}"></label><label>手动链条 2<input value="${escapeHtml(s.inputs[1])}" data-input-index="1" data-plc-tag="${b.inputs[1]}" placeholder="未选择"></label></div><div class="pcr-jog"><span></span><button data-jog="D＋" data-plc-tag="${b.jog['D＋']}">↑<small>D＋ / B→D</small></button><span></span><button data-jog="A−" data-plc-tag="${b.jog['A−']}">←<small>A− / C→A</small></button><div class="pcr-jog-center" id="pcr-jog-state">${s.manual?'等待点动':'请先请求手动'}</div><button data-jog="C＋" data-plc-tag="${b.jog['C＋']}">→<small>C＋ / A→C</small></button><span></span><button data-jog="B−" data-plc-tag="${b.jog['B−']}">↓<small>B− / D→B</small></button><span></span><button data-jog="上升" data-plc-tag="${b.jog['上升']}">↑<small>上升</small></button><span></span><button data-jog="下降" data-plc-tag="${b.jog['下降']}">↓<small>下降</small></button></div></section><div style="display:grid;gap:16px;align-content:start">${panel('PLC选择结果（模拟）',items([['手动链条 1',numericId(s.device)],['手动链条 2',s.inputs[1]?numericId(s.inputs[1]):0],['托盘号',pallet.PalletID||'—'],...(gantryWcs[s.device]?[['WCS点位',gantryWcs[s.device]]]:[])]))}${panel('禁用链条编号',`<div class="pcr-man-top" style="margin:14px 0 0"><label>禁用链条 1<input value="${escapeHtml(s.inputs[2])}" data-input-index="2" data-plc-tag="${b.inputs[2]}" placeholder="未设置"></label><label>禁用链条 2<input value="${escapeHtml(s.inputs[3])}" data-input-index="3" data-plc-tag="${b.inputs[3]}" placeholder="未设置"></label></div>`)}</div></div>`;
    if(page==='设备状态') content.innerHTML=`<section class="pcr-panel pcr-state-panel" data-plc-tag="${b.status}"><div class="pcr-row"><h3>设备状态 · ${escapeHtml(s.device)}</h3><span class="pcr-chip">${channel} · 模拟${status.label}</span></div><div class="pcr-state-grid">${statusFields.map(([label,field,fault])=>{const active=fault?(status.fault&&['HMI_fault','HMI_Fault_Link'].includes(field)):(field==='HMI_Stus_UpDn_At_Dn'||field==='HMI_Stus_In_IPH'&&status.loaded);return `<div class="pcr-state ${!active?'inactive':''} ${fault&&active?'fault':''}" data-plc-tag="${b.status}.${field}">${label}<b>${fault?(active?'异常':'正常'):(active?'有效':'无效')}</b></div>`;}).join('')}</div><div class="pcr-actions pcr-state-actions"><button data-action="clear-in" data-plc-tag="${b.status}.HMI_Clr_In">清进件命令</button><button data-action="clear-out" data-plc-tag="${b.status}.HMI_Clr_Out">清出件命令</button></div></section>`;
    if(page==='托盘数据') { const values=s.paused?s.draft:pallet;content.innerHTML=`<div class="pcr-grid" style="grid-template-columns:minmax(0,1.7fr) minmax(0,1fr)"><section class="pcr-panel"><div class="pcr-row"><h3>托盘信息 · ${escapeHtml(s.device)}</h3><span class="pcr-chip">${s.paused?'已停止刷新':'模拟刷新中'}</span></div><div class="pcr-fields">${palletFields.map(([label,field,kind])=>`<label>${label}<input value="${escapeHtml(values[field])}" data-pallet-field="${field}" data-vk-kind="${kind}" data-plc-tag="${b.pallet}.${field}" ${s.paused?'':'readonly'}></label>`).join('')}</div>${gantryWcs[s.device]?`<p class="pcr-note">链条移栽机 ${s.device} · WCS交互点位 ${gantryWcs[s.device]}</p>`:''}</section><section class="pcr-panel pcr-data-actions"><h3>数据维护 · ${channel}</h3><button id="pcr-refresh" data-plc-tag="${b.refresh}">${s.paused?'恢复数据刷新':'停止数据刷新'}</button><button class="pcr-primary" data-hold="写入" data-plc-tag="${b.write}" ${s.paused?'':'disabled'}>长按 3 秒写入</button><button class="pcr-danger" data-hold="清除" data-plc-tag="${b.clear}" ${s.paused?'':'disabled'}>长按 3 秒清除</button><p class="pcr-note">停止刷新 → 编辑 → 写入 → 恢复刷新。<br>本页仅模拟，不连接现场 PLC。</p></section></div>`; }
    if(page==='启停控制') content.innerHTML=`<section class="pcr-panel"><div class="pcr-row"><div><h3>${channel} 区域控制</h3><p class="pcr-caption">当前状态：${s.running?'已启动':'已停止'}</p></div><span class="pcr-chip">● 模拟操作许可正常</span></div><div class="pcr-items"><div><span>区域自动使能</span><label><input id="pcr-auto" type="checkbox" ${s.automatic?'checked':''} data-plc-tag="${b.automatic}" style="width:22px;min-height:22px"> 已启用</label></div></div><div class="pcr-run-buttons"><button class="pcr-primary" id="pcr-start" data-plc-tag="${b.start}">启动</button><button class="pcr-danger" id="pcr-stop" data-plc-tag="${b.stop}">停止</button><button data-action="reset" data-plc-tag="${b.reset}">复位</button></div><p class="pcr-note" style="margin-top:22px">区域启停作用于 ${channel} 控制范围，共用入库 PLC。</p></section>`;
    if(page==='手动操作'&&readOnlyDevices.has(s.device)) {content.querySelectorAll('[data-jog],#pcr-manual-mode').forEach(el=>el.disabled=true);content.querySelector('#pcr-jog-state').textContent='此设备仅查看状态';}
    configureInputs();
    if(globalThis.lucide)lucide.createIcons({attrs:{width:19,height:19}});
  }
  function closeKeyboard() { if(keyTarget)keyTarget.removeAttribute('data-vk-active');keyTarget=null;keyboard.hidden=true; }
  function configureInputs() { root.querySelectorAll('input').forEach(input=>{if(input.type==='checkbox')return;const label=(input.closest('label')?.textContent||input.getAttribute('aria-label')||'输入内容').trim();input.dataset.vkEnabled=String(!(page==='托盘数据'&&content.contains(input)&&!current().paused));input.dataset.vkLabel=label;input.dataset.vkKind=input.dataset.vkKind||(/任务号|源地址|目标地址|外检状态/.test(label)?'integer':/重量/.test(label)?'decimal':'text');input.readOnly=true;input.inputMode='none';input.autocomplete='off';input.spellcheck=false;}); }
  function updateKeyDisplay() { root.querySelector('#pcr-key-value').textContent=keyBuffer||' ';root.querySelector('#pcr-key-count').textContent=keyBuffer.length+' / '+keyLimit;root.querySelector('#pcr-key-value').style.background=keyFresh?'var(--p-soft)':'transparent'; }
  function openKeyboard(input) {
    closeKeyboard();keyTarget=input;keyBuffer=input.value;keyFresh=true;keyLimit=input.maxLength>0?input.maxLength:20;
    const numeric=input.dataset.vkKind!=='text';keyboard.classList.toggle('numeric',numeric);root.querySelector('#pcr-key-keys').classList.toggle('numeric',numeric);root.querySelector('#pcr-key-title').textContent=input.dataset.vkLabel;
    const keys=numeric?(input.dataset.vkKind==='decimal'?'789456123-0.':'7894561230'):'1234567890QWERTYUIOPASDFGHJKLZXCVBNM-_';
    root.querySelector('#pcr-key-keys').innerHTML=Array.from(keys).map(k=>`<button type="button" data-key-char="${k}">${k}</button>`).join('');keyboard.classList.remove('compact');keyboard.hidden=false;
    const rect=input.getBoundingClientRect(),bounds=root.getBoundingClientRect(),gap=12,margin=12,anchor={left:(rect.left-bounds.left)/previewScale,right:(rect.right-bounds.left)/previewScale,top:(rect.top-bounds.top)/previewScale,bottom:(rect.bottom-bounds.top)/previewScale};
    const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
    const place=()=>{const w=keyboard.offsetWidth,h=keyboard.offsetHeight,x=clamp(anchor.left,margin,1280-w-margin),y=clamp(anchor.top,margin,800-h-margin);if(anchor.bottom+gap+h<=800-margin)return{x,y:anchor.bottom+gap};if(anchor.top-gap-h>=margin)return{x,y:anchor.top-gap-h};if(anchor.right+gap+w<=1280-margin)return{x:anchor.right+gap,y};if(anchor.left-gap-w>=margin)return{x:anchor.left-gap-w,y};return null;};
    let position=place();if(!position){keyboard.classList.add('compact');position=place();}if(!position)position={x:clamp(anchor.left,margin,1280-keyboard.offsetWidth-margin),y:clamp(anchor.bottom+gap,margin,800-keyboard.offsetHeight-margin)};
    keyboard.style.left=position.x+'px';keyboard.style.top=position.y+'px';keyboard.style.right='auto';keyboard.style.bottom='auto';input.setAttribute('data-vk-active','true');input.blur();updateKeyDisplay();
  }
  function release(showFeedback=true) {
    if(jog) {simWrite(jog.tag,0,showFeedback?`模拟 · ${jog.channel} 点动已停止`:false);jog.button.classList.remove('pressed');jog=null;const state=content.querySelector('#pcr-jog-state');if(state)state.textContent='等待点动';}
    if(hold) {clearTimeout(hold.timer);hold.button.textContent=hold.label;hold=null;}
  }
  root.querySelector('#pcr-key-close').onclick=closeKeyboard;
  root.querySelector('#pcr-query').onclick=()=>select(root.querySelector('#pcr-device').value);
  root.querySelector('#pcr-connection').onclick=()=>root.querySelector('#pcr-modal').hidden=false;
  root.querySelector('#pcr-close').onclick=()=>root.querySelector('#pcr-modal').hidden=true;
  root.querySelector('#pcr-inbound').onclick=()=>{root.querySelector('#pcr-modal').hidden=true;feedback('入库 PLC · '+channel+' · 模拟连接');};
  keyboard.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.keyChar!==undefined) {const next=(keyFresh?'':keyBuffer)+button.dataset.keyChar,kind=keyTarget?.dataset.vkKind;if(kind==='integer'&&!/^\d*$/.test(next)||kind==='decimal'&&!/^-?\d*\.?\d*$/.test(next))return;if(next.length<=keyLimit){keyBuffer=next;keyFresh=false;updateKeyDisplay();}}
    const action=button.dataset.keyAction;
    if(action==='clear'){keyBuffer='';keyFresh=false;updateKeyDisplay();}if(action==='backspace'){keyBuffer=keyFresh?'':keyBuffer.slice(0,-1);keyFresh=false;updateKeyDisplay();}if(action==='cancel')closeKeyboard();
    if(action==='confirm'&&keyTarget) {const target=keyTarget,value=keyBuffer;target.value=value;closeKeyboard();if(target.id==='pcr-device'||target.id==='pcr-man1')select(value);else if(target.dataset.inputIndex){current().inputs[Number(target.dataset.inputIndex)]=value;simWrite(target.dataset.plcTag,value);render();}else if(target.dataset.palletField){const key=target.dataset.palletField;current().draft[key]=key==='PalletID'?value:Number(value);simWrite(target.dataset.plcTag,value);}}
  });
  const handle=root.querySelector('#pcr-key-handle');
  handle.addEventListener('pointerdown',event=>{if(event.target.closest('button'))return;const box=keyboard.getBoundingClientRect(),base=root.getBoundingClientRect();keyDrag={x:event.clientX,y:event.clientY,left:(box.left-base.left)/previewScale,top:(box.top-base.top)/previewScale};handle.setPointerCapture(event.pointerId);event.preventDefault();});
  handle.addEventListener('pointermove',event=>{if(!keyDrag)return;keyboard.style.left=Math.max(8,Math.min(1280-keyboard.offsetWidth-8,keyDrag.left+(event.clientX-keyDrag.x)/previewScale))+'px';keyboard.style.top=Math.max(8,Math.min(800-keyboard.offsetHeight-8,keyDrag.top+(event.clientY-keyDrag.y)/previewScale))+'px';});
  handle.addEventListener('pointerup',()=>keyDrag=null);handle.addEventListener('pointercancel',()=>keyDrag=null);
  root.addEventListener('pointerdown',event=>{
    const input=event.target.closest('input[data-vk-enabled="true"]');if(input){event.preventDefault();openKeyboard(input);return;}
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.jog) {if(!current().manual){feedback('请先请求手动');return;}jog={button,channel,tag:bindings().jog[button.dataset.jog]};button.classList.add('pressed');button.setPointerCapture(event.pointerId);content.querySelector('#pcr-jog-state').textContent=button.dataset.jog+' 点动中';simWrite(jog.tag,1);}
    if(button.dataset.hold) {const label=button.textContent;button.textContent='保持按住…';button.setPointerCapture(event.pointerId);const activeChannel=channel;hold={button,label,timer:setTimeout(()=>{if(channel!==activeChannel||!current().paused)return;const s=current(),draft=s.draft;if(button.dataset.hold==='写入'&&(!Number(draft.Dest_Device)||!draft.PalletID.trim())){feedback('目标地址和托盘号不能为空');button.textContent=label;hold=null;return;}if(button.dataset.hold==='写入'&&draft.Weight!==0&&(draft.Weight<50||draft.Weight>600)){feedback('重量有效范围为50～600 kg');button.textContent=label;hold=null;return;}if(button.dataset.hold==='写入')devicePallets.set(s.device,{...draft});else {s.draft={SerialNO:0,Src_Device:0,Dest_Device:0,PalletID:'',Height:0,Weight:0};devicePallets.set(s.device,{...s.draft});}pulse(button.dataset.plcTag,`模拟 · ${channel} 托盘数据${button.dataset.hold}请求`);hold=null;render();},3000)};}
  });
  root.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||button.disabled)return;
    if(button.dataset.channel){switchChannel(button.dataset.channel,button.dataset.layoutArea!==undefined?Number(button.dataset.layoutArea):undefined);return;}
    if(button.dataset.page||button.dataset.go){release();page=button.dataset.page||button.dataset.go;render();remember();return;}
    if(button.dataset.device){select(button.dataset.device);return;}
    if(button.dataset.area!==undefined){release();current().area=Number(button.dataset.area);render();remember();return;}
    const s=current(),b=bindings();
    if(button.id==='pcr-manual-mode'){s.manual=!s.manual;simWrite(b.manual,s.manual?1:0);render();}
    if(button.id==='pcr-refresh'){s.paused=!s.paused;s.draft=s.paused?{...palletFor(s.device)}:null;simWrite(b.refresh,s.paused?1:0);render();}
    if(button.id==='pcr-start'||button.id==='pcr-stop'){s.running=button.id==='pcr-start';pulse(s.running?b.start:b.stop,`模拟 · ${channel} 已${s.running?'启动':'停止'}`);render();}
    if(button.dataset.action==='reset')pulse(b.reset,`模拟 · ${channel} 复位请求`);
    if(button.dataset.action==='clear-in')pulse(b.status+'.HMI_Clr_In',`模拟 · ${channel} 清进件命令`);
    if(button.dataset.action==='clear-out')pulse(b.status+'.HMI_Clr_Out',`模拟 · ${channel} 清出件命令`);
  });
  root.addEventListener('change',event=>{if(event.target.id==='pcr-auto'){current().automatic=event.target.checked;simWrite(bindings().automatic,event.target.checked?1:0);}});
  root.addEventListener('keydown',event=>{const input=event.target.closest('input[data-vk-enabled="true"]');if(input&&(event.key==='Enter'||event.key===' ')){event.preventDefault();openKeyboard(input);}if(event.key==='Escape')closeKeyboard();});
  root.addEventListener('pointerup',()=>release());root.addEventListener('pointercancel',()=>release());window.addEventListener('blur',()=>release());document.addEventListener('visibilitychange',()=>{if(document.hidden)release();});
  window.addEventListener('openai:set_globals',event=>{const state=event.detail?.globals?.widgetState?.privateContent;if(!state||!['1P','3P'].includes(state.channel))return;release(false);channel=state.channel;if(names.includes(state.page))page=state.page;if(state.device){current().device=String(state.device);current().inputs[0]=String(state.device);}if(Number.isInteger(state.area))current().area=Math.max(0,Math.min(2,state.area));render();});
  render();feedback(`${channel} 触摸屏 · 共用入库 PLC · 模拟预览`);
})();
