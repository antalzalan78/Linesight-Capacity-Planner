const test=require('node:test');
const assert=require('node:assert/strict');
const {towerUI}=require('./helpers/control-tower.cjs');
const T=require('../src/control-tower.js');

const stockRows=Array.from({length:102},(_,i)=>({sku:'QA'+String(i).padStart(3,'0')+'_NLC',name:'Synthetic '+i,location:T.AVAILABLE[0],available:i+10,onHand:i+20}));
const state=()=>({version:1,revision:1,master:{items:{},issues:[]},transactions:[],watch:[],imports:{},stock:[{date:'2026-11-17',rows:stockRows,source:'synthetic.csv',at:'2026-11-17T09:00:00Z'}]});

test('UI renders stock-only data and keeps all filtered items in CSV when the table is paginated',async()=>{
  const p=await towerUI(state());p.view('explorer');
  assert.match(p.html(),/Stock items/);assert.match(p.html(),/Showing 1–100 of 102/);
  assert.equal((p.html().match(/data-item=/g)||[]).length,100);
  p.element('ct-material-next').onclick();
  assert.match(p.html(),/Showing 101–102 of 102/);assert.equal((p.html().match(/data-item=/g)||[]).length,2);
  p.element('ct-export').onclick();const csv=await p.downloads[0].text();
  assert.equal(csv.split('\r\n').length,103);assert.match(csv,/QA000_NLC/);assert.match(csv,/QA101_NLC/);
  p.element('ct-material-search').value='QA101';p.element('ct-apply-search').onclick();p.element('ct-export').onclick();
  assert.equal((await p.downloads[1].text()).split('\r\n').length,2);
  assert.match(p.html(),/Showing 1–1 of 1/);
});

test('empty strategic scope and no-match filters have actionable empty states',async()=>{
  const p=await towerUI(state());p.view('explorer');p.change('ct-stock-scope','watch');
  assert.match(p.html(),/Your strategic watchlist is empty/);assert.doesNotMatch(p.html(),/<canvas/);
  p.element('ct-reset-materials').onclick();assert.match(p.html(),/Showing 1–100 of 102/);
  p.element('ct-material-search').value='does-not-exist';p.element('ct-apply-search').onclick();assert.match(p.html(),/No materials match these filters/);
  p.element('ct-reset-materials').onclick();assert.match(p.html(),/Showing 1–100 of 102/);
});

test('stock import preview requires Apply, then opens the dashboard after durable storage succeeds',async()=>{
  const p=await towerUI();assert.match(p.html(),/No stock snapshot imported/);
  p.element('ct-open-imports').onclick();p.element('ct-stock-report-date').value='2026-11-16';
  const input=p.inputs.find(r=>r.dataset.import==='stock');
  input.files=[{name:'synthetic.csv',matrix:[['Item','Location','On Hand','Available'],['A_NLC',T.AVAILABLE[0],30,25]]}];
  input.onchange();await p.flush();
  assert.equal(p.saved(),undefined);assert.match(p.element('ct-message').textContent,/Click Apply import/);
  assert.match(p.element('ct-import-preview').innerHTML,/Apply import/);
  await p.element('ct-apply').onclick();
  assert.equal(p.saved().stock[0].date,'2026-11-16');assert.deepEqual(p.saved().watch,[]);
  assert.match(p.html(),/Imported stock detail/);assert.match(p.html(),/A_NLC/);
  assert.match(p.element('ct-message').textContent,/Stock snapshot saved for 2026-11-16/);
});

test('a failed import write keeps existing ERP data and does not claim dashboard success',async()=>{
  const initial=state(),p=await towerUI(initial,{failWrite:true});p.view('imports');p.element('ct-stock-report-date').value='2026-11-18';
  const input=p.inputs.find(r=>r.dataset.import==='stock');input.files=[{name:'synthetic.csv',matrix:[['Item','Location','On Hand','Available'],['NEW_NLC',T.AVAILABLE[0],1,1]]}];
  input.onchange();await p.flush();await p.element('ct-apply').onclick();
  assert.deepEqual(p.saved(),initial);assert.match(p.element('ct-message').textContent,/Import was not saved/);
  assert.equal(p.element('ct-apply').disabled,false);
});

test('transaction preview accepts matching repeated line headers and opens production after Apply',async()=>{
  const p=await towerUI();p.view('imports');
  const input=p.inputs.find(r=>r.dataset.import==='transactions');
  input.files=[{name:'synthetic.csv',matrix:[['Internal ID','Transaction Date','Item','Quantity','Type','Machine / Line','Machine / Line'],
    ['1','2026-11-17','A_NLC',25,'Work Order Completion','CFC-L1','CFC-L1']]}];
  input.onchange();await p.flush();
  assert.match(p.element('ct-import-preview').innerHTML,/Matching values or blanks are combined/);
  assert.doesNotMatch(p.element('ct-import-preview').innerHTML,/id="ct-apply" class="add-btn" disabled/);
  await p.element('ct-apply').onclick();
  assert.equal(p.saved().transactions.length,1);assert.equal(p.saved().transactions[0].line,'CFC-L1');
  assert.match(p.html(),/Daily production/);assert.match(p.element('ct-message').textContent,/Production import saved/);
});

test('conflicting repeated line columns cannot be applied and keep previously imported transactions',async()=>{
  const initial=state(),p=await towerUI(initial);p.view('imports');
  const input=p.inputs.find(r=>r.dataset.import==='transactions');
  input.files=[{name:'synthetic.csv',matrix:[['Internal ID','Transaction Date','Item','Quantity','Type','Machine / Line','Machine / Line'],
    ['1','2026-11-17','A_NLC',25,'Work Order Completion','CFC-L1','CFC-L2']]}];
  input.onchange();await p.flush();
  assert.match(p.element('ct-import-preview').innerHTML,/conflicting Machine \/ Line/);
  assert.match(p.element('ct-import-preview').innerHTML,/id="ct-apply" class="add-btn" disabled/);
  await p.element('ct-apply').onclick();assert.deepEqual(p.saved(),initial);
});

test('existing mixed-case masterdata produces one filter choice and consistent chart, detail and CSV values',async()=>{
  const initial=state();initial.stock=[];
  initial.master.items={A_NLC:{sku:'A_NLC',name:'A source name',group:'SODA MAKERS',family:'duo',generic:'GENERIC'},
    B_NLC:{sku:'B_NLC',name:'B source name',group:'Soda makers',family:'DUO',generic:'Generic'},
    C_NLC:{sku:'C_NLC',name:'C source name',group:'Bottles',family:'Glass',generic:'Generic'}};
  initial.transactions=[{id:'1',sku:'A_NLC',date:'2026-11-18',qty:10,job:'J1',department:T.CFC,line:'CFC-L1'},
    {id:'2',sku:'B_NLC',date:'2026-11-18',qty:20,job:'J2',department:T.CFC,line:'CFC-L2'},
    {id:'3',sku:'C_NLC',date:'2026-11-18',qty:40,job:'J3',department:T.CFC,line:'CFC-L1'}];
  const p=await towerUI(initial);p.view('production');
  const options=id=>[...p.html().match(new RegExp('<select id="'+id+'"[^>]*>([\\s\\S]*?)</select>'))[1].matchAll(/<option value="([^"]*)"/g)].map(m=>m[1]);
  assert.deepEqual(options('ct-group'),['','Bottles','Soda makers']);
  assert.deepEqual(options('ct-family'),['','DUO','Glass']);assert.deepEqual(options('ct-generic'),['','Generic']);
  p.change('ct-group','soda makers');assert.deepEqual(options('ct-family'),['','DUO']);
  assert.match(p.html(),/value="Soda makers" selected/);
  p.change('ct-family','duo');p.change('ct-generic','generic');
  const plot=p.plots.findLast(c=>!c.destroyed&&c.canvas.id==='ct-group-chart');
  assert.deepEqual([...plot.config.data.labels],['Soda makers']);assert.deepEqual([...plot.config.data.datasets[0].data],[30]);
  p.element('ct-export').onclick();const lines=(await p.downloads[0].text()).split('\r\n');
  assert.equal(lines.length,3);assert.ok(lines.slice(1).every(row=>row.includes('"Soda makers","DUO"')));
  assert.ok(lines[1].includes('"1"'));assert.ok(lines[2].includes('"2"'));
  assert.equal(lines.slice(1).reduce((sum,row)=>sum+Number(row.split(',').at(-1)),0),30);
  p.element('ct-reset-production').onclick();assert.deepEqual(options('ct-group'),['','Bottles','Soda makers']);
  p.element('ct-export').onclick();assert.equal((await p.downloads[1].text()).split('\r\n').length,4);
  assert.deepEqual(p.saved(),initial);
});
