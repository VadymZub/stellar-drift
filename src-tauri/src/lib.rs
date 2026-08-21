use std::fs;
use std::time::{Duration, SystemTime};
use tauri::Manager;

// Custom command instead of relying on window.__TAURI__.app.getVersion() — that
// global's exact shape under withGlobalTauri turned out unreliable (silently
// resolved to nothing, no error either), so a plain own command sidesteps
// guessing at Tauri's core-module JS bindings entirely.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
  app.package_info().version.to_string()
}

// tauri-plugin-updater's NSIS flow on Windows extracts each downloaded installer to
// %TEMP%\{productName}-{version}-updater-{random} and is SUPPOSED to remove it after
// running — in practice it doesn't (see диалог "для приложения накапливаются старые
// файлы", user's own %TEMP% had ~10 of these at ~260MB each, going back to v1.1.356).
// Likely cause: we call process::relaunch() right after downloadAndInstall() resolves
// (see updater.js), which may tear down the app before the NSIS child process finishes
// its own self-cleanup of the extraction folder it ran from.
//
// Fixing the plugin itself is out of scope — instead, sweep leftover extraction folders
// on every app startup (called from checkForUpdates() in updater.js, which only runs
// inside a real Tauri window). Age-gated at 2 minutes so we never race a genuinely
// in-progress extraction from the CURRENT session's own update-in-flight.
#[tauri::command]
fn cleanup_old_updater_temp_dirs() -> u32 {
  let temp = std::env::temp_dir();
  let entries = match fs::read_dir(&temp) {
    Ok(e) => e,
    Err(_) => return 0,
  };
  let mut removed = 0u32;
  for entry in entries.flatten() {
    let path = entry.path();
    if !path.is_dir() {
      continue;
    }
    let name = match path.file_name().and_then(|n| n.to_str()) {
      Some(n) => n,
      None => continue,
    };
    if !name.starts_with("Stellar Drift-") || !name.contains("-updater-") {
      continue;
    }
    let is_old = entry
      .metadata()
      .and_then(|m| m.modified())
      .ok()
      .and_then(|modified| SystemTime::now().duration_since(modified).ok())
      .map(|age| age >= Duration::from_secs(120))
      .unwrap_or(false); // не смогли прочитать mtime — не трогаем, лучше пропустить, чем удалить рано
    if is_old && fs::remove_dir_all(&path).is_ok() {
      removed += 1;
    }
  }
  removed
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![get_app_version, cleanup_old_updater_temp_dirs])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      // ВРЕМЕННО: devtools открыты в самом release-билде (обычно только debug) —
      // диагностика "TypeError: Failed to fetch" внутри упакованного приложения,
      // где иначе вообще не видно реальной причины сетевой ошибки. cfg(feature =
      // "devtools") тут был бы НЕПРАВИЛЬНЫМ — это проверяла бы фичу СВОЕГО крейта
      // (app), а не зависимости tauri (её фичу включили в Cargo.toml) — метод
      // open_devtools() просто существует или нет в зависимости от той фичи, свой
      // cfg-гейт не нужен. Убрать вместе с devtools-фичей в Cargo.toml после того,
      // как причина найдена и починена.
      if let Some(window) = app.get_webview_window("main") {
        window.open_devtools();
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
