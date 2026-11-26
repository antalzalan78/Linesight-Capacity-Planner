(function(){
  'use strict';
  const O=window.LineSightOverview,el=id=>document.getElementById(id),escape=LineSightProduction.escapeHTML;
  const number=v=>v===null||v===undefined?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:2});
  const date=v=>v?new Date(v+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'Not available';
  const stamp=v=>v&&!isNaN(new Date(v))?new Date(v).toLocaleString('en-GB'):'Unknown';
  let focus='',warningDays=2,type='all',model=null,charts=[];
  const names={overdue:'Overdue / unconfirmed',parked:'Un-allocated',schedule:'Scheduling issue',data:'Missing / ambiguous data'};
  function action(label,target,extra=''){return `<button class="add-btn" data-ops-target="${target}" ${extra}>${escape(label)}</button>`;}
  function badge(label,tone='neutral'){return `<span class="ops-badge ${tone}">${escape(label)}</span>`;}
  function tile(label,value,detail,target,tone='neutral'){
    return `<button class="ops-kpi ${tone}" data-ops-target="${target}"><span class="metric-label">${escape(label)}</span><span class="metric-val">${escape(value)}</span><span class="metric-sub">${escape(detail)}</span><span class="ops-kpi-link">View details →</span></button>`;
  }
  function bind(){
    el('panel-overview').querySelectorAll('[data-ops-target]').forEach(b=>b.onclick=()=>{
      const target=b.dataset.opsTarget;
      if(target==='sources'){el('ops-sources')?.scrollIntoView({block:'start',behavior:'instant'});el('ops-freshness-days')?.focus({preventScroll:true});return;}
      if(target==='materials'){window.LineSightTowerUI?.openView('materials',{stockDate:model.erp.stockDate});return;}
      if(target==='erp-production'){window.LineSightTowerUI?.openView('production',{from:model.period.start,to:model.period.asOf,department:window.LineSightTower.CFC});return;}
      if(target==='planning'||target==='erp'){openDataHub(target);return;}
      if(target.startsWith('exceptions:')){type=target.split(':')[1];render();el('ops-exceptions')?.scrollIntoView({block:'start',behavior:'instant'});el('ops-exception-filter')?.focus({preventScroll:true});return;}
      if(target==='mps'){mpsFltLine='';mpsFltPg='';mpsFltDate='';}
      switchTab(target);
      const batchIndex=b.dataset.opsBatch;
      if(batchIndex!==undefined)(el('mps-batch-'+batchIndex)||el('mps-parked-'+batchIndex))?.scrollIntoView({block:'center',behavior:'instant'});
    });
    el('ops-focus').onchange=e=>{focus=e.target.value;render();el('ops-focus')?.focus({preventScroll:true});};
    el('ops-freshness-days').onchange=e=>{const n=Number(e.target.value);if(Number.isFinite(n)&&n>=0&&n<=365){warningDays=n;render();el('ops-freshness-days')?.focus({preventScroll:true});}};
    el('ops-exception-filter').onchange=e=>{type=e.target.value;render();el('ops-exception-filter')?.focus({preventScroll:true});};
    el('ops-current').onclick=()=>{focus='';curDate=new Date();curDate.setDate(1);window.render();};
    el('ops-export').onclick=exportView;
  }
  function plot(){
    if(!window.Chart)return;
    const rows=model.daily.filter(r=>r.date>=model.period.weekStart&&r.date<=model.period.weekEnd);
    const canvas=el('ops-production-chart');if(!canvas)return;
    charts.push(new Chart(canvas,{type:'bar',data:{labels:rows.map(r=>new Date(r.date+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit'})),datasets:[
      {label:'Scheduled plan',data:rows.map(r=>r.planned),backgroundColor:'#7ebff4',borderColor:'#015aab',borderWidth:1},
      {label:'Recorded actual',data:rows.map(r=>r.actual),backgroundColor:'#08775a'}]},options:{responsive:true,maintainAspectRatio:false,animation:false,
        plugins:{legend:{labels:{color:'#4b5d70',font:{size:12}}},tooltip:{callbacks:{label:c=>c.dataset.label+': '+number(c.raw)+' units'}}},
        scales:{x:{grid:{display:false},ticks:{color:'#4b5d70',font:{size:12}}},y:{beginAtZero:true,title:{display:true,text:'Units'},ticks:{color:'#4b5d70',font:{size:12}},grid:{color:'#eaf0f6'}}}}}));
  }
  function render(){
    charts.forEach(c=>c.destroy());charts=[];
    const input=operationsOverviewContext(focus,warningDays);model=O.build(input);focus=model.period.focus;
    const m=model,p=m.period,ready=m.erp.status==='ready',groups=m.groups.length;
    const weekLabel=date(p.weekStart)+' – '+date(p.weekEnd),unknown=m.unknownStock.length;
    const stockValue=!ready||!groups||!m.erp.stockDate?'—':String(m.risks.length);
    const stockSub=!ready?(m.erp.status==='loading'?'Loading ERP data':'ERP storage unavailable'):!groups?'Configure monitored items':!m.erp.stockDate?'No snapshot on / before focus date':`${groups} groups · ${unknown} incomplete`;
    const staffingKnown=m.labor.some(w=>w.available!==null&&w.required>0),allExceptions=m.exceptions.length;
    const exceptions=m.exceptions.filter(e=>type==='all'||e.type===type);
    const weekRows=m.daily.filter(r=>r.date>=p.weekStart&&r.date<=p.weekEnd);
    const riskRows=m.risks.slice().sort((a,b)=>(a.gap??0)-(b.gap??0));
    const load=v=>number(m.basis==='units'?v:v/60),unit=m.basis==='units'?'units':'hours';
    const stale=m.sources.filter(s=>s.status==='stale').length,missing=m.sources.filter(s=>s.status==='missing').length;
    el('panel-overview').innerHTML=`
      <div class="ops-controls"><div class="ops-period"><label for="ops-focus">Focus date</label><input id="ops-focus" class="ni" type="date" min="${p.start}" max="${p.end}" value="${p.focus}"><button class="add-btn" id="ops-current">Today</button></div><div class="ops-actions"><button class="add-btn" id="ops-export">Export overview CSV</button>${action('Data Hub','erp')}</div></div>
      <div class="ops-context">${escape(date(p.focus))} · ${escape(weekLabel)} <span>Daily / weekly production uses MPS completions. Stock uses the latest snapshot on or before ${escape(date(p.asOf))}.</span></div>
      ${p.future?'<p class="ops-notice">Future planning date: actual production is not yet available. Completion and exceptions use records through '+escape(date(p.asOf))+'.</p>':p.focus===p.today?'<p class="ops-notice">Today is in progress. Actuals are recorded quantities, not a confirmed final daily total.</p>':''}
      ${stale||missing?`<div class="ops-notice ops-freshness-alert">Sources beyond the ${warningDays}-calendar-day rule: ${stale} · Sources without dated data: ${missing}. ${action('Review sources','sources')}</div>`:''}
      <div class="ops-kpis">
        ${tile('Material risks',stockValue,stockSub,'materials',m.risks.length?'danger':'neutral')}
        ${tile('Overdue / unconfirmed',m.totals.overdue,'Batches due before the reporting cutoff','exceptions:overdue',m.totals.overdue?'danger':'neutral')}
        ${tile('Un-allocated batches',m.totals.parked,'Unfinished batches in the selected month','exceptions:parked',m.totals.parked?'warn':'neutral')}
        ${tile('Workforce gaps',staffingKnown?m.totals.staffingWeeks:'—',staffingKnown?'Weeks with insufficient combined labour hours':'Set workforce availability / labour requirements','headcount',m.totals.staffingWeeks?'danger':'neutral')}
      </div>
      <div class="ops-main-grid"><section class="card ops-production" aria-labelledby="ops-prod-title"><div class="ops-heading"><h2 id="ops-prod-title">Plan vs. recorded production</h2>${action('Open MPS','mps')}</div>
        <div class="ops-comparisons"><div><span>Focus day · ${escape(date(p.focus))}</span><strong>${number(m.day.planned)} / ${number(m.day.actual)}</strong><small>scheduled / recorded units</small></div><div><span>Focus week through ${escape(date(p.asOf))} · ${m.week.recordedDays} dates with actuals</span><strong>${number(m.week.plannedToCutoff)} / ${number(m.week.actual)}</strong><small>scheduled / recorded units · full week plan: ${number(m.week.planned)}</small></div></div>
        ${m.hasPlan||weekRows.some(r=>r.actual!==null)?`<div class="ops-chart"><canvas id="ops-production-chart" role="img" aria-label="Scheduled and recorded production by day. Missing actual records are not zero. Week ${escape(weekLabel)}"></canvas></div>`:'<div class="ops-empty">No batch plan or dated MPS completions in this week. Import planning data in Data Hub.</div>'}
        <p class="info-text">Plan reflects the current saved schedule; multi-day batches follow available line capacity. — means no actual record; no zero is assumed. ERP transactions are not added to MPS completions.</p>
        <details class="ops-detail"><summary>Daily values and month-to-date measures</summary><div class="ops-table-wrap"><table class="gt"><thead><tr><th>Date</th><th>Scheduled units</th><th>Recorded units</th></tr></thead><tbody>${weekRows.map(r=>`<tr><td>${escape(date(r.date))}</td><td>${number(r.planned)}</td><td>${number(r.actual)}</td></tr>`).join('')}</tbody></table></div><p class="info-text">Selected-month plan completion: ${m.month.completion===null?'—':m.month.completion+'%'} · On-time adherence: ${m.month.adherence===null?'—':m.month.adherence+'%'} (${m.month.onTime}/${m.month.due} eligible due batches). Through ${escape(date(m.month.cutoff))}.</p></details>
      </section>
      <section class="card" aria-labelledby="ops-material-title"><div class="ops-heading"><h2 id="ops-material-title">Materials needing attention</h2>${action('Strategic materials','materials')}</div>
        <p class="info-text">Snapshot: ${escape(date(m.erp.stockDate))}. ${m.erp.stockInfo?.dateBasis?escape(m.erp.stockInfo.dateBasis)+'. ':''}${m.unsetSafety.length} groups have no safety-stock target.</p>
        ${!ready?`<div class="ops-empty">${m.erp.status==='loading'?'Loading local ERP data…':'Local ERP storage is unavailable. Open Control Tower to inspect the storage error.'}</div>`:!groups?'<div class="ops-empty">No monitored items configured. Add your strategic items and safety-stock targets in Strategic materials.</div>':!m.erp.stockDate?'<div class="ops-empty">No stock snapshot is available for this reporting date.</div>':riskRows.length?`<div class="ops-table-wrap ops-risk-table"><table class="gt"><thead><tr><th>Item / family</th><th>Available</th><th>Target</th><th>Status</th></tr></thead><tbody>${riskRows.map(g=>`<tr><td>${escape(g.name)}<small>${escape(g.panel)}</small></td><td>${number(g.available)}</td><td>${number(g.safetyStock)}</td><td>${badge(g.available<=0?'No available stock':'Below target','danger')}</td></tr>`).join('')}</tbody></table></div>`:'<div class="ops-empty">No known complete group is below its target or at zero stock.</div>'}
        ${unknown?`<p class="ops-notice">Missing / partial stock data: ${unknown} ${unknown===1?'group':'groups'}. Safety-stock compliance is unknown for these groups.</p>`:''}
      </section></div>
      <section class="card" id="ops-exceptions" aria-labelledby="ops-exceptions-title"><div class="ops-heading"><h2 id="ops-exceptions-title">Batch action queue <span class="ops-count">${allExceptions} signals</span></h2><label class="ops-inline-label">Show<select class="si" id="ops-exception-filter">${[['all','All signals'],...Object.entries(names)].map(([k,n])=>`<option value="${k}" ${type===k?'selected':''}>${n}</option>`).join('')}</select></label></div>
        <div class="ops-table-wrap"><table class="gt ops-exception-table"><thead><tr><th>Signal</th><th>Job / SKU</th><th>Line</th><th>Planned start / due</th><th>Remaining units</th><th>Detail</th><th></th></tr></thead><tbody>${exceptions.slice(0,50).map(e=>`<tr><td>${badge(names[e.type],e.type==='overdue'?'danger':'warn')}</td><td>${escape(e.job||'No Job no.')}<small>${escape(e.sku)}</small></td><td>${escape(e.line||'—')}</td><td>${escape(e.date)}<small>Due: ${escape(e.dueDate||'Not set')}</small></td><td>${number(e.remaining)}</td><td>${escape(e.detail)}</td><td>${action('Open batch','mps',`data-ops-batch="${e.index}"`)}</td></tr>`).join('')||'<tr><td colspan="7">No signals in this selection.</td></tr>'}</tbody></table></div>
        ${exceptions.length>50?'<p class="info-text">Showing the first 50 signals. CSV includes every signal in the current selection.</p>':''}<p class="info-text">A batch can have several signals. Unconfirmed overdue batches may reflect missing or stale completion data.</p>
      </section>
      <div class="ops-bottom-grid"><section class="card"><div class="ops-heading"><h2>Line capacity &amp; spill</h2>${action('Daily capacity grid','mps')}</div><p class="info-text">Full selected month · ${escape(m.basis==='units'?'Units/day basis':m.basis==='runtime'?'Run time/batch basis':'Standard minutes/day basis')} · ${m.totals.overloadedLines} lines with month-end spill.</p><div class="ops-table-wrap"><table class="gt"><thead><tr><th>Line</th><th>Plan (${unit})</th><th>Capacity (${unit})</th><th>Month-end spill (${unit})</th></tr></thead><tbody>${m.plan.lines.map(l=>`<tr><td>${escape(l.name)}</td><td>${load(l.load)}</td><td>${load(l.capacity)}</td><td>${l.spillLoad>1e-7?badge(load(l.spillLoad),'danger'):load(0)}</td></tr>`).join('')||'<tr><td colspan="4">No production lines configured.</td></tr>'}</tbody></table></div><p class="info-text">Carry between days is allowed. Only load that cannot clear by month-end is flagged. ${m.totals.schedule} batches have scheduling issues; they are listed in the action queue. Prior-month backlog is shown in Backlog Analysis, not silently added to daily plan.</p></section>
      <section class="card"><div class="ops-heading"><h2>Weekly workforce</h2>${action('Headcount details','headcount')}</div><div class="ops-table-wrap"><table class="gt"><thead><tr><th>Week</th><th>Required hrs</th><th>Available hrs</th><th>Gap hrs</th></tr></thead><tbody>${m.labor.map(w=>`<tr><td>${escape(w.label)}</td><td>${number(w.required)}</td><td>${number(w.available)}</td><td>${w.gap===null?'—':w.gap<0?badge(number(w.gap),'danger'):'+'+number(w.gap)}</td></tr>`).join('')}</tbody></table></div><p class="info-text">Combined direct + indirect hours, using the selected month's availability and absence settings. Detailed per-shift checks remain in Headcount.</p></section></div>
      <section class="card" id="ops-sources"><div class="ops-heading"><h2>Source freshness &amp; coverage</h2><label class="ops-inline-label">Warn after<input class="ni" id="ops-freshness-days" type="number" min="0" max="365" value="${warningDays}" aria-label="Freshness warning after calendar days">calendar days</label></div><p class="info-text">Rule relative to ${escape(date(p.asOf))}. Latest activity is not proof that an export is complete. Import time and source-data date are different.</p>
        <div class="ops-source-grid">${m.sources.map(s=>`<article class="ops-source"><div class="ops-heading"><h3>${escape(s.label)}</h3>${badge(s.status==='missing'?'No dated data':s.status==='stale'?'Older than rule':'Within rule',s.status==='current'?'neutral':'warn')}</div><strong>${escape(date(s.date))}</strong><p>${s.age===null?'No dated records available':s.age+' calendar days before cutoff'}</p><small>Source: ${escape(s.source||'Not recorded')}<br>Imported: ${escape(stamp(s.importedAt))}</small>${action('Open imports',s.target)}</article>`).join('')}
        ${!ready?`<article class="ops-source"><h3>ERP sources</h3><p>${m.erp.status==='loading'?'Loading…':'Browser storage unavailable'}</p>${action('ERP imports','erp')}</article>`:''}</div>
        <div class="ops-master-status">Masterdata: ${ready?number(m.erp.masterItems)+' items · '+number(m.erp.masterIssues)+' classification conflicts · '+number(m.erp.unmapped)+' ERP records without a master match through cutoff':'not loaded'}. ${action('ERP daily production','erp-production',p.asOf<p.start?'disabled title="Actual reporting has not started for this month"':'')}</div>
      </section>`;
    bind();plot();
  }
  function exportView(){
    if(!model)return;const m=model,p=m.period,rows=[['Operations Overview',p.start,p.end],['Focus date',p.focus],['Actual reporting cutoff',p.asOf],['Freshness rule (calendar days)',m.warningDays],
      ['Known material risks',m.erp.status==='ready'&&m.groups.length&&m.erp.stockDate?m.risks.length:''],['Overdue / unconfirmed batches',m.totals.overdue],['Un-allocated unfinished batches',m.totals.parked],['Weeks with labour-hour gaps',m.labor.some(w=>w.available!==null&&w.required>0)?m.totals.staffingWeeks:''],
      ['Focus week scheduled units through cutoff',m.week.plannedToCutoff??''],['Focus week recorded units through cutoff',m.week.actual??''],['Focus week full scheduled units',m.week.planned],
      ['Selected-month plan completion %',m.month.completion??''],['On-time adherence %',m.month.adherence??''],[],['Daily production','Scheduled units','Recorded units (blank = no record)']];
    m.daily.filter(r=>r.date>=p.weekStart&&r.date<=p.weekEnd).forEach(r=>rows.push([r.date,r.planned,r.actual??'']));
    rows.push([],['Monitored material','Panel','Snapshot','Available (may be partial)','Safety stock','Gap','Complete','Status']);
    m.groups.forEach(g=>rows.push([g.name,g.panel,m.erp.stockDate||'',g.available??'',g.safetyStock??'',g.gap??'',g.complete?'Yes':'No',g.status]));
    rows.push([],['Signal','Job','SKU','Line','Start','Due','Remaining units','Detail']);
    m.exceptions.filter(e=>type==='all'||e.type===type).forEach(e=>rows.push([names[e.type],e.job,e.sku,e.line,e.date,e.dueDate,e.remaining??'',e.detail]));
    const load=v=>m.basis==='units'?v:v/60;
    rows.push([],['Line','Basis','Load unit','Planned load','Capacity','Month-end spill load']);m.plan.lines.forEach(l=>rows.push([l.name,m.basis,m.basis==='units'?'units':'hours',load(l.load),load(l.capacity),load(l.spillLoad)]));
    rows.push([],['Week','Required hours','Available hours','Gap hours']);m.labor.forEach(w=>rows.push([w.label,w.required,w.available??'',w.gap??'']));
    rows.push([],['Source','Data date','Import timestamp','Filename','Freshness','Date basis']);m.sources.forEach(s=>rows.push([s.label,s.date||'',s.importedAt||'',s.source,s.status,s.dateBasis]));
    downloadCSV(rows,'linesight_operations_'+p.focus+'.csv');
  }
  window.LineSightOverviewUI={render,exportView,refresh(){if(activeTab==='overview')render();}};
  window.LineSightOverviewUI.refresh();
})();
