'use strict';
importScripts('../vendor/xlsx.full.min.js','control-tower.js?v=20261118-3');
self.onmessage=async function(event){
  try{
    const {file,kind}=event.data;
    if(file.size>100*1024*1024)throw Error('This import is limited to 100 MB. Split the ERP export into smaller date ranges.');
    self.postMessage({progress:'Reading '+file.name+'…'});
    const bytes=await file.arrayBuffer();
    const workbook=XLSX.read(bytes,{type:'array',cellDates:false,cellFormula:false,cellHTML:false});
    if(!workbook.SheetNames.length)throw Error('Workbook has no worksheets.');
    self.postMessage({progress:'Validating '+file.name+'…'});
    const matrix=XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]],{header:1,defval:null,raw:true});
    const parse={master:LineSightTower.master,stock:LineSightTower.stock,transactions:LineSightTower.transactions}[kind];
    if(!parse)throw Error('Unsupported import.');
    self.postMessage({result:parse(matrix)});
  }catch(error){self.postMessage({error:error.message||'Could not read this file.'});}
};
