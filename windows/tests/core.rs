use chinaslop_tracker_windows::{
    events,
    model::*,
    provider,
    storage::{self, History},
};

use chrono::{DateTime, Duration, Utc};

use serde_json::json;

fn time(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}

fn genshin() -> Snapshot {
    provider::normalize(
        "genshin",
        &json!({
        "current_resin":80,"max_resin":200,"resin_recovery_time":"57600","finished_task_num":4,"total_task_num":4,"is_extra_task_reward_received":true,"resin_discount_num_limit":3,"remain_resin_discount_num":1
        }
        ),
        "Lumine",
        "123",
        "os_usa",
        time("2026-11-09T12:00:00Z"),
    )
}

#[test]
fn resource_mapping_and_reward() {
    let s = genshin();

    assert_eq!(s.resources[0].current, Some(80.0));

    assert_eq!(s.daily[0].maximum, Some(4.0));

    assert!(s.daily[1].complete());

    assert_eq!(s.weekly[0].current, Some(2.0));

    assert_eq!(s.full_at, Some(s.observed_at + Duration::seconds(57600)));
}

#[test]
fn hsr_recovery_and_alternate_training() {
    let s = provider::normalize(
        "hsr",
        &json!({
        "current_stamina":100,"max_stamina":300,"stamina_recover_time":"72000","current_reserve_stamina":30,"daily_training":{
        "current":300,"max":500
        }

        }
        ),
        "Stelle",
        "2",
        "prod_official_usa",
        Utc::now(),
    );

    assert_eq!(s.daily[0].current, Some(300.0));

    assert_eq!(s.resources[1].current, Some(30.0));

    assert_eq!(s.full_at, Some(s.observed_at + Duration::seconds(72000)));
}

#[test]
fn zzz_official_weekly_terms() {
    let s = provider::normalize(
        "zzz",
        &json!({
        "energy":{
        "progress":{
        "current":100,"max":240
        }
        ,"restore":50400
        }
        ,"vitality":{
        "current":200,"max":400
        }
        ,"bounty_commission":{
        "num":2,"total":4
        }
        ,"weekly_task":{
        "cur_point":500,"max_point":1000
        }

        }
        ),
        "Belle",
        "3",
        "prod_gf_us",
        Utc::now(),
    );

    assert_eq!(s.resources[0].current, Some(100.0));

    assert_eq!(s.weekly[0].label, "Bounty Commissions");

    assert_eq!(s.weekly[1].label, "Ridu Weekly");
}

#[test]
fn endfield_absolute_time() {
    let s = provider::normalize(
        "endfield",
        &json!({
        "dungeon":{
        "curStamina":10,"maxStamina":240,"maxTs":"1794254400"
        }
        ,"dailyMission":{
        "dailyActivation":100,"maxDailyActivation":100
        }

        }
        ),
        "Endmin",
        "4",
        "Asia",
        Utc::now(),
    );

    assert_eq!(s.full_at, DateTime::from_timestamp(1794254400, 0));

    assert!(s.daily[0].complete());
}

#[test]
fn missing_progress_is_unavailable() {
    let s = provider::normalize("hsr", &json!({}), "", "", "", Utc::now());

    assert_eq!(s.resources[0].display(), "Unavailable");

    assert_eq!(s.full_at, None);

    assert_eq!(s.full_text(Utc::now()), "Full time unavailable");
}

#[test]
fn full_resource_needs_no_recovery() {
    let s = provider::normalize(
        "genshin",
        &json!({
        "current_resin":200,"max_resin":200
        }
        ),
        "",
        "",
        "",
        Utc::now(),
    );

    assert_eq!(s.full_text(Utc::now()), "Full");
}

#[test]
fn timers_do_not_show_seconds() {
    assert_eq!(duration(Duration::seconds(1)), "1m");

    assert_eq!(duration(Duration::minutes(61)), "1h 1m");

    assert_eq!(duration(Duration::seconds(-1)), "0m");

    assert_eq!(duration(Duration::hours(25)), "1d 1h 0m");
}

#[test]
fn daily_reset_server_offsets() {
    let now = time("2026-11-09T12:00:00Z");

    assert_eq!(
        reset("genshin", "os_usa", false, now),
        Some(time("2026-11-10T09:00:00Z"))
    );

    assert_eq!(
        reset("zzz", "prod_gf_jp", false, now),
        Some(time("2026-11-09T20:00:00Z"))
    );

    assert_eq!(server_offset("endfield", "Americas / Europe"), Some(-5));

    assert_eq!(reset("hsr", "unknown", false, now), None);
}

#[test]
fn reset_boundary_and_weekly() {
    assert_eq!(
        reset("zzz", "prod_gf_jp", false, time("2026-11-09T20:00:00Z")),
        Some(time("2026-11-10T20:00:00Z"))
    );

    assert_eq!(
        reset(
            "hsr",
            "prod_official_eur",
            true,
            time("2026-11-09T12:00:00Z")
        ),
        Some(time("2026-11-16T03:00:00Z"))
    );
}

#[test]
fn fixed_offsets_ignore_dst() {
    for day in ["2026-03-08T12:00:00Z", "2026-11-01T12:00:00Z"] {
        let result = reset("genshin", "os_usa", false, time(day)).unwrap();

        assert_eq!(result.format("%H:%M").to_string(), "09:00");
    }
}

#[test]
fn history_period_is_server_local() {
    let mut s = genshin();

    s.region = "os_asia".into();

    s.observed_at = time("2026-11-08T21:00:00Z");

    assert_eq!(period(&s, false), "2026-11-09");

    assert_eq!(period(&s, true), "2026-11-09");
}

#[test]
fn skport_signature_matches_reference() {
    assert_eq!(
        provider::sk_signature("test-salt", "/api/v1/game/player/binding", "1700000000"),
        "1e0bb5207c77d9e529bb149a00fa0dfb"
    );
}

#[test]
fn tokens_accept_json_not_missing_fields() {
    assert_eq!(
        provider::parse_skport_token(r#"{"data":{"content":"fake"}}"#).unwrap(),
        "fake"
    );

    assert!(provider::parse_skport_token("{}").is_err());

    assert_eq!(provider::parse_skport_token(" fake ").unwrap(), "fake");
}

#[test]
fn upstream_errors_do_not_echo_tokens() {
    let error = provider::checked(
        json!({
        "retcode":-100,"message":"secret-cookie"
        }
        ),
        true,
    )
    .unwrap_err();

    assert!(!error.contains("secret-cookie"));

    assert!(error.contains("-100"));
}

#[test]
fn header_injection_rejected() {
    let a = Account {
        hoyo_id: "1".into(),
        hoyo_token: "bad\r\nheader".into(),
        ..Default::default()
    };

    assert!(provider::hoyo_headers(&a, false).is_err());
}

#[test]
fn vault_roundtrip_and_random_nonce() {
    let key = [7u8; 32];

    let a = storage::encrypt(&key, b"secret-token").unwrap();

    let b = storage::encrypt(&key, b"secret-token").unwrap();

    assert_ne!(a, b);

    assert!(!a.windows(12).any(|w| w == b"secret-token"));

    assert_eq!(storage::decrypt(&key, &a).unwrap(), b"secret-token");
}

#[test]
fn vault_wrong_key_and_tampering_fail() {
    let key = [7u8; 32];

    let mut bytes = storage::encrypt(&key, b"private").unwrap();

    assert!(storage::decrypt(&[8; 32], &bytes).is_err());

    bytes[13] ^= 1;

    assert!(storage::decrypt(&key, &bytes).is_err());

    assert!(storage::decrypt(&key, &[1, 2]).is_err());
}

#[test]
fn history_isolates_accounts_and_paginates() {
    let dir = tempfile::tempdir().unwrap();

    let mut store = History::open(&dir.path().join("history.sqlite")).unwrap();

    let a = genshin();

    let mut b = a.clone();

    b.uid = "456".into();

    store.save(&[a.clone(), b]).unwrap();

    assert_eq!(store.accounts().unwrap().len(), 2);

    assert_eq!(store.read("", false, 0, 1).unwrap().0.len(), 1);

    assert_eq!(store.read("", false, 1, 1).unwrap().0.len(), 1);

    assert_eq!(store.read(&a.identity(), false, 0, 10).unwrap().1, 1);

    assert_eq!(store.read("", true, 0, 10).unwrap().1, 2);
}

#[test]
fn history_preserves_newest_and_skips_errors() {
    let dir = tempfile::tempdir().unwrap();

    let path = dir.path().join("history.sqlite");

    let mut store = History::open(&path).unwrap();

    let a = genshin();

    let mut later = a.clone();

    later.observed_at += Duration::minutes(1);

    later.daily[0].current = Some(3.0);

    store.save(&[later]).unwrap();

    store
        .save(&[a, Snapshot::failure("hsr", "offline")])
        .unwrap();

    assert_eq!(
        store.read("", false, 0, 10).unwrap().0[0].1.daily[0].current,
        Some(3.0)
    );

    drop(store);

    assert_eq!(History::open(&path).unwrap().accounts().unwrap().len(), 1);
}

#[test]
fn calendar_rejects_ambiguous_and_invalid_dates() {
    assert_eq!(
        events::event_time(&json!("2026-11-09 12:00:00"), "hsr", "prod_official_asia"),
        None
    );

    assert_eq!(
        events::event_time(
            &json!({
            "year":2026,"month":2,"day":30
            }
            ),
            "hsr",
            "prod_official_asia"
        ),
        None
    );

    assert_eq!(
        events::event_time(
            &json!({
            "year":2026,"month":11,"day":9,"hour":20
            }
            ),
            "hsr",
            "prod_official_asia"
        ),
        Some(time("2026-11-09T12:00:00Z"))
    );
}

#[test]
fn calendars_require_active_end_dated_events() {
    let now = time("2026-11-09T12:00:00Z");

    let data = json!({
    "act_list":[{
    "name":"Active","start_timestamp":1794142800i64,"end_timestamp":1794402000i64
    }
    ,{
    "name":"Undated","start_timestamp":1794142800i64
    }
    ,{
    "name":"Ended","start_timestamp":1794000000i64,"end_timestamp":1794100000i64
    }
    ,{
    "name":"Upcoming","start_timestamp":1894142800i64,"end_timestamp":1894402000i64
    }
    ]
    }
    );

    let list = events::normalize("genshin", &data, "os_usa", now).unwrap();

    assert_eq!(list.len(), 1);

    assert_eq!(list[0].name, "Active");
}

#[test]
fn official_endfield_server_dates() {
    let notice = json!({
    "cid":"p","title":"Example Version Update Notes","data":"<p>1. [Test Event]</p><p>Event Time: Nov 8, 2026 at 04:00 – Nov 12, 2026 at 04:00</p><p>2. [Undated]</p><p>Event Time: Before the next version update</p>"
    }
    );

    let list = events::parse_endfield(&[notice], "Americas / Europe", time("2026-11-09T12:00:00Z"))
        .unwrap();

    assert_eq!(list.len(), 1);

    assert_eq!(list[0].end, time("2026-11-12T09:00:00Z"));
}

#[test]
fn artwork_urls_do_not_accept_credentials_or_http() {
    assert!(events::safe_image("http://example.com/a.png").is_empty());

    assert!(events::safe_image("https://u:p@example.com/a.png").is_empty());
}

#[test]
#[ignore = "Calls the official public Endfield service; no account credentials"]
fn public_endfield_schedule() {
    let provider = provider::Provider::new().unwrap();

    let result = events::load(&provider, &Account::default(), "endfield", "Asia").unwrap();

    println!("{} dated official events", result.events.len());

    assert!(
        result
            .events
            .iter()
            .all(|e| e.end > e.start && e.end > Utc::now())
    );
}

#[test]
fn event_thumbnail_uses_official_resize_without_changing_original() {
    use chinaslop_tracker_windows::events::thumbnail_url;
    let original = "https://upload-os-bbs.hoyolab.com/event.png?x-oss-process=old";
    let thumb = reqwest::Url::parse(&thumbnail_url(original)).unwrap();
    assert_eq!(
        thumb
            .query_pairs()
            .filter(|(k, _)| k == "x-oss-process")
            .count(),
        1
    );
    assert!(
        thumb
            .query_pairs()
            .any(|(_, v)| v == "image/resize,w_640/quality,q_75/format,webp")
    );
    assert_eq!(
        thumbnail_url("https://web-static.hg-cdn.com/event.png"),
        "https://web-static.hg-cdn.com/event.png"
    );
    assert!(thumbnail_url("https://secret@example.com/a.png").is_empty());
    assert!(thumbnail_url("http://example.com/a.png").is_empty());
}

#[test]
fn event_cache_expires_and_isolates_credentials_and_servers() {
    use chinaslop_tracker_windows::{
        event_cache::{EventCache, cache_key},
        events::Calendar,
        model::Account,
    };
    use std::time::{Duration, Instant};
    let now = Instant::now();
    let mut cache = EventCache::default();
    let mut account = Account::default();
    let key = cache_key(&account, "genshin", "os_usa");
    cache.insert(
        key.clone(),
        Calendar {
            events: vec![],
            region: "os_usa".into(),
            note: String::new(),
        },
        now,
    );
    assert!(cache.get(&key, now + Duration::from_secs(899)).is_some());
    assert!(cache.get(&key, now + Duration::from_secs(900)).is_none());
    assert!(
        cache
            .get(&cache_key(&account, "genshin", "os_euro"), now)
            .is_none()
    );
    account.hoyo_token = "replaced-token".into();
    assert!(
        cache
            .get(&cache_key(&account, "genshin", "os_usa"), now)
            .is_none()
    );
    for i in 0..20 {
        cache.insert(
            format!("key-{i}"),
            Calendar {
                events: vec![],
                region: "Asia".into(),
                note: String::new(),
            },
            now + Duration::from_secs(i + 1),
        );
    }
    assert!(cache.get(&key, now).is_none());
}

#[test]
fn legacy_settings_accept_new_calendar_preferences() {
    use chinaslop_tracker_windows::model::Settings;
    let settings: Settings = serde_json::from_str(r#"{"refresh_minutes":10}"#).unwrap();
    assert_eq!(settings.event_game, "genshin");
    assert_eq!(settings.event_category, "All");
    assert!(settings.event_servers.is_empty());
    assert_eq!(settings.refresh_minutes, 10);
}

#[test]
fn official_art_parser_accepts_data_and_rejects_execution() {
    use chinaslop_tracker_windows::official_art::read_literal;
    let parsed = read_literal(
        r#"{baseInfo:{active:!0,empty:undefined},items:['text',2],emoji:'\uD83D\uDE00'};ignored"#,
    )
    .unwrap();
    assert_eq!(parsed["baseInfo"]["active"], true);
    assert!(parsed["baseInfo"]["empty"].is_null());
    assert_eq!(parsed["emoji"], "😀");
    assert!(read_literal("{value:fetch('https://example.com')}").is_err());
    assert!(read_literal("{value:(()=>1)()}").is_err());
    assert!(read_literal(&"[".repeat(102)).is_err());
    assert!(read_literal("{bad:'\\uD800x'}").is_err());
}

#[test]
fn official_page_art_resolves_future_names_and_keeps_existing_images() {
    use chinaslop_tracker_windows::official_art::{endfield_art, hoyo_art, official_url};
    let config = serde_json::json!({"slide":{"children":[
        {"name":"@puzzle/text","options":{"text":"Future Festival"}},
        {"name":"@puzzle/image","boxStyle":{"width":"800px","height":"400px"},"options":{"src":"https://act-webstatic.hoyoverse.com/festival.webp"}},
        {"name":"@puzzle/image","boxStyle":{"width":"100px","height":"100px"},"options":{"src":"https://act-webstatic.hoyoverse.com/reward.webp"}}
    ]}});
    let art = hoyo_art(&config, &serde_json::json!({}));
    assert_eq!(art[0].0, "Future Festival");
    assert!(art[0].1.ends_with("festival.webp"));
    let script = r#"a.p="https://web-static.hg-cdn.com/patch/";{"future":a.p+"image.webp"};JSON.parse('{"name":{"en-us":"Future Event"},"thumbnail":{"assetKey":"future"}}')"#;
    let art = endfield_art(script);
    assert_eq!(
        art,
        vec![(
            "Future Event".into(),
            "https://web-static.hg-cdn.com/patch/image.webp".into()
        )]
    );
    assert!(official_url("https://web-static.hg-cdn.com.evil.test/a", "").is_none());
    assert!(official_url("https://user@web-static.hg-cdn.com/a", "").is_none());
}

#[test]
#[ignore = "Calls official public version websites; no account credentials"]
fn public_version_artwork_configuration() {
    use chinaslop_tracker_windows::{model::Event, official_art, provider::Provider};
    let provider = Provider::new().unwrap();
    for game in ["hsr", "endfield"] {
        let mut events = vec![Event {
            name: "Unmatched fixture event".into(),
            category: "Event".into(),
            start: chrono::Utc::now(),
            end: chrono::Utc::now() + chrono::Duration::days(1),
            image: String::new(),
            source: String::new(),
        }];
        official_art::discover(&provider, game, &mut events)
            .unwrap_or_else(|error| panic!("{game}: {error}"));
        assert!(
            events[0].image.is_empty(),
            "Unrelated artwork must not be assigned"
        );
    }
}
