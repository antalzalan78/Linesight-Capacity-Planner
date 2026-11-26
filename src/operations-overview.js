(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production.js'),require('./control-tower.js'));
  else root.LineSightOverview=factory(root.LineSightProduction,root.LineSightTower);
})(typeof self!=='undefined'?self:globalThis,function(P,T){
  'use strict';
  const valid=d=>typeof d==='string'&&P.validDate(d);
  const addDays=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
  const age=(asOf,date)=>valid(date)?Math.round((Date.parse(asOf)-Date.parse(date))/86400000):null;
  const sum=(rows,field)=>rows.reduce((s,r)=>s+(Number(r[field])||0),0);
  const latest=values=>values.filter(valid).sort().at(-1)||null;
  function scope({start,end,today,focus}){
    if(!valid(start)||!valid(end)||!valid(today)||start>end)throw Error('Invalid overview period.');
    focus=valid(focus)&&focus>=start&&focus<=end?focus:today<start?start:today>end?end:today;
    const weekday=new Date(focus+'T12:00:00Z').getUTCDay(),monday=addDays(focus,-((weekday+6)%7));
    return {start,end,today,focus,asOf:focus<today?focus:today,weekStart:monday<start?start:monday,weekEnd:addDays(monday,6)>end?end:addDays(monday,6),future:focus>today};
  }
  // Same FIFO load model as the MPS grid. Start-day quantities are spread over
  // actual available line-days; completed actuals do not rewrite the plan.
  function schedule(batches,calendars,start,end){
    const days=[],lines=[];for(let d=start;d<=end;d=addDays(d,1))days.push(d);
    const daily=Object.fromEntries(days.map(d=>[d,0])),invalid=[];
    for(const line of calendars){
      const rows=batches.filter(r=>!r.unalloc&&r.line===line.name&&r.date>=start&&r.date<=end)
        .slice().sort((a,b)=>a.date.localeCompare(b.date)||(a.seq??1e9)-(b.seq??1e9));
      const queue=[];let capacity=0,load=0,spillUnits=0;
      for(const date of days){
        for(const r of rows.filter(r=>r.date===date)){
          if(!(r.load>0)||!(r.qty>0)){invalid.push(r);continue;}
          queue.push({r,left:r.load});load+=r.load;
        }
        let available=Math.max(0,Number(line.days[date])||0);capacity+=available;
        for(const entry of queue){
          const used=Math.min(entry.left,available);entry.left-=used;available-=used;
          daily[date]+=entry.r.qty*used/entry.r.load;
          if(available<=0)break;
        }
      }
      for(const entry of queue)spillUnits+=entry.r.qty*entry.left/entry.r.load;
      lines.push({name:line.name,load,capacity,spillLoad:sum(queue,'left'),spillUnits});
    }
    for(const r of batches)if(!r.unalloc&&r.date>=start&&r.date<=end&&!calendars.some(l=>l.name===r.line))invalid.push(r);
    return {daily:days.map(date=>({date,planned:daily[date]})),lines,invalid};
  }
  function freshness(label,date,asOf,warningDays,info={},target='erp'){
    const days=age(asOf,date);
    return {label,date:date||null,age:days,status:days===null?'missing':days>warningDays?'stale':'current',source:info.source||'',importedAt:info.at||null,dateBasis:info.dateBasis||'',target};
  }
  function erp(data,{asOf,department=T.CFC}={}){
    const snapshot=(data.stock||[]).filter(s=>valid(s.date)&&s.date<=asOf).slice().sort((a,b)=>b.date.localeCompare(a.date))[0]||null;
    const setup=T.monitorSetup(data.watch||[],data.monitors),panels=T.monitorResults(snapshot?.rows||[],setup);
    const groups=panels.flatMap(p=>p.groups.map(g=>({...g,panel:p.name,panelId:p.id})));
    let productionDate=null,records=0,unmapped=0;
    for(const r of data.transactions||[]){
      if(r.date>asOf||(department&&r.department!==department))continue;
      if(!productionDate||r.date>productionDate)productionDate=r.date;records++;if(!data.master?.items?.[r.sku])unmapped++;
    }
    return {status:'ready',stockDate:snapshot?.date||null,stockInfo:snapshot?{source:snapshot.source||'',at:snapshot.at||null,dateBasis:snapshot.dateBasis||''}:{},groups,
      productionDate,records,unmapped,department,imports:data.imports||{},masterItems:Object.keys(data.master?.items||{}).length,masterIssues:data.master?.issues?.length||0};
  }
  function build(input){
    const period=scope(input),{start,end,asOf}=period,batches=input.batches||[],ledger=input.ledger||{};
    const plan=schedule(batches,input.calendars||[],start,end),facts=P.facts(batches,ledger),counts=P.matchCounts(batches);
    const inMonth=batches.filter(r=>r.date>=start&&r.date<=end),exceptions=[];
    const add=(type,r,detail,remaining=null)=>exceptions.push({type,index:r.index,job:r.job||'',sku:r.sku||'',line:r.line||'',date:r.date,dueDate:r.dueDate||'',qty:r.qty,remaining,detail});
    for(const r of inMonth){
      const entries=P.entries(r,ledger),ambiguous=r.job&&counts.get(String(r.job).trim())>1,undated=entries.some(e=>!e.date&&e.qty!==0);
      const dated=sum(entries.filter(e=>valid(e.date)&&e.date<=asOf),'qty');
      const undatedDone=!entries.length&&/^(completed?|done|finished|closed|k[eé]sz|klaar|gereed)$/i.test(String(r.status||'').trim());
      const remaining=ambiguous||undated||undatedDone?null:Math.max(0,r.qty-dated);
      if(ambiguous)add('data',r,'Duplicate Job number: completion cannot be allocated.');
      if(undated||undatedDone)add('data',r,'Completion date is missing: completion at the focus date is unknown.');
      if(!valid(r.dueDate))add('data',r,'Due date is missing; on-time adherence cannot be assessed.',remaining);
      if(valid(r.dueDate)&&r.dueDate<asOf&&remaining>0&&!undatedDone)add('overdue',r,'Past due; dated actuals do not confirm completion.',remaining);
      if(r.unalloc&&remaining!==0&&!undatedDone)add('parked',r,'Not allocated to a production line / day.',remaining);
      if(plan.invalid.includes(r))add('schedule',r,'Line is unavailable or batch load cannot be calculated.',remaining);
    }
    const priority={overdue:0,schedule:1,parked:2,data:3};
    exceptions.sort((a,b)=>priority[a.type]-priority[b.type]||(a.dueDate||a.date).localeCompare(b.dueDate||b.date)||a.index-b.index);
    const daily=plan.daily.map(r=>{
      const actualFacts=r.date<=asOf?facts.filter(f=>f.date===r.date):[];
      return {...r,actual:actualFacts.length?sum(actualFacts,'qty'):null};
    });
    const compare=(from,to)=>{
      const rows=daily.filter(r=>r.date>=from&&r.date<=to),known=rows.filter(r=>r.actual!==null);
      const elapsed=rows.filter(r=>r.date<=asOf);
      return {planned:sum(rows,'planned'),plannedToCutoff:elapsed.length?sum(elapsed,'planned'):null,elapsedDays:elapsed.length,actual:known.length?sum(known,'actual'):null,recordedDays:known.length,days:rows.length};
    };
    const labor=(input.labor||[]).map(w=>({...w,gap:w.available===null?null:w.available-w.required}));
    const warningDays=Number.isFinite(input.warningDays)?Math.max(0,input.warningDays):2,erpState=input.erp||{status:'loading'};
    const completionDate=latest(facts.filter(f=>f.date&&f.date<=asOf).map(f=>f.date));
    const sources=[freshness('MPS completions',completionDate,asOf,warningDays,input.completionInfo||{},'planning')];
    if(erpState.status==='ready'){
      sources.push(freshness('Stock snapshot',erpState.stockDate,asOf,warningDays,erpState.stockInfo));
      sources.push(freshness('ERP production'+(erpState.department?' · '+erpState.department:' · all departments'),erpState.productionDate,asOf,warningDays,erpState.imports.transactions));
    }
    const groups=erpState.groups||[],risks=groups.filter(g=>g.complete&&((g.gap!==null&&g.gap<0)||g.available<=0));
    const week=compare(period.weekStart,period.weekEnd),day=compare(period.focus,period.focus);
    return {period,plan,daily,day,week,exceptions,labor,sources,erp:erpState,groups,risks,
      unknownStock:groups.filter(g=>!g.complete),unsetSafety:groups.filter(g=>g.safetyStock===null),
      totals:{overdue:new Set(exceptions.filter(e=>e.type==='overdue').map(e=>e.index)).size,
        parked:new Set(exceptions.filter(e=>e.type==='parked').map(e=>e.index)).size,
        schedule:new Set(exceptions.filter(e=>e.type==='schedule').map(e=>e.index)).size,
        dataIssues:exceptions.filter(e=>e.type==='data').length,
        overloadedLines:plan.lines.filter(l=>l.spillLoad>1e-7).length,
        staffingWeeks:labor.filter(w=>w.gap!==null&&w.gap<0).length},
      month:P.metrics(batches,ledger,{start,end,asOf}),basis:input.basis||'units',warningDays,
      hasPlan:inMonth.length>0,completionInfo:input.completionInfo||null};
  }
  return {addDays,scope,schedule,freshness,erp,build};
});
