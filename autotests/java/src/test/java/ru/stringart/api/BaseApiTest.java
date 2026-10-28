// Пакет всех API-тестов
package ru.stringart.api;

// Фильтр Allure: каждый запрос и ответ попадают в отчёт
import io.qameta.allure.restassured.AllureRestAssured;
// Глобальные настройки RestAssured
import io.restassured.RestAssured;
// Сборщик части формы multipart
import io.restassured.builder.MultiPartSpecBuilder;
// Сборщик общих настроек запросов
import io.restassured.builder.RequestSpecBuilder;
// Сколько логировать при падении
import io.restassured.filter.log.LogDetail;
// Тип содержимого JSON
import io.restassured.http.ContentType;
// Разбор JSON ответа
import io.restassured.path.json.JsonPath;
// Ответ сервера
import io.restassured.response.Response;
// Часть формы
import io.restassured.specification.MultiPartSpecification;
// Настройки запроса
import io.restassured.specification.RequestSpecification;
// Метод, который выполнится один раз перед всем набором
import org.testng.annotations.BeforeSuite;

// Файл фикстуры
import java.io.File;
// Путь к папке фикстур
import java.nio.file.Path;
// Список созданных проектов
import java.util.ArrayList;
// Интерфейс списка
import java.util.List;

// given() — начало запроса RestAssured
import static io.restassured.RestAssured.given;

/**
 * Общая настройка: базовый URL, Allure-логирование запросов, фикстуры и фабрика проектов.
 * Запуск: mvn test -Dapi.baseUrl=http://127.0.0.1:8000
 */
// Общий родитель всех классов с тестами
public abstract class BaseApiTest {

    // Адрес бэкенда из -Dapi.baseUrl или локальный
    protected static final String BASE_URL = System.getProperty("api.baseUrl", "http://127.0.0.1:8000");
    // Папка фикстур из настроек Surefire или соседняя
    protected static final Path FIXTURES = Path.of(System.getProperty("fixtures.dir", "../fixtures"));
    // Портрет JPEG
    protected static final File PORTRAIT_JPG = FIXTURES.resolve("portrait.jpg").toFile();
    // PNG с прозрачностью
    protected static final File PORTRAIT_PNG = FIXTURES.resolve("portrait.png").toFile();
    // Текстовый файл вместо картинки
    protected static final File NOT_IMAGE = FIXTURES.resolve("not-an-image.txt").toFile();

    // Общие настройки запросов
    protected static RequestSpecification spec;
    // id проектов, созданных в текущем тесте
    private final List<String> createdIds = new ArrayList<>();

    // Один раз перед набором, даже если выбраны отдельные группы
    @BeforeSuite(alwaysRun = true)
    // Настройка RestAssured
    public void configure() {
        // При падении проверки в лог пишется весь запрос и ответ
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails(LogDetail.ALL);
        // Собираем общие настройки:
        spec = new RequestSpecBuilder()
                // адрес бэкенда
                .setBaseUri(BASE_URL)
                // запросы в отчёт Allure
                .addFilter(new AllureRestAssured())
                // готово
                .build();
    }

    // Начать запрос с общими настройками
    protected static RequestSpecification api() {
        // given + общие настройки
        return given().spec(spec);
    }

    // Текстовое поле формы
    protected static MultiPartSpecification textPart(String name, String value) {
        // UTF-8 явно: по умолчанию RestAssured может отправить кириллицу в US-ASCII
        // Значение, имя поля и кодировка
        return new MultiPartSpecBuilder(value).controlName(name).charset("UTF-8").build();
    }

    // Загрузить проект формой
    protected Response upload(File file, String mime, String name, String diameter) {
        // Файл с типом
        RequestSpecification req = api().multiPart("file", file, mime);
        // Если есть название —
        if (name != null) {
            // — добавляем
            req.multiPart(textPart("name", name));
        }
        // Если есть диаметр —
        if (diameter != null) {
            // — добавляем
            req.multiPart(textPart("diameter_cm", diameter));
        }
        // Отправляем
        return req.when().post("/api/projects");
    }

    /** Создаёт проект и запоминает его, чтобы удалить после теста. */
    // Создать проект
    protected JsonPath createProject(String name, String diameter) {
        // Загружаем портрет
        JsonPath body = upload(PORTRAIT_JPG, "image/jpeg", name, diameter)
                // ожидаем 201
                .then().statusCode(201)
                // разбираем JSON
                .extract().jsonPath();
        // Запоминаем id для удаления
        createdIds.add(body.getString("id"));
        // Отдаём ответ
        return body;
    }

    /** Проект, созданный в обход createProject, тоже удалить после теста. */
    // Запомнить id для удаления
    protected void cleanUpLater(String id) {
        // Добавляем в список
        createdIds.add(id);
    }

    // PATCH проекта с телом JSON
    protected Response patch(String id, String json) {
        // Тип JSON, тело, адрес
        return api().contentType(ContentType.JSON).body(json).when().patch("/api/projects/" + id);
    }

    // Удалить всё созданное — вызывается после каждого теста
    protected void cleanUp() {
        // Для каждого id —
        for (String id : createdIds) {
            // — удаляем
            api().delete("/api/projects/" + id);
        }
        // Очищаем список
        createdIds.clear();
    }
}
