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
// Map — тело запроса
import java.util.Map;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Редактор фото")
// Тесты редактора фото
public class PhotoEditorTest extends BaseApiTest {

    // Фото с лицом
    private static final File FACE_JPG = FIXTURES.resolve("face.jpg").toFile();

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Загрузить фото в редактор
    private JsonPath uploadImage() {
        // Форма с файлом
        return api().multiPart("file", FACE_JPG, "image/jpeg")
                // → 201, разбираем
                .post("/api/images").then().statusCode(201).extract().jsonPath();
    }

    // Тест
    @Test(description = "TC-API-19 загрузка фото в редактор и поиск лица")
    // Номер кейса
    @Story("TC-API-19")
    // Загрузка находит лицо
    public void uploadFindsFace() {
        // Загружаем
        JsonPath img = uploadImage();
        // Ширина 512
        assertThat(img.getInt("width")).isEqualTo(512);
        // Лица есть
        assertThat(img.getList("faces")).isNotEmpty();
        // Готовый кадр лица
        assertThat(img.getBoolean("face_prep.face_focus")).isTrue();
        // Исходник
        api().get("/api/images/" + img.getString("id") + "/original.jpg")
                // → 200, тип JPEG
                .then().statusCode(200).contentType("image/jpeg");
    }

    // Тест
    @Test(description = "TC-API-21/23 портрет из фото с кадром, затем правка фото")
    // Номер кейса
    @Story("TC-API-21")
    // Портрет из фото и правка фото
    public void createFromImageThenEditPhoto() {
        // Загружаем
        JsonPath img = uploadImage();
        // Тело запроса:
        Map<String, Object> body = Map.of(
                // id фото
                "image_id", img.getString("id"),
                // название
                "name", "Java",
                // параметры кадра
                "prep", Map.of("zoom", 2, "center_x", 0.45, "center_y", 0.3));
        // Создаём проект
        JsonPath p = api().contentType(ContentType.JSON).body(body)
                // → 201, разбираем
                .post("/api/projects/from-image").then().statusCode(201).extract().jsonPath();
        // id
        String id = p.getString("id");
        // Удалить после теста
        cleanUpLater(id);
        // Зум сохранился
        assertThat(p.getDouble("prep.zoom")).isEqualTo(2.0);
        // Лицо не выделено
        assertThat(p.getBoolean("prep.face_focus")).isFalse();

        // Шаг 99
        patch(id, "{\"current_step\": 99}").then().statusCode(200);
        // Готовый кадр лица
        Map<String, Object> facePrep = img.getMap("face_prep");
        // Меняем кадр
        JsonPath updated = api().contentType(ContentType.JSON).body(facePrep)
                // → 200, разбираем
                .put("/api/projects/" + id + "/photo").then().statusCode(200).extract().jsonPath();
        // Шаг сброшен
        assertThat(updated.getInt("current_step")).isEqualTo(1);
        // Флажок стоит
        assertThat(updated.getBoolean("prep.face_focus")).isTrue();
        // Схема новая
        assertThat(updated.getList("sequence")).isNotEqualTo(p.getList("sequence"));

        // Зум 10
        api().contentType(ContentType.JSON).body("{\"zoom\": 10}")
                // → 422
                .put("/api/projects/" + id + "/photo").then().statusCode(422);
    }

    // Тест
    @Test(description = "TC-API-27 автонастройка фото")
    // Номер кейса
    @Story("TC-API-27")
    // Автонастройка не ухудшает сходство
    public void autoToneImprovesSimilarity() {
        // Загружаем
        JsonPath img = uploadImage();
        // id
        String id = img.getString("id");
        // Тело: кадр лица и диаметр
        Map<String, Object> body = Map.of("prep", img.getMap("face_prep"), "diameter_cm", 50);
        // Запускаем подбор
        JsonPath t = api().contentType(ContentType.JSON).body(body)
                // → 200, разбираем
                .post("/api/images/" + id + "/auto-tone").then().statusCode(200).extract().jsonPath();
        // Не хуже исходного
        assertThat(t.getDouble("score_after")).isGreaterThanOrEqualTo(t.getDouble("score_before"));
        // 6 вариантов
        assertThat(t.getInt("candidates")).isEqualTo(6);
        // Яркость в границах
        assertThat(t.getDouble("brightness")).isBetween(-0.5, 0.5);
        // Диаметр 5
        api().contentType(ContentType.JSON).body("{\"diameter_cm\": 5}")
                // → 422
                .post("/api/images/" + id + "/auto-tone").then().statusCode(422);
    }
}
