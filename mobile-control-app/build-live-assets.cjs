// Package the approved layout and keyboard with a real Logix bridge.
const fs=require('fs'),path=require('path'),vm=require('vm');
const base=path.join(__dirname,'../移动触摸屏设计/模拟预览');
let controller=fs.readFileSync(path.join(base,'controller.js'),'utf8');
controller=controller.replace("saved.channel : '3P'","saved.channel : '1P'");
// The native runtime handles these controls in capture phase, before preview handlers.
controller=controller.replace('  render();feedback(`${channel} 触摸屏 · 共用入库 PLC · 模拟预览`);',fs.readFileSync(path.join(__dirname,'live-runtime.js'),'utf8'));
controller=controller.replace('root.dataset.mode=\'simulation\'','root.dataset.mode=\'live\'')
 .replaceAll("${s.paused?'':'disabled'}>长按 3 秒",'>')
 .replaceAll('长按提交','按住写入或清除，松开释放')
 .replaceAll('模拟在线',"${plcOnline?'PLC在线':'PLC未连接'}")
 .replaceAll('386.5 kg','重量见托盘数据').replaceAll('PCR0000${id.slice(1)}','${id}')
 .replaceAll('本页仅模拟，不连接现场 PLC。','写入/清除：按下置1，松开置0，由PLC处理。')
 .replaceAll('模拟刷新中','PLC刷新中').replaceAll('模拟状态','PLC状态')
 .replaceAll('PLC选择结果（模拟）','PLC实际选择结果')
 .replaceAll('模拟操作许可正常',"${plcValues['AOI_HMI_OP_'+channel+'.HMI_EM']===undefined?'许可未读取':plcValues['AOI_HMI_OP_'+channel+'.HMI_EM']?'操作许可正常':'操作许可未满足'}")
 .replaceAll('模拟连接','等待连接')
 .replaceAll('模拟${status.label}','${status.label}');
const layouts=Object.fromEntries(['1P','3P'].map(ch=>[ch,JSON.parse(fs.readFileSync(path.join(base,'layout-'+ch.toLowerCase()+'.json'),'utf8'))]));
const script='const PCR_LAYOUTS='+JSON.stringify(layouts)+';\n'+controller;
new vm.Script(script);
let shell=fs.readFileSync(path.join(base,'shell.html'),'utf8').replace('界面预览 · 模拟数据','PLC 在线调试').replace('● 模拟在线','● PLC未连接').replaceAll('模拟连接','192.168.41.129').replace('模拟预览','等待连接 PLC');
const css=['base.css','extra.css'].map(p=>fs.readFileSync(path.join(base,p),'utf8')).join('\n');
const html='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>html,body{margin:0;background:#eef3f9;overflow:hidden;touch-action:manipulation}'+css+'\n.mode-unknown{background:#edf1f5!important}.pcr-state.fault{background:#fee2e2;color:#b91c1c}.pcr-nav-icon{display:inline-block;width:22px}button:disabled{opacity:.45}</style></head><body>'+shell+'<script>'+script+'</script></body></html>';
fs.writeFileSync(path.join(__dirname,'app/src/main/assets/index.html'),html);
console.log('Live 1P/3P assets generated: '+Buffer.byteLength(html)+' bytes');
