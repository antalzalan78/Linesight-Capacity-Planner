const test=require('node:test');
const assert=require('node:assert/strict');
const T=require('../src/control-tower.js');
const {towerUI}=require('./helpers/control-tower.cjs');
const watch=[{sku:'A_NLC',category:'Glass bottles',family:'DUO',name:'Glass A',minimum:null},
  {sku:'B_NLC',category:'glass bottles',family:'duo',name:'Glass B',minimum:null},
  {sku:'C_NLC',category:'Generic SWM',family:'CRYSTAL',name:'SWM C',minimum:20},
  {sku:'D_NLC',category:'Cylinders',family:'Universal',name:'Cylinder D',minimum:null},
  {sku:'E_NLC',category:'Other',family:'Other',name:'Custom E',minimum:null}];
const stock=[{sku:'A_NLC',location:T.AVAILABLE[0],name:'Glass A',available:100,onHand:120},
  {sku:'A_NLC',location:T.AVAILABLE[1],available:20,onHand:20},
  {sku:'A_NLC',location:T.AVAILABLE[2],available:30,onHand:30},
  {sku:'A_NLC',location:T.HOLD,available:400,onHand:400},
  {sku:'B_NLC',location:T.AVAILABLE[0],name:'Glass B',available:50,onHand:50},
  {sku:'E_NLC',location:'Excluded warehouse',available:999,onHand:999}];
const state=()=>({version:1,revision:1,master:{items:{},issues:[]},watch:structuredClone(watch),transactions:[],stock:[{date:'2026-11-18',rows:structuredClone(stock),source:'Synthetic stock',at:'2026-11-18T08:00:00Z'}],imports:{}});
function fields(p,setup){for(const panel of setup)for(const group of panel.groups){p.element('ct-monitor-name-'+panel.id+'-'+group.id).value=group.name;p.element('ct-monitor-skus-'+panel.id+'-'+group.id).value=group.skus.join('\n');p.element('ct-monitor-ss-'+panel.id+'-'+group.id).value=group.safetyStock===null?'':String(group.safetyStock);}}
function drawLabels(plot,{bars,targets=[],hidden=[],width=600,values=plot.config.data.datasets[0].data}={}){
  const drawn=[],outline=[],calls=[];
  const ctx={save(){calls.push('save');},restore(){calls.push('restore');},measureText:text=>({width:text.length*7}),
    fillText(text,x,y){drawn.push({text,x,y});},strokeText(text,x,y){outline.push({text,x,y});}};
  plot.config.plugins[0].afterDatasetsDraw({ctx,width,chartArea:{left:40,right:460,top:40,bottom:300},
    data:{datasets:[{data:values}]},isDatasetVisible:index=>!hidden.includes(index),
    getDatasetMeta:index=>({data:index===0?(bars||values.map((v,i)=>({x:100+i*100,y:100,base:300}))):targets})});
  return {drawn,outline,calls,ctx};
}

test('stock columns show full quantities with separators and retain their source precision',async()=>{
  const input=state();input.stock[0].rows[0].available=1234467.25;
  input.monitors=T.updateMonitor(T.defaultMonitors(watch),'glass',[{id:'g1',safetyStock:1500000}]);
  const p=await towerUI(input),plot=p.plots.find(c=>c.canvas.id==='ct-monitor-chart-glass'),result=drawLabels(plot);
  assert.deepEqual(result.drawn,[{text:'1,234,567.25',x:100,y:93}]);
  assert.deepEqual(result.outline,result.drawn);assert.deepEqual(result.calls,['save','restore']);
  assert.equal(plot.config.options.scales.y.grace,'15%');assert.equal(plot.config.options.layout.padding.top,14);
  assert.deepEqual([...plot.config.data.datasets[1].data],[1500000]);assert.deepEqual(p.saved(),input);
  p.element('ct-export').onclick();assert.match(await p.downloads[0].text(),/1234567\.25,1500000,/);
});

test('stock labels distinguish partial sums, actual zero and missing stock',async()=>{
  const input=state();input.stock[0].rows=input.stock[0].rows.filter(r=>r.sku!=='B_NLC');
  const p=await towerUI(input),plot=id=>p.plots.find(c=>c.canvas.id==='ct-monitor-chart-'+id);
  assert.equal(drawLabels(plot('glass')).drawn[0].text,'150*');
  assert.equal(drawLabels(plot('custom')).drawn[0].text,'0');
  assert.deepEqual(drawLabels(plot('swm')).drawn,[]);assert.deepEqual(drawLabels(plot('cylinders')).drawn,[]);
});

test('stock labels respect the legend and skip invalid or missing bar geometry',async()=>{
  const p=await towerUI(state()),plot=p.plots[0];
  const hidden=drawLabels(plot,{hidden:[0]});assert.deepEqual(hidden.drawn,[]);assert.deepEqual(hidden.calls,[]);
  const invalid=drawLabels(plot,{values:[null,NaN,Infinity,10,20,30,40],bars:[
    {x:100,y:100,base:300},{x:150,y:100,base:300},{x:200,y:100,base:300},
    {x:250,y:NaN,base:300},{x:300,y:100,base:300,skip:true},undefined,{x:400,y:100,base:300}]});
  assert.deepEqual(invalid.drawn,[{text:'40',x:400,y:93}]);assert.deepEqual(invalid.calls,['save','restore']);
});

test('stock labels stay inside the plot and avoid a nearby safety-stock marker',async()=>{
  const p=await towerUI(state()),plot=p.plots[0];
  const near=drawLabels(plot,{width:400,bars:[{x:42,y:100,base:300}],targets:[{x:42,y:91}]});
  assert.deepEqual(near.drawn,[{text:'200',x:52.5,y:84}]);assert.match(near.ctx.font,/11px/);
  const right=drawLabels(plot,{bars:[{x:459,y:100,base:300}],targets:[{x:459,y:91}],hidden:[1]});
  assert.deepEqual(right.drawn,[{text:'200',x:447.5,y:93}]);
  const negative=drawLabels(plot,{values:[-200],bars:[{x:100,y:360,base:300}]});
  assert.deepEqual(negative.drawn,[{text:'-200',x:100,y:293}]);
});

test('value labels are local to the four strategic stock monitors',async()=>{
  const input=state();input.transactions=[{id:'1',sku:'A_NLC',date:'2026-11-18',qty:10,job:'J1',department:T.CFC,line:'CFC-L1'}];
  const p=await towerUI(input);
  assert.equal(p.plots.length,4);assert.ok(p.plots.every(plot=>plot.config.plugins.length===1&&plot.config.plugins[0].id==='linesight-stock-values'));
  p.view('production');
  const production=p.plots.filter(plot=>!plot.destroyed);assert.equal(production.length,4);assert.ok(production.every(plot=>plot.config.plugins.length===0));
});

test('legacy private watchlists create four monitor panels without publishing item presets',()=>{
  const setup=T.defaultMonitors(watch);
  assert.deepEqual(setup.map(p=>p.id),['glass','swm','cylinders','custom']);
  assert.deepEqual(setup[0].groups[0].skus,['A_NLC','B_NLC']);assert.equal(setup[0].groups.length,1);
  assert.equal(setup[0].groups[0].safetyStock,null);assert.equal(setup[1].groups[0].safetyStock,20);
  assert.equal(setup[3].groups[0].name,'Custom E');assert.equal(T.validateMonitors(setup),setup);
  assert.ok(T.defaultMonitors([]).every(p=>p.groups.length===0));assert.deepEqual(T.WATCH,[]);
});

test('family stock sums eligible Available exactly once and never adds HOLD or excluded locations',()=>{
  const result=T.monitorResults(stock,T.defaultMonitors(watch)),glass=result[0].groups[0];
  assert.equal(glass.available,200);assert.equal(glass.complete,true);assert.equal(glass.found,2);
  assert.equal(glass.detail[0].blocked,400);assert.equal(result[3].groups[0].available,0);assert.equal(result[3].groups[0].status,'No available stock');
});

test('manual safety stock supports blank and zero without inventing targets or mutating configuration',()=>{
  const original=T.defaultMonitors(watch),set=T.updateMonitor(original,'glass',[{id:'g1',safetyStock:250}]);
  const below=T.monitorResults(stock,set)[0].groups[0];assert.equal(below.gap,-50);assert.equal(below.status,'Below safety stock');
  const zero=T.updateMonitor(set,'glass',[{id:'g1',safetyStock:0}]);assert.equal(T.monitorResults(stock,zero)[0].groups[0].gap,200);
  const blank=T.updateMonitor(zero,'glass',[{id:'g1',safetyStock:null}]);assert.equal(T.monitorResults(stock,blank)[0].groups[0].gap,null);
  assert.equal(original[0].groups[0].safetyStock,null);assert.throws(()=>T.updateMonitor(set,'glass',[{id:'g1',safetyStock:-1}]));
  assert.throws(()=>T.updateMonitor(set,'glass',[{id:'g1',safetyStock:'250'}]));
});

test('partial groups keep the observed sum but do not claim a complete total or safety-stock gap',()=>{
  const setup=T.updateMonitor(T.defaultMonitors(watch),'glass',[{id:'g1',safetyStock:100}]);
  const partial=T.monitorResults(stock.filter(r=>r.sku!=='B_NLC'),setup)[0].groups[0];
  assert.equal(partial.available,150);assert.equal(partial.gap,null);assert.equal(partial.status,'Partial stock data');
  assert.deepEqual(partial.missing,['B_NLC']);assert.equal(partial.complete,false);
  const absent=T.monitorResults([],setup)[0].groups[0];assert.equal(absent.available,null);assert.equal(absent.status,'Not in export');
});

test('monitor settings reject repeated members, malformed IDs, negative targets and unsupported payloads',()=>{
  const setup=T.defaultMonitors(watch);
  assert.throws(()=>T.updateMonitor(setup,'glass',[{id:'g1',skus:['A_NLC','A_NLC']}]));
  const duplicate=structuredClone(setup);duplicate[0].groups.push({id:'g2',name:'Another group',skus:['A_NLC'],safetyStock:null});assert.throws(()=>T.validateMonitors(duplicate));
  const broken=structuredClone(setup);broken[0].groups[0].id='<img>';assert.throws(()=>T.validateMonitors(broken));
  assert.throws(()=>T.importMonitorSetup({version:1,monitors:setup},setup));
  assert.throws(()=>T.validateMonitors(setup.slice(1)));
});

test('monitor setup import changes configuration only and preserves existing non-blank manual targets',()=>{
  const original=T.updateMonitor(T.defaultMonitors(watch),'glass',[{id:'g1',safetyStock:0}]);
  const incoming=T.updateMonitor(T.defaultMonitors(watch),'glass',[{id:'g1',safetyStock:999}]);
  const payload={kind:'linesight-monitor-setup',version:1,monitors:incoming};
  assert.equal(T.importMonitorSetup(payload,original)[0].groups[0].safetyStock,0);
  assert.equal(T.importMonitorSetup(payload,T.defaultMonitors(watch))[0].groups[0].safetyStock,999);
  assert.equal(incoming[0].groups[0].safetyStock,999);
});

test('ERP backups retain monitor settings and reject corrupt monitor data before restoration',()=>{
  const input=state();assert.equal(T.validateBackup(input),input);
  input.monitors=T.defaultMonitors(input.watch);assert.equal(T.validateBackup(input),input);
  input.monitors[0].groups[0].safetyStock=-1;assert.throws(()=>T.validateBackup(input));
});

test('the strategic dashboard draws vertical stock columns and exports the same family populations',async()=>{
  const input=state(),p=await towerUI(input);assert.match(p.html(),/Glass bottles/);assert.match(p.html(),/Generic SWM/);assert.match(p.html(),/Gas cylinders/);assert.match(p.html(),/Other monitored items/);
  const plots=p.plots.filter(c=>!c.destroyed);assert.equal(plots.length,4);
  const glass=plots.find(c=>c.canvas.id==='ct-monitor-chart-glass');assert.equal(glass.config.type,'bar');
  assert.equal(glass.config.options.indexAxis,undefined);assert.deepEqual([...glass.config.data.datasets[0].data],[200]);
  assert.deepEqual([...glass.config.data.datasets[1].data],[null]);
  p.element('ct-export').onclick();const csv=await p.downloads[0].text();
  assert.equal(csv.split('\r\n').length,5);assert.match(csv,/"Glass bottles","DUO","A_NLC; B_NLC",200,,/);
  assert.deepEqual(p.saved(),input);
});

test('saving safety stock durably updates the target, chart and CSV without rewriting stock or transactions',async()=>{
  const input=state(),p=await towerUI(input);fields(p,T.defaultMonitors(watch));
  p.element('ct-monitor-ss-glass-g1').value='250';await p.element('ct-save-monitors').onclick();
  assert.equal(p.saved().monitors[0].groups[0].safetyStock,250);
  assert.deepEqual(p.saved().stock,input.stock);assert.deepEqual(p.saved().transactions,input.transactions);assert.deepEqual(p.saved().watch,input.watch);
  const plot=p.plots.findLast(c=>!c.destroyed&&c.canvas.id==='ct-monitor-chart-glass');assert.deepEqual([...plot.config.data.datasets[1].data],[250]);
  p.element('ct-export').onclick();assert.match(await p.downloads[0].text(),/200,250,-50,2,2,"","Below safety stock"/);
  const reopened=await towerUI(p.saved());assert.match(reopened.html(),/value="250"/);
});

test('failed safety stock writes leave existing settings and ERP data unchanged',async()=>{
  const input=state(),p=await towerUI(input,{failWrite:true});fields(p,T.defaultMonitors(watch));
  p.element('ct-monitor-ss-glass-g1').value='250';await p.element('ct-save-monitors').onclick();
  assert.deepEqual(p.saved(),input);assert.match(p.element('ct-message').textContent,/not saved/);
  assert.equal(p.element('ct-save-monitors').disabled,false);
});

test('custom items can be added with manual safety stock without altering the source stock snapshot',async()=>{
  const input=state(),p=await towerUI(input);fields(p,T.defaultMonitors(watch));
  p.element('ct-monitor-add-name-custom').value='Custom new item';p.element('ct-monitor-add-skus-custom').value='NEW_NLC';p.element('ct-monitor-add-ss-custom').value='123';
  await p.element('ct-monitor-add-custom').onclick();
  const group=p.saved().monitors[3].groups.at(-1);assert.equal(group.name,'Custom new item');assert.deepEqual(group.skus,['NEW_NLC']);assert.equal(group.safetyStock,123);
  assert.deepEqual(p.saved().stock,input.stock);assert.match(p.html(),/Custom new item/);
});

test('importing a private monitor setup preserves stock, masterdata and production records',async()=>{
  const input=state(),p=await towerUI(input);fields(p,T.defaultMonitors(watch));
  p.view('imports');
  const incoming=T.updateMonitor(T.defaultMonitors(watch),'glass',[{id:'g1',safetyStock:250}]);
  await p.element('ct-import-monitors').onchange({target:{files:[{text:async()=>JSON.stringify({kind:'linesight-monitor-setup',version:1,monitors:incoming})}]}});
  assert.deepEqual(p.saved(),input);assert.match(p.element('ct-monitor-import-preview').innerHTML,/Apply monitor setup/);
  await p.element('ct-monitor-apply-setup').onclick();
  assert.equal(p.saved().monitors[0].groups[0].safetyStock,250);assert.deepEqual(p.saved().stock,input.stock);assert.deepEqual(p.saved().master,input.master);
  assert.deepEqual(p.saved().transactions,input.transactions);
});

test('removing a monitor group requires a second explicit click and never removes its stock rows',async()=>{
  const input=state(),p=await towerUI(input);fields(p,T.defaultMonitors(watch));
  await p.element('ct-monitor-remove-custom-g1').onclick();assert.deepEqual(p.saved(),input);
  assert.equal(p.element('ct-monitor-remove-custom-g1').textContent,'Remove?');
  await p.element('ct-monitor-remove-custom-g1').onclick();assert.equal(p.saved().monitors[3].groups.length,0);assert.deepEqual(p.saved().stock,input.stock);
});

test('custom monitor labels are escaped in HTML and formula-safe in CSV exports',async()=>{
  const input=state();input.monitors=T.defaultMonitors(watch);input.monitors[3].groups[0].name='<img src=x onerror=alert(1)>';
  const escaped=await towerUI(input);assert.doesNotMatch(escaped.html(),/<img src=x/);assert.match(escaped.html(),/&lt;img src=x/);
  input.monitors[3].groups[0].name='=1+2';const formula=await towerUI(input);formula.element('ct-export').onclick();
  assert.match(await formula.downloads[0].text(),/"'=1\+2"/);
});
