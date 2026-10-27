# frozen_string_literal: true

# API-тесты на Ruby: Minitest + Net::HTTP (обе библиотеки идут вместе с Ruby, gem install не нужен).
# Запуск: STRINGART_API=http://127.0.0.1:8000 ruby api_test.rb

require 'minitest/autorun'
require 'net/http'
require 'json'
require 'uri'
require 'tmpdir'

BASE = URI(ENV.fetch('STRINGART_API', 'http://127.0.0.1:8000'))
FIXTURES = File.expand_path(ENV.fetch('STRINGART_FIXTURES', File.join(__dir__, '..', 'fixtures')))

module Api
  module_function

  def http
    Net::HTTP.start(BASE.host, BASE.port, read_timeout: 60) { |h| yield h }
  end

  def get(path)
    http { |h| h.get(path) }
  end

  def delete(path)
    http { |h| h.delete(path) }
  end

  def patch(path, body)
    http { |h| h.patch(path, JSON.generate(body), 'Content-Type' => 'application/json') }
  end

  # fields: [['name', 'значение'], ...]; file: [path, mime] или nil
  def upload(file: nil, fields: {})
    req = Net::HTTP::Post.new('/api/projects')
    # .b — байты UTF-8 как binary, иначе Net::HTTP не склеит кириллицу с бинарным файлом
    form = fields.map { |k, v| [k.to_s, v.to_s.b] }
    if file
      path, mime = file
      form << ['file', File.binread(path), { filename: File.basename(path), content_type: mime }]
    end
    req.set_form(form, 'multipart/form-data', charset: 'UTF-8')
    http { |h| h.request(req) }
  end

  def json(res)
    JSON.parse(res.body)
  end
end

class StringArtApiTest < Minitest::Test
  JPG = [File.join(FIXTURES, 'portrait.jpg'), 'image/jpeg'].freeze

  def setup
    @created = []
  end

  def teardown
    @created.each { |id| Api.delete("/api/projects/#{id}") }
  end

  def create_project(name: 'Ruby-тест', diameter: '50')
    res = Api.upload(file: JPG, fields: { name: name, diameter_cm: diameter })
    assert_equal '201', res.code, res.body
    Api.json(res).tap { |p| @created << p['id'] }
  end

  def test_tc_api_01_health
    res = Api.get('/api/health')
    assert_equal '200', res.code
    assert_equal({ 'status' => 'ok' }, Api.json(res))
  end

  def test_tc_api_02_config
    cfg = Api.json(Api.get('/api/config'))
    assert_equal %w[A B C D], cfg['sectors']
    assert_equal 60, cfg['nails_per_sector']
    assert_equal [30, 40, 50, 60, 70], cfg.dig('diameter', 'presets_cm')
    assert_equal({ 'default_sec' => 2.0, 'step_sec' => 0.1, 'min_sec' => 0.5, 'max_sec' => 10.0 }, cfg['speed'])
    assert_equal 0.15, cfg.dig('thread', 'margin')
  end

  def test_tc_api_03_create
    p = create_project(name: 'Тестовый портрет')
    assert_match(/\A[0-9a-f]{12}\z/, p['id'])
    assert_equal 'Тестовый портрет', p['name']
    assert_includes 1000..5000, p['line_count']
    assert_equal Api.json(Api.get("/api/projects/#{p['id']}/similarity"))['best_lines'], p['line_count']
    assert_equal 1, p['current_step']
    assert_equal 2.0, p['speed_sec']
    assert_equal 5001, p['sequence'].size
    assert_equal 0, p['sequence'].first
    stats = p['stats']
    assert_in_delta stats['raw_length_m'] * 1.15, stats['total_length_m'], 0.1
    assert_operator stats['spool_m'] * stats['spool_count'], :>=, stats['total_length_m']
  end

  def test_tc_api_04_png_and_filename
    res = Api.upload(file: [File.join(FIXTURES, 'portrait.png'), 'image/png'], fields: { diameter_cm: 70 })
    assert_equal '201', res.code
    p = Api.json(res)
    @created << p['id']
    assert_equal 'portrait', p['name']
    assert_includes 1000..5000, p['line_count']
  end

  {
    'empty' => [:empty, '50', '400'],
    'not_image' => [:text, '50', '400'],
    'diameter_19_9' => [:jpg, '19.9', '422'],
    'diameter_150_1' => [:jpg, '150.1', '422'],
    'diameter_abc' => [:jpg, 'abc', '422'],
    'no_file' => [nil, '50', '422']
  }.each do |title, (kind, diameter, status)|
    define_method("test_tc_api_05_upload_validation_#{title}") do
      file = case kind
             when :empty then [File.join(Dir.tmpdir, 'stringart-empty.jpg').tap { |f| File.write(f, '') }, 'image/jpeg']
             when :text then [File.join(FIXTURES, 'not-an-image.txt'), 'text/plain']
             when :jpg then JPG
             end
      res = Api.upload(file: file, fields: { diameter_cm: diameter })
      assert_equal status, res.code, res.body
    ensure
      empty = File.join(Dir.tmpdir, 'stringart-empty.jpg')
      File.delete(empty) if File.exist?(empty)
    end
  end

  def test_tc_api_07_08_list_and_not_found
    p = create_project
    item = Api.json(Api.get('/api/projects')).find { |i| i['id'] == p['id'] }
    refute_nil item
    refute item.key?('sequence')
    %w[000000000000 nope ABCDEF123456].each do |id|
      assert_equal '404', Api.get("/api/projects/#{id}").code
    end
  end

  def test_tc_api_09_10_progress_and_speed
    p = create_project
    assert_equal '200', Api.patch("/api/projects/#{p['id']}", current_step: 137).code
    assert_equal 137, Api.json(Api.get("/api/projects/#{p['id']}"))['current_step']
    [[2.1, 2.1], [1.9, 1.9], [2.04999, 2.0], [0.5, 0.5], [10, 10.0]].each do |sent, saved|
      assert_equal saved, Api.json(Api.patch("/api/projects/#{p['id']}", speed_sec: sent))['speed_sec']
    end
  end

  def test_tc_api_11_patch_validation
    p = create_project
    Api.patch("/api/projects/#{p['id']}", line_count: 2000)
    [{ speed_sec: 0.4 }, { speed_sec: 10.1 }, { current_step: 0 }, { current_step: 2001 },
     { line_count: 999 }, { line_count: 5001 }, { diameter_cm: 10 }, { name: '' }, { name: '   ' },
     { sequence: [1, 2, 3] }].each do |body|
      assert_equal '422', Api.patch("/api/projects/#{p['id']}", body).code, body.inspect
    end
  end

  def test_tc_api_12_13_lines_and_diameter
    p = Api.json(Api.patch("/api/projects/#{create_project['id']}", line_count: 2000))
    Api.patch("/api/projects/#{p['id']}", current_step: 1900)
    clamped = Api.json(Api.patch("/api/projects/#{p['id']}", line_count: 1500))
    assert_equal 1500, clamped['current_step']
    big = Api.json(Api.patch("/api/projects/#{p['id']}", line_count: 2000, diameter_cm: 100))
    assert_equal p['sequence'], big['sequence']
    assert_in_delta p.dig('stats', 'raw_length_m') * 2, big.dig('stats', 'raw_length_m'), 0.1
  end

  def test_tc_api_14_steps
    p = create_project
    Api.patch("/api/projects/#{p['id']}", line_count: 2000)
    page = Api.json(Api.get("/api/projects/#{p['id']}/steps?offset=0&limit=50"))
    assert_equal 2000, page['total']
    assert_equal 'A1', page['items'].first['from_label']
    page['items'].each_cons(2) do |a, b|
      assert_equal a['to_nail'], b['from_nail']
      assert_operator b['thread_used_m'], :>, a['thread_used_m']
    end
    tail = Api.json(Api.get("/api/projects/#{p['id']}/steps?offset=1990&limit=50"))
    assert_equal (1991..2000).to_a, tail['items'].map { |s| s['number'] }
  end

  def test_tc_api_15_images
    p = create_project
    %w[/preview.png?size=300 /source.png].each do |suffix|
      res = Api.get("/api/projects/#{p['id']}#{suffix}")
      assert_equal '200', res.code
      assert_equal 'image/png', res['Content-Type']
      assert res.body.b.start_with?("\x89PNG".b)
    end
    assert_equal '422', Api.get("/api/projects/#{p['id']}/preview.png?size=50").code
  end

  def test_tc_api_16_pdf
    p = create_project
    Api.patch("/api/projects/#{p['id']}", line_count: 1000)
    res = Api.get("/api/projects/#{p['id']}/instructions.pdf")
    assert_equal '200', res.code
    assert_equal 'application/pdf', res['Content-Type']
    assert_includes res['Content-Disposition'], "filename*=UTF-8''"
    body = res.body.b
    assert body.start_with?('%PDF')
    assert_equal 7, body.scan(%r{/Type\s*/Page[^s]}n).size
  end

  def test_tc_api_17_delete
    res = Api.upload(file: JPG)
    id = Api.json(res)['id']
    assert_equal '204', Api.delete("/api/projects/#{id}").code
    assert_equal '404', Api.get("/api/projects/#{id}").code
    assert_equal '404', Api.delete("/api/projects/#{id}").code
  end

  def test_tc_api_18_geometry
    { 30 => [3.93, 1200], 50 => [6.54, 2000], 70 => [9.16, 2800] }.each do |d, (spacing, lines)|
      g = Api.json(Api.get("/api/geometry?diameter_cm=#{d}"))
      assert_equal spacing, g['nail_spacing_mm']
      assert_equal lines, g['recommended_lines']
    end
  end

  def test_tc_api_19_image_upload
    req = Net::HTTP::Post.new('/api/images')
    req.set_form([['file', File.binread(File.join(FIXTURES, 'face.jpg')), { filename: 'face.jpg', content_type: 'image/jpeg' }]], 'multipart/form-data')
    img = Api.json(Api.http { |h| h.request(req) })
    assert_equal 512, img['width']
    refute_empty img['faces']
    assert_equal true, img.dig('face_prep', 'face_focus')
    assert_equal 'image/jpeg', Api.get("/api/images/#{img['id']}/original.jpg")['Content-Type']
    @image = img
  end

  def test_tc_api_21_23_from_image_and_edit_photo
    test_tc_api_19_image_upload
    res = Api.http do |h|
      h.post('/api/projects/from-image',
             JSON.generate(image_id: @image['id'], name: 'Ruby', prep: { zoom: 2, center_x: 0.45, center_y: 0.3 }),
             'Content-Type' => 'application/json')
    end
    assert_equal '201', res.code, res.body
    p = Api.json(res)
    @created << p['id']
    assert_equal 2.0, p.dig('prep', 'zoom')
    Api.patch("/api/projects/#{p['id']}", current_step: 99)
    upd = Api.http do |h|
      h.put("/api/projects/#{p['id']}/photo", JSON.generate(@image['face_prep']), 'Content-Type' => 'application/json')
    end
    body = Api.json(upd)
    assert_equal 1, body['current_step']
    assert_equal true, body.dig('prep', 'face_focus')
    refute_equal p['sequence'], body['sequence']
  end

  def test_tc_api_26_similarity
    p = create_project
    sim = Api.json(Api.get("/api/projects/#{p['id']}/similarity"))
    assert_equal p['line_count'], sim['best_lines']
    assert_equal 41, sim['curve'].size
    assert_equal sim['best_score'], sim['curve'].map { |x| x['score'] }.max
    small = Api.json(Api.get("/api/projects/#{p['id']}/similarity?diameter_cm=30"))
    assert_operator small['best_lines'], :<=, sim['best_lines']
  end

  def test_tc_api_27_auto_tone
    test_tc_api_19_image_upload
    post = lambda do |body|
      Api.http { |h| h.post("/api/images/#{@image['id']}/auto-tone", JSON.generate(body), 'Content-Type' => 'application/json') }
    end
    res = post.call(prep: @image['face_prep'], diameter_cm: 50)
    assert_equal '200', res.code, res.body
    t = Api.json(res)
    assert_operator t['score_after'], :>=, t['score_before']
    assert_equal 6, t['candidates']
    assert_includes(-0.5..0.5, t['brightness'])
    assert_equal '422', post.call(diameter_cm: 5).code
  end

  def test_tc_api_31_template_pdf
    p = create_project
    res = Api.get("/api/projects/#{p['id']}/template.pdf")
    assert_equal '200', res.code
    assert_equal 'application/pdf', res['Content-Type']
    assert res.body.start_with?('%PDF')
    assert_equal '422', Api.get('/api/template.pdf?diameter_cm=10').code
  end

  def test_tc_api_30_activity_and_spool
    p = create_project
    post = lambda do |body|
      Api.http { |h| h.post("/api/projects/#{p['id']}/activity", JSON.generate(body), 'Content-Type' => 'application/json') }
    end
    post.call(date: '2026-10-27', seconds: 20, steps: 5)
    act = Api.json(post.call(date: '2026-10-28', seconds: 40, steps: 10))
    assert_equal 60.0, act['total_sec']
    assert_equal 15, act['total_steps']
    assert_equal %w[2026-10-27 2026-10-28], act['days'].map { |d| d['date'] }
    assert_equal 300.0, Api.json(Api.patch("/api/projects/#{p['id']}", own_spool_m: 300))['own_spool_m']
  end
end
