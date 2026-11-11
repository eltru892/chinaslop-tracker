use crate::{model::*, provider::*};
use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use regex::Regex;
use reqwest::header::{HeaderMap, HeaderValue};
use serde_json::{Value, json};
use std::collections::HashSet;
pub struct Calendar {
    pub events: Vec<Event>,
    pub region: String,
    pub note: String,
}
pub fn event_time(value: &Value, game: &str, region: &str) -> Option<DateTime<Utc>> {
    if value.is_object() {
        let offset = FixedOffset::east_opt(server_offset(game, region)? * 3600)?;
        return offset
            .with_ymd_and_hms(
                value["year"].as_i64()? as i32,
                value["month"].as_u64()? as u32,
                value["day"].as_u64()? as u32,
                value["hour"].as_u64().unwrap_or(0) as u32,
                value["minute"].as_u64().unwrap_or(0) as u32,
                value["second"].as_u64().unwrap_or(0) as u32,
            )
            .single()
            .map(|t| t.with_timezone(&Utc));
    }
    if let Some(stamp) = number(value, "").filter(|n| *n > 0.0) {
        return DateTime::from_timestamp_millis(if stamp < 1e12 {
            (stamp * 1000.0) as i64
        } else {
            stamp as i64
        });
    }
    DateTime::parse_from_rfc3339(value.as_str()?)
        .ok()
        .map(|t| t.with_timezone(&Utc))
}
pub fn safe_image(value: &str) -> String {
    reqwest::Url::parse(value)
        .ok()
        .filter(|u| u.scheme() == "https" && u.username().is_empty() && u.password().is_none())
        .map(|u| u.to_string())
        .unwrap_or_default()
}
fn clean(value: &str) -> String {
    Regex::new("<[^>]*>")
        .unwrap()
        .replace_all(value, " ")
        .replace("&amp;", "&")
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn key(value: &str) -> String {
    clean(value)
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}
fn items(value: &Value) -> impl Iterator<Item = &Value> {
    value.as_array().into_iter().flatten()
}
fn first<'a>(value: &'a Value, paths: &[&str]) -> &'a Value {
    paths
        .iter()
        .map(|p| at(value, p))
        .find(|v| !v.is_null())
        .unwrap_or(&Value::Null)
}
pub fn normalize(game: &str, data: &Value, region: &str, now: DateTime<Utc>) -> Result<Vec<Event>> {
    let list = &data[if game == "zzz" {
        "activity_list"
    } else {
        "act_list"
    }];
    if !list.is_array() {
        return Err("The official calendar response format has changed.".into());
    }
    let mut events = vec![];
    let mut add = |item: &Value, name: String, category: &str, image: String| {
        let start = event_time(
            first(
                item,
                &[
                    "start_timestamp",
                    "start_ts",
                    "time_info.start_ts",
                    "begin_time",
                    "hadal_begin_time",
                    "start_time",
                ],
            ),
            game,
            region,
        );
        let end = event_time(
            first(
                item,
                &[
                    "end_timestamp",
                    "end_ts",
                    "time_info.end_ts",
                    "end_time",
                    "hadal_end_time",
                ],
            ),
            game,
            region,
        );
        if let (Some(start), Some(end)) = (start, end)
            && start <= now
            && end > now
            && end > start
            && !name.trim().is_empty()
        {
            events.push(Event {
                name: clean(&name),
                category: category.into(),
                start,
                end,
                image: safe_image(&image),
                source: "https://act.hoyolab.com/app/community-game-records-sea/".into(),
            });
        }
    };
    for item in items(list) {
        add(
            item,
            text(item, "name"),
            "Event",
            text(first(item, &["image_url", "banner_url", "icon"]), ""),
        );
    }
    for item in items(
        &data[if game == "genshin" {
            "fixed_act_list"
        } else {
            "challenge_list"
        }],
    ) {
        add(
            item,
            text(first(item, &["name_mi18n", "name"]), ""),
            "Challenge",
            text(first(item, &["image_url", "icon"]), ""),
        );
    }
    let definitions: &[(&str, &str, &str)] = match game {
        "genshin" => &[
            ("avatar_card_pool_list", "avatars", "Character banner"),
            ("weapon_card_pool_list", "weapon", "Weapon banner"),
            ("mixed_card_pool_list", "avatars", "Chronicled Wish"),
        ],
        "hsr" => &[
            ("avatar_card_pool_list", "avatar_list", "Character banner"),
            ("equip_card_pool_list", "equip_list", "Light Cone banner"),
        ],
        _ => &[
            ("avatar_gacha_schedule_list", "avatar_list", "Agent banner"),
            (
                "weapon_gacha_schedule_list",
                "weapon_list",
                "W-Engine banner",
            ),
        ],
    };
    let gacha = if game == "zzz" {
        &data["gacha_calendar"]
    } else {
        data
    };
    for (field, featured, kind) in definitions {
        for item in items(&gacha[*field]) {
            let all: Vec<_> = items(&item[*featured]).collect();
            let mut top: Vec<_> = all
                .iter()
                .copied()
                .filter(|v| matches!(text(v, "rarity").as_str(), "S" | "5"))
                .collect();
            if top.is_empty() {
                top = all;
            }
            let names = top
                .iter()
                .map(|v| text(first(v, &["avatar_name", "item_name", "name"]), ""))
                .filter(|n| !n.is_empty())
                .collect::<Vec<_>>()
                .join(" / ");
            let mut title = text(first(item, &["pool_name", "name"]), "");
            if title.is_empty() {
                title = names;
            }
            let mut image = text(first(item, &["image_url", "banner_url"]), "");
            if image.is_empty()
                && let Some(entry) = top.first()
            {
                image = text(first(entry, &["icon", "icon_url", "item_url"]), "");
            }
            add(item, format!("{title} — {kind}"), "Banner", image);
        }
    }
    if let Some(challenges) = data["challenge_calendars"].as_object() {
        for (name, body) in challenges {
            let info = match name.as_str() {
                "Threshold Simulation" => &body["void_front_battle_abstract_info_brief"],
                "Shiyu Defense" => {
                    if body["hadal_info_v2"].is_object() {
                        &body["hadal_info_v2"]
                    } else {
                        body
                    }
                }
                _ => body,
            };
            add(info, name.clone(), "Challenge", text(info, "image_url"));
        }
    }
    let mut seen = HashSet::new();
    events.retain(|e| seen.insert((e.name.clone(), e.start, e.end)));
    events.sort_by_key(|e| e.end);
    Ok(events)
}
pub fn load(
    provider: &Provider,
    account: &Account,
    game: &str,
    selected: &str,
) -> Result<Calendar> {
    if game == "endfield" {
        return endfield(
            provider,
            if selected.is_empty() {
                "Asia"
            } else {
                selected
            },
        );
    }
    let cards = provider.cards(account)?;
    let id = match game {
        "genshin" => 2,
        "hsr" => 6,
        _ => 8,
    };
    let card = items(&cards["list"])
        .find(|r| r["game_id"] == id)
        .ok_or("No linked character found.")?;
    let mut uid = text(card, "game_role_id");
    let mut region = text(card, "region");
    if !selected.is_empty() && selected != region {
        let biz = match game {
            "genshin" => "hk4e_global",
            "hsr" => "hkrpg_global",
            _ => "nap_global",
        };
        let roles = checked(
            provider.request(
                &query(
                    "https://api-os-takumi.hoyolab.com/binding/api/getUserGameRolesByCookie",
                    &[("game_biz", biz)],
                ),
                hoyo_headers(account, false)?,
                None,
                false,
            )?,
            true,
        )?;
        let role = items(&roles["list"])
            .find(|r| text(r, "region") == selected)
            .ok_or("No linked character on this server. Select your account server.")?;
        uid = text(role, "game_uid");
        region = selected.into();
    }
    let headers = hoyo_headers(account, game == "hsr")?;
    let url = match game {
        "genshin" => format!("{HOYO}/event/game_record/genshin/api/act_calendar"),
        "hsr" => query(
            "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/get_act_calender",
            &[("role_id", &uid), ("server", &region)],
        ),
        _ => query(
            &format!("{HOYO}/event/game_record_zzz/api/zzz/activity_calendar"),
            &[("uid", &uid), ("region", &region)],
        ),
    };
    let body = (game == "genshin").then(|| {
        json!({
        "role_id":uid,"server":region
        }
        )
    });
    let mut data = checked(provider.request(&url, headers.clone(), body, false)?, true)?;
    let mut unavailable = vec![];
    if game == "zzz" {
        let base = "https://sg-act-nap-api.hoyolab.com/event/game_record_zzz/api/zzz/";
        let feeds = [
            (
                "Banners",
                format!("{HOYO}/event/game_record_zzz/api/zzz/gacha_calendar"),
            ),
            ("Deadly Assault", format!("{base}mem_detail")),
            (
                "Threshold Simulation",
                format!("{base}void_front_battle_period_abstract_info"),
            ),
            ("Shiyu Defense", format!("{base}hadal_info_v2")),
            ("Annihilation Simulacrum", format!("{base}holo_boss_detail")),
        ];
        data["challenge_calendars"] = json!({});
        let results = std::thread::scope(|scope| {
            let jobs: Vec<_> = feeds
                .iter()
                .map(|(name, url)| {
                    let headers = headers.clone();
                    let uid = &uid;
                    let region = &region;
                    scope.spawn(move || {
                        let fields = if *name == "Shiyu Defense" {
                            vec![
                                ("role_id", uid.as_str()),
                                ("server", region.as_str()),
                                ("without_v2_detail", "true"),
                                ("lang", "en-us"),
                                ("schedule_type", "1"),
                            ]
                        } else {
                            vec![
                                ("uid", uid.as_str()),
                                ("region", region.as_str()),
                                ("lang", "en-us"),
                                ("schedule_type", "1"),
                            ]
                        };
                        checked(
                            provider.request(&query(url, &fields), headers, None, false)?,
                            true,
                        )
                    })
                })
                .collect();
            jobs.into_iter()
                .map(|j| {
                    j.join()
                        .unwrap_or_else(|_| Err("Calendar worker failed.".into()))
                })
                .collect::<Vec<_>>()
        });
        for ((name, _), result) in feeds.iter().zip(results) {
            match result {
                Ok(body) => {
                    if *name == "Banners" {
                        data["gacha_calendar"] = body;
                    } else {
                        data["challenge_calendars"][*name] = body;
                    }
                }
                Err(_) => unavailable.push(*name),
            }
        }
    }
    let mut events = normalize(game, &data, &region, Utc::now())?;
    if events.iter().any(|e| e.image.is_empty()) {
        let mut posts = vec![];
        for kind in [1, 2, 3] {
            let mut headers = HeaderMap::new();
            headers.insert("x-rpc-language", HeaderValue::from_static("en-us"));
            let url = query(
                "https://bbs-api-os.hoyolab.com/community/post/wapi/getNewsList",
                &[
                    ("gids", &id.to_string()),
                    ("type", &kind.to_string()),
                    ("page_size", "50"),
                ],
            );
            if let Ok(body) = provider
                .request(&url, headers, None, false)
                .and_then(|b| checked(b, true))
            {
                posts.extend(items(&body["list"]).cloned());
            }
        }
        for event in events.iter_mut().filter(|e| e.image.is_empty()) {
            let title = key(event.name.split(" — ").next().unwrap_or(&event.name));
            if title.len() < 6 {
                continue;
            }
            if let Some(post) = posts
                .iter()
                .filter(|p| key(&text(p, "post.subject")).contains(&title))
                .min_by_key(|p| text(p, "post.subject").len())
            {
                let mut image = text(&post["image_list"][0], "url");
                if image.is_empty() {
                    image = text(post, "post.cover");
                }
                event.image = safe_image(&image);
            }
        }
    }
    Ok(Calendar {
        events,
        region,
        note: if unavailable.is_empty() {
            String::new()
        } else {
            format!("Unavailable schedules: {}", unavailable.join(", "))
        },
    })
}
pub fn parse_endfield(notices: &[Value], region: &str, now: DateTime<Utc>) -> Result<Vec<Event>> {
    if !servers("endfield").contains(&region) {
        return Err("Choose an Endfield server.".into());
    }
    let offset = FixedOffset::east_opt(if region == "Asia" {
        8 * 3600
    } else {
        -5 * 3600
    })
    .unwrap();
    let date_regex =
        Regex::new(r"(?i)\b([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s+at\s+(\d{1,2}):(\d{2})")
            .unwrap();
    let dates = |line: &str| -> Vec<DateTime<Utc>> {
        date_regex
            .captures_iter(line)
            .filter_map(|m| {
                let month = [
                    "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov",
                    "dec",
                ]
                .iter()
                .position(|n| m[1].to_lowercase().starts_with(n))?
                    + 1;
                offset
                    .with_ymd_and_hms(
                        m[3].parse().ok()?,
                        month as u32,
                        m[2].parse().ok()?,
                        m[4].parse().ok()?,
                        m[5].parse().ok()?,
                        0,
                    )
                    .single()
                    .map(|t| t.with_timezone(&Utc))
            })
            .collect()
    };
    let break_tags = Regex::new(r"(?i)</(?:p|div|h[1-6])>|<br\s*/?>").unwrap();
    let heading_regex = Regex::new(r"^\d+\.\s*").unwrap();
    let time_regex =
        Regex::new(r"(?i)^(?:·\s*)?(?:Event Time|Availability|Season Update):").unwrap();
    let unconfirmed =
        Regex::new(r"(?i)Before (?:the next )?version update|ends after \d|maintenance$").unwrap();
    let after_update = Regex::new(r"(?i)After \[.+\] version update\s*[–—-]").unwrap();
    let bracket = Regex::new(r"\[([^\]]+)\]").unwrap();
    let nested = Regex::new(r"(?i)^(\[[^\]]+\]) limited-time challenge event will").unwrap();
    let mut events = vec![];
    for notice in notices.iter().filter(|n| {
        text(n, "title")
            .to_lowercase()
            .ends_with("version update notes")
    }) {
        let html = text(notice, "data");
        let lines: Vec<String> = break_tags
            .replace_all(&html, "\n")
            .lines()
            .map(clean)
            .filter(|l| !l.is_empty())
            .collect();
        let patch = lines
            .iter()
            .find(|l| l.starts_with(&format!("{region} Server:")))
            .and_then(|l| dates(l).last().copied());
        let mut heading = String::new();
        let mut parent = String::new();
        for (i, line) in lines.iter().enumerate() {
            if heading_regex.is_match(line) {
                heading = heading_regex.replace(line, "").into();
                parent = heading.clone();
            }
            if let Some(part) = line.strip_prefix('○')
                && part.starts_with('[')
            {
                heading = format!("{parent} — {part}");
            }
            if let Some(m) = nested.captures(line) {
                heading = format!("{} Challenge Event", &m[1]);
            }
            if heading.is_empty() || !time_regex.is_match(line) {
                continue;
            }
            let mut timing = line.as_str();
            if time_regex.replace(line, "").trim().is_empty() {
                let following: Vec<_> = lines.iter().skip(i + 1).take(5).collect();
                let Some(at) = following
                    .iter()
                    .position(|s| **s == format!("{region} Server:"))
                else {
                    continue;
                };
                let Some(next) = following.get(at + 1) else {
                    continue;
                };
                timing = next;
            }
            if unconfirmed.is_match(timing) {
                continue;
            }
            let stamps = dates(timing);
            let pair = if stamps.len() >= 2 {
                Some((stamps[0], stamps[1]))
            } else if stamps.len() == 1 && after_update.is_match(timing) {
                patch.map(|p| (p, stamps[0]))
            } else {
                None
            };
            let Some((start, end)) = pair else {
                continue;
            };
            if start > now || end <= now || end <= start {
                continue;
            }
            let title = bracket
                .captures(&heading)
                .map(|m| m[1].to_string())
                .unwrap_or_else(|| heading.clone());
            let art = notices.iter().find(|n| {
                n["cid"] != notice["cid"] && key(&text(n, "title")).contains(&key(&title))
            });
            let lower = heading.to_lowercase();
            let category = if lower.contains("headhunting") || lower.contains("issue") {
                "Banner"
            } else if lower.contains("challenge") || lower.contains("echoes of war") {
                "Challenge"
            } else {
                "Event"
            };
            events.push(Event {
                name: heading.clone(),
                category: category.into(),
                start,
                end,
                image: art
                    .map(|n| safe_image(&text(n, "cover")))
                    .unwrap_or_default(),
                source: format!(
                    "https://endfield.gryphline.com/en-us/news/{}",
                    text(notice, "cid")
                ),
            });
        }
    }
    let mut seen = HashSet::new();
    events.retain(|e| seen.insert((e.name.clone(), e.start, e.end)));
    events.sort_by_key(|e| e.end);
    Ok(events)
}
fn endfield(provider: &Provider, region: &str) -> Result<Calendar> {
    let base = "https://web-news.gryphline.com/api/bulletin";
    let fields = [
        ("lang", "en-us"),
        ("code", "arknights_endfield_official"),
        ("page", "1"),
        ("pageSize", "50"),
    ];
    let body = checked(
        provider.request(&query(base, &fields), HeaderMap::new(), None, false)?,
        false,
    )?;
    let mut notices: Vec<_> = items(&body["list"]).cloned().collect();
    let patches: Vec<_> = notices
        .iter()
        .filter(|n| text(n, "title").ends_with("Version Update Notes"))
        .take(4)
        .cloned()
        .collect();
    if patches.is_empty() {
        return Err("No official English schedules found.".into());
    }
    for patch in patches {
        let body = checked(
            provider.request(
                &query(&format!("{base}/{}", text(&patch, "cid")), &fields),
                HeaderMap::new(),
                None,
                false,
            )?,
            false,
        )?;
        notices.push(body);
    }
    Ok(Calendar {
        events: parse_endfield(&notices, region, Utc::now())?,
        region: region.into(),
        note: "Official English notices; only confirmed end dates are included.".into(),
    })
}
