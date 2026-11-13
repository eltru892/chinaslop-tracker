use super::*;
impl TrackerApp {
    pub(super) fn appearance(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.heading("Appearance");
        let old = self.settings.palette;
        ui.horizontal_wrapped(|ui| {
            for (i, name) in ["Mint", "Purple", "Blue", "Rose", "Amber"]
                .iter()
                .enumerate()
            {
                ui.selectable_value(&mut self.settings.palette, i, *name);
            }
        });
        if old != self.settings.palette {
            self.settings.background.clear();
            self.save();
            self.load_background(ctx);
        }
        ui.horizontal(|ui| {
            if ui.button("Choose background image").clicked()
                && let Some(path) = rfd::FileDialog::new()
                    .add_filter("Images", &["png", "jpg", "jpeg", "webp"])
                    .pick_file()
            {
                self.settings.background = path.to_string_lossy().into();
                self.save();
                self.load_background(ctx);
            }
            if ui.button("Remove background").clicked() {
                self.settings.background.clear();
                self.save();
                self.load_background(ctx);
            }
        });
        ui.label("Find an operator");
        ui.add(egui::TextEdit::singleline(&mut self.art_search).hint_text("Search backgrounds"));
        let mut chosen = None;
        egui::ScrollArea::vertical()
            .id_salt("background-picker")
            .max_height(260.0)
            .show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    for item in &self.artwork {
                        let name = item["name"].as_str().unwrap_or("");
                        if !name
                            .to_lowercase()
                            .contains(&self.art_search.to_lowercase())
                        {
                            continue;
                        }
                        let file = item["image"].as_str().unwrap_or("");
                        let path = assets().join(file);
                        ui.vertical(|ui| {
                            ui.set_width(135.0);
                            if let Ok(url) = reqwest::Url::from_file_path(&path)
                                && ui
                                    .add(
                                        egui::Image::from_uri(url.to_string())
                                            .fit_to_exact_size(Vec2::new(135.0, 80.0))
                                            .sense(egui::Sense::click()),
                                    )
                                    .clicked()
                            {
                                chosen = Some(format!("asset:{file}"));
                            }
                            ui.label(name);
                        });
                    }
                });
            });
        if let Some(path) = chosen {
            self.settings.background = path;
            self.save();
            self.load_background(ctx);
        }
    }
    pub(super) fn load_background(&mut self, ctx: &egui::Context) {
        self.background_key = self.settings.background.clone();
        self.background = None;
        self.accent = [
            Color32::from_rgb(112, 221, 186),
            Color32::from_rgb(189, 167, 255),
            Color32::from_rgb(130, 185, 255),
            Color32::from_rgb(245, 170, 200),
            Color32::from_rgb(243, 187, 104),
        ][self.settings.palette.min(4)];
        if !self.settings.background.is_empty() {
            let path = if let Some(file) = self.settings.background.strip_prefix("asset:") {
                assets().join(file)
            } else {
                PathBuf::from(&self.settings.background)
            };
            match image::open(path) {
                Ok(image) => {
                    let rgba = image.thumbnail(1920, 1920).to_rgba8();
                    let pixels: Vec<_> = rgba
                        .pixels()
                        .step_by((rgba.len() / 4 / 256).max(1))
                        .filter(|p| p[3] > 128)
                        .collect();
                    if !pixels.is_empty() {
                        let n = pixels.len() as u32;
                        self.accent = Color32::from_rgb(
                            (pixels.iter().map(|p| p[0] as u32).sum::<u32>() / n / 2 + 110) as u8,
                            (pixels.iter().map(|p| p[1] as u32).sum::<u32>() / n / 2 + 110) as u8,
                            (pixels.iter().map(|p| p[2] as u32).sum::<u32>() / n / 2 + 110) as u8,
                        );
                    }
                    self.background = Some(ctx.load_texture(
                        "wallpaper",
                        egui::ColorImage::from_rgba_unmultiplied(
                            [rgba.width() as usize, rgba.height() as usize],
                            rgba.as_raw(),
                        ),
                        egui::TextureOptions::LINEAR,
                    ));
                }
                Err(_) => self.status = "Background could not be loaded.".into(),
            }
        }
        let mut visuals = egui::Visuals::dark();
        visuals.selection.bg_fill = self.accent.gamma_multiply(0.45);
        visuals.widgets.active.bg_fill = self.accent.gamma_multiply(0.35);
        visuals.widgets.hovered.bg_fill = self.accent.gamma_multiply(0.25);
        ctx.set_visuals(visuals);
    }
}
