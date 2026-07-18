// Tauri desktop auto-update. Web/dev server never runs this path — window.__TAURI__
// only exists inside a real Tauri window (dev or built exe), never in a plain browser
// tab (see tauri.conf.json app.withGlobalTauri: true — client/ has no bundler/
// package.json to `import` @tauri-apps/plugin-updater from, so the global-injection
// escape hatch is how vanilla ES modules reach the plugin's JS API instead).
export async function checkForUpdates() {
  const tauri = window.__TAURI__;
  if (!tauri?.updater?.check) return;

  let update;
  try {
    update = await tauri.updater.check();
  } catch (e) {
    console.warn('[updater] check() failed:', e);
    return;
  }
  if (!update) return;

  _showPrompt(update, tauri);
}

function _showPrompt(update, tauri) {
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'fixed', inset: '0', background: 'rgba(2,4,10,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10000',
  });

  const box = document.createElement('div');
  Object.assign(box.style, {
    background: 'rgba(5,10,25,0.97)', border: '1px solid rgba(77,208,225,0.25)',
    borderRadius: '8px', padding: '28px 32px', width: '320px',
    display: 'flex', flexDirection: 'column', gap: '14px',
    fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#cfd8dc',
  });

  const title = document.createElement('div');
  title.textContent = 'ДОСТУПНО ОБНОВЛЕНИЕ';
  Object.assign(title.style, {
    fontFamily: 'Orbitron, sans-serif', fontSize: '15px', letterSpacing: '2px',
    color: '#4dd0e1', textAlign: 'center',
  });

  const ver = document.createElement('div');
  ver.textContent = `Версия ${update.version} (у вас ${update.currentVersion})`;
  Object.assign(ver.style, { fontSize: '12px', color: '#90a4ae', textAlign: 'center' });

  const status = document.createElement('div');
  Object.assign(status.style, { fontSize: '12px', color: '#607d8b', textAlign: 'center', minHeight: '16px' });

  const btnRow = document.createElement('div');
  Object.assign(btnRow.style, { display: 'flex', gap: '10px', marginTop: '4px' });

  const btnUpdate = document.createElement('button');
  btnUpdate.type = 'button';
  btnUpdate.textContent = 'ОБНОВИТЬ';
  Object.assign(btnUpdate.style, {
    flex: '1', background: '#4dd0e1', color: '#03070f', border: 'none', borderRadius: '4px',
    padding: '12px', fontSize: '13px', fontWeight: '700', letterSpacing: '1px', cursor: 'pointer',
    fontFamily: 'inherit',
  });

  const btnLater = document.createElement('button');
  btnLater.type = 'button';
  btnLater.textContent = 'ПОЗЖЕ';
  Object.assign(btnLater.style, {
    flex: '1', background: 'transparent', color: '#607d8b', border: '1px solid rgba(96,125,139,0.4)',
    borderRadius: '4px', padding: '12px', fontSize: '13px', letterSpacing: '1px', cursor: 'pointer',
    fontFamily: 'inherit',
  });

  btnLater.addEventListener('click', () => overlay.remove());

  btnUpdate.addEventListener('click', async () => {
    btnUpdate.disabled = true; btnLater.disabled = true;
    let downloaded = 0, total = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength || 0;
          status.textContent = 'Загрузка обновления...';
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          status.textContent = total > 0
            ? `Загрузка... ${Math.round(downloaded / total * 100)}%`
            : 'Загрузка обновления...';
        } else if (event.event === 'Finished') {
          status.textContent = 'Установка...';
        }
      });
      status.textContent = 'Перезапуск...';
      await tauri.process.relaunch();
    } catch (e) {
      console.warn('[updater] install failed:', e);
      status.textContent = 'Не удалось установить обновление';
      btnUpdate.disabled = false; btnLater.disabled = false;
    }
  });

  btnRow.append(btnUpdate, btnLater);
  box.append(title, ver, status, btnRow);
  overlay.append(box);
  document.body.append(overlay);
}
