// Адреса страниц. Номер проекта — в параметре ?id=, а не в пути: так приложение
// собирается в статические файлы (next export) и работает в десктопной версии без Node.js.
import { useSearchParams } from "next/navigation";

export const routes = {
  home: "/",
  project: (id: string) => `/project?id=${encodeURIComponent(id)}`,
  photo: (id: string) => `/project/photo?id=${encodeURIComponent(id)}`,
  weave: (id: string) => `/project/weave?id=${encodeURIComponent(id)}`,
};

/** id проекта из адреса (страницу нужно обернуть в <Suspense>). */
export function useProjectId(): string {
  return useSearchParams().get("id") ?? "";
}
