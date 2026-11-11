use chrono::{DateTime, Datelike, Duration, FixedOffset, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub const GAMES: [&str; 4] = ["genshin", "hsr", "zzz", "endfield"];
pub fn game_name(game: &str) -> &str {
    match game {
        "genshin" => "Genshin Impact",
        "hsr" => "Honkai: Star Rail",
        "zzz" => "Zenless Zone Zero",
        "endfield" => "Arknights: Endfield",
        _ => game,
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub hoyo_id: String,
    pub hoyo_token: String,
    pub skport_token: String,
}
impl Default for Account {
    fn default() -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            name: "New account".into(),
            hoyo_id: String::new(),
            hoyo_token: String::new(),
            skport_token: String::new(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub accounts: Vec<Account>,
    pub active_id: String,
    pub refresh_minutes: u32,
    pub automatic_check_in: bool,
    pub palette: usize,
    pub background: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            accounts: vec![],
            active_id: String::new(),
            refresh_minutes: 30,
            automatic_check_in: false,
            palette: 0,
            background: String::new(),
        }
    }
}
impl Settings {
    pub fn active(&self) -> Option<&Account> {
        self.accounts.iter().find(|a| a.id == self.active_id)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Meter {
    pub label: String,
    pub current: Option<f64>,
    pub maximum: Option<f64>,
}
impl Meter {
    pub fn display(&self) -> String {
        match (self.current, self.maximum) {
            (Some(c), Some(m)) if m > 0.0 => format!("{c:.0} / {m:.0}"),
            (Some(c), _) => format!("{c:.0}"),
            _ => "Unavailable".into(),
        }
    }
    pub fn fraction(&self) -> f32 {
        match (self.current, self.maximum) {
            (Some(c), Some(m)) if m > 0.0 => (c / m).clamp(0.0, 1.0) as f32,
            _ => 0.0,
        }
    }
    pub fn complete(&self) -> bool {
        matches!((self.current, self.maximum), (Some(c), Some(m)) if m > 0.0 && c >= m)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub game: String,
    pub nickname: String,
    pub uid: String,
    pub region: String,
    pub resources: Vec<Meter>,
    pub daily: Vec<Meter>,
    pub weekly: Vec<Meter>,
    pub full_at: Option<DateTime<Utc>>,
    pub observed_at: DateTime<Utc>,
    pub error: String,
}
impl Snapshot {
    pub fn failure(game: &str, error: &str) -> Self {
        Self {
            game: game.into(),
            nickname: String::new(),
            uid: String::new(),
            region: String::new(),
            resources: vec![],
            daily: vec![],
            weekly: vec![],
            full_at: None,
            observed_at: Utc::now(),
            error: error.into(),
        }
    }
    pub fn identity(&self) -> String {
        format!("{}:{}:{}", self.game, self.region, self.uid)
    }
    pub fn full_text(&self, now: DateTime<Utc>) -> String {
        if self.resources.first().is_some_and(Meter::complete) {
            return "Full".into();
        }
        match self.full_at {
            Some(at) if at > now => format!("Full in {}", duration(at - now)),
            Some(_) => "Full (estimated)".into(),
            None => "Full time unavailable".into(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Event {
    pub name: String,
    pub category: String,
    pub start: DateTime<Utc>,
    pub end: DateTime<Utc>,
    pub image: String,
    pub source: String,
}
pub fn text(value: &Value, path: &str) -> String {
    match at(value, path) {
        Value::String(s) => s.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}
pub fn at<'a>(value: &'a Value, path: &str) -> &'a Value {
    if path.is_empty() {
        return value;
    }
    path.split('.').fold(value, |v, key| &v[key])
}
pub fn number(value: &Value, path: &str) -> Option<f64> {
    let v = at(value, path);
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
pub fn meter(data: &Value, label: &str, paths: &[(&str, &str)]) -> Meter {
    let pair = paths.iter().find_map(|(c, m)| {
        let current = number(data, c)?;
        let maximum = number(data, m)?;
        (maximum > 0.0).then_some((current, maximum))
    });
    Meter {
        label: label.into(),
        current: pair.map(|p| p.0),
        maximum: pair.map(|p| p.1),
    }
}
pub fn server_name(region: &str) -> &str {
    match region {
        "os_usa" | "prod_official_usa" | "prod_gf_us" => "America",
        "os_euro" | "prod_official_eur" | "prod_official_euro" | "prod_gf_eu" => "Europe",
        "os_asia" | "prod_official_asia" | "prod_gf_jp" | "2" => "Asia",
        "os_cht" | "prod_official_cht" | "prod_gf_sg" => "TW / HK / MO",
        "3" => "Americas / Europe",
        "" => "Unknown",
        _ => region,
    }
}
pub fn server_offset(game: &str, region: &str) -> Option<i32> {
    if matches!(region, "cn_gf01" | "cn_qd01" | "prod_gf_cn" | "prod_qd_cn") {
        return Some(8);
    }
    let name = server_name(region).to_lowercase();
    if name.contains("asia") || name.contains("tw /") {
        Some(8)
    } else if name.contains("america") {
        Some(-5)
    } else if name.contains("europe") {
        Some(if game == "endfield" { -5 } else { 1 })
    } else {
        None
    }
}
pub fn servers(game: &str) -> &[&str] {
    match game {
        "genshin" => &["os_usa", "os_euro", "os_asia", "os_cht"],
        "hsr" => &[
            "prod_official_usa",
            "prod_official_eur",
            "prod_official_asia",
            "prod_official_cht",
        ],
        "zzz" => &["prod_gf_us", "prod_gf_eu", "prod_gf_jp", "prod_gf_sg"],
        _ => &["Asia", "Americas / Europe"],
    }
}
// Fixed game-server offsets deliberately ignore the computer's daylight saving time.
pub fn reset(game: &str, region: &str, weekly: bool, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let offset = FixedOffset::east_opt(server_offset(game, region)? * 3600)?;
    let local = now.with_timezone(&offset);
    let mut next = offset
        .with_ymd_and_hms(local.year(), local.month(), local.day(), 4, 0, 0)
        .single()?;
    if weekly {
        next += Duration::days((7 - local.weekday().num_days_from_monday() as i64) % 7);
    }
    if next <= local {
        next += Duration::days(if weekly { 7 } else { 1 });
    }
    Some(next.with_timezone(&Utc))
}
pub fn period(snapshot: &Snapshot, weekly: bool) -> String {
    let offset =
        FixedOffset::east_opt(server_offset(&snapshot.game, &snapshot.region).unwrap_or(0) * 3600)
            .unwrap();
    let start = reset(
        &snapshot.game,
        &snapshot.region,
        weekly,
        snapshot.observed_at,
    )
    .map(|r| r - Duration::days(if weekly { 7 } else { 1 }))
    .unwrap_or(snapshot.observed_at);
    start.with_timezone(&offset).format("%Y-%m-%d").to_string()
}
pub fn duration(span: Duration) -> String {
    let minutes = ((span.num_seconds().max(0) + 59) / 60).max(0);
    if minutes >= 1440 {
        format!(
            "{}d {}h {}m",
            minutes / 1440,
            minutes % 1440 / 60,
            minutes % 60
        )
    } else if minutes >= 60 {
        format!("{}h {}m", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}m")
    }
}
