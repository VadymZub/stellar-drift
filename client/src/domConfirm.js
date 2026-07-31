// Замена нативного window.confirm() — не полагаемся на встроенные диалоги браузера/
// WebView2 внутри Tauri (диалог: "жму создать, тоже самое... может у приложения проблема
// с этим сообщением?" — регистрация с дублирующей почтой работала в обычном браузере,
// но не в собранном приложении). Тот же приём, что updater.js уже использует для попапа
// обновления — свой DOM-оверлей поверх канваса, а не any native dialog API.
export function domConfirm(message, { okText = 'ДА', cancelText = 'ОТМЕНА' } = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(2,4,10,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: '10000',
    });

    const box = document.createElement('div');
    Object.assign(box.style, {
      background: 'rgba(5,10,25,0.97)', border: '1px solid rgba(77,208,225,0.25)',
      borderRadius: '8px', padding: '28px 32px', width: '320px',
      display: 'flex', flexDirection: 'column', gap: '16px',
      fontFamily: "'Segoe UI', system-ui, sans-serif", color: '#cfd8dc',
    });

    const msg = document.createElement('div');
    msg.textContent = message;
    Object.assign(msg.style, { fontSize: '13px', textAlign: 'center', lineHeight: '1.4' });

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', gap: '10px' });

    const finish = (result) => { overlay.remove(); resolve(result); };

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.textContent = okText;
    Object.assign(btnOk.style, {
      flex: '1', background: '#4dd0e1', color: '#03070f', border: 'none', borderRadius: '4px',
      padding: '12px', fontSize: '13px', fontWeight: '700', letterSpacing: '1px', cursor: 'pointer',
      fontFamily: 'inherit',
    });
    btnOk.addEventListener('click', () => finish(true));

    const btnCancel = document.createElement('button');
    btnCancel.type = 'button';
    btnCancel.textContent = cancelText;
    Object.assign(btnCancel.style, {
      flex: '1', background: 'transparent', color: '#607d8b', border: '1px solid rgba(96,125,139,0.4)',
      borderRadius: '4px', padding: '12px', fontSize: '13px', letterSpacing: '1px', cursor: 'pointer',
      fontFamily: 'inherit',
    });
    btnCancel.addEventListener('click', () => finish(false));

    btnRow.append(btnOk, btnCancel);
    box.append(msg, btnRow);
    overlay.append(box);
    document.body.append(overlay);
  });
}
