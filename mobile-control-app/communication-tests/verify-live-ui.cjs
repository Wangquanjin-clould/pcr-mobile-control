const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require('C:/Users/wangquanjin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{
  const p=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
  p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{
   window.testWrites=[];window.testReads=[];const data={};
   const callback=(name,r)=>setTimeout(()=>window[name](JSON.stringify(r)),5);
   window.AndroidPlc={connect:host=>callback('onNativeConnected',{ok:true,message:'TEST '+host}),
    writeTag:(id,tag,type,value)=>{window.testWrites.push({tag,type,value});data[tag]=value==='1';callback('onNativeWrite',{ok:true,requestId:id,tag});},
    writeString:(id,tag,value)=>{window.testWrites.push({tag,type:'STR20',value});callback('onNativeWrite',{ok:true,requestId:id,tag});},
    readTags:(id,json)=>{const tags=JSON.parse(json),values={};window.testReads.push(...tags);for(const {tag,type}of tags)values[tag]=data[tag]??(tag.endsWith('.HMI_Stus_UpDn_At_Up')?true:tag.includes('HMI_Man_No1')?101025:tag.includes('DeviceStatus')?1280:type==='BOOL'?false:0);callback('onNativeRead',{ok:true,values,requestId:id});}
   };
  });
  await p.goto('file:///'+path.resolve(__dirname,'../app/src/main/assets/index.html').replaceAll('\\','/'));await p.waitForTimeout(100);
  for(const ch of ['1P','3P']){
   await p.locator('.pcr-channel-tabs [data-channel="'+ch+'"]').click();
   for(const page of ['主画面','设备布局','手动操作','设备状态','托盘数据','启停控制']){
    await p.locator('#pcr-nav [data-page="'+page+'"]').click();await p.waitForTimeout(40);
    if(page==='手动操作'){
     const up='HMI_Status_Display_'+ch+'.HMI_Stus_UpDn_At_Up',dn='HMI_Status_Display_'+ch+'.HMI_Stus_UpDn_At_Dn';
     await p.waitForFunction(tag=>document.querySelector('[data-arrival-tag="'+tag+'"] b')?.textContent==='已到位',up);
     assert.equal(await p.locator('[data-arrival-tag="'+dn+'"] b').textContent(),'未到位');
    }
    const overflow=await p.locator('#pcr-content button').evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.width&&r.height&&(r.bottom>800.5||r.right>1280.5||r.top<0||r.left<0);}).map(e=>e.textContent));
    assert.deepEqual(overflow,[],ch+' '+page+' clipped');
    if(page==='设备布局')for(let i=0;i<3;i++){
     await p.locator('.pcr-tabs [data-area="'+i+'"]').click();assert.ok(await p.locator('.pcr-machine').count());
     if(ch==='1P'&&i===0){
      for(const [id,index] of [['P1040',40],['P1050',50]])assert.equal(await p.locator('.pcr-machine[data-device="'+id+'"]').getAttribute('data-status-tag'),'SCADA_P[1,'+index+'].DeviceStatus');
      assert.equal(await p.locator('.pcr-machine[data-device="P1140"],.pcr-machine[data-device="P1150"]').count(),0);
     }
     if(ch==='1P'&&i===1)assert.equal(await p.locator('.pcr-machine[data-device="P1140"]').count(),1);
    }
   }
  }
  await p.locator('#pcr-nav [data-page="手动操作"]').click();await p.locator('#pcr-manual-mode').click();await p.waitForTimeout(1200);
  const jog=p.locator('[data-jog="C＋"]'),box=await jog.boundingBox();
  await p.mouse.move(box.x+box.width/2,box.y+box.height/2);await p.mouse.down();await p.waitForTimeout(60);await p.mouse.move(1200,750);await p.mouse.up();await p.waitForTimeout(100);
  const writes=await p.evaluate(()=>window.testWrites.filter(w=>w.tag==='HMI_Manaul_AC_Fwd_3P'));
  assert.deepEqual(writes.map(w=>w.value),['1','0'],'hold/release must use the active 3P tag');
  for(const ch of ['1P','3P']){
   await p.locator('.pcr-channel-tabs [data-channel="'+ch+'"]').click();
   await p.locator('#pcr-nav [data-page="托盘数据"]').click();
   for(const [label,suffix] of [['写入','Chg'],['清除','Clr']]){
    const button=p.locator('[data-hold="'+label+'"]');assert.equal(await button.isEnabled(),true);
    assert.equal(await button.textContent(),label);
    const rect=await button.boundingBox();await p.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await p.mouse.down();await p.waitForTimeout(70);
    const tag='HMI_PalletData_'+suffix+'_'+ch;
    assert.equal(await p.evaluate(tag=>window.testWrites.filter(w=>w.tag===tag).at(-1)?.value,tag),'1','press sends immediately');
    await p.mouse.move(1200,750);await p.mouse.up();await p.waitForTimeout(80);
    assert.deepEqual(await p.evaluate(tag=>window.testWrites.filter(w=>w.tag===tag).map(w=>w.value),tag),['1','0'],'release sends zero without delayed submission');
   }
  }
  assert.equal((await p.evaluate(()=>window.testReads)).some(x=>/SCADA_P\[1,24[89]\]|SCADA_P\[1,25[01]\]/.test(x.tag)),false);
  assert.deepEqual(errors,[]);
  console.log('PASS: 12 pages, six layouts, bounds, excluded tags, jog and 1P/3P pallet press/release 1/0. Native bridge mocked; PLC actions not executed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
