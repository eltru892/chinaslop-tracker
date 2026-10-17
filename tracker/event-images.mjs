// Public official artwork only; account credentials are never forwarded.
const hosts=new Set(['upload-os-bbs.hoyolab.com','act-webstatic.hoyolab.com','act-webstatic.hoyoverse.com','act-webstatic.mihoyo.com','web-static.hg-cdn.com']);
export function createEventImageLoader({fetcher=fetch,clock=Date.now,maxBytes=8*1024*1024,cacheBytes=8*1024*1024}={}) {
  const cache=new Map(),pending=new Map();let storedBytes=0;
  return async function load(value) {
    let url;try {url=new URL(value);}catch{throw new Error('Invalid artwork URL.');}
    if(url.protocol!=='https:' || !hosts.has(url.hostname) || url.username || url.password || (url.port && url.port!=='443'))throw new Error('Unsupported artwork host.');
    const key=url.href,old=cache.get(key);
    if(old && clock()-old.at<3600000) {cache.delete(key);cache.set(key,old);return old;}
    if(old) {cache.delete(key);storedBytes-=old.bytes.length;}
    if(pending.has(key))return pending.get(key);
    const promise=(async()=>{
      const response=await fetcher(key,{headers:{Accept:'image/png,image/jpeg,image/webp'},redirect:'error',signal:AbortSignal.timeout(12000)});
      const type=response.headers.get('content-type')?.split(';')[0];
      if(!response.ok || !['image/png','image/jpeg','image/webp'].includes(type))throw new Error('Official artwork is unavailable.');
      if(Number(response.headers.get('content-length'))>maxBytes)throw new Error('Artwork exceeds the size limit.');
      const reader=response.body.getReader(),chunks=[];let size=0;
      while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBytes){await reader.cancel();throw new Error('Artwork exceeds the size limit.');}chunks.push(value);}
      const result={bytes:Buffer.concat(chunks),type,at:clock()};
      if(size<=cacheBytes) {
        while(storedBytes+size>cacheBytes && cache.size) {const oldest=cache.keys().next().value;storedBytes-=cache.get(oldest).bytes.length;cache.delete(oldest);}
        cache.set(key,result);storedBytes+=size;
      }
      return result;
    })().finally(()=>pending.delete(key));pending.set(key,promise);return promise;
  };
}
