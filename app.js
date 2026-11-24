import {initDeepResearch} from '/deep-ui.js';
import {channelStatsTable,initChannelStats} from '/channel-stats.js';
import { csvCell } from '/metrics.mjs';
import { initKeywords } from '/keywords.js';
import { initChannelAnalysis } from '/channel-ui.js';
const $ = id => document.getElementById(id);
const escape = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const number = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('vi-VN', {notation: 'compact', maximumFractionDigits: 1}).format(n);
const full = n => n === null || n === undefined ? 'Không công khai' : new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 0}).format(n);
const decimal = n => n === null || n === undefined ? '—' : new Intl.NumberFormat('vi-VN', {maximumFractionDigits: 1}).format(n);
const date = s => s && Number.isFinite(Date.parse(s)) ? new Date(s).toLocaleDateString('vi-VN') : 'Chưa có ngày';
function read(key, fallback) {try {const value = JSON.parse(localStorage.getItem(key)); return Array.isArray(value) ? value : fallback;} catch {return fallback;}}
let library = read('ns-library', []), history = read('ns-history', []);
let page = 'channels', mode = 'live', items = [], shown = [], loading = false, requestVersion = 0;
let liveAvailable = false, officialAvailable=false, lastQuery = '', lastNote = '', fetchedAt = null, toastTimer;
let activeJob=null,viewJob=null,pollTimer=null,pollFailures=0;
const terminal=new Set(['completed','partial','failed','cancelled','interrupted']);
const pages = {
  deepResearch:{label:'Nghiên cứu chuyên sâu',title:'Từ dữ liệu đến hồ sơ nghiên cứu.',description:'Quy trình TubeLab, dữ liệu thực tế và bằng chứng rõ ràng. Phân tích bằng Ollama trên máy.'},
  channelAnalysis:{label:'Phân tích kênh',title:'Hiểu một kênh từ dữ liệu gốc.',description:'Dán link kênh để thu thập video, tag và tổng hợp nội dung bằng Ollama.'},
  keywords: {label:'Từ khóa',title:'Bắt nhịp từ khóa đang tăng.',description:'Khám phá xu hướng tìm kiếm YouTube theo quốc gia và chủ đề.'},
  channels: {label: 'Tìm kênh', title: 'Tìm ngách nhỏ. Thấy cơ hội lớn.', description: 'Khám phá những kênh tiềm năng và tìm cảm hứng cho nội dung tiếp theo.', button: 'Tìm kênh', placeholder: 'Nhập chủ đề, từ khóa hoặc tên kênh…', results: 'Kênh đáng khám phá'},
  videos: {label: 'Research video', title: 'Bắt nhịp nội dung đang bứt phá.', description: 'Khám phá video và so sánh hiệu suất với trung vị mẫu cùng định dạng.', button: 'Tìm video', placeholder: 'Nhập chủ đề video muốn nghiên cứu…', results: 'Video đáng khám phá'},
  similar: {label: 'Kênh tương tự', title: 'Một kênh hay. Nhiều hướng khám phá.', description: 'Từ một kênh bạn thích, tìm thêm những góc nhìn trong cùng lĩnh vực.', button: 'Tìm tương tự', placeholder: 'Channel ID, @handle hoặc link kênh YouTube…', results: 'Những kênh cùng hướng'},
  library: {label: 'Thư viện', title: 'Giữ lại những kênh truyền cảm hứng.', description: 'Các kênh đã lưu trong cơ sở dữ liệu SQLite trên máy của bạn.', results: 'Kênh đã lưu'},
  history: {label: 'Lịch sử tìm kiếm', title: 'Tiếp tục hành trình khám phá.', description: 'Mở lại kết quả đã lưu hoặc chạy phiên mới. Dữ liệu giữ trên máy kể cả khi đóng trình duyệt.'},
  settings: {label: 'Nguồn dữ liệu & cài đặt', title: 'Dữ liệu rõ ràng. Góc nhìn tin cậy.', description: 'Kết nối nguồn YouTube thật và hiểu cách từng chỉ số được tính.'},
};
function toast(message) {$('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 3500);}
function persist(key, value) {try {localStorage.setItem(key, JSON.stringify(value));} catch {toast('Trình duyệt không lưu được dữ liệu. Kiểm tra dung lượng lưu trữ.');}}
function avatar(c) {
  const fallback = `<span class="avatar" style="--color:${escape(/^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#8d9e92')}">${escape(c.initials || c.title?.slice(0, 2).toUpperCase())}</span>`;
  return c.thumbnail && /^https:\/\/(yt3\.(ggpht|googleusercontent)\.com|i\.ytimg\.com)\//.test(c.thumbnail) ? `<img class="avatar" src="${escape(c.thumbnail)}" alt="" loading="lazy">` : fallback;
}
async function saveChannel(id) {
  const channel = items.find(c => c.id === id) || library.find(c => c.id === id);
  if (!channel) return;
  const exists = library.some(c => c.id === id);
  try{const data=await request('/api/library'+(exists?'?id='+encodeURIComponent(id):''),exists?'DELETE':'POST',exists?undefined:{id});library=data.items;}catch(error){toast(error.message);return;}
  updateLibraryCount();
  if (page === 'library') items = [...library];
  render(); toast(exists ? 'Đã bỏ kênh khỏi thư viện' : 'Đã lưu kênh vào thư viện');
}
function updateLibraryCount() {$('library-count').textContent = library.length;}
function stat(label, value, icon, foot) {return `<article class="stat-card"><div class="stat-label"><span>${label}</span><span>${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`;}
function renderStats() {
  const current = shown;
  const measuredVph=current.map(v=>v.vph).filter(Number.isFinite);
  const knownViews=current.filter(c=>Number.isFinite(c.views));
  const views = knownViews.length?knownViews.reduce((s,c)=>s+c.views,0):null;
  $('stats').innerHTML = page === 'videos' ?
    stat('Video tìm thấy', full(current.length), '▷', 'Trong kết quả hiện tại') + stat('Tổng lượt xem', number(views), '↗', `${knownViews.length}/${current.length} video có số liệu`) + stat('VPH trung bình', number(measuredVph.length ? measuredVph.reduce((a,b)=>a+b,0)/measuredVph.length : null), '◷', `Từ khi đăng · ${measuredVph.length} video có dữ liệu`) + stat('Video vượt 3×', full(current.filter(v => v.outlier >= 3).length), '✧', 'So với trung vị mẫu cùng định dạng') :
    stat('Kênh tìm thấy', full(current.length), '◎', 'Trong kết quả hiện tại') + stat('Tổng lượt xem', number(views), '↗', `${knownViews.length}/${current.length} kênh có số liệu`) + stat('Sub trung vị', number(median(current.map(c => c.subs).filter(Number.isFinite))), '♙', 'Chỉ tính sub có số liệu') + stat('Đã lưu thư viện', full(library.length), '▧', '<b>Sẵn sàng</b> cho lần khám phá sau');
}
function median(values) {if (!values.length) return null; values.sort((a,b)=>a-b); const i=Math.floor(values.length/2);return values.length%2?values[i]:(values[i-1]+values[i])/2;}
function channelTable() {
  return channelStatsTable(shown,{detail:true,saveButton:c=>`<button class="cs-save" data-save="${escape(c.id)}" aria-label="Lưu ${escape(c.title)}">${library.some(x=>x.id===c.id)?'▣':'▧'}</button>`});
}
function duration(n) {return n === null ? '—' : `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;}
function videoCards() {
  return `<div class="video-grid">${shown.map(v=>`<article class="video-card"><div class="video-art" style="--color:${escape(v.color || '#66877a')}">${v.thumbnail && /^https:\/\/i\.ytimg\.com\//.test(v.thumbnail)?`<img src="${escape(v.thumbnail)}" alt="${escape(v.title)}" loading="lazy">`:`<span class="art-title">${escape(v.topic || 'Discover something new')}</span>`}${v.demo?'<span class="demo-label">ẢNH & DỮ LIỆU MINH HỌA</span>':''}<span class="duration">${duration(v.duration)}</span></div><div class="video-body"><h3>${v.url?`<a href="${escape(v.url)}" target="_blank" rel="noreferrer">${escape(v.title)}</a>`:escape(v.title)}</h3><p>${escape(v.channelTitle)}</p><p>${number(v.views)} lượt xem · ${date(v.publishedAt)}</p><div class="video-metrics"><span class="outlier-pill">${decimal(v.outlier)}× Outlier</span><span>${number(v.vph)} VPH TB</span></div></div></article>`).join('')}</div>`;
}
function render() {
  const video = page === 'videos';
  const minSubs = Number($('min-subs').value || 0), maxSubs = $('max-subs').value ? Number($('max-subs').value) : Infinity;
  const minViews = Number($('min-views').value || 0), outlier = Number($('outlier').value);
  shown = items.filter(c => (c.views || 0) >= minViews && (video ? (outlier === 0 || c.outlier >= outlier) : ((minSubs === 0 && maxSubs === Infinity) || c.subs !== null && c.subs >= minSubs && c.subs <= maxSubs)));
  const sort = $('sort').value;
  shown.sort((a,b) => (b[sort] ?? -1) - (a[sort] ?? -1));
  $('result-count').textContent = shown.length;
  $('footer-count').textContent = `${shown.length} / ${items.length} ${video?'video':'kênh'}`;
  $('result-note').textContent = lastNote;
  $('export').disabled = !shown.length || loading;
  $('export-json').disabled = !shown.length;
  renderStats();
  if (loading && !items.length) {$('results').innerHTML = '<div class="loading"><span class="spinner"></span>Đang thu thập; kết quả xuất hiện dần bên dưới…</div>';return;}
  if (!shown.length) {
    $('results').innerHTML = `<div class="empty"><div class="empty-symbol">${page==='library'?'▧':'⌕'}</div><h3>${page==='library'?'Thư viện đang chờ cảm hứng mới':viewJob?'Chưa có kết quả phù hợp':'Bắt đầu một lần khám phá thật'}</h3><p>${page==='library'?'Bấm biểu tượng lưu cạnh một kênh để thêm vào đây.':page==='similar'?'Nhập link kênh hoặc @handle để đọc chủ đề từ video của kênh.':'Nhập chủ đề hoặc chọn một gợi ý. Backend sẽ quét, lấy mẫu video và xếp hạng nội dung.'}</p>${page==='library'?'<button class="primary" data-go="channels">Khám phá kênh</button>':''}</div>`;
  } else $('results').innerHTML = video ? videoCards() : channelTable();
  $('updated-at').textContent = mode === 'demo' && page !== 'library' ? 'Dữ liệu minh họa · Không đại diện cho kênh thực tế' : page === 'library' ? 'SQLite · Dữ liệu mẫu và dữ liệu thật có nhãn riêng' : `${viewJob?.source||'YouTube thật'} · ${fetchedAt ? new Date(fetchedAt).toLocaleString('vi-VN') : 'Chưa có phiên quét'} · Số liệu từ giao diện có thể được làm tròn`;
}
async function request(path,method='GET',payload){const response=await fetch(path,{method,...(payload!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}:{})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Không tải được dữ liệu.');return data;}
async function api(path, params = {}) {
  const response = await fetch(`/api/${path}?${new URLSearchParams({mode, ...params})}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Không tải được dữ liệu.');
  return data;
}
function resetFilters() {for (const id of ['min-subs','max-subs','min-views']) $(id).value='';$('outlier').value='0';$('days').value='0';}
function sourceUI() {
  $('source-badge').textContent = mode === 'demo' ? 'DỮ LIỆU MẪU' : 'YOUTUBE THẬT';
  $('source-description').textContent = mode === 'demo' ? 'Tên kênh và chỉ số được giả lập để bạn trải nghiệm.' : 'Quét kênh/video công khai · Lưu SQLite · Xếp hạng nội dung đa ngôn ngữ';
  document.querySelector('.source-banner').classList.toggle('live', mode === 'live');
  $('connect-source').textContent = 'Đổi nguồn dữ liệu';
  $('search-hint').textContent = mode === 'demo' ? 'Dữ liệu giả lập · Không gọi YouTube' : 'Thị trường tìm kiếm ≠ quốc gia kênh';
  $('scan-options').hidden=mode==='demo';
  document.querySelectorAll('input[name="mode"]').forEach(input => input.checked = input.value === mode);
}
const pageHashes={deepResearch:'#research',channels:'#channels',keywords:'#keywords',channelAnalysis:'#channel-analysis',videos:'#videos',similar:'#similar',library:'#library',history:'#history',settings:'#settings'};
const pageFromHash=()=>Object.keys(pageHashes).find(key=>pageHashes[key]===location.hash)||'channels';
function navigate(next,{replace=false}={}) {
  if(!pages[next])next='channels';
  const hash=pageHashes[next];
  if(location.hash!==hash)window.history[replace?'replaceState':'pushState'](null,'',location.pathname+location.search+hash);
  requestVersion++; page = next; loading = false; items=[]; lastNote=''; lastQuery=''; fetchedAt=null;viewJob=null;$('job-panel').hidden=true;
  const config = pages[page];
  $('page-title').textContent=config.title;$('page-description').textContent=config.description;$('breadcrumb').textContent=config.label;
  document.querySelectorAll('[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('discovery').hidden=['settings','history','keywords','channelAnalysis','deepResearch'].includes(page);$('settings-panel').hidden=page!=='settings';$('history-panel').hidden=page!=='history';$('keywords-panel').hidden=page!=='keywords';$('channel-analysis-panel').hidden=page!=='channelAnalysis';document.getElementById('deep-research-panel').hidden=page!=='deepResearch';
  document.querySelector('.source-banner').hidden=['keywords','channelAnalysis','deepResearch'].includes(page);
  document.querySelector('.search-panel').hidden=page==='library';
  $('search-button').disabled=false;$('query').value='';resetFilters();$('filters').hidden=true;$('filter-toggle').setAttribute('aria-expanded','false');
  const video=page==='videos';
  $('days-label').hidden=!video;$('outlier-label').hidden=!video;
  $('min-subs').parentElement.hidden=video;$('max-subs').parentElement.hidden=video;
  $('sort').value=video?'vph':mode==='live'?'relevance':'views';
  for(const option of $('sort').options) option.hidden = video ? ['subs','averageViews','relevance','recentMedianViews','medianViewsPerSub'].includes(option.value) : ['vph','outlier'].includes(option.value);
  if(config.button) $('search-button').textContent=config.button;
  if(config.placeholder) $('query').placeholder=mode==='demo'&&page==='similar'?'Thử “Bếp Nhỏ Mỗi Ngày” hoặc “Chuyện Của Lá”…':config.placeholder;
  $('result-title').textContent=config.results || '';
  $('suggestion-label').textContent=page==='similar'?'Kênh mẫu:':'Thử khám phá:';
  const suggestions=page==='similar'?(mode==='demo'?['Bếp Nhỏ Mỗi Ngày','Chuyện Của Lá','Đi Và Kể']:['@epicgardening','@khoailangthang','@mkbhd']):mode==='demo'?['Ẩm thực','Lối sống','Du lịch','Công nghệ']:['urban gardening','trồng rau ban công','nấu ăn gia đình','DIY electronics'];
  document.querySelectorAll('[data-query]').forEach((b,i)=>{b.hidden=!suggestions[i];b.dataset.query=suggestions[i]||'';b.textContent=suggestions[i]||'';});
  sourceUI();
  document.dispatchEvent(new CustomEvent('nichescope-page',{detail:page}));
  if(page==='history') loadHistory();
  else if(page==='library') {items=[...library];render();request('/api/library').then(data=>{library=data.items;updateLibraryCount();if(page==='library'){items=[...library];render();}}).catch(error=>toast(error.message));}
  else if(['channels','videos'].includes(page) && mode==='demo') search(false, true);
  else if(['channels','videos','similar'].includes(page)) render();
}
function followAddress(){const next=pageFromHash();if(next!==page||location.hash!==pageHashes[next])navigate(next,{replace:true});}
window.addEventListener('popstate',followAddress);
window.addEventListener('hashchange',followAddress);
async function search(record = true, initial = false) {
  if(loading) return;
  const requestedPage=page, ticket=++requestVersion, q=$('query').value.trim();
  if(!q && !(mode==='demo' && initial)) {toast('Hãy nhập từ khóa hoặc chọn một gợi ý.');$('query').focus();return;}
  loading=true;items=[];$('search-button').disabled=true;render();
  try {
    if(mode==='live'){
      const job=await request('/api/jobs','POST',{kind:page,q,country:$('country').value,days:page==='videos'?Number($('days').value):0,provider:$('provider').value,limit:Number($('scan-limit').value),ranking:$('ranking').value,strictCountry:$('strict-country').checked,expand:$('expand-search').checked});
      activeJob=job;$('background-job').hidden=false;
      if(ticket===requestVersion&&page===requestedPage){viewJob=job;updateJob(job);}
      startPolling();return;
    }
    const endpoint=initial && !q && mode==='demo'?'discover':page==='similar'?'similar':page==='videos'?'videos':'channels';
    const data=await api(endpoint,{q,country:$('country').value,days:page==='videos'?$('days').value:'0',type:page==='videos'?'videos':'channels'});
    if(ticket!==requestVersion || page!==requestedPage)return;
    items=data.items;lastQuery=q;lastNote=data.note || '';fetchedAt=data.fetchedAt;
    if(data.seed) lastNote=`Kênh mẫu: ${data.seed.title}. ${lastNote}`;
    if(record && q) {
      const saved=await request('/api/history','POST',{q,page,country:$('country').value,days:$('days').value,count:items.length});history=saved.items;
    }
  } catch(error) {
    if(ticket!==requestVersion)return;
    loading=false;items=[];render();$('results').innerHTML=`<div class="error-message" role="alert">${escape(error.message)}</div>`;return;
  } finally {if(ticket===requestVersion && !(viewJob&&!terminal.has(viewJob.status))){loading=false;$('search-button').disabled=false;}}
  if(ticket===requestVersion)render();
}
function renderHistory() {
  $('history-list').innerHTML=history.length?history.map(h=>`<article class="history-item"><span class="empty-symbol">◷</span><div><strong>${escape(h.q)}</strong><small>${escape(pages[h.page]?.label || h.page)} · ${h.mode==='demo'?'Dữ liệu mẫu':'YouTube thật'} · ${h.count} kết quả · ${escape(h.status||'đã lưu')} · ${new Date(h.at).toLocaleString('vi-VN')}</small></div>${h.jobId?`<button class="secondary" data-open-job="${escape(h.jobId)}">Mở kết quả</button>`:''}<button class="secondary" data-replay="${escape(h.id)}">Tìm lại</button></article>`).join(''):'<div class="empty"><div class="empty-symbol">◷</div><h3>Chưa có phiên tìm kiếm</h3><p>Các lần tìm kênh và video sẽ xuất hiện tại đây.</p></div>';
}
async function loadHistory(){try{const [saved,runs]=await Promise.all([request('/api/history'),request('/api/jobs')]);const pending=runs.items.filter(j=>!terminal.has(j.status)).map(j=>({id:j.id,q:j.args.q,page:j.args.kind,mode:'live',count:j.count,status:j.status,at:j.createdAt,jobId:j.id}));history=[...pending,...saved.items];if(page==='history')renderHistory();}catch(error){toast(error.message);}}
function updateJob(job){
  viewJob=job;items=job.items;loading=!terminal.has(job.status);fetchedAt=job.updatedAt;lastQuery=job.args.q;
  lastNote=job.error||`${job.rankMethod==='multilingual-e5-small'?'Đã xếp hạng E5 đa ngôn ngữ.':job.args.kind==='videos'?'Outlier theo mẫu cùng định dạng; VPH trung bình từ lúc đăng.':'Kết quả đang xếp theo độ khớp từ khóa.'} Quốc gia kênh không công khai được giữ nếu chưa bật lọc nghiêm ngặt.`;
  $('query').value=job.args.q;$('scan-limit').value=String(job.args.limit);$('ranking').value=job.args.ranking;$('expand-search').checked=job.args.expand;$('strict-country').checked=job.args.strictCountry;$('provider').value=job.args.provider;$('search-button').disabled=loading;$('job-panel').hidden=false;$('job-stage').textContent=job.stage;$('job-progress').value=job.progress;
  $('job-meta').textContent=`${job.status} · ${job.candidateCount||0} ứng viên · ${job.analyzedCount||0} kênh đã đọc · ${job.requests}/${job.requestLimit} yêu cầu · ${job.items.length} kết quả`;
  $('job-log').textContent=job.logs.map(log=>`${new Date(log.at).toLocaleTimeString('vi-VN')}  ${log.message}`).join('\n');
  $('job-warnings').textContent=job.warnings.slice(-3).join('\n');$('cancel-job').hidden=terminal.has(job.status);$('cancel-job').disabled=job.status==='cancelling';render();
}
function startPolling(){clearTimeout(pollTimer);pollTimer=setTimeout(pollJob,900);}
async function pollJob(){
  if(!activeJob)return;const id=activeJob.id;
  try{const job=await request('/api/jobs/'+id);if(activeJob?.id!==id)return;activeJob=job;pollFailures=0;if(viewJob?.id===id)updateJob(job);
    if(terminal.has(job.status)){$('background-job').hidden=true;activeJob=null;if(page==='history')loadHistory();return;}
  }catch(error){if(++pollFailures>=5){$('background-job').textContent='Kết nối bị gián đoạn · mở lại phiên';toast(error.message);clearTimeout(pollTimer);return;}}
  startPolling();
}
async function openJob(id){try{const job=await request('/api/jobs/'+id);mode='live';navigate(job.args.kind);$('country').value=job.args.country;$('days').value=String(job.args.days);$('sort').value=job.args.kind==='videos'?'vph':'relevance';updateJob(job);if(!terminal.has(job.status)){activeJob=job;$('background-job').hidden=false;startPolling();}}catch(error){toast(error.message);}}
async function showDetail(id) {
  const entry=items.find(c=>c.id===id);if(!entry)return;
  const dialog=$('detail-dialog');$('detail-content').innerHTML='<div class="loading"><span class="spinner"></span>Đang đọc thông tin kênh…</div>';dialog.showModal();
  try {
    const data=await api('channel',{id,mode:entry.demo?'demo':'live'});
    const c=data.channel;
    $('detail-content').innerHTML=`<div class="detail-title">${avatar(c)}<div><h2>${escape(c.title)}</h2><span class="topic-label">${c.demo?'Kênh giả lập':escape(c.countryLabel||c.country||'Không công khai quốc gia')}</span></div></div><p class="detail-description">${escape(c.description)}</p><div class="detail-stats"><div><small>Người đăng ký</small><strong>${number(c.subs)}</strong></div><div><small>Tổng lượt xem</small><strong>${number(c.views)}</strong></div><div><small>Video công khai</small><strong>${full(c.videos)}</strong></div></div><p class="footnote">TB toàn kênh: <b>${number(c.averageViews)}</b> · View/sub: <b>${decimal(c.viewsPerSub)}×</b> · Tạo ngày ${date(c.publishedAt)}</p><p class="footnote">TB gần đây: ${number(c.recentAverageViews)} · Trung vị: ${number(c.recentMedianViews)} · Mẫu ${c.recentSampleSize||0} video có view. Tần suất ước tính: ${decimal(c.uploadFrequency)} video/ngày (${decimal(c.frequencyWindowDays)} ngày quan sát).</p><p class="footnote">Mẫu định dạng: ${c.formatSampleCounts?.long??'—'} video dài, ${c.formatSampleCounts?.short??'—'} Shorts. ${c.shortsPct===null?'Chưa thể suy ra tỷ lệ Shorts của toàn kênh từ hai mẫu riêng.':''}</p><h3>${c.demo?'Video minh họa của kênh':'Mẫu video đã thu thập'}</h3>${data.videos.length?data.videos.map(v=>`<div class="detail-video">${v.url?`<a target="_blank" rel="noreferrer" href="${escape(v.url)}">${escape(v.title)}</a>`:escape(v.title)}<small>${number(v.views)} view · ${number(v.vph)} VPH TB · ${decimal(v.outlier)}× Outlier (mẫu ${v.outlierSampleSize??'—'}) · ${escape(v.format||'chưa phân loại')} · ${escape(v.publishedText||date(v.publishedAt))}${v.datePrecision==='relative-estimate'?' · ngày ước tính':''}${v.recentVph!==null&&v.recentVph!==undefined?` · ${number(v.recentVph)} VPH gần đây / ${decimal(v.recentIntervalHours)} giờ`:''}</small></div>`).join(''):'<p class="footnote">Chưa có video công khai trong mẫu.</p>'}<p class="footnote">Outlier dữ liệu thật so với trung vị các video khác cùng định dạng, chưa cân bằng tuổi video. Ngày tương đối và số view làm tròn là ước tính. Dữ liệu mẫu 0.1 dùng baseline toàn kênh.</p><div class="detail-actions">${c.url?`<a href="${escape(c.url)}" target="_blank" rel="noreferrer">Mở kênh trên YouTube</a>`:'<span class="footnote">Kênh mẫu không có trang YouTube thực tế.</span>'}</div>`;
  }catch(error){$('detail-content').innerHTML=`<p class="error-message">${escape(error.message)}</p>`;}
}
function exportCsv() {
  if(!shown.length)return;
  const video=page==='videos';
  const columns=video?['id','title','channelTitle','views','publishedAt','datePrecision','format','vph','recentVph','recentIntervalHours','recentVphPrecision','outlier','outlierBaseline','outlierSampleSize','url','source','observedAt','demo']:['title','subs','views','videos','averageViews','viewsPerSub','recentAverageViews','recentMedianViews','recentSampleSize','medianViewsPerSub','latestUpload','uploadFrequency','frequencyWindowDays','shortsPct','relevance','semanticSimilarity','rankMethod','country','id','source','observedAt','demo'];
  const csv='\uFEFF'+[columns.map(csvCell).join(','),...shown.map(item=>columns.map(k=>csvCell(item[k])).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`nichescope-${page}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast(`Đã xuất ${shown.length} dòng CSV`);
}
document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.page)navigate(button.dataset.page);
  if(button.dataset.go)navigate(button.dataset.go);
  if(button.dataset.query){$('query').value=button.dataset.query;search();}
  if(button.dataset.save)saveChannel(button.dataset.save);
  if(button.dataset.detail)showDetail(button.dataset.detail);
  if(button.dataset.openJob)openJob(button.dataset.openJob);
  if(button.dataset.replay){const h=history.find(x=>x.id===button.dataset.replay);if(!h)return;if(h.mode==='live'&&!liveAvailable){toast('Nguồn YouTube thật đang tắt.');return;}mode=h.mode;navigate(h.page);$('query').value=h.q;$('country').value=h.country;$('days').value=h.days;loading=false;search();}
});
$('search-form').addEventListener('submit',event=>{event.preventDefault();search();});
$('filter-toggle').addEventListener('click',()=>{$('filters').hidden=!$('filters').hidden;$('filter-toggle').setAttribute('aria-expanded',String(!$('filters').hidden));});
$('reset-filters').addEventListener('click',()=>{resetFilters();render();});
for(const id of ['min-subs','max-subs','min-views','outlier','sort'])$(id).addEventListener('input',render);
$('country').addEventListener('change',()=>{if(lastQuery || page==='videos')search(false,true);});
$('days').addEventListener('change',()=>{if(page==='videos')search(false,true);});
for(const id of ['connect-source','formula-link','help'])$(id).addEventListener('click',()=>navigate('settings'));
$('close-dialog').addEventListener('click',()=>$('detail-dialog').close());
$('detail-dialog').addEventListener('click',event=>{if(event.target===$('detail-dialog')){const r=event.target.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)event.target.close();}});
$('clear-history').addEventListener('click',async()=>{try{await request('/api/history','DELETE');await loadHistory();toast('Đã xóa danh sách lịch sử. Các phiên quét và kết quả vẫn giữ trong SQLite.');}catch(error){toast(error.message);}});
$('export').addEventListener('click',exportCsv);
$('export-json').addEventListener('click',()=>{const data={mode,source:viewJob?.source||'demo',query:lastQuery,fetchedAt,items:shown};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`nichescope-${page}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('cancel-job').addEventListener('click',async()=>{if(!viewJob)return;try{const job=await request('/api/jobs/'+viewJob.id+'/cancel','POST',{});updateJob(job);if(!terminal.has(job.status)){activeJob=job;startPolling();}}catch(error){toast(error.message);}});
$('background-job').addEventListener('click',()=>{if(activeJob)openJob(activeJob.id);});
$('provider').addEventListener('change',()=>{if($('provider').value==='official'&&!officialAvailable){$('provider').value='innertube';toast('Chưa có API key. YouTube.js vẫn dùng được không cần key.');}});
document.querySelectorAll('input[name="mode"]').forEach(input=>input.addEventListener('change',()=>{
  if(input.value==='live'&&!liveAvailable){$('mode-message').textContent='Nguồn thật đang tắt trên máy chủ.';sourceUI();return;}
  mode=input.value;$('mode-message').textContent=mode==='live'?'Đã chọn YouTube thật. Mở Tìm kênh để bắt đầu quét.':'Đã chọn dữ liệu mẫu.';sourceUI();toast('Đã đổi nguồn dữ liệu');
}));
async function init(){
  try{
    const status=await request('/api/status');liveAvailable=status.liveAvailable;officialAvailable=status.officialAvailable;mode=status.defaultMode;
    const legacy=read('ns-library',[]);if(legacy.length&&!localStorage.getItem('ns-sqlite-migrated')){await request('/api/migrate','POST',{library:legacy.map(c=>({id:c.id}))});localStorage.setItem('ns-sqlite-migrated','1');}
    library=(await request('/api/library')).items;history=(await request('/api/history')).items;
    $('live-status').textContent=liveAvailable?'YouTube.js · không cần API key. Có thể bắt đầu quét.':'Nguồn thật đang tắt.';
    $('model-status').textContent=`Model ${status.model.id} · ${status.model.state==='ready'?'sẵn sàng':'sẽ tải từ cache khi xếp hạng'} · SQLite lưu trên máy.`;
    const explicitPage=Boolean(location.hash);updateLibraryCount();navigate(pageFromHash(),{replace:true});
    if(explicitPage)return;
    const runs=await request('/api/jobs');const previous=runs.items.find(j=>j.status==='running'||j.status==='queued')||runs.items.find(j=>['completed','partial'].includes(j.status)&&j.count>0);
    if(previous)await openJob(previous.id);
  }catch(error){toast('Không kết nối được backend: '+error.message);navigate(pageFromHash(),{replace:true});}
}
initKeywords({useKeyword:(q,country)=>{mode='live';navigate('channels');$('query').value=q;$('country').value=country;toast('Đã điền từ khóa. Chọn số kênh rồi bấm Tìm kênh để quét.');}});
initChannelAnalysis();
initDeepResearch();
initChannelStats();
init();
