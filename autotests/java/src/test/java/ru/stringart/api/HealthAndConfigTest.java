package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import io.restassured.path.json.JsonPath;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

@Epic("String Art API")
@Feature("Служебные ручки")
public class HealthAndConfigTest extends BaseApiTest {

    @Test(description = "TC-API-01 health")
    @Story("TC-API-01")
    public void healthReturnsOk() {
        api().get("/api/health").then().statusCode(200).body("status", equalTo("ok"));
    }

    @Test(description = "TC-API-02 config: гвозди, диаметры, скорость, запас лески")
    @Story("TC-API-02")
    public void configMatchesRequirements() {
        JsonPath cfg = api().get("/api/config").then().statusCode(200).extract().jsonPath();

        assertThat(cfg.getList("sectors", String.class)).containsExactly("A", "B", "C", "D");
        assertThat(cfg.getInt("nails_per_sector")).isEqualTo(60);
        assertThat(cfg.getInt("total_nails")).isEqualTo(240);
        assertThat(cfg.getList("diameter.presets_cm", Integer.class)).containsExactly(30, 40, 50, 60, 70);
        assertThat(cfg.getDouble("speed.default_sec")).isEqualTo(2.0);
        assertThat(cfg.getDouble("speed.step_sec")).isEqualTo(0.1);
        assertThat(cfg.getDouble("speed.min_sec")).isEqualTo(0.5);
        assertThat(cfg.getDouble("speed.max_sec")).isEqualTo(10.0);
        assertThat(cfg.getDouble("thread.margin")).isEqualTo(0.15);
        assertThat(cfg.getInt("lines.min")).isEqualTo(1000);
        assertThat(cfg.getInt("lines.max")).isEqualTo(5000);
    }

    @DataProvider
    public Object[][] diameters() {
        return new Object[][]{
                {30, 3.93, 1200},
                {50, 6.54, 2000},
                {70, 9.16, 2800},
        };
    }

    @Test(dataProvider = "diameters", description = "TC-API-18 шаг гвоздей и рекомендация линий")
    @Story("TC-API-18")
    public void geometryForDiameter(int diameter, double spacingMm, int lines) {
        JsonPath body = api().queryParam("diameter_cm", diameter)
                .get("/api/geometry").then().statusCode(200).extract().jsonPath();
        assertThat(body.getDouble("nail_spacing_mm")).isEqualTo(spacingMm);
        assertThat(body.getInt("recommended_lines")).isEqualTo(lines);
    }

    @Test(description = "TC-API-18 диаметр вне диапазона — 422")
    @Story("TC-API-18")
    public void geometryRejectsBadDiameter() {
        for (String d : List.of("10", "151", "abc")) {
            api().queryParam("diameter_cm", d).get("/api/geometry").then().statusCode(422);
        }
    }
}
