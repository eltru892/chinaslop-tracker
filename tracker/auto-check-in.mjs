// Poll the providers' own daily status instead of guessing their reset timezone.
// A successful/already completed check-in is skipped by the check-in service.
export function createAutoCheckInScheduler({run, intervalMs=60*60_000, setTimer=setTimeout, clearTimer=clearTimeout, now=Date.now}) {
  let enabled=false, timer=null, generation=0, running=false;
  let nextAt=null, lastAt=null, lastResult=null, lastError=null;
  async function tick(version) {
    if (!enabled || version !== generation) return;
    running=true; nextAt=null;
    try { lastResult=await run(); lastError=null; }
    catch { lastError='Automatic check-in could not complete. It will retry in one hour.'; }
    finally {
      running=false;lastAt=now();
      if (enabled && version===generation) {
        nextAt=now()+intervalMs;
        timer=setTimer(()=>tick(version),intervalMs);timer?.unref?.();
      }
    }
  }
  return {
    configure(value) {
      if (enabled===value) return;
      enabled=value;generation++;
      if(timer!==null)clearTimer(timer);
      timer=null;nextAt=null;
      if(enabled)void tick(generation);
    },
    state:()=>({running,nextAt,lastAt,lastResult,lastError})
  };
}
