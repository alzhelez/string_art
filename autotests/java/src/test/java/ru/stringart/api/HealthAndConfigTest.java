// Пакет тестов
package ru.stringart.api;

// Allure: эпик — крупный раздел отчёта
import io.qameta.allure.Epic;
// Allure: функция
import io.qameta.allure.Feature;
// Allure: история — номер кейса
import io.qameta.allure.Story;
// Разбор JSON
import io.restassured.path.json.JsonPath;
// Поставщик данных для параметризованных тестов
import org.testng.annotations.DataProvider;
// Аннотация теста TestNG
import org.testng.annotations.Test;

// Список значений
import java.util.List;

// Читаемые проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;
// Сравнение в проверках RestAssured
import static org.hamcrest.Matchers.equalTo;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Служебные ручки")
// Сервер жив и настройки
public class HealthAndConfigTest extends BaseApiTest {

    // Тест с описанием
    @Test(description = "TC-API-01 health")
    // Номер кейса
    @Story("TC-API-01")
    // Сервер жив
    public void healthReturnsOk() {
        // GET /api/health → 200 и {"status": "ok"}
        api().get("/api/health").then().statusCode(200).body("status", equalTo("ok"));
    }

    // Тест
    @Test(description = "TC-API-02 config: гвозди, диаметры, скорость, запас лески")
    // Номер кейса
    @Story("TC-API-02")
    // Настройки соответствуют требованиям
    public void configMatchesRequirements() {
        // Получаем настройки
        JsonPath cfg = api().get("/api/config").then().statusCode(200).extract().jsonPath();

        // Четыре сектора по порядку
        assertThat(cfg.getList("sectors", String.class)).containsExactly("A", "B", "C", "D");
        // 60 гвоздей в секторе
        assertThat(cfg.getInt("nails_per_sector")).isEqualTo(60);
        // Всего 240
        assertThat(cfg.getInt("total_nails")).isEqualTo(240);
        // Готовые диаметры
        assertThat(cfg.getList("diameter.presets_cm", Integer.class)).containsExactly(30, 40, 50, 60, 70);
        // Скорость по умолчанию
        assertThat(cfg.getDouble("speed.default_sec")).isEqualTo(2.0);
        // Шаг скорости
        assertThat(cfg.getDouble("speed.step_sec")).isEqualTo(0.1);
        // Минимум
        assertThat(cfg.getDouble("speed.min_sec")).isEqualTo(0.5);
        // Максимум
        assertThat(cfg.getDouble("speed.max_sec")).isEqualTo(10.0);
        // Запас лески 15 %
        assertThat(cfg.getDouble("thread.margin")).isEqualTo(0.15);
        // Нитей минимум 1000
        assertThat(cfg.getInt("lines.min")).isEqualTo(1000);
        // Максимум 5000
        assertThat(cfg.getInt("lines.max")).isEqualTo(5000);
    }

    // Поставщик данных
    @DataProvider
    // Диаметр, расстояние между гвоздями, рекомендуемые нити
    public Object[][] diameters() {
        // Таблица:
        return new Object[][]{
                // 30 см
                {30, 3.93, 1200},
                // 50 см
                {50, 6.54, 2000},
                // 70 см
                {70, 9.16, 2800},
        };
    }

    // Тест берёт данные из поставщика
    @Test(dataProvider = "diameters", description = "TC-API-18 шаг гвоздей и рекомендация линий")
    // Номер кейса
    @Story("TC-API-18")
    // Геометрия для диаметра
    public void geometryForDiameter(int diameter, double spacingMm, int lines) {
        // Запрос с диаметром
        JsonPath body = api().queryParam("diameter_cm", diameter)
                // → 200, разбираем
                .get("/api/geometry").then().statusCode(200).extract().jsonPath();
        // Расстояние
        assertThat(body.getDouble("nail_spacing_mm")).isEqualTo(spacingMm);
        // Нити
        assertThat(body.getInt("recommended_lines")).isEqualTo(lines);
    }

    // Тест
    @Test(description = "TC-API-18 диаметр вне диапазона — 422")
    // Номер кейса
    @Story("TC-API-18")
    // Неверный диаметр
    public void geometryRejectsBadDiameter() {
        // Слишком маленький, слишком большой, не число
        for (String d : List.of("10", "151", "abc")) {
            // → 422
            api().queryParam("diameter_cm", d).get("/api/geometry").then().statusCode(422);
        }
    }

    // Тест
    @Test(description = "TC-API-34 в веб-версии обновление в одну кнопку недоступно")
    // Номер кейса
    @Story("TC-API-34")
    // Обновление недоступно
    public void updateNotSupportedOnWeb() {
        // Состояние: ждём, не поддерживается
        api().get("/api/update").then().statusCode(200).body("state", equalTo("idle")).body("supported", equalTo(false));
        // Начать нельзя → 404 с пояснением
        String detail = api().post("/api/update").then().statusCode(404).extract().jsonPath().getString("detail");
        // Текст
        assertThat(detail).contains("только в программе для Windows");
        // В настройках — «не обновляется»
        api().get("/api/config").then().statusCode(200).body("app.update", equalTo(false));
    }
}
