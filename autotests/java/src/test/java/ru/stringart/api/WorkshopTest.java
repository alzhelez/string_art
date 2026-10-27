package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.Test;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@Epic("String Art API")
@Feature("Мастерская: шаблон, время, катушка")
public class WorkshopTest extends BaseApiTest {

    @AfterMethod(alwaysRun = true)
    public void tearDown() {
        cleanUp();
    }

    @Test(description = "TC-API-31 шаблон разметки 1:1 в PDF")
    @Story("TC-API-31")
    public void templatePdf() {
        String id = createProject("Шаблон", "50").getString("id");
        byte[] pdf = api().queryParam("paper", "A4").get("/api/projects/" + id + "/template.pdf")
                .then().statusCode(200).contentType("application/pdf").extract().asByteArray();
        assertThat(new String(pdf, 0, 4)).isEqualTo("%PDF");
        api().queryParam("diameter_cm", 10).get("/api/template.pdf").then().statusCode(422);
        api().queryParam("paper", "A5").get("/api/projects/" + id + "/template.pdf").then().statusCode(422);
    }

    @Test(description = "TC-API-30 время плетения по дням и своя катушка")
    @Story("TC-API-30")
    public void activityAndSpool() {
        String id = createProject("Время", "50").getString("id");
        api().contentType(ContentType.JSON).body(Map.of("date", "2026-10-27", "seconds", 30, "steps", 12))
                .post("/api/projects/" + id + "/activity").then().statusCode(200);
        JsonPath a = api().contentType(ContentType.JSON).body(Map.of("date", "2026-10-28", "seconds", 30, "steps", 8))
                .post("/api/projects/" + id + "/activity").then().statusCode(200).extract().jsonPath();
        assertThat(a.getDouble("total_sec")).isEqualTo(60.0);
        assertThat(a.getInt("total_steps")).isEqualTo(20);
        assertThat(a.getList("days.date")).containsExactly("2026-10-27", "2026-10-28");
        api().contentType(ContentType.JSON).body(Map.of("date", "вчера", "seconds", 1, "steps", 1))
                .post("/api/projects/" + id + "/activity").then().statusCode(422);
        assertThat(patch(id, "{\"own_spool_m\": 300}").then().statusCode(200).extract().jsonPath().getDouble("own_spool_m"))
                .isEqualTo(300.0);
    }
}
