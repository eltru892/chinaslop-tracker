use crate::model::*;
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, Mac};
use md5::{Digest, Md5};
use rand::Rng;
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{Value, json};
use sha2::Sha256;
use std::sync::Arc;
pub const HOYO: &str = "https://sg-act-public-api.hoyolab.com";
pub const SKPORT: &str = "https://zonai.skport.com";
pub type Progress = Arc<dyn Fn(String) + Send + Sync>;
pub type Result<T> = std::result::Result<T, String>;
#[derive(Clone)]
pub struct Provider {
    client: Client,
}
impl Provider {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(20))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build().map_err(|_| "Could not initialize networking.")?;
        Ok(Self { client })
    }
    // Headers are owned by each request; no shared cookie jar exists between accounts.
    pub fn request(
        &self,
        url: &str,
        headers: HeaderMap,
        body: Option<Value>,
        post: bool,
    ) -> Result<Value> {
        let mut request = if post || body.is_some() {
            self.client.post(url)
        } else {
            self.client.get(url)
        };
        request = request.headers(headers);
        if let Some(body) = body {
            request = request.json(&body);
        } else if post {
            request = request.header("Content-Type", "application/json").body("");
        }
        let response = request
            .send()
            .map_err(|_| "Request failed or timed out. Check your connection.")?;
        if !response.status().is_success() {
            return Err(format!(
                "Provider returned HTTP {}.",
                response.status().as_u16()
            ));
        }
        response
            .json()
            .map_err(|_| "Provider returned an unreadable response.".into())
    }
    pub fn collect(&self, account: &Account, progress: Progress) -> Vec<Snapshot> {
        std::thread::scope(|scope| {
            let hoyo = scope.spawn(|| self.fetch_hoyo(account, progress.clone()));
            let endfield = scope.spawn(|| self.fetch_endfield(account, progress.clone()));
            let mut results = hoyo.join().unwrap_or_else(|_| {
                GAMES[..3]
                    .iter()
                    .map(|g| Snapshot::failure(g, "Provider worker failed."))
                    .collect()
            });
            results.push(
                endfield
                    .join()
                    .unwrap_or_else(|_| Snapshot::failure("endfield", "Provider worker failed.")),
            );
            results
        })
    }
    pub fn cards(&self, account: &Account) -> Result<Value> {
        if account.hoyo_id.is_empty() || account.hoyo_token.is_empty() {
            return Err("Connect HoYoLAB in Settings.".into());
        }
        checked(
            self.request(
                &query(
                    &format!("{HOYO}/game_record/card/wapi/getGameRecordCard"),
                    &[("uid", &account.hoyo_id)],
                ),
                hoyo_headers(account, false)?,
                None,
                false,
            )?,
            true,
        )
    }
    fn fetch_hoyo(&self, account: &Account, progress: Progress) -> Vec<Snapshot> {
        progress("HoYoLAB linked accounts…".into());
        let cards = match self.cards(account) {
            Ok(cards) => cards,
            Err(error) => {
                return GAMES[..3]
                    .iter()
                    .map(|g| Snapshot::failure(g, &error))
                    .collect();
            }
        };
        let definitions = [
            (
                "genshin",
                2,
                format!("{HOYO}/event/game_record/genshin/api/dailyNote"),
            ),
            (
                "hsr",
                6,
                "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note".into(),
            ),
            (
                "zzz",
                8,
                format!("{HOYO}/event/game_record_zzz/api/zzz/note"),
            ),
        ];
        std::thread::scope(|scope| {
            let jobs: Vec<_> = definitions
                .iter()
                .map(|(game, id, endpoint)| {
                    let progress = progress.clone();
                    let cards = &cards;
                    scope.spawn(move || {
                        let run = || -> Result<Snapshot> {
                            let role = cards["list"]
                                .as_array()
                                .and_then(|list| {
                                    list.iter().find(|r| r["game_id"].as_i64() == Some(*id))
                                })
                                .ok_or("No linked game role found.")?;
                            progress(format!("Fetching {}…", game_name(game)));
                            let url = query(
                                endpoint,
                                &[
                                    ("server", &text(role, "region")),
                                    ("role_id", &text(role, "game_role_id")),
                                ],
                            );
                            let data = checked(
                                self.request(
                                    &url,
                                    hoyo_headers(account, *game == "hsr")?,
                                    None,
                                    false,
                                )?,
                                true,
                            )?;
                            Ok(normalize(
                                game,
                                &data,
                                &text(role, "nickname"),
                                &text(role, "game_role_id"),
                                &text(role, "region"),
                                Utc::now(),
                            ))
                        };
                        run().unwrap_or_else(|e| Snapshot::failure(game, &e))
                    })
                })
                .collect();
            jobs.into_iter()
                .enumerate()
                .map(|(i, j)| {
                    j.join()
                        .unwrap_or_else(|_| Snapshot::failure(GAMES[i], "Game worker failed."))
                })
                .collect()
        })
    }
    pub fn authenticate_skport(&self, account: &Account, progress: &Progress) -> Result<SkContext> {
        if account.skport_token.trim().is_empty() {
            return Err("Connect SKPORT in Settings.".into());
        }
        let token = parse_skport_token(&account.skport_token)?;
        progress("SKPORT authorization…".into());
        let grant = checked(
            self.request(
                "https://as.gryphline.com/user/oauth2/v2/grant",
                HeaderMap::new(),
                Some(json!({
                "appCode":"6eb76d4e13aa36e6","token":token,"type":0
                }
                )),
                true,
            )?,
            false,
        )?;
        let auth = checked(
            self.request(
                &format!("{SKPORT}/web/v1/user/auth/generate_cred_by_code"),
                HeaderMap::new(),
                Some(json!({
                "code":grant["code"],"kind":1
                }
                )),
                true,
            )?,
            false,
        )?;
        progress("SKPORT linked accounts…".into());
        let path = "/api/v1/game/player/binding";
        let cred = text(&auth, "cred");
        let salt = text(&auth, "token");
        let binding = checked(
            self.request(
                &format!("{SKPORT}{path}"),
                sk_headers(&cred, &salt, path, "")?,
                None,
                false,
            )?,
            false,
        )?;
        let group = binding["list"]
            .as_array()
            .and_then(|list| list.iter().find(|a| a["appCode"] == "endfield"))
            .and_then(|app| app["bindingList"].get(0))
            .ok_or("No linked Endfield account.")?;
        let role = if group["defaultRole"].is_object() {
            group["defaultRole"].clone()
        } else {
            group["roles"]
                .get(0)
                .cloned()
                .ok_or("No Endfield role found.")?
        };
        Ok(SkContext {
            cred,
            salt,
            role_key: format!("3_{}_{}", text(&role, "roleId"), text(&role, "serverId")),
            role,
        })
    }
    fn fetch_endfield(&self, account: &Account, progress: Progress) -> Snapshot {
        let run = || -> Result<Snapshot> {
            let auth = self.authenticate_skport(account, &progress)?;
            progress("Fetching Endfield progress…".into());
            let path = "/api/v1/game/endfield/card/detail";
            let data = checked(
                self.request(
                    &format!("{SKPORT}{path}"),
                    sk_headers(&auth.cred, &auth.salt, path, &auth.role_key)?,
                    None,
                    false,
                )?,
                false,
            )?;
            let mut region = text(&auth.role, "serverName");
            if region.is_empty() {
                region = text(&auth.role, "serverId");
            }
            Ok(normalize(
                "endfield",
                &data["detail"],
                &text(&auth.role, "nickname"),
                &text(&auth.role, "roleId"),
                &region,
                Utc::now(),
            ))
        };
        run().unwrap_or_else(|e| Snapshot::failure("endfield", &e))
    }
}
pub struct SkContext {
    pub cred: String,
    pub salt: String,
    pub role_key: String,
    pub role: Value,
}
pub fn parse_skport_token(input: &str) -> Result<String> {
    if input.trim().starts_with('{') {
        let body: Value = serde_json::from_str(input).map_err(|_| "Invalid SKPORT JSON.")?;
        let token = text(&body, "data.content");
        if token.is_empty() {
            return Err("No data.content token in that response.".into());
        }
        Ok(token)
    } else {
        Ok(input.trim().to_string())
    }
}
pub fn query(base: &str, fields: &[(&str, &str)]) -> String {
    let mut url = reqwest::Url::parse(base).expect("static provider endpoint");
    url.query_pairs_mut().extend_pairs(fields.iter().copied());
    url.to_string()
}
pub fn checked(body: Value, hoyo: bool) -> Result<Value> {
    let valid = if hoyo {
        body["retcode"] == 0
    } else {
        body["code"] == 0 || body["status"] == 0
    };
    if !valid {
        // Never echo arbitrary upstream messages, which could include submitted credentials.
        let code = if hoyo {
            &body["retcode"]
        } else if !body["code"].is_null() {
            &body["code"]
        } else {
            &body["status"]
        };
        return Err(format!(
            "{} rejected the request (code {}). Check the saved connection.",
            if hoyo { "HoYoLAB" } else { "SKPORT" },
            code.as_i64().map_or("unknown".into(), |c| c.to_string())
        ));
    }
    Ok(body["data"].clone())
}
fn headers(pairs: &[(&str, String)]) -> Result<HeaderMap> {
    let mut result = HeaderMap::new();
    for (key, value) in pairs {
        result.insert(
            HeaderName::from_bytes(key.as_bytes()).map_err(|_| "Invalid header.")?,
            HeaderValue::from_str(value)
                .map_err(|_| "Saved credentials contain invalid characters.")?,
        );
    }
    Ok(result)
}
pub fn hoyo_headers(account: &Account, signed: bool) -> Result<HeaderMap> {
    let mut result = headers(&[
        (
            "cookie",
            format!(
                "ltuid_v2={}; ltoken_v2={}",
                account.hoyo_id, account.hoyo_token
            ),
        ),
        ("x-rpc-client_type", "5".into()),
        ("x-rpc-language", "en-us".into()),
        ("x-rpc-lang", "en-us".into()),
        ("origin", "https://act.hoyolab.com".into()),
        ("referer", "https://act.hoyolab.com/".into()),
    ])?;
    if signed {
        let timestamp = Utc::now().timestamp();
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        let random: String = (0..6)
            .map(|_| alphabet[rand::rng().random_range(0..alphabet.len())] as char)
            .collect();
        let signature = hex::encode(Md5::digest(format!(
            "salt=6s25p5ox5y14umn1p61aqyyvbvvl3lrt&t={timestamp}&r={random}"
        )));
        result.insert(
            "ds",
            HeaderValue::from_str(&format!("{timestamp},{random},{signature}")).unwrap(),
        );
        result.insert("x-rpc-app_version", HeaderValue::from_static("1.5.0"));
    }
    Ok(result)
}
pub fn sk_signature(salt: &str, path: &str, timestamp: &str) -> String {
    let header =
        format!(r#"{{"platform":"3","timestamp":"{timestamp}","dId":"","vName":"1.0.0"}}"#);
    let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(salt.as_bytes()).expect("HMAC key");
    mac.update(format!("{path}{timestamp}{header}").as_bytes());
    hex::encode(Md5::digest(hex::encode(mac.finalize().into_bytes())))
}
pub fn sk_headers(cred: &str, salt: &str, path: &str, role: &str) -> Result<HeaderMap> {
    let timestamp = Utc::now().timestamp().to_string();
    let mut h = headers(&[
        ("cred", cred.into()),
        ("timestamp", timestamp.clone()),
        ("sign", sk_signature(salt, path, &timestamp)),
        ("platform", "3".into()),
        ("vName", "1.0.0".into()),
        ("sk-language", "en".into()),
    ])?;
    if !role.is_empty() {
        h.insert(
            "sk-game-role",
            HeaderValue::from_str(role).map_err(|_| "Invalid game role.")?,
        );
    }
    Ok(h)
}
pub fn normalize(
    game: &str,
    data: &Value,
    nickname: &str,
    uid: &str,
    region: &str,
    now: DateTime<Utc>,
) -> Snapshot {
    let mut snapshot = Snapshot::failure(game, "");
    snapshot.nickname = nickname.into();
    snapshot.uid = uid.into();
    snapshot.region = region.into();
    snapshot.observed_at = now;
    let mut seconds = None;
    let mut timestamp = None;
    match game {
        "genshin" => {
            snapshot.daily = vec![
                meter(
                    data,
                    "Daily commissions",
                    &[("finished_task_num", "total_task_num")],
                ),
                Meter {
                    label: "Extra reward".into(),
                    current: data["is_extra_task_reward_received"]
                        .as_bool()
                        .map(|b| if b { 1.0 } else { 0.0 }),
                    maximum: Some(1.0),
                },
            ];
            let limit = number(data, "resin_discount_num_limit");
            snapshot.weekly = vec![Meter {
                label: "Weekly boss discount used".into(),
                current: limit
                    .zip(number(data, "remain_resin_discount_num"))
                    .map(|(l, r)| l - r),
                maximum: limit,
            }];
            snapshot.resources = vec![meter(
                data,
                "Original Resin",
                &[("current_resin", "max_resin")],
            )];
            seconds = number(data, "resin_recovery_time");
        }
        "hsr" => {
            snapshot.daily = vec![meter(
                data,
                "Daily training",
                &[
                    ("current_train_score", "max_train_score"),
                    ("daily_training.current", "daily_training.max"),
                    ("daily_training.score", "daily_training.max_score"),
                    ("daily_active_score", "daily_active_max_score"),
                ],
            )];
            snapshot.weekly = vec![meter(
                data,
                "Universe weekly points",
                &[
                    ("current_rogue_score", "max_rogue_score"),
                    ("rogue_score", "rogue_max_score"),
                    ("rogue_score.score", "rogue_score.max_score"),
                    ("weekly_rogue_score", "weekly_rogue_max_score"),
                ],
            )];
            snapshot.resources = vec![
                meter(
                    data,
                    "Trailblaze Power",
                    &[("current_stamina", "max_stamina")],
                ),
                Meter {
                    label: "Reserved Power".into(),
                    current: number(data, "current_reserve_stamina"),
                    maximum: None,
                },
            ];
            seconds = number(data, "stamina_recover_time");
        }
        "zzz" => {
            snapshot.daily = vec![meter(
                data,
                "Daily engagement",
                &[
                    ("vitality.current", "vitality.max"),
                    ("engagement.current", "engagement.total"),
                    ("engagement.current", "engagement.max"),
                    ("daily_task.current", "daily_task.total"),
                    ("daily_task.score", "daily_task.max_score"),
                ],
            )];
            snapshot.weekly = vec![
                meter(
                    data,
                    "Bounty Commissions",
                    &[
                        ("bounty_commission.num", "bounty_commission.total"),
                        (
                            "hollow_zero.bounty_commission.num",
                            "hollow_zero.bounty_commission.total",
                        ),
                        ("bounty_commission.current", "bounty_commission.total"),
                        ("bounty_commission.score", "bounty_commission.max_score"),
                    ],
                ),
                meter(
                    data,
                    "Ridu Weekly",
                    &[
                        ("weekly_task.cur_point", "weekly_task.max_point"),
                        ("weekly_task.current", "weekly_task.total"),
                    ],
                ),
            ];
            snapshot.resources = vec![meter(
                data,
                "Battery Charge",
                &[
                    ("energy.progress.current", "energy.progress.max"),
                    ("energy.progress.current", "energy.progress.total"),
                    ("energy.current", "energy.max"),
                ],
            )];
            seconds = number(data, "energy.restore");
        }
        "endfield" => {
            snapshot.daily = vec![meter(
                data,
                "Daily activity",
                &[(
                    "dailyMission.dailyActivation",
                    "dailyMission.maxDailyActivation",
                )],
            )];
            snapshot.weekly = vec![meter(
                data,
                "Weekly routine",
                &[("weeklyMission.score", "weeklyMission.total")],
            )];
            snapshot.resources = vec![meter(
                data,
                "Sanity",
                &[("dungeon.curStamina", "dungeon.maxStamina")],
            )];
            timestamp = number(data, "dungeon.maxTs");
        }
        _ => {}
    }
    if snapshot.resources.first().is_some_and(Meter::complete) {
        snapshot.full_at = Some(now);
    } else if let Some(seconds) = seconds.filter(|s| *s > 0.0 && *s < 315_360_000.0) {
        snapshot.full_at = now.checked_add_signed(Duration::seconds(seconds as i64));
    } else if let Some(stamp) = timestamp.filter(|t| *t > 0.0) {
        snapshot.full_at = DateTime::from_timestamp_millis(if stamp < 1e12 {
            (stamp * 1000.0) as i64
        } else {
            stamp as i64
        });
    }
    snapshot
}
