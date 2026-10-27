(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.LineSightProduction=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const job=v=>String(v??'').trim();
  const key=(j,d)=>JSON.stringify([job(j),d]);
  const copy=v=>JSON.parse(JSON.stringify(v));
  function validDate(value){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;
    const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;
  }
  function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function parseQuantity(value){
    if(typeof value==='number')return Number.isFinite(value)?Math.round(value):null;
    let s=String(value??'').trim().replace(/\s/g,'');
    if(!/^-?\d[\d.,]*$/.test(s))return null;
    if(s.includes(',')&&s.includes('.')){
      const decimal=s.lastIndexOf(',')>s.lastIndexOf('.')?',':'.';
      s=s.split(decimal===','?'.':',').join('').replace(decimal,'.');
    }else if(/^-?\d{1,3}([.,]\d{3})+$/.test(s))s=s.replace(/[.,]/g,'');
    else s=s.replace(',','.');
    return Number.isFinite(Number(s))?Math.round(Number(s)):null;
  }
  function migrate(batches=[]){
    const ledger={};
    batches.forEach(r=>Object.values(r.completionByDate||{}).forEach(v=>{
      if(!job(r.job)||!validDate(v.date))return;
      const k=key(r.job,v.date);
      if(!ledger[k])ledger[k]={job:job(r.job),date:v.date,qty:number(v.qty),mode:'snapshot',source:'Legacy import'};
    }));
    return ledger;
  }
  function merge(ledger={},rows=[],options={}){
    const mode=options.mode||'snapshot',out=copy(ledger),warnings=[],errors=[];
    const grouped=new Map(),ids=new Set(),affected=new Set();
    for(const r of rows){
      if(!job(r.job)||job(r.job)==='-'||!validDate(r.date)||!Number.isFinite(Number(r.qty))||Number(r.qty)<0){errors.push('Invalid Job, date or quantity.');continue;}
      const id=job(r.id);
      if(mode==='events'&&(!id||ids.has(id))){errors.push('Event imports require one row per unique Completion / Internal ID.');continue;}
      ids.add(id);
      const k=key(r.job,r.date);
      if(!grouped.has(k))grouped.set(k,{job:job(r.job),date:r.date,qty:0,records:Object.create(null)});
      const a=grouped.get(k);a.qty+=Number(r.qty);
      if(mode==='events')a.records[id]=Number(r.qty);
    }
    if(errors.length)return {ledger:out,warnings,errors,affected:[]};
    if(mode==='events'){
      // A corrected ID may move between dates or jobs; keep it only once.
      for(const [k,old] of Object.entries(out))for(const id of Object.keys(old.records||{})){
        const incoming=rows.find(r=>job(r.id)===id);
        if(incoming&&key(incoming.job,incoming.date)!==k){
          warnings.push('Completion '+id+' moved to another Job/date.');
          old.history=[...(old.history||[]),{qty:old.qty,source:old.source||'',importedAt:old.importedAt||'',movedCompletion:id,records:{...old.records}}].slice(-10);
          delete old.records[id];old.qty=Object.values(old.records).reduce((s,v)=>s+number(v),0);affected.add(old.job);
        }
      }
    }
    for(const [k,a] of grouped){
      const old=ledger[k],existing=out[k];
      let next={job:a.job,date:a.date,qty:a.qty,mode,source:options.source||'',importedAt:options.at||new Date().toISOString()};
      if(mode==='events'){
        next.records={...(existing?.records||{}),...a.records};
        next.qty=Object.values(next.records).reduce((s,v)=>s+number(v),0);
        for(const [id,qty] of Object.entries(a.records))if(old?.records&&Object.hasOwn(old.records,id)&&qty<old.records[id])warnings.push('Completion '+id+': '+old.records[id]+' → '+qty+' units.');
      }
      if(old&&old.mode!==mode)warnings.push(a.job+' / '+a.date+': import mode changes.');
      if(old&&next.qty<number(old.qty))warnings.push(a.job+' / '+a.date+': '+old.qty+' → '+next.qty+' units.');
      if(old){
        const previous={qty:old.qty,source:old.source||'',importedAt:old.importedAt||'',mode:old.mode};
        next.history=old.qty!==next.qty||old.mode!==mode?[...(old.history||[]),previous].slice(-10):old.history||[];
      }
      out[k]=next;affected.add(a.job);
    }
    return {ledger:out,warnings:[...new Set(warnings)],errors,affected:[...affected]};
  }
  function baseEntries(r,ledger={}){
    const imported=Object.values(ledger).filter(v=>v.job===job(r.job));
    if(imported.length)return imported.map(v=>({date:v.date,qty:number(v.qty)}));
    const legacy=Object.values(r.completionByDate||{});
    if(legacy.length)return legacy.map(v=>({date:validDate(v.date)?v.date:null,qty:number(v.qty)}));
    const baseline=r.productionBaseline;
    if(baseline)return [{date:validDate(baseline.date)?baseline.date:null,qty:number(baseline.qty)}];
    if(r.produced!==undefined)return [{date:validDate(r.actualDate)?r.actualDate:null,qty:number(r.produced)}];
    return [];
  }
  function entries(r,ledger={}){
    const base=baseEntries(r,ledger);
    if(!r.manualProduction)return base;
    const qty=Math.max(0,number(r.manualProduction.qty));
    const date=validDate(r.manualProduction.date)?r.manualProduction.date:null;
    if(!base.some(v=>v.date))return [{date,qty}];
    return [...base,{date,qty:qty-base.reduce((s,v)=>s+v.qty,0)}];
  }
  function summarize(r,ledger={}){
    const facts=entries(r,ledger),produced=Math.max(0,facts.reduce((s,v)=>s+v.qty,0));
    const byDate={};facts.filter(v=>v.date).forEach(v=>{byDate[v.date]=(byDate[v.date]||0)+v.qty;});
    let cumulative=0,actualDate='';
    const dates=Object.keys(byDate).sort();
    dates.forEach(d=>{cumulative+=byDate[d];if(cumulative>=r.qty&&r.qty>0){if(!actualDate)actualDate=d;}else actualDate='';});
    return {known:facts.length>0,produced,remaining:Math.max(0,number(r.qty)-produced),
      actualDate:produced>=r.qty?actualDate:'',lastProductionDate:dates.filter(d=>byDate[d]!==0).pop()||'',
      status:produced<=0?'Not started':produced>=r.qty&&r.qty>0?'Completed':'In progress'};
  }
  function matchCounts(batches){const counts=new Map();batches.forEach(r=>{if(job(r.job))counts.set(job(r.job),(counts.get(job(r.job))||0)+1);});return counts;}
  function facts(batches,ledger){
    const counts=matchCounts(batches),out=[],used=new Set();
    batches.forEach(r=>{
      const j=job(r.job);
      if(j&&counts.get(j)!==1)return;
      entries(r,ledger).forEach(v=>out.push({...v,job:j,matched:true}));if(j)used.add(j);
    });
    Object.values(ledger).forEach(v=>{if(!used.has(v.job))out.push({job:v.job,date:v.date,qty:number(v.qty),matched:false});});
    return out;
  }
  function metrics(batches,ledger,{start,end,asOf=end}={}){
    const cutoff=asOf<end?asOf:end,counts=matchCounts(batches),allFacts=facts(batches,ledger);
    const cohort=batches.filter(r=>r.date>=start&&r.date<=end),planned=cohort.reduce((s,r)=>s+number(r.qty),0);
    const undated=r=>entries(r,ledger).some(v=>!v.date&&v.qty!==0);
    const datedQty=r=>entries(r,ledger).filter(v=>v.date&&v.date<=cutoff).reduce((s,v)=>s+v.qty,0);
    const produced=cohort.reduce((s,r)=>s+(undated(r)||(job(r.job)&&counts.get(job(r.job))!==1)?0:Math.min(number(r.qty),Math.max(0,datedQty(r)))),0);
    const eligible=batches.filter(r=>validDate(r.dueDate)&&r.dueDate>=start&&r.dueDate<=cutoff&&!undated(r)&&(!job(r.job)||counts.get(job(r.job))===1));
    const onTime=eligible.filter(r=>entries(r,ledger).filter(v=>v.date&&v.date<=r.dueDate).reduce((s,v)=>s+v.qty,0)>=r.qty&&r.qty>0).length;
    const hasActuals=allFacts.length>0;
    const periodFacts=allFacts.filter(v=>v.date&&v.date>=start&&v.date<=cutoff),daily={};
    periodFacts.forEach(v=>{daily[v.date]=(daily[v.date]||0)+v.qty;});
    return {planned,produced,completion:planned>0&&hasActuals?Math.round(produced/planned*100):null,
      adherence:eligible.length&&hasActuals?Math.round(onTime/eligible.length*100):null,onTime,due:eligible.length,
      missingDue:cohort.filter(r=>!validDate(r.dueDate)).length,
      actual:periodFacts.reduce((s,v)=>s+v.qty,0),daily,
      undated:allFacts.filter(v=>!v.date).reduce((s,v)=>s+Math.abs(v.qty),0),
      unmatched:Object.values(ledger).filter(v=>counts.get(v.job)!==1),cutoff};
  }
  return {validDate,escapeHTML,parseQuantity,key,migrate,merge,baseEntries,entries,summarize,matchCounts,facts,metrics};
});
