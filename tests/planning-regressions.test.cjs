const test=require('node:test');
const assert=require('node:assert/strict');
const {planner}=require('./helpers/planner.cjs');

function setup(){
  const p=planner();
  p.run(`curDate=new Date(2026,9,1);calEvents={};calSeeded=[2026];
    lineBase=[{name:'Line1',cap:10,pg:'soda',hc:1,hcDay:0}];lineOvr={};syncLines();`);
  return p;
}

test('daily MPS capacities match Weekly with days and OEE overrides',()=>{
  const p=setup();
  const result=p.json(`(()=>{
    const m='2026-9',weeks=weeksOf(2026,9);
    weeks.forEach((w,wi)=>setOvr(m,wi,'days',1));setOvr(m,2,'oee',50);
    const calendar=mpsCapacityCalendar(lines[0],m);
    return {daily:Object.values(calendar).reduce((s,v)=>s+v,0),weekly:weeks.reduce((s,w,wi)=>s+wkCap(w,m,wi),0)};
  })()`);
  assert.deepEqual(result,{daily:720,weekly:720});
});

test('fractional days and weekend days retain the exact weekly capacity',()=>{
  const p=setup();
  const r=p.json(`(()=>{const m='2026-9',w=weeksOf(2026,9)[1];
    setOvr(m,1,'days',5.5);const cal=workingCalendar(m),capacity=mpsCapacityCalendar(lines[0],m);
    return {saturday:cal[10].weight,week:weekDates(w,m).reduce((s,d)=>s+capacity[d.getDate()],0),weekly:lWkCap(lines[0],w,m,1)};
  })()`);
  assert.deepEqual(r,{saturday:0.5,week:880,weekly:880});
});

test('shutdowns have zero capacity unless a manual weekly override reopens them',()=>{
  const p=setup();
  p.run(`calEvents={'2026-10-05':{type:'maintenance'}};`);
  assert.equal(p.run("mpsCapacityCalendar(lines[0],'2026-9')[5]"),0);
  p.run("setOvr('2026-9',1,'days',7);_calendarMemo={};");
  assert.equal(p.run("mpsCapacityCalendar(lines[0],'2026-9')[5]"),160);
});

test('MPS overload uses the same weekly restrictions as Weekly',()=>{
  const p=setup();
  p.run(`weeksOf(2026,9).forEach((w,wi)=>setOvr('2026-9',wi,'days',1));
    skus=[{code:'S1',pg:'soda'}];mps=[{date:'2026-10-01',line:'Line1',sku:'S1',qty:1000}];`);
  assert.deepEqual(p.json("mpsMonthShortfall('2026-9')"),{soda:200});
});

test('zero-capacity product group demand remains in the total and in backlog',()=>{
  const p=setup();
  p.run("pgDemand={'2026-9':{bottle:1000}};");
  const r=p.json(`(()=>{const weeks=weeksOf(2026,9),series=backlogSeries('2026-9',weeks,0);
    return {demand:series.reduce((s,v)=>s+v.dem,0),closing:series.at(-1).bl,group:pgBacklogClose('2026-9',weeks,'bottle')};})()`);
  assert.deepEqual(r,{demand:1000,closing:1000,group:1000});
});

test('one group cannot clear another group backlog, including future months',()=>{
  const p=setup();
  p.run("blOpen={'2026-9':{bottle:1000}};");
  assert.equal(p.run("backlogSeries('2026-9',weeksOf(2026,9),1000).at(-1).bl"),1000);
  assert.equal(p.run("backlogAtDate(new Date(2026,11,31)).bl"),1000);
});

test('spill-over belongs to the unfinished batch product group',()=>{
  const p=setup();
  p.run(`skus=[{code:'S1',pg:'soda'},{code:'S2',pg:'bottle'}];mps=[
    {date:'2026-10-01',line:'Line1',sku:'S1',qty:1000},
    {date:'2026-10-30',line:'Line1',sku:'S2',qty:300}];`);
  assert.deepEqual(p.json("mpsMonthShortfall('2026-9')"),{bottle:140});
});

test('MPS monthly demand is booked in its planned week even when capacity is zero',()=>{
  const p=setup();
  p.run(`demandMode='mps';skus=[{code:'S1',pg:'bottle'}];mps=[{date:'2026-10-30',line:'Line2',sku:'S1',qty:500}];`);
  const r=p.json("weeksOf(2026,9).map((w,i)=>wkDem(w,'2026-9',i,weeksOf(2026,9)))");
  assert.deepEqual(r,[0,0,0,0,500]);
});

test('scenario calendars are isolated and the current calendar is restored',()=>{
  const p=setup();
  const r=p.json(`(()=>{const m='2026-9';workingCalendar(m);const state=snapshotState();
    state.weekOvr={[m]:{1:{days:1}}};
    const scenario=withState(state,()=>weekDates(weeksOf(2026,9)[1],m).reduce((s,d)=>s+mpsCapacityCalendar(lines[0],m)[d.getDate()],0));
    const current=weekDates(weeksOf(2026,9)[1],m).reduce((s,d)=>s+mpsCapacityCalendar(lines[0],m)[d.getDate()],0);
    return {scenario,current};})()`);
  assert.deepEqual(r,{scenario:160,current:800});
});

test('standard-minute fallback reads the batch month line allocation',()=>{
  const p=setup();
  p.run(`mpsBasis='min';lineOvr={'2026-10':[{name:'Line1',cap:20,pg:'soda'}]};`);
  assert.equal(p.run("mpsBatchLoad({date:'2026-11-02',line:'Line1',sku:'S1',qty:10})"),30);
  assert.equal(p.run("mpsBatchLoad({date:'2026-10-01',line:'Line1',sku:'S1',qty:10})"),60);
});
