(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  root.LineSightCalc=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  function finite(value,fallback=0){
    const n=Number(value);
    return Number.isFinite(n)?n:fallback;
  }

  function percent(value,total){
    const denominator=finite(total);
    return denominator===0?0:Math.round(finite(value)/denominator*100);
  }

  function dailyCapacity({rate=0,oee=1,shiftLength=0,activeShifts=0,basis='units'}={}){
    const efficiency=Math.max(0,finite(oee));
    const hours=Math.max(0,finite(shiftLength));
    const shifts=Math.max(0,finite(activeShifts));
    if(basis==='minutes') return Math.round(shifts*hours*60*efficiency);
    return Math.round(Math.max(0,finite(rate))*efficiency*hours*shifts);
  }

  // Contract hours are a weekly figure, so the daily rate depends on how many days
  // a week the site actually runs: a 36 h contract is 7.2 h/day over 5 days but
  // 8 h/day over 4.5 days. standardDays is the site's normal working week.
  function contractDailyHours(contractHours,standardDays){
    const days=Math.max(0,finite(standardDays));
    return Math.max(0,finite(contractHours))/(days>0?days:5);
  }

  function availableLaborHours({operators=0,contractHours=0,absenceRate=0,workingDays=0,standardDays=5}={}){
    const dailyHours=contractDailyHours(contractHours,standardDays);
    const attendance=Math.max(0,1-Math.max(0,finite(absenceRate))/100);
    return Math.round(Math.max(0,finite(operators))*dailyHours*attendance*Math.max(0,finite(workingDays)));
  }

  function operatorsNeeded({requiredHours=0,contractHours=0,absenceRate=0,workingDays=0,standardDays=5}={}){
    const dailyHours=contractDailyHours(contractHours,standardDays);
    const attendance=Math.max(0,1-Math.max(0,finite(absenceRate))/100);
    const availablePerOperator=dailyHours*attendance*Math.max(0,finite(workingDays));
    return availablePerOperator>0?Math.ceil(Math.max(0,finite(requiredHours))/availablePerOperator):0;
  }

  function monthEndCarry({daysInMonth=0,loadsByDay={},dayCapacity=0,isWorkingDay=()=>true}={}){
    let carry=0;
    const capacity=Math.max(0,finite(dayCapacity));
    for(let day=1;day<=Math.max(0,Math.floor(finite(daysInMonth)));day++){
      const load=Math.max(0,finite(loadsByDay[day]));
      carry=Math.max(0,carry+load-(isWorkingDay(day)?capacity:0));
    }
    return carry;
  }

  function basisShortfallToUnits({carry=0,totalLoad=0,totalUnits=0}={}){
    const load=Math.max(0,finite(totalLoad));
    return load>0?Math.max(0,finite(totalUnits))*Math.max(0,finite(carry))/load:0;
  }

  function allocateUnitsByGroup(shortUnits,groupUnits={}){
    const total=Object.values(groupUnits).reduce((sum,value)=>sum+Math.max(0,finite(value)),0);
    if(total<=0) return {};
    const result={};
    Object.entries(groupUnits).forEach(([key,value])=>{
      result[key]=Math.round(Math.max(0,finite(shortUnits))*Math.max(0,finite(value))/total);
    });
    return result;
  }

  function aggregateCompletions(rows=[]){
    const byKey=new Map();
    rows.forEach(row=>{
      const job=String(row&&row.job||'').trim();
      const date=String(row&&row.date||'').trim();
      const qty=Math.max(0,finite(row&&row.qty));
      if(!job||!date||qty<=0) return;
      const key=job+'|'+date;
      const current=byKey.get(key)||{job,date,qty:0,rows:0};
      current.qty+=qty;
      current.rows++;
      byKey.set(key,current);
    });
    return [...byKey.values()];
  }

  function cappedAdherence(rows=[]){
    const planned=rows.reduce((sum,row)=>sum+Math.max(0,finite(row&&row.qty)),0);
    if(planned<=0) return 0;
    const produced=rows.reduce((sum,row)=>{
      const qty=Math.max(0,finite(row&&row.qty));
      return sum+Math.min(qty,Math.max(0,finite(row&&row.produced)));
    },0);
    return percent(produced,planned);
  }

  return {
    percent,
    contractDailyHours,
    dailyCapacity,
    availableLaborHours,
    operatorsNeeded,
    monthEndCarry,
    basisShortfallToUnits,
    allocateUnitsByGroup,
    aggregateCompletions,
    cappedAdherence,
  };
});
