const test=require('node:test');
const assert=require('node:assert/strict');
const I=require('../src/production-import.js');
const P=require('../src/production.js');
const T=require('../src/control-tower.js');
const {planner}=require('./helpers/planner.cjs');
const {towerUI}=require('./helpers/control-tower.cjs');
const row=(extra={})=>({id:'1',job:'J1',date:'2026-11-24',sku:'QA_NLC',qty:100,line:'CFC-L1',department:T.CFC,...extra});
const batch=(extra={})=>({job:'J1',sku:'QA_NLC',line:'Line1',qty:100,date:'2026-11-23',dueDate:'2026-11-25',...extra});
const options=(extra={})=>({department:T.CFC,source:'synthetic.csv',at:'2026-11-26T09:00:00Z',...extra});
const total=ledger=>Object.values(ledger).reduce((s,r)=>s+r.qty,0);
const state=()=>({version:1,revision:1,master:{items:{},issues:[]},stock:[],transactions:[],imports:{},watch:[]});
function report(records=[row()],name='synthetic.csv'){
  return {name,matrix:[['Internal ID','Transaction Date','Item','Quantity','Type','Job','Department','Machine / Line'],
    ...records.map(r=>[r.id,r.date,r.sku,r.qty,'Work Order Completion',r.job,r.department,r.line])]};
}
function plan(batches=[batch()],ledger={}){
  const p=planner();p.run('render=()=>{};schedulePush=()=>{};');p.set('mps',batches);p.set('productionLedger',ledger);return p;
}
async function shared(p=plan(),erp=state(),config={}){
  const ui=await towerUI(erp,{productionBridge:p.context.window.LineSightProductionBridge,...config});ui.api.renderImports();
  const upload=async file=>{ui.element('production-report-file').files=[file];ui.element('production-report-file').onchange();await ui.flush();};
  const apply=async approved=>{ui.element('ct-confirm-change').checked=!!approved;await ui.element('ct-apply').onclick();};
  return {...ui,p,upload,apply};
}

test('shared projection uses Quantity and the chosen department, normalizing only the Work Order prefix',()=>{
  const original={ledger:{},batches:[batch({job:'Work Order #J1'})]},records=[row(),row({id:'2',department:'NLC Production WIP GAS',qty:300})],before=structuredClone(original);
  const out=I.project(original,records,options());assert.equal(total(out.ledger),100);assert.equal(out.batches[0].produced,100);assert.equal(out.batches[0].job,'J1');assert.equal(out.batches[0].originalJob,'Work Order #J1');assert.deepEqual(original,before);
});
test('identical reuploads do not grow totals/history or replace a later manual correction',()=>{
  const records=[row()],first=I.project({batches:[batch()]},records,options());first.batches[0].manualProduction={qty:80,date:'2026-11-24'};
  const next=I.project(first,records,options({priorKeys:I.keys(records,T.CFC)}));assert.equal(total(next.ledger),100);assert.equal(next.stats.changed,0);assert.equal(next.warnings.length,0);assert.equal(next.batches[0].produced,80);assert.ok(next.batches[0].manualProduction);
});
test('overlapping Job/day snapshots are replaced with approval, never added to ERP totals',()=>{
  const ledger=P.merge({},[{job:'J1',date:'2026-11-24',qty:100}]).ledger;
  const out=I.project({ledger,batches:[batch()]},[row()],options());assert.equal(total(out.ledger),100);assert.ok(out.warnings.some(w=>w.includes('overlapping legacy')));assert.equal(Object.values(out.ledger)[0].history[0].qty,100);
});
test('legacy dated batch completions outside the imported ERP date remain available',()=>{
  const out=I.project({batches:[batch({completionByDate:{a:{date:'2026-11-23',qty:50}}})]},[row()],options());assert.equal(total(out.ledger),150);assert.equal(out.ledger[P.key('J1','2026-11-23')].qty,50);
});
test('partial canonical ERP imports keep omitted IDs and add only genuinely new IDs',()=>{
  const old=[row({qty:40})],first=I.project({batches:[batch()]},old,options());
  const merged=T.mergeTransactions(old,[row({qty:40}),row({id:'2',qty:60})]).records;
  const out=I.project(first,merged,options({priorKeys:I.keys(old,T.CFC)}));assert.equal(total(out.ledger),100);
  assert.equal(total(I.project(out,T.mergeTransactions(merged,[row({id:'2',qty:60})]).records,options()).ledger),100);
});
test('a moved ID clears the old Job/day without a legacy-produced fallback counting it twice',()=>{
  const old=[row()],first=I.project({batches:[batch(),batch({job:'J2'})]},old,options());
  const current=[row({job:'J2',date:'2026-11-25'})],out=I.project(first,current,options({priorKeys:I.keys(old,T.CFC)}));
  assert.equal(out.ledger[P.key('J1','2026-11-24')].qty,0);assert.equal(out.batches[0].produced,0);assert.equal(out.batches[1].produced,100);assert.equal(total(out.ledger),100);assert.ok(out.warnings.length);
});
test('legacy incremental event IDs missing from ERP history are retained, then deduplicated when they appear',()=>{
  const ledger=P.merge({},[{job:'J1',date:'2026-11-24',qty:40,id:'1'},{job:'J1',date:'2026-11-24',qty:60,id:'2'}],{mode:'events'}).ledger;
  const first=I.project({ledger,batches:[batch()]},[row({qty:40})],options());assert.equal(total(first.ledger),100);assert.equal(first.stats.legacyEvents,1);
  const next=I.project(first,[row({qty:40}),row({id:'2',qty:30})],options());assert.equal(total(next.ledger),70);assert.equal(next.stats.legacyEvents,0);assert.equal(Object.values(next.ledger)[0].legacyRecords,undefined);
});
test('a legacy event ID moved before its first shared import is not counted on both dates',()=>{
  const ledger=P.merge({},[{job:'J1',date:'2026-11-23',qty:100,id:'1'}],{mode:'events'}).ledger;
  const out=I.project({ledger,batches:[batch()]},[row()],options());assert.equal(total(out.ledger),100);assert.equal(out.ledger[P.key('J1','2026-11-23')].qty,0);
});
test('unknown Job records remain in dated actuals and duplicate MPS Jobs do not multiply them',()=>{
  const out=I.project({batches:[batch(),batch({job:'Work Order #J1'})]},[row(),row({id:'2',job:'',qty:15})],options());
  assert.ok(out.batches.every(b=>b.productionIssue));assert.equal(P.metrics(out.batches,out.ledger,{start:'2026-11-01',end:'2026-11-30'}).actual,115);assert.equal(out.stats.missingJobs,1);
});
test('negative ERP reversals stay signed in actuals while produced/remaining stay meaningful',()=>{
  const out=I.project({batches:[batch()]},[row({qty:-10})],options());assert.equal(total(out.ledger),-10);assert.equal(out.batches[0].produced,0);assert.ok(out.warnings.some(w=>w.includes('negative net')));
});
test('changing MPS department resets only previously managed scope and retains its history',()=>{
  const records=[row(),row({id:'2',job:'GAS1',qty:20,department:'NLC Production WIP GAS'})],first=I.project({batches:[batch()]},records,options());
  const out=I.project(first,records,options({department:'NLC Production WIP GAS'}));assert.equal(total(out.ledger),20);assert.equal(out.ledger[P.key('J1','2026-11-24')].qty,0);assert.ok(out.warnings.some(w=>w.includes('department changed')));
});
test('planner history without retained raw ERP rows is preserved after another browser/storage reset',()=>{
  const first=I.project({batches:[batch()]},[row()],options());
  const next=I.project(first,[row({id:'2',job:'J2',qty:20})],options());assert.equal(total(next.ledger),120);assert.equal(next.stats.retainedHistory,1);
});
test('undated legacy production requires approval before being superseded by dated ERP data',()=>{
  const out=I.project({batches:[batch({produced:100})]},[row({qty:80})],options());assert.ok(out.warnings.some(w=>w.includes('undated')));assert.equal(out.batches[0].productionBaseline.qty,100);assert.equal(out.batches[0].produced,80);
});
test('the shared Data Hub has one production upload and applies both stores only after Apply',async()=>{
  const ui=await shared();assert.doesNotMatch(ui.hubHtml(),/data-import="transactions"/);await ui.upload(report());
  assert.equal(ui.saved().transactions.length,0);assert.equal(ui.p.run('Object.keys(productionLedger).length'),0);assert.match(ui.productionHtml(),/Apply to Daily production \+ MPS/);
  await ui.apply();assert.equal(ui.saved().transactions.length,1);assert.equal(ui.saved().productionBridge.pending,false);assert.equal(ui.p.run('mps[0].produced'),100);assert.equal(ui.p.json('Object.values(productionLedger)')[0].records,undefined);
  await ui.upload(report());await ui.apply();assert.equal(ui.saved().transactions.length,1);assert.equal(ui.p.run('Object.values(productionLedger).reduce((s,r)=>s+r.qty,0)'),100);
});
test('changed IDs and manual corrections cannot bypass the shared approval checkbox',async()=>{
  const ui=await shared();await ui.upload(report());await ui.apply();ui.p.run("mps[0].manualProduction={qty:90,date:'2026-11-24'};");
  await ui.upload(report([row({qty:70})]));assert.match(ui.productionHtml(),/id="ct-apply" class="add-btn" disabled/);await ui.apply(false);
  assert.equal(ui.saved().transactions[0].qty,100);assert.equal(ui.p.run('mps[0].manualProduction.qty'),90);
  await ui.apply(true);assert.equal(ui.saved().transactions[0].qty,70);assert.equal(ui.p.run('mps[0].produced'),70);assert.equal(ui.p.run('mps[0].manualProduction'),undefined);
  assert.equal(ui.p.run('mps[0].productionCorrectionHistory[0].manualProduction.qty'),90);
  assert.equal(JSON.parse(ui.p.storage.get('ls_planner')).mps[0].productionCorrectionHistory[0].manualProduction.qty,90);
});
test('missing required IDs or conflicting source rows block both destinations without partial writes',async()=>{
  const ui=await shared();await ui.upload(report([row({id:''})]));assert.match(ui.productionHtml(),/requires Internal ID/);await ui.apply(true);assert.equal(ui.saved().transactions.length,0);assert.equal(ui.p.run('Object.keys(productionLedger).length'),0);
});
test('aggregate-only legacy report is clearly rejected by the common detailed-report input',async()=>{
  const ui=await shared();await ui.upload({name:'old-daily.csv',matrix:[['Job','Transaction Date','Completed Qty'],['J1','2026-11-24',100]]});assert.match(ui.element('production-import-message').textContent,/Required columns not found/);assert.equal(ui.saved().transactions.length,0);
});
test('ERP storage failure leaves planner and ERP state unchanged',async()=>{
  const ui=await shared(plan(),state(),{failWrite:true});await ui.upload(report());await ui.apply();assert.equal(ui.saved().transactions.length,0);assert.equal(ui.p.run('Object.keys(productionLedger).length'),0);assert.match(ui.element('production-import-message').textContent,/Import was not saved/);
});
test('planner quota failure leaves a durable ERP journal and can finish without reuploading',async()=>{
  const p=plan(),write=p.context.localStorage.setItem;let fail=true;p.context.localStorage.setItem=(...args)=>{if(fail)throw Error('Quota exceeded');return write(...args);};
  const ui=await shared(p);await ui.upload(report());await ui.apply();assert.equal(ui.saved().transactions.length,1);assert.equal(ui.saved().productionBridge.pending,true);assert.equal(p.run('Object.keys(productionLedger).length'),0);assert.equal(ui.element('production-report-file').disabled,true);
  assert.match(ui.element('production-import-message').textContent,/ERP records are saved/);fail=false;ui.element('production-review-pending').onclick();await ui.apply();assert.equal(ui.saved().productionBridge.pending,false);assert.equal(p.run('mps[0].produced'),100);
});
test('a crash/pending marker after planner save is idempotently recoverable on reload',async()=>{
  const p=plan(),ui=await shared(p,state(),{failWrite:n=>n===2});await ui.upload(report());await ui.apply();assert.equal(p.run('mps[0].produced'),100);assert.equal(ui.saved().productionBridge.pending,true);
  const recovered=await shared(p,ui.saved());assert.equal(recovered.saved().productionBridge.pending,true);recovered.element('production-review-pending').onclick();await recovered.apply();assert.equal(recovered.saved().productionBridge.pending,false);assert.equal(p.run('Object.values(productionLedger).reduce((s,r)=>s+r.qty,0)'),100);
});
test('editing the plan after preview cannot silently overwrite those edits during shared Apply',async()=>{
  const ui=await shared();await ui.upload(report());ui.p.run('mps[0].qty=200;');await ui.apply();assert.equal(ui.p.run('mps[0].qty'),200);assert.equal(ui.saved().productionBridge.pending,true);assert.equal(ui.p.run('Object.keys(productionLedger).length'),0);
  ui.element('production-review-pending').onclick();await ui.apply();assert.equal(ui.p.run('mps[0].qty'),200);assert.equal(ui.p.run('mps[0].produced'),100);assert.equal(ui.saved().productionBridge.pending,false);
});
test('a pending import retains the old ID location needed to clear a moved Job/day after retry',async()=>{
  const p=plan([batch(),batch({job:'J2'})]),ui=await shared(p);await ui.upload(report());await ui.apply();
  const write=p.context.localStorage.setItem;let fail=true;p.context.localStorage.setItem=(...a)=>{if(fail)throw Error('Quota');write(...a);};
  await ui.upload(report([row({job:'J2',date:'2026-11-25'})]));await ui.apply(true);assert.equal(ui.saved().productionBridge.pending,true);
  fail=false;ui.element('production-review-pending').onclick();await ui.apply(true);assert.equal(p.run('mps[0].produced'),0);assert.equal(p.run('mps[1].produced'),100);assert.equal(p.run('Object.values(productionLedger).reduce((s,r)=>s+r.qty,0)'),100);
});
test('backup validation accepts pending journals but rejects malformed recovery instructions',()=>{
  const s=state();s.productionBridge={version:1,pending:true,department:T.CFC,source:'test.csv',at:'2026-11-26T09:00:00Z',priorKeys:[P.key('J1','2026-11-24')]};assert.equal(T.validateBackup(s),s);
  s.productionBridge.priorKeys=['not-json'];assert.throws(()=>T.validateBackup(s),/invalid or unsupported/);
});
test('shared previews escape filenames and Jobs rather than injecting uploaded HTML',async()=>{
  const p=plan([batch({job:'<img src=x onerror=alert(1)>',manualProduction:{qty:50,date:'2026-11-24'}})]),ui=await shared(p);
  await ui.upload(report([row({job:'<img src=x onerror=alert(1)>'})],'<img src=x>.csv'));
  assert.doesNotMatch(ui.productionHtml(),/<img/);assert.match(ui.productionHtml(),/&lt;img/);
});
test('an ERP backup restore never silently applies production data to another planner',async()=>{
  const source=await shared();await source.upload(report());await source.apply();
  const destination=await shared();await destination.element('ct-restore').onchange({target:{files:[{text:async()=>JSON.stringify(source.saved())}]}});
  assert.equal(destination.saved().productionBridge.pending,true);assert.equal(destination.p.run('Object.keys(productionLedger).length'),0);
  assert.match(destination.element('production-bridge-status').innerHTML,/Review pending MPS update/);
  destination.element('production-review-pending').onclick();await destination.apply();assert.equal(destination.p.run('mps[0].produced'),100);
});
test('a cancelled or superseded preview cannot apply a stale upload',async()=>{
  const ui=await shared();await ui.upload(report());const oldApply=ui.element('ct-apply').onclick;ui.element('ct-cancel').onclick();await oldApply();
  assert.equal(ui.saved().transactions.length,0);await ui.upload(report([row({qty:30})]));const staleApply=ui.element('ct-apply').onclick;
  await ui.upload(report([row({qty:60})]));await staleApply();assert.equal(ui.saved().transactions.length,0);await ui.apply();assert.equal(ui.saved().transactions[0].qty,60);
});
test('the shared preview can select a non-default MPS department without filtering raw ERP records',async()=>{
  const ui=await shared(plan([batch({job:'GAS1'})]));await ui.upload(report([row(),row({id:'2',job:'GAS1',qty:40,department:'NLC Production WIP GAS'})]));
  ui.element('production-scope').onchange({target:{value:'NLC Production WIP GAS'}});await ui.apply();
  assert.equal(ui.saved().transactions.length,2);assert.equal(ui.p.run('mps[0].produced'),40);assert.equal(ui.p.json('productionImportInfo').department,'NLC Production WIP GAS');
});
test('large unmatched history is retained in full but its rendered table is bounded',()=>{
  const p=plan([]),ledger={};for(let i=0;i<250;i++)ledger[P.key('J'+i,'2026-11-24')]={job:'J'+i,date:'2026-11-24',qty:1};
  p.set('productionLedger',ledger);p.run('renderProductionIssues()');const html=p.elements.get('completion-unmatched').innerHTML;
  assert.match(html,/250 retained Job\/day/);assert.match(html,/first 100/);assert.equal((html.match(/<tr>/g)||[]).length,101);assert.equal(p.run('LineSightProduction.facts(mps,productionLedger).length'),250);
});
test('zero tombstones are not reported as missing retained ERP production history',()=>{
  const first=I.project({batches:[batch()]},[row()],options());
  const second=I.project(first,[row({date:'2026-11-25'})],options({priorKeys:I.keys([row()],T.CFC)}));
  const third=I.project(second,[row({date:'2026-11-25'})],options({priorKeys:I.keys([row({date:'2026-11-25'})],T.CFC)}));
  assert.equal(third.stats.retainedHistory,0);assert.equal(total(third.ledger),100);
});
