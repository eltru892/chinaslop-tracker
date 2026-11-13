use super::*;
impl TrackerApp {
    pub(super) fn events_page(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.heading("Ongoing events");
        let old = (self.event_game.clone(), self.event_region.clone());
        let old_category = self.event_category.clone();
        ui.add_enabled_ui(!self.busy, |ui| {
            ui.horizontal_wrapped(|ui| {
                egui::ComboBox::from_id_salt("event-game")
                    .selected_text(game_name(&self.event_game))
                    .show_ui(ui, |ui| {
                        for game in GAMES {
                            ui.selectable_value(&mut self.event_game, game.into(), game_name(game));
                        }
                    });
                if old.0 != self.event_game {
                    self.event_region = self
                        .settings
                        .event_servers
                        .get(&self.event_game)
                        .cloned()
                        .unwrap_or_default();
                    self.event_window_offset = 0;
                }
                egui::ComboBox::from_id_salt("event-server")
                    .selected_text(if self.event_region.is_empty() {
                        "My account server"
                    } else {
                        server_name(&self.event_region)
                    })
                    .show_ui(ui, |ui| {
                        ui.selectable_value(
                            &mut self.event_region,
                            String::new(),
                            "My account server",
                        );
                        for region in servers(&self.event_game) {
                            ui.selectable_value(
                                &mut self.event_region,
                                region.to_string(),
                                server_name(region),
                            );
                        }
                    });
                egui::ComboBox::from_id_salt("event-category")
                    .selected_text(&self.event_category)
                    .show_ui(ui, |ui| {
                        for cat in ["All", "Event", "Banner", "Challenge"] {
                            ui.selectable_value(&mut self.event_category, cat.into(), cat);
                        }
                    });
                if ui
                    .add_enabled(!self.event_loading, egui::Button::new("Refresh events"))
                    .clicked()
                {
                    self.event_cache = Default::default();
                    self.load_events(ctx);
                }
            });
        });
        if old != (self.event_game.clone(), self.event_region.clone()) {
            self.events.clear();
            self.event_detail = None;
            self.event_resolved_region.clear();
            self.event_window_offset = 0;
            self.load_events(ctx);
        }
        if old != (self.event_game.clone(), self.event_region.clone())
            || old_category != self.event_category
        {
            self.settings.event_game = self.event_game.clone();
            self.settings.event_category = self.event_category.clone();
            self.settings
                .event_servers
                .insert(self.event_game.clone(), self.event_region.clone());
            self.save();
        }
        ui.horizontal(|ui| {
            if ui.button("← Earlier").clicked() {
                self.event_window_offset -= 7;
            }
            if ui.button("Today").clicked() {
                self.event_window_offset = 0;
            }
            if ui.button("Later →").clicked() {
                self.event_window_offset += 7;
            }
            if self.event_loading {
                ui.spinner();
                ui.label("Loading calendar artwork…");
            }
        });
        if !self.event_note.is_empty() {
            ui.label(&self.event_note);
        }
        self.event_details(ctx);
        let entries: Vec<_> = self
            .events
            .iter()
            .filter(|e| {
                e.start <= Utc::now()
                    && e.end > Utc::now()
                    && (self.event_category == "All" || e.category == self.event_category)
            })
            .collect();
        if entries.is_empty() {
            ui.label("No ongoing events loaded. Only confirmed end dates are shown.");
            return;
        }
        let offset = chrono::FixedOffset::east_opt(
            server_offset(&self.event_game, &self.event_resolved_region).unwrap_or(8) * 3600,
        )
        .unwrap();
        let now = Utc::now();
        let start = (now.with_timezone(&offset).date_naive() - Duration::days(7)
            + Duration::days(self.event_window_offset))
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(offset)
        .unwrap()
        .with_timezone(&Utc);
        let day_width = 65.0;
        let total_width = day_width * 42.0;
        egui::ScrollArea::horizontal()
            .id_salt("timeline")
            .show(ui, |ui| {
                let (rect, _) = ui.allocate_exact_size(
                    Vec2::new(total_width, 75.0 + entries.len() as f32 * 86.0),
                    egui::Sense::hover(),
                );
                let painter = ui.painter_at(rect);
                painter.rect_filled(rect, 8.0, Color32::from_rgba_unmultiplied(24, 29, 48, 235));
                for day in 0..42 {
                    let x = rect.left() + day as f32 * day_width;
                    painter.line_segment(
                        [
                            egui::pos2(x, rect.top() + 55.0),
                            egui::pos2(x, rect.bottom()),
                        ],
                        egui::Stroke::new(1.0_f32, Color32::from_gray(65)),
                    );
                    painter.text(
                        egui::pos2(x + 5.0, rect.top() + 10.0),
                        egui::Align2::LEFT_TOP,
                        (start + Duration::days(day))
                            .with_timezone(&offset)
                            .format("%b %d\n%a")
                            .to_string(),
                        egui::FontId::proportional(14.0),
                        Color32::LIGHT_GRAY,
                    );
                }
                for (i, event) in entries.iter().enumerate() {
                    let left =
                        ((event.start - start).num_seconds() as f32 / 86400.0 * day_width).max(0.0);
                    let right = ((event.end - start).num_seconds() as f32 / 86400.0 * day_width)
                        .min(total_width);
                    if right <= left {
                        continue;
                    }
                    let bar = egui::Rect::from_min_size(
                        egui::pos2(rect.left() + left, rect.top() + 65.0 + i as f32 * 86.0),
                        Vec2::new(right - left, 52.0),
                    );
                    let thumbnail = event_feed::thumbnail_url(&event.image);
                    let image_url = if ctx
                        .try_load_image(&thumbnail, egui::load::SizeHint::default())
                        .is_err()
                    {
                        event.image.clone()
                    } else {
                        thumbnail
                    };
                    let mut color = self.accent;
                    if !event.image.is_empty()
                        && let Ok(egui::load::ImagePoll::Ready { image }) =
                            ctx.try_load_image(&image_url, egui::load::SizeHint::default())
                    {
                        let pixels = &image.pixels;
                        let step = (pixels.len() / 128).max(1);
                        let samples: Vec<_> = pixels
                            .iter()
                            .step_by(step)
                            .filter(|p| p.a() > 128)
                            .collect();
                        if !samples.is_empty() {
                            let n = samples.len() as u32;
                            color = Color32::from_rgb(
                                (samples.iter().map(|p| p.r() as u32).sum::<u32>() / n / 2 + 110)
                                    as u8,
                                (samples.iter().map(|p| p.g() as u32).sum::<u32>() / n / 2 + 110)
                                    as u8,
                                (samples.iter().map(|p| p.b() as u32).sum::<u32>() / n / 2 + 110)
                                    as u8,
                            );
                        }
                    }
                    painter.rect_filled(bar, 8.0, color);
                    if !event.image.is_empty() {
                        let art = egui::Rect::from_min_max(
                            egui::pos2((bar.right() - 200.0).max(bar.left()), bar.top()),
                            bar.right_bottom(),
                        );
                        egui::Image::from_uri(&image_url)
                            .fit_to_exact_size(art.size())
                            .tint(Color32::from_white_alpha(145))
                            .paint_at(ui, art);
                    }
                    let clipped = painter.with_clip_rect(bar.shrink(10.0));
                    clipped.text(
                        bar.left_center() + Vec2::new(12.0, 0.0),
                        egui::Align2::LEFT_CENTER,
                        &event.name,
                        egui::FontId::proportional(17.0),
                        Color32::from_rgb(15, 20, 30),
                    );
                    painter.text(
                        egui::pos2(bar.right() - 5.0, bar.bottom() + 5.0),
                        egui::Align2::RIGHT_TOP,
                        format!("Ends in {}", duration(event.end - now)),
                        egui::FontId::proportional(14.0),
                        Color32::WHITE,
                    );
                    let response =
                        ui.interact(bar, egui::Id::new(("event", i)), egui::Sense::click());
                    if response.clicked() {
                        self.event_detail = Some((*event).clone());
                    }
                    response.on_hover_text(format!(
                        "{}\n{} – {} (server time)\n{}",
                        event.name,
                        event.start.with_timezone(&offset).format("%b %d %H:%M"),
                        event.end.with_timezone(&offset).format("%b %d %H:%M"),
                        event.category
                    ));
                }
                let x = rect.left() + (now - start).num_seconds() as f32 / 86400.0 * day_width;
                painter.line_segment(
                    [egui::pos2(x, rect.top()), egui::pos2(x, rect.bottom())],
                    egui::Stroke::new(2.0_f32, Color32::WHITE),
                );
            });
    }
    fn event_details(&mut self, ctx: &egui::Context) {
        let Some(event) = self.event_detail.clone() else {
            return;
        };
        let mut open = true;
        egui::Window::new(&event.name)
            .id(egui::Id::new("event-details"))
            .open(&mut open)
            .default_width(600.0)
            .resizable(true)
            .show(ctx, |ui| {
                if !event.image.is_empty() {
                    ui.add(
                        egui::Image::from_uri(&event.image)
                            .max_width(ui.available_width())
                            .max_height(320.0),
                    );
                }
                let offset = chrono::FixedOffset::east_opt(
                    server_offset(&self.event_game, &self.event_resolved_region).unwrap_or(8)
                        * 3600,
                )
                .unwrap();
                ui.label(format!(
                    "{} Server · {}",
                    server_name(&self.event_resolved_region),
                    event.category
                ));
                ui.label(format!(
                    "{} – {}",
                    event.start.with_timezone(&offset).format("%b %d, %Y %H:%M"),
                    event.end.with_timezone(&offset).format("%b %d, %Y %H:%M")
                ));
                ui.label(format!("Ends in {}", duration(event.end - Utc::now())));
                if !event.source.is_empty() && ui.button("Official source").clicked() {
                    open_link(&event.source);
                }
            });
        if !open {
            self.event_detail = None;
        }
    }
}
