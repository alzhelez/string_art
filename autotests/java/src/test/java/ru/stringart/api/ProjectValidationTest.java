// Пакет тестов
package ru.stringart.api;

// Allure: эпик
import io.qameta.allure.Epic;
// Allure: функция
import io.qameta.allure.Feature;
// Allure: история
import io.qameta.allure.Story;
// Метод после всех тестов класса
import org.testng.annotations.AfterClass;
// Метод перед всеми тестами класса
import org.testng.annotations.BeforeClass;
// Поставщик данных
import org.testng.annotations.DataProvider;
// Аннотация теста
import org.testng.annotations.Test;

// Файл
import java.io.File;
// Ошибка ввода-вывода
import java.io.IOException;
// Создание временного файла
import java.nio.file.Files;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("Валидация")
// Проверки неверных данных
public class ProjectValidationTest extends BaseApiTest {

    // Один проект на все тесты класса
    private String projectId;
    // Пустой файл
    private File emptyFile;

    // Перед всеми тестами класса —
    @BeforeClass(alwaysRun = true)
    // — подготовка
    public void setUp() throws IOException {
        // Создаём проект
        projectId = createProject("Валидация", "50").getString("id");
        // 2000 нитей — чтобы шаг 2001 был неверным
        patch(projectId, "{\"line_count\": 2000}").then().statusCode(200);
        // Пустой временный файл
        emptyFile = Files.createTempFile("empty", ".jpg").toFile();
        // Удалится при выходе
        emptyFile.deleteOnExit();
    }

    // После всех тестов класса —
    @AfterClass(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем проект
        cleanUp();
    }

    // Поставщик неверных загрузок
    @DataProvider
    // Название, вид файла, диаметр, статус
    public Object[][] badUploads() {
        // Таблица:
        return new Object[][]{
                // пустой файл
                {"пустой файл", "empty", "50", 400},
                // текст
                {"не картинка", "text", "50", 400},
                // диаметр меньше 20
                {"диаметр 19.9", "jpg", "19.9", 422},
                // больше 150
                {"диаметр 150.1", "jpg", "150.1", 422},
                // не число
                {"диаметр abc", "jpg", "abc", 422},
        };
    }

    // Тест берёт данные из поставщика
    @Test(dataProvider = "badUploads", description = "TC-API-05 валидация загрузки")
    // Номер кейса
    @Story("TC-API-05")
    // Неверная загрузка
    public void uploadValidation(String title, String kind, String diameter, int status) {
        // Файл по виду:
        File file = switch (kind) {
            // пустой
            case "empty" -> emptyFile;
            // текст
            case "text" -> NOT_IMAGE;
            // портрет
            default -> PORTRAIT_JPG;
        };
        // Загружаем с «неизвестным» типом — сервер должен смотреть на содержимое
        upload(file, "application/octet-stream", null, diameter).then().statusCode(status);
    }

    // Тест
    @Test(description = "TC-API-06 POST без файла")
    // Номер кейса
    @Story("TC-API-06")
    // Форма без файла
    public void uploadWithoutFile() {
        // Только название → 422
        api().multiPart(textPart("name", "x")).post("/api/projects").then().statusCode(422);
    }

    // Поставщик неверных изменений
    @DataProvider
    // Тела запросов
    public Object[][] badPatches() {
        // Таблица:
        return new Object[][]{
                // скорость меньше 0,5
                {"{\"speed_sec\": 0.4}"},
                // больше 10
                {"{\"speed_sec\": 10.1}"},
                // шаг 0
                {"{\"current_step\": 0}"},
                // шаг больше числа нитей
                {"{\"current_step\": 2001}"},
                // нитей меньше 1000
                {"{\"line_count\": 999}"},
                // больше 5000
                {"{\"line_count\": 5001}"},
                // диаметр меньше 20
                {"{\"diameter_cm\": 10}"},
                // пустое название
                {"{\"name\": \"\"}"},
                // название из пробелов
                {"{\"name\": \"   \"}"},
                // схему менять нельзя
                {"{\"sequence\": [1, 2, 3]}"},
        };
    }

    // Тест берёт данные из поставщика
    @Test(dataProvider = "badPatches", description = "TC-API-11 PATCH отклоняет невалидные значения")
    // Номер кейса
    @Story("TC-API-11")
    // Неверное изменение
    public void patchValidation(String json) {
        // → 422
        patch(projectId, json).then().statusCode(422);
    }
}
