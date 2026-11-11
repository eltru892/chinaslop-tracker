use crate::{model::*, provider::*};
use reqwest::header::HeaderValue;
use serde_json::json;
#[derive(Clone)]
pub struct CheckResult {
    pub game: String,
    pub complete: bool,
    pub message: String,
    pub link: String,
}
pub fn definition(game: &str) -> (&str, &str, &str, &str) {
    match game {
        "genshin" => (
            "https://sg-hk4e-api.hoyolab.com/event/sol",
            "e202102251931481",
            "gi",
            "https://act.hoyolab.com/ys/event/signin-sea-v3/index.html?act_id=e202102251931481",
        ),
        "hsr" => (
            "https://sg-public-api.hoyolab.com/event/luna/os",
            "e202303301540311",
            "hsr",
            "https://act.hoyolab.com/bbs/event/signin/hkrpg/index.html?act_id=e202303301540311",
        ),
        _ => (
            "https://sg-act-nap-api.hoyolab.com/event/luna/zzz/os",
            "e202406031448091",
            "zzz",
            "https://act.hoyolab.com/bbs/event/signin/zzz/e202406031448091.html",
        ),
    }
}
pub fn run(provider: &Provider, account: &Account, progress: Progress) -> Vec<CheckResult> {
    std::thread::scope(|scope| {
        let jobs: Vec<_> = GAMES
            .iter()
            .map(|game| {
                let progress = progress.clone();
                scope.spawn(move || {
                    let link = if *game == "endfield" {
                        "https://game.skport.com/endfield/sign-in"
                    } else {
                        definition(game).3
                    };
                    let result = if *game == "endfield" {
                        skport(provider, account, progress)
                    } else {
                        hoyo(provider, account, game)
                    };
                    match result {
                        Ok(message) => CheckResult {
                            game: game.to_string(),
                            complete: true,
                            message,
                            link: link.into(),
                        },
                        Err(message) => CheckResult {
                            game: game.to_string(),
                            complete: false,
                            message,
                            link: link.into(),
                        },
                    }
                })
            })
            .collect();
        jobs.into_iter()
            .enumerate()
            .map(|(i, job)| {
                job.join().unwrap_or_else(|_| CheckResult {
                    game: GAMES[i].into(),
                    complete: false,
                    message: "Check-in worker failed.".into(),
                    link: String::new(),
                })
            })
            .collect()
    })
}
fn hoyo(provider: &Provider, account: &Account, game: &str) -> Result<String> {
    if account.hoyo_token.is_empty() {
        return Err("Not connected".into());
    }
    let (base, act, sign, _) = definition(game);
    let mut headers = hoyo_headers(account, false)?;
    headers.insert("x-rpc-signgame", HeaderValue::from_str(sign).unwrap());
    let info = query(
        &format!("{base}/info"),
        &[("act_id", act), ("lang", "en-us")],
    );
    let status = checked(provider.request(&info, headers.clone(), None, false)?, true)?;
    match status["is_sign"].as_bool() {
        Some(true) => return Ok("Already checked in".into()),
        Some(false) => {}
        None => return Err("Attendance status unavailable. Open the official page.".into()),
    }
    let response = provider.request(
        &query(
            &format!("{base}/sign"),
            &[("act_id", act), ("lang", "en-us")],
        ),
        headers.clone(),
        Some(json!({
        "act_id":act,"lang":"en-us"
        }
        )),
        true,
    )?;
    let risk = if response["data"]["gt_result"].is_object() {
        &response["data"]["gt_result"]
    } else {
        &response["data"]
    };
    if number(risk, "risk_code").is_some_and(|n| n != 0.0)
        || !text(risk, "gt").is_empty()
        || !text(risk, "challenge").is_empty()
    {
        return Err("Verification required on the official check-in page.".into());
    }
    let confirmed = checked(provider.request(&info, headers, None, false)?, true)?;
    if confirmed["is_sign"] == true {
        Ok("Checked in successfully".into())
    } else {
        Err("Check-in sent, but completion was not confirmed. Open the official page.".into())
    }
}
fn skport(provider: &Provider, account: &Account, progress: Progress) -> Result<String> {
    let auth = provider.authenticate_skport(account, &progress)?;
    let path = "/web/v1/game/endfield/attendance";
    let headers = || -> Result<_> {
        let mut h = sk_headers(&auth.cred, &auth.salt, path, &auth.role_key)?;
        h.insert(
            "origin",
            HeaderValue::from_static("https://game.skport.com"),
        );
        h.insert(
            "referer",
            HeaderValue::from_static("https://game.skport.com/"),
        );
        Ok(h)
    };
    let url = format!("{SKPORT}{path}");
    let status = checked(provider.request(&url, headers()?, None, false)?, false)?;
    match status["hasToday"].as_bool() {
        Some(true) => return Ok("Already checked in".into()),
        Some(false) => {}
        None => return Err("Attendance status unavailable. Open SKPORT.".into()),
    }
    provider.request(&url, headers()?, None, true)?;
    let confirmed = checked(provider.request(&url, headers()?, None, false)?, false)?;
    if confirmed["hasToday"] == true {
        Ok("Checked in successfully".into())
    } else {
        Err("SKPORT did not confirm attendance. Open the official page.".into())
    }
}
