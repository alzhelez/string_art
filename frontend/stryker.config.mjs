// Мутационное тестирование фронтенда (Stryker): в код вносятся маленькие «поломки» (мутанты) —
// «<» вместо «<=», «+» вместо «−», пустая функция… — и проверяется, что юнит-тесты это замечают.
// Выживший мутант = место, где тесты не проверяют поведение. Запуск: npx stryker run
// (долго, поэтому в CI — отдельный процесс .github/workflows/mutation.yml раз в неделю и вручную).

// Настройки Stryker
export default {
  // Тесты запускает Vitest
  testRunner: "vitest",
  // Настройки Vitest — те же, что у npm test
  vitest: { configFile: "vitest.config.mts" },
  // Что «ломаем»: чистая логика без DOM и сети — гвозди, леска, катушка, время, кадр, нити, формат, обновление
  mutate: [
    // Гвозди и подписи
    "lib/nails.ts",
    // Длина лески и катушка
    "lib/thread.ts",
    // План смены катушки
    "lib/spool.ts",
    // Время до конца
    "lib/eta.ts",
    // Кадр, уровни, яркость и контраст
    "lib/prep.ts",
    // Нити цветного портрета
    "lib/layers.ts",
    // Скорость автоперелистывания
    "lib/speed.ts",
    // Числа и время по-русски
    "lib/format.ts",
    // Проверка новой версии
    "lib/update.ts",
    // Управление без рук
    "lib/control.ts",
  ],
  // Для каждого мутанта запускаем только тесты, которые проходят через изменённую строку
  coverageAnalysis: "perTest",
  // Отчёты: HTML (reports/mutation), сводка в консоли, ход работы
  reporters: ["html", "clear-text", "progress"],
  // Куда положить HTML-отчёт
  htmlReporter: { fileName: "reports/mutation/index.html" },
  // Пороги: выше 80 % — хорошо, ниже 60 % — тревожно, ниже 50 % — провал
  thresholds: { high: 80, low: 60, break: 50 },
  // TypeScript 7 (родной компилятор) не даёт JS-API, которым Stryker переписывает tsconfig для
  // project references; у нас их нет — указываем несуществующий файл, и этот шаг пропускается
  tsconfigFile: "tsconfig.stryker-skip.json",
  // Рабочие файлы Stryker — во временной папке
  tempDirName: ".stryker-tmp",
  // Каждый мутант — не дольше 60 секунд сверх обычного времени тестов
  timeoutMS: 60_000,
};
