use super::*;
impl TrackerApp {
    pub(super) fn history_page(&mut self, ui: &mut egui::Ui) {
        ui.heading("History");
        let before = (
            self.history_account.clone(),
            self.history_weekly,
            self.history_size,
        );
        ui.horizontal_wrapped(|ui| {
            let selected = self
                .history_accounts
                .iter()
                .find(|a| a.0 == self.history_account)
                .map(|a| a.1.as_str())
                .unwrap_or("All previous accounts");
            egui::ComboBox::from_id_salt("history-account")
                .selected_text(selected)
                .width(350.0)
                .show_ui(ui, |ui| {
                    ui.selectable_value(
                        &mut self.history_account,
                        String::new(),
                        "All previous accounts",
                    );
                    for (id, label) in &self.history_accounts {
                        ui.selectable_value(&mut self.history_account, id.clone(), label);
                    }
                });
            egui::ComboBox::from_id_salt("history-kind")
                .selected_text(if self.history_weekly {
                    "Weekly"
                } else {
                    "Daily"
                })
                .show_ui(ui, |ui| {
                    ui.selectable_value(&mut self.history_weekly, false, "Daily");
                    ui.selectable_value(&mut self.history_weekly, true, "Weekly");
                });
            egui::ComboBox::from_id_salt("history-size")
                .selected_text(format!("{} entries", self.history_size))
                .show_ui(ui, |ui| {
                    for size in [1, 3, 5, 10, 20, 50] {
                        ui.selectable_value(&mut self.history_size, size, size.to_string());
                    }
                });
        });
        if before.1 != self.history_weekly {
            self.history_size = if self.history_weekly { 3 } else { 10 };
        }
        if before
            != (
                self.history_account.clone(),
                self.history_weekly,
                self.history_size,
            )
        {
            self.history_page = 0;
            self.reload_history();
        }
        if self.history_rows.is_empty() {
            ui.label("No history for this selection. Successful refreshes save progress here.");
        }
        for (period, s) in &self.history_rows {
            egui::Frame::group(ui.style())
                .inner_margin(16)
                .show(ui, |ui| {
                    ui.label(
                        RichText::new(if self.history_weekly {
                            week_label(period)
                        } else {
                            period.clone()
                        })
                        .size(21.0),
                    );
                    ui.label(format!(
                        "{} · {} · {} Server",
                        game_name(&s.game),
                        s.nickname,
                        server_name(&s.region)
                    ));
                    for m in if self.history_weekly {
                        &s.weekly
                    } else {
                        &s.daily
                    } {
                        show_meter(ui, m, self.accent);
                    }
                });
        }
        ui.horizontal(|ui| {
            if ui
                .add_enabled(self.history_page > 0, egui::Button::new("← Previous"))
                .clicked()
            {
                self.history_page -= 1;
                self.reload_history();
            }
            ui.label(format!(
                "Page {} of {}",
                self.history_page + 1,
                self.history_total.div_ceil(self.history_size).max(1)
            ));
            if ui
                .add_enabled(
                    (self.history_page + 1) * self.history_size < self.history_total,
                    egui::Button::new("Next →"),
                )
                .clicked()
            {
                self.history_page += 1;
                self.reload_history();
            }
        });
    }
}
