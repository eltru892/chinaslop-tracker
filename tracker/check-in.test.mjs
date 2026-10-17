import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckInService } from './check-in.mjs';
import { skportSignature } from './collector.mjs';
const config={hoyolabCookie:'ltuid_v2=fake; ltoken_v2=fake',skportToken:'fake-account-token'};
function mock({signed=false,claimCode=0,risk=null,skSigned=false,skClaimCode=0}={}) {
  const calls=[];
  const states = new Map();let skDone=skSigned;
  const fetchJSON=async(url,options={})=>{
    calls.push({url,options});
    if(url.includes('gryphline.com'))return {status:0,data:{code:'fake-grant'}};
    if(url.includes('generate_cred'))return {code:0,data:{cred:'fake-cred',token:'fake-salt'}};
    if(url.includes('/binding'))return {code:0,data:{list:[{appCode:'endfield',bindingList:[{defaultRole:{roleId:'fake-role',serverId:'2'}}]}]}};
    if(url.includes('/attendance')) {
      if(options.method==='POST') {skDone=skClaimCode===0;return {code:skClaimCode};}
      return {code:0,data:{hasToday:skDone}};
    }
    const act=new URL(url).searchParams.get('act_id');
    if(url.includes('/sign?')) {
      if(claimCode===0 && !risk)states.set(act,true);
      return {retcode:claimCode,data:risk ? {gt_result:risk} : {}};
    }
    return {retcode:0,data:{is_sign:states.get(act) || signed}};
  };
  return {calls,fetchJSON};
}
test('claims each game through its own official service and confirms success',async()=>{
  const {calls,fetchJSON}=mock();const data=await createCheckInService(fetchJSON)(config,true);
  assert.deepEqual(Object.values(data.games).map(x=>x.status),['success','success','success','success']);
  const posts=calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,6);
  for(const {url,options} of calls) {
    if(url.includes('hoyolab.com')) {assert.equal(options.headers.Cookie,config.hoyolabCookie);assert.equal(options.headers.cred,undefined);}
    else assert.equal(options.headers?.Cookie,undefined);
  }
  const sk=posts.find(x=>x.url.endsWith('/attendance'));
  assert.equal(sk.options.body,undefined);assert.equal(sk.options.headers['sk-game-role'],'3_fake-role_2');
  assert.equal(sk.options.headers.sign,skportSignature('fake-salt','/web/v1/game/endfield/attendance','',sk.options.headers.timestamp).sign);
  assert.equal(JSON.stringify(data).includes('fake-'),false);
});
test('already claimed games never send a reward claim',async()=>{
  const {calls,fetchJSON}=mock({signed:true,skSigned:true});const data=await createCheckInService(fetchJSON)(config,true);
  assert.ok(Object.values(data.games).every(x=>x.status==='already'));
  assert.equal(calls.filter(c=>c.options.method==='POST' && /\/sign\?|\/attendance$/.test(c.url)).length,0);
});
test('read-only status never sends a claim and missing connections do not call APIs',async()=>{
  const {calls,fetchJSON}=mock();const service=createCheckInService(fetchJSON);
  assert.ok(Object.values((await service(config)).games).every(x=>x.status==='available'));
  assert.equal(calls.some(c=>c.options.method==='POST' && /\/sign\?|\/attendance$/.test(c.url)),false);
  calls.length=0;assert.ok(Object.values((await service({},true)).games).every(x=>x.status==='not-connected'));assert.equal(calls.length,0);
});
test('CAPTCHA, duplicate, expired cookies, and unconfirmed results are handled',async()=>{
  for(const [options,expected] of [[{risk:{risk_code:1,gt:'challenge'}},'verification'],[{claimCode:-5003},'already'],[{claimCode:-100},'error']]) {
    const {fetchJSON}=mock(options);const data=await createCheckInService(fetchJSON)({hoyolabCookie:config.hoyolabCookie},true);
    assert.ok(['genshin','hsr','zzz'].every(g=>data.games[g].status===expected));
  }
  const data=await createCheckInService(async()=>({retcode:0,data:{is_sign:false}}))({hoyolabCookie:'fake'},true);assert.equal(data.games.hsr.status,'error');
});
test('upstream failures are isolated and never return raw secrets',async()=>{
  const {fetchJSON}=mock();
  const data=await createCheckInService((url,options)=>url.includes('sg-hk4e') ? Promise.reject(new Error('secret=fake-private-token')):fetchJSON(url,options))(config,true);
  assert.equal(data.games.genshin.status,'error');assert.equal(data.games.hsr.status,'success');assert.equal(data.games.endfield.status,'success');assert.equal(JSON.stringify(data).includes('fake-private-token'),false);
});
test('simultaneous clicks share one claim operation',async()=>{
  const {calls,fetchJSON}=mock();const service=createCheckInService(fetchJSON);const first=service(config,true),second=service(config,true);
  assert.equal(first,second);await Promise.all([first,second]);assert.equal(calls.filter(c=>c.url.includes('/sign?')).length,3);
});
