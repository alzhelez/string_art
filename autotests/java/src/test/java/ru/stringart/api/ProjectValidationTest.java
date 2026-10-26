package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import org.testng.annotations.AfterClass;
import org.testng.annotations.BeforeClass;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;

@Epic("String Art API")
@Feature("Валидация")
public class ProjectValidationTest extends BaseApiTest {

    private String projectId;
    private File emptyFile;

    @BeforeClass(alwaysRun = true)
    public void setUp() throws IOException {
        projectId = createProject("Валидация", "50").getString("id");
        emptyFile = Files.createTempFile("empty", ".jpg").toFile();
        emptyFile.deleteOnExit();
    }

    @AfterClass(alwaysRun = true)
    public void tearDown() {
        cleanUp();
    }

    @DataProvider
    public Object[][] badUploads() {
        return new Object[][]{
                {"пустой файл", "empty", "50", 400},
                {"не картинка", "text", "50", 400},
                {"диаметр 19.9", "jpg", "19.9", 422},
                {"диаметр 150.1", "jpg", "150.1", 422},
                {"диаметр abc", "jpg", "abc", 422},
        };
    }

    @Test(dataProvider = "badUploads", description = "TC-API-05 валидация загрузки")
    @Story("TC-API-05")
    public void uploadValidation(String title, String kind, String diameter, int status) {
        File file = switch (kind) {
            case "empty" -> emptyFile;
            case "text" -> NOT_IMAGE;
            default -> PORTRAIT_JPG;
        };
        upload(file, "application/octet-stream", null, diameter).then().statusCode(status);
    }

    @Test(description = "TC-API-06 POST без файла")
    @Story("TC-API-06")
    public void uploadWithoutFile() {
        api().multiPart(textPart("name", "x")).post("/api/projects").then().statusCode(422);
    }

    @DataProvider
    public Object[][] badPatches() {
        return new Object[][]{
                {"{\"speed_sec\": 0.4}"},
                {"{\"speed_sec\": 10.1}"},
                {"{\"current_step\": 0}"},
                {"{\"current_step\": 2001}"},
                {"{\"line_count\": 999}"},
                {"{\"line_count\": 5001}"},
                {"{\"diameter_cm\": 10}"},
                {"{\"name\": \"\"}"},
                {"{\"name\": \"   \"}"},
                {"{\"sequence\": [1, 2, 3]}"},
        };
    }

    @Test(dataProvider = "badPatches", description = "TC-API-11 PATCH отклоняет невалидные значения")
    @Story("TC-API-11")
    public void patchValidation(String json) {
        patch(projectId, json).then().statusCode(422);
    }
}
