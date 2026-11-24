import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { demoData } from './demo.mjs';
import { createYouTube } from './youtube.mjs';
import { createInnerTube } from './innertube.mjs';
import { Store } from './store.mjs';
import { Semantic,EMBEDDING_MODEL } from './semantic.mjs';
import { Jobs } from './jobs.mjs';
import { normalize,enrichChannel,scoreVideos } from './analysis.mjs';
import { csvCell,keywordRows,keywordCoverage } from './metrics.mjs';
import { Integrations, Research } from './research.mjs';
import { ChannelAnalyses } from './channel-analysis.mjs';
import {KeywordTrends,presentTrendJob} from './keyword-trends.mjs';
import {TopicChannels} from './topic-channels.mjs';
import {DeepResearch} from './deep-research.mjs';
import {workflows,workflowSource,publicWorkflow,getWorkflow} from './deep-workflows.mjs';

const key=process.env.YOUTUBE_API_KEY?.trim();
const presentItem=item=>{const {profile,sampleVideos,...rest}=item;return {...rest,...(sampleVideos?{evidenceVideos:sampleVideos.slice(0,3).map(v=>({id:v.id,title:v.title,url:v.url,format:v.format}))}:{})};};
const presentJob=job=>({...job,profileQuery:undefined,items:job.items.map(presentItem)});
const presentResearch=job=>{if(job.args?.kind==='topic-channels')return job;if(job.args?.kind==='trends')return presentTrendJob(job);const items=job.evidence?.length?keywordRows(job.evidence):job.items;return {...job,items,dataCoverage:keywordCoverage(job.evidence||[],items)};};
async function body(req){let size=0,text='';for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw Object.assign(new Error('Dữ liệu gửi quá lớn.'),{status:413});text+=chunk;}try{return JSON.parse(text||'{}');}catch{throw Object.assign(new Error('JSON không hợp lệ.'),{status:400});}}
export function createApp({live,store=new Store(),semantic=new Semantic(store),providerFactory,deadlineMs,maxRequests,integrations=new Integrations(),researchOptions,channelAnalysisOptions}={}){
  const enabled=live!==null;
  const sourceFactory=providerFactory||async function(provider,context){
    if(!enabled)throw new Error('Nguồn dữ liệu thật đang tắt.');
    if(provider==='official'){if(!key)throw new Error('Chưa cấu hình YouTube Data API key. Hãy chọn nguồn YouTube không cần key.');return createYouTube(key,fetch,context);}
    return createInnerTube(context);
  };
  const jobs=new Jobs(store,{providerFactory:sourceFactory,semantic,deadlineMs,maxRequests});
  const research=new Research(store,integrations,researchOptions);
  const trends=new KeywordTrends(store,integrations,researchOptions);
  const topicChannels=new TopicChannels(store,integrations,researchOptions);
  const channelAnalyses=new ChannelAnalyses(store,integrations,channelAnalysisOptions);
  const deepResearch=new DeepResearch(store,{channelAnalyses,topicChannels,config:integrations,chat:researchOptions?.chat});
  const server=http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    try{
      const url=new URL(req.url,'http://localhost');
      if(['POST','DELETE','PUT'].includes(req.method)){
        const allowed=new Set([`http://127.0.0.1:${server.address()?.port}`,`http://localhost:${server.address()?.port}`]);
        if(req.headers.origin&&!allowed.has(req.headers.origin))return send(403,{error:'Chỉ nhận thao tác từ trang cục bộ này.'});
        if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'Cần Content-Type application/json.'});
      }
      if(url.pathname==='/api/deep-research/workflows'&&req.method==='GET')return send(200,{items:workflows.map(publicWorkflow),source:workflowSource,aiConfigured:true,aiProvider:'ollama',aiModel:integrations.aiProvider==='ollama'?integrations.aiModel:'qwen3:4b',tubeLabConnected:false});
      const workflowPath=url.pathname.match(/^\/api\/deep-research\/workflows\/([a-z-]+)$/);if(workflowPath&&req.method==='GET'){const w=getWorkflow(workflowPath[1]);return send(200,{...publicWorkflow(w),instructions:w.text});}
      if(url.pathname==='/api/deep-research/sources'&&req.method==='GET')return send(200,{items:deepResearch.sources(url.searchParams.get('workflow'))});
      if(url.pathname==='/api/deep-research'){
        if(req.method==='GET')return send(200,{items:store.listDeepResearch().map(j=>({id:j.id,title:j.dataSource?.title||j.args.target,workflow:j.workflow.title,status:j.status,createdAt:j.createdAt}))});
        if(req.method==='POST')return send(202,deepResearch.create(await body(req)));
      }
      const deepPath=url.pathname.match(/^\/api\/deep-research\/([\w-]+)(?:\/(cancel|export|analyze))?$/);if(deepPath){const [,id,action]=deepPath,j=store.getDeepResearch(id);if(!j)return send(404,{error:'Không tìm thấy hồ sơ nghiên cứu.'});if(action==='analyze'&&req.method==='POST')return send(202,deepResearch.analyze(id));if(action==='cancel'&&req.method==='POST')return send(200,deepResearch.cancel(id));if(req.method==='GET'){if(action==='export'){if(url.searchParams.get('format')==='md'){res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="research-${id}.md"`,'Cache-Control':'no-store'});return res.end(deepResearch.markdown(id));}res.setHeader('Content-Disposition',`attachment; filename="research-${id}.json"`);return send(200,deepResearch.package(id));}return send(200,j);}return send(405,{error:'Method not allowed'});}
      if(url.pathname==='/api/channel-analyses'){
        if(req.method==='GET')return send(200,{items:store.listChannelAnalyses().map(j=>({id:j.id,args:j.args,status:j.status,title:j.channel?.title||j.args.seed,count:j.videos.length,createdAt:j.createdAt}))});
        if(req.method==='POST')return send(202,channelAnalyses.create(await body(req)));
      }
      const channelPath=url.pathname.match(/^\/api\/channel-analyses\/([\w-]+)(?:\/(cancel|export|analyze))?$/);
      if(channelPath){const [,id,action]=channelPath,j=store.getChannelAnalysis(id);if(!j)return send(404,{error:'Không tìm thấy phiên phân tích kênh.'});if(action==='analyze'&&req.method==='POST')return send(202,channelAnalyses.reanalyze(id));if(action==='cancel'&&req.method==='POST')return send(200,channelAnalyses.cancel(id));if(req.method==='GET'){if(action==='export')res.setHeader('Content-Disposition',`attachment; filename="nichescope-channel-${id}.json"`);return send(200,j);}return send(405,{error:'Method not allowed'});}
      if(url.pathname==='/api/integrations'){
        if(req.method==='GET')return send(200,integrations.status());
        if(req.method==='POST')return send(200,integrations.configure(await body(req)));
      }
      if(url.pathname==='/api/integrations/check'&&req.method==='POST')return send(200,await integrations.check({factory:researchOptions?.factory,signal:AbortSignal.timeout(60000)}));
      if(url.pathname==='/api/integrations/ollama'&&req.method==='GET'){
        try{const response=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();const data=await response.json();return send(200,{available:true,models:(data.models||[]).map(m=>({name:m.name,size:m.size})),selected:integrations.aiModel});}catch{return send(200,{available:false,models:[],selected:integrations.aiModel,error:'Chưa kết nối được Ollama ở localhost:11434.'});}
      }
      if(url.pathname==='/api/topic-channels'){
        if(req.method==='GET')return send(200,{job:topicChannels.cached(Object.fromEntries(url.searchParams)),activeJob:topicChannels.active?.job.id||null,integration:integrations.status()});
        if(req.method==='POST')return send(202,topicChannels.create(await body(req)));
      }
      if(url.pathname==='/api/keyword-trends'){
        if(req.method==='GET'){const args=Object.fromEntries(url.searchParams);return send(200,{job:trends.cached(args),topics:trends.topics(),activeJob:trends.active?.job.id||null,integration:integrations.status()});}
        if(req.method==='POST')return send(202,presentResearch(trends.create(await body(req))));
      }
      if(url.pathname==='/api/research'){
        if(req.method==='GET')return send(200,{items:store.listResearch().map(presentResearch).map(({id,args,status,createdAt,calls,items})=>({id,args,status,createdAt,calls,count:items.length}))});
        if(req.method==='POST')return send(202,research.create(await body(req)));
      }
      const researchPath=url.pathname.match(/^\/api\/research\/([\w-]+)(?:\/(cancel|export))?$/);
      if(researchPath){const [,id,action]=researchPath;const job=store.getResearch(id);if(!job)return send(404,{error:'Không tìm thấy phiên nghiên cứu.'});if(action==='cancel'&&req.method==='POST')return send(200,presentResearch(job.args.kind==='topic-channels'?topicChannels.cancel(id):job.args.kind==='trends'?trends.cancel(id):research.cancel(id)));if(req.method==='GET'){if(action==='export'){res.setHeader('Content-Disposition',`attachment; filename="nichescope-keywords-${id}.json"`);}return send(200,presentResearch(job));}return send(405,{error:'Method not allowed'});}
      if(req.method==='GET'&&url.pathname==='/api/status')return send(200,{version:'0.3.0',liveAvailable:enabled,defaultMode:enabled?'live':'demo',officialAvailable:Boolean(key),model:{id:EMBEDDING_MODEL,state:semantic.state,error:semantic.error},storage:'sqlite',budgets:{maxRequests:jobs.maxRequests,maxDurationMs:jobs.deadlineMs},activeJob:jobs.active?.job.id||null});
      if(url.pathname==='/api/jobs'&&req.method==='POST'){
        if(!enabled)return send(400,{error:'Nguồn dữ liệu thật đang tắt.'});
        try{return send(202,presentJob(jobs.create(await body(req))));}catch(error){return send(error.status||400,{error:error.message});}
      }
      if(url.pathname==='/api/jobs'&&req.method==='GET')return send(200,{items:store.listJobs().map(job=>({id:job.id,args:job.args,status:job.status,createdAt:job.createdAt,count:job.items.length}))});
      const jobPath=url.pathname.match(/^\/api\/jobs\/([\w-]+)(?:\/(cancel|export))?$/);
      if(jobPath){
        const [,id,action]=jobPath;const job=store.getJob(id);if(!job)return send(404,{error:'Không tìm thấy phiên quét.'});
        if(action==='cancel'&&req.method==='POST')return send(200,presentJob(jobs.cancel(id)));
        if(action==='export'&&req.method==='GET'){
          if(url.searchParams.get('format')==='csv'){
            const fields=job.args.kind==='videos'?['id','title','channelTitle','views','publishedAt','datePrecision','format','vph','recentVph','outlier','outlierSampleSize','url','source','observedAt']:['id','title','subs','views','videos','recentAverageViews','recentMedianViews','recentSampleSize','relevance','rankMethod','country','source','observedAt'];
            res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="nichescope-${id}.csv"`});return res.end('\uFEFF'+[fields.map(csvCell).join(','),...job.items.map(item=>fields.map(field=>csvCell(item[field])).join(','))].join('\r\n'));
          }
          res.setHeader('Content-Disposition',`attachment; filename="nichescope-${id}.json"`);return send(200,presentJob(job));
        }
        if(!action&&req.method==='GET')return send(200,presentJob(job));
        return send(405,{error:'Method not allowed'});
      }
      if(url.pathname==='/api/library'){
        if(req.method==='GET')return send(200,{items:store.library().map(presentItem)});
        if(req.method==='POST'){
          const input=await body(req);const channel=store.getChannel(input.id)||demoData().channels.find(c=>c.id===input.id);if(!channel)return send(404,{error:'Hãy tìm kênh này trước khi lưu.'});store.saveLibrary(channel);return send(200,{items:store.library().map(presentItem)});
        }
        if(req.method==='DELETE'){store.removeLibrary(url.searchParams.get('id')||'');return send(200,{items:store.library().map(presentItem)});}
      }
      if(url.pathname==='/api/history'){
        if(req.method==='GET')return send(200,{items:store.history()});
        if(req.method==='DELETE'){store.clearHistory();return send(200,{items:[]});}
        if(req.method==='POST'){const input=await body(req);if(typeof input.q!=='string'||input.q.length>150||!['channels','videos','similar'].includes(input.page))return send(400,{error:'Phiên tìm không hợp lệ.'});store.addHistory({q:input.q,page:input.page,country:String(input.country||'').slice(0,2),days:String(input.days||0),mode:'demo',at:new Date().toISOString(),count:Math.min(1000,Math.max(0,Number(input.count)||0))});return send(200,{items:store.history()});}
      }
      if(url.pathname==='/api/migrate'&&req.method==='POST'){
        const input=await body(req);for(const item of (Array.isArray(input.library)?input.library:[]).slice(0,200)){const channel=store.getChannel(item.id)||demoData().channels.find(c=>c.id===item.id);if(channel)store.saveLibrary(channel);}return send(200,{items:store.library().map(presentItem)});
      }
      if(req.method!=='GET')return send(405,{error:'Method not allowed'});
      if(url.pathname.startsWith('/api/')){
        const mode=url.searchParams.get('mode')==='live'?'live':'demo';const demo=demoData();
        const q=(url.searchParams.get('q')||'').trim().slice(0,150);const country=url.searchParams.get('country')||'';const days=Number(url.searchParams.get('days')||0);
        if(!['','VN','US','GB','JP','KR'].includes(country)||![0,1,7,30,365].includes(days))return send(400,{error:'Bộ lọc không hợp lệ.'});
        if(url.pathname==='/api/channel'){
          const id=url.searchParams.get('id');
          if(mode==='demo'){const channel=demo.channels.find(c=>c.id===id);if(!channel)return send(404,{error:'Không tìm thấy kênh.'});return send(200,{channel,videos:demo.videos.filter(v=>v.channelId===id),mode:'demo'});}
          if(!enabled)return send(400,{error:'Nguồn dữ liệu thật đang tắt.'});if(!/^UC[\w-]{22}$/.test(id||''))return send(400,{error:'Channel ID không hợp lệ.'});
          let channel=store.getChannel(id);if(channel&&Date.now()-Date.parse(channel.observedAt)<86400000)return send(200,{channel:presentItem(channel),videos:channel.sampleVideos||[],mode:'live',cached:true});
          const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);let requests=0;res.on('close',()=>{if(!res.writableEnded)controller.abort();});
          try{const source=await sourceFactory(url.searchParams.get('provider')||'innertube',{signal:controller.signal,market:country||'US',onRequest:()=>{if(++requests>12)throw new Error('Đã hết ngân sách đọc chi tiết.');}});const detail=await source.detail(id);const videos=scoreVideos(detail.videos).map(v=>store.putVideo(v));channel=enrichChannel(detail.channel,videos);store.putChannel(channel);return send(200,{channel:presentItem(channel),videos,mode:'live'});}finally{clearTimeout(timer);}
        }
        if(mode==='live')return send(enabled?409:400,{error:enabled?'Tìm dữ liệu thật qua POST /api/jobs để có tiến trình và hủy tác vụ.':'Nguồn dữ liệu thật đang tắt.'});
        let items,note='Dữ liệu mẫu giả lập, không phải dữ liệu kênh thực tế.';
        if(url.pathname==='/api/discover'){items=url.searchParams.get('type')==='videos'?demo.videos:demo.channels;}
        else if(url.pathname==='/api/channels'){if(!q)return send(400,{error:'Hãy nhập từ khóa.'});items=demo.channels.filter(c=>normalize(c.title+' '+c.topic).includes(normalize(q)));}
        else if(url.pathname==='/api/videos'){items=demo.videos.filter(v=>!q||normalize(v.title+' '+v.topic).includes(normalize(q)));}
        else if(url.pathname==='/api/similar'){const seed=demo.channels.find(c=>c.id===q||normalize(c.title)===normalize(q));if(!seed)return send(404,{error:'Chế độ mẫu: thử “Bếp Nhỏ Mỗi Ngày”.'});items=demo.channels.filter(c=>c.id!==seed.id&&c.topic===seed.topic&&(!country||c.country===country));return send(200,{items,seed,mode:'demo',note,fetchedAt:new Date().toISOString()});}
        else return send(404,{error:'Không tìm thấy API.'});
        if(country)items=items.filter(c=>(c.country||demo.channels.find(x=>x.id===c.channelId)?.country)===country);if(days&&items[0]?.channelId)items=items.filter(v=>Date.parse(v.publishedAt)>=Date.now()-days*86400000);
        return send(200,{items,mode:'demo',note,fetchedAt:new Date().toISOString()});
      }
      const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/keywords.js':['keywords.js','text/javascript'],'/keyword-ui.js':['keyword-ui.js','text/javascript'],'/channel-ui.js':['channel-ui.js','text/javascript'],'/channel-stats.js':['channel-stats.js','text/javascript'],'/deep-ui.js':['deep-ui.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/metrics.mjs':['metrics.mjs','text/javascript']};const asset=files[url.pathname];if(!asset){res.writeHead(404);return res.end('Not found');}
      const data=await readFile(new URL(asset[0],import.meta.url));res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; img-src 'self' https://i.ytimg.com https://yt3.ggpht.com https://yt3.googleusercontent.com; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(data);
    }catch(error){if(!res.writableEnded)send(error.status||502,{error:error.message||'Có lỗi khi đọc dữ liệu.'});}
  });
  server.deepResearch=deepResearch;server.store=store;server.jobs=jobs;server.semantic=semantic;server.research=research;server.trends=trends;server.topicChannels=topicChannels;server.channelAnalyses=channelAnalyses;server.shutdown=async()=>{await deepResearch.close();await topicChannels.close();await trends.close();await channelAnalyses.close();await research.close();await jobs.close();await semantic.close();await new Promise(resolve=>server.listening?server.close(resolve):resolve());store.close();};return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const server=createApp({store:new Store(resolve('data/nichescope.sqlite'))});const port=Number(process.env.PORT||4173);
  server.on('error',async error=>{console.error(error.code==='EADDRINUSE'?`Cổng ${port} đang được dùng. Dừng bản cũ hoặc đổi PORT trong .env.`:error.message);await server.shutdown();process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>console.log(`NicheScope 0.3.0: http://127.0.0.1:${port}\nNguồn thật: YouTube.js · SQLite · E5 (CPU)`));
  let stopping=false;for(const event of ['SIGINT','SIGTERM'])process.on(event,async()=>{if(stopping)return;stopping=true;await server.shutdown();});
}
