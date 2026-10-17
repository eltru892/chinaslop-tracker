import { createHash } from 'node:crypto';
import { hoyoHeaders } from './collector.mjs';
import { createOfficialArtwork } from './official-art.mjs';
import { dailyResetInfo } from './resource-time.mjs';

const HOYO = 'https://sg-act-public-api.hoyolab.com';
export const EVENT_SOURCES = {
  genshin:{name:'HoYoLAB',url:'https://act.hoyolab.com/app/community-game-records-sea/'},
  hsr:{name:'HoYoLAB',url:'https://act.hoyolab.com/app/community-game-records-sea/'},
  zzz:{name:'HoYoLAB',url:'https://act.hoyolab.com/app/community-game-records-sea/'},
  endfield:{name:'Endfield official notices',url:'https://endfield.gryphline.com/en-us/news'}
};
export function eventTimestamp(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  if (Number.isFinite(number)) return number > 0 ? (number < 1e12 ? number*1000 : number) : null;
  // Never interpret an ambiguous server-local date in the computer's timezone.
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 ? time : null;
}
const cleanText = value=>String(value || '').replace(/<[^>]*>/g,'').replace(/\\n/g,' ').replace(/\s+/g,' ').trim().slice(0,400);
export function eventImage(value,base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value,base);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const titleKey = value=>cleanText(value).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function addAnnouncementImages(events,posts) {
  return events.map(event=>{
    if (event.imageUrl) return event;
    const key = titleKey(event.artworkName || event.name);
    const matches = posts.filter(entry=>key.length >= 6 && titleKey(entry.post?.subject).includes(key))
      .sort((a,b)=>titleKey(a.post.subject).length-titleKey(b.post.subject).length);
    for (const entry of matches) {
      const imageUrl = eventImage(entry.image_list?.[0]?.url || entry.post?.cover);
      if (imageUrl) return {...event,imageUrl,...(/^\d+$/.test(String(entry.post?.post_id)) ? {imageSourceUrl:`https://www.hoyolab.com/article/${entry.post.post_id}`} : {})};
    }
    return event;
  });
}
export function ongoingEvents(events,now = Date.now()) {
  const unique = new Map();
  for (const item of events) {
    if (!item.name || !item.startAt || item.startAt > now || (!Number.isFinite(item.endAt) || item.endAt <= now)) continue;
    if (item.endAt != null && item.endAt <= item.startAt) continue;
    unique.set(`${item.id}:${item.startAt}:${item.endAt}`,item);
  }
  return [...unique.values()].sort((a,b)=>(a.endAt ?? Infinity)-(b.endAt ?? Infinity) || a.name.localeCompare(b.name));
}
export function calendarTime(value,game,region) {
  if (!value || typeof value!=='object') return eventTimestamp(value);
  const {year,month,day,hour=0,minute=0,second=0}=value;
  if (![year,month,day,hour,minute,second].every(Number.isInteger) || year<2020 || month<1 || month>12 || day<1 || day>31 || hour<0 || hour>23 || minute<0 || minute>59 || second<0 || second>59) return null;
  const offset=dailyResetInfo(game,region)?.utcOffsetHours;
  if (offset==null) return null;
  const local=Date.UTC(year,month-1,day,hour,minute,second);
  if (new Date(local).getUTCMonth()!==month-1) return null;
  return local-offset*3600000;
}
export function normalizeHoyoEvents(game,data,now = Date.now(),region = '') {
  const list = game === 'zzz' ? data.activity_list : data.act_list;
  if (!Array.isArray(list)) throw new Error('The calendar response format has changed.');
  const period=item=>({startAt:calendarTime(item.start_timestamp ?? item.start_ts ?? item.time_info?.start_ts ?? item.begin_time ?? item.hadal_begin_time ?? item.start_time,game,region),endAt:calendarTime(item.end_timestamp ?? item.end_ts ?? item.time_info?.end_ts ?? item.end_time ?? item.hadal_end_time,game,region)});
  const events=list.map(item=>({id:String(item.id ?? item.activity_id),name:cleanText(item.name),...period(item),kind:'Event',category:'event',imageUrl:eventImage(item.image_url || item.banner_url || item.icon)}));
  const challenges=game==='genshin'?data.fixed_act_list:game==='hsr'?data.challenge_list:[];
  for(const item of challenges || []) events.push({id:`challenge:${item.id ?? item.group_id}`,name:cleanText(item.name_mi18n || item.name),...period(item),kind:'Challenge',category:'challenge',imageUrl:eventImage(item.image_url || item.icon)});
  const bannerLists=game==='genshin'?[['avatar_card_pool_list','Character banner','avatars'],['weapon_card_pool_list','Weapon banner','weapon'],['mixed_card_pool_list','Chronicled Wish','avatars']]:game==='hsr'?[['avatar_card_pool_list','Character banner','avatar_list'],['equip_card_pool_list','Light Cone banner','equip_list']]:[['avatar_gacha_schedule_list','Agent banner','avatar_list'],['weapon_gacha_schedule_list','W-Engine banner','weapon_list']];
  const gacha=game==='zzz'?data.gacha_calendar || {}:data;
  for(const [field,kind,featured] of bannerLists) for(const item of gacha[field] || []) {
    const entries=item[featured] || [],top=entries.filter(entry=>['S',5,'5'].includes(entry.rarity)),featuredEntries=top.length?top:entries;
    const characters=featuredEntries.map(entry=>entry.avatar_name || entry.item_name || entry.name).filter(Boolean).join(' / ');
    const name=cleanText(item.pool_name || item.name || characters || kind);
    const title=characters && !titleKey(name).includes(titleKey(characters))?`${name} · ${characters}`:name;
    const id=item.pool_id ?? item.id ?? entries.map(entry=>entry.avatar_id ?? entry.weapon_id).join('-');
    events.push({id:`banner:${field}:${id || item.gacha_type}`,name:`${title}${name===kind?'':` — ${kind}`}`,artworkName:name,...period(item),kind,category:'banner',imageUrl:eventImage(item.image_url || item.banner_url || featuredEntries[0]?.icon || featuredEntries[0]?.icon_url || featuredEntries[0]?.item_url),sourceUrl:eventImage(item.jump_url)});
  }
  if(game==='zzz') for(const [name,body] of Object.entries(data.challenge_calendars || {})) {
    const info=name==='Threshold Simulation'?body.void_front_battle_abstract_info_brief:name==='Shiyu Defense'?body.hadal_info_v2 || body:body;
    if(info) events.push({id:`challenge:${titleKey(name)}`,name,...period(info),kind:'Challenge',category:'challenge',imageUrl:eventImage(info.image_url || info.icon)});
  }
  const unique=new Map();
  for(const item of ongoingEvents(events,now)) {
    const key=item.category==='banner'?`${item.id}:${item.startAt}:${item.endAt}`:`${titleKey(item.name)}:${item.startAt}:${item.endAt}`;
    if(!unique.has(key) || item.category==='challenge')unique.set(key,item);
  }
  return ongoingEvents([...unique.values()],now);
}
const ENDFIELD_NEWS = 'https://web-news.gryphline.com/api/bulletin';
export const EVENT_SERVERS = {
  genshin:['os_usa','os_euro','os_asia','os_cht'],
  hsr:['prod_official_usa','prod_official_eur','prod_official_asia','prod_official_cht'],
  zzz:['prod_gf_us','prod_gf_eu','prod_gf_jp','prod_gf_sg'],
  endfield:['Asia','Americas / Europe']
};
function noticeLines(html) {
  return String(html || '').replace(/<\/(?:p|div|h[1-6])>|<br\s*\/?>/gi,'\n').replace(/<[^>]*>/g,'')
    .replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'")
    .split('\n').map(line=>line.trim()).filter(Boolean);
}
export function endfieldRegion(region) {
  if (/asia|^2$/i.test(region || '')) return 'Asia';
  if (/amer|euro|north|na\s*[&/]|us|^en$|^3$/i.test(region || '')) return 'Americas / Europe';
  return null;
}
export function officialEndfieldEvents(notices,region,now=Date.now()) {
  const selected = endfieldRegion(region);
  if (!selected) throw new Error('Choose an Endfield server to load its official event schedule.');
  const offset = selected === 'Asia' ? 8 : -5;
  const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  function dates(text,zone=offset) {
    return [...text.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})/gi)]
      .map(m=>Date.UTC(+m[3],monthNames.indexOf(m[1].slice(0,3).toLowerCase()),+m[2],+m[4],+m[5])-zone*3600000);
  }
  const events=[];
  for (const notice of notices) {
    if (!/Version Update Notes$/i.test(notice.title || '')) continue;
    const lines=noticeLines(notice.data);
    const maintenance=lines.find(line=>line.startsWith(selected+' Server:'));
    const patchStart=maintenance ? dates(maintenance).at(-1) : null;
    let heading='',parent='';
    for (let i=0;i<lines.length;i++) {
      const line=lines[i];
      if (/^\d+\.\s/.test(line)) { heading=line.replace(/^\d+\.\s*/,'');parent=heading; }
      if (/^○\[/.test(line)) heading=parent+' — '+line.slice(1);
      const nestedEvent = /^(\[[^\]]+\]) limited-time challenge event will/i.exec(line);
      if (nestedEvent) heading=nestedEvent[1]+' Challenge Event';
      if (!/^(?:·\s*)?(?:Event Time|Availability|Season Update):/i.test(line) || !heading) continue;
      let timing=line;
      if (!line.replace(/^(?:·\s*)?[^:]+:/,'').trim()) {
        const following=lines.slice(i+1,i+6),at=following.findIndex(text=>text===selected+' Server:');
        if (at<0) continue;
        timing=following[at+1] || '';
      }
      if (/Before (?:the next )?version update|ends after \d|maintenance$/i.test(timing)) continue;
      const stamps=dates(timing);
      let startAt,endAt;
      if (stamps.length>=2) [startAt,endAt]=stamps;
      else if (stamps.length===1 && /^.*After \[.+\] version update\s*[–—-]/i.test(timing) && patchStart) {startAt=patchStart;endAt=stamps[0];}
      else continue;
      const shortName=/\[([^\]]+)\]/.exec(heading)?.[1] || heading;
      const artNotice=notices.find(post=>post.cid!==notice.cid && titleKey(post.title).includes(titleKey(shortName)));
      events.push({id:`official:${notice.cid}:${titleKey(heading)}`,name:heading,startAt,endAt,
        kind:/headhunting/i.test(heading)?'Headhunting banner':/issue/i.test(heading)?'Arsenal banner':/challenge|echoes of war/i.test(heading)?'Challenge':'Event',
        category:/headhunting|issue/i.test(heading)?'banner':/challenge|echoes of war/i.test(heading)?'challenge':'event',
        imageUrl:eventImage(artNotice?.cover),sourceUrl:`https://endfield.gryphline.com/en-us/news/${notice.cid}`});
    }
  }
  return ongoingEvents(events,now);
}
async function loadOfficialEndfield(fetcher,region,now) {
  const query = new URLSearchParams({lang:'en-us',code:'arknights_endfield_official',page:'1',pageSize:'50'});
  const listBody = await requestJSON(fetcher,`${ENDFIELD_NEWS}?${query}`);
  if (listBody.code!==0 || !Array.isArray(listBody.data?.list)) throw new Error('The official Endfield news feed is unavailable.');
  const list=listBody.data.list;
  const patches=list.filter(post=>/Version Update Notes$/i.test(post.title)).slice(0,4);
  if (!patches.length) throw new Error('No official English version schedules were found.');
  const details=await Promise.all(patches.map(async post=>{
    const body=await requestJSON(fetcher,`${ENDFIELD_NEWS}/${encodeURIComponent(post.cid)}?${query}`);
    if (body.code!==0 || typeof body.data?.data!=='string') throw new Error('An official Endfield schedule could not be read.');
    return body.data;
  }));
  return {events:officialEndfieldEvents([...details,...list.filter(post=>!patches.some(patch=>patch.cid===post.cid))],region,now),region,
    note:'Official English notices • Only events with confirmed start and end times are shown.'};
}

async function requestJSON(fetcher,url,options = {}) {
  const response = await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error(`Calendar service returned HTTP ${response.status}.`);
  return response.json();
}
function checked(body) {
  if (body.retcode !== 0) throw new Error(`HoYoLAB rejected the calendar request (code ${Number(body.retcode)}). Try reconnecting HoYoLAB.`);
  return body.data;
}
export function createEventService({fetcher = fetch,clock = Date.now,ttl = 15*60000} = {}) {
  const cache = new Map(),pending = new Map();
  const discoverArtwork = createOfficialArtwork({fetcher,clock,ttl});
  async function cached(key,loader) {
    const old = cache.get(key), now = clock();
    if (old && now-old.checkedAt < (old.error ? 60000 : ttl)) return old;
    if (pending.has(key)) return pending.get(key);
    const promise = (async()=>{
      let result;
      try { result = { ...await loader(),checkedAt:clock(),updatedAt:clock(),error:null,stale:false }; }
      catch (error) { result = {...(old || {events:[],updatedAt:null}),checkedAt:clock(),error:error.message,stale:!!old?.updatedAt}; }
      cache.set(key,result);
      // Account changes must not leave an unbounded cache of older calendars.
      if (cache.size > 20) cache.delete(cache.keys().next().value);
      return result;
    })().finally(()=>pending.delete(key));
    pending.set(key,promise);
    return promise;
  }
  return async function getEvents(secrets = {},latest = null,selections = {}) {
    const cookie = String(secrets.hoyolabCookie || '');
    const uid = String(secrets.hoyolabUid || /(?:^|;\s*)(?:ltuid_v2|ltuid)=([^;]+)/.exec(cookie)?.[1] || '');
    const fingerprint = createHash('sha256').update(cookie+'|'+uid).digest('hex');
    const games = {};
    let rolePromise;
    function roles() {
      rolePromise ||= requestJSON(fetcher,`${HOYO}/game_record/card/wapi/getGameRecordCard?uid=${encodeURIComponent(uid)}`,{headers:hoyoHeaders(cookie)}).then(checked).then(data=>data.list || []);
      return rolePromise;
    }
    await Promise.all(['genshin','hsr','zzz','endfield'].map(async game=>{
      const source = EVENT_SOURCES[game];
      const selected = EVENT_SERVERS[game].includes(selections[game]) ? selections[game] : '';
      const region = game === 'endfield' ? selected || endfieldRegion(latest?.games?.endfield?.identity?.region) : selected;
      if (game !== 'endfield' && (!cookie || !uid)) {
        games[game] = {source,events:[],error:'Unlock storage and connect HoYoLAB to load this calendar.',updatedAt:null,stale:false};return;
      }
      const result = await cached(game === 'endfield' ? `${game}:${region}` : `${game}:${fingerprint}:${selected}`,async()=>{
        if (game === 'endfield') {
          const calendar = await loadOfficialEndfield(fetcher,region,clock());
          return {...calendar,events:await discoverArtwork(game,calendar.events)};
        }
        let card = (await roles()).find(role=>Number(role.game_id) === {genshin:2,hsr:6,zzz:8}[game]);
        if (!card?.game_role_id || !card?.region) throw new Error('No linked game role found in HoYoLAB.');
        if (selected && selected !== card.region) {
          const biz={genshin:'hk4e_global',hsr:'hkrpg_global',zzz:'nap_global'}[game];
          const binding=await requestJSON(fetcher,'https://api-os-takumi.hoyolab.com/binding/api/getUserGameRolesByCookie?game_biz='+biz,{headers:hoyoHeaders(cookie)});
          const linked=binding.retcode===0 && binding.data?.list?.find(role=>role.region===selected);
          if (!linked?.game_uid) throw new Error('No linked character is available on the selected server. Choose My account server or a server where you have a character.');
          card={...card,game_role_id:linked.game_uid,region:linked.region};
        }
        let endpoint,options;
        const headers = hoyoHeaders(cookie,game === 'hsr');
        const role = {role_id:String(card.game_role_id),server:selected || card.region};
        if (game === 'genshin') {
          endpoint = `${HOYO}/event/game_record/genshin/api/act_calendar`;
          options = {method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(role)};
        } else if (game === 'hsr') {
          endpoint = 'https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/get_act_calender?'+new URLSearchParams(role);
          options = {headers};
        } else {
          endpoint = `${HOYO}/event/game_record_zzz/api/zzz/activity_calendar?`+new URLSearchParams({uid:role.role_id,region:role.server});
          options = {headers};
        }
        const data = checked(await requestJSON(fetcher,endpoint,options));
        const missingSchedules=[];
        if(game==='zzz') {
          const base='https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/';
          const query={uid:role.role_id,region:role.server,lang:'en-us',schedule_type:'1'};
          const extra=[['Banners',`${HOYO}/event/game_record_zzz/api/zzz/gacha_calendar`,{uid:role.role_id,region:role.server,lang:'en-us'}],['Deadly Assault',base+'mem_detail',query],['Threshold Simulation',base+'void_front_battle_period_abstract_info',query],['Shiyu Defense',base+'hadal_info_v2',{role_id:role.role_id,server:role.server,lang:'en-us',schedule_type:'1',without_v2_detail:'true'}],['Annihilation Simulacrum',base+'holo_boss_detail',query]];
          const results=await Promise.allSettled(extra.map(async([name,url,params])=>checked(await requestJSON(fetcher,url+'?'+new URLSearchParams(params),{headers:{...headers,'x-rpc-lang':'en-us'}}))));
          data.challenge_calendars={};
          results.forEach((result,index)=>{
            const name=extra[index][0];
            if(result.status==='rejected') {missingSchedules.push(name);return;}
            if(name==='Banners')data.gacha_calendar=result.value;else data.challenge_calendars[name]=result.value;
          });
        }
        let events = normalizeHoyoEvents(game,data,clock(),role.server);
        if (events.some(event=>!event.imageUrl)) {
          // Public official announcement feeds: account cookies are never sent here.
          const feeds = await Promise.allSettled([1,2,3].map(type=>requestJSON(fetcher,
            'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?'+new URLSearchParams({gids:String({genshin:2,hsr:6,zzz:8}[game]),type:String(type),page_size:'50'}),
            {headers:{Accept:'application/json','x-rpc-language':'en-us'}}).then(checked)));
          events = addAnnouncementImages(events,feeds.flatMap(feed=>feed.status === 'fulfilled' ? feed.value.list || [] : []));
          const news = feeds[2];
          if (events.some(event=>!event.imageUrl) && news.status === 'fulfilled' && news.value.last_id && !news.value.is_last) {
            try {
              const older = checked(await requestJSON(fetcher,'https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList?'+new URLSearchParams({gids:String({genshin:2,hsr:6,zzz:8}[game]),type:'3',page_size:'50',last_id:String(news.value.last_id)}),{headers:{Accept:'application/json','x-rpc-language':'en-us'}}));
              events = addAnnouncementImages(events,older.list || []);
            } catch { /* Artwork lookup failure must not hide the event schedule. */ }
          }
        }
        return {events:await discoverArtwork(game,events),region:role.server,...(missingSchedules.length?{note:`Unavailable schedules: ${missingSchedules.join(', ')}. Other entries remain up to date.`}:{})};
      });
      games[game] = {source,...result,events:ongoingEvents(result.events,clock())};
    }));
    return {games,serverTime:clock()};
  };
}
