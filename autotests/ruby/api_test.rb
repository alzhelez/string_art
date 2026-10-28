# frozen_string_literal: true
# Строки в файле неизменяемы — быстрее и без случайных правок; эта строка-пояснение стоит ПОСЛЕ «магического» комментария, чтобы он работал

# API-тесты на Ruby: Minitest + Net::HTTP (обе библиотеки идут вместе с Ruby, gem install не нужен).
# Запуск: STRINGART_API=http://127.0.0.1:8000 ruby api_test.rb

# Minitest: сам запускает тесты при выходе из программы
require 'minitest/autorun'
# Net::HTTP — HTTP-клиент из стандартной библиотеки
require 'net/http'
# Разбор и сборка JSON
require 'json'
# Разбор адреса бэкенда
require 'uri'
# Dir.tmpdir — временная папка для пустого файла
require 'tmpdir'

# Адрес бэкенда из переменной или локальный
BASE = URI(ENV.fetch('STRINGART_API', 'http://127.0.0.1:8000'))
# Папка фикстур из переменной или соседняя
FIXTURES = File.expand_path(ENV.fetch('STRINGART_FIXTURES', File.join(__dir__, '..', 'fixtures')))

# Модуль с короткими функциями для запросов
module Api
  # Функции модуля вызываются как Api.get(...)
  module_function

  # Открыть соединение и выполнить блок
  def http
    # Таймаут чтения 60 с — расчёт схемы может быть долгим
    Net::HTTP.start(BASE.host, BASE.port, read_timeout: 60) { |h| yield h }
  end

  # GET
  def get(path)
    # Отправляем
    http { |h| h.get(path) }
  end

  # DELETE
  def delete(path)
    # Отправляем
    http { |h| h.delete(path) }
  end

  # PATCH с телом JSON
  def patch(path, body)
    # Отправляем тело и заголовок
    http { |h| h.patch(path, JSON.generate(body), 'Content-Type' => 'application/json') }
  end

  # fields: [['name', 'значение'], ...]; file: [path, mime] или nil
  # Загрузка проекта формой
  def upload(file: nil, fields: {})
    # Запрос на /api/projects
    req = Net::HTTP::Post.new('/api/projects')
    # .b — байты UTF-8 как binary, иначе Net::HTTP не склеит кириллицу с бинарным файлом
    # Поля формы
    form = fields.map { |k, v| [k.to_s, v.to_s.b] }
    # Если есть файл —
    if file
      # — путь и тип
      path, mime = file
      # — добавляем в форму с именем и типом
      form << ['file', File.binread(path), { filename: File.basename(path), content_type: mime }]
    end
    # Форма multipart в UTF-8
    req.set_form(form, 'multipart/form-data', charset: 'UTF-8')
    # Отправляем
    http { |h| h.request(req) }
  end

  # Разобрать JSON из ответа
  def json(res)
    # Тело ответа
    JSON.parse(res.body)
  end

  # POST с JSON-телом
  # Отправить JSON методом POST
  def post_json(path, body)
    # Тело и заголовок
    http { |h| h.post(path, JSON.generate(body), 'Content-Type' => 'application/json') }
  end

  # Загрузка фото в редактор (POST /api/images)
  # Загрузить фото из фикстур в редактор
  def upload_image(name, mime)
    # Запрос
    req = Net::HTTP::Post.new('/api/images')
    # Форма с файлом
    req.set_form([['file', File.binread(File.join(FIXTURES, name)), { filename: name, content_type: mime }]], 'multipart/form-data')
    # Отправляем
    http { |h| h.request(req) }
  end
end

# Класс тестов: каждый метод test_… — отдельный тест
class StringArtApiTest < Minitest::Test
  # Портрет в JPEG — файл и тип
  JPG = [File.join(FIXTURES, 'portrait.jpg'), 'image/jpeg'].freeze

  # Перед каждым тестом —
  def setup
    # — пустой список созданных проектов
    @created = []
  end

  # После каждого теста —
  def teardown
    # — удаляем всё созданное
    @created.each { |id| Api.delete("/api/projects/#{id}") }
  end

  # Помощник: создать проект и запомнить для удаления
  def create_project(name: 'Ruby-тест', diameter: '50')
    # Загружаем портрет
    res = Api.upload(file: JPG, fields: { name: name, diameter_cm: diameter })
    # Ожидаем 201; при ошибке — тело ответа
    assert_equal '201', res.code, res.body
    # Разбираем и запоминаем id
    Api.json(res).tap { |p| @created << p['id'] }
  end

  # TC-API-01: сервер жив
  def test_tc_api_01_health
    # Запрос
    res = Api.get('/api/health')
    # → 200
    assert_equal '200', res.code
    # Тело
    assert_equal({ 'status' => 'ok' }, Api.json(res))
  end

  # TC-API-02: настройки
  def test_tc_api_02_config
    # Получаем
    cfg = Api.json(Api.get('/api/config'))
    # Четыре сектора
    assert_equal %w[A B C D], cfg['sectors']
    # 60 гвоздей в секторе
    assert_equal 60, cfg['nails_per_sector']
    # Готовые диаметры
    assert_equal [30, 40, 50, 60, 70], cfg.dig('diameter', 'presets_cm')
    # Скорость
    assert_equal({ 'default_sec' => 2.0, 'step_sec' => 0.1, 'min_sec' => 0.5, 'max_sec' => 10.0 }, cfg['speed'])
    # Запас лески
    assert_equal 0.15, cfg.dig('thread', 'margin')
  end

  # TC-API-03: создание проекта
  def test_tc_api_03_create
    # Создаём
    p = create_project(name: 'Тестовый портрет')
    # id из 12 шестнадцатеричных символов
    assert_match(/\A[0-9a-f]{12}\z/, p['id'])
    # Название
    assert_equal 'Тестовый портрет', p['name']
    # Число нитей в границах
    assert_includes 1000..5000, p['line_count']
    # И это лучшее по кривой сходства
    assert_equal Api.json(Api.get("/api/projects/#{p['id']}/similarity"))['best_lines'], p['line_count']
    # Шаг 1
    assert_equal 1, p['current_step']
    # Скорость 2
    assert_equal 2.0, p['speed_sec']
    # Схема на 5000 нитей
    assert_equal 5001, p['sequence'].size
    # Начало A1
    assert_equal 0, p['sequence'].first
    # Расчёт лески
    stats = p['stats']
    # Запас 15 %
    assert_in_delta stats['raw_length_m'] * 1.15, stats['total_length_m'], 0.1
    # Катушек хватает
    assert_operator stats['spool_m'] * stats['spool_count'], :>=, stats['total_length_m']
  end

  # TC-API-04: PNG с прозрачностью без названия
  def test_tc_api_04_png_and_filename
    # Загружаем на 70 см
    res = Api.upload(file: [File.join(FIXTURES, 'portrait.png'), 'image/png'], fields: { diameter_cm: 70 })
    # → 201
    assert_equal '201', res.code
    # Разбираем
    p = Api.json(res)
    # Запоминаем для удаления
    @created << p['id']
    # Название — имя файла
    assert_equal 'portrait', p['name']
    # Нитей в границах
    assert_includes 1000..5000, p['line_count']
  end

  # TC-API-05/06: таблица неверных загрузок — название, вид файла, диаметр, статус
  {
    # пустой файл
    'empty' => [:empty, '50', '400'],
    # текст
    'not_image' => [:text, '50', '400'],
    # диаметр меньше 20
    'diameter_19_9' => [:jpg, '19.9', '422'],
    # больше 150
    'diameter_150_1' => [:jpg, '150.1', '422'],
    # не число
    'diameter_abc' => [:jpg, 'abc', '422'],
    # файла нет
    'no_file' => [nil, '50', '422']
  # Перебираем строки таблицы
  }.each do |title, (kind, diameter, status)|
    # Для каждой строки создаём отдельный тест
    define_method("test_tc_api_05_upload_validation_#{title}") do
      # Файл по виду из таблицы:
      file = case kind
             # пустой — создаём во временной папке
             when :empty then [File.join(Dir.tmpdir, 'stringart-empty.jpg').tap { |f| File.write(f, '') }, 'image/jpeg']
             # текст — фикстура
             when :text then [File.join(FIXTURES, 'not-an-image.txt'), 'text/plain']
             # jpg — портрет
             when :jpg then JPG
             end
      # Загружаем
      res = Api.upload(file: file, fields: { diameter_cm: diameter })
      # Статус как в таблице
      assert_equal status, res.code, res.body
    # В любом случае —
    ensure
      # — путь к пустому файлу
      empty = File.join(Dir.tmpdir, 'stringart-empty.jpg')
      # — удаляем его, если создавали
      File.delete(empty) if File.exist?(empty)
    end
  end

  # TC-API-07/08: список и неизвестные проекты
  def test_tc_api_07_08_list_and_not_found
    # Создаём
    p = create_project
    # Ищем в списке
    item = Api.json(Api.get('/api/projects')).find { |i| i['id'] == p['id'] }
    # Нашёлся
    refute_nil item
    # Без схемы
    refute item.key?('sequence')
    # Неизвестные id —
    %w[000000000000 nope ABCDEF123456].each do |id|
      # — 404
      assert_equal '404', Api.get("/api/projects/#{id}").code
    end
  end

  # TC-API-09/10: шаг и скорость
  def test_tc_api_09_10_progress_and_speed
    # Создаём
    p = create_project
    # Шаг 137
    assert_equal '200', Api.patch("/api/projects/#{p['id']}", current_step: 137).code
    # Сохранился
    assert_equal 137, Api.json(Api.get("/api/projects/#{p['id']}"))['current_step']
    # Пары «отправили — сохранилось»
    [[2.1, 2.1], [1.9, 1.9], [2.04999, 2.0], [0.5, 0.5], [10, 10.0]].each do |sent, saved|
      # Скорость округлена до 0,1
      assert_equal saved, Api.json(Api.patch("/api/projects/#{p['id']}", speed_sec: sent))['speed_sec']
    end
  end

  # TC-API-11: неверные изменения
  def test_tc_api_11_patch_validation
    # Создаём
    p = create_project
    # 2000 нитей
    Api.patch("/api/projects/#{p['id']}", line_count: 2000)
    # Скорость, шаг вне границ;
    [{ speed_sec: 0.4 }, { speed_sec: 10.1 }, { current_step: 0 }, { current_step: 2001 },
     # число нитей, диаметр, пустые названия;
     { line_count: 999 }, { line_count: 5001 }, { diameter_cm: 10 }, { name: '' }, { name: '   ' },
     # и схема —
     { sequence: [1, 2, 3] }].each do |body|
      # — все → 422
      assert_equal '422', Api.patch("/api/projects/#{p['id']}", body).code, body.inspect
    end
  end

  # TC-API-12/13: нити и диаметр
  def test_tc_api_12_13_lines_and_diameter
    # Создаём и ставим 2000 нитей
    p = Api.json(Api.patch("/api/projects/#{create_project['id']}", line_count: 2000))
    # Шаг 1900
    Api.patch("/api/projects/#{p['id']}", current_step: 1900)
    # Уменьшаем до 1500
    clamped = Api.json(Api.patch("/api/projects/#{p['id']}", line_count: 1500))
    # Шаг прижат
    assert_equal 1500, clamped['current_step']
    # 2000 нитей, диаметр 100
    big = Api.json(Api.patch("/api/projects/#{p['id']}", line_count: 2000, diameter_cm: 100))
    # Схема та же
    assert_equal p['sequence'], big['sequence']
    # Леска вдвое длиннее
    assert_in_delta p.dig('stats', 'raw_length_m') * 2, big.dig('stats', 'raw_length_m'), 0.1
  end

  # TC-API-14: шаги частями
  def test_tc_api_14_steps
    # Создаём
    p = create_project
    # 2000 нитей
    Api.patch("/api/projects/#{p['id']}", line_count: 2000)
    # Первые 50
    page = Api.json(Api.get("/api/projects/#{p['id']}/steps?offset=0&limit=50"))
    # Всего 2000
    assert_equal 2000, page['total']
    # Начало A1
    assert_equal 'A1', page['items'].first['from_label']
    # Соседние шаги —
    page['items'].each_cons(2) do |a, b|
      # — без разрыва
      assert_equal a['to_nail'], b['from_nail']
      # — расход растёт
      assert_operator b['thread_used_m'], :>, a['thread_used_m']
    end
    # За концом
    tail = Api.json(Api.get("/api/projects/#{p['id']}/steps?offset=1990&limit=50"))
    # Последние 10
    assert_equal (1991..2000).to_a, tail['items'].map { |s| s['number'] }
  end

  # TC-API-15: превью и исходник
  def test_tc_api_15_images
    # Создаём
    p = create_project
    # Оба адреса
    %w[/preview.png?size=300 /source.png].each do |suffix|
      # Запрос
      res = Api.get("/api/projects/#{p['id']}#{suffix}")
      # → 200
      assert_equal '200', res.code
      # Тип PNG
      assert_equal 'image/png', res['Content-Type']
      # Сигнатура PNG
      assert res.body.b.start_with?("\x89PNG".b)
    end
    # Маленькое превью → 422
    assert_equal '422', Api.get("/api/projects/#{p['id']}/preview.png?size=50").code
  end

  # TC-API-16: PDF
  def test_tc_api_16_pdf
    # Создаём
    p = create_project
    # 1000 нитей
    Api.patch("/api/projects/#{p['id']}", line_count: 1000)
    # Скачиваем
    res = Api.get("/api/projects/#{p['id']}/instructions.pdf")
    # → 200
    assert_equal '200', res.code
    # Тип PDF
    assert_equal 'application/pdf', res['Content-Type']
    # Имя файла в UTF-8
    assert_includes res['Content-Disposition'], "filename*=UTF-8''"
    # Байты
    body = res.body.b
    # Сигнатура
    assert body.start_with?('%PDF')
    # 7 страниц
    assert_equal 7, body.scan(%r{/Type\s*/Page[^s]}n).size
  end

  # TC-API-17: удаление
  def test_tc_api_17_delete
    # Загружаем
    res = Api.upload(file: JPG)
    # id
    id = Api.json(res)['id']
    # Удаляем → 204
    assert_equal '204', Api.delete("/api/projects/#{id}").code
    # Читаем → 404
    assert_equal '404', Api.get("/api/projects/#{id}").code
    # Удаляем снова → 404
    assert_equal '404', Api.delete("/api/projects/#{id}").code
  end

  # TC-API-18: геометрия
  def test_tc_api_18_geometry
    # Диаметр → расстояние и нити
    { 30 => [3.93, 1200], 50 => [6.54, 2000], 70 => [9.16, 2800] }.each do |d, (spacing, lines)|
      # Запрос
      g = Api.json(Api.get("/api/geometry?diameter_cm=#{d}"))
      # Расстояние
      assert_equal spacing, g['nail_spacing_mm']
      # Нити
      assert_equal lines, g['recommended_lines']
    end
  end

  # TC-API-19: фото в редакторе (этот метод вызывают и другие тесты)
  def test_tc_api_19_image_upload
    # Запрос
    req = Net::HTTP::Post.new('/api/images')
    # Форма с фото
    req.set_form([['file', File.binread(File.join(FIXTURES, 'face.jpg')), { filename: 'face.jpg', content_type: 'image/jpeg' }]], 'multipart/form-data')
    # Отправляем и разбираем
    img = Api.json(Api.http { |h| h.request(req) })
    # Ширина
    assert_equal 512, img['width']
    # Лицо нашлось
    refute_empty img['faces']
    # Готовый кадр лица
    assert_equal true, img.dig('face_prep', 'face_focus')
    # Исходник — JPEG
    assert_equal 'image/jpeg', Api.get("/api/images/#{img['id']}/original.jpg")['Content-Type']
    # Запоминаем для других тестов
    @image = img
  end

  # TC-API-21/23: портрет из фото и правка фото
  def test_tc_api_21_23_from_image_and_edit_photo
    # Загружаем фото
    test_tc_api_19_image_upload
    # Создаём проект —
    res = Api.http do |h|
      # — запрос
      h.post('/api/projects/from-image',
             # — тело
             JSON.generate(image_id: @image['id'], name: 'Ruby', prep: { zoom: 2, center_x: 0.45, center_y: 0.3 }),
             # — заголовок
             'Content-Type' => 'application/json')
    end
    # → 201
    assert_equal '201', res.code, res.body
    # Разбираем
    p = Api.json(res)
    # Запоминаем для удаления
    @created << p['id']
    # Зум сохранился
    assert_equal 2.0, p.dig('prep', 'zoom')
    # Шаг 99
    Api.patch("/api/projects/#{p['id']}", current_step: 99)
    # Меняем кадр —
    upd = Api.http do |h|
      # — на «Выделить лицо»
      h.put("/api/projects/#{p['id']}/photo", JSON.generate(@image['face_prep']), 'Content-Type' => 'application/json')
    end
    # → 200
    assert_equal '200', upd.code, upd.body
    # Разбираем
    body = Api.json(upd)
    # Шаг сброшен
    assert_equal 1, body['current_step']
    # Флажок стоит
    assert_equal true, body.dig('prep', 'face_focus')
    # Схема новая
    refute_equal p['sequence'], body['sequence']
  end

  # TC-API-26: кривая сходства
  def test_tc_api_26_similarity
    # Создаём
    p = create_project
    # Кривая
    sim = Api.json(Api.get("/api/projects/#{p['id']}/similarity"))
    # Рекомендация совпадает
    assert_equal p['line_count'], sim['best_lines']
    # 41 точка
    assert_equal 41, sim['curve'].size
    # Лучшее сходство — максимум кривой
    assert_equal sim['best_score'], sim['curve'].map { |x| x['score'] }.max
    # Для 30 см
    small = Api.json(Api.get("/api/projects/#{p['id']}/similarity?diameter_cm=30"))
    # Рекомендация не больше
    assert_operator small['best_lines'], :<=, sim['best_lines']
  end

  # TC-API-27: автонастройка
  def test_tc_api_27_auto_tone
    # Загружаем фото
    test_tc_api_19_image_upload
    # Помощник: POST автонастройки
    post = lambda do |body|
      # Запрос
      Api.http { |h| h.post("/api/images/#{@image['id']}/auto-tone", JSON.generate(body), 'Content-Type' => 'application/json') }
    end
    # Подбор
    res = post.call(prep: @image['face_prep'], diameter_cm: 50)
    # → 200
    assert_equal '200', res.code, res.body
    # Результат
    t = Api.json(res)
    # Не хуже
    assert_operator t['score_after'], :>=, t['score_before']
    # 6 вариантов
    assert_equal 6, t['candidates']
    # Яркость в границах
    assert_includes(-0.5..0.5, t['brightness'])
    # Диаметр 5 → 422
    assert_equal '422', post.call(diameter_cm: 5).code
  end

  # TC-API-31: шаблон разметки
  def test_tc_api_31_template_pdf
    # Создаём
    p = create_project
    # Скачиваем шаблон
    res = Api.get("/api/projects/#{p['id']}/template.pdf")
    # → 200
    assert_equal '200', res.code
    # Тип PDF
    assert_equal 'application/pdf', res['Content-Type']
    # Сигнатура
    assert res.body.start_with?('%PDF')
    # Диаметр 10 → 422
    assert_equal '422', Api.get('/api/template.pdf?diameter_cm=10').code
  end

  # TC-API-30: время и катушка
  def test_tc_api_30_activity_and_spool
    # Создаём
    p = create_project
    # Помощник: записать время
    post = lambda do |body|
      # Запрос
      Api.http { |h| h.post("/api/projects/#{p['id']}/activity", JSON.generate(body), 'Content-Type' => 'application/json') }
    end
    # 20 с, 5 шагов
    post.call(date: '2026-10-27', seconds: 20, steps: 5)
    # 40 с, 10 шагов на другой день
    act = Api.json(post.call(date: '2026-10-28', seconds: 40, steps: 10))
    # Всего 60 с
    assert_equal 60.0, act['total_sec']
    # 15 шагов
    assert_equal 15, act['total_steps']
    # Два дня
    assert_equal %w[2026-10-27 2026-10-28], act['days'].map { |d| d['date'] }
    # Своя катушка сохраняется
    assert_equal 300.0, Api.json(Api.patch("/api/projects/#{p['id']}", own_spool_m: 300))['own_spool_m']
  end

  # TC-API-20: подготовленный кадр
  def test_tc_api_20_prepared_image
    # Загружаем фото
    img = Api.json(Api.upload_image('face.jpg', 'image/jpeg'))
    # Адрес кадра
    base = "/api/images/#{img['id']}/prepared.png"
    # Без правок
    plain = Api.get(base)
    # → 200
    assert_equal '200', plain.code
    # Тип PNG
    assert_equal 'image/png', plain['Content-Type']
    # Ширина и высота PNG — байты 16..23 заголовка IHDR
    # 400×400
    assert_equal [400, 400], plain.body.byteslice(16, 8).unpack('NN')
    # Яркость меняет кадр
    refute_equal plain.body, Api.get("#{base}?brightness=0.3").body
    # Зум меняет кадр
    refute_equal plain.body, Api.get("#{base}?zoom=3&center_x=0.43").body
    # Зум 5 → 422
    assert_equal '422', Api.get("#{base}?zoom=5").code
  end

  # TC-API-22: «Выделить лицо»
  def test_tc_api_22_face_focus
    # Загружаем фото
    img = Api.json(Api.upload_image('face.jpg', 'image/jpeg'))
    # Создаём с кадром лица
    res = Api.post_json('/api/projects/from-image', image_id: img['id'], name: 'Ruby: лицо', prep: img['face_prep'])
    # → 201
    assert_equal '201', res.code, res.body
    # Запоминаем для удаления
    @created << Api.json(res)['id']
    # Флажок сохранён
    assert_equal true, Api.json(res).dig('prep', 'face_focus')
    # Однотонная картинка
    blank = Api.json(Api.upload_image('blank.png', 'image/png'))
    # Лиц нет
    assert_empty blank['faces']
    # Просим «Выделить лицо»
    bad = Api.post_json('/api/projects/from-image', image_id: blank['id'], prep: { face_focus: true })
    # → 422
    assert_equal '422', bad.code
    # Текст про лицо
    assert_match(/лицо/, Api.json(bad)['detail'])
  end

  # TC-API-25: корень бэкенда
  def test_tc_api_25_root_redirect
    # Запрос
    res = Api.get('/')
    # обычный режим — перенаправление на фронтенд, программа для Windows — сама страница
    # 307 или 200
    assert_includes %w[307 200], res.code
    # У перенаправления есть адрес
    refute_nil res['Location'] if res.code == '307'
    # Иконка без ошибки
    assert_includes %w[204 200], Api.get('/favicon.ico').code
  end

  # TC-API-28: маска кистью
  def test_tc_api_28_mask_brush
    # Загружаем фото
    img = Api.json(Api.upload_image('face.jpg', 'image/jpeg'))
    # Помощник: отправить маску
    put = ->(body) { Api.http { |h| h.put("/api/images/#{img['id']}/mask.png", body, 'Content-Type' => 'image/png') } }
    # Не PNG → 400
    assert_equal '400', put.call('not png').code
    # Маска из фикстур
    res = put.call(File.binread(File.join(FIXTURES, 'mask.png')))
    # → 200
    assert_equal '200', res.code, res.body
    # Отмечена как исправленная
    assert_equal true, Api.json(res)['edited']
    # Скачиваем сохранённую
    saved = Api.get("/api/images/#{img['id']}/mask.png").body
    # маска 256×256 растянута до размера фото
    # Размер как у фото
    assert_equal [img['width'], img['height']], saved.byteslice(16, 8).unpack('NN')
    # Чужой id
    other = Api.http { |h| h.put('/api/images/000000000000/mask.png', 'x', 'Content-Type' => 'image/png') }
    # → 404
    assert_equal '404', other.code
  end

  # TC-API-32: портрет «чёрная + белая» — две нити, PATCH нити, шаги и сходство нити
  def test_tc_api_32_color_layers
    # Загружаем фото
    img = Api.json(Api.upload_image('face.jpg', 'image/jpeg'))
    # Создаём портрет из двух нитей
    res = Api.post_json('/api/projects/from-image', image_id: img['id'], mode: 'bw')
    # → 201
    assert_equal '201', res.code, res.body
    # Проект
    p = Api.json(res)
    # Запоминаем для удаления
    @created << p['id']
    # Режим, доска, нити
    assert_equal ['bw', 'gray', %w[black white]], [p['mode'], p.dig('board', 'key'), p['layers'].map { |l| l['color'] }.sort]
    # Первая нить повторяет основные поля
    assert_equal p['sequence'], p['layers'][0]['sequence']
    # Вторая нить: 300 линий
    upd = Api.json(Api.patch("/api/projects/#{p['id']}", layer: 1, line_count: 300))
    # Сохранилось
    assert_equal 300, upd['layers'][1]['line_count']
    # Шаги второй нити
    steps = Api.json(Api.get("/api/projects/#{p['id']}/steps?layer=1&limit=1"))
    # Всего 300, начало A1
    assert_equal [300, 'A1'], [steps['total'], steps['items'][0]['from_label']]
    # Сходство второй нити — 25 точек
    assert_equal 25, Api.json(Api.get("/api/projects/#{p['id']}/similarity?layer=1"))['curve'].size
    # Третьей нити нет → 422
    assert_equal '422', Api.patch("/api/projects/#{p['id']}", layer: 2, line_count: 300).code
  end

  # TC-API-33: экспорт → импорт даёт новый портрет с тем же прогрессом; мусор → 400
  def test_tc_api_33_transfer
    # Проект
    p = create_project
    # Шаг 99
    Api.patch("/api/projects/#{p['id']}", current_step: 99)
    # Экспорт
    res = Api.get("/api/projects/#{p['id']}/export")
    # → 200, имя файла .nitegraf
    assert_equal '200', res.code
    # Заголовок вложения
    assert_includes res['Content-Disposition'], '.nitegraf'
    # Помощник: отправить файл проекта
    send_file = lambda do |body|
      # Запрос
      req = Net::HTTP::Post.new('/api/projects/import')
      # Форма с файлом
      req.set_form([['file', body, { filename: 'p.nitegraf', content_type: 'application/json' }]], 'multipart/form-data')
      # Отправляем
      Api.http { |h| h.request(req) }
    end
    # Импорт
    imported = send_file.call(res.body)
    # → 201
    assert_equal '201', imported.code, imported.body
    # Копия
    copy = Api.json(imported)
    # Удалить после теста
    @created << copy['id']
    # Новый id, тот же шаг и схема
    assert_equal [true, 99, p['sequence']], [copy['id'] != p['id'], copy['current_step'], copy['sequence']]
    # Не файл проекта → 400
    assert_equal '400', send_file.call('hello').code
  end

  # TC-API-34: в веб-версии обновление в одну кнопку недоступно
  def test_tc_api_34_update
    # Состояние обновления
    status = Api.json(Api.get('/api/update'))
    # Ждём, не поддерживается
    assert_equal %w[idle false], [status['state'], status['supported'].to_s]
    # Пробуем начать
    res = Api.http { |h| h.request(Net::HTTP::Post.new('/api/update')) }
    # → 404
    assert_equal '404', res.code
    # С пояснением
    assert_includes Api.json(res)['detail'], 'только в программе для Windows'
    # В настройках — «не обновляется»
    assert_equal false, Api.json(Api.get('/api/config'))['app']['update']
  end
end
