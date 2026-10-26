package ru.stringart.api;

import io.qameta.allure.Epic;
import io.qameta.allure.Feature;
import io.qameta.allure.Story;
import io.restassured.http.ContentType;
import io.restassured.path.json.JsonPath;
import org.testng.annotations.AfterMethod;
import org.testng.annotations.Test;

import java.io.File;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

@Epic("String Art API")
@Feature("Редактор фото")
public class PhotoEditorTest extends BaseApiTest {

    private static final File FACE_JPG = FIXTURES.resolve("face.jpg").toFile();

    @AfterMethod(alwaysRun = true)
    public void tearDown() {
        cleanUp();
    }

    private JsonPath uploadImage() {
        return api().multiPart("file", FACE_JPG, "image/jpeg")
                .post("/api/images").then().statusCode(201).extract().jsonPath();
    }

    @Test(description = "TC-API-19 загрузка фото в редактор и поиск лица")
    @Story("TC-API-19")
    public void uploadFindsFace() {
        JsonPath img = uploadImage();
        assertThat(img.getInt("width")).isEqualTo(512);
        assertThat(img.getList("faces")).isNotEmpty();
        assertThat(img.getBoolean("face_prep.face_focus")).isTrue();
        api().get("/api/images/" + img.getString("id") + "/original.jpg")
                .then().statusCode(200).contentType("image/jpeg");
    }

    @Test(description = "TC-API-21/23 портрет из фото с кадром, затем правка фото")
    @Story("TC-API-21")
    public void createFromImageThenEditPhoto() {
        JsonPath img = uploadImage();
        Map<String, Object> body = Map.of(
                "image_id", img.getString("id"),
                "name", "Java",
                "prep", Map.of("zoom", 2, "center_x", 0.45, "center_y", 0.3));
        JsonPath p = api().contentType(ContentType.JSON).body(body)
                .post("/api/projects/from-image").then().statusCode(201).extract().jsonPath();
        String id = p.getString("id");
        cleanUpLater(id);
        assertThat(p.getDouble("prep.zoom")).isEqualTo(2.0);
        assertThat(p.getBoolean("prep.face_focus")).isFalse();

        patch(id, "{\"current_step\": 99}").then().statusCode(200);
        Map<String, Object> facePrep = img.getMap("face_prep");
        JsonPath updated = api().contentType(ContentType.JSON).body(facePrep)
                .put("/api/projects/" + id + "/photo").then().statusCode(200).extract().jsonPath();
        assertThat(updated.getInt("current_step")).isEqualTo(1);
        assertThat(updated.getBoolean("prep.face_focus")).isTrue();
        assertThat(updated.getList("sequence")).isNotEqualTo(p.getList("sequence"));

        api().contentType(ContentType.JSON).body("{\"zoom\": 10}")
                .put("/api/projects/" + id + "/photo").then().statusCode(422);
    }
}
