// Read public website configuration as data. Never execute downloaded JavaScript.
const key = value=>String(value || '').replace(/<[^>]*>/g,'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const hosts = new Set(['hsr.hoyoverse.com','act.hoyoverse.com','act-webstatic.hoyoverse.com','webstatic.hoyoverse.com','endfield.gryphline.com','web-static.hg-cdn.com']);
function officialURL(value,base) {
  try { const url=new URL(value,base);return url.protocol==='https:' && !url.username && !url.password && hosts.has(url.hostname) ? url.href : null; } catch { return null; }
}
export function readDataLiteral(source,start=0) {
  let at=start,nodes=0;
  const space=()=>{while(/\s/.test(source[at] || '') && at<source.length) at++;};
  function value(depth=0) {
    if(depth>100 || ++nodes>150000) throw new Error('Website configuration exceeds limits.');
    space();const c=source[at++];
    if(c==='"' || c==="'") {
      let text='';
      while(at<source.length) {
        let ch=source[at++];if(ch===c)return text;
        if(ch==='\\') {
          ch=source[at++];
          if(ch==='u' || ch==='x') {const count=ch==='u'?4:2,hex=source.slice(at,at+count);if(!new RegExp(`^[0-9a-f]{${count}}$`,'i').test(hex))throw new Error('Invalid escape.');text+=String.fromCharCode(parseInt(hex,16));at+=count;}
          else text+=({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v','0':'\0'})[ch] ?? ch;
        } else {if(ch==='\n'||ch==='\r')throw new Error('Invalid string.');text+=ch;}
      }
      throw new Error('Unterminated string.');
    }
    if(c==='{' || c==='[') {
      const object=c==='{',result=object?Object.create(null):[],end=object?'}':']';space();
      while(source[at]!==end) {
        if(object) {
          space();let name;
          if(source[at]==='"'||source[at]==="'")name=value(depth+1);
          else {const match=/^[\w$-]+/.exec(source.slice(at));if(!match)throw new Error('Invalid property.');name=match[0];at+=name.length;}
          space();if(source[at++]!==':')throw new Error('Invalid object.');result[name]=value(depth+1);
        } else result.push(value(depth+1));
        space();if(source[at]===end)break;if(source[at++]!==',')throw new Error('Invalid list.');space();
      }
      at++;return result;
    }
    at--;const literal=/^(?:!0|!1|true\b|false\b|null\b|undefined\b|-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i.exec(source.slice(at));
    if(!literal)throw new Error('Unsupported website configuration at '+at+': '+source.slice(at,at+50));at+=literal[0].length;
    const token=literal[0];
    if(token==='null'||token==='undefined')return null;
    if(token==='!0'||token==='true')return true;
    if(token==='!1'||token==='false')return false;
    return Number(token);
  }
  return {value:value(),end:at};
}
function walk(value,visit,parents=[]) {
  if(!value || typeof value!=='object')return;
  visit(value,parents);
  for(const child of Object.values(value))if(child && typeof child==='object')walk(child,visit,[value,...parents]);
}
export function hoyoPageArtwork(config,translations={}) {
  const found=[];
  walk(config,(node,parents)=>{
    if(node.name!=='@puzzle/text')return;
    const custom=node.otherOptions?.mi18n?.text?.customKey;
    const name=translations[custom] || node.options?.text;
    if(!name || /<|\n/.test(name) || name.length>150)return;
    for(const parent of parents.slice(0,5)) {
      const images=[];
      walk(parent,candidate=>{
        if(candidate.name!=='@puzzle/image')return;
        const width=parseFloat(candidate.boxStyle?.width),height=parseFloat(candidate.boxStyle?.height),ratio=width/height;
        const translated=candidate.otherOptions?.mi18n?.src?.customKey;
        const imageUrl=officialURL(translations[translated] || candidate.options?.src);
        if(imageUrl && width>0 && height>0 && ratio>=1.3 && ratio<=3.5)images.push({imageUrl,area:width*height});
      });
      if(images.length) {images.sort((a,b)=>b.area-a.area);found.push({name,imageUrl:images[0].imageUrl});break;}
    }
  });
  return found;
}
export function endfieldPageArtwork(script) {
  const base=/\.p="(https:\/\/web-static\.hg-cdn\.com\/[^"\s]+\/)"/.exec(script)?.[1];
  if(!base)return [];
  const assets=new Map([...script.matchAll(/"([^"\n]+)":\w+\.p\+"([^"\n]+)"/g)].map(m=>[m[1],officialURL(m[2],base)]));
  const result=[];
  for(const match of script.matchAll(/JSON\.parse\(\s*(?=['"])/g)) {
    let data;try{data=JSON.parse(readDataLiteral(script,match.index+match[0].length).value);}catch{continue;}
    walk(data,node=>{
      const name=node.name?.['en-us'],imageUrl=assets.get(node.thumbnail?.assetKey);
      if(name && imageUrl)result.push({name,imageUrl});
    });
  }
  return result;
}
export function matchPageArtwork(events,artwork,sourceUrl) {
  return events.map(event=>{
    if(event.imageUrl)return event;
    const name=key(event.name);
    const matches=artwork.filter(art=>{
      const candidate=key(art.name);
      return candidate.length>=8 && (name===candidate || name.startsWith(candidate));
    }).sort((a,b)=>key(b.name).length-key(a.name).length);
    const match=matches[0];return match?{...event,imageUrl:match.imageUrl,imageSourceUrl:sourceUrl}:event;
  });
}
export function createOfficialArtwork({fetcher=fetch,clock=Date.now,ttl=15*60000}={}) {
  const cache=new Map();
  async function text(url) {
    const safe=officialURL(url);if(!safe)throw new Error('Unsupported artwork host.');
    const response=await fetcher(safe,{headers:{Accept:'text/html,application/javascript,application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Official artwork page unavailable.');
    const body=await response.text();if(body.length>8*1024*1024)throw new Error('Artwork configuration too large.');return body;
  }
  return async function discover(game,events) {
    if(!['hsr','endfield'].includes(game) || events.every(event=>event.imageUrl))return events;
    let entry=cache.get(game);
    if(!entry || clock()-entry.at>ttl) {
      const sourceUrl=game==='hsr'?'https://hsr.hoyoverse.com/en-us/':'https://endfield.gryphline.com/version_briefing/latest';
      const promise=(async()=>{
        const html=await text(sourceUrl);
        const scripts=[...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(m=>officialURL(m[1],sourceUrl)).filter(Boolean);
        const scriptURL=scripts.find(url=>game==='hsr'?/\/config\.[^/]+\.js$/.test(url):/\/version-[^/]+\.js$/.test(url));
        if(!scriptURL)throw new Error('Official page format changed.');
        const script=await text(scriptURL);let artwork;
        if(game==='endfield')artwork=endfieldPageArtwork(script);
        else {
          const start=script.indexOf('={baseInfo:');if(start<0)throw new Error('Official page format changed.');
          const config=readDataLiteral(script,start+1).value;
          const id=config.baseInfo?.mi18n?.key;if(!/^m[\w]+$/.test(id || ''))throw new Error('Official translations missing.');
          const translations=JSON.parse(await text(`https://webstatic.hoyoverse.com/admin/mi18n/hkrpg_global/${id}/${id}-en-us.json`));
          artwork=hoyoPageArtwork(config,translations);
        }
        return {artwork,sourceUrl};
      })().catch(()=>({artwork:[],sourceUrl}));
      entry={at:clock(),promise};cache.set(game,entry);
    }
    const result=await entry.promise;return matchPageArtwork(events,result.artwork,result.sourceUrl);
  };
}
