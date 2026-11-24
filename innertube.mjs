import { Innertube,Log } from 'youtubei.js';
import { metrics,nonnegative } from './metrics.mjs';
Log.setLevel(Log.Level.ERROR);

export function normalizeChannelLink(seed){
  let value=String(seed??'').replace(/[\u200B-\u200F\u2060\uFEFF]/g,'').trim();
  if(/^UC[\w-]{22}$/.test(value))return value;
  if(value.startsWith('@'))value='https://www.youtube.com/'+value;
  if(/^(?:(?:www|m|music)\.)?youtube\.com\//i.test(value))value='https://'+value;
  let url;try{url=new URL(value);}catch{throw new Error('Nhập link kênh YouTube, @handle hoặc Channel ID.');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.port||!['www.youtube.com','youtube.com','m.youtube.com','music.youtube.com'].includes(url.hostname))throw new Error('Chỉ nhận link kênh youtube.com.');
  const parts=url.pathname.split('/').filter(Boolean);
  const tabs=['featured','videos','shorts','streams','live','playlists','community','about','posts','podcasts','search'];
  let baseLength=0;
  if(/^@[^\s/?#]+$/.test(parts[0]||''))baseLength=1;
  else if(parts[0]==='channel'&&/^UC[\w-]{22}$/.test(parts[1]||''))baseLength=2;
  else if(['c','user'].includes(parts[0])&&parts[1])baseLength=2;
  if(!baseLength||parts.length>baseLength+1||(parts.length>baseLength&&!tabs.includes(parts[baseLength])))throw new Error('Đây chưa phải link kênh. Mở trang kênh và sao chép link, không dùng link video/Shorts.');
  return 'https://www.youtube.com/'+parts.slice(0,baseLength).join('/');
}

export const text = value => typeof value==='string'?value:value?.toString?.() && value.toString()!=='[object Object]'?value.toString():'';
export function parseCount(value){
  if(typeof value==='number')return Number.isFinite(value)&&value>=0?value:null;
  const raw=text(value).trim();if(!raw)return null;
  if(/^no views$/i.test(raw))return 0;
  const match=raw.replaceAll(',','').match(/(?:^|\s)(\d+(?:\.\d+)?)\s*([KMB])?(?=\s|$)/i);
  if(!match)return null;return Number(match[1])*({k:1e3,m:1e6,b:1e9}[match[2]?.toLowerCase()]||1);
}
export function parsePublished(value,now=Date.now()){
  const raw=text(value).replace(/^(streamed|premiered)\s+/i,'').trim();
  if(!raw)return null;
  const match=raw.match(/^(\d+)\s+(second|minute|hour|day|week|month|year)s? ago$/i);
  if(match){const units={second:1000,minute:60000,hour:3600000,day:86400000,week:604800000,month:2629800000,year:31557600000};return new Date(now-Number(match[1])*units[match[2].toLowerCase()]).toISOString();}
  const exact=Date.parse(raw.replace(/^Joined\s+/i,''));return Number.isFinite(exact)?new Date(exact).toISOString():null;
}
const COUNTRIES={'United States':'US','United Kingdom':'GB','Vietnam':'VN','Viet Nam':'VN','Japan':'JP','South Korea':'KR','Korea, Republic of':'KR','Canada':'CA','Australia':'AU','India':'IN','Indonesia':'ID','Philippines':'PH','Thailand':'TH','Germany':'DE','France':'FR','Brazil':'BR'};
const regionNames=new Intl.DisplayNames(['en'],{type:'region'});
for(let a=65;a<=90;a++)for(let b=65;b<=90;b++){const code=String.fromCharCode(a,b),name=regionNames.of(code);if(name&&name!==code&&!COUNTRIES[name])COUNTRIES[name]=code;}
export const countryCode=label=>COUNTRIES[text(label)]||null;
function thumb(images){return Array.isArray(images)?images.find(i=>i.width>=200)?.url||images[0]?.url||null:null;}
function metaParts(node){return (node.metadata?.metadata?.metadata_rows||[]).flatMap(row=>(row.metadata_parts||[]).map(part=>part.text));}
export function publicVideoTags(html){const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(x[0-9a-f]+|\d+);/gi,(m,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code<=0x10ffff?String.fromCodePoint(code):m;});const tags=[];for(const m of html.matchAll(/<meta\b[^>]*>/gi)){const attrs=Object.fromEntries([...m[0].matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)].map(a=>[a[1].toLowerCase(),a[3]]));if(attrs.property==='og:video:tag'&&attrs.content)tags.push(decode(attrs.content));}return tags.length?[...new Set(tags)]:null;}
export function normalizeVideo(node,owner=null,format='unknown',now=Date.now()){
  const parts=metaParts(node);const labels=parts.map(text);
  const id=node.video_id||node.content_id||node.id||node.on_tap_endpoint?.payload?.videoId;
  if(!/^[\w-]{11}$/.test(id||''))return null;
  const dateText=text(node.published)||labels.find(s=>/ago$|^Streamed|^Premiered/i.test(s))||'';
  const viewText=text(node.view_count)||text(node.short_view_count)||text(node.overlay_metadata?.secondary_text)||labels.find(s=>/views?$|^No views$/i.test(s))||'';
  const title=text(node.title)||text(node.metadata?.title)||text(node.overlay_metadata?.primary_text);
  const authorId=owner?.id||node.author?.id||parts.map(p=>p?.endpoint?.payload?.browseId).find(Boolean);
  const inferredFormat=/ShortsLockup|ReelItem/.test(node.type)?'short':node.content_type==='SHORT'?'short':format;
  const duration=node.duration?.seconds;
  return {id,title,channelId:authorId||null,channelTitle:owner?.title||text(node.author?.name)||'',
    description:text(node.description_snippet)||text(node.description)||'',views:parseCount(viewText),viewCountText:viewText,
    publishedAt:parsePublished(dateText,now),publishedText:dateText,datePrecision:/ago$/i.test(dateText)?'relative-estimate':dateText?'date':'unknown',
    duration:Number.isFinite(duration)&&duration>0?duration:null,format:inferredFormat,
    thumbnail:thumb(node.thumbnails||node.thumbnail||node.content_image?.image),url:`https://www.youtube.com/watch?v=${id}`,
    source:'youtubei.js',observedAt:new Date(now).toISOString(),demo:false};
}
export async function createInnerTube(context={}){
  const {signal,onRequest=()=>{},market='US'}=context;
  let lastRequest=0;
  const sourceFetch=async(url,options={})=>{
    signal?.throwIfAborted();onRequest();
    const delay=Math.max(0,100-(Date.now()-lastRequest));if(delay)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},delay);const abort=()=>{clearTimeout(timer);reject(signal.reason);};signal?.addEventListener('abort',abort,{once:true});});
    signal?.throwIfAborted();lastRequest=Date.now();
    try{const response=await fetch(url,{...options,signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(15000)])});if(!response.ok)throw new Error(`YouTube phản hồi HTTP ${response.status}.`);return response;}
    catch(error){if(signal?.aborted)throw signal.reason;throw new Error(error.message.startsWith('YouTube')?error.message:'Không đọc được dữ liệu YouTube. Kiểm tra mạng hoặc thử lại sau.');}
  };
  // English renderer text has a single parsed representation; query text can remain Vietnamese.
  const yt=await Innertube.create({lang:'en',location:market,retrieve_player:false,generate_session_locally:true,enable_session_cache:false,fetch:sourceFetch});
  async function discover(query,{pages=1,days=0,includeChannels=true}={}){
    const channels=new Map(),videos=new Map();
    for(const type of includeChannels?['channel','video']:['video']){
      const upload_date=type==='video'?({1:'today',7:'week',30:'month',365:'year'}[days]||'all'):'all';
      let feed=await yt.search(query,{type,upload_date});
      for(let p=0;p<pages;p++){
        signal?.throwIfAborted();
        for(const c of feed.channels||[]){const id=c.id||c.author?.id;if(/^UC[\w-]{22}$/.test(id||''))channels.set(id,{id,title:text(c.author?.name),description:text(c.description_snippet)});}
        for(const n of feed.videos||[]){const v=normalizeVideo(n);if(v)videos.set(v.id,v);}
        if(p+1>=pages||!feed.has_continuation)break;feed=await feed.getContinuation();
      }
    }
    return {channels:[...channels.values()],videos:[...videos.values()]};
  }
  async function resolveChannel(seed){
    const value=normalizeChannelLink(seed);
    if(/^UC[\w-]{22}$/.test(value))return {id:value};
    const match=new URL(value).pathname.match(/^\/channel\/(UC[\w-]{22})$/);if(match)return{id:match[1]};
    const endpoint=await yt.resolveURL(value);const id=endpoint.payload?.browseId;if(!/^UC[\w-]{22}$/.test(id||''))throw new Error('YouTube chưa trả Channel ID cho link này. Hãy thử link @handle trên trang chủ kênh.');return{id};
  }
  async function detail(id,{includeVideos=true}={}){
    if(!/^UC[\w-]{22}$/.test(id))throw new Error('Channel ID không hợp lệ.');
    const ch=await yt.getChannel(id);signal?.throwIfAborted();
    const aboutNode=await ch.getAbout();const about=aboutNode.metadata||aboutNode;
    const title=ch.metadata?.title||text(about.name)||ch.header?.page_title;
    if(!title)throw new Error('Không đọc được thông tin kênh từ định dạng YouTube hiện tại.');
    const item={id,title,description:text(about.description)||ch.metadata?.description||'',thumbnail:thumb(ch.metadata?.avatar||ch.metadata?.thumbnail),
      country:countryCode(about.country),countryLabel:text(about.country)||null,
      publishedAt:parsePublished(about.joined_date),subs:parseCount(about.subscriber_count||ch.header?.subscriber_count),
      views:parseCount(about.view_count),videos:parseCount(about.video_count||ch.header?.videos_count),
      subscriberCountText:text(about.subscriber_count),url:`https://www.youtube.com/channel/${id}`,source:'youtubei.js',demo:false,observedAt:new Date().toISOString(),formatSampling:'separate-tabs'};
    const channel={...item,...metrics(item)};
    const videos=[];
    if(!includeVideos)return {channel,videos};
    if(ch.has_videos){const feed=await ch.getVideos();for(const n of feed.videos.slice(0,20)){const v=normalizeVideo(n,channel,'long');if(v)videos.push(v);}}
    if(ch.has_shorts){const feed=await ch.getShorts();for(const n of feed.videos.slice(0,10)){const v=normalizeVideo(n,channel,'short');if(v)videos.push(v);}}
    return {channel,videos:[...new Map(videos.map(v=>[v.id,v])).values()]};
  }
  async function inspectChannel(seed,{maxVideos=100,onProgress=()=>{},onVideo=()=>{}}={}){
    const {id}=await resolveChannel(seed),ch=await yt.getChannel(id);
    const {channel}=await detail(id,{includeVideos:false});
    const raw=ch.metadata?.keywords;
    channel.channelKeywordsRaw=raw??null;
    channel.channelKeywords=Array.isArray(raw)?raw.filter(s=>typeof s==='string'):typeof raw==='string'?(raw.includes(',')&&!raw.includes('"')?raw.split(',').map(s=>s.trim()).filter(Boolean):[...raw.matchAll(/"([^"]+)"|([^\s"]+)/g)].map(m=>m[1]||m[2])):null;
    channel.channelKeywordsSource='YouTube channel metadata.keywords';
    const tabs=[['long','has_videos','getVideos'],['short','has_shorts','getShorts'],['stream','has_live_streams','getLiveStreams']];
    const available=tabs.filter(([,flag])=>ch[flag]);const quota=Math.max(1,Math.floor(maxVideos/Math.max(available.length,1)));
    const coverage={tabs:[],listingComplete:false,metadataRead:0,metadataFailed:0,limit:maxVideos,perTabLimit:quota};
    const collected=new Map();
    onProgress({channel,coverage,stage:'Đã đọc thông tin kênh'});
    for(const [format,flag,method]of tabs){
      const tab={format,pages:0,collected:0,status:ch[flag]?'running':'absent'};coverage.tabs.push(tab);
      if(!ch[flag])continue;
      let feed;
      try{feed=await ch[method]();
        for(let page=0;page<100;page++){
          signal?.throwIfAborted();tab.pages++;let overflow=false;
          for(const node of feed.videos||[]){const listed=normalizeVideo(node,channel,format);if(!listed||collected.has(listed.id))continue;if(tab.collected>=quota||collected.size>=maxVideos){overflow=true;break;}
            let video={...listed,tags:null,metadataStatus:'pending'};
            try{const info=await yt.getBasicInfo(listed.id);const b=info.basic_info||{};if(b.channel_id&&b.channel_id!==id)throw new Error('Video không thuộc kênh đang quét.');if(!b.id||!b.title)throw new Error('Nguồn chưa trả metadata video.');
              const date=b.publish_date||b.upload_date;const parsed=typeof date==='string'||date instanceof Date?Date.parse(date):NaN;
              video={...video,title:b.title,description:b.short_description??listed.description,tags:Array.isArray(b.keywords)?b.keywords:Array.isArray(b.tags)?b.tags:null,views:nonnegative(b.view_count)??listed.views,duration:nonnegative(b.duration)??listed.duration,publishedAt:Number.isFinite(parsed)?new Date(parsed).toISOString():listed.publishedAt,datePrecision:Number.isFinite(parsed)?'source-date':listed.datePrecision,thumbnail:thumb(b.thumbnail)||listed.thumbnail,metadataStatus:'read',metadataSource:'YouTube player.videoDetails',metadataRaw:JSON.parse(JSON.stringify(b)),isLive:b.is_live??null,category:b.category??null};coverage.metadataRead++;
            }catch(error){if(signal?.aborted)throw error;video.metadataStatus='failed';video.metadataError=error.message;coverage.metadataFailed++;}
            if(video.tags===null){try{const response=await sourceFetch(`https://www.youtube.com/watch?v=${video.id}`);const html=await response.text();if(html.length>4*1024*1024)throw new Error('Trang metadata vượt giới hạn.');const tags=publicVideoTags(html);if(tags){video.tags=tags;video.tagsSource='YouTube public watch og:video:tag';}}catch(error){if(signal?.aborted)throw error;video.tagsError=error.message;}}
            if(video.tags&&!video.tagsSource)video.tagsSource='YouTube player.videoDetails.keywords';
            collected.set(video.id,video);tab.collected++;await onVideo(video);onProgress({channel,coverage,stage:`Đã đọc ${collected.size} video · ${format}`});
          }
          if(overflow){tab.status='limited';break;}
          if(!feed.has_continuation){tab.status='complete';break;}
          if(tab.collected>=quota||collected.size>=maxVideos){tab.status='limited';break;}
          feed=await feed.getContinuation();
          if(page===99)tab.status='limited';
        }
      }catch(error){if(signal?.aborted)throw error;tab.status='error';tab.error=error.message;}
    }
    coverage.listingComplete=coverage.tabs.every(t=>['complete','absent'].includes(t.status));
    return {channel,videos:[...collected.values()],coverage};
  }
  return {discover,resolveChannel,detail,inspectChannel,source:'youtubei.js'};
}
