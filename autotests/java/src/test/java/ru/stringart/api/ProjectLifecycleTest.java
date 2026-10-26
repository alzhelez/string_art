package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import io.restassured.path.json.JsonPath;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

@Epic("String Art API")
@Feature("Проекты")
public class ProjectLifecycleTest extends BaseApiTest {

    @AfterMethod(alwaysRun = true)
    public void tearDown() {
        cleanUp();
    }

    @Test(description = "TC-API-03 создание проекта из JPEG")
    @Story("TC-API-03")
    public void createProject() {
        JsonPath p = createProject("Тестовый портрет", "50");

        assertThat(p.getString("id")).matches("[0-9a-f]{12}");
        assertThat(p.getString("name")).isEqualTo("Тестовый портрет");
        assertThat(p.getDouble("diameter_cm")).isEqualTo(50.0);
        assertThat(p.getInt("line_count")).isBetween(1000, 5000);
        int best = api().get("/api/projects/" + p.getString("id") + "/similarity").jsonPath().getInt("best_lines");
        assertThat(p.getInt("line_count")).as("рекомендация — максимум сходства с фото").isEqualTo(best);
        assertThat(p.getInt("current_step")).isEqualTo(1);
        assertThat(p.getDouble("speed_sec")).isEqualTo(2.0);

        List<Integer> sequence = p.getList("sequence", Integer.class);
        assertThat(sequence).hasSize(5001);
        assertThat(sequence.get(0)).as("старт с A1").isZero();
        assertThat(sequence).allMatch(n -> n >= 0 && n < 240);

        double raw = p.getDouble("stats.raw_length_m");
        double total = p.getDouble("stats.total_length_m");
        assertThat(total).isCloseTo(raw * 1.15, within(0.1));
        assertThat(p.getInt("stats.spool_m") * p.getInt("stats.spool_count")).isGreaterThanOrEqualTo((int) Math.ceil(total));
    }

    @Test(description = "TC-API-04 PNG с прозрачностью, имя из файла, 70 см")
    @Story("TC-API-04")
    public void createFromPngUsesFileName() {
        JsonPath p = upload(PORTRAIT_PNG, "image/png", null, "70").then().statusCode(201).extract().jsonPath();
        try {
            assertThat(p.getString("name")).isEqualTo("portrait");
            assertThat(p.getInt("line_count")).isBetween(1000, 5000);
        } finally {
            api().delete("/api/projects/" + p.getString("id"));
        }
    }

    @Test(description = "TC-API-07 проект есть в списке, без sequence")
    @Story("TC-API-07")
    public void listContainsProject() {
        String id = createProject("Список", "50").getString("id");
        List<Map<String, Object>> items = api().get("/api/projects").then().statusCode(200)
                .extract().jsonPath().getList("$");
        Map<String, Object> found = items.stream().filter(i -> id.equals(i.get("id"))).findFirst().orElseThrow();
        assertThat(found).doesNotContainKey("sequence").containsKey("stats");
    }

    @DataProvider
    public Object[][] unknownIds() {
        return new Object[][]{{"000000000000"}, {"nope"}, {"ABCDEF123456"}};
    }

    @Test(dataProvider = "unknownIds", description = "TC-API-08 неизвестный проект — 404")
    @Story("TC-API-08")
    public void unknownProject(String id) {
        api().get("/api/projects/" + id).then().statusCode(404);
    }

    @Test(description = "TC-API-09 сохранение шага")
    @Story("TC-API-09")
    public void saveProgress() {
        String id = createProject("Прогресс", "50").getString("id");
        patch(id, "{\"current_step\": 137}").then().statusCode(200);
        assertThat(api().get("/api/projects/" + id).jsonPath().getInt("current_step")).isEqualTo(137);
    }

    @DataProvider
    public Object[][] speeds() {
        return new Object[][]{{2.1, 2.1}, {1.9, 1.9}, {2.04999, 2.0}, {0.5, 0.5}, {10.0, 10.0}};
    }

    @Test(dataProvider = "speeds", description = "TC-API-10 скорость сохраняется с точностью 0,1 с")
    @Story("TC-API-10")
    public void speedRoundedToTenth(double sent, double saved) {
        String id = createProject("Скорость", "50").getString("id");
        double actual = patch(id, "{\"speed_sec\": " + sent + "}").then().statusCode(200)
                .extract().jsonPath().getDouble("speed_sec");
        assertThat(actual).isEqualTo(saved);
    }

    @Test(description = "TC-API-12 уменьшение линий подтягивает прогресс")
    @Story("TC-API-12")
    public void reducingLinesClampsProgress() {
        String id = createProject("Линии", "50").getString("id");
        patch(id, "{\"line_count\": 2000}").then().statusCode(200);
        patch(id, "{\"current_step\": 1900}").then().statusCode(200);
        JsonPath body = patch(id, "{\"line_count\": 1500}").then().statusCode(200).extract().jsonPath();
        assertThat(body.getInt("current_step")).isEqualTo(1500);
        assertThat(body.getInt("stats.steps")).isEqualTo(1500);
    }

    @Test(description = "TC-API-13 диаметр меняет длину лески, но не схему")
    @Story("TC-API-13")
    public void diameterScalesThread() {
        JsonPath before = createProject("Диаметр", "50");
        JsonPath after = patch(before.getString("id"), "{\"diameter_cm\": 100}").then().statusCode(200)
                .extract().jsonPath();
        assertThat(after.getList("sequence")).isEqualTo(before.getList("sequence"));
        assertThat(after.getDouble("stats.raw_length_m"))
                .isCloseTo(before.getDouble("stats.raw_length_m") * 2, within(0.1));
    }

    @Test(description = "TC-API-14 шаги непрерывны, расход лески растёт")
    @Story("TC-API-14")
    public void stepsAreContinuous() {
        String id = createProject("Шаги", "50").getString("id");
        patch(id, "{\"line_count\": 2000}").then().statusCode(200);
        JsonPath page = api().queryParam("offset", 0).queryParam("limit", 50)
                .get("/api/projects/" + id + "/steps").then().statusCode(200).extract().jsonPath();
        assertThat(page.getInt("total")).isEqualTo(2000);
        List<Map<String, Object>> items = page.getList("items");
        assertThat(items).hasSize(50);
        assertThat(items.get(0)).containsEntry("number", 1).containsEntry("from_label", "A1");
        for (int i = 1; i < items.size(); i++) {
            assertThat(items.get(i).get("from_nail")).isEqualTo(items.get(i - 1).get("to_nail"));
            assertThat(((Number) items.get(i).get("thread_used_m")).doubleValue())
                    .isGreaterThan(((Number) items.get(i - 1).get("thread_used_m")).doubleValue());
        }
        List<Integer> tail = api().queryParam("offset", 1990).queryParam("limit", 50)
                .get("/api/projects/" + id + "/steps").jsonPath().getList("items.number", Integer.class);
        assertThat(tail).hasSize(10).startsWith(1991).endsWith(2000);
    }

    @Test(description = "TC-API-15 превью и исходник — PNG")
    @Story("TC-API-15")
    public void previewAndSourcePng() {
        String id = createProject("PNG", "50").getString("id");
        for (String url : List.of("/api/projects/" + id + "/preview.png?size=300", "/api/projects/" + id + "/source.png")) {
            byte[] png = api().get(url).then().statusCode(200).contentType("image/png").extract().asByteArray();
            assertThat(png).startsWith(0x89, 'P', 'N', 'G');
        }
        api().get("/api/projects/" + id + "/preview.png?size=50").then().statusCode(422);
    }

    @Test(description = "TC-API-17 удаление")
    @Story("TC-API-17")
    public void deleteProject() {
        String id = upload(PORTRAIT_JPG, "image/jpeg", null, null).then().statusCode(201)
                .extract().jsonPath().getString("id");
        api().delete("/api/projects/" + id).then().statusCode(204);
        api().get("/api/projects/" + id).then().statusCode(404);
        api().delete("/api/projects/" + id).then().statusCode(404);
    }

    @Test(description = "TC-API-26 кривая сходства и рекомендация по максимуму")
    @Story("TC-API-26")
    public void similarityCurve() {
        JsonPath p = createProject("Сходство", "50");
        String id = p.getString("id");
        JsonPath sim = api().get("/api/projects/" + id + "/similarity").then().statusCode(200).extract().jsonPath();
        List<Float> scores = sim.getList("curve.score", Float.class);
        assertThat(scores).hasSize(41);
        assertThat(sim.getInt("best_lines")).isEqualTo(p.getInt("line_count"));
        assertThat((double) sim.getFloat("best_score")).isEqualTo((double) java.util.Collections.max(scores), within(1e-6));
        int small = api().queryParam("diameter_cm", 30).get("/api/projects/" + id + "/similarity")
                .jsonPath().getInt("best_lines");
        assertThat(small).isLessThanOrEqualTo(sim.getInt("best_lines"));
    }
}
