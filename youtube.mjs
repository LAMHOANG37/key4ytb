import { metrics, videoMetrics, durationSeconds,nonnegative } from './metrics.mjs';
export function channelItem(c) {
  const n = nonnegative;
  const item = {id: c.id, title: c.snippet.title, description: c.snippet.description,
    country: c.snippet.country || null, publishedAt: c.snippet.publishedAt,
    thumbnail: c.snippet.thumbnails?.medium?.url || c.snippet.thumbnails?.default?.url || null,
    subs: c.statistics?.hiddenSubscriberCount ? null : n(c.statistics?.subscriberCount),
    views: n(c.statistics?.viewCount), videos: n(c.statistics?.videoCount),
    uploads: c.contentDetails?.relatedPlaylists?.uploads,
    url: `https://www.youtube.com/channel/${c.id}`, demo: false,source:'youtube-data-api',observedAt:new Date().toISOString()};
  return {...item, ...metrics(item)};
}
export function createYouTube(key, fetcher = fetch, context = {}) {
  async function request(resource, params) {
    context.signal?.throwIfAborted();context.onRequest?.();
    const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
    for (const [k, v] of Object.entries({...params, key})) if (v !== undefined && v !== '') url.searchParams.set(k, v);
    let response;
    try { response = await fetcher(url, {signal: AbortSignal.any([...(context.signal?[context.signal]:[]),AbortSignal.timeout(18000)])}); }
    catch { throw new Error('Không kết nối được YouTube API. Kiểm tra mạng rồi thử lại.'); }
    const data = await response.json();
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new Error('Đã hết hạn mức YouTube API của dự án. Hãy thử lại sau hoặc kiểm tra quota Google Cloud.');
      throw new Error('YouTube API từ chối yêu cầu. Kiểm tra API key, quyền YouTube Data API v3 và giới hạn của key.');
    }
    return data.items || [];
  }
  async function channels(ids) {
    if (!ids.length) return [];
    return (await request('channels', {part: 'snippet,statistics,contentDetails', id: [...new Set(ids)].join(',')})).map(channelItem);
  }
  async function videoItems(ids) {
    if (!ids.length) return [];
    const items = await request('videos', {part: 'snippet,statistics,contentDetails', id: ids.join(',')});
    const owners = new Map((await channels(items.map(v => v.snippet.channelId))).map(c => [c.id, c]));
    return items.map(v => {
      const item = {id: v.id, title: v.snippet.title, channelId: v.snippet.channelId, channelTitle: v.snippet.channelTitle,
        publishedAt: v.snippet.publishedAt, views: nonnegative(v.statistics?.viewCount),
        duration: durationSeconds(v.contentDetails.duration), thumbnail: v.snippet.thumbnails?.medium?.url,
        url: `https://www.youtube.com/watch?v=${v.id}`, demo: false};
      return {...item, ...videoMetrics(item, owners.get(item.channelId) || {})};
    });
  }
  async function search(q, country, days, type = 'channel') {
    const items = await request('search', {part: 'snippet', q, type, maxResults: 20, regionCode: country || undefined,
      publishedAfter: type === 'video' && days ? new Date(Date.now() - days * 86400000).toISOString() : undefined});
    return type === 'channel' ? channels(items.map(x => x.id.channelId).filter(Boolean)) : videoItems(items.map(x => x.id.videoId).filter(Boolean));
  }
  async function resolveChannel(seed) {
    let value = seed.trim();
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(url.hostname)) throw new Error('Hãy nhập link youtube.com, @handle hoặc Channel ID.');
      const parts = url.pathname.split('/').filter(Boolean);
      value = parts[0] === 'channel' ? parts[1] : parts[0];
    }
    if (/^UC[\w-]{22}$/.test(value)) return (await channels([value]))[0];
    if (/^@[\p{L}\p{N}_.-]+$/u.test(value)) return (await request('channels', {part: 'snippet,statistics,contentDetails', forHandle: value})).map(channelItem)[0];
    throw new Error('Nhập Channel ID bắt đầu bằng UC, @handle hoặc đường dẫn kênh YouTube.');
  }
  async function detail(id) {
    const channel = (await channels([id]))[0];
    if (!channel) throw new Error('Không tìm thấy kênh này.');
    const uploads = channel.uploads ? await request('playlistItems', {part: 'contentDetails', playlistId: channel.uploads, maxResults: 20}) : [];
    const videos = (await videoItems(uploads.map(x => x.contentDetails.videoId))).map(v=>({...v,format:'unknown',source:'youtube-data-api',datePrecision:'exact',observedAt:new Date().toISOString()}));
    return {channel, videos};
  }
  async function discover(q,{pages=1,days=0,includeChannels=true}={}){
    const foundChannels=[],foundVideos=[];
    for(const type of includeChannels?['channel','video']:['video']){
      let pageToken;
      for(let i=0;i<pages;i++){
        context.signal?.throwIfAborted();context.onRequest?.();
        const url=new URL('https://www.googleapis.com/youtube/v3/search');
        for(const [k,v]of Object.entries({part:'snippet',q,type,maxResults:50,key,regionCode:context.market||'US',pageToken,publishedAfter:type==='video'&&days?new Date(Date.now()-days*86400000).toISOString():undefined}))if(v!==undefined)url.searchParams.set(k,v);
        let response;try{response=await fetcher(url,{signal:AbortSignal.any([...(context.signal?[context.signal]:[]),AbortSignal.timeout(18000)])});}catch{throw new Error('Không kết nối được YouTube Data API.');}
        const data=await response.json();if(!response.ok)throw new Error('YouTube Data API từ chối yêu cầu. Kiểm tra key/quota.');
        for(const item of data.items||[]){if(type==='channel')foundChannels.push({id:item.id.channelId,title:item.snippet.title,description:item.snippet.description});else foundVideos.push({id:item.id.videoId,title:item.snippet.title,channelId:item.snippet.channelId,channelTitle:item.snippet.channelTitle});}
        pageToken=data.nextPageToken;if(!pageToken)break;
      }
    }
    return {channels:foundChannels,videos:foundVideos};
  }
  return {search, detail, resolveChannel,discover,source:'youtube-data-api'};
}
