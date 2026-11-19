const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const T=require('../src/control-tower.js');
const {planner}=require('./helpers/planner.cjs');
const {towerUI}=require('./helpers/control-tower.cjs');
const html=fs.readFileSync(path.join(__dirname,'..','linesight_monthly_planner14.html'),'utf8');
const state=()=>({version:1,revision:1,master:{items:{},issues:[]},stock:[],transactions:[],imports:{},watch:[]});
const stockFile={name:'synthetic-stock.csv',matrix:[['Item','Location','On Hand','Available'],['QA_NLC',T.AVAILABLE[0],30,25]]};

test('Data Hub moves the original planning forms instead of cloning upload inputs or changing plan data',()=>{
  const p=planner(),before=p.json('fullState()'),moved=[];
  p.run("document.getElementById('datahub-planning-imports')");
  p.elements.get('datahub-planning-imports').appendChild=node=>moved.push(node);
  p.run('mountPlannerImports()');
  ['mps-import-card','completion-import-card','demand-import-card'].forEach((id,i)=>assert.equal(moved[i],p.elements.get(id)));
  assert.equal(moved.length,3);assert.deepEqual(p.json('fullState()'),before);
  for(const id of ['mps-file','completion-file','imp-file'])assert.equal((html.match(new RegExp('id="'+id+'"','g'))||[]).length,1);
  assert.match(html,/data-panel="datahub"/);assert.match(html,/id="panel-datahub"/);
  assert.match(html,/not included in planner cloud sync/);
});

test('opening Data Hub shows current planner counts without inventing import timestamps',()=>{
  const p=planner();let mounts=0;p.context.window.LineSightTowerUI={renderImports(){mounts++;}};
  p.set('pgDemand',{'2026-11':{soda:0,bottle:123}});const before=p.json('fullState()');
  p.run('renderDataHub()');assert.equal(mounts,1);
  assert.match(p.elements.get('datahub-planner-status').textContent,/2 month \/ product-group demand values/);
  assert.match(p.elements.get('datahub-planner-status').textContent,/not an import history/);
  assert.deepEqual(p.json('fullState()'),before);
});

test('the ERP hub exposes all three report uploads, monitor setup and backup restoration without writes',async()=>{
  const initial=state(),p=await towerUI(initial);p.api.renderImports();
  for(const label of ['Masterdata','Stock on hand','Production transactions','Backups &amp; setup','Strategic monitor setup','ERP backup'])assert.ok(p.hubHtml().includes(label),label);
  for(const id of ['ct-restore','ct-import-monitors'])assert.equal(typeof p.element(id).onchange,'function');
  assert.ok(p.inputs.every(input=>typeof input.onchange==='function'));assert.deepEqual(p.saved(),initial);
  const preview=p.element('ct-import-preview');preview.innerHTML='Unapplied preview';p.api.renderImports();
  assert.equal(preview.innerHTML,'Unapplied preview');
});

test('Control Tower import entry points delegate to Data Hub without replacing source data',async()=>{
  const calls=[],initial=state(),p=await towerUI(initial,{openDataHub:section=>calls.push(section)});
  p.view('imports');p.element('ct-open-imports').onclick();p.element('ct-open-monitor-setup').onclick();
  assert.deepEqual(calls,['erp','erp','settings']);assert.deepEqual(p.saved(),initial);
});

test('stock imports in Data Hub still require Apply and stay in the hub after durable save',async()=>{
  const initial=state(),p=await towerUI(initial);p.api.renderImports();p.element('ct-stock-report-date').value='2026-11-19';
  const input=p.inputs.find(i=>i.dataset.import==='stock');input.files=[stockFile];input.onchange();await p.flush();
  assert.deepEqual(p.saved(),initial);assert.match(p.element('ct-import-preview').innerHTML,/Apply import/);
  await p.element('ct-apply').onclick();
  assert.equal(p.saved().stock[0].date,'2026-11-19');assert.equal(p.saved().stock[0].rows[0].available,25);
  assert.match(p.element('datahub-erp-message').textContent,/Stock snapshot saved/);assert.doesNotMatch(p.element('datahub-erp-message').textContent,/shown below/);
  assert.match(p.hubHtml(),/1 stock snapshots/);assert.deepEqual(p.saved().master,initial.master);assert.deepEqual(p.saved().transactions,initial.transactions);
});

test('a stock replacement cannot bypass explicit correction approval in Data Hub',async()=>{
  const initial=state();initial.stock=[{date:'2026-11-19',rows:[{sku:'QA_NLC',location:T.AVAILABLE[0],available:10,onHand:10}]}];
  const p=await towerUI(initial);p.api.renderImports();p.element('ct-stock-report-date').value='2026-11-19';
  const input=p.inputs.find(i=>i.dataset.import==='stock');input.files=[stockFile];input.onchange();await p.flush();
  assert.match(p.element('ct-import-preview').innerHTML,/id="ct-apply" class="add-btn" disabled/);await p.element('ct-apply').onclick();assert.deepEqual(p.saved(),initial);
  p.element('ct-confirm-change').checked=true;p.element('ct-confirm-change').onchange({target:{checked:true}});
  await p.element('ct-apply').onclick();assert.equal(p.saved().stock.length,1);assert.equal(p.saved().stock[0].rows[0].available,25);
});

test('failed ERP hub writes keep existing data and leave a visible retryable error',async()=>{
  const initial=state(),p=await towerUI(initial,{failWrite:true});p.api.renderImports();p.element('ct-stock-report-date').value='2026-11-19';
  const input=p.inputs.find(i=>i.dataset.import==='stock');input.files=[stockFile];input.onchange();await p.flush();await p.element('ct-apply').onclick();
  assert.deepEqual(p.saved(),initial);assert.match(p.element('datahub-erp-message').textContent,/not saved/);assert.equal(p.element('ct-apply').disabled,false);
});

test('monitor setup uploads in the hub require approval and do not replace source records',async()=>{
  const initial=state(),p=await towerUI(initial);p.api.renderImports();
  const monitors=T.defaultMonitors([{sku:'QA_NLC',category:'Glass bottles',family:'QA family',name:'QA',minimum:100}]);
  await p.element('ct-import-monitors').onchange({target:{files:[{name:'private-setup.json',text:async()=>JSON.stringify({kind:'linesight-monitor-setup',version:1,monitors})}]}});
  assert.deepEqual(p.saved(),initial);assert.match(p.element('ct-monitor-import-preview').innerHTML,/Apply monitor setup/);
  await p.element('ct-monitor-apply-setup').onclick();assert.equal(p.saved().monitors[0].groups[0].safetyStock,100);
  assert.deepEqual(p.saved().stock,initial.stock);assert.deepEqual(p.saved().master,initial.master);assert.deepEqual(p.saved().transactions,initial.transactions);
});
