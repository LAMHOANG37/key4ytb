import { Worker } from 'node:worker_threads';
import { createHash,randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { cosine } from './analysis.mjs';
export const EMBEDDING_MODEL='Xenova/multilingual-e5-small';
export class Semantic {
  constructor(store,{cacheDir=resolve('data/models'),timeoutMs=180000}={}){this.store=store;this.cacheDir=cacheDir;this.timeoutMs=timeoutMs;this.worker=null;this.pending=new Map();this.state='idle';this.error=null;}
  async vectors(texts,signal){
    signal?.throwIfAborted();
    const hashes=texts.map(text=>createHash('sha256').update(EMBEDDING_MODEL+':q8:mean:512:'+text).digest('hex'));
    const result=hashes.map(h=>this.store.embedding(h,EMBEDDING_MODEL));const missing=result.map((v,i)=>v?null:i).filter(v=>v!==null);
    if(!missing.length)return result;
    const vectors=await this.run(missing.map(i=>texts[i]),signal);
    vectors.forEach((v,j)=>{const i=missing[j];result[i]=v;this.store.saveEmbedding(hashes[i],EMBEDDING_MODEL,v);});return result;
  }
  async scores(query,profiles,signal){const vectors=await this.vectors([`query: ${query}`,...profiles.map(p=>`passage: ${p}`)],signal);return vectors.slice(1).map(v=>cosine(vectors[0],v));}
  ensureWorker(){
    if(this.worker)return;
    const worker=this.worker=new Worker(new URL('./semantic-worker.mjs',import.meta.url),{workerData:{model:EMBEDDING_MODEL,cacheDir:this.cacheDir}});
    worker.on('message',message=>{const task=this.pending.get(message.id);if(!task)return;message.error?task.reject(new Error(message.error)):task.resolve(message.vectors);});
    worker.on('error',error=>{this.error=error.message;this.state='error';for(const task of this.pending.values())task.reject(error);if(this.worker===worker)this.worker=null;});
    worker.on('exit',()=>{if(this.worker===worker){this.worker=null;for(const task of this.pending.values())task.reject(new Error('Bộ xếp hạng đã dừng.'));}});
  }
  run(texts,signal){
    signal?.throwIfAborted();this.ensureWorker();this.state='loading';
    return new Promise((resolveTask,rejectTask)=>{
      const id=randomUUID();let timer;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);};
      const abort=()=>{const worker=this.worker;this.worker=null;void worker?.terminate();cleanup();rejectTask(signal.reason||new Error('Đã hủy.'));};
      this.pending.set(id,{resolve:value=>{cleanup();this.state='ready';this.error=null;resolveTask(value);},reject:error=>{cleanup();this.state='error';this.error=error.message;rejectTask(error);}});
      signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{const worker=this.worker;this.worker=null;void worker?.terminate();this.pending.get(id)?.reject(new Error('Model chưa sẵn sàng trong thời hạn. Chọn xếp hạng từ khóa hoặc thử lại.'));},this.timeoutMs);
      this.worker.postMessage({id,texts});
    });
  }
  async close(){const worker=this.worker;this.worker=null;for(const task of [...this.pending.values()])task.reject(new Error('Máy chủ đang dừng.'));await worker?.terminate();}
}
