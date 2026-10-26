package ru.stringart.api;

import io.qameta.allure.restassured.AllureRestAssured;
import io.restassured.RestAssured;
import io.restassured.builder.MultiPartSpecBuilder;
import io.restassured.builder.RequestSpecBuilder;
import io.restassured.filter.log.LogDetail;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
import io.restassured.specification.MultiPartSpecification;
import io.restassured.specification.RequestSpecification;
import org.testng.annotations.BeforeSuite;

import java.io.File;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import static io.restassured.RestAssured.given;

/**
 * Общая настройка: базовый URL, Allure-логирование запросов, фикстуры и фабрика проектов.
 * Запуск: mvn test -Dapi.baseUrl=http://127.0.0.1:8000
 */
public abstract class BaseApiTest {

    protected static final String BASE_URL = System.getProperty("api.baseUrl", "http://127.0.0.1:8000");
    protected static final Path FIXTURES = Path.of(System.getProperty("fixtures.dir", "../fixtures"));
    protected static final File PORTRAIT_JPG = FIXTURES.resolve("portrait.jpg").toFile();
    protected static final File PORTRAIT_PNG = FIXTURES.resolve("portrait.png").toFile();
    protected static final File NOT_IMAGE = FIXTURES.resolve("not-an-image.txt").toFile();

    protected static RequestSpecification spec;
    private final List<String> createdIds = new ArrayList<>();

    @BeforeSuite(alwaysRun = true)
    public void configure() {
        RestAssured.enableLoggingOfRequestAndResponseIfValidationFails(LogDetail.ALL);
        spec = new RequestSpecBuilder()
                .setBaseUri(BASE_URL)
                .addFilter(new AllureRestAssured())
                .build();
    }

    protected static RequestSpecification api() {
        return given().spec(spec);
    }

    protected static MultiPartSpecification textPart(String name, String value) {
        // UTF-8 явно: по умолчанию RestAssured может отправить кириллицу в US-ASCII
        return new MultiPartSpecBuilder(value).controlName(name).charset("UTF-8").build();
    }

    protected Response upload(File file, String mime, String name, String diameter) {
        RequestSpecification req = api().multiPart("file", file, mime);
        if (name != null) {
            req.multiPart(textPart("name", name));
        }
        if (diameter != null) {
            req.multiPart(textPart("diameter_cm", diameter));
        }
        return req.when().post("/api/projects");
    }

    /** Создаёт проект и запоминает его, чтобы удалить после теста. */
    protected JsonPath createProject(String name, String diameter) {
        JsonPath body = upload(PORTRAIT_JPG, "image/jpeg", name, diameter)
                .then().statusCode(201)
                .extract().jsonPath();
        createdIds.add(body.getString("id"));
        return body;
    }

    /** Проект, созданный в обход createProject, тоже удалить после теста. */
    protected void cleanUpLater(String id) {
        createdIds.add(id);
    }

    protected Response patch(String id, String json) {
        return api().contentType(ContentType.JSON).body(json).when().patch("/api/projects/" + id);
    }

    protected void cleanUp() {
        for (String id : createdIds) {
            api().delete("/api/projects/" + id);
        }
        createdIds.clear();
    }
}
