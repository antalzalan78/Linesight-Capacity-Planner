(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.LineSightTower=api;})(typeof self!=='undefined'?self:globalThis,function(){
  'use strict';
  const AVAILABLE=['NLC 3PL','NLC Production WIP CFC','NLC to 3PL In Transit'];
  const HOLD='NLC 3PL HOLD';
  const CFC='NLC Production WIP CFC';
  // Item watchlists are private, user-imported configuration, not public application data.
  const WATCH=[];
  const text=v=>String(v??'').trim();
  const sku=v=>{let s=text(v).toUpperCase();if(/^\d+(?:\.0+)?$/.test(s))s=String(Number(s))+'_NLC';return s;};
  const job=v=>text(v).replace(/^Work\s*Order\s*#\s*/i,'');
  const norm=v=>text(v).toLowerCase().replace(/[\s_-]+/g,'');
  function number(value){
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    let s=text(value);if(!s||s==='-')return null;
    // ERP exports contain typed numeric cells; textual numbers use an explicit US grouping.
    if(!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(s))return null;
    const n=Number(s.replace(/,/g,''));return Number.isFinite(n)?n:null;
  }
  function date(value){
    if(typeof value==='number'&&Number.isFinite(value)&&value>1&&value<100000)return new Date(Date.UTC(1899,11,30)+Math.floor(value)*86400000).toISOString().slice(0,10);
    if(value instanceof Date&&!isNaN(value))return value.toISOString().slice(0,10);
    const s=text(value),iso=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/),eu=s.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})(?:\s.*)?$/);
    const key=iso?iso.slice(1).join('-'):eu?[eu[3],eu[2].padStart(2,'0'),eu[1].padStart(2,'0')].join('-'):'';
    if(!key||isNaN(new Date(key))||new Date(key).toISOString().slice(0,10)!==key)return null;return key;
  }
  function table(matrix,required,{repeatable=[],warnings=[]}={}){
    const at=matrix.slice(0,25).findIndex(row=>required.every(h=>row.some(c=>norm(c)===norm(h))));
    if(at<0)throw Error('Required columns not found: '+required.join(', '));
    const canonical=new Map([...required,...repeatable].map(h=>[norm(h),h])),allowed=new Set(repeatable.map(norm));
    const headers=matrix[at].map(h=>canonical.get(norm(h))||text(h)),seen=new Set(),notified=new Set();
    for(const h of headers){
      const key=norm(h);if(h&&seen.has(key)){
        if(!allowed.has(key))throw Error('Duplicate column: '+h);
        if(!notified.has(key)){warnings.push(h+' appears more than once. Matching values or blanks are combined; different values block the import.');notified.add(key);}
      }
      if(h)seen.add(key);
    }
    return matrix.slice(at+1).map((cells,i)=>{const r=Object.create(null);headers.forEach((h,j)=>{if(!h)return;if(allowed.has(norm(h))){if(!r[h])r[h]=[];r[h].push(cells[j]??null);}else r[h]=cells[j]??null;});r._row=at+i+2;return r;});
  }
  function master(matrix){
    const rows=table(matrix,['Item Code2','Type']),groups=new Map(),issues=[];
    for(const r of rows){const key=sku(r['Item Code2']);if(!key)continue;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    const items=Object.create(null);let duplicateRows=0;
    for(const [key,list] of groups){
      duplicateRows+=list.length-1;
      const vals=field=>[...new Set(list.map(r=>text(r[field])).filter(v=>v&&v!=='-'))];
      const fields={name:'Description',group:'Type',family:'Type 2',variant:'Type3',generic:'Generic'};
      const item={sku:key,countries:vals('Country'),conflicts:[]};
      for(const [dest,source] of Object.entries(fields)){const v=vals(source);item[dest]=v.length===1?v[0]:v.length?'Conflicting masterdata':'Unclassified';if(v.length>1)item.conflicts.push(source);}
      const standards=[...new Set(list.map(r=>number(r.Std_Min_per_unit)).filter(v=>v>0))];item.stdMin=standards.length===1?standards[0]:null;
      if(item.conflicts.length)issues.push(key+': conflicting '+item.conflicts.join(', '));
      items[key]=item;
    }
    return {items,sourceRows:rows.length,duplicateRows,issues};
  }
  function stock(matrix){
    const source=table(matrix,['Item','Location','On Hand','Available']),rows=[],issues=[];let ignoredRows=0;
    for(const r of source){
      const item=sku(r.Item),location=text(r.Location);
      if(!item||!location){ignoredRows++;continue;}
      const onHand=number(r['On Hand']),available=number(r.Available);
      if(onHand===null||available===null){issues.push('Row '+r._row+': invalid stock quantity for '+item);continue;}
      rows.push({sku:item,location,name:text(r['Display Name']),lot:text(r.Lot),bin:text(r['Bin Number']),expiry:date(r['Expiration Date']),onHand,available});
    }
    return {rows,issues,sourceRows:source.length,ignoredRows};
  }
  function transactions(matrix){
    const warnings=[],source=table(matrix,['Internal ID','Transaction Date','Item','Quantity','Type'],{repeatable:['Machine / Line'],warnings}),records=[],issues=[];let ignoredRows=0,duplicateRows=0;
    const seen=new Map();
    for(const r of source){
      if(!text(r['Internal ID'])||!text(r.Item)){ignoredRows++;continue;}
      if(text(r.Type)!=='Work Order Completion'){ignoredRows++;continue;}
      const qty=number(r.Quantity),d=date(r['Transaction Date']);
      if(qty===null||!d){issues.push('Row '+r._row+': invalid transaction date or Quantity');continue;}
      const lines=[...new Set((r['Machine / Line']||[]).map(text).filter(Boolean))];
      if(lines.length>1){issues.push('Row '+r._row+': conflicting Machine / Line values in repeated columns: '+lines.join(' / '));continue;}
      const record={id:text(r['Internal ID']),date:d,sku:sku(r.Item),qty,job:job(r.Job),line:lines[0]||text(r['Machine / Line2'])||'Unspecified',department:text(r.Department)||'Unspecified',erpGroup:text(r['NLC - Type Group']),erpType:text(r['NLC - Type'])};
      const signature=JSON.stringify(record);
      if(seen.has(record.id)){duplicateRows++;if(seen.get(record.id)!==signature)issues.push('Conflicting Internal ID '+record.id);continue;}
      seen.set(record.id,signature);records.push(record);
    }
    return {records,issues,warnings,sourceRows:source.length,ignoredRows,duplicateRows};
  }
  function mergeTransactions(previous,incoming){
    const map=new Map(previous.map(r=>[r.id,r]));let added=0,updated=0,unchanged=0;
    for(const r of incoming){const old=map.get(r.id);if(!old)added++;else if(JSON.stringify(old)===JSON.stringify(r))unchanged++;else updated++;map.set(r.id,r);}
    return {records:[...map.values()],added,updated,unchanged};
  }
  function inventory(rows,watch=WATCH){
    const index=new Map();
    for(const r of rows){if(!index.has(r.sku))index.set(r.sku,[]);index.get(r.sku).push(r);}
    return watch.map(w=>{
      const detail=index.get(w.sku)||[],eligible=detail.filter(r=>AVAILABLE.includes(r.location)),hold=detail.filter(r=>r.location===HOLD);
      const present=detail.length>0,available=present?eligible.reduce((s,r)=>s+r.available,0):null;
      const blocked=present?hold.reduce((s,r)=>s+r.onHand,0):null;
      const minimum=number(w.minimum),status=!present?'Not in export':available<=0?'No available stock':minimum===null?'Minimum not set':available<minimum?'Below minimum':'Above minimum';
      return {...w,name:detail.find(r=>r.name)?.name||w.name,available,blocked,minimum,status,
        warehouse:present?eligible.filter(r=>r.location===AVAILABLE[0]).reduce((s,r)=>s+r.available,0):null,
        wip:present?eligible.filter(r=>r.location===AVAILABLE[1]).reduce((s,r)=>s+r.available,0):null,
        transit:present?eligible.filter(r=>r.location===AVAILABLE[2]).reduce((s,r)=>s+r.available,0):null,detail};
    });
  }
  function materialCatalog(rows,watch=[],items={},scope='watch'){
    if(scope==='watch')return watch.map(r=>({...r}));
    const tracked=new Map(watch.map(r=>[r.sku,r])),stockItems=new Map();
    for(const r of rows){
      if(!AVAILABLE.includes(r.location)&&r.location!==HOLD)continue;
      if(!stockItems.has(r.sku)){
        const item=items[r.sku],saved=tracked.get(r.sku);
        stockItems.set(r.sku,saved?{...saved}:{sku:r.sku,name:item?.name||r.name||r.sku,category:item?.group||'Unclassified',family:item?.family||'Unclassified',minimum:null});
      }
    }
    return [...stockItems.values()].sort((a,b)=>a.sku.localeCompare(b.sku));
  }
  function lineKey(value){const m=text(value).match(/^(?:CFC[- ]?L|Line\s*)(\d+)$/i);return m?'Line'+Number(m[1]):text(value);}
  function calendar(days,from,to){
    if(!days.length)return [];
    const index=new Map(days.map(r=>[r.date,r.qty])),first=from||days[0].date,last=to||days.at(-1).date,result=[];
    if(!date(first)||!date(last)||first>last)return [];
    for(let tick=Date.parse(first),end=Date.parse(last);tick<=end&&result.length<3660;tick+=86400000){const d=new Date(tick).toISOString().slice(0,10);result.push({date:d,qty:index.has(d)?index.get(d):null});}
    return result;
  }
  function validateBackup(state){
    const fail=()=>{throw Error('The ERP backup has invalid or unsupported records. Existing dashboard data was kept.');};
    if(!state||state.version!==1||!Array.isArray(state.transactions)||!Array.isArray(state.stock)||!Array.isArray(state.watch)||!state.master?.items||!state.imports||!Array.isArray(state.master.issues)||(state.revision!==undefined&&(!Number.isInteger(state.revision)||state.revision<0)))fail();
    const ids=new Set(),watch=new Set(),dates=new Set();
    for(const r of state.transactions){if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||typeof r.date!=='string'||date(r.date)!==r.date||typeof r.sku!=='string'||!r.sku||!Number.isFinite(r.qty)||typeof r.department!=='string'||typeof r.line!=='string')fail();ids.add(r.id);}
    for(const s of state.stock){if(!s||typeof s.date!=='string'||date(s.date)!==s.date||dates.has(s.date)||!Array.isArray(s.rows))fail();dates.add(s.date);for(const r of s.rows)if(!r||typeof r.sku!=='string'||!r.sku||typeof r.location!=='string'||!Number.isFinite(r.available)||!Number.isFinite(r.onHand))fail();}
    for(const r of state.watch){if(!r||typeof r.sku!=='string'||!r.sku||watch.has(r.sku)||typeof r.category!=='string'||typeof r.family!=='string'||typeof r.name!=='string'||(r.minimum!==null&&(!Number.isFinite(r.minimum)||r.minimum<0)))fail();watch.add(r.sku);}
    for(const r of Object.values(state.master.items))if(!r||['group','family','name','generic','variant'].some(k=>typeof r[k]!=='string'))fail();
    return state;
  }
  function production(records,items={},filters={}){
    const rows=records.filter(r=> (!filters.from||r.date>=filters.from)&&(!filters.to||r.date<=filters.to)&&(!filters.department||r.department===filters.department)&&(!filters.line||r.line===filters.line)&&(!filters.group||(items[r.sku]?.group||'Unmapped')===filters.group)&&(!filters.family||(items[r.sku]?.family||'Unmapped')===filters.family)&&(!filters.generic||(items[r.sku]?.generic||'Unmapped')===filters.generic)&&(!filters.sku||r.sku===filters.sku));
    const days=new Map(),lines=new Map(),groups=new Map(),skus=new Map();let units=0,unmapped=0,unmappedUnits=0,zeroRows=0;
    for(const r of rows){const category=items[r.sku]?.group||'Unmapped';units+=r.qty;if(!items[r.sku]){unmapped++;unmappedUnits+=r.qty;}if(r.qty===0)zeroRows++;
      for(const [map,key] of [[days,r.date],[lines,r.line],[groups,category],[skus,r.sku]])map.set(key,(map.get(key)||0)+r.qty);
    }
    return {rows,units,unmapped,unmappedUnits,zeroRows,jobs:new Set(rows.map(r=>r.job).filter(Boolean)).size,skus:skus.size,
      days:[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,qty])=>({date,qty})),
      lines:[...lines].map(([label,qty])=>({label,qty})).sort((a,b)=>b.qty-a.qty),groups:[...groups].map(([label,qty])=>({label,qty})).sort((a,b)=>b.qty-a.qty),
      items:[...skus].map(([sku,qty])=>({sku,qty,...(items[sku]||{name:sku,group:'Unmapped',family:'Unmapped'})})).sort((a,b)=>b.qty-a.qty)};
  }
  return {AVAILABLE,HOLD,CFC,WATCH,text,sku,job,number,date,master,stock,transactions,mergeTransactions,inventory,materialCatalog,production,lineKey,calendar,validateBackup};
});
