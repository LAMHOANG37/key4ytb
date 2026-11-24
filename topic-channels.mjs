import {enrichChannel} from './analysis.mjs';
import {randomUUID} from 'node:crypto';
import {Vidiq} from './vidiq.mjs';
import {createInnerTube} from './innertube.mjs';
import {matchesSubject} from './keyword-trends.mjs';

export function channelTopicArgs(input={}){
  const q=typeof input.q==='string'?input.q.trim():'';if(!q||q.length>150)throw Object.assign(new Error('Nhập chủ đề kênh từ 1–150 ký tự.'),{status:400});
  const country=String(input.country||'ALL').toUpperCase(),language=String(input.language||'').toLowerCase();
  if(country!=='ALL'&&!/^[A-Z]{2}$/.test(country)||language&&!/^[a-z]{2}$/.test(language))throw Object.assign(new Error('Quốc gia/ngôn ngữ kênh không hợp lệ.'),{status:400});
  // Keep original subject and leave instrumental/music language unrestricted by default.
  const languages=language?[language]:/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệịỉĩọỏốồổỗộớờởỡợụủũứừửữựỳỵỷỹ]/i.test(q)?['vi']:undefined;
  return {kind:'topic-channels',q,country,language,languages,analyze:false,maxCalls:1};
}
export const channelTopicKey=args=>'topic-channels:v2:'+JSON.stringify([args.q.normalize('NFC'),args.country,args.languages||[]]);
export function channelTopicRows(result){
  let rows=result?.structuredContent?.channels||result?._meta?.widgetData?.channels;
  if(!Array.isArray(rows))for(const c of result?.content||[]){if(c.type==='text')try{const data=JSON.parse(c.text);if(Array.isArray(data.channels)){rows=data.channels;break;}}catch{}}
  if(!Array.isArray(rows))throw new Error('Không đọc được danh sách kênh từ vidIQ. Phản hồi gốc vẫn được giữ.');
  const seen=new Set();return rows.filter(c=>/^UC[\w-]{22}$/.test(c.channelId||'')&&!seen.has(c.channelId)&&seen.add(c.channelId)).map(c=>({...c,id:c.channelId,title:c.channelTitle,url:'https://www.youtube.com/channel/'+c.channelId,source:'vidIQ channel_search'}));
}
export class TopicChannels{
  constructor(store,config,{factory=(key,opts)=>new Vidiq(key,opts),channelVerifierFactory=createInnerTube}={}){this.store=store;this.config=config;this.factory=factory;this.channelVerifierFactory=channelVerifierFactory;this.active=null;this.idle=Promise.resolve();}
  cached(input){const args=channelTopicArgs(input),s=this.store.getTrendSnapshot(channelTopicKey(args));return s?{...s,args,cacheHit:true,calls:0}:null;}
  create(input){const args=channelTopicArgs(input);if(!this.config.vidiqKey)throw Object.assign(new Error('Khóa vidIQ mặc định bị thiếu. Cần khôi phục cấu hình backend.'),{status:400});if(this.active)throw Object.assign(new Error('Đang tìm kênh. Hãy đợi hoặc dừng phiên hiện tại.'),{status:409});if(!input.refresh){const cached=this.cached(args);if(cached){cached.id=randomUUID();this.store.saveResearch(cached);return cached;}}
    const at=new Date().toISOString(),job={id:randomUUID(),args,status:'running',stage:'Đang kiểm tra vidIQ và tìm kênh',createdAt:at,updatedAt:at,calls:0,evidence:[],items:[],logs:[],error:null,report:null};const controller=new AbortController();this.active={job,controller};this.update(job);this.idle=this.run(job,controller).finally(()=>this.active=null);return job;}
  update(job,patch={}){Object.assign(job,patch,{updatedAt:new Date().toISOString()});this.store.saveResearch(job);}
  async run(job,controller){let client,providerRead=false;const timer=setTimeout(()=>controller.abort(new Error('Hết thời gian tìm kênh. Kết quả đã đọc được giữ.')),240000);try{
    client=this.factory(this.config.vidiqKey,{signal:controller.signal});const tools=await client.tools();controller.signal.throwIfAborted();const tool=tools.find(t=>/^(vidiq_)?channel_search$/.test(t.name));if(!tool?.inputSchema?.properties?.query)throw new Error('Tài khoản chưa cung cấp công cụ tìm kênh theo chủ đề.');
    this.config.verified=true;this.config.tools=tools;this.config.verifiedAt=new Date().toISOString();this.config.connectionError=null;
    const args={query:job.args.q,sort:'relevance',limit:30,nicheConfidenceMin:.3,...(job.args.languages?{languages:job.args.languages}:{}),...(job.args.country!=='ALL'?{country:[job.args.country]}:{})};
    this.update(job,{calls:1});const result=await client.call(tool.name,args);controller.signal.throwIfAborted();const at=new Date().toISOString();job.evidence=[{id:'E1',source:'vidIQ',tool:tool.name,arguments:args,result,observedAt:at}];
    const rows=channelTopicRows(result);providerRead=true;let requests=0;const source=await this.channelVerifierFactory({signal:controller.signal,market:job.args.country==='ALL'?'US':job.args.country,onRequest:()=>{controller.signal.throwIfAborted();if(++requests>110)throw new Error('Đã đến giới hạn đọc video.');}});
    const candidates=new Map(rows.map(c=>[c.id,c]));const videoCandidates=[];
    // YouTube title hits bring focused creators into the pool even if the vidIQ niche index misses them.
    if(!job.args.languages)try{const hits=await source.discover(job.args.q,{pages:1,includeChannels:false});for(const v of hits.videos||[])if(v.channelId&&matchesSubject(job.args.q,v.title)){
      videoCandidates.push(v.channelId);if(!candidates.has(v.channelId))candidates.set(v.channelId,{id:v.channelId,title:v.channelTitle,channelId:v.channelId,url:'https://www.youtube.com/channel/'+v.channelId,source:'YouTube search + metadata',score:null});
    }}catch(e){controller.signal.throwIfAborted();job.verificationWarnings=[e.message];}
    const ordered=[...new Set([...videoCandidates,...candidates.keys()])].map(id=>candidates.get(id)).filter(c=>(job.args.country==='ALL'||!c.country||c.country===job.args.country)&&(!job.args.languages||job.args.languages.some(lang=>(Array.isArray(c.languages)?c.languages:String(c.languages||'').split(/[\s,;]+/)).includes(lang)))).slice(0,16);
    job.coverage={sourceRows:rows.length,candidateRows:candidates.size,checkedChannels:0,failedChannels:0,matchedRows:0,note:'Đối chiếu mẫu video công khai theo tiêu đề/tag, ưu tiên tỷ lệ video khớp chủ đề. Quốc gia là nơi đặt kênh. 4K trong tiêu đề/tag chưa xác minh độ phân giải tệp.'};this.update(job);
    for(const c of ordered){controller.signal.throwIfAborted();if(requests>=110)break;try{const data=await source.detail(c.id);const videos=[...new Map((data.videos||[]).filter(v=>v.id).map(v=>[v.id,v])).values()];const matched=videos.filter(v=>matchesSubject(job.args.q,[v.title,...(v.tags||[])].join(' ')));job.coverage.checkedChannels++;
      if((job.args.country==='ALL'||(data.channel.country||c.country)===job.args.country)&&matched.length>=Math.min(2,Math.max(1,videos.length))){job.items.push({...c,...enrichChannel(data.channel,videos),title:data.channel.title||c.title,description:data.channel.description||c.description,subscriberCount:c.subscriberCount??data.channel.subs,videoCount:c.videoCount??data.channel.videos,country:data.channel.country||c.country,matchedVideoCount:matched.length,sampleVideoCount:videos.length,topicCoverage:matched.length/videos.length,evidenceVideos:matched.slice(0,3).map(v=>({id:v.id,title:v.title,url:'https://www.youtube.com/watch?v='+v.id}))});job.items.sort((a,b)=>b.topicCoverage-a.topicCoverage||b.matchedVideoCount-a.matchedVideoCount||(b.score||0)-(a.score||0));}
    }catch(e){controller.signal.throwIfAborted();job.coverage.failedChannels++;}job.coverage.matchedRows=job.items.length;this.update(job,{stage:`Đã đối chiếu ${job.coverage.checkedChannels} kênh`,requests});}
    const finishedAt=new Date().toISOString();this.update(job,{status:job.coverage.failedChannels?'partial':'completed',stage:'Đã đối chiếu video và tìm kênh',observedAt:at,finishedAt});this.store.saveTrendSnapshot(channelTopicKey(job.args),job);
  }catch(e){if(!controller.signal.aborted&&!providerRead){this.config.verified=false;this.config.connectionError=e.message;}this.update(job,{status:controller.signal.aborted?'cancelled':job.items.length?'partial':'failed',error:controller.signal.aborted?controller.signal.reason?.message:e.message,finishedAt:new Date().toISOString()});}finally{clearTimeout(timer);await client?.close?.();}}
  cancel(id){if(this.active?.job.id===id){this.active.controller.abort(new Error('Đã dừng tìm kênh.'));return this.active.job;}return this.store.getResearch(id);}
  async close(){this.active?.controller.abort(new Error('Máy chủ đang dừng.'));await this.idle;}
}
