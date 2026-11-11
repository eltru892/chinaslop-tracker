use super::*;
impl TrackerApp {
    pub(super) fn dashboard(&mut self, ui: &mut egui::Ui, weekly: bool) {
        ui.heading(if weekly {
            "Weekly progress"
        } else {
            "Daily progress"
        });
        if self.snapshots.is_empty() {
            ui.label("Add connections in Settings, then refresh to load progress.");
            return;
        }
        let width = (ui.available_width() - 20.0) / 2.0;
        egui::Grid::new("game-cards")
            .num_columns(2)
            .spacing([16.0, 16.0])
            .show(ui, |ui| {
                for (i, s) in self.snapshots.iter().enumerate() {
                    egui::Frame::new()
                        .fill(Color32::from_rgba_unmultiplied(
                            self.accent.r() / 7 + 15,
                            self.accent.g() / 7 + 15,
                            self.accent.b() / 7 + 20,
                            220,
                        ))
                        .corner_radius(14)
                        .inner_margin(18)
                        .show(ui, |ui| {
                            ui.set_min_width(width - 36.0);
                            ui.set_max_width(width - 36.0);
                            ui.horizontal_wrapped(|ui| {
                                ui.add(game_image(&s.game).fit_to_exact_size(Vec2::splat(48.0)));
                                ui.label(RichText::new(game_name(&s.game)).size(21.0).strong());
                                let tasks = if weekly { &s.weekly } else { &s.daily };
                                if !tasks.is_empty() && tasks.iter().all(Meter::complete) {
                                    ui.label(RichText::new("☑").size(28.0).color(self.accent));
                                }
                            });
                            if !s.error.is_empty() {
                                ui.colored_label(Color32::LIGHT_RED, &s.error);
                                return;
                            }
                            ui.label(format!(
                                "{} · {} Server",
                                s.nickname,
                                server_name(&s.region)
                            ));
                            if !weekly {
                                for m in &s.resources {
                                    show_meter(ui, m, self.accent);
                                }
                                ui.colored_label(self.accent, s.full_text(Utc::now()));
                            }
                            for m in if weekly { &s.weekly } else { &s.daily } {
                                if m.label == "Extra reward" {
                                    ui.label(match m.current {
                                        Some(v) if v >= 1.0 => "● Claimed",
                                        Some(_) => "○ Not claimed",
                                        None => "○ Reward status unavailable",
                                    });
                                } else {
                                    show_meter(ui, m, self.accent);
                                }
                            }
                            if let Some(at) = reset(&s.game, &s.region, weekly, Utc::now()) {
                                ui.label(format!(
                                    "{} reset in {}",
                                    if weekly { "Weekly" } else { "Daily" },
                                    duration(at - Utc::now())
                                ));
                            }
                            if weekly {
                                ui.small(week_label(&period(s, true)));
                            }
                            if let Some(result) = self.checks.iter().find(|r| r.game == s.game) {
                                ui.label(&result.message);
                                if !result.complete && ui.button("Official check-in").clicked() {
                                    open_link(&result.link);
                                }
                            }
                            ui.small(format!(
                                "Updated {}",
                                s.observed_at
                                    .with_timezone(&chrono::Local)
                                    .format("%b %d %H:%M")
                            ));
                        });
                    if i % 2 == 1 {
                        ui.end_row();
                    }
                }
            });
    }
}
