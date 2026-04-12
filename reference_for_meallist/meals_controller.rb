class MealsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_date

  def index
    service = NeisMealService.new(current_user)
    @result = service.fetch_meals(@date)
    @school = School.find_by(name: current_user.schoolname)

    # 이전/다음 날짜 (토, 일 건너뛰기)
    @prev_date = skip_weekend(@date, :prev)
    @next_date = skip_weekend(@date, :next)

    respond_to do |format|
      format.html
      format.turbo_stream
    end
  end

  private

  def set_date
    @date = if params[:date].present?
              date = Date.parse(params[:date])
              # 주말이면 가장 가까운 평일로 이동
              skip_to_weekday(date)
            else
              skip_to_weekday(Date.current)
            end
  rescue ArgumentError
    @date = skip_to_weekday(Date.current)
  end

  # 토, 일요일을 건너뛰고 평일로 이동
  def skip_weekend(date, direction)
    result = direction == :prev ? date - 1.day : date + 1.day
    while result.saturday? || result.sunday?
      result = direction == :prev ? result - 1.day : result + 1.day
    end
    result
  end

  # 주말이면 가장 가까운 평일로 이동
  def skip_to_weekday(date)
    if date.saturday?
      date - 1.day # 토요일 → 금요일
    elsif date.sunday?
      date + 1.day # 일요일 → 월요일
    else
      date
    end
  end
end
