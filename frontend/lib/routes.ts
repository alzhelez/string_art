// Адреса страниц. Номер проекта — в параметре ?id=, а не в пути: так приложение
// собирается в статические файлы (next export) и работает в десктопной версии без Node.js.
// Хук Next.js для чтения параметров адреса (?id=…)
import { useSearchParams } from "next/navigation";

// Все адреса страниц приложения в одном месте
export const routes = {
  // Главная: новый портрет и список
  home: "/",
  // Студия проекта (encodeURIComponent — защита от спецсимволов в id)
  project: (id: string) => `/project?id=${encodeURIComponent(id)}`,
  // Правка фото проекта
  photo: (id: string) => `/project/photo?id=${encodeURIComponent(id)}`,
  // Режим плетения
  weave: (id: string) => `/project/weave?id=${encodeURIComponent(id)}`,
};

/** id проекта из адреса (страницу нужно обернуть в <Suspense>). */
// Хук: прочитать id проекта из адреса страницы
export function useProjectId(): string {
  // Параметр id или пустая строка, если его нет
  return useSearchParams().get("id") ?? "";
}
