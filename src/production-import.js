(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./production.js'),require('./control-tower.js'));
  else root.LineSightProductionImport=factory(root.LineSightProduction,root.LineSightTower);
})(typeof self!=='undefined'?self:globalThis,function(P,T){
  'use strict';
  const copy=value=>JSON.parse(JSON.stringify(value));
  const ORIGIN='netsuite-transactions';
  const recordJob=r=>T.job(r.job)||'[No Job: '+T.sku(r.sku)+']';
  const inScope=(r,department)=>!department||r.department===department;
  function keys(records,department){return [...new Set(records.filter(r=>inScope(r,department)).map(r=>P.key(recordJob(r),r.date)))];}
  function project({ledger={},batches=[]},records,{department=T.CFC,priorKeys=[],source='',at=''}={}){
    const warnings=[],errors=[],groups=new Map(),oldGroups=new Map(),affected=new Set();
    let scoped=0,missingJobs=0,negative=0;
    const ids=new Set();
    for(const r of records){
      if(!r||typeof r.id!=='string'||!r.id||ids.has(r.id)||!P.validDate(r.date)||!Number.isFinite(r.qty)||!r.sku){errors.push('Invalid or duplicate ERP completion ID.');continue;}
      ids.add(r.id);if(!inScope(r,department))continue;scoped++;if(!T.job(r.job))missingJobs++;if(r.qty<0)negative++;
      const job=recordJob(r),key=P.key(job,r.date);
      if(!groups.has(key))groups.set(key,{job,date:r.date,qty:0,events:0});
      const g=groups.get(key);g.qty+=r.qty;g.events++;
    }
    for(const [key,entry] of Object.entries(ledger)){
      const job=T.job(entry.job),canonical=P.validDate(entry.date)?P.key(job,entry.date):key;
      if(!oldGroups.has(canonical))oldGroups.set(canonical,[]);
      oldGroups.get(canonical).push({...copy(entry),job});
    }
    const nextBatches=copy(batches).map(r=>{const job=T.job(r.job);return job!==String(r.job||'').trim()?{...r,originalJob:r.originalJob||r.job,job}:{...r,job};});
    const counts=P.matchCounts(nextBatches),out={};
    // Preserve dated legacy batch completions on dates absent from the ERP export.
    for(const r of nextBatches){
      if(!r.job||counts.get(r.job)!==1||[...oldGroups.values()].some(rows=>rows[0].job===r.job))continue;
      const base=P.baseEntries(r,{});
      for(const v of base){if(!P.validDate(v.date))continue;const k=P.key(r.job,v.date);
        if(!oldGroups.has(k))oldGroups.set(k,[{job:r.job,date:v.date,qty:v.qty,mode:'legacy',source:'Saved MPS completion'}]);}
      if(base.some(v=>!v.date&&v.qty!==0)&&[...groups.values()].some(g=>g.job===r.job)){
        warnings.push('Job '+r.job+': dated ERP records replace the previous undated completion total.');
        if(!r.productionBaseline)r.productionBaseline={qty:r.produced||0,date:r.actualDate||null};
      }
    }
    const candidates=new Set([...groups.keys(),...priorKeys]),legacy=new Map();
    for(const [key,rows] of oldGroups){
      const retained={};let observed=false;
      for(const row of rows)for(const [id,qty] of Object.entries(row.legacyRecords||(row.mode==='events'?row.records:{})||{})){
        if(ids.has(id)){observed=true;continue;}
        if(Object.hasOwn(retained,id)&&retained[id]!==qty)errors.push('Conflicting retained legacy Completion ID '+id+'.');
        retained[id]=qty;
      }
      if(Object.keys(retained).length)legacy.set(key,retained);
      if(observed)candidates.add(key);
    }
    // A deliberate department change removes only previously managed ERP totals,
    // never unrelated legacy imports. History remains in each replaced entry.
    for(const [key,rows] of oldGroups)if(rows.some(r=>r.origin===ORIGIN&&r.department!==department))candidates.add(key);
    let changed=0,replaced=0,retained=0;
    for(const [key,rows] of oldGroups){
      if(rows.length>1&&!candidates.has(key)){errors.push('Conflicting legacy Job/day aliases outside the ERP scope: '+rows[0].job+' / '+rows[0].date);continue;}
      out[key]=rows[0];
      if(rows[0].origin===ORIGIN&&rows[0].qty!==0&&!candidates.has(key))retained++;
    }
    for(const key of candidates){
      const group=groups.get(key),oldRows=oldGroups.get(key)||[],old=oldRows[0];
      if(!group&&!old)continue;
      const legacyRecords=old?.origin===ORIGIN&&old.department!==department?{}:legacy.get(key)||{};
      const identity=group||old,qty=(group?.qty??0)+Object.values(legacyRecords).reduce((s,v)=>s+Number(v),0);
      const unchanged=oldRows.length===1&&old.origin===ORIGIN&&old.department===department&&old.qty===qty&&JSON.stringify(old.legacyRecords||{})===JSON.stringify(legacyRecords);
      if(unchanged){out[key]=old;continue;}
      changed++;if(oldRows.length!==1||old.origin!==ORIGIN||old.qty!==qty||old.department!==department)affected.add(identity.job);
      if(oldRows.length){
        replaced++;
        if(oldRows.length>1||old.origin!==ORIGIN)warnings.push('Job '+identity.job+' / '+identity.date+': ERP totals replace overlapping legacy completion data; quantities are not added.');
        else if(old.qty!==qty)warnings.push('Job '+identity.job+' / '+identity.date+': completion changes from '+old.qty+' to '+qty+'.');
        if(old.origin===ORIGIN&&old.department!==department)warnings.push('MPS department changed: previously managed ERP totals outside the new scope are reset.');
      }
      if(qty<0)warnings.push('Job '+identity.job+' / '+identity.date+': negative net production is retained as an ERP correction.');
      const history=oldRows.flatMap(r=>[...(r.history||[]),Object.fromEntries(Object.entries(r).filter(([k])=>k!=='history'))]).slice(-10);
      out[key]={job:identity.job,date:identity.date,qty,mode:'erp',origin:ORIGIN,department,source:'Retained NetSuite transaction store',lastReport:source,importedAt:at,events:group?.events||0,...(Object.keys(legacyRecords).length?{legacyRecords}:{}),...(history.length?{history}:{})};
    }
    for(const r of nextBatches){
      if(r.manualProduction&&affected.has(r.job)){
        warnings.push('Job '+r.job+': ERP updates replace a manual production correction.');
        r.productionCorrectionHistory=[...(r.productionCorrectionHistory||[]),{manualProduction:copy(r.manualProduction),supersededAt:at,source}].slice(-10);
        delete r.manualProduction;
      }
      const ambiguous=r.job&&counts.get(r.job)>1;r.productionIssue=ambiguous?'Duplicate Job no. — actuals are not allocated to multiple batches':'';
      if(!ambiguous){const summary=P.summarize(r,out);if(summary.known){r.produced=summary.produced;r.actualDate=summary.actualDate;r.lastProductionDate=summary.lastProductionDate;r.status=summary.status;}}
    }
    const legacyEvents=Object.values(out).reduce((s,r)=>s+Object.keys(r.legacyRecords||(r.mode==='events'?r.records:{})||{}).filter(id=>!ids.has(id)).length,0);
    return {ledger:out,batches:nextBatches,affected:[...affected],warnings:[...new Set(warnings)],errors:[...new Set(errors)],
      stats:{records:scoped,jobDays:groups.size,changed,replaced,missingJobs,negative,legacyEvents,retainedHistory:retained,unmatched:[...groups.values()].filter(g=>counts.get(g.job)!==1).length}};
  }
  return {ORIGIN,keys,project};
});
