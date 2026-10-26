package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import io.restassured.response.Response;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.Test;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;

@Epic("String Art API")
@Feature("PDF-инструкция")
public class InstructionsTest extends BaseApiTest {

    @AfterMethod(alwaysRun = true)
    public void tearDown() {
        cleanUp();
    }

    @Test(description = "TC-API-16 PDF: заголовки, число страниц, содержимое")
    @Story("TC-API-16")
    public void pdfInstructions() throws IOException {
        String id = createProject("PDF-тест", "50").getString("id");
        patch(id, "{\"line_count\": 1000}").then().statusCode(200);

        Response r = api().get("/api/projects/" + id + "/instructions.pdf");
        r.then().statusCode(200).contentType("application/pdf");
        assertThat(r.header("Content-Disposition")).contains("attachment").contains("filename*=UTF-8''");

        try (PDDocument pdf = Loader.loadPDF(r.asByteArray())) {
            assertThat(pdf.getNumberOfPages()).as("обложка + схема + 1000/200 страниц шагов").isEqualTo(7);
            PDFTextStripper stripper = new PDFTextStripper();
            stripper.setStartPage(1);
            stripper.setEndPage(1);
            assertThat(stripper.getText(pdf)).contains("Минимальная катушка").contains("50,0 см");
            stripper.setStartPage(3);
            stripper.setEndPage(3);
            assertThat(stripper.getText(pdf)).contains("A1").contains("шаги 1–200 из 1000");
        }
    }
}
