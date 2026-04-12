module MealsHelper
  def meal_header_color(meal_code)
    case meal_code
    when "1" # 조식
      "from-amber-50 to-yellow-50"
    when "2" # 중식
      "from-green-50 to-emerald-50"
    when "3" # 석식
      "from-indigo-50 to-purple-50"
    else
      "from-gray-50 to-gray-100"
    end
  end

  def meal_icon(meal_code)
    icon_class = "w-5 h-5"
    case meal_code
    when "1" # 조식 - 해 아이콘
      content_tag(:svg, class: "#{icon_class} text-amber-500", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24") do
        content_tag(:path, nil, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "2", d: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z")
      end
    when "2" # 중식 - 접시 아이콘
      content_tag(:svg, class: "#{icon_class} text-green-500", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24") do
        content_tag(:path, nil, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "2", d: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253")
      end
    when "3" # 석식 - 달 아이콘
      content_tag(:svg, class: "#{icon_class} text-indigo-500", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24") do
        content_tag(:path, nil, "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-width": "2", d: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z")
      end
    else
      ""
    end
  end
end
