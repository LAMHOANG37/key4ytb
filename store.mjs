import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY, payload TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY, channel_id TEXT, payload TEXT NOT NULL, observed_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT NOT NULL, kind TEXT NOT NULL, at TEXT NOT NULL, views REAL, subs REAL, PRIMARY KEY(id,kind,at));
      CREATE INDEX IF NOT EXISTS snapshot_lookup ON snapshots(id,kind,at);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, status TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS library(id TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history(id TEXT PRIMARY KEY, payload TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS embeddings(hash TEXT PRIMARY KEY, model TEXT NOT NULL, vector TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS research(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS channel_analyses(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS deep_research(id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)');
    for(const row of this.db.prepare("SELECT payload FROM deep_research WHERE status IN ('preparing','analyzing')").all()){const job=JSON.parse(row.payload);job.status='interrupted';job.error='Máy chủ đã khởi động lại; dữ liệu đã chuẩn bị được giữ.';this.saveDeepResearch(job);}
    for(const row of this.db.prepare("SELECT payload FROM channel_analyses WHERE status='running'").all()){const job=JSON.parse(row.payload);job.status='interrupted';job.error='Máy chủ đã khởi động lại. Kết quả đã thu thập được giữ.';this.saveChannelAnalysis(job);}
    for(const row of this.db.prepare("SELECT payload FROM research WHERE status='running'").all()){const job=JSON.parse(row.payload);job.status='interrupted';job.error='Máy chủ đã khởi động lại; dữ liệu đã lấy được giữ.';this.saveResearch(job);}
    for (const row of this.db.prepare("SELECT payload FROM jobs WHERE status IN ('queued','running','cancelling')").all()) {
      const job=JSON.parse(row.payload); job.status='interrupted';job.error='Máy chủ đã khởi động lại. Kết quả đã lấy vẫn được giữ; bấm Tìm lại để quét tiếp bằng phiên mới.';job.finishedAt=new Date().toISOString();this.saveJob(job);
    }
  }
  putChannel(channel) {
    const at=channel.observedAt || new Date().toISOString();
    this.db.prepare('INSERT OR REPLACE INTO channels VALUES(?,?,?)').run(channel.id,JSON.stringify(channel),at);
    if(!channel.demo)this.snapshot(channel.id,'channel',channel.views,channel.subs,at);
  }
  getChannel(id) {const row=this.db.prepare('SELECT payload FROM channels WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  putVideo(video) {
    const at=video.observedAt || new Date().toISOString();
    const cutoff=new Date(Date.parse(at)-60000).toISOString();
    const previous=this.db.prepare('SELECT at,views FROM snapshots WHERE id=? AND kind=? AND at<=? AND views IS NOT NULL ORDER BY at DESC LIMIT 1').get(video.id,'video',cutoff);
    let recentVph=null, recentIntervalHours=null;
    if(previous && Number.isFinite(video.views)){const hours=(Date.parse(at)-Date.parse(previous.at))/3600000;if(hours>=1/60 && video.views>=previous.views){recentVph=(video.views-previous.views)/hours;recentIntervalHours=hours;}}
    const item={...video,recentVph,recentIntervalHours,recentVphPrecision:video.source==='youtubei.js'?'rounded-source-estimate':'source-dependent'};
    this.db.prepare('INSERT OR REPLACE INTO videos VALUES(?,?,?,?)').run(item.id,item.channelId??null,JSON.stringify(item),at);
    if(!item.demo)this.snapshot(item.id,'video',item.views,null,at);
    return item;
  }
  snapshot(id,kind,views,subs,at){this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES(?,?,?,?,?)').run(id,kind,at,Number.isFinite(views)?views:null,Number.isFinite(subs)?subs:null);}
  saveJob(job){this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?,?,?)').run(job.id,job.status,job.createdAt,JSON.stringify(job));}
  getJob(id){const row=this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  listJobs(){return this.db.prepare('SELECT payload FROM jobs ORDER BY created_at DESC LIMIT 30').all().map(r=>JSON.parse(r.payload));}
  history(){return this.db.prepare('SELECT payload FROM history ORDER BY created_at DESC LIMIT 30').all().map(r=>JSON.parse(r.payload));}
  addHistory(item){const id=item.id || randomUUID();this.db.prepare('INSERT OR REPLACE INTO history VALUES(?,?,?)').run(id,JSON.stringify({...item,id}),item.at || new Date().toISOString());this.db.exec('DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY created_at DESC LIMIT 30)');}
  clearHistory(){this.db.exec('DELETE FROM history');}
  library(){return this.db.prepare('SELECT payload FROM library ORDER BY saved_at DESC').all().map(r=>JSON.parse(r.payload));}
  saveLibrary(channel){const savedAt=new Date().toISOString();this.db.prepare('INSERT OR REPLACE INTO library VALUES(?,?,?)').run(channel.id,JSON.stringify({...channel,savedAt}),savedAt);}
  removeLibrary(id){this.db.prepare('DELETE FROM library WHERE id=?').run(id);}
  embedding(hash,model){const row=this.db.prepare('SELECT vector FROM embeddings WHERE hash=? AND model=?').get(hash,model);return row?JSON.parse(row.vector):null;}
  saveEmbedding(hash,model,vector){this.db.prepare('INSERT OR REPLACE INTO embeddings VALUES(?,?,?)').run(hash,model,JSON.stringify(vector));}
  saveResearch(job){this.db.prepare('INSERT OR REPLACE INTO research VALUES(?,?,?,?)').run(job.id,job.status,job.createdAt,JSON.stringify(job));}
  getResearch(id){const row=this.db.prepare('SELECT payload FROM research WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  listResearch(){return this.db.prepare('SELECT payload FROM research ORDER BY created_at DESC LIMIT 30').all().map(r=>JSON.parse(r.payload));}
  saveChannelAnalysis(job){this.db.prepare('INSERT OR REPLACE INTO channel_analyses VALUES(?,?,?,?)').run(job.id,job.status,job.createdAt,JSON.stringify(job));}
  getChannelAnalysis(id){const row=this.db.prepare('SELECT payload FROM channel_analyses WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  listChannelAnalyses(){return this.db.prepare('SELECT payload FROM channel_analyses ORDER BY created_at DESC LIMIT 30').all().map(r=>JSON.parse(r.payload));}
  saveTrendSnapshot(key,value){this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,JSON.stringify(value));}
  getTrendSnapshot(key){const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;}
  listTrendSnapshots(){return this.db.prepare("SELECT value FROM settings WHERE key LIKE 'keyword-trends:%'").all().map(r=>JSON.parse(r.value));}
  getVideo(id){const row=this.db.prepare('SELECT payload FROM videos WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  saveDeepResearch(job){this.db.prepare('INSERT OR REPLACE INTO deep_research VALUES(?,?,?,?)').run(job.id,job.status,job.createdAt,JSON.stringify(job));}
  getDeepResearch(id){const row=this.db.prepare('SELECT payload FROM deep_research WHERE id=?').get(id);return row?JSON.parse(row.payload):null;}
  listDeepResearch(){return this.db.prepare('SELECT payload FROM deep_research ORDER BY created_at DESC LIMIT 30').all().map(r=>JSON.parse(r.payload));}
  close(){this.db.close();}
}
