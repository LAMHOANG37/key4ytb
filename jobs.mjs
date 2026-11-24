import { randomUUID } from 'node:crypto';
import { topicTerms,enrichChannel,scoreVideos,rankChannels,contentProfile,lexicalRelevance } from './analysis.mjs';

export function validateSearch(input){
  const kind=['channels','videos','similar'].includes(input.kind)?input.kind:'channels';
  const q=typeof input.q==='string'?input.q.trim():'';
  if(!q||q.length>150)throw new Error('Nhập từ khóa hoặc kênh mẫu từ 1 đến 150 ký tự.');
  const country=input.country||'';if(!['','VN','US','GB','JP','KR'].includes(country))throw new Error('Thị trường không hợp lệ.');
  const days=Number(input.days||0);if(![0,1,7,30,365].includes(days))throw new Error('Khoảng thời gian không hợp lệ.');
  const limit=Number(input.limit??16);if(!Number.isInteger(limit)||limit<4||limit>40)throw new Error('Số kênh phân tích phải từ 4 đến 40.');
  const ranking=input.ranking||'semantic';if(!['semantic','keyword'].includes(ranking))throw new Error('Chế độ xếp hạng không hợp lệ.');
  return {kind,q,country,days,limit,ranking,provider:input.provider==='official'?'official':'innertube',strictCountry:input.strictCountry===true,expand:input.expand!==false};
}

export class Jobs {
  constructor(store,{providerFactory,semantic,maxRequests=100,deadlineMs=240000}={}){this.store=store;this.providerFactory=providerFactory;this.semantic=semantic;this.maxRequests=maxRequests;this.deadlineMs=deadlineMs;this.queue=[];this.active=null;this.closing=false;this.idlePromise=Promise.resolve();}
  create(input){
    if(this.closing)throw new Error('Máy chủ đang dừng.');
    if(this.queue.length>=5)throw new Error('Đã có 5 phiên trong hàng đợi. Hãy đợi hoặc dừng một phiên.');
    const args=validateSearch(input),at=new Date().toISOString();
    const job={id:randomUUID(),status:'queued',createdAt:at,updatedAt:at,args,stage:'Đang chờ',progress:0,requests:0,requestLimit:this.maxRequests,items:[],logs:[],warnings:[],queryTerms:[args.q],mode:'live',source:args.provider==='official'?'youtube-data-api':'youtubei.js'};
    this.store.saveJob(job);this.queue.push(job.id);queueMicrotask(()=>this.pump());return job;
  }
  update(job,patch={}){Object.assign(job,patch,{updatedAt:new Date().toISOString()});this.store.saveJob(job);}
  log(job,message){job.logs.push({at:new Date().toISOString(),message});job.logs=job.logs.slice(-120);this.update(job,{stage:message});}
  cancel(id){
    const job=this.store.getJob(id);if(!job)return null;
    if(['completed','failed','cancelled','interrupted','partial'].includes(job.status))return job;
    if(this.active?.job.id===id){this.active.job.status='cancelling';this.log(this.active.job,'Đang dừng yêu cầu và giữ kết quả đã lấy…');this.active.controller.abort(new Error('Đã hủy theo yêu cầu.'));return this.store.getJob(id);}
    this.queue=this.queue.filter(x=>x!==id);this.update(job,{status:'cancelled',stage:'Đã hủy trước khi quét',finishedAt:new Date().toISOString()});return job;
  }
  pump(){
    if(this.active||this.closing||!this.queue.length)return;
    const id=this.queue.shift(),job=this.store.getJob(id);if(!job||job.status!=='queued'){queueMicrotask(()=>this.pump());return;}
    const controller=new AbortController();this.active={job,controller};
    this.idlePromise=this.run(job,controller).finally(()=>{this.active=null;this.pump();});
  }
  async run(job,controller){
    const timer=setTimeout(()=>controller.abort(new Error('Đã đến thời hạn quét. Kết quả thu thập được được giữ lại.')),this.deadlineMs);
    const signal=controller.signal;
    const context={signal,market:job.args.country||'US',language:job.args.country==='VN'?'vi':'en',maxRequests:this.maxRequests,
      onRequest:()=>{signal.throwIfAborted();if(job.requests>=this.maxRequests)throw new Error('Đã hết ngân sách yêu cầu của phiên quét.');this.update(job,{requests:job.requests+1});},
      log:message=>this.log(job,message)};
    try{
      this.update(job,{status:'running',progress:2});this.log(job,'Đang kết nối nguồn YouTube thật…');
      const provider=await this.providerFactory(job.args.provider,context);signal.throwIfAborted();
      let query=job.args.q, seed=null;
      if(job.args.kind==='similar'){
        this.log(job,'Đang đọc video và chủ đề của kênh mẫu…');
        seed=await provider.resolveChannel(query);if(!seed)throw new Error('Không tìm thấy kênh mẫu.');
        const seedData=await provider.detail(seed.id);signal.throwIfAborted();seed=enrichChannel(seedData.channel,seedData.videos);this.store.putChannel(seed);
        job.seed={id:seed.id,title:seed.title,url:seed.url};
        const terms=topicTerms(seedData.videos.map(v=>v.title).join(' ')+' '+seed.description,8);
        query=terms.slice(0,4).join(' ')||seed.title;job.profileQuery=contentProfile(seed,seedData.videos);
      }
      const candidates=new Map();const videoHits=new Map();
      const queries=[query];
      // Variants come from observed titles, never from a fabricated audience/search-volume model.
      for(let qi=0;qi<queries.length&&qi<3;qi++){
        const term=queries[qi];job.queryTerms=[...queries];this.log(job,`Tìm cả video và kênh cho “${term}”…`);
        const hits=await provider.discover(term,{pages:qi===0?2:1,days:job.args.days,includeChannels:job.args.kind!=='videos'});signal.throwIfAborted();
        for(const hit of hits.channels||[]){if(hit.id===seed?.id)continue;const old=candidates.get(hit.id);candidates.set(hit.id,{...old,...hit,discoveredVia:[...new Set([...(old?.discoveredVia||[]),term])]});}
        for(const video of hits.videos||[]){videoHits.set(video.id,video);if(video.channelId&&video.channelId!==seed?.id){const old=candidates.get(video.channelId);candidates.set(video.channelId,{id:video.channelId,title:video.channelTitle,...old,discoveredVia:[...new Set([...(old?.discoveredVia||[]),term])]});}}
        if(qi===0&&job.args.expand){const phrases=topicTerms([...videoHits.values()].map(v=>v.title).join(' '),12).filter(t=>!topicTerms(query,30).includes(t));for(const t of phrases.slice(0,2))queries.push(`${query} ${t}`.slice(0,150));}
        this.update(job,{candidateCount:candidates.size,progress:10+(qi+1)*8});
      }
      this.log(job,`Đã gom ${candidates.size} kênh duy nhất; chọn tối đa ${job.args.limit} kênh để đọc video.`);
      const ordered=[...candidates.values()].sort((a,b)=>lexicalRelevance(query,b.title+' '+(b.description||''))-lexicalRelevance(query,a.title+' '+(a.description||''))).slice(0,job.args.limit);
      const channels=[];const research=[];let failures=0;
      for(let i=0;i<ordered.length;i++){
        signal.throwIfAborted();const candidate=ordered[i];this.log(job,`Phân tích ${i+1}/${ordered.length}: ${candidate.title||candidate.id}`);
        try{
          const detail=await provider.detail(candidate.id);signal.throwIfAborted();
          const channel=enrichChannel({...detail.channel,discoveredVia:candidate.discoveredVia},detail.videos);
          const scored=scoreVideos(detail.videos).map(v=>this.store.putVideo(v));channel.sampleVideos=scored.slice(0,40);this.store.putChannel(channel);
          if(!job.args.strictCountry||channel.country===job.args.country||!job.args.country){channels.push(channel);research.push(...scored.filter(v=>(!job.args.days||Date.parse(v.publishedAt)>=Date.now()-job.args.days*86400000)&&(job.args.kind!=='videos'||lexicalRelevance(job.args.q,v.title+' '+(v.description||''))>0)));}
          if(job.args.kind==='videos'){job.items=[...new Map(research.map(v=>[v.id,v])).values()].sort((a,b)=>(b.vph??-1)-(a.vph??-1));}
          else job.items=rankChannels(channels,job.profileQuery||job.args.q);
          this.update(job,{progress:35+Math.round((i+1)/Math.max(ordered.length,1)*45),analyzedCount:i+1});
        }catch(error){if(signal.aborted)throw error;failures++;job.warnings.push(`${candidate.title||candidate.id}: ${error.message}`);this.update(job);if(job.requests>=this.maxRequests)break;}
      }
      signal.throwIfAborted();
      if(channels.length&&job.args.kind!=='videos'&&job.args.ranking==='semantic'){
        this.log(job,'Đang xếp hạng nội dung bằng E5 đa ngôn ngữ (lần đầu cần tải model)…');this.update(job,{progress:85});
        try{const scores=await this.semantic.scores(job.profileQuery||job.args.q,channels.map(c=>c.profile),signal);signal.throwIfAborted();job.items=rankChannels(channels,job.profileQuery||job.args.q,scores);job.rankMethod='multilingual-e5-small';}
        catch(error){if(signal.aborted)throw error;job.warnings.push('Xếp hạng ngữ nghĩa chưa sẵn sàng: '+error.message);job.rankMethod='keyword-overlap';job.items=rankChannels(channels,job.profileQuery||job.args.q);}
      }
      if(!job.items.length&&failures)throw new Error('Không đọc được thống kê kênh. '+job.warnings[0]);
      if(job.args.kind!=='videos')for(const channel of job.items)this.store.putChannel(channel);
      this.update(job,{status:failures||job.warnings.length?'partial':'completed',progress:100,stage:`Đã có ${job.items.length} kết quả${failures?' (một số kênh chưa đọc được)':''}`,finishedAt:new Date().toISOString()});
    }catch(error){const cancelled=signal.aborted&&job.status==='cancelling';this.update(job,{status:cancelled?'cancelled':job.items.length?'partial':'failed',error:error.message,stage:cancelled?'Đã dừng; giữ kết quả đã lấy':'Phiên quét kết thúc với giới hạn/lỗi',finishedAt:new Date().toISOString()});}
    finally{clearTimeout(timer);this.store.addHistory({id:job.id,q:job.args.q,page:job.args.kind,mode:'live',country:job.args.country,days:String(job.args.days),at:job.createdAt,count:job.items.length,status:job.status,jobId:job.id});}
  }
  async close(){this.closing=true;this.queue=[];if(this.active)this.active.controller.abort(new Error('Máy chủ đang dừng.'));await this.idlePromise;}
}
