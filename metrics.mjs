export function metrics(channel) {
  const views = nonnegative(channel.views);
  const videos = nonnegative(channel.videos);
  const subs = nonnegative(channel.subs);
  return {
    averageViews: views !== null && videos > 0 ? views / videos : null,
    viewsPerSub: views !== null && subs > 0 ? views / subs : null,
  };
}
export function nonnegative(value){if(value===null||value===undefined||value==='')return null;const n=typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?Number(value):value;return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;}
export function videoMetrics(video, channel, now = Date.now()) {
  const hours = (now - Date.parse(video.publishedAt)) / 3600000;
  const baseline = metrics(channel).averageViews;
  return {
    vph: nonnegative(video.views)!==null && hours > 0 ? nonnegative(video.views) / Math.max(hours, 1) : null,
    outlier: baseline > 0 && nonnegative(video.views)!==null ? nonnegative(video.views) / baseline : null,
  };
}
export function durationSeconds(value = '') {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0) : null;
}
export function csvCell(value) {
  const text = String(value ?? '');
  return '"' + (/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}

// vidIQ returns both global demand and in-country demand. Never mix these with volume scores.
export function keywordRows(evidence,{limit=10000,maxDepth=24}={}){
  const rows=[],seen=new Map();
  const clean=value=>value===null||value===undefined||typeof value==='string'&&/^(null|unknown|n\/a|—|none|)$/i.test(value.trim())?null:typeof value==='number'&&Number.isFinite(value)||typeof value==='string'?value:null;
  const aliases={searchVolume:['monthlySearches','monthly_searches','estimatedMonthlySearch','estimatedMonthlySearches','estimatedSearches','search_volume','searchVolume'],countryVolume:['countryVolume','country_volume'],volumeScore:['volumeScore','volume_score','volume'],competition:['competition','competition_score','competitionScore'],overallScore:['overall_score','overallScore','overall','score'],growthPct:['searchDemandGrowthPct','periodPercentChange'],baselineMonthlySearches30d:['baselineMonthlySearches30d'],metricsAsOf:['metricsAsOf'],relatedScore:['relatedScore']};
  const normalize=key=>key.toLowerCase().replace(/[\s_*-]/g,'');
  function fields(value){const result={},entries=Object.entries(value);for(const [field,keys]of Object.entries(aliases)){result[field]=null;for(const key of keys){const exact=entries.find(([name])=>normalize(name)===normalize(key));const v=clean(exact?.[1]);if(v!==null){result[field]=v;break;}}}return result;}
  function visitText(text,id,context,depth){let parsed;try{parsed=JSON.parse(text);}catch{}if(parsed&&typeof parsed==='object'){visit(parsed,id,context,depth);return;}const lines=text.split('\n');const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());for(let i=0;i<lines.length-2;i++){if(!lines[i].includes('|')||!/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i+1]))continue;const headers=cells(lines[i]).map(h=>h.toLowerCase().replace(/[*_]/g,''));const index=headers.findIndex(h=>/^(keyword|search term|từ khóa)$/i.test(h));if(index<0)continue;for(let j=i+2;j<lines.length&&lines[j].includes('|');j++){const values=cells(lines[j]),providerFields=Object.fromEntries(headers.map((h,k)=>[h,values[k]??null]));const row={...providerFields,keyword:values[index],providerFields};for(let k=0;k<headers.length;k++){if(/monthly searches|estimated searches|searches per month/i.test(headers[k]))row.monthlySearches=values[k];else if(/volume.*score/i.test(headers[k]))row.volumeScore=values[k];}visit(row,id,context,depth+1);}}}
  function visit(value,id,context,depth=0){if(depth>maxDepth||!value||typeof value!=='object')return;if(Array.isArray(value)){for(const v of value)visit(v,id,context,depth+1);return;}
    const keyword=value.keyword??value.search_term??value.searchTerm??value.term;
    if(typeof keyword==='string'&&keyword.length<=250){const key=JSON.stringify([keyword.toLowerCase().trim(),context.country||null,context.mode||null]),metrics=fields(value),previous=seen.get(key);if(previous){for(const field of Object.keys(aliases))if(previous[field]===null&&metrics[field]!==null){previous[field]=metrics[field];previous.metricEvidence[field]=id;}previous.evidenceIds=[...new Set([...previous.evidenceIds,id])];if(!previous.topMarkets.length&&Array.isArray(value.topMarkets))previous.topMarkets=value.topMarkets;}else if(rows.length<limit){const row={keyword,...metrics,country:context.country||null,providerMode:context.mode||null,topMarkets:Array.isArray(value.topMarkets)?value.topMarkets:[],evidenceId:id,evidenceIds:[id],metricEvidence:Object.fromEntries(Object.entries(metrics).filter(([,v])=>v!==null).map(([k])=>[k,id])),raw:value};rows.push(row);seen.set(key,row);}}
    for(const [key,v]of Object.entries(value)){if(key==='text'&&typeof v==='string')visitText(v,id,context,depth+1);else if(typeof v==='object')visit(v,id,context,depth+1);}
  }
  for(const e of evidence){const widget=e.result?._meta?.widgetData||e.result?.structuredContent||{};const context={country:widget.country||e.arguments?.country||null,mode:widget.mode||e.arguments?.mode||null};visit(e.result,e.id,context);}
  return rows;
}
export function keywordCoverage(evidence,rows=keywordRows(evidence)){
  const numericFields=['searchVolume','countryVolume','volumeScore','competition','overallScore','growthPct','baselineMonthlySearches30d','relatedScore'];
  const unparsedEvidence=evidence.filter(e=>!rows.some(r=>(r.evidenceIds||[r.evidenceId]).includes(e.id))).map(e=>e.id);
  return {parsedRows:rows.length,rowLimit:10000,atRowLimit:rows.length>=10000,unparsedEvidence,missingByField:Object.fromEntries(numericFields.map(k=>[k,rows.filter(r=>r[k]===null||r[k]===undefined).length])),note:'Giữ toàn bộ phản hồi gốc. Bảng chỉ chuẩn hóa các trường đã nhận diện; phần không nhận diện xem trong dữ liệu gốc.'};
}
