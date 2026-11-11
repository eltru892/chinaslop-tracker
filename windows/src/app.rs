mod appearance;
mod dashboard;
mod events;
mod history;
mod settings;
use chinaslop_tracker_windows::{
    check_in::{self, CheckResult},
    events::{self as event_feed, Calendar},
    model::*,
    provider::{Progress, Provider, Result},
    storage::{History, Vault},
};
use chrono::{Duration, Utc};
use eframe::egui::{self, Color32, RichText, Vec2};
use fs2::FileExt;
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::{Arc, mpsc},
    time::{Duration as StdDuration, Instant},
};
#[derive(Clone, Copy, PartialEq)]
enum Page {
    Daily,
    Weekly,
    History,
    Events,
    Settings,
}
enum Message {
    Progress(String),
    Refreshed(String, Vec<Snapshot>, StdDuration),
    Checked(String, Vec<CheckResult>),
    Events(Result<Calendar>),
}
pub struct TrackerApp {
    settings: Settings,
    vault: Option<Vault>,
    history: Option<History>,
    _lock: Option<std::fs::File>,
    provider: Option<Provider>,
    locked_error: String,
    demo: bool,
    page: Page,
    snapshots: Vec<Snapshot>,
    checks: Vec<CheckResult>,
    status: String,
    busy: bool,
    tx: mpsc::Sender<Message>,
    rx: mpsc::Receiver<Message>,
    next_refresh: Instant,
    next_check: Instant,
    next_events: Instant,
    credential_id: String,
    credential_token: String,
    skport_token: String,
    delete_confirmation: bool,
    history_account: String,
    history_weekly: bool,
    history_size: usize,
    history_page: usize,
    history_rows: Vec<(String, Snapshot)>,
    history_total: usize,
    history_accounts: Vec<(String, String)>,
    events: Vec<Event>,
    event_game: String,
    event_region: String,
    event_category: String,
    event_note: String,
    background: Option<egui::TextureHandle>,
    background_key: String,
    accent: Color32,
    art_search: String,
    artwork: Vec<Value>,
}
impl TrackerApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        egui_extras::install_image_loaders(&cc.egui_ctx);
        cc.egui_ctx.set_visuals(egui::Visuals::dark());
        let mut style = (*cc.egui_ctx.style()).clone();
        style
            .text_styles
            .insert(egui::TextStyle::Body, egui::FontId::proportional(17.0));
        style
            .text_styles
            .insert(egui::TextStyle::Button, egui::FontId::proportional(16.0));
        style
            .text_styles
            .insert(egui::TextStyle::Heading, egui::FontId::proportional(28.0));
        style.spacing.item_spacing = Vec2::new(10.0, 10.0);
        cc.egui_ctx.set_style(style);
        let demo = std::env::args().any(|a| a == "--demo");
        let (tx, rx) = mpsc::channel();
        let mut settings = Settings::default();
        let mut vault = None;
        let mut history = None;
        let mut lock = None;
        let mut locked_error = String::new();
        if !demo {
            match Vault::new().and_then(|v| {
                let file = std::fs::OpenOptions::new()
                    .create(true)
                    .truncate(false)
                    .read(true)
                    .write(true)
                    .open(v.root.join("app.lock"))
                    .map_err(|_| "Could not open application lock.".to_string())?;
                file.try_lock_exclusive()
                    .map_err(|_| "Another Rust tracker is already open.".to_string())?;
                let settings = v.load()?;
                let history = History::open(&v.root.join("history.sqlite"))?;
                Ok((v, settings, history, file))
            }) {
                Ok((v, s, h, l)) => {
                    vault = Some(v);
                    settings = s;
                    history = Some(h);
                    lock = Some(l);
                }
                Err(error) => locked_error = error,
            }
        }
        if !settings.accounts.iter().any(|a| a.id == settings.active_id) {
            settings.active_id = settings
                .accounts
                .first()
                .map(|a| a.id.clone())
                .unwrap_or_default();
        }
        let provider = Provider::new();
        let status = provider
            .as_ref()
            .err()
            .cloned()
            .unwrap_or_else(|| "Ready".into());
        let mut app = Self {
            settings,
            vault,
            history,
            _lock: lock,
            provider: provider.ok(),
            locked_error,
            demo,
            page: if demo { Page::Daily } else { Page::Settings },
            snapshots: if demo { sample_snapshots() } else { vec![] },
            checks: vec![],
            status,
            busy: false,
            tx,
            rx,
            next_refresh: Instant::now(),
            next_check: Instant::now(),
            next_events: Instant::now(),
            credential_id: String::new(),
            credential_token: String::new(),
            skport_token: String::new(),
            delete_confirmation: false,
            history_account: String::new(),
            history_weekly: false,
            history_size: 10,
            history_page: 0,
            history_rows: vec![],
            history_total: 0,
            history_accounts: vec![],
            events: vec![],
            event_game: "genshin".into(),
            event_region: String::new(),
            event_category: "All".into(),
            event_note: String::new(),
            background: None,
            background_key: String::new(),
            accent: Color32::from_rgb(112, 221, 186),
            art_search: String::new(),
            artwork: serde_json::from_str(include_str!("../assets/backgrounds.json"))
                .unwrap_or_default(),
        };
        app.load_background(&cc.egui_ctx);
        if app.settings.active().is_some() && !demo {
            app.page = Page::Daily;
            app.refresh(&cc.egui_ctx);
        }
        app
    }
    fn save(&mut self) -> bool {
        if self.demo {
            self.status = "Sample mode: changes are not saved.".into();
            return true;
        }
        if !self.locked_error.is_empty() {
            self.status = self.locked_error.clone();
            return false;
        }
        let result = self
            .vault
            .as_ref()
            .ok_or("Local storage is unavailable.".into())
            .and_then(|v| v.save(&self.settings));
        if let Err(error) = result {
            self.status = error;
            false
        } else {
            true
        }
    }
    fn progress(&self, ctx: &egui::Context) -> Progress {
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        Arc::new(move |s| {
            let _ = tx.send(Message::Progress(s));
            ctx.request_repaint();
        })
    }
    fn refresh(&mut self, ctx: &egui::Context) {
        if self.busy || !self.locked_error.is_empty() {
            return;
        }
        self.next_refresh = Instant::now()
            + StdDuration::from_secs(self.settings.refresh_minutes.clamp(1, 1440) as u64 * 60);
        if self.demo {
            self.snapshots = sample_snapshots();
            self.status = "Sample data refreshed".into();
            return;
        }
        let Some(account) = self.settings.active().cloned() else {
            self.status = "Add an account in Settings.".into();
            return;
        };
        let Some(provider) = self.provider.clone() else {
            return;
        };
        self.busy = true;
        self.status = "Starting refresh…".into();
        let tx = self.tx.clone();
        let progress = self.progress(ctx);
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let start = Instant::now();
            let data = provider.collect(&account, progress);
            let _ = tx.send(Message::Refreshed(account.id, data, start.elapsed()));
            ctx.request_repaint();
        });
    }
    fn check_in(&mut self, ctx: &egui::Context) {
        if self.busy || self.demo || !self.locked_error.is_empty() {
            return;
        }
        let Some(account) = self.settings.active().cloned() else {
            return;
        };
        let Some(provider) = self.provider.clone() else {
            return;
        };
        self.busy = true;
        self.status = "Checking attendance…".into();
        self.next_check = Instant::now() + StdDuration::from_secs(1800);
        let tx = self.tx.clone();
        let progress = self.progress(ctx);
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let result = check_in::run(&provider, &account, progress);
            let _ = tx.send(Message::Checked(account.id, result));
            ctx.request_repaint();
        });
    }
    fn load_events(&mut self, ctx: &egui::Context) {
        if self.busy || !self.locked_error.is_empty() {
            return;
        }
        self.next_events = Instant::now() + StdDuration::from_secs(900);
        if self.demo {
            self.events = vec![Event {
                name: "Sample limited event".into(),
                category: "Event".into(),
                start: Utc::now() - Duration::days(3),
                end: Utc::now() + Duration::days(5),
                image: String::new(),
                source: String::new(),
            }];
            self.event_note = "Sample schedule".into();
            return;
        }
        let Some(provider) = self.provider.clone() else {
            return;
        };
        let account = self.settings.active().cloned().unwrap_or_default();
        let game = self.event_game.clone();
        let mut region = self.event_region.clone();
        if game == "endfield" && region.is_empty() {
            region = self
                .snapshots
                .iter()
                .find(|s| s.game == game)
                .map(|s| server_name(&s.region).into())
                .unwrap_or_else(|| "Asia".into());
        }
        self.busy = true;
        self.events.clear();
        self.event_note = "Loading official calendars…".into();
        let tx = self.tx.clone();
        let ctx = ctx.clone();
        std::thread::spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                event_feed::load(&provider, &account, &game, &region)
            }))
            .unwrap_or_else(|_| Err("Calendar worker failed.".into()));
            let _ = tx.send(Message::Events(result));
            ctx.request_repaint();
        });
    }
    fn receive(&mut self) {
        while let Ok(message) = self.rx.try_recv() {
            match message {
                Message::Progress(text) => self.status = text,
                Message::Refreshed(id, snapshots, elapsed) => {
                    self.busy = false;
                    if id != self.settings.active_id {
                        continue;
                    }
                    let error = self.history.as_mut().and_then(|h| h.save(&snapshots).err());
                    let name = ["genshin", "endfield", "hsr", "zzz"].iter().find_map(|g| {
                        snapshots
                            .iter()
                            .find(|s| s.game == *g && s.error.is_empty() && !s.nickname.is_empty())
                            .map(|s| s.nickname.clone())
                    });
                    if let Some(name) = name {
                        if let Some(account) =
                            self.settings.accounts.iter_mut().find(|a| a.id == id)
                        {
                            account.name = name;
                        }
                        self.save();
                    }
                    let failures = snapshots.iter().filter(|s| !s.error.is_empty()).count();
                    self.snapshots = snapshots;
                    self.status = error.unwrap_or_else(|| {
                        format!(
                            "Updated in {:.1}s · {failures} connection issue(s)",
                            elapsed.as_secs_f64()
                        )
                    });
                    if self.page == Page::History {
                        self.reload_history();
                    }
                }
                Message::Checked(id, results) => {
                    self.busy = false;
                    if id == self.settings.active_id {
                        self.status = format!(
                            "Check-in: {} / 4 confirmed",
                            results.iter().filter(|r| r.complete).count()
                        );
                        self.checks = results;
                    }
                }
                Message::Events(result) => {
                    self.busy = false;
                    match result {
                        Ok(calendar) => {
                            self.events = calendar.events;
                            self.event_note = format!(
                                "{} Server · {}",
                                server_name(&calendar.region),
                                calendar.note
                            );
                        }
                        Err(error) => self.event_note = error,
                    }
                }
            }
        }
    }
    fn change_account(&mut self, id: String, ctx: &egui::Context) {
        if self.busy {
            return;
        }
        self.settings.active_id = id;
        self.save();
        self.snapshots.clear();
        self.events.clear();
        self.checks.clear();
        self.clear_drafts();
        self.next_check = Instant::now();
        self.next_events = Instant::now();
        self.refresh(ctx);
    }
    fn clear_drafts(&mut self) {
        self.credential_id.clear();
        self.credential_token.clear();
        self.skport_token.clear();
        self.delete_confirmation = false;
    }
    fn reload_history(&mut self) {
        if let Some(history) = &self.history {
            match history.read(
                &self.history_account,
                self.history_weekly,
                self.history_page,
                self.history_size,
            ) {
                Ok((rows, total)) => {
                    self.history_rows = rows;
                    self.history_total = total;
                }
                Err(error) => self.status = error,
            }
            match history.accounts() {
                Ok(accounts) => self.history_accounts = accounts,
                Err(error) => self.status = error,
            }
        }
    }
}
impl eframe::App for TrackerApp {
    fn update(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        self.receive();
        if !self.demo && !self.busy && self.locked_error.is_empty() {
            if self.settings.active().is_some() {
                if Instant::now() >= self.next_refresh {
                    self.refresh(ctx);
                } else if self.settings.automatic_check_in && Instant::now() >= self.next_check {
                    self.check_in(ctx);
                }
            }
            if !self.busy && self.page == Page::Events && Instant::now() >= self.next_events {
                self.load_events(ctx);
            }
        }
        ctx.request_repaint_after(StdDuration::from_secs(60));
        if self.busy {
            ctx.request_repaint_after(StdDuration::from_millis(250));
        }
        egui::CentralPanel::default()
            .frame(
                egui::Frame::new()
                    .fill(Color32::from_rgb(
                        self.accent.r() / 12 + 8,
                        self.accent.g() / 12 + 8,
                        self.accent.b() / 12 + 14,
                    ))
                    .inner_margin(24),
            )
            .show(ctx, |ui| {
                if let Some(texture) = &self.background {
                    let rect = ui.max_rect();
                    let image = texture.size_vec2();
                    let scale = (rect.width() / image.x).max(rect.height() / image.y);
                    let visible = rect.size() / (image * scale);
                    let uv = egui::Rect::from_center_size(egui::pos2(0.5, 0.5), visible);
                    ui.painter()
                        .image(texture.id(), rect, uv, Color32::from_white_alpha(75));
                }
                ui.horizontal(|ui| {
                    ui.add(
                        egui::Image::from_bytes(
                            "bytes://logo",
                            include_bytes!("../assets/logo.png"),
                        )
                        .fit_to_exact_size(Vec2::splat(60.0)),
                    );
                    ui.heading("Chinaslop Tracker");
                    if self.demo {
                        ui.colored_label(Color32::GOLD, "SAMPLE DATA");
                    }
                });
                if !self.locked_error.is_empty() {
                    ui.colored_label(Color32::LIGHT_RED, &self.locked_error);
                }
                ui.add_enabled_ui(!self.busy && self.locked_error.is_empty(), |ui| {
                    ui.horizontal_wrapped(|ui| {
                        let mut selected = self.settings.active_id.clone();
                        egui::ComboBox::from_id_salt("active-account")
                            .width(240.0)
                            .selected_text(
                                self.settings.active().map(|a| a.name.as_str()).unwrap_or(
                                    if self.demo {
                                        "Sample account"
                                    } else {
                                        "No saved accounts"
                                    },
                                ),
                            )
                            .show_ui(ui, |ui| {
                                for a in &self.settings.accounts {
                                    ui.selectable_value(&mut selected, a.id.clone(), &a.name);
                                }
                            });
                        if selected != self.settings.active_id {
                            self.change_account(selected, ctx);
                        }
                        if ui.button("Refresh").clicked() {
                            self.refresh(ctx);
                        }
                        if ui
                            .add_enabled(
                                !self.demo && self.settings.active().is_some(),
                                egui::Button::new("Check in"),
                            )
                            .clicked()
                        {
                            self.check_in(ctx);
                        }
                    });
                });
                ui.label(&self.status);
                if !self.demo && self.settings.active().is_some() {
                    ui.small(format!(
                        "Next refresh in {}m",
                        self.next_refresh
                            .saturating_duration_since(Instant::now())
                            .as_secs()
                            .div_ceil(60)
                    ));
                }
                let before = self.page;
                ui.horizontal_wrapped(|ui| {
                    for (page, name) in [
                        (Page::Daily, "Daily"),
                        (Page::Weekly, "Weekly"),
                        (Page::History, "History"),
                        (Page::Events, "Events"),
                        (Page::Settings, "Settings"),
                    ] {
                        ui.selectable_value(&mut self.page, page, name);
                    }
                });
                if before != self.page {
                    if self.page == Page::History {
                        self.reload_history();
                    }
                    if self.page == Page::Events && self.events.is_empty() {
                        self.load_events(ctx);
                    }
                }
                ui.separator();
                egui::ScrollArea::vertical()
                    .id_salt("page-scroll")
                    .show(ui, |ui| match self.page {
                        Page::Daily => self.dashboard(ui, false),
                        Page::Weekly => self.dashboard(ui, true),
                        Page::History => self.history_page(ui),
                        Page::Events => self.events_page(ui, ctx),
                        Page::Settings => self.settings_page(ui, ctx),
                    });
            });
    }
}
fn assets() -> PathBuf {
    let beside = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.join("assets")));
    if let Some(path) = beside.filter(|p| p.exists()) {
        path
    } else {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("assets")
    }
}
fn open_link(url: &str) {
    if reqwest::Url::parse(url).is_ok_and(|u| u.scheme() == "https") {
        let _ = webbrowser::open(url);
    }
}
fn show_meter(ui: &mut egui::Ui, meter: &Meter, color: Color32) {
    ui.horizontal_wrapped(|ui| {
        ui.label(&meter.label);
        ui.label(RichText::new(meter.display()).size(21.0).strong());
    });
    if meter.maximum.is_some_and(|m| m > 0.0) {
        ui.add(
            egui::ProgressBar::new(meter.fraction())
                .fill(color)
                .desired_height(8.0),
        );
    }
}
fn game_image(game: &str) -> egui::Image<'static> {
    let (uri, bytes): (&str, &[u8]) = match game {
        "genshin" => (
            "bytes://genshin",
            include_bytes!("../assets/genshin-logo.png"),
        ),
        "hsr" => ("bytes://hsr", include_bytes!("../assets/hsr-logo.png")),
        "zzz" => ("bytes://zzz", include_bytes!("../assets/zzz-logo.png")),
        _ => (
            "bytes://endfield",
            include_bytes!("../assets/endfield-logo.png"),
        ),
    };
    egui::Image::from_bytes(uri, bytes)
}
fn week_label(period: &str) -> String {
    chrono::NaiveDate::parse_from_str(period, "%Y-%m-%d")
        .map(|d| {
            format!(
                "Week of {} – {}",
                d.format("%b %-d"),
                (d + Duration::days(7)).format("%b %-d")
            )
        })
        .unwrap_or_else(|_| period.into())
}
fn sample_snapshots() -> Vec<Snapshot> {
    GAMES
        .iter()
        .enumerate()
        .map(|(i, g)| {
            let mut s = Snapshot::failure(g, "");
            s.nickname = "Sample account".into();
            s.region = "Asia".into();
            s.uid = "demo".into();
            s.resources = vec![Meter {
                label: [
                    "Original Resin",
                    "Trailblaze Power",
                    "Battery Charge",
                    "Sanity",
                ][i]
                    .into(),
                current: Some([126.0, 180.0, 132.0, 180.0][i]),
                maximum: Some([200.0, 300.0, 240.0, 240.0][i]),
            }];
            s.daily = vec![Meter {
                label: [
                    "Daily commissions",
                    "Daily training",
                    "Daily engagement",
                    "Daily activity",
                ][i]
                    .into(),
                current: Some([2.0, 500.0, 200.0, 100.0][i]),
                maximum: Some([4.0, 500.0, 400.0, 100.0][i]),
            }];
            s.weekly = vec![Meter {
                label: "Weekly sample".into(),
                current: Some(1.0),
                maximum: Some(3.0),
            }];
            s.full_at = Some(Utc::now() + Duration::hours(8));
            s
        })
        .collect()
}
