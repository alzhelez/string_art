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
// Ответ сервера
import io.restassured.response.Response;
// После каждого теста
import org.testng.annotations.AfterMethod;
// Аннотация теста
import org.testng.annotations.Test;

// Чтение PNG
import javax.imageio.ImageIO;
// Картинка в памяти
import java.awt.image.BufferedImage;
// Поток из байтов
import java.io.ByteArrayInputStream;
// Файл
import java.io.File;
// Ошибка чтения
import java.io.IOException;
// Чтение файла в байты
import java.nio.file.Files;
// Map — тело запроса
import java.util.Map;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Подготовка фото")
// Подготовка фото
public class ImagePipelineTest extends BaseApiTest {

    // Фото с лицом
    private static final File FACE_JPG = FIXTURES.resolve("face.jpg").toFile();
    // Однотонная картинка без лица
    private static final File BLANK_PNG = FIXTURES.resolve("blank.png").toFile();
    // Маска 256×256 — «поправленная кистью»
    private static final File MASK_PNG = FIXTURES.resolve("mask.png").toFile();

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Загрузить фото в редактор
    private JsonPath uploadImage(File file, String mime) {
        // Форма с файлом
        return api().multiPart("file", file, mime)
                // → 201, разбираем
                .post("/api/images").then().statusCode(201).extract().jsonPath();
    }

    // Байты PNG → картинка
    private static BufferedImage png(byte[] bytes) throws IOException {
        // Читаем
        return ImageIO.read(new ByteArrayInputStream(bytes));
    }

    // Средняя яркость (по синему каналу; в сером все каналы равны)
    private static double meanBrightness(BufferedImage img) {
        // Сумма
        long sum = 0;
        // По строкам —
        for (int y = 0; y < img.getHeight(); y++) {
            // — по столбцам —
            for (int x = 0; x < img.getWidth(); x++) {
                // — младший байт цвета
                sum += img.getRGB(x, y) & 0xFF;
            }
        }
        // Делим на число пикселей
        return (double) sum / (img.getWidth() * img.getHeight());
    }

    // Тест
    @Test(description = "TC-API-20 подготовленный кадр: 400×400, яркость и зум меняют результат, zoom 5 → 422")
    // Номер кейса
    @Story("TC-API-20")
    // Подготовленный кадр
    public void preparedImage() throws IOException {
        // Загружаем фото
        String id = uploadImage(FACE_JPG, "image/jpeg").getString("id");
        // Адрес кадра
        String base = "/api/images/" + id + "/prepared.png";
        // Без правок — PNG
        byte[] plain = api().get(base).then().statusCode(200).contentType("image/png").extract().asByteArray();
        // С яркостью +0,3
        byte[] bright = api().queryParam("brightness", 0.3).get(base).then().statusCode(200).extract().asByteArray();
        // С зумом 3
        byte[] zoomed = api().queryParam("zoom", 3).queryParam("center_x", 0.43).get(base).then().statusCode(200).extract().asByteArray();
        // Картинка без правок
        BufferedImage p = png(plain);
        // Ширина 400
        assertThat(p.getWidth()).isEqualTo(400);
        // Высота 400
        assertThat(p.getHeight()).isEqualTo(400);
        // Яркость выросла заметно
        assertThat(meanBrightness(png(bright))).isGreaterThan(meanBrightness(p) + 10);
        // Зум изменил кадр
        assertThat(zoomed).isNotEqualTo(plain);
        // Зум 5 → 422
        api().queryParam("zoom", 5).get(base).then().statusCode(422);
    }

    // Тест
    @Test(description = "TC-API-22 «Выделить лицо»: с лицом — 201, на фото без лица — 422 с понятным текстом")
    // Номер кейса
    @Story("TC-API-22")
    // «Выделить лицо»
    public void faceFocus() {
        // Загружаем фото с лицом
        JsonPath img = uploadImage(FACE_JPG, "image/jpeg");
        // Тело: id, название, кадр лица
        Map<String, Object> body = Map.of("image_id", img.getString("id"), "name", "Java: лицо", "prep", img.getMap("face_prep"));
        // Создаём
        JsonPath p = api().contentType(ContentType.JSON).body(body)
                // → 201, разбираем
                .post("/api/projects/from-image").then().statusCode(201).extract().jsonPath();
        // Удалить после теста
        cleanUpLater(p.getString("id"));
        // Флажок стоит
        assertThat(p.getBoolean("prep.face_focus")).isTrue();

        // Загружаем однотонную
        JsonPath blank = uploadImage(BLANK_PNG, "image/png");
        // Лиц нет
        assertThat(blank.getList("faces")).isEmpty();
        // Просим «Выделить лицо»
        Response bad = api().contentType(ContentType.JSON)
                // тело
                .body(Map.of("image_id", blank.getString("id"), "prep", Map.of("face_focus", true)))
                // отправляем
                .post("/api/projects/from-image");
        // → 422
        assertThat(bad.statusCode()).isEqualTo(422);
        // Текст про лицо
        assertThat(bad.jsonPath().getString("detail")).contains("лицо");
    }

    // Тест
    @Test(description = "TC-API-25 корень бэкенда ведёт на приложение, favicon без ошибки")
    // Номер кейса
    @Story("TC-API-25")
    // Корень бэкенда
    public void rootRedirect() {
        // Запрос без перехода по перенаправлению
        Response root = api().redirects().follow(false).get("/");
        // Обычный режим — 307 на фронтенд, программа для Windows — сама страница (200)
        // 307 или 200
        assertThat(root.statusCode()).isIn(307, 200);
        // Если перенаправление —
        if (root.statusCode() == 307) {
            // — у него есть адрес
            assertThat(root.getHeader("Location")).isNotBlank();
        }
        // Иконка без ошибки
        assertThat(api().get("/favicon.ico").statusCode()).isIn(204, 200);
    }

    // Тест
    @Test(description = "TC-API-28 маска, поправленная кистью: не PNG → 400, другой размер растягивается, чужой id → 404")
    // Номер кейса
    @Story("TC-API-28")
    // Маска кистью
    public void maskBrushEdit() throws IOException {
        // Загружаем фото
        JsonPath img = uploadImage(FACE_JPG, "image/jpeg");
        // id
        String id = img.getString("id");
        // Не PNG → 400
        api().contentType("image/png").body("not png").put("/api/images/" + id + "/mask.png").then().statusCode(400);
        // Маска из фикстур
        JsonPath st = api().contentType("image/png").body(Files.readAllBytes(MASK_PNG.toPath()))
                // → 200, разбираем
                .put("/api/images/" + id + "/mask.png").then().statusCode(200).extract().jsonPath();
        // Готова
        assertThat(st.getString("status")).isEqualTo("ready");
        // Отмечена как исправленная
        assertThat(st.getBoolean("edited")).isTrue();
        // Скачиваем сохранённую
        BufferedImage saved = png(api().get("/api/images/" + id + "/mask.png").then().statusCode(200).extract().asByteArray());
        // Ширина как у фото
        assertThat(saved.getWidth()).isEqualTo(img.getInt("width"));
        // Высота как у фото
        assertThat(saved.getHeight()).isEqualTo(img.getInt("height"));
        // Чужой id → 404
        api().contentType("image/png").body("x").put("/api/images/000000000000/mask.png").then().statusCode(404);
    }
}
