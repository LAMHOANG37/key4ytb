import { Store } from '../store.mjs';
import { Semantic } from '../semantic.mjs';
const store=new Store('data/nichescope.sqlite');const semantic=new Semantic(store);
try{const scores=await semantic.scores('trồng rau trên ban công',['Hướng dẫn trồng rau trong chậu tại nhà','Bình luận trận đấu bóng đá'],AbortSignal.timeout(180000));console.log(JSON.stringify({model:semantic.state,scores,relatedRanksFirst:scores[0]>scores[1]}));}
finally{await semantic.close();store.close();}
