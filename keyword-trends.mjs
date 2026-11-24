import {randomUUID} from 'node:crypto';
import {Vidiq} from './vidiq.mjs';
import {keywordRows} from './metrics.mjs';
import {normalize} from './analysis.mjs';

// A free-text subject is an explicit word constraint, not a broad music/category hint.
// Joining words also accepts spacing variants such as "deep house" / "deephouse".
export function matchesSubject(subject,keyword){
  const words=s=>normalize(s).match(/[\p{L}\p{N}]+/gu)||[];
  const query=words(subject),candidate=words(keyword),compact=candidate.join('');
  return query.length>0&&query.every(w=>/\d/.test(w)?candidate.includes(w):w.length<4?candidate.includes(w):compact.includes(w));
}

const invalid=message=>{throw Object.assign(new Error(message),{status:400});};
export function trendArgs(input={}){
  const country=String(input.country||'VN').toUpperCase();
  if(country!=='ALL'&&!/^[A-Z]{2}$/.test(country))invalid('Chọn quốc gia hợp lệ.');
  const period=input.period||'week';if(!['day','week','month'].includes(period))invalid('Khoảng thời gian không hợp lệ.');
  const topic=String(input.topic||'').trim(),niche=String(input.niche||'').trim();
  if(topic.length>150||niche.length>150||topic&&niche)invalid('Chọn một chủ đề hoặc nhập chủ đề riêng, tối đa 150 ký tự.');
  return {kind:'trends',country,period,topic,niche,q:niche||topic||'Tất cả chủ đề',analyze:false,maxCalls:1};
}
export const trendCacheKey=args=>'keyword-trends:'+JSON.stringify([args.period,args.topic,args.niche,...(args.niche?['subject-v2']:[])]);
export function presentTrendJob(job){
  const rows=keywordRows(job.evidence||[]).filter(r=>typeof r.growthPct==='number'&&r.growthPct>0);
  const relevant=rows.filter(r=>!job.args.niche||matchesSubject(job.args.niche,r.keyword));
  const items=relevant.filter(r=>job.args.country==='ALL'||r.topMarkets.some(m=>m.country?.toUpperCase()===job.args.country)).sort((a,b)=>b.growthPct-a.growthPct);
  const note=(job.args.niche?'Chỉ giữ từ khóa khớp các từ trong chủ đề bạn nhập. ':'')+(job.args.country==='ALL'?'Mức tăng nhu cầu tìm kiếm toàn cầu.':'Quốc gia được lọc theo thị trường từ khóa; mức tăng và lượng tìm kiếm là toàn cầu.');
  return {...job,items,coverage:{sourceRows:rows.length,subjectRows:relevant.length,excludedOffSubject:rows.length-relevant.length,matchedRows:items.length,country:job.args.country,scope:'global-growth-top-markets',note}};
}
export class KeywordTrends{
  constructor(store,config,{factory=(key,opts)=>new Vidiq(key,opts)}={}){this.store=store;this.config=config;this.factory=factory;this.active=null;this.idle=Promise.resolve();}
  snapshot(args){return this.store.getTrendSnapshot(trendCacheKey(args));}
  topics(){const topics=new Set();for(const s of this.store.listTrendSnapshots())for(const t of s.result?._meta?.widgetData?.availableTopics||[])if(typeof t==='string')topics.add(t);return [...topics].sort();}
  cached(input){const args=trendArgs(input),snapshot=this.snapshot(args);if(!snapshot)return null;const stamp=new Date().toISOString();return presentTrendJob({id:snapshot.id,args,status:'completed',stage:'Đã có từ khóa',createdAt:snapshot.observedAt,updatedAt:stamp,finishedAt:stamp,observedAt:snapshot.observedAt,calls:0,cacheHit:true,evidence:[{id:'E1',source:'vidIQ',tool:snapshot.tool,arguments:snapshot.arguments,observedAt:snapshot.observedAt,result:snapshot.result}],logs:[],report:null,error:null});}
  create(input){
    const args=trendArgs(input);
    if(!this.config.vidiqKey)invalid('Khóa vidIQ bị thiếu. Khóa mặc định chưa được nạp; cần khôi phục cấu hình backend.');
    if(args.topic&&!this.topics().includes(args.topic))invalid('Chủ đề này chưa có trong danh mục vidIQ. Hãy nhập ở ô chủ đề riêng.');
    if(!input.refresh){const cached=this.cached(args);if(cached){cached.id=randomUUID();this.store.saveResearch(cached);return cached;}}
    if(this.active)throw Object.assign(new Error('Đang cập nhật từ khóa. Hãy đợi hoặc dừng phiên hiện tại.'),{status:409});
    const stamp=new Date().toISOString(),job={id:randomUUID(),args,status:'running',stage:'Đang lấy từ khóa',createdAt:stamp,updatedAt:stamp,calls:0,evidence:[],items:[],logs:[],report:null,error:null};
    const controller=new AbortController();this.active={job,controller};this.update(job);this.idle=this.run(job,controller).finally(()=>this.active=null);return job;
  }
  update(job,patch={}){Object.assign(job,patch,{updatedAt:new Date().toISOString()});this.store.saveResearch(job);}
  async run(job,controller){let client;const timer=setTimeout(()=>controller.abort(new Error('vidIQ phản hồi quá lâu. Thử cập nhật lại sau.')),90000);try{
    client=this.factory(this.config.vidiqKey,{signal:controller.signal});const tools=await client.tools();controller.signal.throwIfAborted();const tool=tools.find(t=>/(^|_)keyword_research$/.test(t.name));
    if(!tool?.inputSchema?.properties?.mode?.enum?.includes('rising'))throw new Error('Tài khoản vidIQ chưa cung cấp dữ liệu từ khóa đang tăng.');
    const args={mode:'rising',language:'all',period:job.args.period,sort:job.args.niche?'relevance':'growth',limit:job.args.niche?100:1000,...(job.args.topic?{topic:job.args.topic}:{}),...(job.args.niche?{niche:job.args.niche}:{})};
    this.update(job,{calls:1});const result=await client.call(tool.name,args);controller.signal.throwIfAborted();
    const observedAt=new Date().toISOString();job.evidence=[{id:'E1',source:'vidIQ',tool:tool.name,arguments:args,observedAt,result}];
    // Fail explicitly if an upstream shape changes; never replace missing data with invented rows.
    if(!Array.isArray(result?._meta?.widgetData?.risingKeywords))throw new Error('vidIQ trả định dạng xu hướng chưa đọc được. Đã giữ dữ liệu cũ; chưa cập nhật bảng.');
    const snapshot={id:job.id,tool:tool.name,arguments:args,result,observedAt};
    this.store.saveTrendSnapshot(trendCacheKey(job.args),snapshot);
    this.config.verified=true;this.config.tools=tools;this.config.verifiedAt=observedAt;this.config.connectionError=null;
    this.update(job,{observedAt,status:'completed',stage:'Đã có từ khóa',finishedAt:observedAt,items:presentTrendJob(job).items});
  }catch(e){if(!controller.signal.aborted){this.config.verified=false;this.config.connectionError=e.message;}this.update(job,{status:controller.signal.aborted?'cancelled':'failed',error:controller.signal.aborted?controller.signal.reason?.message:e.message,finishedAt:new Date().toISOString()});}finally{clearTimeout(timer);await client?.close?.();}}
  cancel(id){if(this.active?.job.id===id){this.active.controller.abort(new Error('Đã dừng cập nhật.'));return this.active.job;}return this.store.getResearch(id);}
  async close(){this.active?.controller.abort(new Error('Máy chủ đang dừng.'));await this.idle;}
}
