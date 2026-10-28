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

// Файл фикстуры
import java.io.File;
// Список цветов
import java.util.List;
// Тело запроса
import java.util.Map;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Цветные портреты и перенос файлом")
// Портрет из нескольких нитей и файл проекта
public class ColorLayersTest extends BaseApiTest {

    // Фото с лицом
    private static final File FACE_JPG = FIXTURES.resolve("face.jpg").toFile();

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Тест
    @Test(description = "TC-API-32 «чёрная + белая»: две нити, PATCH нити, шаги и сходство нити")
    // Номер кейса
    @Story("TC-API-32")
    // Цветной портрет
    public void colorLayers() {
        // Загружаем фото
        String imageId = api().multiPart("file", FACE_JPG, "image/jpeg")
                // → 201, id фото
                .post("/api/images").then().statusCode(201).extract().jsonPath().getString("id");
        // Создаём портрет из двух нитей
        JsonPath p = api().contentType(ContentType.JSON).body(Map.of("image_id", imageId, "mode", "bw"))
                // → 201, разбираем
                .post("/api/projects/from-image").then().statusCode(201).extract().jsonPath();
        // id
        String id = p.getString("id");
        // Удалить после теста
        cleanUpLater(id);
        // Режим и доска
        assertThat(p.getString("mode")).isEqualTo("bw");
        // Серая доска по умолчанию
        assertThat(p.getString("board.key")).isEqualTo("gray");
        // Цвета нитей
        List<String> colors = p.getList("layers.color", String.class);
        // Белая и чёрная
        assertThat(colors).containsExactlyInAnyOrder("white", "black");
        // Первая нить повторяет основные поля
        assertThat(p.getList("layers[0].sequence")).isEqualTo(p.getList("sequence"));
        // Вторая нить: 300 линий
        JsonPath upd = patch(id, "{\"layer\": 1, \"line_count\": 300}").then().statusCode(200).extract().jsonPath();
        // Сохранилось
        assertThat(upd.getInt("layers[1].line_count")).isEqualTo(300);
        // Шаги второй нити
        JsonPath steps = api().get("/api/projects/" + id + "/steps?layer=1&limit=1").then().statusCode(200).extract().jsonPath();
        // Всего 300
        assertThat(steps.getInt("total")).isEqualTo(300);
        // Начало A1
        assertThat(steps.getString("items[0].from_label")).isEqualTo("A1");
        // Сходство второй нити — 25 точек
        assertThat(api().get("/api/projects/" + id + "/similarity?layer=1").then().statusCode(200).extract().jsonPath().getList("curve")).hasSize(25);
        // Третьей нити нет → 422
        patch(id, "{\"layer\": 2, \"line_count\": 300}").then().statusCode(422);
    }

    // Тест
    @Test(description = "TC-API-33 экспорт → импорт: новый портрет с тем же прогрессом; мусор → 400")
    // Номер кейса
    @Story("TC-API-33")
    // Перенос файлом
    public void transfer() {
        // Проект
        String id = createProject("Перенос", "50").getString("id");
        // Шаг 99
        patch(id, "{\"current_step\": 99}").then().statusCode(200);
        // Экспорт
        io.restassured.response.Response file = api().get("/api/projects/" + id + "/export");
        // → 200
        file.then().statusCode(200);
        // Имя файла .nitegraf
        assertThat(file.header("Content-Disposition")).contains(".nitegraf");
        // Импорт файлом
        JsonPath copy = api().multiPart("file", "p.nitegraf", file.asByteArray(), "application/json")
                // → 201, разбираем
                .post("/api/projects/import").then().statusCode(201).extract().jsonPath();
        // Удалить копию после теста
        cleanUpLater(copy.getString("id"));
        // Новый id
        assertThat(copy.getString("id")).isNotEqualTo(id);
        // Тот же шаг
        assertThat(copy.getInt("current_step")).isEqualTo(99);
        // Не файл проекта → 400
        api().multiPart("file", "x.txt", "hello".getBytes(java.nio.charset.StandardCharsets.UTF_8), "text/plain")
                // Отправляем
                .post("/api/projects/import").then().statusCode(400);
    }
}
