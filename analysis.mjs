export const normalize = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replaceAll('đ','d');
const STOP = new Set('the and for with from this that your you are how what why into video videos channel official shorts subscribe một những các của và với cho trong trên khi là thì về được không tôi bạn chúng mình hướng dẫn cách'.split(' ').map(normalize));
export const tokens = text => (normalize(text).match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>w.length>1&&!STOP.has(w)&&!/^\d+$/.test(w));
export function topicTerms(text,limit=5){const counts=new Map();const words=tokens(text);for(const word of words)counts.set(word,(counts.get(word)||0)+1);return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([word])=>word);}
export const mean = numbers => numbers.length?numbers.reduce((a,b)=>a+b,0)/numbers.length:null;
export function median(numbers){if(!numbers.length)return null;const sorted=[...numbers].sort((a,b)=>a-b);const n=sorted.length;return n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2;}
export function cosine(a,b){if(a.length!==b.length||!a.length)return 0;let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
export function lexicalRelevance(query,text){const q=new Set(tokens(query)), words=new Set(tokens(text));if(!q.size)return 0;return [...q].filter(w=>words.has(w)).length/q.size;}
export function contentProfile(channel,videos){return `${channel.title}. ${(channel.description||'').slice(0,600)}. ${videos.slice(0,20).map(v=>v.title).join('. ')}`.slice(0,6000);}
export function enrichChannel(channel,videos,now=Date.now()){
  const valid=videos.filter(v=>Number.isFinite(v.views)&&Number.isFinite(Date.parse(v.publishedAt))&&Date.parse(v.publishedAt)<=now);
  const latest=[...valid].sort((a,b)=>(Date.parse(b.publishedAt)||0)-(Date.parse(a.publishedAt)||0)).slice(0,10);
  const dated=videos.filter(v=>Number.isFinite(Date.parse(v.publishedAt))&&Date.parse(v.publishedAt)<=now).sort((a,b)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt));
  const ages=dated.map(v=>(now-Date.parse(v.publishedAt))/86400000).filter(d=>d>=0);
  const coveredDays=ages.length?Math.min(30,Math.max(...ages)):null;
  const inWindow=ages.filter(d=>d<=30).length;
  const classified=videos.filter(v=>v.format==='short'||v.format==='long');
  return {...channel, recentAverageViews:mean(latest.map(v=>v.views)),recentMedianViews:median(latest.map(v=>v.views)),recentSampleSize:latest.length,
    latestUpload:dated[0]?.publishedAt||null,daysSinceUpload:dated.length?Math.max(0,(now-Date.parse(dated[0].publishedAt))/86400000):null,
    uploadFrequency:coveredDays>=1?inWindow/coveredDays:null,frequencyWindowDays:coveredDays,frequencySampleSize:inWindow,
    shortsPct:channel.formatSampling==='separate-tabs'?null:classified.length?100*classified.filter(v=>v.format==='short').length/classified.length:null,formatSampleSize:classified.length,
    formatSampleCounts:{long:classified.filter(v=>v.format==='long').length,short:classified.filter(v=>v.format==='short').length},
    sampleVideos:videos.slice(0,40),profile:contentProfile(channel,videos),observedAt:channel.observedAt||new Date(now).toISOString()};
}
export function scoreVideos(videos,now=Date.now()){
  return videos.map(video=>{
    const peers=videos.filter(v=>v.id!==video.id&&v.format===video.format&&Number.isFinite(v.views)&&Number.isFinite(Date.parse(v.publishedAt))&&now-Date.parse(v.publishedAt)>=2*86400000);
    const baseline=median(peers.map(v=>v.views));const hours=(now-Date.parse(video.publishedAt))/3600000;
    const vph=Number.isFinite(video.views)&&hours>0?video.views/Math.max(hours,1):null;
    return {...video,vph,lifetimeAverageVph:vph,outlier:['short','long'].includes(video.format)&&peers.length>=3&&baseline>0&&Number.isFinite(video.views)?video.views/baseline:null,
    outlierBaseline:baseline,outlierSampleSize:peers.length,outlierMethod:'median-other-sampled-videos-same-format',
      metricsNote:'Outlier theo mẫu video cùng định dạng (ít nhất 3 video khác, đã đăng ≥2 ngày), chưa cân bằng tuổi video. VPH TB từ khi đăng.'};
  });
}
export function rankChannels(channels,query,semantic=null){
  const ranked=channels.map((c,i)=>{const lexical=lexicalRelevance(query,c.profile||c.title);const similarity=semantic?.[i]??null;
    // Experimental semantic score is a similarity, not a probability of success.
    const relevance=similarity===null?lexical:similarity;
    const medianToSubs=c.subs>0&&c.recentMedianViews!==null?c.recentMedianViews/c.subs:null;
    const reasons=[similarity===null?`Khớp ${Math.round(lexical*100)}% từ chủ đề`:`Tương đồng nội dung E5: ${similarity.toFixed(3)}`];
    if(c.recentSampleSize)reasons.push(`Mẫu ${c.recentSampleSize} video, view trung vị ${Math.round(c.recentMedianViews||0).toLocaleString('vi-VN')}`);
    return {...c,relevance,semanticSimilarity:similarity,lexicalRelevance:lexical,medianViewsPerSub:medianToSubs,rankMethod:semantic?'multilingual-e5-small':'keyword-overlap',rankReasons:reasons};
  });
  return ranked.sort((a,b)=>b.relevance-a.relevance||(b.recentMedianViews??-1)-(a.recentMedianViews??-1));
}
