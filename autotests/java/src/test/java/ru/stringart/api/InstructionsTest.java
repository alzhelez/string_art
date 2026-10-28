// Пакет тестов
package ru.stringart.api;

// Allure: эпик
import io.qameta.allure.Epic;
// Allure: функция
import io.qameta.allure.Feature;
// Allure: история
import io.qameta.allure.Story;
// Ответ сервера
import io.restassured.response.Response;
// PDFBox: загрузка PDF из байтов
import org.apache.pdfbox.Loader;
// PDFBox: документ
import org.apache.pdfbox.pdmodel.PDDocument;
// PDFBox: извлечение текста
import org.apache.pdfbox.text.PDFTextStripper;
// Метод после каждого теста
import org.testng.annotations.AfterMethod;
// Аннотация теста
import org.testng.annotations.Test;

// Ошибка чтения PDF
import java.io.IOException;

// Проверки AssertJ
import static org.assertj.core.api.Assertions.assertThat;

// Раздел отчёта
@Epic("String Art API")
// Подраздел
@Feature("PDF-инструкция")
// Тесты PDF-инструкции
public class InstructionsTest extends BaseApiTest {

    // После каждого теста, даже упавшего —
    @AfterMethod(alwaysRun = true)
    // — уборка
    public void tearDown() {
        // удаляем созданные проекты
        cleanUp();
    }

    // Тест
    @Test(description = "TC-API-16 PDF: заголовки, число страниц, содержимое")
    // Номер кейса
    @Story("TC-API-16")
    // PDF: заголовки, страницы, текст
    public void pdfInstructions() throws IOException {
        // Создаём проект
        String id = createProject("PDF-тест", "50").getString("id");
        // 1000 нитей
        patch(id, "{\"line_count\": 1000}").then().statusCode(200);

        // Скачиваем PDF
        Response r = api().get("/api/projects/" + id + "/instructions.pdf");
        // → 200, тип PDF
        r.then().statusCode(200).contentType("application/pdf");
        // Вложение с именем в UTF-8
        assertThat(r.header("Content-Disposition")).contains("attachment").contains("filename*=UTF-8''");

        // Открываем PDF; закроется сам
        try (PDDocument pdf = Loader.loadPDF(r.asByteArray())) {
            // 7 страниц
            assertThat(pdf.getNumberOfPages()).as("обложка + схема + 1000/200 страниц шагов").isEqualTo(7);
            // Извлекатель текста
            PDFTextStripper stripper = new PDFTextStripper();
            // С первой страницы —
            stripper.setStartPage(1);
            // — по первую
            stripper.setEndPage(1);
            // На обложке длина катушки и диаметр
            assertThat(stripper.getText(pdf)).contains("Минимальная катушка").contains("50,0 см");
            // С третьей —
            stripper.setStartPage(3);
            // — по третью
            stripper.setEndPage(3);
            // На первой странице шагов — A1 и диапазон
            assertThat(stripper.getText(pdf)).contains("A1").contains("шаги 1–200 из 1000");
        }
    }
}
