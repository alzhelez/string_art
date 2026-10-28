// Пакет тестов
package ru.stringart.api;

// Allure: эпик
import io.qameta.allure.Epic;
// Allure: функция
import io.qameta.allure.Feature;
// Allure: история
import io.qameta.allure.Story;
// Разбор JSON
import io.restassured.path.json.JsonPath;
// После каждого теста
import org.testng.annotations.AfterMethod;
// Поставщик данных
import org.testng.annotations.DataProvider;
// Аннотация теста
import org.testng.annotations.Test;

// Список
import java.util.List;
// Словарь
import java.util.Map;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;
// Допуск для сравнения дробных чисел
import static org.assertj.core.api.Assertions.within;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Проекты")
// Жизненный цикл проекта
public class ProjectLifecycleTest extends BaseApiTest {

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Тест
    @Test(description = "TC-API-03 создание проекта из JPEG")
    // Номер кейса
    @Story("TC-API-03")
    // Создание проекта
    public void createProject() {
        // Создаём
        JsonPath p = createProject("Тестовый портрет", "50");

        // id — 12 шестнадцатеричных символов
        assertThat(p.getString("id")).matches("[0-9a-f]{12}");
        // Название
        assertThat(p.getString("name")).isEqualTo("Тестовый портрет");
        // Диаметр
        assertThat(p.getDouble("diameter_cm")).isEqualTo(50.0);
        // Нитей в границах
        assertThat(p.getInt("line_count")).isBetween(1000, 5000);
        // Лучшее число нитей по кривой сходства
        int best = api().get("/api/projects/" + p.getString("id") + "/similarity").jsonPath().getInt("best_lines");
        // Совпадает с выбранным
        assertThat(p.getInt("line_count")).as("рекомендация — максимум сходства с фото").isEqualTo(best);
        // Шаг 1
        assertThat(p.getInt("current_step")).isEqualTo(1);
        // Скорость 2
        assertThat(p.getDouble("speed_sec")).isEqualTo(2.0);

        // Схема
        List<Integer> sequence = p.getList("sequence", Integer.class);
        // На 5000 нитей
        assertThat(sequence).hasSize(5001);
        // Начало A1
        assertThat(sequence.get(0)).as("старт с A1").isZero();
        // Все номера гвоздей 0…239
        assertThat(sequence).allMatch(n -> n >= 0 && n < 240);

        // Чистая длина
        double raw = p.getDouble("stats.raw_length_m");
        // С запасом
        double total = p.getDouble("stats.total_length_m");
        // Запас 15 %
        assertThat(total).isCloseTo(raw * 1.15, within(0.1));
        // Катушек хватает
        assertThat(p.getInt("stats.spool_m") * p.getInt("stats.spool_count")).isGreaterThanOrEqualTo((int) Math.ceil(total));
    }

    // Тест
    @Test(description = "TC-API-04 PNG с прозрачностью, имя из файла, 70 см")
    // Номер кейса
    @Story("TC-API-04")
    // PNG без названия
    public void createFromPngUsesFileName() {
        // Загружаем на 70 см
        JsonPath p = upload(PORTRAIT_PNG, "image/png", null, "70").then().statusCode(201).extract().jsonPath();
        // Блок с уборкой
        try {
            // Название — имя файла
            assertThat(p.getString("name")).isEqualTo("portrait");
            // Нитей в границах
            assertThat(p.getInt("line_count")).isBetween(1000, 5000);
        // В любом случае —
        } finally {
            // — удаляем
            api().delete("/api/projects/" + p.getString("id"));
        }
    }

    // Тест
    @Test(description = "TC-API-07 проект есть в списке, без sequence")
    // Номер кейса
    @Story("TC-API-07")
    // Проект в списке
    public void listContainsProject() {
        // Создаём
        String id = createProject("Список", "50").getString("id");
        // Список
        List<Map<String, Object>> items = api().get("/api/projects").then().statusCode(200)
                // разбираем как список словарей
                .extract().jsonPath().getList("$");
        // Ищем наш
        Map<String, Object> found = items.stream().filter(i -> id.equals(i.get("id"))).findFirst().orElseThrow();
        // Без схемы, с расчётом
        assertThat(found).doesNotContainKey("sequence").containsKey("stats");
    }

    // Поставщик неизвестных id
    @DataProvider
    // Метод поставщика
    public Object[][] unknownIds() {
        // Несуществующий, короткий, заглавными
        return new Object[][]{{"000000000000"}, {"nope"}, {"ABCDEF123456"}};
    }

    // Тест берёт данные из поставщика
    @Test(dataProvider = "unknownIds", description = "TC-API-08 неизвестный проект — 404")
    // Номер кейса
    @Story("TC-API-08")
    // Неизвестный проект
    public void unknownProject(String id) {
        // → 404
        api().get("/api/projects/" + id).then().statusCode(404);
    }

    // Тест
    @Test(description = "TC-API-09 сохранение шага")
    // Номер кейса
    @Story("TC-API-09")
    // Сохранение шага
    public void saveProgress() {
        // Создаём
        String id = createProject("Прогресс", "50").getString("id");
        // Шаг 137
        patch(id, "{\"current_step\": 137}").then().statusCode(200);
        // Сохранился
        assertThat(api().get("/api/projects/" + id).jsonPath().getInt("current_step")).isEqualTo(137);
    }

    // Поставщик скоростей
    @DataProvider
    // Метод поставщика
    public Object[][] speeds() {
        // Пары «отправили — сохранилось»
        return new Object[][]{{2.1, 2.1}, {1.9, 1.9}, {2.04999, 2.0}, {0.5, 0.5}, {10.0, 10.0}};
    }

    // Тест берёт данные из поставщика
    @Test(dataProvider = "speeds", description = "TC-API-10 скорость сохраняется с точностью 0,1 с")
    // Номер кейса
    @Story("TC-API-10")
    // Скорость округляется
    public void speedRoundedToTenth(double sent, double saved) {
        // Создаём
        String id = createProject("Скорость", "50").getString("id");
        // Отправляем
        double actual = patch(id, "{\"speed_sec\": " + sent + "}").then().statusCode(200)
                // разбираем
                .extract().jsonPath().getDouble("speed_sec");
        // Сохранено округлённое
        assertThat(actual).isEqualTo(saved);
    }

    // Тест
    @Test(description = "TC-API-12 уменьшение линий подтягивает прогресс")
    // Номер кейса
    @Story("TC-API-12")
    // Меньше нитей — прогресс прижимается
    public void reducingLinesClampsProgress() {
        // Создаём
        String id = createProject("Линии", "50").getString("id");
        // 2000 нитей
        patch(id, "{\"line_count\": 2000}").then().statusCode(200);
        // Шаг 1900
        patch(id, "{\"current_step\": 1900}").then().statusCode(200);
        // Уменьшаем до 1500
        JsonPath body = patch(id, "{\"line_count\": 1500}").then().statusCode(200).extract().jsonPath();
        // Шаг прижат
        assertThat(body.getInt("current_step")).isEqualTo(1500);
        // Расчёт пересчитан
        assertThat(body.getInt("stats.steps")).isEqualTo(1500);
    }

    // Тест
    @Test(description = "TC-API-13 диаметр меняет длину лески, но не схему")
    // Номер кейса
    @Story("TC-API-13")
    // Диаметр
    public void diameterScalesThread() {
        // Создаём
        JsonPath before = createProject("Диаметр", "50");
        // Диаметр 100
        JsonPath after = patch(before.getString("id"), "{\"diameter_cm\": 100}").then().statusCode(200)
                // разбираем
                .extract().jsonPath();
        // Схема та же
        assertThat(after.getList("sequence")).isEqualTo(before.getList("sequence"));
        // Леска —
        assertThat(after.getDouble("stats.raw_length_m"))
                // — вдвое длиннее
                .isCloseTo(before.getDouble("stats.raw_length_m") * 2, within(0.1));
    }

    // Тест
    @Test(description = "TC-API-14 шаги непрерывны, расход лески растёт")
    // Номер кейса
    @Story("TC-API-14")
    // Шаги без разрывов
    public void stepsAreContinuous() {
        // Создаём
        String id = createProject("Шаги", "50").getString("id");
        // 2000 нитей
        patch(id, "{\"line_count\": 2000}").then().statusCode(200);
        // Первые 50 шагов
        JsonPath page = api().queryParam("offset", 0).queryParam("limit", 50)
                // → 200, разбираем
                .get("/api/projects/" + id + "/steps").then().statusCode(200).extract().jsonPath();
        // Всего 2000
        assertThat(page.getInt("total")).isEqualTo(2000);
        // Шаги
        List<Map<String, Object>> items = page.getList("items");
        // Их 50
        assertThat(items).hasSize(50);
        // Первый — номер 1 из A1
        assertThat(items.get(0)).containsEntry("number", 1).containsEntry("from_label", "A1");
        // Для каждой пары соседних —
        for (int i = 1; i < items.size(); i++) {
            // — нить из конца предыдущей
            assertThat(items.get(i).get("from_nail")).isEqualTo(items.get(i - 1).get("to_nail"));
            // — расход растёт
            assertThat(((Number) items.get(i).get("thread_used_m")).doubleValue())
                    // сравниваем числа
                    .isGreaterThan(((Number) items.get(i - 1).get("thread_used_m")).doubleValue());
        }
        // За концом
        List<Integer> tail = api().queryParam("offset", 1990).queryParam("limit", 50)
                // номера шагов
                .get("/api/projects/" + id + "/steps").jsonPath().getList("items.number", Integer.class);
        // Последние 10
        assertThat(tail).hasSize(10).startsWith(1991).endsWith(2000);
    }

    // Тест
    @Test(description = "TC-API-15 превью и исходник — PNG")
    // Номер кейса
    @Story("TC-API-15")
    // Превью и исходник
    public void previewAndSourcePng() {
        // Создаём
        String id = createProject("PNG", "50").getString("id");
        // Оба адреса
        for (String url : List.of("/api/projects/" + id + "/preview.png?size=300", "/api/projects/" + id + "/source.png")) {
            // → 200, тип PNG, байты
            byte[] png = api().get(url).then().statusCode(200).contentType("image/png").extract().asByteArray();
            // Сигнатура PNG
            assertThat(png).startsWith(0x89, 'P', 'N', 'G');
        }
        // Маленькое превью → 422
        api().get("/api/projects/" + id + "/preview.png?size=50").then().statusCode(422);
    }

    // Тест
    @Test(description = "TC-API-17 удаление")
    // Номер кейса
    @Story("TC-API-17")
    // Удаление
    public void deleteProject() {
        // Загружаем
        String id = upload(PORTRAIT_JPG, "image/jpeg", null, null).then().statusCode(201)
                // id
                .extract().jsonPath().getString("id");
        // Удаляем → 204
        api().delete("/api/projects/" + id).then().statusCode(204);
        // Читаем → 404
        api().get("/api/projects/" + id).then().statusCode(404);
        // Удаляем снова → 404
        api().delete("/api/projects/" + id).then().statusCode(404);
    }

    // Тест
    @Test(description = "TC-API-26 кривая сходства и рекомендация по максимуму")
    // Номер кейса
    @Story("TC-API-26")
    // Кривая сходства
    public void similarityCurve() {
        // Создаём
        JsonPath p = createProject("Сходство", "50");
        // id
        String id = p.getString("id");
        // Кривая
        JsonPath sim = api().get("/api/projects/" + id + "/similarity").then().statusCode(200).extract().jsonPath();
        // Значения сходства
        List<Float> scores = sim.getList("curve.score", Float.class);
        // 41 точка
        assertThat(scores).hasSize(41);
        // Рекомендация совпадает
        assertThat(sim.getInt("best_lines")).isEqualTo(p.getInt("line_count"));
        // Лучшее сходство — максимум кривой
        assertThat((double) sim.getFloat("best_score")).isEqualTo((double) java.util.Collections.max(scores), within(1e-6));
        // Для 30 см
        int small = api().queryParam("diameter_cm", 30).get("/api/projects/" + id + "/similarity")
                // лучшее число нитей
                .jsonPath().getInt("best_lines");
        // Не больше, чем для 50 см
        assertThat(small).isLessThanOrEqualTo(sim.getInt("best_lines"));
    }
}
