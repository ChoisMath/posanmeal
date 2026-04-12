require "net/http"
require "json"

# NEIS 급식식단정보 API 서비스
# API 문서: https://open.neis.go.kr/portal/data/service/selectServicePage.do?infId=OPEN17320190722180924242823
class NeisMealService
  BASE_URL = "https://open.neis.go.kr/hub/mealServiceDietInfo"

  # 식사 코드
  MEAL_CODES = {
    "1" => "조식",
    "2" => "중식",
    "3" => "석식"
  }.freeze

  # 알레르기 정보 코드
  ALLERGY_INFO = {
    "1" => "난류",
    "2" => "우유",
    "3" => "메밀",
    "4" => "땅콩",
    "5" => "대두",
    "6" => "밀",
    "7" => "고등어",
    "8" => "게",
    "9" => "새우",
    "10" => "돼지고기",
    "11" => "복숭아",
    "12" => "토마토",
    "13" => "아황산류",
    "14" => "호두",
    "15" => "닭고기",
    "16" => "쇠고기",
    "17" => "오징어",
    "18" => "조개류(굴, 전복, 홍합 포함)",
    "19" => "잣"
  }.freeze

  def initialize(user)
    @user = user
    @api_key = ENV["NEIS_API_KEY"]
  end

  # 특정 날짜의 급식 정보 조회
  def fetch_meals(date)
    return { success: false, error: "API 키가 설정되지 않았습니다." } if @api_key.blank?

    school = find_school
    return { success: false, error: "학교 정보를 찾을 수 없습니다." } if school.nil?
    return { success: false, error: "학교 코드 정보가 없습니다." } if school.office_code.blank? || school.school_code.blank?

    formatted_date = date.strftime("%Y%m%d")

    response = make_api_request(school.office_code, school.school_code, formatted_date)
    parse_response(response, date)
  rescue StandardError => e
    Rails.logger.error "NEIS Meal API Error: #{e.message}"
    { success: false, error: "급식 정보를 가져오는 중 오류가 발생했습니다." }
  end

  private

  def find_school
    return nil if @user.schoolname.blank?
    School.find_by(name: @user.schoolname)
  end

  def make_api_request(office_code, school_code, date)
    uri = URI(BASE_URL)
    params = {
      KEY: @api_key,
      Type: "json",
      pIndex: 1,
      pSize: 10,
      ATPT_OFCDC_SC_CODE: office_code,
      SD_SCHUL_CODE: school_code,
      MLSV_YMD: date
    }
    uri.query = URI.encode_www_form(params)

    http = Net::HTTP.new(uri.host, uri.port)
    http.use_ssl = true
    http.open_timeout = 5
    http.read_timeout = 10

    request = Net::HTTP::Get.new(uri)
    http.request(request)
  end

  def parse_response(response, date)
    unless response.is_a?(Net::HTTPSuccess)
      return { success: false, error: "API 요청 실패 (#{response.code})" }
    end

    data = JSON.parse(response.body)

    # API 에러 체크
    if data["RESULT"]
      error_code = data["RESULT"]["CODE"]
      if error_code == "INFO-200"
        return { success: true, date: date, meals: [], message: "해당 날짜에 급식 정보가 없습니다." }
      else
        return { success: false, error: data["RESULT"]["MESSAGE"] }
      end
    end

    # 급식 데이터 파싱
    meal_data = data.dig("mealServiceDietInfo", 1, "row")
    return { success: true, date: date, meals: [], message: "해당 날짜에 급식 정보가 없습니다." } if meal_data.nil?

    meals = meal_data.map do |meal|
      {
        meal_type: MEAL_CODES[meal["MMEAL_SC_CODE"]] || meal["MMEAL_SC_NM"],
        meal_code: meal["MMEAL_SC_CODE"],
        dishes: parse_dishes(meal["DDISH_NM"]),
        calorie: meal["CAL_INFO"],
        nutrition: parse_nutrition(meal["NTR_INFO"]),
        origin: meal["ORPLC_INFO"]
      }
    end

    # 식사 코드 순서대로 정렬 (조식 → 중식 → 석식)
    meals.sort_by! { |m| m[:meal_code].to_i }

    { success: true, date: date, meals: meals }
  end

  # 요리명 파싱 (알레르기 정보 포함)
  def parse_dishes(dish_string)
    return [] if dish_string.blank?

    dish_string.split("<br/>").map do |dish|
      dish = dish.strip
      # 알레르기 정보 추출 (숫자 형태: 1.2.5.6 등)
      if dish =~ /(.+?)\s*\(?([\d.]+)\)?$/
        name = $1.strip
        allergy_codes = $2.split(".").map(&:strip)
        allergies = allergy_codes.map { |code| ALLERGY_INFO[code] }.compact
        { name: name, allergies: allergies }
      else
        { name: dish, allergies: [] }
      end
    end
  end

  # 영양 정보 파싱
  def parse_nutrition(nutrition_string)
    return [] if nutrition_string.blank?

    nutrition_string.split("<br/>").map(&:strip).reject(&:blank?)
  end
end
