// Минимальный i18n-слой. Архитектурное правило проекта: НИКАКОГО хардкода UI-текста —
// весь текст идёт через i18n.t(key). Локали в /locales/<lang>.json. MVP — только ru.
let dict = {};

export const i18n = {
  setDict(obj) { dict = obj || {}; },

  /**
   * t("log.killed", { name: "Налётчик", lvl: "ур. 1" })
   * Подстановка {placeholder} из params. Если ключа нет — возвращаем сам ключ (видно в проде).
   */
  t(key, params) {
    let str = dict[key];
    if (str === undefined) return key;
    if (params) {
      for (const k in params) str = str.replaceAll(`{${k}}`, params[k]);
    }
    return str;
  }
};
