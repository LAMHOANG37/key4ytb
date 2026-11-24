import { parentPort,workerData } from 'node:worker_threads';
import { pipeline,env } from '@huggingface/transformers';
env.cacheDir=workerData.cacheDir;
env.allowLocalModels=false;
let extractor;
parentPort.on('message',async({id,texts})=>{
  try{
    extractor ||= await pipeline('feature-extraction',workerData.model,{dtype:'q8',device:'cpu',session_options:{intra_op_num_threads:2,inter_op_num_threads:1}});
    const vectors=[];
    for(const text of texts){const tensor=await extractor(text,{pooling:'mean',normalize:true,truncation:true,max_length:512});vectors.push(Array.from(tensor.data));}
    parentPort.postMessage({id,vectors});
  }catch(error){parentPort.postMessage({id,error:error.message});}
});
