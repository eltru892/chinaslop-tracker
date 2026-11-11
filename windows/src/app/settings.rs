use super::*;
impl TrackerApp {
    pub(super) fn settings_page(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.heading("Settings");
        if !self.locked_error.is_empty() {
            ui.colored_label(Color32::LIGHT_RED, &self.locked_error);
            ui.label(
                "Existing data has not been overwritten. Resolve access to the OS credential store and restart the app.",
            );
            return;
        }
        ui.add_enabled_ui(
            !self.busy,
            |ui| {
                ui.horizontal_wrapped(|ui| {
                    let mut selected = self.settings.active_id.clone();
                    egui::ComboBox::from_id_salt("settings-account")
                        .selected_text(
                            self
                                .settings
                                .active()
                                .map(|a| a.name.as_str())
                                .unwrap_or("No account"),
                        )
                        .show_ui(
                            ui,
                            |ui| {
                                for a in &self.settings.accounts {
                                    ui.selectable_value(&mut selected, a.id.clone(), &a.name);
                                }
                            },
                        );
                    if selected != self.settings.active_id {
                        self.change_account(selected, ctx);
                    }
                    if ui.button("Add account").clicked() {
                        let a = Account::default();
                        self.settings.active_id = a.id.clone();
                        self.settings.accounts.push(a);
                        self.save();
                        self.snapshots.clear();
                        self.events.clear();
                        self.checks.clear();
                        self.clear_drafts();
                    }
                    if ui
                        .add_enabled(
                            self.settings.active().is_some(),
                            egui::Button::new("Delete saved account"),
                        )
                        .clicked()
                    {
                        self.delete_confirmation = true;
                    }
                });
                if self.delete_confirmation {
                    ui.horizontal_wrapped(|ui| {
                        ui.colored_label(
                            Color32::LIGHT_RED,
                            "Delete this saved profile? Game history is kept.",
                        );
                        if ui.button("Confirm delete").clicked() {
                            let id = self.settings.active_id.clone();
                            self.settings.accounts.retain(|a| a.id != id);
                            self.settings.active_id = self
                                .settings
                                .accounts
                                .first()
                                .map(|a| a.id.clone())
                                .unwrap_or_default();
                            self.save();
                            self.clear_drafts();
                            self.snapshots.clear();
                            self.events.clear();
                            self.checks.clear();
                        }
                        if ui.button("Cancel").clicked() {
                            self.delete_confirmation = false;
                        }
                    });
                }
                if let Some(account) = self.settings.active().cloned() {
                    ui.columns(
                        2,
                        |columns| {
                            egui::Frame::group(columns[0].style())
                                .show(
                                    &mut columns[0],
                                    |ui| {
                                        ui.heading("HoYoLAB");
                                        ui.label("Account ID value (ltuid_v2)");
                                        ui.add(
                                            egui::TextEdit::singleline(&mut self.credential_id)
                                                .hint_text("Paste ltuid_v2 value"),
                                        );
                                        ui.label("Token value (ltoken_v2)");
                                        ui.add(
                                            egui::TextEdit::singleline(&mut self.credential_token)
                                                .password(true)
                                                .hint_text("Paste token value"),
                                        );
                                        ui.small(
                                            if account.hoyo_token.is_empty() {
                                                "Not connected"
                                            } else {
                                                "Saved · leave blank to keep"
                                            },
                                        );
                                        if ui.button("Disconnect HoYoLAB").clicked() {
                                            if let Some(a) = self
                                                .settings
                                                .accounts
                                                .iter_mut()
                                                .find(|a| a.id == account.id)
                                            {
                                                a.hoyo_id.clear();
                                                a.hoyo_token.clear();
                                            }
                                            self.save();
                                            self.snapshots.clear();
                                            self.events.clear();
                                        }
                                        ui.collapsing(
                                            "How to get the values",
                                            |ui| {
                                                ui.label(
                                                    "Sign in to hoyolab.com. Open Developer Tools → Application (or Storage) → Cookies → HoYoLAB. Copy only the Value of ltuid_v2 and ltoken_v2 into these fields. Keep both values private.",
                                                );
                                                if ui.link("Open HoYoLAB").clicked() {
                                                    open_link("https://www.hoyolab.com/");
                                                }
                                            },
                                        );
                                    },
                                );
                            egui::Frame::group(columns[1].style())
                                .show(
                                    &mut columns[1],
                                    |ui| {
                                        ui.heading("SKPORT");
                                        ui.label("Account token");
                                        ui.add(
                                            egui::TextEdit::singleline(&mut self.skport_token)
                                                .password(true)
                                                .hint_text("Paste token or account-token JSON"),
                                        );
                                        ui.small(
                                            if account.skport_token.is_empty() {
                                                "Not connected"
                                            } else {
                                                "Saved · leave blank to keep"
                                            },
                                        );
                                        if ui.button("Disconnect SKPORT").clicked() {
                                            if let Some(a) = self
                                                .settings
                                                .accounts
                                                .iter_mut()
                                                .find(|a| a.id == account.id)
                                            {
                                                a.skport_token.clear();
                                            }
                                            self.save();
                                            self.snapshots.clear();
                                            self.events.clear();
                                        }
                                        ui.collapsing(
                                            "How to get the token",
                                            |ui| {
                                                ui.label(
                                                    "Sign in at skport.com in the same browser, then open the account-token page. Copy data.content or the whole JSON response. A 401 means that browser is not signed in.",
                                                );
                                                if ui.link("Open account-token page").clicked() {
                                                    open_link(
                                                        "https://web-api.skport.com/cookie_store/account_token",
                                                    );
                                                }
                                            },
                                        );
                                    },
                                );
                        },
                    );
                    if ui.button("Save connections and refresh").clicked() {
                        self.save_connections(ctx);
                    }
                }
                ui.separator();
                ui.heading("Refresh and check-in");
                ui.horizontal_wrapped(|ui| {
                    ui.label("Refresh interval");
                    egui::ComboBox::from_id_salt("interval")
                        .selected_text(
                            format!("{} minutes", self.settings.refresh_minutes),
                        )
                        .show_ui(
                            ui,
                            |ui| {
                                for m in [5, 10, 30, 60, 120, 240, 480] {
                                    ui.selectable_value(
                                        &mut self.settings.refresh_minutes,
                                        m,
                                        if m < 60 {
                                            format!("{m} minutes")
                                        } else {
                                            format!("{} hour(s)", m / 60)
                                        },
                                    );
                                }
                                ui.label("Custom: use the number field");
                            },
                        );
                    ui.add(
                        egui::DragValue::new(&mut self.settings.refresh_minutes)
                            .range(1..=1440)
                            .suffix(" min"),
                    );
                });
                ui.checkbox(
                    &mut self.settings.automatic_check_in,
                    "Automatically check in daily for the selected account",
                );
                ui.small(
                    "Checks attendance every 30 minutes while the app is open. Closing the app stops refresh and check-in.",
                );
                if ui.button("Save schedule").clicked() && self.save() {
                    self.next_refresh = Instant::now()
                        + StdDuration::from_secs(
                            self.settings.refresh_minutes as u64 * 60,
                        );
                    self.next_check = Instant::now();
                    self.status = "Schedule saved".into();
                }
                ui.separator();
                self.appearance(ui, ctx);
            },
        );
        if let Some(vault) = &self.vault {
            ui.small(format!("Native Rust data: {}", vault.root.display()));
        }
    }
    pub(super) fn save_connections(&mut self, ctx: &egui::Context) {
        let Some(mut account) = self.settings.active().cloned() else {
            return;
        };
        let id = self.credential_id.trim();
        let token = self.credential_token.trim();
        if !id.is_empty() && !id.chars().all(|c| c.is_ascii_digit()) {
            self.status = "Paste only the numeric ltuid_v2 value.".into();
            return;
        }
        if token.contains(['\r', '\n', ';']) {
            self.status = "Paste only the ltoken_v2 value.".into();
            return;
        }
        if !id.is_empty() {
            account.hoyo_id = id.into();
        }
        if !token.is_empty() {
            account.hoyo_token = token.into();
        }
        if account.hoyo_id.is_empty() != account.hoyo_token.is_empty() {
            self.status = "HoYoLAB requires both ID and token.".into();
            return;
        }
        if !self.skport_token.trim().is_empty() {
            match chinaslop_tracker_windows::provider::parse_skport_token(&self.skport_token) {
                Ok(token) => account.skport_token = token,
                Err(error) => {
                    self.status = error;
                    return;
                }
            }
        }
        if let Some(a) = self
            .settings
            .accounts
            .iter_mut()
            .find(|a| a.id == account.id)
        {
            *a = account;
        }
        if self.save() {
            self.clear_drafts();
            self.refresh(ctx);
        }
    }
}
