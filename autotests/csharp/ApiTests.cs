// API-тесты на C#: xUnit + HttpClient + System.Text.Json.
// Запуск: STRINGART_API=http://127.0.0.1:8000 dotnet test
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Xunit;

namespace StringArt.ApiTests;

public sealed class ApiFixture : IDisposable
{
    public HttpClient Http { get; }
    public string Fixtures { get; }
    private readonly List<string> _created = new();

    public ApiFixture()
    {
        var baseUrl = Environment.GetEnvironmentVariable("STRINGART_API") ?? "http://127.0.0.1:8000";
        Http = new HttpClient { BaseAddress = new Uri(baseUrl), Timeout = TimeSpan.FromSeconds(60) };
        Fixtures = Environment.GetEnvironmentVariable("STRINGART_FIXTURES")
                   ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "fixtures"));
    }

    public async Task<HttpResponseMessage> Upload(string? fileName, string mime, byte[]? content, Dictionary<string, string> fields)
    {
        using var form = new MultipartFormDataContent();
        if (content is not null && fileName is not null)
        {
            var file = new ByteArrayContent(content);
            file.Headers.ContentType = new MediaTypeHeaderValue(mime);
            form.Add(file, "file", fileName);
        }
        foreach (var (k, v) in fields) form.Add(new StringContent(v, Encoding.UTF8), k);
        return await Http.PostAsync("/api/projects", form);
    }

    public async Task<JsonNode> CreateProject(string? name = "C#-тест", string diameter = "50")
    {
        var fields = new Dictionary<string, string> { ["diameter_cm"] = diameter };
        if (name is not null) fields["name"] = name;
        var res = await Upload("portrait.jpg", "image/jpeg", Bytes("portrait.jpg"), fields);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var node = await Json(res);
        lock (_created) _created.Add(node["id"]!.GetValue<string>());
        return node;
    }

    public byte[] Bytes(string name) => File.ReadAllBytes(Path.Combine(Fixtures, name));

    public Task<HttpResponseMessage> Patch(string id, object body) =>
        Http.PatchAsync($"/api/projects/{id}",
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));

    public static async Task<JsonNode> Json(HttpResponseMessage res) =>
        JsonNode.Parse(await res.Content.ReadAsStringAsync())!;

    public void Dispose()
    {
        foreach (var id in _created) Http.DeleteAsync($"/api/projects/{id}").GetAwaiter().GetResult();
        Http.Dispose();
    }
}

public class ApiTests : IClassFixture<ApiFixture>
{
    private readonly ApiFixture _api;
    public ApiTests(ApiFixture api) => _api = api;

    [Fact(DisplayName = "TC-API-01 health")]
    public async Task Health()
    {
        var res = await _api.Http.GetAsync("/api/health");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("ok", (await ApiFixture.Json(res))["status"]!.GetValue<string>());
    }

    [Fact(DisplayName = "TC-API-02 config")]
    public async Task Config()
    {
        var cfg = await ApiFixture.Json(await _api.Http.GetAsync("/api/config"));
        Assert.Equal(new[] { "A", "B", "C", "D" }, cfg["sectors"]!.AsArray().Select(n => n!.GetValue<string>()));
        Assert.Equal(60, cfg["nails_per_sector"]!.GetValue<int>());
        Assert.Equal(new[] { 30, 40, 50, 60, 70 }, cfg["diameter"]!["presets_cm"]!.AsArray().Select(n => n!.GetValue<int>()));
        Assert.Equal(2.0, cfg["speed"]!["default_sec"]!.GetValue<double>());
        Assert.Equal(0.1, cfg["speed"]!["step_sec"]!.GetValue<double>());
        Assert.Equal(0.15, cfg["thread"]!["margin"]!.GetValue<double>());
    }

    [Fact(DisplayName = "TC-API-03 создание проекта")]
    public async Task Create()
    {
        var p = await _api.CreateProject("Тестовый портрет");
        Assert.Matches("^[0-9a-f]{12}$", p["id"]!.GetValue<string>());
        Assert.Equal("Тестовый портрет", p["name"]!.GetValue<string>());
        Assert.InRange(p["line_count"]!.GetValue<int>(), 1000, 5000);
        var sim = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{p["id"]!.GetValue<string>()}/similarity"));
        Assert.Equal(sim["best_lines"]!.GetValue<int>(), p["line_count"]!.GetValue<int>());
        Assert.Equal(1, p["current_step"]!.GetValue<int>());
        var seq = p["sequence"]!.AsArray();
        Assert.Equal(5001, seq.Count);
        Assert.Equal(0, seq[0]!.GetValue<int>());
        var raw = p["stats"]!["raw_length_m"]!.GetValue<double>();
        var total = p["stats"]!["total_length_m"]!.GetValue<double>();
        Assert.InRange(total, raw * 1.15 - 0.1, raw * 1.15 + 0.1);
        Assert.True(p["stats"]!["spool_m"]!.GetValue<int>() * p["stats"]!["spool_count"]!.GetValue<int>() >= total);
    }

    [Fact(DisplayName = "TC-API-04 PNG, имя из файла, 70 см")]
    public async Task PngUsesFileName()
    {
        var res = await _api.Upload("portrait.png", "image/png", _api.Bytes("portrait.png"),
            new() { ["diameter_cm"] = "70" });
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var p = await ApiFixture.Json(res);
        await _api.Http.DeleteAsync($"/api/projects/{p["id"]!.GetValue<string>()}");
        Assert.Equal("portrait", p["name"]!.GetValue<string>());
        Assert.InRange(p["line_count"]!.GetValue<int>(), 1000, 5000);
    }

    [Theory(DisplayName = "TC-API-05/06 валидация загрузки")]
    [InlineData("empty", "50", 400)]
    [InlineData("text", "50", 400)]
    [InlineData("jpg", "19.9", 422)]
    [InlineData("jpg", "150.1", 422)]
    [InlineData("jpg", "abc", 422)]
    [InlineData("none", "50", 422)]
    public async Task UploadValidation(string kind, string diameter, int status)
    {
        byte[]? content = kind switch
        {
            "empty" => Array.Empty<byte>(),
            "text" => _api.Bytes("not-an-image.txt"),
            "jpg" => _api.Bytes("portrait.jpg"),
            _ => null,
        };
        var res = await _api.Upload("x.jpg", "application/octet-stream", content, new() { ["diameter_cm"] = diameter });
        Assert.Equal(status, (int)res.StatusCode);
    }

    [Theory(DisplayName = "TC-API-08 неизвестный проект — 404")]
    [InlineData("000000000000")]
    [InlineData("nope")]
    public async Task NotFound(string id) =>
        Assert.Equal(HttpStatusCode.NotFound, (await _api.Http.GetAsync($"/api/projects/{id}")).StatusCode);

    [Fact(DisplayName = "TC-API-09/10 шаг и скорость")]
    public async Task ProgressAndSpeed()
    {
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.OK, (await _api.Patch(id, new { current_step = 137 })).StatusCode);
        var p = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}"));
        Assert.Equal(137, p["current_step"]!.GetValue<int>());
        foreach (var (sent, saved) in new[] { (2.1, 2.1), (1.9, 1.9), (2.04999, 2.0), (0.5, 0.5), (10.0, 10.0) })
        {
            var body = await ApiFixture.Json(await _api.Patch(id, new { speed_sec = sent }));
            Assert.Equal(saved, body["speed_sec"]!.GetValue<double>());
        }
    }

    public static IEnumerable<object[]> BadPatches() => new[]
    {
        new object[] { new { speed_sec = 0.4 } },
        new object[] { new { speed_sec = 10.1 } },
        new object[] { new { current_step = 0 } },
        new object[] { new { current_step = 2001 } },
        new object[] { new { line_count = 999 } },
        new object[] { new { line_count = 5001 } },
        new object[] { new { diameter_cm = 10 } },
        new object[] { new { name = "  " } },
        new object[] { new { sequence = new[] { 1, 2, 3 } } },
    };

    [Theory(DisplayName = "TC-API-11 PATCH отклоняет невалидное")]
    [MemberData(nameof(BadPatches))]
    public async Task PatchValidation(object body)
    {
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        await _api.Patch(id, new { line_count = 2000 });
        Assert.Equal(422, (int)(await _api.Patch(id, body)).StatusCode);
    }

    [Fact(DisplayName = "TC-API-12 уменьшение линий подтягивает шаг")]
    public async Task ClampProgress()
    {
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        await _api.Patch(id, new { line_count = 2000 });
        await _api.Patch(id, new { current_step = 1900 });
        var body = await ApiFixture.Json(await _api.Patch(id, new { line_count = 1500 }));
        Assert.Equal(1500, body["current_step"]!.GetValue<int>());
    }

    [Fact(DisplayName = "TC-API-14 шаги непрерывны")]
    public async Task Steps()
    {
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        var page = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/steps?offset=0&limit=50"));
        var items = page["items"]!.AsArray();
        Assert.Equal("A1", items[0]!["from_label"]!.GetValue<string>());
        for (var i = 1; i < items.Count; i++)
            Assert.Equal(items[i - 1]!["to_nail"]!.GetValue<int>(), items[i]!["from_nail"]!.GetValue<int>());
    }

    [Fact(DisplayName = "TC-API-16 PDF")]
    public async Task Pdf()
    {
        var id = (await _api.CreateProject())["id"]!.GetValue<string>();
        await _api.Patch(id, new { line_count = 1000 });
        var res = await _api.Http.GetAsync($"/api/projects/{id}/instructions.pdf");
        Assert.Equal("application/pdf", res.Content.Headers.ContentType!.MediaType);
        var bytes = await res.Content.ReadAsByteArrayAsync();
        var latin = Encoding.Latin1.GetString(bytes);
        Assert.StartsWith("%PDF", latin);
        Assert.Equal(7, Regex.Matches(latin, @"/Type\s*/Page[^s]").Count);
    }

    [Fact(DisplayName = "TC-API-17 удаление")]
    public async Task Delete()
    {
        var res = await _api.Upload("portrait.jpg", "image/jpeg", _api.Bytes("portrait.jpg"), new());
        var id = (await ApiFixture.Json(res))["id"]!.GetValue<string>();
        Assert.Equal(HttpStatusCode.NoContent, (await _api.Http.DeleteAsync($"/api/projects/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _api.Http.GetAsync($"/api/projects/{id}")).StatusCode);
    }

    [Theory(DisplayName = "TC-API-18 шаг гвоздей по диаметру")]
    [InlineData(30, 3.93, 1200)]
    [InlineData(50, 6.54, 2000)]
    [InlineData(70, 9.16, 2800)]
    public async Task Geometry(int d, double spacing, int lines)
    {
        var g = await ApiFixture.Json(await _api.Http.GetAsync($"/api/geometry?diameter_cm={d}"));
        Assert.Equal(spacing, g["nail_spacing_mm"]!.GetValue<double>());
        Assert.Equal(lines, g["recommended_lines"]!.GetValue<int>());
    }

    private async Task<JsonNode> UploadFace()
    {
        using var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(_api.Bytes("face.jpg"));
        file.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(file, "file", "face.jpg");
        var res = await _api.Http.PostAsync("/api/images", form);
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        return await ApiFixture.Json(res);
    }

    [Fact(DisplayName = "TC-API-19 загрузка фото и поиск лица")]
    public async Task UploadImage()
    {
        var img = await UploadFace();
        Assert.Equal(512, img["width"]!.GetValue<int>());
        Assert.NotEmpty(img["faces"]!.AsArray());
        Assert.True(img["face_prep"]!["face_focus"]!.GetValue<bool>());
    }

    [Fact(DisplayName = "TC-API-21/23 портрет из фото и правка фото")]
    public async Task CreateFromImageAndEdit()
    {
        var img = await UploadFace();
        var body = new { image_id = img["id"]!.GetValue<string>(), name = "C#", prep = new { zoom = 2, center_x = 0.45, center_y = 0.3 } };
        var res = await _api.Http.PostAsync("/api/projects/from-image",
            new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var p = await ApiFixture.Json(res);
        var id = p["id"]!.GetValue<string>();
        try
        {
            Assert.Equal(2.0, p["prep"]!["zoom"]!.GetValue<double>());
            await _api.Patch(id, new { current_step = 99 });
            var put = await _api.Http.PutAsync($"/api/projects/{id}/photo",
                new StringContent(img["face_prep"]!.ToJsonString(), Encoding.UTF8, "application/json"));
            var upd = await ApiFixture.Json(put);
            Assert.Equal(1, upd["current_step"]!.GetValue<int>());
            Assert.True(upd["prep"]!["face_focus"]!.GetValue<bool>());
        }
        finally
        {
            await _api.Http.DeleteAsync($"/api/projects/{id}");
        }
    }

    [Fact(DisplayName = "TC-API-26 рекомендация по максимуму сходства")]
    public async Task Similarity()
    {
        var p = await _api.CreateProject();
        var id = p["id"]!.GetValue<string>();
        var sim = await ApiFixture.Json(await _api.Http.GetAsync($"/api/projects/{id}/similarity"));
        var scores = sim["curve"]!.AsArray().Select(x => x!["score"]!.GetValue<double>()).ToList();
        Assert.Equal(41, scores.Count);
        Assert.Equal(scores.Max(), sim["best_score"]!.GetValue<double>(), 6);
        Assert.Equal(p["line_count"]!.GetValue<int>(), sim["best_lines"]!.GetValue<int>());
    }

    [Fact(DisplayName = "TC-API-27 автонастройка фото")]
    public async Task AutoTone()
    {
        var img = await UploadFace();
        var id = img["id"]!.GetValue<string>();
        var body = new JsonObject { ["prep"] = img["face_prep"]!.DeepClone(), ["diameter_cm"] = 50 };
        var res = await _api.Http.PostAsync($"/api/images/{id}/auto-tone",
            new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var t = await ApiFixture.Json(res);
        Assert.True(t["score_after"]!.GetValue<double>() >= t["score_before"]!.GetValue<double>());
        Assert.Equal(6, t["candidates"]!.GetValue<int>());
        Assert.InRange(t["brightness"]!.GetValue<double>(), -0.5, 0.5);
        var bad = await _api.Http.PostAsync($"/api/images/{id}/auto-tone",
            new StringContent("{\"diameter_cm\": 5}", Encoding.UTF8, "application/json"));
        Assert.Equal((HttpStatusCode)422, bad.StatusCode);
    }
}
