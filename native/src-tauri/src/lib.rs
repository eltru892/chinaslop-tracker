use tauri::{WebviewUrl, WebviewWindowBuilder};
#[cfg(not(target_os = "android"))]
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

#[cfg(not(target_os = "android"))]
mod desktop {
    use std::{io::{BufRead, BufReader}, process::{Child, Command, Stdio}, sync::{Mutex, mpsc}, time::Duration};
    use tauri::Manager;
    pub struct Server(pub Mutex<Child>);
    impl Drop for Server {
        fn drop(&mut self) { if let Ok(child) = self.0.get_mut() { let _ = child.kill(); let _ = child.wait(); } }
    }
    pub fn start(app: &tauri::App) -> Result<(String, String), Box<dyn std::error::Error>> {
        let resource = dunce::simplified(&app.path().resource_dir()?).to_path_buf();
        // Reuse Electron's existing private account/history directory on Windows.
        let data = std::env::var_os("APPDATA").map(std::path::PathBuf::from)
            .map(|root| root.join("Chinaslop Tracker").join("tracker"))
            .unwrap_or(app.path().app_data_dir()?.join("tracker"));
        let key = uuid::Uuid::new_v4().to_string() + &uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(resource.join("runtime/node.exe"));
        command.arg(resource.join("tracker/server.mjs"))
            .env("PORT", "4318").env("TRACKER_ACCESS_KEY", &key).env("TRACKER_DATA_DIR", data)
            .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        #[cfg(windows)] {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn()?;
        let stdout = child.stdout.take().ok_or("Missing server output")?;
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(url) = line.strip_prefix("Game Progress Tracker: ") { let _ = tx.send(url.to_string()); break; }
            }
        });
        let server = Server(Mutex::new(child));
        let url = rx.recv_timeout(Duration::from_secs(30))?;
        app.manage(server);
        Ok((url, key))
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Local HTTP pages have no Tauri IPC capability; native navigation callbacks
    // open official HTTPS links without exposing native commands to page scripts.
    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build());
    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    }));
    builder.setup(|app| {
        #[cfg(not(target_os = "android"))]
        let (origin, key) = desktop::start(app)?;
        #[cfg(target_os = "android")]
        let origin = "http://127.0.0.1:4319".to_string();
        let allowed = origin.clone();
        let handle = app.handle().clone();
        let new_window_handle = app.handle().clone();
        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("Chinaslop Tracker").inner_size(1440.0, 960.0).min_inner_size(380.0, 600.0)
            .on_navigation(move |url| {
                if url.scheme() == "tauri" || url.host_str() == Some("tauri.localhost") { return true; }
                if url.origin().ascii_serialization() == allowed { return true; }
                if url.scheme() == "https" { let _ = handle.opener().open_url(url.as_str(), None::<&str>); }
                false
            })
            .on_new_window(move |url, _| {
                if url.scheme() == "https" { let _ = new_window_handle.opener().open_url(url.as_str(), None::<&str>); }
                tauri::webview::NewWindowResponse::Deny
            });
        let window = builder.build()?;
        #[cfg(not(target_os = "android"))] {
            window.set_cookie(tauri::webview::Cookie::build(("tracker_session", key))
                .domain("127.0.0.1").path("/").http_only(true)
                .same_site(cookie::SameSite::Strict).build())?;
            window.navigate(origin.parse()?)?;
        }
        #[cfg(target_os = "android")]
        let _ = window;
        Ok(())
    }).build(tauri::generate_context!()).expect("Could not start Chinaslop Tracker")
      .run(|app, event| {
          #[cfg(not(target_os = "android"))]
          if matches!(event, tauri::RunEvent::Exit) {
              if let Some(server) = app.try_state::<desktop::Server>() {
                  if let Ok(mut child) = server.0.lock() { let _ = child.kill(); let _ = child.wait(); }
              }
          }
          #[cfg(target_os = "android")]
          let _ = (app, event);
      });
}
