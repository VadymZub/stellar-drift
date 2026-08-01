use tauri::Manager;

// Custom command instead of relying on window.__TAURI__.app.getVersion() — that
// global's exact shape under withGlobalTauri turned out unreliable (silently
// resolved to nothing, no error either), so a plain own command sidesteps
// guessing at Tauri's core-module JS bindings entirely.
#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
  app.package_info().version.to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![get_app_version])
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
