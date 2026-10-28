// Компонент работает в браузере
"use client";

// Состояние и эффекты React
import { useEffect, useState } from "react";
// Запросы к бэкенду
import { api } from "@/lib/api";
// Проверка обновлений: «отложено», сравнение версий, последний релиз
import { dismiss, isDismissed, isNewer, latestRelease, type Release } from "@/lib/update";
// Значки
import { Icon } from "./ui/Icon";

/** Только в программе для Windows: «вышла новая версия — скачать?». */
// Плашка обновления
export function UpdateNotice() {
  // Найденное обновление (текущая версия и релиз) или null
  const [update, setUpdate] = useState<{ current: string; release: Release } | null>(null);

  // Проверяем один раз при открытии
  useEffect(() => {
    // Флаг «компонент ещё на экране» — не обновлять состояние после ухода со страницы
    let alive = true;
    // Асинхронная функция, вызванная сразу
    (async () => {
      // Версия программы (ошибка сети — просто null)
      const app = await api.appInfo().catch(() => null);
      // Не программа для Windows или сборка разработчика — не проверяем
      if (!app?.desktop || app.version === "dev") return;
      // Последний релиз с GitHub (с кэшем на 6 часов)
      const release = await latestRelease();
      // Релиз новее, его не откладывали и компонент ещё жив
      if (alive && release && isNewer(release.version, app.version) && !isDismissed(release.version)) {
        // Показываем плашку
        setUpdate({ current: app.version, release });
      }
    })();
    // При уходе со страницы
    return () => {
      // Помечаем, что компонента больше нет
      alive = false;
    };
    // [] — эффект выполняется один раз, при появлении компонента
  }, []);

  // Обновления нет — ничего не рисуем
  if (!update) return null;
  // Плашка
  return (
    // role="status" — экранный диктор озвучит появление
    <div className="update-notice" role="status" data-testid="update-notice">
      {/* Значок загрузки */}
      <Icon name="download" size={18} />
      {/* Текст сообщения */}
      <span>
        {/* Номер новой и текущей версии */}
        Вышла новая версия <strong>{update.release.version}</strong> (у вас {update.current}). Портреты при обновлении
        сохранятся.
      </span>
      {/* Ссылка на страницу релиза в новой вкладке; noreferrer — не передавать адрес нашей страницы */}
      <a className="btn primary small" href={update.release.url} target="_blank" rel="noreferrer">
        {/* Надпись на кнопке */}
        Скачать
      </a>
      {/* Кнопка «Позже» */}
      <button
        // Обычная кнопка (не отправка формы)
        type="button"
        // Стиль — прозрачная маленькая
        className="btn ghost small"
        // По нажатию
        onClick={() => {
          // Запоминаем, что эту версию отложили
          dismiss(update.release.version);
          // Скрываем плашку
          setUpdate(null);
        }}
      >
        {/* Надпись на кнопке */}
        Позже
      </button>
    </div>
  );
}
