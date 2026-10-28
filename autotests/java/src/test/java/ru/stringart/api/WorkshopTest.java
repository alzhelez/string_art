// Пакет тестов
package ru.stringart.api;

// Allure: эпик
import io.qameta.allure.Epic;
// Allure: функция
import io.qameta.allure.Feature;
// Allure: история
import io.qameta.allure.Story;
// Тип JSON
import io.restassured.http.ContentType;
// Разбор JSON
import io.restassured.path.json.JsonPath;
// После каждого теста
import org.testng.annotations.AfterMethod;
// Аннотация теста
import org.testng.annotations.Test;

// Map — тело запроса
import java.util.Map;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Мастерская: шаблон, время, катушка")
// Шаблон, время и катушка
public class WorkshopTest extends BaseApiTest {

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Тест
    @Test(description = "TC-API-31 шаблон разметки 1:1 в PDF")
    // Номер кейса
    @Story("TC-API-31")
    // Шаблон разметки
    public void templatePdf() {
        // Создаём проект
        String id = createProject("Шаблон", "50").getString("id");
        // Скачиваем шаблон A4
        byte[] pdf = api().queryParam("paper", "A4").get("/api/projects/" + id + "/template.pdf")
                // → 200, тип PDF, байты
                .then().statusCode(200).contentType("application/pdf").extract().asByteArray();
        // Сигнатура PDF
        assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
        // Диаметр 10 → 422
        api().queryParam("diameter_cm", 10).get("/api/template.pdf").then().statusCode(422);
        // Бумага A5 → 422
        api().queryParam("paper", "A5").get("/api/projects/" + id + "/template.pdf").then().statusCode(422);
    }

    // Тест
    @Test(description = "TC-API-30 время плетения по дням и своя катушка")
    // Номер кейса
    @Story("TC-API-30")
    // Время и катушка
    public void activityAndSpool() {
        // Создаём проект
        String id = createProject("Время", "50").getString("id");
        // Записываем 30 с и 12 шагов
        api().contentType(ContentType.JSON).body(Map.of("date", "2026-10-27", "seconds", 30, "steps", 12))
                // → 200
                .post("/api/projects/" + id + "/activity").then().statusCode(200);
        // Записываем ещё на другой день
        JsonPath a = api().contentType(ContentType.JSON).body(Map.of("date", "2026-10-28", "seconds", 30, "steps", 8))
                // → 200, разбираем
                .post("/api/projects/" + id + "/activity").then().statusCode(200).extract().jsonPath();
        // Всего 60 с
        assertThat(a.getDouble("total_sec")).isEqualTo(60.0);
        // 20 шагов
        assertThat(a.getInt("total_steps")).isEqualTo(20);
        // Два дня по порядку
        assertThat(a.getList("days.date")).containsExactly("2026-10-27", "2026-10-28");
        // Дата не ISO
        api().contentType(ContentType.JSON).body(Map.of("date", "вчера", "seconds", 1, "steps", 1))
                // → 422
                .post("/api/projects/" + id + "/activity").then().statusCode(422);
        // Своя катушка 300 м
        assertThat(patch(id, "{\"own_spool_m\": 300}").then().statusCode(200).extract().jsonPath().getDouble("own_spool_m"))
                // сохранилась
                .isEqualTo(300.0);
    }
}
