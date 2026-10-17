const {app,BrowserWindow,shell,dialog}=require('electron');
const {fork}=require('node:child_process');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const accessKey=randomBytes(32).toString('hex');
let child,window;
app.setName('Chinaslop Tracker');
const single=app.requestSingleInstanceLock();
if(!single)app.quit();
else {
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
  app.whenReady().then(()=>{
    const tracker=path.join(process.resourcesPath,'tracker');
    child=fork(path.join(tracker,'server.mjs'),[],{execPath:process.execPath,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PORT:'4318',TRACKER_ACCESS_KEY:accessKey,TRACKER_DATA_DIR:path.join(app.getPath('userData'),'tracker')},stdio:['ignore','ignore','ignore','ipc']});
    const timeout=setTimeout(()=>{dialog.showErrorBox('Could not start tracker','The local tracker did not start. Please close and reopen the app.');app.quit();},20000);
    child.once('message',async message=>{
      if(message.type!=='ready' || !Number.isInteger(message.port))return;
      clearTimeout(timeout);
      const origin=`http://127.0.0.1:${message.port}`;
      window=new BrowserWindow({width:1440,height:960,minWidth:380,minHeight:600,title:'Chinaslop Tracker',icon:path.join(tracker,'logo.png'),autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
      window.webContents.setWindowOpenHandler(({url})=>{if(/^https:\/\//.test(url))shell.openExternal(url);return {action:'deny'};});
      window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==origin){event.preventDefault();if(/^https:\/\//.test(url))shell.openExternal(url);}});
      window.webContents.session.setPermissionRequestHandler((_webContents,_permission,callback)=>callback(false));
      await window.webContents.session.cookies.set({url:origin,name:'tracker_session',value:accessKey,httpOnly:true,sameSite:'strict',path:'/'});
      window.loadURL(origin);
    });
    child.once('error',()=>{clearTimeout(timeout);dialog.showErrorBox('Could not start tracker','The bundled local server could not be started.');app.quit();});
    child.once('exit',()=>{if(!app.isQuitting){clearTimeout(timeout);dialog.showErrorBox('Tracker stopped','The local server stopped. Reopen the app to continue.');app.quit();}});
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{app.isQuitting=true;child?.kill();});
}
