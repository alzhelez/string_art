// API-тесты на C#: xUnit + HttpClient + System.Text.Json.
// Запуск: STRINGART_API=http://127.0.0.1:8000 dotnet test
// Коды HTTP-статусов
using System.Net;
// Заголовки (тип содержимого)
using System.Net.Http.Headers;
// Кодировка UTF-8
using System.Text;
// Сериализация в JSON
using System.Text.Json;
// Разбор JSON в дерево узлов
using System.Text.Json.Nodes;
// Регулярные выражения — считаем страницы PDF
using System.Text.RegularExpressions;
// xUnit
using Xunit;

// Пространство имён тестов
namespace StringArt.ApiTests;

// Общий объект на все тесты класса: клиент, фикстуры, уборка
public sealed class ApiFixture : IDisposable
{
    // HTTP-клиент с адресом бэкенда
    public HttpClient Http { get; }
    // Папка фикстур
    public string Fixtures { get; }
    // id созданных проектов — удалим в конце
    private readonly List<string> _created = new();

    // Конструктор — один раз на класс тестов
    public ApiFixture()
    {
        // Адрес бэкенда из переменной или локальный
        var baseUrl = Environment.GetEnvironmentVariable("STRINGART_API") ?? "http://127.0.0.1:8000";
        // Клиент с таймаутом 60 с — расчёт схемы может быть долгим
        Http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(60) };
        // Папка фикстур из переменной —
        Fixtures = Environment.GetEnvironmentVariable("STRINGART_FIXTURES")
                   // — или ../../../../fixtures от папки сборки (bin/Debug/net8.0)
                   ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "fixtures"));
    }

    // Загрузить проект формой
    public async Task<HttpResponseMessage> Upload(string? fileName, string mime, byte[]? content, Dictionary<string, string> fields)
    {
        // Форма; освободится сама
        using var form = new MultipartFormDataContent();
        // Если есть файл —
        if (content is not null && fileName is not null)
        {
            // — содержимое
            var file = new ByteArrayContent(content);
            // — тип
            file.Headers.ContentType = new MediaTypeHeaderValue(mime);
            // — поле file с именем
            form.Add(file, "file", fileName);
        }
        // Остальные поля — текстом в UTF-8
        foreach (var (k, v) in fields) form.Add(new StringContent(v, Encoding.UTF8), k);
        // Отправляем
        return await Http.PostAsync("/api/projects", form);
    }

    // Создать проект и запомнить для удаления
    public async Task<JsonNode> CreateProject(string? name = "C#-тест", string diameter = "50")
    {
        // Поле диаметра
        var fields = new Dictionary<string, string> { ["diameter_cm"] = diameter };
        // Название — если задано
        if (name is not null) fields["name"] = name;
        // Загружаем портрет
        var res = await Upload("portrait.jpg", "image/jpeg", Bytes("portrait.jpg"), fields);
        // Ожидаем 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Разбираем
        var node = await Json(res);
        // Запоминаем id (тесты могут идти параллельно — lock)
        lock (_created) _created.Add(node["id"]!.GetValue<string>());
        // Отдаём
        return node;
    }

    // Байты файла из фикстур
    public byte[] Bytes(string name) => File.ReadAllBytes(Path.Combine(Fixtures, name));

    // PATCH проекта с телом JSON
    public Task<HttpResponseMessage> Patch(string id, object body) =>
        // Адрес
        Http.PatchAsync($"/api/projects/{id}",
            // Тело JSON
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));

    // Разобрать JSON из ответа
    public static async Task<JsonNode> Json(HttpResponseMessage res) =>
        // Читаем текст и разбираем
        JsonNode.Parse(await res.Content.ReadAsStringAsync())!;

    // После всех тестов класса —
    public void Dispose()
    {
        // — удаляем созданные проекты
        foreach (var id in _created) Http.DeleteAsync($"/api/projects/{id}").GetAwaiter().GetResult();
        // — закрываем клиент
        Http.Dispose();
    }
}

// Класс тестов; получает общий объект через конструктор
public class ApiTests : IClassFixture<ApiFixture>
{
    // Общий объект
    private readonly ApiFixture _api;
    // xUnit передаёт его в конструктор
    public ApiTests(ApiFixture api) => _api = api;

    // Тест с понятным именем в отчёте
    [Fact(DisplayName = "TC-API-01 health")]
    // Сервер жив
    public async Task Health()
    {
        // Запрос
        var res = await _api.Http.GetAsync("/api/health");
        // → 200
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        // Тело {"status": "ok"}
        Assert.Equal("ok", (await ApiFixture.Json(res))["status"]!.GetValue<string>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-02 config")]
    // Настройки
    public async Task Config()
    {
        // Получаем
        var cfg = await ApiFixture.Json(await _api.Http.GetAsync("/api/config"));
        // Четыре сектора
        Assert.Equal(new[] { "A", "B", "C", "D" }, cfg["sectors"]!.AsArray().Select(n => n!.GetValue<string>()));
        // 60 гвоздей в секторе
        Assert.Equal(60, cfg["nails_per_sector"]!.GetValue<int>());
        // Готовые диаметры
        Assert.Equal(new[] { 30, 40, 50, 60, 70 }, cfg["diameter"]!["presets_cm"]!.AsArray().Select(n => n!.GetValue<int>()));
        // Скорость по умолчанию
        Assert.Equal(2.0, cfg["speed"]!["default_sec"]!.GetValue<double>());
        // Шаг скорости
        Assert.Equal(0.1, cfg["speed"]!["step_sec"]!.GetValue<double>());
        // Запас лески
        Assert.Equal(0.15, cfg["thread"]!["margin"]!.GetValue<double>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-03 создание проекта")]
    // Создание проекта
    public async Task Create()
    {
        // Создаём
        var p = await _api.CreateProject("Тестовый портрет");
        // id из 12 шестнадцатеричных символов
        Assert.Matches("^[0-9a-f]{12}$", p["id"]!.GetValue<string>());
        // Название
        Assert.Equal("Тестовый портрет", p["name"]!.GetValue<string>());
        // Нитей в границах
        Assert.InRange(p["line_count"]!.GetValue<int>(), 1000, 5000);
        // Кривая сходства
        var sim = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{p["id"]!.GetValue<string>()}/similarity"));
        // Выбрано лучшее число нитей
        Assert.Equal(sim["best_lines"]!.GetValue<int>(), p["line_count"]!.GetValue<int>());
        // Шаг 1
        Assert.Equal(1, p["current_step"]!.GetValue<int>());
        // Схема
        var seq = p["sequence"]!.AsArray();
        // На 5000 нитей
        Assert.Equal(5001, seq.Count);
        // Начало A1
        Assert.Equal(0, seq[0]!.GetValue<int>());
        // Чистая длина
        var raw = p["stats"]!["raw_length_m"]!.GetValue<double>();
        // С запасом
        var total = p["stats"]!["total_length_m"]!.GetValue<double>();
        // Запас 15 %
        Assert.InRange(total, raw * 1.15 - 0.1, raw * 1.15 + 0.1);
        // Катушек хватает
        Assert.True(p["stats"]!["spool_m"]!.GetValue<int>() * p["stats"]!["spool_count"]!.GetValue<int>() >= total);
    }

    // Тест
    [Fact(DisplayName = "TC-API-04 PNG, имя из файла, 70 см")]
    // PNG без названия
    public async Task PngUsesFileName()
    {
        // Загружаем на 70 см
        var res = await _api.Upload("portrait.png", "image/png", _api.Bytes("portrait.png"),
            // поля формы
            new() { ["diameter_cm"] = "70" });
        // → 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Разбираем
        var p = await ApiFixture.Json(res);
        // Удаляем сразу — данные уже в переменной
        await _api.Http.DeleteAsync($"/api/projects/{p["id"]!.GetValue<string>()}");
        // Название — имя файла
        Assert.Equal("portrait", p["name"]!.GetValue<string>());
        // Нитей в границах
        Assert.InRange(p["line_count"]!.GetValue<int>(), 1000, 5000);
    }

    // Параметризованный тест
    [Theory(DisplayName = "TC-API-05/06 валидация загрузки")]
    // пустой файл → 400
    [InlineData("empty", "50", 400)]
    // текст → 400
    [InlineData("text", "50", 400)]
    // диаметр меньше 20 → 422
    [InlineData("jpg", "19.9", 422)]
    // больше 150 → 422
    [InlineData("jpg", "150.1", 422)]
    // не число → 422
    [InlineData("jpg", "abc", 422)]
    // без файла → 422
    [InlineData("none", "50", 422)]
    // Неверная загрузка
    public async Task UploadValidation(string kind, string diameter, int status)
    {
        // Содержимое по виду
        byte[]? content = kind switch
        {
            // пустое
            "empty" => Array.Empty<byte>(),
            // текст
            "text" => _api.Bytes("not-an-image.txt"),
            // портрет
            "jpg" => _api.Bytes("portrait.jpg"),
            // нет файла
            _ => null,
        };
        // Загружаем
        var res = await _api.Upload("x.jpg", "application/octet-stream", content, new() { ["diameter_cm"] = diameter });
        // Статус совпадает
        Assert.Equal(status, (int)res.StatusCode);
    }

    // Параметризованный тест
    [Theory(DisplayName = "TC-API-08 неизвестный проект — 404")]
    // несуществующий
    [InlineData("000000000000")]
    // короткий
    [InlineData("nope")]
    // Неизвестный проект
    public async Task NotFound(string id) =>
        // → 404
        Assert.Equal(HttpStatusCode.NotFound, (await _api.Http.GetAsync($"/api/projects/{id}")).StatusCode);

    // Тест
    [Fact(DisplayName = "TC-API-09/10 шаг и скорость")]
    // Шаг и скорость
    public async Task ProgressAndSpeed()
    {
        // Создаём
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        // Шаг 137 → 200
        Assert.Equal(HttpStatusCode.OK, (await _api.Patch(id, new { current_step = 137 })).StatusCode);
        // Читаем
        var p = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}"));
        // Сохранился
        Assert.Equal(137, p["current_step"]!.GetValue<int>());
        // Пары «отправили — сохранилось»
        foreach (var (sent, saved) in new[] { (2.1, 2.1), (1.9, 1.9), (2.04999, 2.0), (0.5, 0.5), (10.0, 10.0) })
        {
            // Отправляем
            var body = await ApiFixture.Json(await _api.Patch(id, new { speed_sec = sent }));
            // Сохранено округлённое
            Assert.Equal(saved, body["speed_sec"]!.GetValue<double>());
        }
    }

    // Неверные изменения проекта
    public static IEnumerable<object[]> BadPatches() => new[]
    {
        // скорость меньше 0,5
        new object[] { new { speed_sec = 0.4 } },
        // больше 10
        new object[] { new { speed_sec = 10.1 } },
        // шаг 0
        new object[] { new { current_step = 0 } },
        // шаг больше числа нитей
        new object[] { new { current_step = 2001 } },
        // нитей меньше 1000
        new object[] { new { line_count = 999 } },
        // больше 5000
        new object[] { new { line_count = 5001 } },
        // диаметр меньше 20
        new object[] { new { diameter_cm = 10 } },
        // название из пробелов
        new object[] { new { name = "  " } },
        // схему менять нельзя
        new object[] { new { sequence = new[] { 1, 2, 3 } } },
    };

    // Параметризованный тест
    [Theory(DisplayName = "TC-API-11 PATCH отклоняет невалидное")]
    // Данные из списка выше
    [MemberData(nameof(BadPatches))]
    // Неверное изменение
    public async Task PatchValidation(object body)
    {
        // Создаём
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        // 2000 нитей
        await _api.Patch(id, new { line_count = 2000 });
        // → 422
        Assert.Equal(422, (int)(await _api.Patch(id, body)).StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-12 уменьшение линий подтягивает шаг")]
    // Меньше нитей — шаг прижимается
    public async Task ClampProgress()
    {
        // Создаём
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        // 2000 нитей
        await _api.Patch(id, new { line_count = 2000 });
        // Шаг 1900
        await _api.Patch(id, new { current_step = 1900 });
        // Уменьшаем до 1500
        var body = await ApiFixture.Json(await _api.Patch(id, new { line_count = 1500 }));
        // Шаг прижат
        Assert.Equal(1500, body["current_step"]!.GetValue<int>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-14 шаги непрерывны")]
    // Шаги без разрывов
    public async Task Steps()
    {
        // Создаём
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        // Первые 50 шагов
        var page = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/steps?offset=0&limit=50"));
        // Шаги
        var items = page["items"]!.AsArray();
        // Начало A1
        Assert.Equal("A1", items[0]!["from_label"]!.GetValue<string>());
        // Для каждой пары соседних —
        for (var i = 1; i < items.Count; i++)
            // — нить из конца предыдущей
            Assert.Equal(items[i - 1]!["to_nail"]!.GetValue<int>(), items[i]!["from_nail"]!.GetValue<int>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-16 PDF")]
    // PDF
    public async Task Pdf()
    {
        // Создаём
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        // 1000 нитей
        await _api.Patch(id, new { line_count = 1000 });
        // Скачиваем
        var res = await _api.Http.GetAsync($"/api/projects/{id}/instructions.pdf");
        // Тип PDF
        Assert.Equal("application/pdf", res.Content.Headers.ContentType!.MediaType);
        // Байты
        var bytes = await res.Content.ReadAsByteArrayAsync();
        // Как текст Latin-1 — байт в символ
        var latin = Encoding.Latin1.GetString(bytes);
        // Сигнатура
        Assert.StartsWith("%PDF", latin);
        // 7 страниц
        Assert.Equal(7, Regex.Matches(latin, @"/Type\s*/Page[^s]").Count);
    }

    // Тест
    [Fact(DisplayName = "TC-API-17 удаление")]
    // Удаление
    public async Task Delete()
    {
        // Загружаем
        var res = await _api.Upload("portrait.jpg", "image/jpeg", _api.Bytes("portrait.jpg"), new());
        // id
        var id = (await ApiFixture.Json(res))["id"]!.GetValue<string>();
        // Удаляем → 204
        Assert.Equal(HttpStatusCode.NoContent, (await _api.Http.DeleteAsync($"/api/projects/{id}")).StatusCode);
        // Читаем → 404
        Assert.Equal(HttpStatusCode.NotFound, (await _api.Http.GetAsync($"/api/projects/{id}")).StatusCode);
    }

    // Параметризованный тест
    [Theory(DisplayName = "TC-API-18 шаг гвоздей по диаметру")]
    // 30 см
    [InlineData(30, 3.93, 1200)]
    // 50 см
    [InlineData(50, 6.54, 2000)]
    // 70 см
    [InlineData(70, 9.16, 2800)]
    // Геометрия
    public async Task Geometry(int d, double spacing, int lines)
    {
        // Запрос
        var g = await ApiFixture.Json(await _api.Http.GetAsync($"/api/geometry?diameter_cm={d}"));
        // Расстояние
        Assert.Equal(spacing, g["nail_spacing_mm"]!.GetValue<double>());
        // Нити
        Assert.Equal(lines, g["recommended_lines"]!.GetValue<int>());
    }

    // Загрузить фото с лицом
    private async Task<JsonNode> UploadFace()
    {
        // Форма
        using var form = new MultipartFormDataContent();
        // Файл
        var file = new ByteArrayContent(_api.Bytes("face.jpg"));
        // Тип JPEG
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        // Поле file
        form.Add(file, "file", "face.jpg");
        // Отправляем
        var res = await _api.Http.PostAsync("/api/images", form);
        // → 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Разбираем
        return await ApiFixture.Json(res);
    }

    // Тест
    [Fact(DisplayName = "TC-API-19 загрузка фото и поиск лица")]
    // Фото в редакторе
    public async Task UploadImage()
    {
        // Загружаем
        var img = await UploadFace();
        // Ширина 512
        Assert.Equal(512, img["width"]!.GetValue<int>());
        // Лица есть
        Assert.NotEmpty(img["faces"]!.AsArray());
        // Готовый кадр лица
        Assert.True(img["face_prep"]!["face_focus"]!.GetValue<bool>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-21/23 портрет из фото и правка фото")]
    // Портрет из фото и правка фото
    public async Task CreateFromImageAndEdit()
    {
        // Загружаем
        var img = await UploadFace();
        // Тело: id, название, кадр
        var body = new { image_id = img["id"]!.GetValue<string>(), name = "C#", prep = new { zoom = 2, center_x = 0.45, center_y = 0.3 } };
        // Создаём проект
        var res = await _api.Http.PostAsync("/api/projects/from-image",
            // тело JSON
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        // → 201
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        // Разбираем
        var p = await ApiFixture.Json(res);
        // id
        var id = p["id"]!.GetValue<string>();
        // Блок с уборкой
        try
        {
            // Зум сохранился
            Assert.Equal(2.0, p["prep"]!["zoom"]!.GetValue<double>());
            // Шаг 99
            await _api.Patch(id, new { current_step = 99 });
            // Меняем кадр на «Выделить лицо»
            var put = await _api.Http.PutAsync($"/api/projects/{id}/photo",
                // тело — готовый кадр
                new StringContent(img["face_prep"]!.ToJsonString(), Encoding.UTF8, "application/json"));
            // → 200
            Assert.Equal(HttpStatusCode.OK, put.StatusCode);
            // Разбираем
            var upd = await ApiFixture.Json(put);
            // Шаг сброшен
            Assert.Equal(1, upd["current_step"]!.GetValue<int>());
            // Флажок стоит
            Assert.True(upd["prep"]!["face_focus"]!.GetValue<bool>());
        }
        // В любом случае —
        finally
        {
            // — удаляем проект
            await _api.Http.DeleteAsync($"/api/projects/{id}");
        }
    }

    // Тест
    [Fact(DisplayName = "TC-API-26 рекомендация по максимуму сходства")]
    // Кривая сходства
    public async Task Similarity()
    {
        // Создаём
        var p = await _api.CreateProject();
        // id
        var id = p["id"]!.GetValue<string>();
        // Кривая
        var sim = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/similarity"));
        // Значения сходства
        var scores = sim["curve"]!.AsArray().Select(x => x!["score"]!.GetValue<double>()).ToList();
        // 41 точка
        Assert.Equal(41, scores.Count);
        // Лучшее — максимум кривой
        Assert.Equal(scores.Max(), sim["best_score"]!.GetValue<double>(), 6);
        // Рекомендация совпадает
        Assert.Equal(p["line_count"]!.GetValue<int>(), sim["best_lines"]!.GetValue<int>());
    }

    // Тест
    [Fact(DisplayName = "TC-API-27 автонастройка фото")]
    // Автонастройка
    public async Task AutoTone()
    {
        // Загружаем
        var img = await UploadFace();
        // id
        var id = img["id"]!.GetValue<string>();
        // Тело: копия кадра лица и диаметр
        var body = new JsonObject { ["prep"] = img["face_prep"]!.DeepClone(), ["diameter_cm"] = 50 };
        // Подбор
        var res = await _api.Http.PostAsync($"/api/images/{id}/auto-tone",
            // тело JSON
            new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"));
        // → 200
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        // Результат
        var t = await ApiFixture.Json(res);
        // Не хуже
        Assert.True(t["score_after"]!.GetValue<double>() >= t["score_before"]!.GetValue<double>());
        // 6 вариантов
        Assert.Equal(6, t["candidates"]!.GetValue<int>());
        // Яркость в границах
        Assert.InRange(t["brightness"]!.GetValue<double>(), -0.5, 0.5);
        // Диаметр 5
        var bad = await _api.Http.PostAsync($"/api/images/{id}/auto-tone",
            // тело
            new StringContent("{\"diameter_cm\": 5}", Encoding.UTF8, "application/json"));
        // → 422
        Assert.Equal((HttpStatusCode)422, bad.StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-31 шаблон разметки 1:1")]
    // Шаблон разметки
    public async Task TemplatePdf()
    {
        // Создаём
        var p = await _api.CreateProject();
        // id
        var id = p["id"]!.GetValue<string>();
        // Скачиваем
        var res = await _api.Http.GetAsync($"/api/projects/{id}/template.pdf");
        // → 200
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        // Тип PDF
        Assert.Equal("application/pdf", res.Content.Headers.ContentType!.MediaType);
        // Байты
        var bytes = await res.Content.ReadAsByteArrayAsync();
        // Сигнатура
        Assert.Equal("%PDF", Encoding.ASCII.GetString(bytes, 0, 4));
        // Диаметр 10 → 422
        Assert.Equal((HttpStatusCode)422, (await _api.Http.GetAsync("/api/template.pdf?diameter_cm=10")).StatusCode);
    }

    // Тест
    [Fact(DisplayName = "TC-API-30 время плетения и своя катушка")]
    // Время и катушка
    public async Task ActivityAndSpool()
    {
        // Создаём
        var p = await _api.CreateProject();
        // id
        var id = p["id"]!.GetValue<string>();
        // Помощник: записать время и разобрать ответ
        async Task<JsonNode> Post(object body) => await ApiFixture.Json(await _api.Http.PostAsync($"/api/projects/{id}/activity",
            // тело JSON
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json")));
        // 30 с, 12 шагов
        await Post(new { date = "2026-10-27", seconds = 30, steps = 12 });
        // 30 с, 8 шагов на другой день
        var a = await Post(new { date = "2026-10-28", seconds = 30, steps = 8 });
        // Всего 60 с
        Assert.Equal(60.0, a["total_sec"]!.GetValue<double>());
        // 20 шагов
        Assert.Equal(20, a["total_steps"]!.GetValue<int>());
        // Своя катушка 300 м
        var patched = await ApiFixture.Json(await _api.Patch(id, new { own_spool_m = 300 }));
        // Сохранилась
        Assert.Equal(300.0, patched["own_spool_m"]!.GetValue<double>());
    }
}
