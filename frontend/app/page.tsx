// Блок «Новый портрет» (загрузка и редактор фото)
import { NewProject } from "@/components/NewProject";
// Список готовых портретов
import { ProjectList } from "@/components/ProjectList";

// Главная страница приложения (адрес /)
export default function HomePage() {
  // Разметка страницы
  return (
    // Фрагмент — группа элементов без лишней обёртки
    <>
      {/* Сверху — создание нового портрета */}
      <NewProject />
      {/* Ниже — уже созданные портреты */}
      <ProjectList />
    </>
  );
}
