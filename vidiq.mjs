// Official hosted MCP, API-key authentication. No browser cookies or write tools.
export const VIDIQ_URL='https://mcp.vidiq.com/mcp';
export const researchTool=name=>/^(vidiq_)?(keyword_research|outliers|channel_search|youtube_search|trending_videos)$/.test(name);
export class Vidiq {
  constructor(key,{fetcher=fetch,signal}={}){if(!key)throw new Error('Chưa kết nối vidIQ. Nhập MCP API key trong Từ khóa & AI.');this.key=key;this.fetcher=fetcher;this.signal=signal;this.id=0;this.session=null;this.version='2025-03-26';}
  async rpc(method,params={},notification=false){
    this.signal?.throwIfAborted();
    let response;
    try{response=await this.fetcher(VIDIQ_URL,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${this.key}`,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(this.session?{'Mcp-Session-Id':this.session}:{}),...(method!=='initialize'?{'MCP-Protocol-Version':this.version}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id:++this.id}),method,params}),signal:AbortSignal.any([...(this.signal?[this.signal]:[]),AbortSignal.timeout(45000)])});}catch{this.signal?.throwIfAborted();throw new Error('Không kết nối được máy chủ vidIQ. Kiểm tra mạng và thử lại.');}
    if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'vidIQ từ chối xác thực/quyền truy cập. Kiểm tra MCP API key.':response.status===429?'vidIQ giới hạn tốc độ. Đợi rồi chạy lại.':`vidIQ trả HTTP ${response.status}. Kiểm tra tài khoản và credit.`);}
    if(notification||response.status===202||response.status===204){await response.body?.cancel();return;}
    this.session=response.headers.get('mcp-session-id')||this.session;
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0,answer;
    const sse=response.headers.get('content-type')?.includes('text/event-stream');
    try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>4*1024*1024)throw new Error('Dữ liệu vidIQ vượt giới hạn 4 MB.');buffer+=decoder.decode(value,{stream:true});if(sse){buffer=buffer.replaceAll('\r\n','\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=frame.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');if(!data)continue;let parsed;try{parsed=JSON.parse(data);}catch{continue;}if(parsed.id===this.id){answer=parsed;break;}}if(answer)break;}}if(!sse)answer=JSON.parse(buffer);}finally{await reader.cancel().catch(()=>{});}
    if(!answer)throw new Error('vidIQ không trả kết quả MCP hợp lệ.');
    if(answer.error)throw new Error('vidIQ báo lỗi MCP; kiểm tra công cụ/quyền và tham số của tài khoản.');
    return answer.result;
  }
  async tools(){const init=await this.rpc('initialize',{protocolVersion:this.version,capabilities:{},clientInfo:{name:'NicheScope',version:'0.3.0'}});this.version=init.protocolVersion||this.version;await this.rpc('notifications/initialized',{},true);const tools=[];let cursor;for(let page=0;page<10;page++){const result=await this.rpc('tools/list',cursor?{cursor}:{});tools.push(...result.tools||[]);cursor=result.nextCursor;if(!cursor)return tools.filter(t=>researchTool(t.name));}throw new Error('Danh mục công cụ vidIQ phân trang quá lớn.');}
  async call(name,args){if(!researchTool(name))throw new Error('Chỉ cho phép công cụ nghiên cứu vidIQ đọc dữ liệu.');const result=await this.rpc('tools/call',{name,arguments:args});if(result.isError)throw new Error('Công cụ vidIQ báo lỗi. Kết quả trước đó được giữ; kiểm tra credit/quyền hoặc tham số.');return result;}
  async close(){if(!this.session)return;try{await this.fetcher(VIDIQ_URL,{method:'DELETE',redirect:'error',headers:{Authorization:`Bearer ${this.key}`,'Mcp-Session-Id':this.session,'MCP-Protocol-Version':this.version},signal:AbortSignal.timeout(3000)});}catch{}this.session=null;}
}
