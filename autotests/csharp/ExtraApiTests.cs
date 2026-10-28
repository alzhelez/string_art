// Кейсы, которых раньше не было в C#: список, диаметр, картинки, подготовка фото, лицо, корень, кисть.
// Коды HTTP-статусов
using System.Net;
// Заголовки
using System.Net.Http.Headers;
// Кодировка
using System.Text;
// Сериализация JSON
using System.Text.Json;
// Дерево JSON
using System.Text.Json.Nodes;
// xUnit
using Xunit;

// Пространство имён тестов
namespace StringArt.ApiTests;

// Класс тестов с тем же общим объектом, что у ApiTests
public class ExtraApiTests : IClassFixture<ApiFixture>
{
    // Общий объект
    private readonly ApiFixture _api;
    // xUnit передаёт его в конструктор
    public ExtraApiTests(ApiFixture api) => _api = api;

    // Загрузить фото из фикстур в редактор
    private async Task<JsonNode> UploadImage(string name, string mime)
    {
        // Форма
        using var form = new MultipartFormDataContent();
        // Содержимое файла
        var file = new ByteArrayContent(_api.Bytes(name));
        // Тип
        file.Headers.ContentType = new MediaTypeHeaderValue(mime);
        // Поле file
        form.Add(file, "file", name);
        // Отправляем
        var res = await _api.Http.PostAsync("/api/images", form);
        // → 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Разбираем
        return await ApiFixture.Json(res);
    }

    // Тело запроса в JSON
    private static StringContent JsonBody(object body) =>
        // Сериализуем объект
        new(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");

    /// <summary>Ширина и высота PNG из заголовка IHDR (байты 16–23, big-endian).</summary>
    // Размер PNG без графических библиотек — прямо из заголовка файла
    private static (int W, int H) PngSize(byte[] png) =>
        // ширина — первые четыре байта IHDR
        ((png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19],
         // Высота — следующие четыре
         (png[20] << 24) | (png[21] << 16) | (png[22] << 8) | png[23]);

    // Тест
    [Fact(DisplayName = "TC-API-07 список проектов без sequence")]
    // Список без схемы
    public async Task ListWithoutSequence()
    {
        // Создаём
        var p = await _api.CreateProject();
        // Список
        var list = (await ApiFixture.Json(await _api.Http.GetAsync("/api/projects"))).AsArray();
        // Наш проект
        var mine = list.First(x => x!["id"]!.GetValue<string>() == p["id"]!.GetValue<string>())!.AsObject();
        // Схемы нет
        Assert.False(mine.ContainsKey("sequence"));
        // Расчёт есть
        Assert.True(mine.ContainsKey("stats"));
    }

    // Тест
    [Fact(DisplayName = "TC-API-13 диаметр меняет длину лески, но не схему")]
    // Диаметр
    public async Task DiameterScalesThread()
    {
        // Создаём
        var p = await _api.CreateProject();
        // id
        var id = p["id"]!.GetValue<string>();
        // Чистая длина при 50 см
        var before = p["stats"]!["raw_length_m"]!.GetValue<double>();
        // Диаметр 100
        var upd = await ApiFixture.Json(await _api.Patch(id, new { diameter_cm = 100 }));
        // Схема та же
        Assert.Equal(p["sequence"]!.ToJsonString(), upd["sequence"]!.ToJsonString());
        // Длина вдвое больше
        Assert.InRange(upd["stats"]!["raw_length_m"]!.GetValue<double>() / before, 1.99, 2.01);
    }

    // Тест
    [Fact(DisplayName = "TC-API-15 превью и исходник — PNG, size=50 → 422")]
    // Превью и исходник
    public async Task PreviewAndSource()
    {
        // Создаём
        var p = await _api.CreateProject();
        // id
        var id = p["id"]!.GetValue<string>();
        // Превью 300
        var preview = await _api.Http.GetAsync($"/api/projects/{id}/preview.png?size=300");
        // Тип PNG
        Assert.Equal("image/png", preview.Content.Headers.ContentType!.MediaType);
        // Размер 300×300
        Assert.Equal((300, 300), PngSize(await preview.Content.ReadAsByteArrayAsync()));
        // Исходник
        var source = await _api.Http.GetAsync($"/api/projects/{id}/source.png");
        // → 200
        Assert.Equal(HttpStatusCode.OK, source.StatusCode);
        // Превью 50 → 422
        Assert.Equal((HttpStatusCode)422, (await _api.Http.GetAsync($"/api/projects/{id}/preview.png?size=50")).StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-20 подготовленный кадр 400×400, параметры меняют результат, zoom 5 → 422")]
    // Подготовленный кадр
    public async Task PreparedImage()
    {
        // Загружаем фото
        var img = await UploadImage("face.jpg", "image/jpeg");
        // Адрес кадра
        var url = $"/api/images/{img["id"]!.GetValue<string>()}/prepared.png";
        // Без правок
        var plain = await _api.Http.GetByteArrayAsync(url);
        // 400×400
        Assert.Equal((400, 400), PngSize(plain));
        // Яркость меняет кадр
        Assert.NotEqual(plain, await _api.Http.GetByteArrayAsync(url + "?brightness=0.3"));
        // Зум меняет кадр
        Assert.NotEqual(plain, await _api.Http.GetByteArrayAsync(url + "?zoom=3&center_x=0.43"));
        // Зум 5 → 422
        Assert.Equal((HttpStatusCode)422, (await _api.Http.GetAsync(url + "?zoom=5")).StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-22 «Выделить лицо»: с лицом — 201, без лица — 422")]
    // «Выделить лицо»
    public async Task FaceFocus()
    {
        // Загружаем фото с лицом
        var img = await UploadImage("face.jpg", "image/jpeg");
        // Создаём проект —
        var ok = await _api.Http.PostAsync("/api/projects/from-image", JsonBody(new
        {
            // id фото
            image_id = img["id"]!.GetValue<string>(),
            // название
            name = "C#: лицо",
            // готовый кадр лица
            prep = img["face_prep"],
        }));
        // → 201
        Assert.Equal(HttpStatusCode.Created, ok.StatusCode);
        // Разбираем
        var p = await ApiFixture.Json(ok);
        // Удаляем сразу — данные уже в переменной
        await _api.Http.DeleteAsync($"/api/projects/{p["id"]!.GetValue<string>()}");
        // Флажок сохранён
        Assert.True(p["prep"]!["face_focus"]!.GetValue<bool>());

        // Однотонная картинка
        var blank = await UploadImage("blank.png", "image/png");
        // Лиц нет
        Assert.Empty(blank["faces"]!.AsArray());
        // Просим «Выделить лицо» —
        var bad = await _api.Http.PostAsync("/api/projects/from-image", JsonBody(new
        {
            // id картинки
            image_id = blank["id"]!.GetValue<string>(),
            // флажок
            prep = new { face_focus = true },
        }));
        // → 422
        Assert.Equal((HttpStatusCode)422, bad.StatusCode);
        // Текст про лицо
        Assert.Contains("лицо", (await ApiFixture.Json(bad))["detail"]!.GetValue<string>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-25 корень бэкенда ведёт на приложение")]
    // Корень бэкенда
    public async Task RootRedirect()
    {
        // Клиент без перехода по перенаправлениям
        using var noRedirect = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false }) { BaseAddress = _api.Http.BaseAddress };
        // Запрос корня
        var root = await noRedirect.GetAsync("/");
        // 307 или 200
        Assert.Contains(root.StatusCode, new[] { HttpStatusCode.TemporaryRedirect, HttpStatusCode.OK });
        // У перенаправления есть адрес
        if (root.StatusCode == HttpStatusCode.TemporaryRedirect) Assert.NotNull(root.Headers.Location);
        // Иконка
        var icon = await _api.Http.GetAsync("/favicon.ico");
        // 204 или 200
        Assert.Contains(icon.StatusCode, new[] { HttpStatusCode.NoContent, HttpStatusCode.OK });
    }

    // Тест
    [Fact(DisplayName = "TC-API-28 маска кистью: не PNG → 400, размер приводится к фото, чужой id → 404")]
    // Маска кистью
    public async Task MaskBrushEdit()
    {
        // Загружаем фото
        var img = await UploadImage("face.jpg", "image/jpeg");
        // id
        var id = img["id"]!.GetValue<string>();
        // Помощник: байты с типом image/png
        ByteArrayContent Png(byte[] b)
        {
            // Содержимое
            var c = new ByteArrayContent(b);
            // Тип
            c.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            // Отдаём
            return c;
        }
        // Не PNG → 400
        Assert.Equal(HttpStatusCode.BadRequest, (await _api.Http.PutAsync($"/api/images/{id}/mask.png", Png(Encoding.ASCII.GetBytes("not png")))).StatusCode);
        // Маска из фикстур
        var ok = await _api.Http.PutAsync($"/api/images/{id}/mask.png", Png(_api.Bytes("mask.png")));
        // → 200
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        // Отмечена как исправленная
        Assert.True((await ApiFixture.Json(ok))["edited"]!.GetValue<bool>());
        // Скачиваем сохранённую
        var saved = await _api.Http.GetByteArrayAsync($"/api/images/{id}/mask.png");
        // Размер как у фото
        Assert.Equal((img["width"]!.GetValue<int>(), img["height"]!.GetValue<int>()), PngSize(saved));
        // Чужой id → 404
        Assert.Equal(HttpStatusCode.NotFound, (await _api.Http.PutAsync("/api/images/000000000000/mask.png", Png(new byte[] { 1 }))).StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-32 «чёрная + белая»: две нити, PATCH нити, шаги и сходство нити")]
    // Цветной портрет
    public async Task ColorLayers()
    {
        // Загружаем фото
        var img = await UploadImage("face.jpg", "image/jpeg");
        // Создаём портрет из двух нитей
        var res = await _api.Http.PostAsync("/api/projects/from-image", JsonBody(new { image_id = img["id"]!.GetValue<string>(), mode = "bw" }));
        // → 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Проект
        var p = await ApiFixture.Json(res);
        // id
        var id = p["id"]!.GetValue<string>();
        // Блок с уборкой
        try
        {
            // Режим bw
            Assert.Equal("bw", p["mode"]!.GetValue<string>());
            // Серая доска
            Assert.Equal("gray", p["board"]!["key"]!.GetValue<string>());
            // Цвета нитей по алфавиту
            var colors = p["layers"]!.AsArray().Select(l => l!["color"]!.GetValue<string>()).OrderBy(c => c).ToArray();
            // Белая и чёрная
            Assert.Equal(new[] { "black", "white" }, colors);
            // Вторая нить: 300 линий
            var upd = await ApiFixture.Json(await _api.Patch(id, new { layer = 1, line_count = 300 }));
            // Сохранилось
            Assert.Equal(300, upd["layers"]![1]!["line_count"]!.GetValue<int>());
            // Шаги второй нити
            var steps = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/steps?layer=1&limit=1"));
            // Всего 300
            Assert.Equal(300, steps["total"]!.GetValue<int>());
            // Сходство второй нити — 25 точек
            var sim = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/similarity?layer=1"));
            // Проверка
            Assert.Equal(25, sim["curve"]!.AsArray().Count);
            // Третьей нити нет → 422
            Assert.Equal((HttpStatusCode)422, (await _api.Patch(id, new { layer = 2, line_count = 300 })).StatusCode);
        }
        // В любом случае —
        finally
        {
            // — удаляем проект
            await _api.Http.DeleteAsync($"/api/projects/{id}");
        }
    }
}
