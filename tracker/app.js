import { resourceCountdown, dailyResetInfo, dailyResetCountdown, weeklyResetInfo, weeklyResetCountdown, eventCountdown } from './resource-time.mjs';

const names = { genshin:'Genshin Impact', hsr:'Honkai: Star Rail', zzz:'Zenless Zone Zero', endfield:'Arknights: Endfield' };
let resourceTimers = [];
let dailyResetTimers = [];
let weeklyResetTimers = [];
const timedResources = new Set(['Original Resin','Trailblaze Power','Battery Charge','Sanity']);
const order = Object.keys(names);
const $ = id => document.getElementById(id);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
const isEventsPage = new URLSearchParams(window.location.search).get('page') === 'events';
const isHistoryPage = new URLSearchParams(window.location.search).get('page') === 'history' || window.location.hash === '#activity';
// Keep older History bookmarks working with the dedicated page URL.
if (window.location.hash === '#activity') window.history.replaceState(null,'','/?page=history');
$('daily').hidden = isHistoryPage || isEventsPage;
$('weekly').hidden = isHistoryPage || isEventsPage;
$('activity').hidden = !isHistoryPage;
$('events').hidden = !isEventsPage;
document.title = isEventsPage ? 'Events · Chinaslop Tracker' : isHistoryPage ? 'History · Chinaslop Tracker' : 'Chinaslop Tracker';
const skipLink = document.querySelector('.skip-link');
skipLink.href = isEventsPage ? '#events' : isHistoryPage ? '#activity' : '#daily';
skipLink.textContent = isEventsPage ? 'Skip to events' : isHistoryPage ? 'Skip to history' : 'Skip to progress';
function updateNavigation() {
  for (const id of ['navDaily','navWeekly','navEvents','navHistory']) $(id).removeAttribute('aria-current');
  $(isEventsPage ? 'navEvents' : isHistoryPage ? 'navHistory' : window.location.hash === '#weekly' ? 'navWeekly' : 'navDaily').setAttribute('aria-current',isHistoryPage || isEventsPage ? 'page' : 'location');
}
updateNavigation();
window.addEventListener('hashchange',updateNavigation);

let eventCalendars = null;
let eventClockOffset = 0;
const eventServerOptions = {
  genshin:['os_usa','os_euro','os_asia','os_cht'],
  hsr:['prod_official_usa','prod_official_eur','prod_official_asia','prod_official_cht'],
  zzz:['prod_gf_us','prod_gf_eu','prod_gf_jp','prod_gf_sg'],
  endfield:['Asia','Americas / Europe']
};
let eventServers = {};
try { eventServers = JSON.parse(localStorage.getItem('tracker-event-servers') || '{}') || {}; } catch {}
let eventLoadSequence = 0;
let eventGame = 'genshin';
try { const saved=localStorage.getItem('tracker-event-game');if(order.includes(saved))eventGame=saved; } catch {}
let eventWindowOffset = 0;
let eventCategory='all';
function eventCategoryFor(game,item) {
  return game==='genshin' && item.name==='Stygian Onslaught' ? 'challenge' : item.category || 'event';
}
try {const saved=localStorage.getItem('tracker-event-category');if(['all','event','banner','challenge'].includes(saved))eventCategory=saved;} catch {}
const eventThumbnailColors = new Map();
function applyEventThumbnailColor(bar,color) {
  if (!color) return;
  const channels = color.slice(1).match(/../g).map(value=>parseInt(value,16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  const luminance = channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
  bar.style.setProperty('--event-bar-color',color);
  bar.style.setProperty('--event-bar-ink',1.05/(luminance+.05)>(luminance+.05)/.059?'#ffffff':'#101827');
}
function attachEventThumbnail(bar,image,url) {
  const cached = eventThumbnailColors.has(url);
  if (cached) applyEventThumbnailColor(bar,eventThumbnailColors.get(url));

  image.addEventListener('load',()=>{
    if (eventThumbnailColors.has(url)) {
      applyEventThumbnailColor(bar,eventThumbnailColors.get(url));
      return;
    }
    let color=null;
    try { color=extractBackgroundColor(image); } catch { /* Some image hosts do not allow pixel sampling. */ }
    eventThumbnailColors.set(url,color);
    if (eventThumbnailColors.size>200) eventThumbnailColors.delete(eventThumbnailColors.keys().next().value);
    applyEventThumbnailColor(bar,color);
  });
  image.addEventListener('error',()=>{
    if (image.dataset.direct !== 'true') {
      eventThumbnailColors.set(url,null);image.dataset.direct='true';image.src=url;
    } else image.remove();
  });
  image.src='/api/event-image?url='+encodeURIComponent(url);
}
let timelineResizeFrame = 0;
if (isEventsPage) window.addEventListener('resize',()=>{
  cancelAnimationFrame(timelineResizeFrame);
  timelineResizeFrame = requestAnimationFrame(renderEvents);
});
function showEventDetails(game,item,offset) {
  const dialog=el('dialog','eventDialog');
  const close=el('button','secondary','Close');close.type='button';close.addEventListener('click',()=>dialog.close());
  const top=el('div','eventDialogHeading');top.append(el('h3','',item.name),close);dialog.append(top);
  if(item.imageUrl) { const image=el('img','eventDialogArt');image.src=item.imageUrl;image.alt='';image.referrerPolicy='no-referrer';dialog.append(image); }
  const format=time=>new Date(time+offset*3600000).toLocaleString(undefined,{timeZone:'UTC',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});
  dialog.append(el('p','',`${names[game]} · ${eventCategoryFor(game,item)==='challenge'?'Challenge':item.kind || 'Event'}`),el('p','',`${format(item.startAt)} – ${format(item.endAt)} (server time)`),el('p','eventCountdown',eventCountdown(item.endAt,Date.now()+eventClockOffset)));
  for(const [url,label] of [[item.sourceUrl,'Official notice'],[item.imageSourceUrl,'Artwork source']])if(url) {const link=el('a','eventNoticeLink',label);link.href=url;link.target='_blank';link.rel='noreferrer noopener';dialog.append(link);}
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
}
function renderEvents() {
  if (!isEventsPage || !eventCalendars) return;
  const now=Date.now()+eventClockOffset,game=eventGame,calendar=eventCalendars.games?.[game] || {};
  const oldScroll=$('eventsGrid').querySelector('.timelineScroll');
  const viewKey=`${game}:${eventWindowOffset}`;
  const preserved=oldScroll?.dataset.view===viewKey && Number(oldScroll.dataset.width)===oldScroll.clientWidth ? oldScroll.scrollLeft : null;
  const group=el('section',`eventGame eventTimeline game-${game}`);
  const toolbar=el('div','timelineToolbar');
  const gameLabel=el('label','eventServerPicker','Game');
  const gameSelect=el('select');gameSelect.setAttribute('aria-label','Event game');
  for(const value of order) {const option=el('option','',names[value]);option.value=value;gameSelect.append(option);}
  gameSelect.value=game;
  gameSelect.addEventListener('change',()=>{eventGame=gameSelect.value;eventWindowOffset=0;try{localStorage.setItem('tracker-event-game',eventGame);}catch{}renderEvents();});
  gameLabel.append(gameSelect);toolbar.append(gameLabel);
  const serverLabel=el('label','eventServerPicker','Server');
  const serverSelect=el('select');serverSelect.setAttribute('aria-label',`${names[game]} event server`);
  for(const value of ['',...eventServerOptions[game]]) {const option=el('option','',value?serverName(game,value):'My account server');option.value=value;serverSelect.append(option);}
  serverSelect.value=eventServerOptions[game].includes(eventServers[game])?eventServers[game]:'';
  serverSelect.addEventListener('change',()=>{eventServers[game]=serverSelect.value;try{localStorage.setItem('tracker-event-servers',JSON.stringify(eventServers));}catch{}$('eventsSummary').textContent='Loading selected server…';void loadEvents();});
  serverLabel.append(serverSelect);toolbar.append(serverLabel);
  const categoryLabel=el('label','eventServerPicker','Show');
  const categorySelect=el('select');categorySelect.setAttribute('aria-label','Calendar category');
  for(const [value,label] of [['all','All events & schedules'],['event','Events'],['banner','Banners'],['challenge','Challenges']]) {const option=el('option','',label);option.value=value;categorySelect.append(option);}
  categorySelect.value=eventCategory;categorySelect.addEventListener('change',()=>{eventCategory=categorySelect.value;try{localStorage.setItem('tracker-event-category',eventCategory);}catch{}renderEvents();});
  categoryLabel.append(categorySelect);toolbar.append(categoryLabel);
  const navigation=el('div','timelineNavigation');
  for(const [label,accessible,change] of [['‹','Earlier dates',-14],['Today','Show today',0],['›','Later dates',14]]) {
    const button=el('button','secondary',label);button.type='button';button.setAttribute('aria-label',accessible);
    button.addEventListener('click',()=>{eventWindowOffset=change===0?0:eventWindowOffset+change;renderEvents();});navigation.append(button);
  }
  toolbar.append(navigation);group.append(toolbar);
  const heading=el('div','eventGameHeading');const icon=el('img');icon.src=`/assets/${game}-logo.png`;icon.alt='';icon.width=40;icon.height=40;
  heading.append(icon,el('h3','',names[game]));
  if(calendar.region)heading.append(el('span','timelineServer',`${serverName(game,calendar.region)} Server`));
  group.append(heading);
  if(calendar.error)group.append(el('p','error',calendar.error));
  if(calendar.note)group.append(el('p','eventSourceNote',calendar.note));
  if(calendar.stale)group.append(el('p','eventSourceNote','Showing the last saved calendar; dates may have changed.'));
  const items=(calendar.events || []).filter(item=>eventCategory==='all' || eventCategoryFor(game,item)===eventCategory).filter(item=>item.startAt<=now && Number.isFinite(item.endAt) && item.endAt>now).sort((a,b)=>a.endAt-b.endAt || a.name.localeCompare(b.name));
  const offset=dailyResetInfo(game,calendar.region,now)?.utcOffsetHours ?? 0;
  const day=86400000,dayWidth=56,days=42,start=Math.floor((now+offset*3600000)/day)*day+(-7+eventWindowOffset)*day,end=start+days*day;
  const visible=items.filter(item=>item.endAt+offset*3600000>start && item.startAt+offset*3600000<end);
  const rangeFormat={timeZone:'UTC',month:'short',day:'numeric'};
  group.append(el('p','timelineRange',`${new Date(start).toLocaleDateString(undefined,rangeFormat)} – ${new Date(end-day).toLocaleDateString(undefined,{...rangeFormat,year:'numeric'})}`));
  const scroll=el('div','timelineScroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label',`${names[game]} event timeline. Scroll horizontally to view dates.`);scroll.dataset.view=viewKey;
  const surface=el('div','timelineSurface');surface.style.width=`${days*dayWidth+104}px`;surface.style.setProperty('--timeline-day-width',`${dayWidth}px`);
  const axis=el('div','timelineAxis');axis.style.width=`${days*dayWidth}px`;
  for(let i=0;i<days;i++) {
    const date=new Date(start+i*day),cell=el('div','timelineDay');
    if(date.getUTCDay()===0 || date.getUTCDay()===6)cell.classList.add('weekend');
    if(Math.floor((now+offset*3600000)/day)===Math.floor(date.getTime()/day))cell.classList.add('today');
    const month=i===0 || date.getUTCDate()===1?date.toLocaleDateString(undefined,{timeZone:'UTC',month:'short'}):'';
    cell.append(el('span','timelineMonth',month),el('span','timelineWeekday',date.toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short'})),el('strong','',String(date.getUTCDate())));axis.append(cell);
  }
  surface.append(axis);
  const colors=['#9edbd5','#e7c495','#b6c9fb','#f1b8d8','#f2df88','#baddad','#bfb5ef','#a6d9ee'];
  for(const [index,item] of visible.entries()) {
    const from=Math.max(0,(item.startAt+offset*3600000-start)/day*dayWidth),to=Math.min(days*dayWidth,(item.endAt+offset*3600000-start)/day*dayWidth);
    const row=el('div','timelineRow');
    const bar=el('button','timelineBar');bar.type='button';bar.style.left=`${from}px`;bar.style.width=`${Math.max(4,to-from)}px`;bar.style.setProperty('--event-bar-color',colors[index%colors.length]);
    if(item.startAt+offset*3600000<start)bar.classList.add('continuesBefore');if(item.endAt+offset*3600000>end)bar.classList.add('continuesAfter');
    bar.title=`${item.name} · ${eventCountdown(item.endAt,now)}. Click for dates and sources.`;
    bar.setAttribute('aria-label',`${item.name}. ${eventCountdown(item.endAt,now)}. View event details.`);
    if(item.imageUrl) {const image=el('img','timelineArt');image.alt='';image.loading='lazy';image.decoding='async';image.referrerPolicy='no-referrer';attachEventThumbnail(bar,image,item.imageUrl);bar.append(image);}
    bar.append(el('span','timelineBarTitle',item.name));bar.addEventListener('click',()=>showEventDetails(game,item,offset));
    const remaining=el('span','timelineRemaining',eventCountdown(item.endAt,now).replace(/^Ends in /,''));remaining.style.left=`${to+9}px`;remaining.setAttribute('role','timer');
    row.append(bar,remaining);surface.append(row);
  }
  if(!visible.length) {const empty=el('p','timelineEmpty',calendar.error?'Calendar unavailable.':items.length?'No ongoing events fall within these dates.':'No ongoing entries in this category with a confirmed end date.');surface.append(empty);}
  const nowX=(now+offset*3600000-start)/day*dayWidth;
  if(nowX>=0 && nowX<=days*dayWidth) {const line=el('div','timelineNow');line.style.left=`${nowX}px`;line.append(el('span','','Now'));line.setAttribute('aria-hidden','true');surface.append(line);}
  scroll.append(surface);group.append(scroll);
  const footer=el('div','eventSource');if(calendar.source){const link=el('a','',calendar.source.name);link.href=calendar.source.url;link.target='_blank';link.rel='noreferrer noopener';footer.append(link);}
  if(calendar.updatedAt)footer.append(el('span','',`Updated ${new Date(calendar.updatedAt).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'})}`));group.append(footer);
  $('eventsGrid').replaceChildren(group);
  scroll.scrollLeft=preserved ?? Math.max(0,nowX-scroll.clientWidth*.3);
  scroll.dataset.width=String(scroll.clientWidth);
  $('eventsSummary').textContent=`${items.length} ongoing ${items.length===1?'event':'events'}`;
}
async function loadEvents() {
  if (!isEventsPage) return;
  const sequence = ++eventLoadSequence;
  try {
    const query = new URLSearchParams(order.filter(game=>eventServerOptions[game].includes(eventServers[game])).map(game=>[game,eventServers[game]]));
    const response = await fetch('/api/events?'+query);
    if (response.status === 404) throw new Error('Restart the tracker server to load event calendars.');
    if (!response.ok) throw new Error('Could not load event calendars. Retrying automatically.');
    const data = await response.json();
    if (sequence !== eventLoadSequence) return;
    if (!data.games) throw new Error('The event calendar response was not valid.');
    eventCalendars = data;
    eventClockOffset = Number.isFinite(data.serverTime) ? data.serverTime-Date.now() : 0;
    $('eventsMessage').textContent = '';
    renderEvents();
  } catch (error) {
    if (sequence !== eventLoadSequence) return;
    $('eventsMessage').textContent = error.message;
    if (!eventCalendars) $('eventsSummary').textContent = 'Calendars unavailable';
  }
}

function localDay(iso) { return new Date(iso).toLocaleDateString(undefined,{ year:'numeric',month:'short',day:'numeric' }); }
function weekStart(date) { const d = new Date(date); d.setHours(0,0,0,0); d.setDate(d.getDate() - ((d.getDay()+6)%7)); return d; }
function count(value) { return value && typeof value.current === 'number' && typeof value.total === 'number' ? `${value.current}/${value.total}` : 'Not exposed'; }
function percentage(value) { return value && value.total > 0 ? Math.max(0,Math.min(100,Math.round(value.current/value.total*100))) : 0; }
function metricLabel(game, label) {
  if (game !== 'zzz') return label;
  return { 'Weekly bounty':'Bounty Commissions', 'Weekly activity':'Ridu Weekly' }[label] || label;
}
function serverName(game, region) {
  const value = String(region || '').trim();
  const labels = {
    os_usa:'America', os_euro:'Europe', os_asia:'Asia', os_cht:'TW / HK / MO',
    cn_gf01:'China', cn_qd01:'China (Bilibili)',
    prod_official_usa:'America', prod_official_eur:'Europe', prod_official_euro:'Europe',
    prod_official_asia:'Asia', prod_official_cht:'TW / HK / MO',
    prod_gf_us:'America', prod_gf_eu:'Europe', prod_gf_jp:'Asia', prod_gf_sg:'TW / HK / MO',
    prod_gf_cn:'China', prod_qd_cn:'China (Bilibili)'
  };
  if (game === 'endfield') {
    const endfield = {
      '2':'Asia', '3':'Americas / Europe', asia:'Asia',
      'america and europe':'Americas / Europe', 'americas and europe':'Americas / Europe',
      'america/europe':'Americas / Europe', 'americas/europe':'Americas / Europe',
      'americas / europe':'Americas / Europe'
    };
    return endfield[value.toLowerCase()] || value;
  }
  return labels[value.toLowerCase()] || value;
}
function gameIcon(game) {
  const img = el('img');
  img.src = `/assets/${game}-logo.png`;
  img.alt = '';
  img.width = 56;
  img.height = 56;
  return img;
}
function displayProgress(game, data, kind) {
  const items = data?.[kind] || [];
  if (game !== 'genshin' || kind !== 'daily') return items;
  const commissions = items.find(item => item.label === 'Daily commissions');
  const reward = items.find(item => item.label === 'Extra commission reward');
  if (!commissions || !reward) return items;
  return items.filter(item => item !== reward).map(item => item !== commissions ? item : {
    label:'Daily commissions',
    description:'The circle shows whether the extra commission reward has been claimed.',
    value:commissions.value,
    rewardClaimed:reward.value ? reward.value.current >= reward.value.total : null
  });
}
function progressText(item) {
  return count(item.value);
}
function metricCard(game, data, kind) {
  const items = displayProgress(game,data,kind);
  const complete = items.length > 0 && items.every(item => item.value && item.value.current >= item.value.total && (!('rewardClaimed' in item) || item.rewardClaimed === true));
  const card = el('article',`card game-${game} card-${kind}${complete ? ' is-complete' : ''}`);
  card.id = `${game}-${kind}`;
  const header = el('div','cardhead');
  const mark = el('div','gameMark'); mark.append(gameIcon(game));
  header.append(mark,el('h3','',names[game]));
  const signal = el('span','cardSignal',complete ? '✓' : '');
  signal.title = data?.error ? 'Connection issue' : complete ? 'Goals complete' : 'Progress to make';
  signal.setAttribute('aria-label',signal.title);
  header.append(signal);
  card.append(header);
  const region = serverName(game,data?.identity?.region);
  const server = region ? /\bserver$/i.test(region) ? region.replace(/\bserver$/i, 'Server') : `${region} Server` : data?.identity?.uid || '';
  card.append(el('div','identity',data?.identity?.nickname ? `${data.identity.nickname} · ${server}` : ''));
  if (data?.identity && (kind === 'daily' || kind === 'weekly')) {
    const weekly = kind === 'weekly';
    const timer = el('div',weekly ? 'weeklyResetTimer' : 'dailyResetTimer',(weekly ? weeklyResetCountdown : dailyResetCountdown)(game,data.identity.region));
    const reset = (weekly ? weeklyResetInfo : dailyResetInfo)(game,data.identity.region);
    timer.title = reset ? `${weekly ? 'Weekly reset: Monday' : 'Daily reset:'} 04:00 server time (UTC${reset.utcOffsetHours >= 0 ? '+' : ''}${reset.utcOffsetHours}).` : 'The server region is needed to calculate the reset.';
    timer.setAttribute('role','timer');
    timer.setAttribute('aria-live','off');
    card.append(timer);
    (weekly ? weeklyResetTimers : dailyResetTimers).push({node:timer,game,region:data.identity.region});
  }
  if (!data || data.error) { card.append(el('div','error',data?.error || 'No data yet')); return card; }
  const metrics = el('div','metrics');
  for (const item of items) {
    const block = el('div','metric');
    const head = el('div','metrichead');
    if (item.description) head.title = item.description;
    head.append(el('span','',metricLabel(game,item.label)));
    const valueGroup = el('div','metricValue');
    valueGroup.append(el('strong',item.value ? '' : 'unavailable',progressText(item)));
    if ('rewardClaimed' in item) {
      const reward = el('span',`rewardCheck${item.rewardClaimed === true ? ' is-claimed' : ''}`,item.rewardClaimed === true ? '✓' : item.rewardClaimed === null ? '?' : '');
      reward.title = item.rewardClaimed === null ? 'Extra commission reward status unavailable' : item.rewardClaimed ? 'Extra commission reward claimed' : 'Extra commission reward not claimed';
      reward.setAttribute('role','checkbox');
      reward.setAttribute('aria-checked',item.rewardClaimed === null ? 'mixed' : String(item.rewardClaimed));
      reward.setAttribute('aria-readonly','true');
      reward.setAttribute('aria-label',reward.title);
      valueGroup.append(reward,el('span','rewardLabel',item.rewardClaimed === true ? 'Claimed' : item.rewardClaimed === null ? 'Unknown' : 'Unclaimed'));
    }
    head.append(valueGroup);
    block.append(head);
    const track = el('div','track');
    if (item.value) {
      track.setAttribute('role','progressbar');
      track.setAttribute('aria-label',metricLabel(game,item.label));
      track.setAttribute('aria-valuemin','0');
      track.setAttribute('aria-valuemax',String(item.value.total));
      track.setAttribute('aria-valuenow',String(Math.min(item.value.total,Math.max(0,item.value.current))));
    } else track.setAttribute('aria-hidden','true');
    const fill = el('div','fill');
    fill.style.width = `${percentage(item.value)}%`;
    track.append(fill); block.append(track); metrics.append(block);
  }
  card.append(metrics);
  const resources = el('div','resources');
  if (kind === 'daily') for (const item of data.resources || []) {
    const value = item.value && typeof item.value === 'object' ? count(item.value) : item.value ?? 'Not exposed';
    const block = el('div',timedResources.has(item.label) ? 'resourceBlock' : 'reserveResource');
    const head = el('div','resourceHead');
    head.append(el('span','resourceLabel',item.label),el('strong','resourceValue',String(value)));
    block.append(head);
    if (timedResources.has(item.label)) {
      const timer = el('div','resourceTimer',resourceCountdown(item));
      timer.title = 'Based on the last synced resource values. Spending or restoring resources in-game updates this estimate on the next sync.';
      timer.setAttribute('role','timer');
      timer.setAttribute('aria-live','off');
      block.append(timer);
      resourceTimers.push({ node:timer, item });
    }
    resources.append(block);
  }
  if (kind === 'daily' && data.resources?.length) card.append(resources);
  return card;
}
function renderCards(snapshot) {
  resourceTimers = [];
  dailyResetTimers = [];
  weeklyResetTimers = [];
  $('dailyGrid').replaceChildren(...order.map(game => metricCard(game,snapshot?.games?.[game],'daily')));
  $('weeklyGrid').replaceChildren(...order.map(game => metricCard(game,snapshot?.games?.[game],'weekly')));
  $('todayLabel').textContent = new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  const start = weekStart(new Date());
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const weekDate = date => date.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  $('weekLabel').textContent = `Week of ${weekDate(start)} – ${weekDate(end)}`;
  $('synced').textContent = snapshot?.at ? `Last sync ${new Date(snapshot.at).toLocaleString()}` : 'No sync yet';
}
function updateResourceTimers() {
  const now = Date.now();
  for (const {node,item} of resourceTimers) node.textContent = resourceCountdown(item,now);
  for (const {node,game,region} of dailyResetTimers) node.textContent = dailyResetCountdown(game,region,now);
  for (const {node,game,region} of weeklyResetTimers) node.textContent = weeklyResetCountdown(game,region,now);
}
function historyEntry(snapshot, kind, date) {
  const line = el('div','historyrow historyEntry');
  const entries = order.map(game => {
    const data = snapshot.games?.[game];
    const items = displayProgress(game,data,kind);
    return {game,items:items.length ? items : [{label:'Progress',value:null}],error:data?.error};
  });
  const tracks = Math.max(...entries.map(entry => entry.items.length)) * 2;
  line.style.setProperty('--history-lines',String(tracks));
  line.append(el('span','historyDate',date));
  for (const {game,items,error} of entries) {
    const cell = el('div',`historyCell game-${game}`);
    cell.append(el('h4','historyGameName',names[game]));
    for (const item of items) {
      cell.append(el('span','historyMetricLabel',metricLabel(game,item.label)));
      const reward = 'rewardClaimed' in item ? item.rewardClaimed === true ? ' · ✓ Claimed' : item.rewardClaimed === null ? ' · Reward unknown' : ' · Unclaimed' : '';
      cell.append(el('strong','historyMetricValue',`${error ? 'Error' : progressText(item)}${reward}`));
    }
    line.append(cell);
  }
  return line;
}
let historyList = [];
const mobileHistory = window.matchMedia('(max-width:700px)').matches;
const historyPages = {daily:{page:0,size:mobileHistory ? '1' : '10'},weekly:{page:0,size:mobileHistory ? '1' : '3'}};
function renderHistoryPage(kind, rows, containerId) {
  const prefix = kind === 'daily' ? 'historyDaily' : 'historyWeekly';
  const state = historyPages[kind];
  $(prefix+'Size').value = state.size;
  const size = state.size === 'all' ? Math.max(rows.length,1) : Number(state.size);
  const pageCount = Math.max(1,Math.ceil(rows.length / size));
  state.page = Math.max(0,Math.min(state.page,pageCount - 1));
  const offset = state.page * size;
  const visible = rows.slice(offset,offset + size);
  const container = $(containerId);
  container.replaceChildren();
  const header = el('div','historyrow head');
  for (const text of [kind === 'daily' ? 'Date' : 'Week of','Genshin','Star Rail','ZZZ','Endfield']) header.append(el('span','',text));
  container.append(header);
  if (!rows.length) container.append(el('p','historyEmpty','No snapshots yet. Connect accounts and refresh.'));
  for (const {snapshot,date} of visible) container.append(historyEntry(snapshot,kind,date));
  const status = `Page ${state.page + 1} of ${pageCount}`;
  $(prefix+'Status').textContent = status;
  $(prefix+'BottomStatus').textContent = status;
  $(prefix+'Range').textContent = rows.length ? `${offset + 1}–${Math.min(offset + size,rows.length)} of ${rows.length} ${kind === 'daily' ? 'days' : 'weeks'}` : 'No entries';
  for (const suffix of ['Prev','BottomPrev']) $(prefix+suffix).disabled = state.page === 0;
  for (const suffix of ['Next','BottomNext']) $(prefix+suffix).disabled = state.page >= pageCount - 1;
  $(prefix+'Bottom').hidden = pageCount <= 1;
}
function renderHistory(list) {
  historyList = list;
  const latestByDay = new Map();
  const latestByWeek = new Map();
  for (const row of list) {
    latestByDay.set(localDay(row.at),row);
    latestByWeek.set(weekStart(new Date(row.at)).toISOString().slice(0,10),row);
  }
  const days = [...latestByDay.values()].reverse().map(snapshot => ({snapshot,date:localDay(snapshot.at)}));
  const formatDate = value => value.toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const weeks = [...latestByWeek.entries()].reverse().map(([date,snapshot]) => {
    const start = new Date(`${date}T12:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return {snapshot,date:`${formatDate(start)} – ${formatDate(end)}`};
  });
  renderHistoryPage('daily',days,'history');
  renderHistoryPage('weekly',weeks,'weeklyHistory');
}
for (const kind of ['daily','weekly']) {
  const prefix = kind === 'daily' ? 'historyDaily' : 'historyWeekly';
  $(prefix+'Size').addEventListener('change',event => {
    historyPages[kind].size = event.target.value;
    historyPages[kind].page = 0;
    renderHistory(historyList);
  });
  for (const [suffix,direction] of [['Prev',-1],['Next',1],['BottomPrev',-1],['BottomNext',1]]) {
    $(prefix+suffix).addEventListener('click',()=>{
      historyPages[kind].page += direction;
      renderHistory(historyList);
      $(prefix+'Controls').scrollIntoView({behavior:'smooth',block:'start'});
    });
  }
}
async function api(path, options) {
  const response = await fetch(path,options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function notice(message) { const node=$('notice'); node.textContent=message; node.hidden=!message; }
function setRefreshState(syncing, locked = false) {
  $('sync').disabled = syncing || locked;
  $('checkIn').disabled = checkInBusy || locked;
  $('checkIn').title = locked ? 'Unlock storage to check in' : 'Claim daily HoYoLAB and SKPORT check-in rewards';
  $('sync').classList.toggle('is-syncing',syncing);
  $('sync').title = locked ? 'Unlock storage to refresh game data' : 'Fetch the latest progress';
  $('syncLabel').textContent = syncing ? 'Refreshing…' : 'Refresh now';
}
let syncPoll = null;
let refreshSchedule = null;
let scheduleReloadPending = false;
function renderRefreshCountdown() {
  const node = $('nextRefresh');
  if (!refreshSchedule) { node.textContent = 'Checking auto refresh…'; return; }
  if (refreshSchedule.locked) { node.textContent = 'Auto refresh paused — unlock to resume'; return; }
  if (!refreshSchedule.nextRefreshAt) { node.textContent = 'Auto refresh paused — connect an account'; return; }
  const remaining = Math.max(0, Math.ceil((refreshSchedule.nextRefreshAt - (Date.now() + refreshSchedule.clockOffset)) / 1000));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor(remaining % 3600 / 60);
  const duration = hours > 0 ? `${hours}h ${minutes}m` : remaining >= 60 ? `${minutes}m` : '<1m';
  node.textContent = remaining > 0 ? `Next auto refresh in ${duration}` : 'Auto refresh due…';
  // Ask the server for the next deadline when the current one expires.
  if (remaining === 0 && !scheduleReloadPending) {
    scheduleReloadPending = true;
    load().finally(() => { scheduleReloadPending = false; });
  }
}
async function load() {
  clearTimeout(syncPoll);
  syncPoll = null;
  try {
    const state = await api('/api/state');
    refreshSchedule = { nextRefreshAt:state.nextRefreshAt, locked:!!state.security?.locked, clockOffset:state.serverTime - Date.now(), pollMinutes:state.configured.pollMinutes };
    renderRefreshCountdown();
    if (state.syncing) syncPoll = setTimeout(load,1000);
    renderCards(state.latest);
    const locked = !!state.security?.locked;
    $('connectionSummary').textContent = locked ? 'Storage locked' : 'Local tracker';
    $('connectionSummary').classList.toggle('is-locked',locked);
    $('security').hidden = !locked;
    $('setup').hidden = locked || state.configured.hoyolab || state.configured.skport;
    if (locked) {
      $('settings').hidden = true;
      const existing = !!state.security.encrypted;
      $('securityTitle').textContent = existing ? 'Unlock encrypted storage' : 'Protect saved accounts';
      $('securityText').textContent = existing
        ? 'Enter your encryption password to refresh game data and edit account settings.'
        : state.security.legacyUnencrypted
          ? 'Set a password to encrypt your existing HoYoLAB cookie and SKPORT token. The plain-text config is cleaned after the encrypted copy is verified.'
          : 'Set a password before connecting accounts. Your cookie and token will be encrypted on this computer.';
      $('confirmLabel').hidden = existing;
      $('confirmPassphrase').required = !existing;
      $('unlockButton').textContent = existing ? 'Unlock' : 'Encrypt and unlock';
    }
    $('hoyoStatus').textContent = state.configured.hoyolab ? '(saved)' : '(not connected)';
    $('skportStatus').textContent = state.configured.skport ? '(saved)' : '(not connected)';
    $('hoyoUidStatus').textContent = state.configured.hoyolabUidSaved ? '(saved)' : '(not saved)';
    $('hoyoUid').placeholder = 'Paste the ltuid_v2 value only';
    if ($('settings').hidden) {
      $('autoCheckIn').checked=state.autoCheckIn?.enabled === true;
      const minutes = state.configured.pollMinutes;
      const preset = Array.from($('pollMinutes').options).some(option => option.value === String(minutes));
      $('pollMinutes').value = preset ? String(minutes) : 'custom';
      if (!preset) $('customPollMinutes').value = minutes;
      updateCustomInterval();
    }
    const auto=state.autoCheckIn;
    const lastResults=auto?.lastResult?.games;
    const issues=lastResults ? order.filter(game=>['error','verification'].includes(lastResults[game]?.status)).map(game=>names[game]) : [];
    $('autoCheckInStatus').textContent = !auto?.enabled ? 'Off' : locked ? 'Paused — unlock storage to resume.' : auto.running ? 'Checking in…' : auto.lastError || (issues.length ? `Needs attention: ${issues.join(', ')}. Use Check in to see details.` : auto.lastAt ? `Last checked ${new Date(auto.lastAt).toLocaleString()}.` : 'Waiting for a connected account.');
    setRefreshState(state.syncing,locked);
    notice(state.lastError ? `Refresh issue: ${state.lastError}` : '');
    renderHistory(await api('/api/history'));
    if (isEventsPage) void loadEvents();
  } catch (error) { setRefreshState(false); notice(error.message); }
}
async function doSync() {
  setRefreshState(true);
  const previousDeadline = refreshSchedule?.nextRefreshAt;
  if (refreshSchedule?.nextRefreshAt && !refreshSchedule.locked) {
    refreshSchedule.nextRefreshAt = Date.now() + refreshSchedule.clockOffset + refreshSchedule.pollMinutes * 60_000;
    renderRefreshCountdown();
  }
  try { await api('/api/sync',{ method:'POST' }); await load(); }
  catch (error) {
    if (refreshSchedule) refreshSchedule.nextRefreshAt = previousDeadline;
    renderRefreshCountdown();
    setRefreshState(false);
    notice(error.message);
  }
}
async function saveSettings(payload) {
  try {
    await api('/api/settings',{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload) });
    $('hoyoCookie').value=''; $('hoyoUid').value=''; $('skportToken').value='';
    $('settings').hidden=true;
    await doSync();
  } catch (error) { notice(error.message); }
}
let checkInBusy = false;
$('checkIn').addEventListener('click',async()=>{
  if (checkInBusy) return;
  checkInBusy = true;
  $('checkIn').disabled = true;
  $('checkInLabel').textContent = 'Checking in…';
  const dialog = el('dialog','eventDialog checkInDialog');
  dialog.setAttribute('aria-labelledby','checkInTitle');
  const heading = el('h2','','Daily check-in'); heading.id = 'checkInTitle';
  const close = el('button','secondary','Close'); close.type='button'; close.addEventListener('click',()=>dialog.close());
  const top = el('div','eventDialogHeading'); top.append(heading,close); dialog.append(top);
  const results = el('div','checkInResults'); results.setAttribute('role','status'); results.setAttribute('aria-live','polite');
  const paint = games => {
    results.replaceChildren();
    for (const game of order) {
      const item = games?.[game];
      const row = el('div','checkInResult');
      const icon = el('span',`checkInMark ${item?.status || 'pending'}`,!item ? '…' : ['success','already'].includes(item.status) ? '✓' : item.status === 'not-connected' ? '—' : '!');
      icon.setAttribute('aria-hidden','true');
      const detail=el('div');detail.append(el('strong','',names[game]),el('p','',item?.message || 'Checking in…'));
      if(item?.link && ['error','verification'].includes(item.status)) {
        const link=el('a','eventNoticeLink','Open official check-in'); link.href=item.link;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);
      }
      row.append(icon,detail);results.append(row);
    }
  };
  paint();dialog.append(results);
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();
  try { const data=await api('/api/check-in',{method:'POST'});paint(data.games); }
  catch(error) { results.replaceChildren(el('p','',error.message)); }
  finally { checkInBusy=false;$('checkInLabel').textContent='Check in';$('checkIn').disabled=!!refreshSchedule?.locked; }
});
$('sync').addEventListener('click',doSync);
function toggleSettings(show) {
  if (!$('security').hidden) { $('security').scrollIntoView({ behavior:'smooth' }); return; }
  $('settings').hidden=!show;
}
for (const button of document.querySelectorAll('[data-settings-panel]')) {
  button.addEventListener('click',()=>{
    for (const item of document.querySelectorAll('[data-settings-panel]')) {
      const selected = item === button;
      item.setAttribute('aria-pressed',String(selected));
      $(item.getAttribute('aria-controls')).hidden = !selected;
    }
  });
}
$('settingsToggle').addEventListener('click',()=>toggleSettings($('settings').hidden));
$('setupSettings').addEventListener('click',()=>toggleSettings(true));
$('closeSettings').addEventListener('click',()=>toggleSettings(false));
$('securityForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const passphrase = $('passphrase').value;
  if (!$('confirmLabel').hidden && passphrase !== $('confirmPassphrase').value) { notice('Passwords do not match'); return; }
  try {
    await api('/api/unlock',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ passphrase }) });
    $('passphrase').value=''; $('confirmPassphrase').value='';
    await load();
  } catch (error) { notice(error.message); }
});
function updateCustomInterval() {
  const custom = $('pollMinutes').value === 'custom';
  $('customInterval').hidden = !custom;
  $('customPollMinutes').disabled = !custom;
  $('customPollMinutes').required = custom;
}
$('pollMinutes').addEventListener('change',updateCustomInterval);
$('settingsForm').addEventListener('submit',event=>{
  event.preventDefault();
  saveSettings({ hoyolabToken:$('hoyoCookie').value, hoyolabUid:$('hoyoUid').value,
    skportToken:$('skportToken').value,
    autoCheckIn:$('autoCheckIn').checked,
    pollMinutes:$('pollMinutes').value === 'custom' ? $('customPollMinutes').value : $('pollMinutes').value });
});
$('passwordForm').addEventListener('submit',async event => {
  event.preventDefault();
  const message = $('passwordMessage');
  if ($('newPassword').value !== $('confirmNewPassword').value) {
    message.textContent = 'New passwords do not match'; return;
  }
  $('changePasswordButton').disabled = true;
  message.textContent = 'Changing password…';
  try {
    await api('/api/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      currentPassword:$('currentPassword').value,newPassword:$('newPassword').value,confirmPassword:$('confirmNewPassword').value
    })});
    $('passwordForm').reset();
    message.textContent = 'Password changed. Use the new password next time you unlock.';
  } catch (error) { message.textContent = error.message; }
  finally { $('changePasswordButton').disabled = false; }
});
$('removeHoyo').addEventListener('click',()=>saveSettings({removeHoyo:true}));
$('removeSkport').addEventListener('click',()=>saveSettings({removeSkport:true}));
const backgroundDefaults = {preset:'default',color:'#172238',dim:65,artwork:''};
const backgroundArtworks = [{"id":"endfield-5","name":"Akekuri","url":"https://static.skport.com/image/rm42wiki/20260209/8777262936189/6989708fb59b336dfc6dcd07_6ad0f152.png","title":"Rising Star of Tomorrow","artist":"Illustrator: Kaneni","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=5","potential":5,"image":"/assets/endfield-backgrounds/5.webp","thumbnail":"/assets/endfield-backgrounds/5-thumb.webp"},{"id":"endfield-18","name":"Alesh","url":"https://static.skport.com/image/rm42wiki/20260209/3864465401225/698984aad17996f494b21712_3eac6ad0.png","title":"Rod Casting Day","artist":"Illustrator: w3","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=18","potential":5,"image":"/assets/endfield-backgrounds/18.webp","thumbnail":"/assets/endfield-backgrounds/18-thumb.webp"},{"id":"endfield-22","name":"Antal","url":"https://static.skport.com/image/rm42wiki/20260209/8777262936189/698973c6f37fc130be6d4fc2_3eac6ad0.png","title":"A New Zenith","artist":"Illustrator: 言犬","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=22","potential":5,"image":"/assets/endfield-backgrounds/22.webp","thumbnail":"/assets/endfield-backgrounds/22-thumb.webp"},{"id":"endfield-1040","name":"Arcane","url":"https://static.skport.com/image/rm42wiki/20260716/7192618399447/6a5889979650be7342500bb1_f1525633.png","title":"Blade Personified","artist":"Illustrator: Eteru","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1040","potential":5,"image":"/assets/endfield-backgrounds/1040.webp","thumbnail":"/assets/endfield-backgrounds/1040-thumb.webp"},{"id":"endfield-7","name":"Arclight","url":"https://static.skport.com/image/rm42wiki/20260209/6743194780021/698975633ac8f7cc9f5ff186_13673ac9.png","title":"Crescent Scimitar","artist":"Illustrator: Z3zz","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=7","potential":5,"image":"/assets/endfield-backgrounds/7.webp","thumbnail":"/assets/endfield-backgrounds/7-thumb.webp"},{"id":"endfield-19","name":"Ardelia","url":"https://static.skport.com/image/rm42wiki/20251223/7192618399447/694986f6a9c53e6bc81a3581.png","title":"Aspiration","artist":"Illustrator: Eteru","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=19","potential":5,"image":"/assets/endfield-backgrounds/19.webp","thumbnail":"/assets/endfield-backgrounds/19-thumb.webp"},{"id":"endfield-10","name":"Avywenna","url":"https://static.skport.com/image/rm42wiki/20260109/2452982252316/69608e65a1c4dd69df7d68c1.png","title":"Mystery Invite","artist":"Illustrator: LM7","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=10","potential":5,"image":"/assets/endfield-backgrounds/10.webp","thumbnail":"/assets/endfield-backgrounds/10-thumb.webp"},{"id":"endfield-996","name":"Camille","url":"https://static.skport.com/image/rm42wiki/20260627/3864465401225/6a3f3656337a110681967b7f_f1525633.png","title":"Shadowbreak","artist":"Illustrator: se_eeeee","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=996","potential":5,"image":"/assets/endfield-backgrounds/996.webp","thumbnail":"/assets/endfield-backgrounds/996-thumb.webp"},{"id":"endfield-23","name":"Catcher","url":"https://static.skport.com/image/rm42wiki/20260209/2452982252316/698985bab6de7bab4a628d3e_3eac6ad0.png","title":"Shield to Fall Back On","artist":"Illustrator: かしまき","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=23","potential":5,"image":"/assets/endfield-backgrounds/23.webp","thumbnail":"/assets/endfield-backgrounds/23-thumb.webp"},{"id":"endfield-4","name":"Chen Qianyu","url":"https://static.skport.com/image/rm42wiki/20260210/9890336793612/698a8191d17996f494b21df9_db193eac.png","title":"Soaring Lung","artist":"Illustrator: 宇木敦哉","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=4","potential":5,"image":"/assets/endfield-backgrounds/4.webp","thumbnail":"/assets/endfield-backgrounds/4-thumb.webp"},{"id":"endfield-8","name":"Da Pan","url":"https://static.skport.com/image/rm42wiki/20260209/1585539418668/6989b5350840b837fd8ac4b9_13673ac9.png","title":"All the Tastes of Life","artist":"Illustrator: 黑犬","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=8","potential":5,"image":"/assets/endfield-backgrounds/8.webp","thumbnail":"/assets/endfield-backgrounds/8-thumb.webp"},{"id":"endfield-15","name":"Ember","url":"https://static.skport.com/image/rm42wiki/20260210/9890336793612/698a81f93fb66c352bddf9ea_2f76db19.png","title":"The Bastion Never Breached","artist":"Illustrator: MoooFoo","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=15","potential":5,"image":"/assets/endfield-backgrounds/15.webp","thumbnail":"/assets/endfield-backgrounds/15-thumb.webp"},{"id":"endfield-21","name":"Estella","url":"https://static.skport.com/image/rm42wiki/20260209/6743194780021/698975ae5f99bed94f19579b_6ad0f152.png","title":"Secret Hour","artist":"Illustrator: かしまき","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=21","potential":5,"image":"/assets/endfield-backgrounds/21.webp","thumbnail":"/assets/endfield-backgrounds/21-thumb.webp"},{"id":"endfield-24","name":"Fluorite","url":"https://static.skport.com/image/rm42wiki/20260209/7040428526148/698982f4d17996f494b21706_3eac6ad0.png","title":"Gray Fringes of the Rules","artist":"Illustrator: Doppel","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=24","potential":5,"image":"/assets/endfield-backgrounds/24.webp","thumbnail":"/assets/endfield-backgrounds/24-thumb.webp"},{"id":"endfield-9","name":"Gilberta","url":"https://static.skport.com/image/rm42wiki/20260111/7192618399447/69638b0be868cec3d80810a5.png","title":"Let's Flip the World","artist":"Illustrator: LM7","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=9","potential":5,"image":"/assets/endfield-backgrounds/9.webp","thumbnail":"/assets/endfield-backgrounds/9-thumb.webp"},{"id":"endfield-11","name":"Laevatain","url":"https://static.skport.com/image/rm42wiki/20251230/7192618399447/69531a3a9931ee14c9cbb5a1.png","title":"An Invite to the Melting Fire","artist":"Illustrator: min","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=11","potential":5,"image":"/assets/endfield-backgrounds/11.webp","thumbnail":"/assets/endfield-backgrounds/11-thumb.webp"},{"id":"endfield-17","name":"Last Rite","url":"https://static.skport.com/image/rm42wiki/20260104/7887973031859/695a81f93d5589184a985010.png","title":"First Rime to Bloom","artist":"Illustrator: REM","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=17","potential":5,"image":"/assets/endfield-backgrounds/17.webp","thumbnail":"/assets/endfield-backgrounds/17-thumb.webp"},{"id":"endfield-12","name":"Lifeng","url":"https://static.skport.com/image/rm42wiki/20260209/1585539418668/6989b6ab9694f43a50155ffc_db193eac.png","title":"Heart of Youth","artist":"Illustrator: Eteru","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=12","potential":5,"image":"/assets/endfield-backgrounds/12.webp","thumbnail":"/assets/endfield-backgrounds/12-thumb.webp"},{"id":"endfield-1041","name":"Liino","url":"https://static.skport.com/image/rm42wiki/20260809/6743194780021/6a78150be9384335dcb1e20e_3eac6ad0.png","title":"Heart-Whipping Practice","artist":"Illustrator: pako","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1041","potential":5,"image":"/assets/endfield-backgrounds/1041.webp","thumbnail":"/assets/endfield-backgrounds/1041-thumb.webp"},{"id":"endfield-995","name":"Mi Fu","url":"https://static.skport.com/image/rm42wiki/20260605/2452982252316/6a225101337a110681960c98_6ad0f152.png","title":"Toast to Joy","artist":"Illustrator: 萃_SUIKA","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=995","potential":5,"image":"/assets/endfield-backgrounds/995.webp","thumbnail":"/assets/endfield-backgrounds/995-thumb.webp"},{"id":"endfield-1","name":"Perlica","url":"https://static.skport.com/image/rm42wiki/20260209/7040428526148/69898283febfc4b8cb403be9_3eac6ad0.png","title":"The Future","artist":"Illustrator: IRple2","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1","potential":5,"image":"/assets/endfield-backgrounds/1.webp","thumbnail":"/assets/endfield-backgrounds/1-thumb.webp"},{"id":"endfield-20","name":"Pogranichnik","url":"https://static.skport.com/image/rm42wiki/20260209/8777262936189/698971336bfd999cb9d0463c_3eac6ad0.png","title":"Checkmate","artist":"Illustrator: 大明","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=20","potential":5,"image":"/assets/endfield-backgrounds/20.webp","thumbnail":"/assets/endfield-backgrounds/20-thumb.webp"},{"id":"endfield-1174","name":"Purrchena","url":"https://static.skport.com/image/rm42wiki/20260924/7192618399447/6ab4cd4aa03f3aa857d19540_3eac6ad0.png","title":"Moment of a Beautiful Dream","artist":"Illustrator: とびはち","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1174","potential":5,"image":"/assets/endfield-backgrounds/1174.webp","thumbnail":"/assets/endfield-backgrounds/1174-thumb.webp"},{"id":"endfield-615","name":"Rossi","url":"https://static.skport.com/image/rm42wiki/20260330/2452982252316/69c9ef5f7c2305399ff6de81_6ad0f152.png","title":"A World at the Tip of the Pen","artist":"Illustrator: Yukuso","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=615","potential":5,"image":"/assets/endfield-backgrounds/615.webp","thumbnail":"/assets/endfield-backgrounds/615-thumb.webp"},{"id":"endfield-1278","name":"Si","url":"https://static.skport.com/image/rm42wiki/20261016/6743194780021/6ad168b4be8f5e2663682182_13673ac9.png","title":"Untainted","artist":"Illustrator: 수줍(Sjoop)","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1278","potential":5,"image":"/assets/endfield-backgrounds/1278.webp","thumbnail":"/assets/endfield-backgrounds/1278-thumb.webp"},{"id":"endfield-16","name":"Snowshine","url":"https://static.skport.com/image/rm42wiki/20260114/7887973031859/696709a86c326a83dea2ea66.png","title":"Carving Through the Snow","artist":"Illustrator: LAL!ROLE","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=16","potential":5,"image":"/assets/endfield-backgrounds/16.webp","thumbnail":"/assets/endfield-backgrounds/16-thumb.webp"},{"id":"endfield-25","name":"Tangtang","url":"https://static.skport.com/image/rm42wiki/20260314/2020668606652/69b5599f04c7f0cc116731f2_13673ac9.png","title":"Supreme Chief's Orders are Supreme","artist":"Illustrator: 수줍(Sjoop)","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=25","potential":5,"image":"/assets/endfield-backgrounds/25.webp","thumbnail":"/assets/endfield-backgrounds/25-thumb.webp"},{"id":"endfield-1173","name":"Typhoeus","url":"https://static.skport.com/image/rm42wiki/20260903/7040428526148/6a991695e6c4787f27a24b68_56331367.png","title":"Deep in the Icefield She Glances","artist":"Illustrator: LM7","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=1173","potential":5,"image":"/assets/endfield-backgrounds/1173.webp","thumbnail":"/assets/endfield-backgrounds/1173-thumb.webp"},{"id":"endfield-6","name":"Wulfgard","url":"https://static.skport.com/image/rm42wiki/20260209/3864465401225/69898564d17996f494b21716_db193eac.png","title":"Predator's Glance","artist":"Illustrator: FE","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=6","potential":5,"image":"/assets/endfield-backgrounds/6.webp","thumbnail":"/assets/endfield-backgrounds/6-thumb.webp"},{"id":"endfield-13","name":"Xaihi","url":"https://static.skport.com/image/rm42wiki/20260209/9299653219345/6989a43b0840b837fd8ac43d_2f76db19.png","title":"Gaze Long into Veritas","artist":"Illustrator: se_eeeee","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=13","potential":5,"image":"/assets/endfield-backgrounds/13.webp","thumbnail":"/assets/endfield-backgrounds/13-thumb.webp"},{"id":"endfield-14","name":"Yvonne","url":"https://static.skport.com/image/rm42wiki/20260209/1585539418668/6989b76ad17996f494b21865_3eac6ad0.png","title":"Win-Win!","artist":"Illustrator: u介","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=14","potential":5,"image":"/assets/endfield-backgrounds/14.webp","thumbnail":"/assets/endfield-backgrounds/14-thumb.webp"},{"id":"endfield-838","name":"Zhuang Fangyi","url":"https://static.skport.com/image/rm42wiki/20260507/7887973031859/69fc3bc09650be73424ee62e_f1525633.png","title":"Forged and Finalized","artist":"Illustrator: LM7","source":"https://wiki.skport.com/endfield/detail?mainTypeId=1&subTypeId=1&gameEntryId=838","potential":5,"image":"/assets/endfield-backgrounds/838.webp","thumbnail":"/assets/endfield-backgrounds/838-thumb.webp"}];
const backgroundColors = {midnight:'#070b13',blue:'#0b1b32',forest:'#0b211c',plum:'#24142c'};
let backgroundPreferences = {...backgroundDefaults};
let backgroundFile = null;
let backgroundBitmap = null;
let backgroundImageColor = '#172238';
let backgroundFileName = '';
let backgroundImageVersion = 0;
function backgroundDatabase() {
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open('tracker-appearance',1);
    request.onupgradeneeded = ()=>request.result.createObjectStore('settings');
    request.onsuccess = ()=>resolve(request.result);
    request.onerror = ()=>reject(request.error);
  });
}
async function backgroundStorage(write = false) {
  const db = await backgroundDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const transaction = db.transaction('settings',write ? 'readwrite' : 'readonly');
      const store = transaction.objectStore('settings');
      const request = write ? store.put({preferences:backgroundPreferences,image:backgroundFile,name:backgroundFileName},'background') : store.get('background');
      let result;
      request.onsuccess = ()=>{result = request.result;};
      transaction.oncomplete = ()=>resolve(result);
      transaction.onerror = ()=>reject(transaction.error);
      transaction.onabort = ()=>reject(transaction.error || new Error('Storage operation cancelled'));
    });
  } finally { db.close(); }
}
function updateBackgroundControls() {
  $('backgroundPreset').value = backgroundPreferences.preset;
  $('backgroundColor').value = backgroundPreferences.color;
  $('backgroundColorLabel').hidden = backgroundPreferences.preset !== 'custom';
  $('backgroundPreset').querySelector('option[value="image"]').disabled = !backgroundBitmap;
  $('backgroundDim').value = backgroundPreferences.dim;
  $('backgroundDimValue').textContent = `${backgroundPreferences.dim}%`;
  $('backgroundFileName').textContent = backgroundFile ? backgroundFileName || 'Saved image' : 'No image selected · JPG, PNG or WebP, up to 16 MB';
  $('removeBackgroundImage').disabled = !backgroundFile;
  for (const button of $('backgroundGalleryGrid').querySelectorAll('button')) button.setAttribute('aria-pressed',String(button.dataset.artwork === backgroundPreferences.artwork));
}
function applyColorPalette() {
  const root = document.documentElement;
  const hex = backgroundPreferences.preset === 'image' ? backgroundImageColor : backgroundPreferences.preset === 'custom' ? backgroundPreferences.color : backgroundPreferences.preset === 'default' ? '#0c101b' : backgroundColors[backgroundPreferences.preset];
  const channels = [1,3,5].map(index=>parseInt(hex.slice(index,index+2),16) / 255);
  const max = Math.max(...channels), min = Math.min(...channels), delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2*lightness-1));
  let hue = delta === 0 ? 220 : max === channels[0] ? ((channels[1]-channels[2])/delta)%6 : max === channels[1] ? (channels[2]-channels[0])/delta+2 : (channels[0]-channels[1])/delta+4;
  hue = delta === 0 ? 220 : (hue*60+360)%360;
  const light = backgroundPreferences.preset !== 'image' && lightness > .72;
  const sat = saturation < .08 ? 0 : Math.max(18,Math.min(48,saturation*100));
  // Keep the palette within neighboring hues: background → panels → controls.
  const shiftedHue = offset=>Math.round((hue + offset + 360) % 360);
  const tone = (level,weight = 1,offset = 0)=>`hsl(${shiftedHue(offset)} ${Math.round(sat*weight)}% ${level}%)`;
  const accent = level=>`hsl(${shiftedHue(30)} ${sat === 0 ? 0 : 64}% ${level}%)`;
  const palette = {
    'page-bg':tone(light?96:7,1,-15),'surface':tone(light?99:12,.8),'panel':tone(light?98:13,.8,10),
    'surface-low':tone(light?94:9,.75,-5),'field':tone(light?100:7,.7,5),'field-button':tone(light?88:23,.8,20),
    text:tone(light?12:95,.3),'text-soft':tone(light?23:82,.4),muted:tone(light?35:69,.35),faint:tone(light?40:61,.3),
    placeholder:tone(light?44:57,.3),border:tone(light?74:28,.65,15),
    primary:accent(light?32:77),'primary-hover':accent(light?26:84),'primary-ink':tone(light?100:10,.5),
    'primary-soft':accent(light?34:76),'ink-rgb':light?'20,25,35':'245,248,255',
    'inset-rgb':light?'222,226,233':'4,8,14',danger:light?'#a32639':'#f3a4ad',warning:light?'#805313':'#edc78c',
    line:light?'rgba(20,25,35,.14)':'rgba(245,248,255,.12)'
  };
  for (const [key,value] of Object.entries(palette)) root.style.setProperty('--'+key,value);
  // Resolve separate neighboring colors for translucent accents and background glow.
  const swatch = document.createElement('canvas');
  swatch.width = swatch.height = 1;
  const sample = swatch.getContext('2d');
  sample.fillStyle = accent(light?32:77);
  sample.fillRect(0,0,1,1);
  const rgb = [...sample.getImageData(0,0,1,1).data].slice(0,3).join(',');
  root.style.setProperty('--primary-rgb',rgb);
  sample.fillStyle = tone(light?45:45,1,-15);
  sample.fillRect(0,0,1,1);
  root.style.setProperty('--glow-rgb',[...sample.getImageData(0,0,1,1).data].slice(0,3).join(','));
  root.dataset.themeMode = light ? 'light' : 'dark';
}
function drawBackground() {
  const canvas = $('backgroundCanvas');
  applyColorPalette();
  document.body.style.background = '';
  document.body.classList.toggle('hasBackgroundImage',!!backgroundBitmap);
  canvas.hidden = !backgroundBitmap;
  if (!backgroundBitmap) { canvas.width = 1; canvas.height = 1; return; }
  // Match the actual fixed background box, including mobile browser chrome.
  const viewport = canvas.getBoundingClientRect();
  const viewportWidth = Math.max(1,viewport.width);
  const viewportHeight = Math.max(1,viewport.height);
  const scale = Math.min(window.devicePixelRatio || 1,2,2560 / Math.max(viewportWidth,viewportHeight));
  canvas.width = Math.max(1,Math.round(viewportWidth * scale));
  canvas.height = Math.max(1,Math.round(viewportHeight * scale));
  const context = canvas.getContext('2d');
  // Crop equal amounts from opposite edges to fill every screen without stretching.
  const aspect = canvas.width / canvas.height;
  const sourceWidth = Math.min(backgroundBitmap.width,backgroundBitmap.height * aspect);
  const sourceHeight = Math.min(backgroundBitmap.height,backgroundBitmap.width / aspect);
  context.drawImage(backgroundBitmap,
    (backgroundBitmap.width-sourceWidth)/2,(backgroundBitmap.height-sourceHeight)/2,
    sourceWidth,sourceHeight,0,0,canvas.width,canvas.height);
  const overlay = document.documentElement.dataset.themeMode === 'light' ? '245,247,250' : '12,16,27';
  context.fillStyle = `rgba(${overlay},${backgroundPreferences.dim / 100})`;
  context.fillRect(0,0,canvas.width,canvas.height);
}
function extractBackgroundColor(bitmap) {
  // Sample once per image. Favor colorful pixels so white space and black line art
  // don't drown out the illustration's dominant color.
  const sample = document.createElement('canvas');
  sample.width = sample.height = 64;
  const context = sample.getContext('2d',{willReadFrequently:true});
  context.drawImage(bitmap,0,0,64,64);
  const pixels = context.getImageData(0,0,64,64).data;
  const buckets = Array.from({length:36},()=>({weight:0,r:0,g:0,b:0}));
  let neutral = 0, neutralWeight = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const [r,g,b,alpha] = pixels.slice(i,i+4);
    if (alpha < 128) continue;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), chroma = max-min;
    neutral += (r+g+b)/3; neutralWeight++;
    if (chroma < 24 || max < 35 || min > 225) continue;
    let hue = max === r ? ((g-b)/chroma)%6 : max === g ? (b-r)/chroma+2 : (r-g)/chroma+4;
    hue = (hue*60+360)%360;
    const weight = (chroma/255)**2 * (alpha/255);
    const bucket = buckets[Math.floor(hue/10)%36];
    bucket.weight += weight; bucket.r += r*weight; bucket.g += g*weight; bucket.b += b*weight;
  }
  let best = null;
  for (let i = 0; i < buckets.length; i++) {
    const group = [-1,0,1].map(offset=>buckets[(i+offset+36)%36]);
    const combined = group.reduce((sum,b)=>({weight:sum.weight+b.weight,r:sum.r+b.r,g:sum.g+b.g,b:sum.b+b.b}),{weight:0,r:0,g:0,b:0});
    if (!best || combined.weight > best.weight) best = combined;
  }
  const channels = best.weight > 0 ? [best.r,best.g,best.b].map(value=>Math.round(value/best.weight)) : Array(3).fill(Math.round(neutralWeight ? neutral/neutralWeight : 100));
  return '#'+channels.map(value=>value.toString(16).padStart(2,'0')).join('');
}
async function setBackgroundImage(file,name = '',artwork = '',matchPalette = true) {
  const version = ++backgroundImageVersion;
  if (!file) {
    backgroundBitmap?.close(); backgroundBitmap = null; backgroundFile = null; backgroundFileName = '';
    if (backgroundPreferences.preset === 'image') backgroundPreferences.preset = 'default';
  } else {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG or WebP image.');
    if (file.size > 16 * 1024 * 1024) throw new Error('Choose an image smaller than 16 MB.');
    const original = await createImageBitmap(file);
    let next = original;
    const maximum = Math.max(original.width,original.height);
    if (maximum > 2560) {
      try { next = await createImageBitmap(original,{resizeWidth:Math.max(1,Math.round(original.width * 2560 / maximum)),resizeHeight:Math.max(1,Math.round(original.height * 2560 / maximum)),resizeQuality:'high'}); }
      finally { original.close(); }
    }
    if (version !== backgroundImageVersion) { next.close(); return; }
    backgroundBitmap?.close(); backgroundBitmap = next; backgroundFile = file; backgroundFileName = name;
    backgroundImageColor = extractBackgroundColor(next);
    if (matchPalette) backgroundPreferences.preset = 'image';
  }
  backgroundPreferences.artwork = artwork;
  updateBackgroundControls(); drawBackground();
}
async function restoreBackground() {
  try {
    const saved = await backgroundStorage();
    if (saved) {
      const preferences = saved.preferences || {};
      backgroundPreferences = {
        preset:['default','custom','image',...Object.keys(backgroundColors)].includes(preferences.preset) ? preferences.preset : 'default',
        color:/^#[0-9a-f]{6}$/i.test(preferences.color) ? preferences.color : backgroundDefaults.color,
        dim:Number.isFinite(preferences.dim) ? Math.max(0,Math.min(90,preferences.dim)) : backgroundDefaults.dim
      };
      await setBackgroundImage(saved.image || null,saved.name || '',backgroundArtworks.some(art=>art.id === preferences.artwork) ? preferences.artwork : '',false);
    }
  } catch { $('backgroundMessage').textContent = 'Saved appearance could not be loaded. You can choose a new one below.'; }
  updateBackgroundControls(); drawBackground();
}
function previewBackground() {
  backgroundPreferences.preset = $('backgroundPreset').value;
  backgroundPreferences.color = $('backgroundColor').value;
  backgroundPreferences.dim = Number($('backgroundDim').value);
  updateBackgroundControls(); drawBackground();
  $('backgroundMessage').textContent = 'Previewing changes. Select Save appearance to keep them.';
}
function renderBackgroundGallery() {
  const query = $('backgroundSearch').value.trim().toLocaleLowerCase();
  const artworks = backgroundArtworks.filter(art=>`${art.name} ${art.title}`.toLocaleLowerCase().includes(query));
  const buttons = artworks.map(art=>{
    const button = el('button','backgroundChoice');
    button.type = 'button'; button.dataset.artwork = art.id;
    button.setAttribute('aria-pressed',String(art.id === backgroundPreferences.artwork));
    button.setAttribute('aria-label',`Use ${art.name} background`);
    const image = el('img');
    image.src = art.thumbnail; image.alt = ''; image.loading = 'lazy'; image.decoding = 'async'; image.width = 360; image.height = 180;
    button.append(image,el('span','',art.name),el('small','',art.title));
    return button;
  });
  $('backgroundGalleryGrid').replaceChildren(...buttons);
  $('backgroundGalleryEmpty').hidden = artworks.length !== 0;
}
$('backgroundGallery').addEventListener('toggle',()=>{if ($('backgroundGallery').open) renderBackgroundGallery();});
$('backgroundSearch').addEventListener('input',renderBackgroundGallery);
$('backgroundGalleryGrid').addEventListener('click',async event=>{
  const button = event.target.closest('button[data-artwork]');
  if (!button) return;
  const artwork = backgroundArtworks.find(art=>art.id === button.dataset.artwork);
  if (!artwork) return;
  const version = ++backgroundImageVersion;
  $('saveBackground').disabled = true;
  $('backgroundMessage').textContent = `Loading ${artwork.name} artwork…`;
  try {
    const response = await fetch(artwork.image);
    if (!response.ok) throw new Error('Could not load this background. Please try again.');
    const image = await response.blob();
    if (version !== backgroundImageVersion) return;
    await setBackgroundImage(image,`${artwork.name} · ${artwork.title}`,artwork.id);
    $('backgroundMessage').textContent = `Previewing ${artwork.name}. Select Save appearance to keep it.`;
  } catch (error) { if (version === backgroundImageVersion) $('backgroundMessage').textContent = error.message; }
  finally { $('saveBackground').disabled = false; }
});
$('backgroundPreset').addEventListener('change',previewBackground);
$('backgroundColor').addEventListener('input',previewBackground);
$('backgroundDim').addEventListener('input',previewBackground);
$('backgroundFile').addEventListener('change',async event=>{
  const file = event.target.files[0];
  if (!file) return;
  try {
    await setBackgroundImage(file,file.name);
    $('backgroundMessage').textContent = 'Previewing image. Select Save appearance to keep it.';
  } catch (error) { $('backgroundMessage').textContent = error.message; }
  event.target.value = '';
});
$('removeBackgroundImage').addEventListener('click',async()=>{
  await setBackgroundImage(null);
  $('backgroundMessage').textContent = 'Image removed from preview. Select Save appearance to keep this change.';
});
$('backgroundForm').addEventListener('submit',async event=>{
  event.preventDefault();
  $('saveBackground').disabled = true;
  try { await backgroundStorage(true); $('backgroundMessage').textContent = 'Appearance saved in this browser.'; }
  catch { $('backgroundMessage').textContent = 'Could not save the appearance. Check browser storage permissions and available space.'; }
  finally { $('saveBackground').disabled = false; }
});
$('resetBackground').addEventListener('click',async()=>{
  backgroundPreferences = {...backgroundDefaults};
  await setBackgroundImage(null);
  try { await backgroundStorage(true); $('backgroundMessage').textContent = 'Default appearance restored.'; }
  catch { $('backgroundMessage').textContent = 'Default appearance restored for this page, but could not be saved.'; }
});
let backgroundResizeFrame = null;
function scheduleBackgroundResize() {
  if (backgroundResizeFrame !== null) cancelAnimationFrame(backgroundResizeFrame);
  backgroundResizeFrame = requestAnimationFrame(()=>{backgroundResizeFrame = null; if (backgroundBitmap) drawBackground();});
}
window.addEventListener('resize',scheduleBackgroundResize);
window.addEventListener('orientationchange',scheduleBackgroundResize);
window.visualViewport?.addEventListener('resize',scheduleBackgroundResize);
const backgroundSizeObserver = new ResizeObserver(scheduleBackgroundResize);
backgroundSizeObserver.observe($('backgroundCanvas'));
await restoreBackground();
await load();
if (isEventsPage) setInterval(renderEvents,60_000);
setInterval(renderRefreshCountdown,60_000);
setInterval(updateResourceTimers,60_000);
setInterval(load,60_000);
