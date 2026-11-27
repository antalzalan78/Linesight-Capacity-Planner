(function(){
  'use strict';
  const T=window.LineSightTower,VERSION='20261126-2';
  const el=id=>document.getElementById(id);
  const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=v=>v===null||v===undefined?'—':Number(v).toLocaleString('en-GB',{maximumFractionDigits:2});
  const today=()=>new Date().toLocaleDateString('sv-SE');
  const clone=v=>JSON.parse(JSON.stringify(v));
  const empty=()=>({version:1,master:{items:{},issues:[]},stock:[],transactions:[],imports:{},watch:clone(T.WATCH)});
  let data=empty(),view='materials',pending=null,db=null,loaded=false,busy=false,charts=[],selection='',prodPage=0;
  let importSurface='tower',hubMounted=false,monitorPending=null;
  let reportMessages=false;
  let filters={category:'',search:'',from:'',to:'',department:T.CFC,line:'',group:'',family:'',generic:'',sku:''};
  let stockDate='',stockScope='all',materialPage=0;
  const button=document.createElement('button');button.className='tab';button.dataset.panel='tower';button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V7l6 3V4l6 3v14M3 21h18V11l-6 3M7 15h1M7 18h1M11 12h1M11 16h1M18 18h1"/></svg><span>Control Tower</span>';button.onclick=()=>switchTab('tower');
  document.querySelector('.tabs').appendChild(button);
  const panel=document.createElement('div');panel.className='view-panel';panel.id='panel-tower';
  panel.innerHTML=`<div class="ct-toolbar"><div class="ct-tabs" role="tablist" aria-label="Control Tower views"><button class="add-btn" data-view="materials" role="tab">Strategic materials</button><button class="add-btn" data-view="explorer" role="tab">Stock explorer</button><button class="add-btn" data-view="production" role="tab">Daily production</button><button class="add-btn" data-view="imports" role="tab">ERP imports</button></div><div class="ct-actions"><button class="add-btn" id="ct-export" style="margin:0;">Export this view</button><button class="add-btn" id="ct-backup" style="margin:0;">Download ERP backup</button></div></div><div id="ct-message" class="ct-status" role="status"></div><div id="ct-body"></div>`;
  document.querySelector('.footer').before(panel);
  panel.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.view==='imports'){openImports();return;}view=b.dataset.view;selection='';render();});
  el('ct-export').onclick=exportView;el('ct-backup').onclick=backup;
  function database(){return new Promise((resolve,reject)=>{const request=indexedDB.open('linesight-control-tower',1);request.onupgradeneeded=()=>request.result.createObjectStore('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function read(){return new Promise((resolve,reject)=>{const req=db.transaction('state').objectStore('state').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
  function persist(next){return new Promise((resolve,reject)=>{
    const tx=db.transaction('state','readwrite'),store=tx.objectStore('state'),request=store.get('current'),expected=data.revision||0;let conflict=false;
    request.onsuccess=()=>{const revision=request.result?.revision||0;if(revision!==expected){conflict=true;tx.abort();return;}next.revision=revision+1;store.put(next,'current');};
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(conflict?Error('ERP data changed in another tab. Reload before editing or importing again.'):tx.error||Error('Browser storage write aborted'));
  });}
  function message(text,error=false){el('ct-message').textContent=text;el('ct-message').className='ct-status'+(error?' ct-error':'');const hub=el('datahub-erp-message');if(importSurface==='hub'&&hub){hub.textContent=text;hub.className='ct-status'+(error?' ct-error':'');}const report=el('production-import-message');if(reportMessages&&report){report.textContent=text;report.className='ct-status'+(error?' ct-error':'');}}
  function openImports(section='erp'){if(typeof window.openDataHub==='function')window.openDataHub(section);else{view='imports';importSurface='tower';render();}}
  function refreshImportSurface(){if(importSurface==='hub')imports();else render();}
  function renderHubImports(){
    const host=el('datahub-erp-imports');if(!host)return;
    importSurface='hub';
    if(!loaded){host.innerHTML='<div class="card ct-muted">Loading local ERP data…</div>';return;}
    bindProductionUpload();
    if(!db){host.innerHTML='<div class="card ct-error">Browser storage is unavailable. ERP imports cannot be saved.</div>';return;}
    if(!hubMounted){imports();hubMounted=true;}
    bindProductionUpload();
  }
  const bridge=()=>window.LineSightProductionBridge;
  function bindProductionUpload(){
    if(!bridge())return;const input=el('production-report-file'),status=el('production-bridge-status');if(!input||!status)return;
    input.disabled=!loaded||!db||!!data.productionBridge?.pending;
    input.onchange=()=>{const file=input.files[0];input.value='';if(file)prepareImport('transactions',file);};
    if(!db){status.innerHTML='<p class="ct-error ct-status">Browser storage is unavailable. Production imports cannot be saved.</p>';return;}
    const journal=data.productionBridge;
    status.innerHTML=journal?.pending?'<div class="ct-status ct-warning">ERP records are saved, but the MPS update is pending. Review and finish it before importing another production report. <button class="add-btn" id="production-review-pending">Review pending MPS update</button></div>':journal?'<p class="ct-muted">Shared import applied to Daily production and MPS. MPS department: '+escape(journal.department||'All departments')+'.</p>':data.transactions.length?'<p class="ct-muted">Existing ERP history: '+fmt(data.transactions.length)+' records; '+fmt(bridge().keys(data.transactions,T.CFC).length)+' CFC Job/day totals. These records will be included in the next shared import. Previously imported MPS completions are retained unless overlapping data is explicitly approved for replacement.</p>':'';
    if(journal?.pending)el('production-review-pending').onclick=()=>{
      if(busy)return;reportMessages=true;pending={kind:'transactions',retry:true,source:journal.source,at:journal.at,department:journal.department,
        result:{records:data.transactions,sourceRows:data.transactions.length,issues:[],warnings:[],duplicateRows:0}};
      preview();message('Review the pending MPS update. ERP records are already saved; no upload is needed.');
    };
    const info=el('production-import-message');if(info&&(!info.textContent||info.textContent.includes('Loading shared')))info.textContent='Choose one detailed NetSuite report, then review and apply both destinations below.';
  }
  function destroyCharts(){charts.forEach(c=>c.destroy());charts=[];}
  function select(id,label,values,value,key=v=>v){return `<label>${escape(label)}<select id="${id}" class="si"><option value="">All</option>${values.map(v=>`<option value="${escape(v)}" ${key(v)===key(value)?'selected':''}>${escape(v)}</option>`).join('')}</select></label>`;}
  const unique=values=>[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  const metric=(label,value,sub='')=>`<div class="metric"><div class="metric-label">${escape(label)}</div><div class="metric-val">${escape(value)}</div><div class="metric-sub">${escape(sub)}</div></div>`;
  function source(info){return info?`${escape(info.source)} · imported ${escape(new Date(info.at).toLocaleString('en-GB'))}`:'Not imported';}
  // Local to stock monitors: keep exact quantities visible without labelling safety-stock markers.
  function stockValueLabels(groups){return {id:'linesight-stock-values',afterDatasetsDraw(plot){
    if(!plot.isDatasetVisible(0))return;
    const {ctx,chartArea}=plot,bars=plot.getDatasetMeta(0).data,targets=plot.isDatasetVisible(1)?plot.getDatasetMeta(1).data:[],fontSize=plot.width<600?11:12;
    ctx.save();ctx.font='700 '+fontSize+'px "Century Gothic", "Segoe UI", sans-serif';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillStyle='#002248';ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.lineJoin='round';
    plot.data.datasets[0].data.forEach((value,index)=>{
      const bar=bars[index];
      if(typeof value!=='number'||!Number.isFinite(value)||!bar||bar.skip||![bar.x,bar.y,bar.base].every(Number.isFinite))return;
      const label=fmt(value)+(groups[index]?.complete===false?'*':''),half=ctx.measureText(label).width/2;
      const x=Math.max(chartArea.left+half+2,Math.min(bar.x,chartArea.right-half-2));
      let y=Math.min(bar.y,bar.base)-7;
      const target=targets[index];
      if(target&&!target.skip&&Number.isFinite(target.y)&&target.y>=y-fontSize-4&&target.y<=y+4)y=target.y-7;
      y=Math.max(chartArea.top+fontSize,y);
      ctx.strokeText(label,x,y);ctx.fillText(label,x,y);
    });
    ctx.restore();
  }};}
  function chart(id,type,labels,datasets,extra={},localPlugins=[]){
    if(!window.Chart){el(id).parentElement.innerHTML='<div class="ct-empty">Chart library unavailable. The table and exports still show the data.</div>';return;}
    charts.push(new Chart(el(id),{type,plugins:localPlugins,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,plugins:{legend:{labels:{color:'#4b5d70',font:{size:12}}}},scales:{x:{grid:{color:'#eaf0f6'},ticks:{color:'#4b5d70',font:{size:11}}},y:{beginAtZero:true,grid:{color:'#eaf0f6'},ticks:{color:'#4b5d70',font:{size:11}}}},...extra}}));
  }
  function render(){
    if(!el('ct-body'))return;destroyCharts();
    panel.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===view)));
    if(!loaded){el('ct-body').innerHTML='<div class="card ct-empty">Loading local ERP data…</div>';return;}
    if(view==='materials')materials();else if(view==='explorer')explorer();else if(view==='production')production();else imports();
  }
  function currentSnapshot(){return data.stock.find(s=>s.date===stockDate)||data.stock.slice().sort((a,b)=>b.date.localeCompare(a.date))[0]||null;}
  function materialCatalog(){return T.materialCatalog(currentSnapshot()?.rows||[],data.watch,data.master.items,stockScope);}
  function inventoryRows(){const snapshot=currentSnapshot();return snapshot?T.inventory(snapshot.rows,materialCatalog()).filter(r=>(!filters.category||r.category===filters.category)&&(!filters.search||[r.sku,r.name,r.family].join(' ').toLowerCase().includes(filters.search.toLowerCase()))):[];}
  function materials(){
    const snapshot=currentSnapshot(),setup=T.monitorSetup(data.watch,data.monitors),results=T.monitorResults(snapshot?.rows||[],setup),configured=setup.some(p=>p.groups.length),removals=new Set();
    el('ct-body').innerHTML=`<div class="ct-toolbar ct-monitor-tools"><div class="ct-filters" style="margin:0;">${select('ct-monitor-date','Stock snapshot',data.stock.map(s=>s.date).sort().reverse(),snapshot?.date||'').replace('<option value="">All</option>','<option value="">Latest snapshot</option>')}</div><div class="ct-actions"><button id="ct-save-monitors" class="add-btn">Save monitor changes</button><button id="ct-download-monitors" class="add-btn">Download monitor setup</button><button id="ct-open-monitor-setup" class="add-btn">Import monitor setup in Data Hub</button></div></div>
    ${!snapshot?'<div class="ct-status ct-warning">No stock snapshot imported. Choose Stock_on_hand.xlsx in ERP imports, then click Apply import. <button id="ct-open-imports" class="add-btn">Open ERP imports</button></div>':`<div class="ct-source">Stock date: ${escape(snapshot.date)} (${escape(snapshot.dateBasis||'selected at import')}). ${source(snapshot)}.</div>`}
    ${!configured?'<div class="ct-status">No monitor items configured yet. Import your private monitor setup or add items below. Imported stock remains available in Stock explorer.</div>':''}
    <div class="ct-source">Available = Available at ${T.AVAILABLE.map(escape).join(', ')}. HOLD is excluded. Safety stock is a manual target in ERP source units; a blank target is not zero. Save monitor changes applies all four panels.</div>
    <div class="ct-monitor-grid">${results.map(p=>`<section class="card ct-monitor-card" aria-label="${escape(p.name)}"><div class="ct-monitor-heading"><h3>${escape(p.name)}</h3><span class="ct-muted">${p.groups.length} groups · ${p.groups.reduce((sum,g)=>sum+g.count,0)} items</span></div>
      ${p.groups.length?`<div class="ct-chart ct-monitor-chart"><canvas id="ct-monitor-chart-${p.id}" role="img" aria-label="${escape(p.name)} available stock and safety stock"></canvas></div><div class="ct-table-wrap ct-monitor-table-wrap"><table class="gt ct-monitor-table"><thead><tr><th>Item / family</th><th>Available</th><th>Safety stock</th><th>Gap</th><th>Status</th><th></th></tr></thead><tbody>${p.groups.map(g=>`<tr><td><details class="ct-monitor-members"><summary>${escape(g.name)}<span class="ct-muted">${g.found}/${g.count} items found</span></summary><label>Display name<input class="ni" id="ct-monitor-name-${p.id}-${g.id}" value="${escape(g.name)}" aria-label="Display name ${escape(p.name+' '+g.name)}"></label><label>Item codes<textarea id="ct-monitor-skus-${p.id}-${g.id}" class="ni" aria-label="Item codes ${escape(p.name+' '+g.name)}">${escape(g.skus.join('\n'))}</textarea></label><div class="ct-muted">${g.detail.map(r=>`${escape(r.sku)} · ${escape(r.name)}: ${fmt(r.available)} available; ${fmt(r.blocked)} HOLD`).join('<br>')}</div></details></td><td class="ct-number">${fmt(g.available)}${g.available!==null&&!g.complete?'*':''}</td><td><input class="numi" id="ct-monitor-ss-${p.id}-${g.id}" type="number" min="0" step="any" value="${g.safetyStock??''}" placeholder="Not set" aria-label="Safety stock ${escape(p.name+' '+g.name)}"></td><td class="ct-number">${g.gap>0?'+':''}${fmt(g.gap)}</td><td><span class="ct-badge ${g.status==='Below safety stock'?'bad':!g.complete?'warn':g.status==='At / above safety stock'?'good':''}">${escape(snapshot?g.status:'No snapshot')}</span></td><td><button id="ct-monitor-remove-${p.id}-${g.id}" class="ct-monitor-remove" aria-label="Remove ${escape(p.name+' '+g.name)}" title="Remove this monitor group, not its stock data">×</button></td></tr>`).join('')}</tbody></table></div><p class="ct-muted ct-monitor-note">* A partial sum excludes missing items; the full group total and safety-stock comparison are unknown. Expand a name to inspect or edit its item codes.</p>`:'<div class="ct-empty ct-monitor-empty">Add the items or families to monitor in this panel.</div>'}
      <details class="ct-details ct-monitor-add" ${!p.groups.length||p.id==='custom'?'open':''}><summary>Add item / group</summary><div class="ct-monitor-form"><label>Display name<input class="ni" id="ct-monitor-add-name-${p.id}" placeholder="Item or family name" aria-label="New group name ${escape(p.name)}"></label><label>Safety stock<input class="ni" id="ct-monitor-add-ss-${p.id}" type="number" min="0" step="any" placeholder="Optional" aria-label="New safety stock ${escape(p.name)}"></label><label class="ct-monitor-wide">Item codes<textarea class="ni" id="ct-monitor-add-skus-${p.id}" placeholder="One or more item codes, separated by commas or new lines" aria-label="New item codes ${escape(p.name)}"></textarea></label><button class="add-btn" id="ct-monitor-add-${p.id}">Add to ${escape(p.name)}</button></div></details></section>`).join('')}</div>`;
    const safety=id=>{const raw=el(id).value.trim(),value=raw===''?null:T.number(raw);if(raw!==''&&(value===null||value<0))throw Error('Safety stock must be a non-negative number or blank.');return value;};
    const codes=value=>value.split(/[\s,;]+/).filter(Boolean).map(T.sku);
    const edits=()=>{let next=setup;for(const p of setup)next=T.updateMonitor(next,p.id,p.groups.map(g=>({id:g.id,name:el('ct-monitor-name-'+p.id+'-'+g.id).value,skus:codes(el('ct-monitor-skus-'+p.id+'-'+g.id).value),safetyStock:safety('ct-monitor-ss-'+p.id+'-'+g.id)})));return next;};
    const save=async next=>{busy=true;el('ct-save-monitors').disabled=true;try{const state={...data,monitors:T.validateMonitors(next)};await persist(state);data=state;message('Monitor settings and safety stock saved. ERP source data was not changed.');render();}finally{busy=false;if(el('ct-save-monitors'))el('ct-save-monitors').disabled=false;}};
    const action=async fn=>{if(busy)return;try{await fn();}catch(e){message('Monitor changes were not saved: '+e.message,true);}};
    el('ct-monitor-date').onchange=e=>{stockDate=e.target.value;render();};
    if(el('ct-open-imports'))el('ct-open-imports').onclick=()=>openImports();
    el('ct-save-monitors').onclick=()=>action(()=>save(edits()));
    el('ct-download-monitors').onclick=()=>download('linesight-monitor-setup-'+today()+'.json',JSON.stringify({kind:'linesight-monitor-setup',version:1,monitors:setup},null,2),'application/json');
    el('ct-open-monitor-setup').onclick=()=>openImports('settings');
    for(const p of setup){
      el('ct-monitor-add-'+p.id).onclick=()=>action(async()=>{const next=clone(edits()),target=next.find(x=>x.id===p.id),skus=codes(el('ct-monitor-add-skus-'+p.id).value);target.groups.push({id:'g'+Date.now().toString(36),name:el('ct-monitor-add-name-'+p.id).value.trim()||skus[0]||'',skus,safetyStock:safety('ct-monitor-add-ss-'+p.id)});await save(next);});
      for(const g of p.groups){
        for(const kind of ['ss','name','skus'])el('ct-monitor-'+kind+'-'+p.id+'-'+g.id).oninput=()=>message('Monitor edits are not saved yet. Click Save monitor changes.');
        el('ct-monitor-remove-'+p.id+'-'+g.id).onclick=()=>action(async()=>{const key=p.id+'-'+g.id;if(!removals.has(key)){removals.add(key);const button=el('ct-monitor-remove-'+key);button.textContent='Remove?';button.title='Click again to confirm removal';button.style.fontSize='12px';message('Click Remove? again to remove '+g.name+' from this monitor. Source stock data is kept.');return;}const next=clone(edits());next.find(x=>x.id===p.id).groups=next.find(x=>x.id===p.id).groups.filter(x=>x.id!==g.id);await save(next);});
      }
    }
    if(!snapshot)return;
    for(const p of results)if(p.groups.length)chart('ct-monitor-chart-'+p.id,'bar',p.groups.map(g=>g.name),[
      {label:'Available stock',data:p.groups.map(g=>g.available),backgroundColor:p.groups.map(g=>!g.complete?'#b58223':g.available<=0?'#bd363a':g.gap===null?'#015aab':g.gap<0?'#bd363a':'#08775a'),maxBarThickness:60,order:1},
      {label:'Safety stock',type:'line',data:p.groups.map(g=>g.safetyStock),showLine:false,pointStyle:'line',pointRadius:14,pointHoverRadius:16,borderWidth:3,borderColor:'#946000',backgroundColor:'#946000',order:0}
    ],{layout:{padding:{top:14}},plugins:{legend:{labels:{color:'#4b5d70',font:{size:12},usePointStyle:true}},tooltip:{callbacks:{label:ctx=>ctx.dataset.label+': '+fmt(ctx.raw)+(ctx.datasetIndex===0&&!p.groups[ctx.dataIndex].complete?' (partial; missing items)':'')}}},scales:{x:{grid:{display:false},ticks:{color:'#4b5d70',autoSkip:false,maxRotation:45,minRotation:0}},y:{beginAtZero:true,grace:'15%',ticks:{color:'#4b5d70'},grid:{color:'#eaf0f6'}}}},[stockValueLabels(p.groups)]);
  }
  function explorer(){
    const snapshot=currentSnapshot(),rows=inventoryRows(),tracked=new Set(data.watch.map(r=>r.sku)),perItemChart=!!filters.category&&rows.length<=40;
    materialPage=Math.min(materialPage,Math.max(0,Math.ceil(rows.length/100)-1));const page=rows.slice(materialPage*100,materialPage*100+100);
    const emptyText=stockScope==='watch'&&!data.watch.length?'Your strategic watchlist is empty. The imported stock is available under All stock items.':!materialCatalog().length?'No items were found at the three available-stock locations or NLC 3PL HOLD in this snapshot.':'No materials match these filters.';
    el('ct-body').innerHTML=`<div class="ct-filters">${select('ct-stock-date','Stock snapshot',data.stock.map(s=>s.date).sort().reverse(),snapshot?.date||'').replace('<option value="">All</option>','<option value="">Latest snapshot</option>')}<label>Stock scope<select id="ct-stock-scope" class="si"><option value="all" ${stockScope==='all'?'selected':''}>All stock items</option><option value="watch" ${stockScope==='watch'?'selected':''}>Strategic watchlist (${data.watch.length})</option></select></label>${select('ct-category','Material category',unique(materialCatalog().map(r=>r.category)),filters.category)}<label class="ct-search">Find material<input id="ct-material-search" class="ni" placeholder="Item, description or family" value="${escape(filters.search)}"></label><button id="ct-apply-search" class="add-btn" style="margin:0;min-height:36px;">Apply search</button></div>
    ${!snapshot?'<div class="card ct-empty"><div>No stock snapshot imported.</div><div>Choose Stock_on_hand.xlsx in ERP imports, then click Apply import.</div><button id="ct-open-imports" class="add-btn">Open ERP imports</button></div>':`
    ${stockScope==='all'?`<div class="ct-status">Showing imported items at the selected available-stock and HOLD locations, not just strategic materials. ${data.watch.length?'Select Strategic watchlist to focus on tracked items.':'Your strategic watchlist is empty. Use Track item below to build it.'}</div>`:''}
    <div class="metrics-strip">${metric(stockScope==='all'?'Stock items':'Tracked materials',rows.length)}${metric('No available stock',rows.filter(r=>r.available!==null&&r.available<=0).length)}${metric('Below minimum',rows.some(r=>r.minimum!==null)?rows.filter(r=>r.status==='Below minimum').length:'—',rows.filter(r=>r.minimum===null).length+' without a minimum')}${metric('Materials on HOLD',rows.filter(r=>r.blocked>0).length)}${metric('Not in export',rows.filter(r=>r.available===null).length)}</div>
    <div class="ct-source">Stock date: ${escape(snapshot.date)} (${escape(snapshot.dateBasis||'selected at import')}). ${source(snapshot)}. Available = the three selected locations; HOLD is separate and is never added to available stock.</div>
    ${!rows.length?`<div class="card ct-empty"><div>${escape(emptyText)}</div><button id="ct-reset-materials" class="add-btn">Show all imported stock</button></div>`:`
    <div class="ct-grid"><div class="card"><div class="section-label">${perItemChart?'Available and blocked stock by item':'Stock status by category'}</div><div class="ct-chart ct-tall"><canvas id="ct-stock-chart" aria-label="${perItemChart?'Available and blocked quantities by item':'Stock item counts by category and status'}" role="img"></canvas></div><p class="ct-muted">${perItemChart?'Quantities use ERP source units. Missing stock records remain unavailable.':'Number of SKUs in each category, across all filtered items. Narrow the selection to 40 items or fewer within a category to compare item quantities.'}</p></div><div class="card"><div class="section-label">Stock history — select an item below</div><div class="ct-chart"><canvas id="ct-history-chart" aria-label="Selected material stock history" role="img"></canvas></div><div id="ct-history-label" class="ct-source"></div></div></div>
    <div class="card"><div class="ct-toolbar"><div class="section-label" style="margin:0;">${stockScope==='all'?'Imported stock detail':'Strategic material detail'}</div>${page.some(r=>tracked.has(r.sku))?'<button id="ct-save-minimums" class="add-btn" style="margin:0;">Save minimums</button>':''}</div><div class="ct-actions ct-pagination"><button id="ct-material-prev" class="add-btn" ${materialPage===0?'disabled':''}>Previous 100</button><button id="ct-material-next" class="add-btn" ${(materialPage+1)*100>=rows.length?'disabled':''}>Next 100</button><span class="ct-muted">Showing ${materialPage*100+1}–${Math.min((materialPage+1)*100,rows.length)} of ${fmt(rows.length)} items. Charts, KPIs and CSV include all filtered items.</span></div><div class="ct-table-wrap"><table class="gt ct-table"><thead><tr><th>Item</th><th>Description / family</th><th>3PL available</th><th>WIP CFC available</th><th>In transit available</th><th>Total available</th><th>HOLD on hand</th><th>Minimum / watchlist</th><th>Status</th></tr></thead><tbody>${page.map(r=>`<tr><td class="ct-item"><button class="add-btn" style="margin:0;" data-item="${escape(r.sku)}">${escape(r.sku)}</button></td><td class="ct-description">${escape(r.name)}<div class="ct-muted">${escape(r.category+' / '+r.family)}</div></td><td class="ct-number">${fmt(r.warehouse)}</td><td class="ct-number">${fmt(r.wip)}</td><td class="ct-number">${fmt(r.transit)}</td><td class="ct-number">${fmt(r.available)}</td><td class="ct-number">${fmt(r.blocked)}</td><td>${tracked.has(r.sku)?`<input class="numi" type="number" min="0" step="any" value="${r.minimum??''}" data-minimum="${escape(r.sku)}" aria-label="Minimum stock ${escape(r.sku)}" placeholder="Not set">`:`<button class="add-btn" data-track="${escape(r.sku)}" aria-label="Track item ${escape(r.sku)}">Track item</button>`}</td><td><span class="ct-badge ${r.status==='No available stock'?'bad':r.status==='Below minimum'?'warn':r.status==='Above minimum'?'good':''}">${escape(r.status)}</span></td></tr>`).join('')}</tbody></table></div><div id="ct-stock-detail"></div></div>`}`}
    <details class="card ct-details"><summary>Locations and watchlist settings</summary><p class="ct-muted">Available locations: ${T.AVAILABLE.map(escape).join(', ')}. Blocked location: ${escape(T.HOLD)}. Committed is not subtracted again. Without a BOM or a material consumption export, days of cover are unavailable.</p><div class="ct-actions" style="margin-top:12px;"><input id="ct-add-sku" class="ni" style="width:190px;" placeholder="Item code"><input id="ct-add-category" class="ni" style="width:180px;" placeholder="Material category"><button class="add-btn" id="ct-add-watch" style="margin:0;">Add to watchlist</button></div><p class="ct-muted" style="margin-top:10px;">Watchlists are private browser data and are included in ERP backups. Source stock values come from the imported Excel file.</p></details>`;
    el('ct-stock-date').onchange=e=>{stockDate=e.target.value;filters.category='';selection='';materialPage=0;render();};el('ct-category').onchange=e=>{filters.category=e.target.value;selection='';materialPage=0;render();};
    el('ct-stock-scope').onchange=e=>{stockScope=e.target.value;filters.category='';selection='';materialPage=0;render();};
    const applySearch=()=>{filters.search=el('ct-material-search').value;selection='';materialPage=0;render();};
    el('ct-apply-search').onclick=applySearch;
    el('ct-material-search').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();applySearch();}};
    if(el('ct-open-imports'))el('ct-open-imports').onclick=()=>openImports();
    if(el('ct-reset-materials'))el('ct-reset-materials').onclick=()=>{stockScope='all';filters.category='';filters.search='';selection='';materialPage=0;render();};
    el('ct-add-watch').onclick=async()=>{const key=T.sku(el('ct-add-sku').value);if(!key||data.watch.some(r=>r.sku===key)){message('Enter a new item code.',true);return;}const next={...data,watch:clone(data.watch)};next.watch.push({sku:key,category:el('ct-add-category').value.trim()||'Other',family:'Other',name:key,minimum:null});try{await persist(next);data=next;render();}catch(e){message('Could not save watchlist: '+e.message,true);}};
    if(!snapshot||!rows.length)return;
    el('ct-material-prev').onclick=()=>{materialPage--;render();};el('ct-material-next').onclick=()=>{materialPage++;render();};
    panel.querySelectorAll('[data-track]').forEach(b=>b.onclick=async()=>{
      if(busy)return;const item=materialCatalog().find(r=>r.sku===b.dataset.track);if(!item||data.watch.some(r=>r.sku===item.sku))return;
      busy=true;b.disabled=true;try{const next={...data,watch:[...data.watch,{...item}]};await persist(next);data=next;message(item.sku+' added to your strategic watchlist.');render();}catch(e){message('Could not save watchlist: '+e.message,true);b.disabled=false;}finally{busy=false;}
    });
    panel.querySelectorAll('[data-minimum]').forEach(input=>input.oninput=()=>message('Minimum edits are not saved yet. Click Save minimums to apply them.'));
    if(el('ct-save-minimums'))el('ct-save-minimums').onclick=async()=>{
      if(busy)return;const next={...data,watch:clone(data.watch)};
      try{for(const input of panel.querySelectorAll('[data-minimum]')){const value=input.value===''?null:T.number(input.value);if(input.value!==''&&(value===null||value<0))throw Error('Minimum must be a non-negative number.');const item=next.watch.find(r=>r.sku===input.dataset.minimum);if(item)item.minimum=value;}
        busy=true;el('ct-save-minimums').disabled=true;message('Saving minimums…');await persist(next);data=next;message('Minimums saved.');render();
      }catch(e){message('Minimums were not saved: '+e.message,true);if(el('ct-save-minimums'))el('ct-save-minimums').disabled=false;}finally{busy=false;}
    };
    panel.querySelectorAll('[data-item]').forEach(b=>b.onclick=()=>{selection=b.dataset.item;stockDetail();});
    if(perItemChart){
      chart('ct-stock-chart','bar',rows.map(r=>r.sku.replace('_NLC','')),[{label:'Available',data:rows.map(r=>r.available),backgroundColor:'#08775a'},{label:'Blocked HOLD',data:rows.map(r=>r.blocked),backgroundColor:'#bd363a'}],{indexAxis:'y'});
    }else{
      const categories=unique(rows.map(r=>r.category)),statuses=['No available stock','Below minimum','Above minimum','Minimum not set','Not in export'],colors=['#bd363a','#946000','#08775a','#6c859e','#bcc8d5'];
      chart('ct-stock-chart','bar',categories,statuses.map((label,i)=>({label,backgroundColor:colors[i],data:categories.map(c=>rows.filter(r=>r.category===c&&r.status===label).length)})),{indexAxis:'y',scales:{x:{stacked:true,beginAtZero:true,ticks:{precision:0}},y:{stacked:true}}});
    }
    if(!rows.some(r=>r.sku===selection))selection=rows[0]?.sku||'';stockDetail();
  }
  function stockDetail(){
    const row=inventoryRows().find(r=>r.sku===selection),snapshot=currentSnapshot();
    if(!row)return;
    const history=data.stock.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(s=>({date:s.date,...T.inventory(s.rows,[row])[0]}));
    const old=charts.find(c=>c.canvas.id==='ct-history-chart');if(old){old.destroy();charts=charts.filter(c=>c!==old);}
    chart('ct-history-chart','line',history.map(r=>r.date),[{label:'Available',data:history.map(r=>r.available),borderColor:'#08775a',backgroundColor:'#e4f4ed',pointRadius:4,spanGaps:false},{label:'HOLD',data:history.map(r=>r.blocked),borderColor:'#bd363a',pointRadius:4,spanGaps:false}]);
    el('ct-history-label').textContent=row.sku+' — '+row.name+(history.length<2?'. One snapshot only; no historical trend is available yet.':'');
    el('ct-stock-detail').innerHTML=`<details class="ct-details" open><summary>Source lots: ${escape(row.sku)} — ${escape(snapshot.date)}</summary><div class="ct-table-wrap"><table class="gt"><thead><tr><th>Location</th><th>Lot</th><th>Bin</th><th>Expiry</th><th>On hand</th><th>Available</th><th>Included as</th></tr></thead><tbody>${row.detail.map(r=>`<tr><td>${escape(r.location)}</td><td>${escape(r.lot)}</td><td>${escape(r.bin)}</td><td>${escape(r.expiry||'—')}</td><td class="ct-number">${fmt(r.onHand)}</td><td class="ct-number">${fmt(r.available)}</td><td>${T.AVAILABLE.includes(r.location)?'Available':r.location===T.HOLD?'Blocked':'Excluded location'}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  function productionResult(){return T.production(data.transactions,data.master.items,filters);}
  function production(){
    const result=productionResult(),scope=data.transactions.filter(r=>!filters.department||r.department===filters.department),master=T.canonicalMaster(data.master.items);
    const groups=unique(scope.map(r=>master[r.sku]?.group||'Unmapped'));
    const rows=result.rows.slice(prodPage*100,prodPage*100+100);
    el('ct-body').innerHTML=`<div class="ct-filters"><label>From<input id="ct-from" type="date" class="ni" value="${filters.from}"></label><label>To<input id="ct-to" type="date" class="ni" value="${filters.to}"></label>${select('ct-department','Department',unique(data.transactions.map(r=>r.department)),filters.department)}${select('ct-line','Machine / line',unique(scope.map(r=>r.line)),filters.line)}${select('ct-group','Masterdata category',groups,filters.group,T.labelKey)}${select('ct-family','Masterdata family',unique(scope.filter(r=>!filters.group||T.labelKey(master[r.sku]?.group||'Unmapped')===T.labelKey(filters.group)).map(r=>master[r.sku]?.family||'Unmapped')),filters.family,T.labelKey)}${select('ct-generic','Generic',unique(scope.map(r=>master[r.sku]?.generic||'Unmapped')),filters.generic,T.labelKey)}<label>SKU<input id="ct-sku" class="ni" placeholder="Exact item code (optional)" value="${escape(filters.sku)}"></label><button id="ct-reset-production" class="add-btn" style="margin:0;">Reset filters</button></div>
    <div class="ct-source">${source(data.imports.transactions)}. ${result.rows.length?'':'No completion records match this selection; this is not evidence of zero production. '}Actual production uses Quantity on Work Order Completion records, keyed by Internal ID. CFC is the default department; GAS remains available through the department filter. The latest source day may be incomplete.</div>
    ${!data.transactions.length?'<div class="card ct-empty">Import Transactions.xlsx in ERP imports.</div>':`
    <div class="metrics-strip">${metric('Production quantity',fmt(result.units),'ERP source units')}${metric('Completion records',fmt(result.rows.length))}${metric('Work orders',fmt(result.jobs))}${metric('Produced SKUs',fmt(result.skus))}${metric('Unmapped records',fmt(result.unmapped),fmt(result.unmappedUnits)+' quantity without masterdata')}${metric('Zero-quantity records',fmt(result.zeroRows),'retained, not counted as produced units')}</div>
    <div class="ct-grid"><div class="card"><div class="section-label">Daily production</div><div class="ct-chart"><canvas id="ct-daily-chart" role="img" aria-label="Daily production quantities"></canvas></div></div><div class="card"><div class="section-label">Production by machine / line</div><div class="ct-chart"><canvas id="ct-line-chart" role="img" aria-label="Production by machine or line"></canvas></div></div></div>
    <div class="ct-grid"><div class="card"><div class="section-label">Cumulative production</div><div class="ct-chart"><canvas id="ct-cumulative-chart" role="img" aria-label="Cumulative production"></canvas></div></div><div class="card"><div class="section-label">Production by masterdata category</div><div class="ct-chart"><canvas id="ct-group-chart" role="img" aria-label="Production quantities by category"></canvas></div></div></div>
    <div class="card"><div class="section-label">SKU detail</div><div class="ct-table-wrap"><table class="gt ct-table"><thead><tr><th>SKU</th><th>Description</th><th>Category</th><th>Family</th><th>Generic</th><th>Quantity</th></tr></thead><tbody>${result.items.map(r=>`<tr><td class="ct-item"><button class="add-btn" style="margin:0;" data-prod-sku="${escape(r.sku)}">${escape(r.sku)}</button></td><td class="ct-description">${escape(r.name)}</td><td>${escape(r.group)}</td><td>${escape(r.family)}</td><td>${escape(r.generic||'—')}</td><td class="ct-number">${fmt(r.qty)}</td></tr>`).join('')}</tbody></table></div></div>
    <details class="card ct-details"><summary>Completion record detail (${fmt(result.rows.length)} records)</summary><div class="ct-actions"><button id="ct-prev" class="add-btn" ${prodPage===0?'disabled':''}>Previous 100</button><button id="ct-next" class="add-btn" ${(prodPage+1)*100>=result.rows.length?'disabled':''}>Next 100</button><span class="ct-muted">Page ${prodPage+1} — CSV export includes all filtered records</span></div><div class="ct-table-wrap"><table class="gt ct-table"><thead><tr><th>Internal ID</th><th>Date</th><th>Work order</th><th>Item</th><th>Line</th><th>Department</th><th>Quantity</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${escape(r.id)}</td><td>${escape(r.date)}</td><td>${escape(r.job)}</td><td>${escape(r.sku)}</td><td>${escape(r.line)}</td><td>${escape(r.department)}</td><td class="ct-number">${fmt(r.qty)}</td></tr>`).join('')}</tbody></table></div></details>`}`;
    for(const key of ['from','to','department','line','group','family','generic','sku'])el('ct-'+key).onchange=e=>{filters[key]=key==='sku'&&e.target.value?T.sku(e.target.value):e.target.value;if(key==='department'){filters.line='';filters.group='';filters.family='';filters.generic='';}if(key==='group')filters.family='';prodPage=0;render();};
    el('ct-reset-production').onclick=()=>{filters={...filters,from:'',to:'',department:T.CFC,line:'',group:'',family:'',generic:'',sku:''};setDefaultDates();prodPage=0;render();};
    if(!data.transactions.length)return;
    panel.querySelectorAll('[data-prod-sku]').forEach(b=>b.onclick=()=>{filters.sku=b.dataset.prodSku;prodPage=0;render();});
    el('ct-prev').onclick=()=>{prodPage=Math.max(0,prodPage-1);render();};el('ct-next').onclick=()=>{prodPage++;render();};
    const daily=T.calendar(result.days,filters.from,filters.to);let cumulative=0;
    chart('ct-daily-chart','bar',daily.map(r=>r.date),[{label:'Actual quantity',data:daily.map(r=>r.qty),backgroundColor:'#015aab'}]);
    chart('ct-line-chart','bar',result.lines.map(r=>r.label),[{label:'Actual quantity',data:result.lines.map(r=>r.qty),backgroundColor:'#08775a'}],{indexAxis:'y'});
    chart('ct-cumulative-chart','line',daily.map(r=>r.date),[{label:'Cumulative actual',data:daily.map(r=>r.qty===null?null:cumulative+=r.qty),borderColor:'#015aab',backgroundColor:'#eaf0f6',pointRadius:daily.length>60?0:3,spanGaps:false,fill:true}]);
    chart('ct-group-chart','bar',result.groups.map(r=>r.label),[{label:'Actual quantity',data:result.groups.map(r=>r.qty),backgroundColor:'#08775a'}],{indexAxis:'y'});
  }
  function imports(){
    const host=el(importSurface==='hub'?'datahub-erp-imports':'ct-body');
    const kinds=[['master','Masterdata','Item Code2 joins production Item. Identical duplicates do not multiply production. Conflicting classifications remain visible.'],['stock','Stock on hand','Full stock snapshot. Select its reporting date. Reimporting a date replaces that snapshot only.']];
    if(!bridge())kinds.push(['transactions','Production transactions','Work Order Completion only. Quantity is the production measure. Internal ID prevents repeated uploads from counting twice. Omitted IDs are retained; changes to existing IDs require approval.']);
    host.innerHTML=`<div class="ct-status ct-warning">Raw ERP data is stored in this browser using IndexedDB and is not included in planner cloud sync. Aggregated completions from the shared production import are included in the plan. Download an ERP backup before clearing browser data.</div><div class="ct-import-grid">${kinds.map(([kind,title,desc])=>`<div class="card"><h3>${title}</h3><p class="ct-muted">${desc}</p><input type="file" accept=".xlsx,.xls,.csv" data-import="${kind}" aria-label="Import ${title}">${kind==='stock'?`<label class="ct-muted">Stock reporting date (confirm)<input type="date" id="ct-stock-report-date" class="ni" value="${today()}"></label>`:''}<div class="ct-source">${source(data.imports[kind])}</div></div>`).join('')}</div><div id="ct-import-preview" class="card" style="margin-top:18px;"></div><div class="card"><div class="section-label">Data quality</div><p class="ct-muted">${Object.keys(data.master.items).length} masterdata items; ${fmt(data.master.duplicateRows||0)} duplicate master rows consolidated. ${data.stock.length} stock snapshots. ${fmt(data.transactions.length)} unique completion records.</p>${data.master.issues.length?`<details class="ct-details"><summary>Conflicting master classifications (${data.master.issues.length})</summary>${data.master.issues.slice(0,50).map(s=>`<p class="ct-muted">${escape(s)}</p>`).join('')}</details>`:''}<p class="ct-muted">Country differences remain as multiple countries on one SKU. Conflicting HC or missing standard minutes are not used to invent labor or OEE KPIs. Missing source days are not automatically labelled zero-production days.</p><div class="ct-actions" style="margin-top:12px;"><label class="ct-muted">Restore an ERP backup <input type="file" id="ct-restore" accept="application/json,.json"></label></div></div>`;
    host.innerHTML+=`<section id="datahub-settings" class="hub-section" aria-labelledby="hub-settings-title"><div class="hub-section-heading"><h2 id="hub-settings-title">Backups &amp; setup</h2><span class="hub-storage hub-local">Private browser data</span></div><div class="hub-backup-grid"><div class="card"><div class="section-label">Strategic monitor setup</div><p class="ct-muted">Import item lists and monitor groups from a private JSON setup. Existing non-blank safety-stock targets for matching groups are kept. Stock and production records are not replaced.</p><label class="ct-muted">Import monitor setup<input id="ct-import-monitors" type="file" accept="application/json,.json" aria-label="Import monitor setup"></label><button id="ct-hub-download-monitors" class="add-btn">Download current monitor setup</button><div id="ct-monitor-import-preview"></div></div><div class="card"><div class="section-label">ERP backup</div><p class="ct-muted">Includes ERP masterdata, stock snapshots, transactions and monitor settings. It does not include your capacity plan or MPS. Restoring replaces local ERP data only and requires confirmation.</p><button id="ct-hub-backup" class="add-btn">Download ERP backup</button><div id="ct-hub-restore-slot"></div></div></div></section>`;
    el('ct-hub-restore-slot').appendChild(el('ct-restore').parentElement);
    host.querySelectorAll('[data-import]').forEach(input=>input.onchange=()=>{const file=input.files[0];if(file)prepareImport(input.dataset.import,file);input.value='';});
    el('ct-restore').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const parsed=T.validateBackup(JSON.parse(await file.text()));if(!confirm('Replace local ERP dashboard data with this backup? Download the current backup first if needed.'))return;if(parsed.productionBridge)parsed.productionBridge={...parsed.productionBridge,pending:true};await persist(parsed);data=parsed;setDefaultDates();stockScope=data.watch.length?'watch':'all';filters.category='';filters.search='';materialPage=0;view=data.stock.length?(T.monitorSetup(data.watch,data.monitors).some(p=>p.groups.length)?'materials':'explorer'):'imports';pending=null;monitorPending=null;message('ERP backup restored.'+(parsed.productionBridge?' Review the pending MPS update; the planner was not replaced.':''));refreshImportSurface();}catch(error){message(error.message,true);}};
    el('ct-hub-backup').onclick=backup;
    el('ct-hub-download-monitors').onclick=()=>download('linesight-monitor-setup-'+today()+'.json',JSON.stringify({kind:'linesight-monitor-setup',version:1,monitors:T.monitorSetup(data.watch,data.monitors)},null,2),'application/json');
    el('ct-import-monitors').onchange=async e=>{if(busy){message('Finish the current import first.',true);return;}const file=e.target.files[0];if(!file)return;try{const payload=JSON.parse(await file.text());T.importMonitorSetup(payload,T.monitorSetup(data.watch,data.monitors));monitorPending={payload,name:file.name||'Monitor setup'};monitorPreview();message('Monitor setup preview ready. Click Apply monitor setup to save it.');}catch(error){monitorPending=null;el('ct-monitor-import-preview').innerHTML='';message('Monitor changes were not saved: '+error.message,true);}};
    if(monitorPending)monitorPreview();
    if(pending)preview();
    bindProductionUpload();
  }
  function monitorPreview(){
    if(!monitorPending)return;
    const proposal=monitorPending,next=T.importMonitorSetup(proposal.payload,T.monitorSetup(data.watch,data.monitors));
    el('ct-monitor-import-preview').innerHTML=`<div class="ct-status"><strong>${escape(proposal.name)}</strong><p>${next.map(p=>escape(p.name)+': '+p.groups.length+' groups').join(' · ')}</p><p>Apply replaces monitor item lists only. Existing non-blank safety-stock targets for matching groups are kept. Stock snapshots, transactions and masterdata are not changed.</p><div class="ct-actions"><button class="add-btn" id="ct-monitor-apply-setup">Apply monitor setup</button><button class="add-btn" id="ct-monitor-cancel-setup">Cancel</button></div></div>`;
    el('ct-monitor-apply-setup').onclick=async()=>{if(busy||monitorPending!==proposal)return;busy=true;el('ct-monitor-apply-setup').disabled=true;try{const next={...data,monitors:T.importMonitorSetup(proposal.payload,T.monitorSetup(data.watch,data.monitors))};await persist(next);data=next;monitorPending=null;message('Monitor settings and safety stock saved. ERP source data was not changed.');imports();}catch(error){message('Monitor changes were not saved: '+error.message,true);el('ct-monitor-apply-setup').disabled=false;}finally{busy=false;}};
    el('ct-monitor-cancel-setup').onclick=()=>{monitorPending=null;el('ct-monitor-import-preview').innerHTML='';el('ct-import-monitors').value='';message('Monitor setup import cancelled. Existing settings were kept.');};
  }
  function parseFile(kind,file){return new Promise((resolve,reject)=>{const worker=new Worker('./src/erp-import-worker.js?v='+VERSION);worker.onmessage=e=>{if(e.data.progress)message(e.data.progress);if(e.data.error){worker.terminate();reject(Error(e.data.error));}if(e.data.result){worker.terminate();resolve(e.data.result);}};worker.onerror=e=>{worker.terminate();reject(Error(e.message||'The Excel import worker failed.'));};worker.postMessage({kind,file});});}
  async function prepareImport(kind,file){
    if(busy){message('Finish the current import first.',true);return;}
    reportMessages=kind==='transactions';
    if(kind==='transactions'&&bridge()&&data.productionBridge?.pending){message('Finish the pending MPS update before importing another production report.',true);bindProductionUpload();return;}
    busy=true;pending=null;el('ct-import-preview').innerHTML='';if(el('production-import-preview'))el('production-import-preview').innerHTML='';
    try{
      const date=kind==='stock'?T.date(el('ct-stock-report-date').value):null;if(kind==='stock'&&!date)throw Error('Select the stock reporting date first.');
      const result=await parseFile(kind,file);
      pending={kind,result,source:file.name,date,at:new Date().toISOString(),department:data.productionBridge?.department??T.CFC};message('Import preview ready. Click Apply import below to save the data. Nothing has been changed yet.');preview();
    }catch(e){pending=null;message(e.message,true);}finally{busy=false;}
  }
  function productionPreview(){
    const p=pending,r=p.result,api=bridge(),merge=T.mergeTransactions(data.transactions,r.records),revision=data.revision||0;
    const priorKeys=p.retry?data.productionBridge.priorKeys:api.keys(data.transactions,p.department);
    const ticket=api.preview(merge.records,{department:p.department,priorKeys,source:p.source,at:p.at});
    const result=ticket.result,blocked=r.issues.length>0||!r.records.length||result.errors.length>0||!result.stats.records;
    const correction=merge.updated>0||result.warnings.length>0;
    const departments=unique([T.CFC,p.department,...merge.records.map(v=>v.department)]),target=el('production-import-preview');
    target.innerHTML=`<h3>${escape(p.source)}</h3><p class="ct-muted">${p.retry?'ERP data is already saved. This finishes the pending planner update.':fmt(r.records.length)+' completion records in this file · '+merge.added+' new · '+merge.updated+' changed · '+merge.unchanged+' unchanged IDs.'} Repeated IDs are not counted twice. Quantity, not Built, is the shared production measure.</p>
      <label class="hub-production-scope">MPS department (Daily production retains every department)<select class="si" id="production-scope" ${p.retry?'disabled':''}><option value="" ${p.department===''?'selected':''}>All departments</option>${departments.map(d=>`<option value="${escape(d)}" ${d===p.department?'selected':''}>${escape(d)}</option>`).join('')}</select></label>
      <p class="ct-muted">MPS preview: ${fmt(result.stats.records)} retained records → ${fmt(result.stats.jobDays)} Job/day totals; ${fmt(result.stats.changed)} changed totals. ${fmt(result.stats.unmatched)} totals have no unique MPS match and remain in actual production. ${fmt(result.stats.missingJobs)} records have no Job number. ${fmt(result.stats.retainedHistory)} older managed totals absent from this browser's ERP history are retained. ${fmt(result.stats.legacyEvents)} legacy event IDs not yet present in ERP history remain in MPS only; import their transaction history to reconcile both views.</p>
      ${!result.stats.records?'<p class="ct-error">No retained completion records in the selected MPS department. Choose a department represented in the report.</p>':''}
      ${!r.records.length?'<p class="ct-error">No Work Order Completion records found. Choose the detailed NetSuite transaction export.</p>':''}
      ${[...r.issues,...result.errors].slice(0,20).map(s=>`<p class="ct-error">${escape(s)}</p>`).join('')}
      ${[...(r.warnings||[]),...result.warnings].slice(0,20).map(s=>`<p class="ct-warning">${escape(s)}</p>`).join('')}
      ${correction?'<label class="hub-production-approval"><input type="checkbox" id="ct-confirm-change"> Approve changed IDs, replacement of overlapping legacy totals / manual corrections, and any MPS department changes. Existing history is retained.</label>':''}
      <div class="ct-actions"><button id="ct-apply" class="add-btn" ${blocked||correction?'disabled':''}>${p.retry?'Finish MPS update':'Apply to Daily production + MPS'}</button><button id="ct-cancel" class="add-btn">Cancel</button></div>`;
    el('production-scope').onchange=e=>{p.department=e.target.value;productionPreview();};
    if(correction){el('ct-confirm-change').checked=false;el('ct-confirm-change').onchange=e=>el('ct-apply').disabled=blocked||!e.target.checked;}
    el('ct-cancel').onclick=()=>{pending=null;target.innerHTML='';message(p.retry?'Review cancelled. The saved ERP import still has a pending MPS update.':'Import cancelled. Existing data was kept.');};
    el('ct-apply').onclick=async()=>{
      if(pending!==p||busy||blocked||correction&&!el('ct-confirm-change').checked)return;
      if((data.revision||0)!==revision){productionPreview();message('ERP data changed since preview. Review the updated preview.',true);return;}
      busy=true;el('ct-apply').disabled=true;let erpSaved=!!p.retry,plannerSaved=false;
      try{
        if(!p.retry){
          const next={...data,transactions:merge.records,imports:{...data.imports,transactions:{source:p.source,at:p.at,rows:r.sourceRows}},
            productionBridge:{version:1,pending:true,department:p.department,source:p.source,at:p.at,priorKeys}};
          await persist(next);data=next;erpSaved=true;
        }
        api.commit(ticket,!!el('ct-confirm-change')?.checked);plannerSaved=true;
        const done={...data,productionBridge:{...data.productionBridge,pending:false,priorKeys:[]}};
        await persist(done);data=done;pending=null;target.innerHTML='';view='production';setDefaultDates();refreshImportSurface();
        message('Production import saved to Daily production and MPS. Repeated uploads do not add the same completions twice.');
      }catch(error){
        if(erpSaved){pending=null;target.innerHTML='';setDefaultDates();refreshImportSurface();message((plannerSaved?'ERP and MPS are saved, but the completion marker is pending. Review the pending update to finish. ':'ERP records are saved; the MPS update is pending. Review and retry without uploading again. ')+error.message,true);}
        else{message('Import was not saved: '+error.message,true);el('ct-apply').disabled=false;}
      }finally{busy=false;bindProductionUpload();}
    };
  }
  function preview(){
    if(!pending||!el('ct-import-preview'))return;
    if(pending.kind==='transactions'&&bridge()){productionPreview();return;}
    const p=pending,r=p.result,merge=p.kind==='transactions'?T.mergeTransactions(data.transactions,r.records):null;
    const blocked=p.kind!=='master'&&r.issues.length>0;
    const replacing=p.kind==='stock'&&data.stock.some(s=>s.date===p.date);
    const correction=!!merge?.updated||replacing;
    el('ct-import-preview').innerHTML=`<h3 style="font-size:15px;margin-bottom:10px;">${escape(p.source)}</h3><p class="ct-muted">${fmt(r.sourceRows)} source rows. ${p.kind==='master'?Object.keys(r.items).length+' distinct items; '+r.duplicateRows+' duplicate rows consolidated.':p.kind==='stock'?r.rows.length+' stock rows; '+r.ignoredRows+' summary / blank rows excluded.':r.records.length+' completion records; '+merge.added+' new, '+merge.updated+' changed, '+merge.unchanged+' unchanged. '+r.duplicateRows+' identical repeated IDs in the file.'}</p>${p.kind==='stock'?`<p class="ct-muted">Reporting date: ${escape(p.date)}. ${replacing?'Replaces the saved snapshot for this date.':'Adds a separate stock snapshot.'}</p>`:''}${r.warnings?.length?`<div class="ct-status ct-warning">${r.warnings.map(escape).join('<br>')}</div>`:''}${r.issues.length?`<div class="ct-status ${blocked?'ct-error':'ct-warning'}">${r.issues.slice(0,12).map(escape).join('<br>')}${r.issues.length>12?'<br>… '+r.issues.length+' issues in total':''}</div>`:''}${correction?'<label class="ct-muted"><input type="checkbox" id="ct-confirm-change"> Approve corrections / replacement of the existing dated snapshot</label>':''}<div class="ct-actions"><button id="ct-apply" class="add-btn" ${blocked||correction?'disabled':''}>Apply import</button><button id="ct-cancel" class="add-btn">Cancel</button></div>`;
    if(correction)el('ct-confirm-change').onchange=e=>el('ct-apply').disabled=blocked||!e.target.checked;
    el('ct-cancel').onclick=()=>{pending=null;el('ct-import-preview').innerHTML='';message('Import cancelled.');};
    el('ct-apply').onclick=async()=>{
      if(pending!==p||blocked||busy||(correction&&!el('ct-confirm-change').checked))return;busy=true;el('ct-apply').disabled=true;
      try{
        const next={...data,imports:{...data.imports}};const at=new Date().toISOString();
        if(p.kind==='master')next.master=r;
        if(p.kind==='transactions')next.transactions=merge.records;
        if(p.kind==='stock')next.stock=[...data.stock.filter(s=>s.date!==p.date),{date:p.date,rows:r.rows,source:p.source,at}].sort((a,b)=>a.date.localeCompare(b.date));
        next.imports[p.kind]={source:p.source,at,rows:r.sourceRows};
        await persist(next);data=next;pending=null;setDefaultDates();
        if(p.kind==='stock'){view=T.monitorSetup(data.watch,data.monitors).some(p=>p.groups.length)?'materials':'explorer';stockDate=p.date;if(!data.watch.length)stockScope='all';filters.category='';filters.search='';selection='';materialPage=0;message('Stock snapshot saved for '+p.date+(importSurface==='hub'?'. Open Stock explorer or Strategic materials to view it.':'. The stock dashboard is shown below.'));}
        else if(p.kind==='transactions'){view='production';message('Production import saved. Repeated Internal IDs are not added twice.');}
        else message('Masterdata import saved. Open Strategic materials or Daily production to view the data.');
        refreshImportSurface();
      }catch(e){message('Import was not saved: '+e.message,true);if(el('ct-apply'))el('ct-apply').disabled=false;}finally{busy=false;}
    };
  }
  function setDefaultDates(){const dates=data.transactions.filter(r=>r.department===T.CFC).map(r=>r.date).sort();const latest=dates.at(-1)||data.transactions.map(r=>r.date).sort().at(-1);if(latest){filters.to=latest;filters.from=latest.slice(0,8)+'01';}stockDate=data.stock.at(-1)?.date||'';}
  function download(name,text,type){const blob=new Blob([text],{type}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
  function csv(rows){return rows.map(row=>row.map(v=>{if(v===null||v===undefined)return '';if(typeof v==='number')return String(v);let s=String(v);if(/^\s*[=+@-]|^[\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
  function exportView(){
    let rows;
    if(view==='materials')rows=[['Snapshot date','Panel','Item / family','Item codes','Available (known stock)','Safety stock','Gap','Items found','Total items','Missing items','Status'],...T.monitorResults(currentSnapshot()?.rows||[],T.monitorSetup(data.watch,data.monitors)).flatMap(p=>p.groups.map(g=>[currentSnapshot()?.date||'',p.name,g.name,g.skus.join('; '),g.available,g.safetyStock,g.gap,g.found,g.count,g.missing.join('; '),currentSnapshot()?g.status:'No snapshot']))];
    else if(view==='explorer')rows=[['Snapshot date','SKU','Description','Category','Family','Available 3PL','Available WIP CFC','Available in transit','Total available','HOLD on hand','Minimum','Status'],...inventoryRows().map(r=>[currentSnapshot().date,r.sku,r.name,r.category,r.family,r.warehouse,r.wip,r.transit,r.available,r.blocked,r.minimum,r.status])];
    else if(view==='production'){const master=T.canonicalMaster(data.master.items);rows=[['Internal ID','Transaction date','Work order','SKU','Machine / Line','Department','Master category','Family','Quantity'],...productionResult().rows.map(r=>[r.id,r.date,r.job,r.sku,r.line,r.department,master[r.sku]?.group||'Unmapped',master[r.sku]?.family||'Unmapped',r.qty])];}
    else{message('Select Strategic materials, Stock explorer or Daily production to export the displayed data.');return;}
    download('linesight-'+view+'-'+today()+'.csv','\uFEFF'+csv(rows),'text/csv;charset=utf-8');
  }
  function backup(){download('linesight-erp-backup-'+today()+'.json',JSON.stringify(data),'application/json');}
  window.LineSightTowerUI={render,exportView,renderImports:renderHubImports,
    getOverview:options=>!loaded?{status:'loading'}:!db?{status:'unavailable'}:window.LineSightOverview.erp(data,options),
    openView:(next,options={})=>{if(!['materials','explorer','production'].includes(next))return;view=next;selection='';
      if(options.stockDate)stockDate=options.stockDate;
      if(next==='production'&&options.from){filters={...filters,from:options.from,to:options.to||'',department:options.department??T.CFC,line:'',group:'',family:'',generic:'',sku:''};prodPage=0;}
      switchTab('tower');}};
  database().then(async connection=>{db=connection;data=await read()||empty();stockScope=data.watch.length?'watch':'all';loaded=true;setDefaultDates();if(location.hash==='#datahub')switchTab('datahub');else if(el('panel-datahub')?.classList?.contains?.('active'))renderHubImports();else if(location.hash==='#tower')switchTab('tower');else render();window.LineSightOverviewUI?.refresh();}).catch(e=>{loaded=true;db=null;message('Local ERP storage is unavailable: '+e.message,true);el('ct-body').innerHTML='<div class="card ct-empty">Enable browser storage before importing ERP data.</div>';if(importSurface==='hub')renderHubImports();window.LineSightOverviewUI?.refresh();});
})();
